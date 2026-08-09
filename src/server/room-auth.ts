import {
  DEFAULT_CLOCK_SKEW_MS,
  describeRoomTokenSecretRefusal,
  readRoomTokenSecret,
  verifyRoomToken,
} from './hive/sign-room-token'

/**
 * The realtime side of the join boundary.
 *
 * The Colyseus process owns no HIVE credentials and talks to no HIVE endpoint. It only decides
 * whether a connection may take a seat, from three inputs: the environment policy, the signed
 * capability the client presents, and what this room has already granted.
 *
 * Two modes exist on purpose and are never mixed inside one room:
 *
 * - **guest** — the deployed unauthenticated demo. Allowed only while the environment says so, and
 *   never in a room that an authenticated match already claimed.
 * - **authenticated** — a token minted by the Next.js server after HIVE verified the player and the
 *   matchmaker assigned the room. Signature, lifetime, room binding, single use, and one-seat-per
 *   identity are all enforced here rather than trusted from the client.
 */

/** Colyseus `ErrorCode.AUTH_FAILED`, inlined so this module stays transport-independent. */
export const ROOM_AUTH_ERROR_CODE = 525
/** Live nonces held per process. 60 s tokens make this a very large flood before it fails closed. */
export const DEFAULT_REPLAY_GUARD_ENTRIES = 20_000
/**
 * How long an identity stays claimed by a connection that passed `onAuth` but has not reached
 * `onJoin` yet.
 *
 * Colyseus runs both callbacks in the same tick today, so this is several orders of magnitude more
 * than the gap needs — deliberately, because the gap is what widens the moment `onAuth` has to await
 * anything. It is still short enough that a client which dies inside that gap frees its identity
 * almost immediately: the alternative, an unbounded claim, would lock a player out of their own
 * match until the room disposed.
 */
export const DEFAULT_PENDING_SEAT_MS = 5_000

export interface RoomAuthPolicy {
  /** Whether a client with no capability may still take a seat. */
  guestJoin: boolean
  /** Shared with the Next.js host; `null` means this deployment cannot verify any token. */
  roomTokenSecret: string | null
  clockSkewMs: number
}

export type RoomJoinRejection =
  | 'guest-join-disabled'
  | 'token-required'
  | 'token-unsupported'
  | 'malformed-options'
  | 'invalid-token'
  | 'expired-token'
  | 'wrong-room'
  | 'replayed-token'
  | 'identity-already-seated'

export type RoomJoinAuthorization =
  | { ok: true; mode: 'guest'; identity: null; assignedRoomId: null }
  | { ok: true; mode: 'authenticated'; identity: string; assignedRoomId: string }
  | { ok: false; code: number; reason: RoomJoinRejection }

export interface ReplayGuard {
  consume(nonce: string, expiresAtMs: number, nowMs: number): boolean
  size(): number
}

/**
 * One room's record of which identities are spoken for.
 *
 * A seat is claimed in two steps because Colyseus grants one in two steps: `onAuth` decides, and
 * `onJoin` seats. Between them the identity is *reserved* — held against a deadline, so a connection
 * that dies in that gap cannot hold the identity forever, and so a second connection cannot slip
 * through the duplicate check while the first is still on its way to a seat.
 */
export interface SeatLedger {
  /** Whether any session, seated or still joining, currently holds this identity. */
  holds(identity: string, nowMs: number): boolean
  /**
   * Claims an identity for a session that has just passed every check. Expires on its own, and
   * refuses to trade a claim this session already made for a different identity.
   */
  reserve(sessionId: string, identity: string, nowMs: number): boolean
  /**
   * Promotes this session's own live reservation into a seat that no longer expires.
   *
   * Only ever a promotion: a reservation that expired, was never made, or names another identity
   * is refused, and nothing is written. Seating on absence is what would let a connection that
   * reached `onJoin` late resurrect an authorization the pending window had already withdrawn.
   */
  seat(sessionId: string, identity: string, nowMs: number): boolean
  /** Drops whatever a session holds, reserved or seated. Unknown sessions are ignored. */
  release(sessionId: string): void
  clear(): void
  size(nowMs: number): number
}

export interface RoomJoinContext {
  policy: RoomAuthPolicy
  guard: ReplayGuard
  /** The match this room is already serving, or `null` while it is still unclaimed. */
  assignedRoomId: string | null
  /** The connection being decided. A reservation is keyed to it and released when it goes away. */
  sessionId: string
  seats: SeatLedger
  nowMs: number
}

interface SeatEntry {
  identity: string
  /** A deadline while the session is still joining; `null` once it actually took its seat. */
  pendingUntilMs: number | null
}

/**
 * Per-room seat ledger.
 *
 * Expiry is evaluated on use rather than on a timer: a room holds at most `MAX_ROOM_PLAYERS`
 * connections, so the map is small by construction and a scan costs less than the timers would.
 */
export function createSeatLedger(options: { pendingMs?: number } = {}): SeatLedger {
  const pendingMs = options.pendingMs ?? DEFAULT_PENDING_SEAT_MS
  const bySession = new Map<string, SeatEntry>()

  const prune = (nowMs: number) => {
    for (const [sessionId, entry] of bySession) {
      if (entry.pendingUntilMs !== null && entry.pendingUntilMs <= nowMs) bySession.delete(sessionId)
    }
  }

  /**
   * Which *other* session holds `identity`, or `null`. Callers prune first; passing `null` for
   * `exceptSessionId` excludes nobody, because a session id is always a string.
   */
  const otherHolder = (identity: string, exceptSessionId: string | null): string | null => {
    for (const [sessionId, entry] of bySession) {
      if (sessionId !== exceptSessionId && entry.identity === identity) return sessionId
    }
    return null
  }

  return {
    holds(identity, nowMs) {
      prune(nowMs)
      return otherHolder(identity, null) !== null
    },
    reserve(sessionId, identity, nowMs) {
      prune(nowMs)
      if (otherHolder(identity, sessionId) !== null) return false

      const existing = bySession.get(sessionId)
      if (existing !== undefined) {
        // A connection holds one identity for its whole life. Swapping would silently drop the
        // claim it already made and hand it a seat under a name it never authorized as.
        if (existing.identity !== identity) return false
        // Re-deciding a seated session must never send it back to a deadline that can lapse.
        if (existing.pendingUntilMs === null) return true
      }

      bySession.set(sessionId, { identity, pendingUntilMs: nowMs + pendingMs })
      return true
    },
    seat(sessionId, identity, nowMs) {
      // Pruning first is what makes a reservation whose window closed indistinguishable from one
      // that was never made: both are absent below, and both refuse. Promotion is the only thing
      // this does — never creation — so a late arrival cannot resurrect a withdrawn authorization.
      prune(nowMs)
      const existing = bySession.get(sessionId)
      if (existing === undefined || existing.identity !== identity) return false
      // Already seated: this is the same seat being confirmed again, not a second one.
      if (existing.pendingUntilMs === null) return true
      // Unreachable while `reserve` is the only way into the ledger, and checked anyway: promoting
      // must never be the step that hands one identity to two sessions.
      if (otherHolder(identity, sessionId) !== null) return false

      bySession.set(sessionId, { identity, pendingUntilMs: null })
      return true
    },
    release(sessionId) {
      bySession.delete(sessionId)
    },
    clear() {
      bySession.clear()
    },
    size(nowMs) {
      prune(nowMs)
      return bySession.size
    },
  }
}

function parseGuestJoin(value: string | undefined): boolean {
  if (value === undefined || value === 'allow') return true
  if (value === 'deny') return false
  throw new RangeError('HELLBREAK_GUEST_JOIN must be "allow" or "deny"')
}

function parseClockSkew(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CLOCK_SKEW_MS
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 60_000) {
    throw new RangeError('ROOM_TOKEN_CLOCK_SKEW_MS must be a whole number of milliseconds up to 60000')
  }
  return parsed
}

/**
 * Reads the deployment policy, and throws rather than degrading. A room server started with a
 * half-configured secret must not quietly fall back to accepting everyone.
 *
 * The default is `allow`, because the currently deployed Render service *is* the guest demo and
 * this refactor must not silently disconnect it. Production sets `HELLBREAK_GUEST_JOIN=deny`.
 */
export function readRoomAuthPolicy(env: Record<string, string | undefined>): RoomAuthPolicy {
  const rawSecret = env.ROOM_TOKEN_SECRET
  // An absent secret is a posture — this deployment verifies nothing and is guest-only. A *present*
  // one is read by exactly the rule the Next.js host reads it with, so the two either agree on the
  // key or this process refuses to start. The value itself is never in the message.
  const secret = rawSecret === undefined ? null : readRoomTokenSecret(rawSecret)
  if (secret !== null && !secret.ok) throw new RangeError(describeRoomTokenSecretRefusal(secret.reason))

  return {
    guestJoin: parseGuestJoin(env.HELLBREAK_GUEST_JOIN),
    roomTokenSecret: secret?.ok ? secret.secret : null,
    clockSkewMs: parseClockSkew(env.ROOM_TOKEN_CLOCK_SKEW_MS),
  }
}

/**
 * Single-use nonce ledger for one room-server process.
 *
 * Expired entries are dropped on every use, and at the cap it refuses new joins instead of evicting
 * a live nonce, because evicting is exactly what would re-open the replay window.
 *
 * A horizontally scaled deployment needs shared storage behind this interface; today the room
 * server runs as a single instance and this is stated in the deployment docs.
 */
export function createReplayGuard(options: { maxEntries?: number } = {}): ReplayGuard {
  const maxEntries = options.maxEntries ?? DEFAULT_REPLAY_GUARD_ENTRIES
  const seen = new Map<string, number>()

  // Every entry is examined rather than stopping at the first live one: capabilities may be minted
  // with different lifetimes, and an early break would let one long-lived nonce pin dead entries in
  // place until the ledger hit its cap and started failing closed.
  const prune = (nowMs: number) => {
    for (const [nonce, expiresAtMs] of seen) {
      if (expiresAtMs <= nowMs) seen.delete(nonce)
    }
  }

  return {
    consume(nonce, expiresAtMs, nowMs) {
      if (expiresAtMs <= nowMs) return false
      prune(nowMs)
      if (seen.has(nonce)) return false
      if (seen.size >= maxEntries) return false
      seen.set(nonce, expiresAtMs)
      return true
    },
    size() {
      return seen.size
    },
  }
}

function readToken(options: unknown): { ok: true; token: string | null } | { ok: false } {
  if (options === undefined || options === null) return { ok: true, token: null }
  if (typeof options !== 'object' || Array.isArray(options)) return { ok: false }
  if (!Object.hasOwn(options, 'roomToken')) return { ok: true, token: null }

  const token = (options as { roomToken: unknown }).roomToken
  if (typeof token !== 'string' || token.length === 0) return { ok: false }
  // Longer strings are still handed on: the crypto layer refuses them on size before hashing.
  return { ok: true, token }
}

export type RoomBinding =
  | { ok: true; assignedRoomId: string | null }
  | { ok: false; code: number; reason: RoomJoinRejection }

/**
 * Decides what a *newly created* room is for, before anyone has a seat in it.
 *
 * Colyseus runs `onCreate` with the creating client's options and only calls `onAuth` afterwards,
 * so this deliberately verifies the capability **without spending its nonce** — the creator still
 * has to pass the full join check a moment later.
 *
 * `assignedRoomId` is also required to be echoed in the options of an authenticated create, because
 * that is the field the matchmaker filters on: without it the room would exist but no teammate
 * could ever be routed into it.
 */
export function bindRoomToMatch(
  options: unknown,
  context: { policy: RoomAuthPolicy; nowMs: number },
): RoomBinding {
  const reject = (reason: RoomJoinRejection): RoomBinding =>
    ({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason })

  const presented = readToken(options)
  if (!presented.ok) return reject('malformed-options')
  const hint = readAssignedRoomHint(options)
  if (hint === false) return reject('malformed-options')

  if (presented.token === null) {
    if (!context.policy.guestJoin) return reject('guest-join-disabled')
    // A guest room is not part of any match, so a match key on it would be a lie.
    if (hint !== null) return reject('malformed-options')
    return { ok: true, assignedRoomId: null }
  }

  const { roomTokenSecret } = context.policy
  if (roomTokenSecret === null) return reject('token-unsupported')

  const verified = verifyRoomToken(presented.token, {
    secret: roomTokenSecret,
    nowMs: context.nowMs,
    clockSkewMs: context.policy.clockSkewMs,
  })
  if (!verified.ok) {
    if (verified.reason === 'expired' || verified.reason === 'not-yet-valid') return reject('expired-token')
    return reject('invalid-token')
  }
  if (hint !== verified.claims.roomId) return reject('wrong-room')

  return { ok: true, assignedRoomId: verified.claims.roomId }
}

/** `false` means "present but unusable"; `null` means "absent". */
function readAssignedRoomHint(options: unknown): string | null | false {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) return null
  if (!Object.hasOwn(options, 'assignedRoomId')) return null
  const hint = (options as { assignedRoomId: unknown }).assignedRoomId
  return typeof hint === 'string' && hint.length > 0 ? hint : false
}

/**
 * Decides one seat. Nothing here reads a client-supplied identity, room, or mode: the only field
 * consulted from the join options is the signed capability itself.
 */
export function authorizeRoomJoin(options: unknown, context: RoomJoinContext): RoomJoinAuthorization {
  const reject = (reason: RoomJoinRejection): RoomJoinAuthorization =>
    ({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason })

  const presented = readToken(options)
  if (!presented.ok) return reject('malformed-options')

  if (presented.token === null) {
    if (context.assignedRoomId !== null) return reject('token-required')
    if (!context.policy.guestJoin) return reject('guest-join-disabled')
    return { ok: true, mode: 'guest', identity: null, assignedRoomId: null }
  }

  const { roomTokenSecret } = context.policy
  if (roomTokenSecret === null) return reject('token-unsupported')

  const verified = verifyRoomToken(presented.token, {
    secret: roomTokenSecret,
    nowMs: context.nowMs,
    clockSkewMs: context.policy.clockSkewMs,
    expectedRoomId: context.assignedRoomId ?? undefined,
  })
  if (!verified.ok) {
    if (verified.reason === 'wrong-room') return reject('wrong-room')
    if (verified.reason === 'expired' || verified.reason === 'not-yet-valid') return reject('expired-token')
    return reject('invalid-token')
  }

  const { claims } = verified
  // Checked before the nonce is spent, so a rejected join cannot burn a capability the player
  // still needs, and a duplicate seat cannot be created by re-minting.
  if (context.seats.holds(claims.playerId, context.nowMs)) return reject('identity-already-seated')
  // The ledger has to remember a nonce for exactly as long as the token is still acceptable, which
  // is `exp` plus the skew this room tolerates. Handing it the raw `exp` would make the guard refuse
  // a first-time join inside the skew window that verification just accepted — reported as a replay
  // that never happened — and would drop the entry while the token was still usable.
  const acceptableUntilMs = claims.expiresAtMs + context.policy.clockSkewMs
  if (!context.guard.consume(claims.nonce, acceptableUntilMs, context.nowMs)) {
    return reject('replayed-token')
  }

  // Every check has passed, so the identity is claimed here rather than at `onJoin`, in the same
  // synchronous step that approved it. Deciding first and claiming later is what would let two
  // connections holding different valid capabilities for one identity both pass the check above
  // before either of them took a seat. Nothing is claimed on any path that rejects.
  if (!context.seats.reserve(context.sessionId, claims.playerId, context.nowMs)) {
    return reject('identity-already-seated')
  }

  return {
    ok: true,
    mode: 'authenticated',
    identity: claims.playerId,
    assignedRoomId: claims.roomId,
  }
}
