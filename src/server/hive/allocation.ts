import { isRoomTokenId } from './sign-room-token'

/**
 * Where a matched player is told to connect.
 *
 * The publicly documented Private Match API answers with `matchingInfo.status: "matched"` and
 * nothing else — no room id, no session id, no server address. HIVE delivers those through a
 * separate match result callback to the game server, whose payload is not publicly documented and
 * is not present in this repository.
 *
 * Rather than invent a field on the queue response, that gap is represented explicitly: this store
 * is the seam the callback will write into, and until something writes to it, `/api/hive/room-token`
 * answers `match_not_allocated` instead of signing a capability for a room nobody assigned.
 *
 * The store is intentionally in-process and bounded. A multi-instance Next.js deployment needs a
 * shared implementation of this same interface; the rollout notes state that requirement.
 *
 * Because the writer is an upstream contract that does not exist yet, a write is validated here
 * against the same identifier rules the room token enforces, and refused by name when it fails.
 *
 * Two things this store deliberately does not do:
 *
 * - It never infers the current time from the data it is handed. An allocation's expiry describes
 *   that allocation and nothing else; treating it as "now" is what let one player's long match
 *   expire everyone else's live assignment. Time comes from an injected clock, so it is the same
 *   clock the routes read and a test can move it without moving any expiry.
 * - It does not correlate a write with the queue attempt that caused it. The match result callback
 *   contract is not published, so there is no documented field to correlate on and none is invented
 *   here. `invalidate` is the substitute: the route ends an attempt explicitly, and a callback that
 *   lands afterwards can still write a fresh allocation for a match the player has left. That
 *   remains open until the real callback contract is known, and the rollout notes list it.
 */

export interface MatchAllocation {
  playerId: string
  /** The match/room key a capability will be bound to, chosen by the allocator and never by a client. */
  roomId: string
  expiresAtMs: number
}

export type AllocationRefusal =
  | 'invalid-player-id'
  | 'invalid-room-id'
  | 'invalid-expiry'
  | 'expired-allocation'
  | 'store-full'

export type AllocationWrite = { ok: true } | { ok: false; reason: AllocationRefusal }

export interface MatchAllocationStore {
  /** Refuses rather than stores anything `/api/hive/room-token` could not turn into a capability. */
  record(allocation: MatchAllocation): AllocationWrite
  resolve(playerId: string, nowMs: number): string | null
  /**
   * Ends whatever assignment a player holds, because the attempt that produced it is over.
   * Idempotent: a player with nothing assigned is not an error, it is the intended end state.
   */
  invalidate(playerId: string): void
  size(): number
}

export const DEFAULT_ALLOCATION_ENTRIES = 10_000

/**
 * Whitespace around a value from an upstream payload is a formatting artefact, not an identifier, so
 * it is stripped before the identifier rules decide. Nothing else is rewritten: what survives is
 * either exactly a valid id or a refusal.
 */
function canonicalId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isRoomTokenId(trimmed) ? trimmed : null
}

export function createMatchAllocationStore(
  options: { maxEntries?: number; now?: () => number } = {},
): MatchAllocationStore {
  const maxEntries = options.maxEntries ?? DEFAULT_ALLOCATION_ENTRIES
  const now = options.now ?? Date.now
  const allocations = new Map<string, MatchAllocation>()

  /** Drops everything the clock has already passed. `nowMs` is a reading, never a deadline. */
  const prune = (nowMs: number) => {
    for (const [playerId, allocation] of allocations) {
      if (allocation.expiresAtMs > nowMs) continue
      allocations.delete(playerId)
    }
  }

  return {
    record(allocation) {
      // The identifier rules are the room token's own, checked here rather than at signing time:
      // a room id that cannot be signed is a defect in whoever allocated it, and the honest place
      // to say so is the write that introduced it — not a 500 in the player's browser a minute
      // later, when the only recoverable context is long gone.
      const playerId = canonicalId(allocation?.playerId)
      if (playerId === null) return { ok: false, reason: 'invalid-player-id' }
      const roomId = canonicalId(allocation.roomId)
      if (roomId === null) return { ok: false, reason: 'invalid-room-id' }
      const { expiresAtMs } = allocation
      if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) {
        return { ok: false, reason: 'invalid-expiry' }
      }

      const nowMs = now()
      // An allocation that `resolve` would refuse in the same millisecond is not stored at all: it
      // would occupy a slot, evict nothing, and answer `match_not_allocated` anyway.
      if (expiresAtMs <= nowMs) return { ok: false, reason: 'expired-allocation' }

      prune(nowMs)
      // The newest assignment for a player replaces the previous one; a rematch is not a new seat.
      if (!allocations.has(playerId) && allocations.size >= maxEntries) {
        return { ok: false, reason: 'store-full' }
      }
      allocations.set(playerId, { playerId, roomId, expiresAtMs })
      return { ok: true }
    },
    resolve(playerId, nowMs) {
      const allocation = allocations.get(playerId)
      if (!allocation) return null
      if (allocation.expiresAtMs <= nowMs) {
        allocations.delete(playerId)
        return null
      }
      return allocation.roomId
    },
    invalidate(playerId) {
      if (typeof playerId !== 'string') return
      // `record` only ever stores the canonical id; the raw key is deleted as well so that a writer
      // which stored what it was handed cannot leave a live assignment behind either.
      allocations.delete(playerId)
      allocations.delete(playerId.trim())
    },
    size() {
      return allocations.size
    },
  }
}
