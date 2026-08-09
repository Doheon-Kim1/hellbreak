import { describe, expect, it } from 'vitest'
import { createMatchAllocationStore } from './allocation'

const NOW = 1_700_000_000_000

/**
 * Every test drives the store's own clock rather than the wall clock, because expiry is the thing
 * under test. `clock.nowMs` is what the store reads on each write; moving it is how time passes.
 */
function fixedClockStore(options: { maxEntries?: number } = {}) {
  const clock = { nowMs: NOW }
  const store = createMatchAllocationStore({ ...options, now: () => clock.nowMs })
  return { store, clock }
}

describe('match allocation store', () => {
  it('starts empty, because nothing assigns a room until the HIVE callback lands', () => {
    const { store } = fixedClockStore()

    expect(store.resolve('1234567890123', NOW)).toBe(null)
    expect(store.size()).toBe(0)
  })

  it('resolves a recorded assignment for its player only', () => {
    const { store } = fixedClockStore()

    expect(store.record({ playerId: '111', roomId: 'match-7', expiresAtMs: NOW + 60_000 }))
      .toEqual({ ok: true })
    expect(store.resolve('111', NOW)).toBe('match-7')
    expect(store.resolve('222', NOW)).toBe(null)
  })

  it('drops an assignment once it expires', () => {
    const { store } = fixedClockStore()
    store.record({ playerId: '111', roomId: 'match-7', expiresAtMs: NOW + 1_000 })

    expect(store.resolve('111', NOW + 1_000)).toBe(null)
    expect(store.size()).toBe(0)
  })

  it('replaces an earlier assignment for the same player', () => {
    const { store } = fixedClockStore()
    store.record({ playerId: '111', roomId: 'match-7', expiresAtMs: NOW + 60_000 })
    store.record({ playerId: '111', roomId: 'match-8', expiresAtMs: NOW + 60_000 })

    expect(store.resolve('111', NOW)).toBe('match-8')
    expect(store.size()).toBe(1)
  })

  it('stays bounded under a flood of distinct players', () => {
    const { store } = fixedClockStore({ maxEntries: 2 })
    store.record({ playerId: '111', roomId: 'match-1', expiresAtMs: NOW + 60_000 })
    store.record({ playerId: '222', roomId: 'match-2', expiresAtMs: NOW + 60_000 })

    expect(store.record({ playerId: '333', roomId: 'match-3', expiresAtMs: NOW + 60_000 }))
      .toEqual({ ok: false, reason: 'store-full' })
    expect(store.size()).toBe(2)
    expect(store.resolve('333', NOW)).toBe(null)
    // A live assignment is never evicted to make room for a newer one.
    expect(store.resolve('111', NOW)).toBe('match-1')
  })

  it('reclaims expired space when a new assignment arrives', () => {
    const { store, clock } = fixedClockStore({ maxEntries: 2 })
    store.record({ playerId: '111', roomId: 'match-1', expiresAtMs: NOW + 1_000 })
    store.record({ playerId: '222', roomId: 'match-2', expiresAtMs: NOW + 1_000 })

    clock.nowMs = NOW + 2_000
    expect(store.record({ playerId: '333', roomId: 'match-3', expiresAtMs: NOW + 62_000 }))
      .toEqual({ ok: true })
    expect(store.resolve('333', NOW + 2_000)).toBe('match-3')
    expect(store.size()).toBe(1)
  })
})

/**
 * The expiry of the allocation being written says nothing about the current time, and reading it as
 * if it did is how one player's long match silently evicted everyone else's live seat.
 */
describe('match allocation expiry is decided by a real clock', () => {
  it('leaves an earlier, sooner-expiring assignment alone when a longer one is written', () => {
    const { store } = fixedClockStore()
    store.record({ playerId: '111', roomId: 'match-1', expiresAtMs: NOW + 30_000 })

    expect(store.record({ playerId: '222', roomId: 'match-2', expiresAtMs: NOW + 600_000 }))
      .toEqual({ ok: true })
    expect(store.resolve('111', NOW)).toBe('match-1')
    expect(store.resolve('222', NOW)).toBe('match-2')
    expect(store.size()).toBe(2)
  })

  it('keeps every live assignment when a far-future write arrives', () => {
    const { store } = fixedClockStore()
    for (const playerId of ['111', '222', '333']) {
      store.record({ playerId, roomId: `match-${playerId}`, expiresAtMs: NOW + 10_000 })
    }

    store.record({ playerId: '444', roomId: 'match-444', expiresAtMs: NOW + 300_000 })

    expect(store.size()).toBe(4)
    expect(store.resolve('222', NOW + 9_000)).toBe('match-222')
  })

  it.each([
    ['already past', -1],
    ['expiring exactly now', 0],
  ])('refuses an allocation that is %s at the moment it is written', (_label, offset) => {
    const { store } = fixedClockStore()

    expect(store.record({ playerId: '111', roomId: 'match-7', expiresAtMs: NOW + offset }))
      .toEqual({ ok: false, reason: 'expired-allocation' })
    expect(store.resolve('111', NOW)).toBe(null)
    expect(store.size()).toBe(0)
  })

  it('leaves a live assignment in place when an expired one is refused', () => {
    const { store, clock } = fixedClockStore()
    store.record({ playerId: '111', roomId: 'match-7', expiresAtMs: NOW + 60_000 })

    clock.nowMs = NOW + 1_000
    expect(store.record({ playerId: '111', roomId: 'match-8', expiresAtMs: NOW + 500 }))
      .toEqual({ ok: false, reason: 'expired-allocation' })
    expect(store.resolve('111', NOW + 1_000)).toBe('match-7')
  })

  it('refuses a new player while every entry is still live, and admits one once they are not', () => {
    const { store, clock } = fixedClockStore({ maxEntries: 2 })
    store.record({ playerId: '111', roomId: 'match-1', expiresAtMs: NOW + 60_000 })
    store.record({ playerId: '222', roomId: 'match-2', expiresAtMs: NOW + 20_000 })

    expect(store.record({ playerId: '333', roomId: 'match-3', expiresAtMs: NOW + 60_000 }))
      .toEqual({ ok: false, reason: 'store-full' })

    clock.nowMs = NOW + 20_000
    expect(store.record({ playerId: '333', roomId: 'match-3', expiresAtMs: NOW + 80_000 }))
      .toEqual({ ok: true })
    expect(store.resolve('111', NOW + 20_000)).toBe('match-1')
    expect(store.resolve('222', NOW + 20_000)).toBe(null)
  })

  it('reads the wall clock when no clock is injected', () => {
    const store = createMatchAllocationStore()
    const wallNow = Date.now()

    expect(store.record({ playerId: '111', roomId: 'match-7', expiresAtMs: wallNow + 60_000 }))
      .toEqual({ ok: true })
    // A timestamp far in the past is refused rather than being taken for the current time.
    expect(store.record({ playerId: '222', roomId: 'match-8', expiresAtMs: NOW }))
      .toEqual({ ok: false, reason: 'expired-allocation' })
    expect(store.resolve('111', wallNow)).toBe('match-7')
    expect(store.size()).toBe(1)
  })
})

/**
 * Cancelling or re-queueing ends the match attempt the allocation belonged to. The store has no way
 * to learn that from HIVE — the match result callback contract is not published — so the route says
 * it explicitly, and this is the operation it says it with.
 */
describe('match allocation invalidation', () => {
  it('drops the assignment for one player and leaves the rest', () => {
    const { store } = fixedClockStore()
    store.record({ playerId: '111', roomId: 'match-1', expiresAtMs: NOW + 60_000 })
    store.record({ playerId: '222', roomId: 'match-2', expiresAtMs: NOW + 60_000 })

    store.invalidate('111')

    expect(store.resolve('111', NOW)).toBe(null)
    expect(store.resolve('222', NOW)).toBe('match-2')
    expect(store.size()).toBe(1)
  })

  it('is a no-op for a player who never had an assignment', () => {
    const { store } = fixedClockStore()
    store.record({ playerId: '111', roomId: 'match-1', expiresAtMs: NOW + 60_000 })

    store.invalidate('999')
    store.invalidate('')

    expect(store.size()).toBe(1)
  })

  it('clears an assignment written under a padded id', () => {
    const { store } = fixedClockStore()
    store.record({ playerId: ' 111 ', roomId: 'match-1', expiresAtMs: NOW + 60_000 })

    store.invalidate('111')

    expect(store.resolve('111', NOW)).toBe(null)
    expect(store.size()).toBe(0)
  })
})

/**
 * The writer of this store is a HIVE callback contract that does not exist yet, so what it will
 * hand over is not knowable from here — only what is signable. A room id that `issueRoomToken`
 * would throw on has to be refused at the write, where the caller can still be told, rather than
 * become a 500 in some player's browser when they ask for a capability a minute later.
 */
describe('match allocation write boundary', () => {
  const ROOM_ID_REFUSALS: [string, unknown][] = [
    ['empty', ''],
    ['whitespace only', '   '],
    ['a space inside', 'match 7'],
    ['a path separator', 'match/7'],
    ['a leading separator', '-match-7'],
    ['a wildcard', 'match-*'],
    ['split over two lines', 'match\n7'],
    ['carrying a null byte', 'match-7\u0000'],
    ['longer than the id ceiling', `m${'7'.repeat(64)}`],
    ['not a string', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', { toString: () => 'match-7' }],
  ]

  it.each(ROOM_ID_REFUSALS)('refuses a room id that is %s', (_label, roomId) => {
    const { store } = fixedClockStore()

    expect(store.record({ playerId: '111', roomId, expiresAtMs: NOW + 60_000 } as never))
      .toEqual({ ok: false, reason: 'invalid-room-id' })
    expect(store.resolve('111', NOW)).toBe(null)
    expect(store.size()).toBe(0)
  })

  it.each([
    ['empty', ''],
    ['a space inside', 'player 111'],
    ['not a string', 111],
    ['longer than the id ceiling', '1'.repeat(65)],
  ])('refuses a player id that is %s', (_label, playerId) => {
    const { store } = fixedClockStore()

    expect(store.record({ playerId, roomId: 'match-7', expiresAtMs: NOW + 60_000 } as never))
      .toEqual({ ok: false, reason: 'invalid-player-id' })
    expect(store.size()).toBe(0)
  })

  it.each([
    ['not a number', '60000'],
    ['fractional', NOW + 0.5],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['beyond safe integers', Number.MAX_SAFE_INTEGER + 2],
  ])('refuses an expiry that is %s', (_label, expiresAtMs) => {
    const { store } = fixedClockStore()

    expect(store.record({ playerId: '111', roomId: 'match-7', expiresAtMs } as never))
      .toEqual({ ok: false, reason: 'invalid-expiry' })
    expect(store.size()).toBe(0)
  })

  it('accepts the identifier shapes the room token itself accepts', () => {
    const { store } = fixedClockStore()
    const roomId = `${'a'.repeat(30)}_1.2:3-4`

    expect(store.record({ playerId: '1234567890123456789', roomId, expiresAtMs: NOW + 60_000 }))
      .toEqual({ ok: true })
    expect(store.resolve('1234567890123456789', NOW)).toBe(roomId)
  })

  it('stores the canonical id, so a padded write reads back as the id it names', () => {
    const { store } = fixedClockStore()

    expect(store.record({ playerId: ' 111 ', roomId: '  match-7\t', expiresAtMs: NOW + 60_000 }))
      .toEqual({ ok: true })
    expect(store.resolve('111', NOW)).toBe('match-7')
  })

  it('leaves a good assignment in place when a later bad one is refused', () => {
    const { store } = fixedClockStore()
    store.record({ playerId: '111', roomId: 'match-7', expiresAtMs: NOW + 60_000 })

    expect(store.record({ playerId: '111', roomId: 'match 8', expiresAtMs: NOW + 60_000 }))
      .toEqual({ ok: false, reason: 'invalid-room-id' })
    expect(store.resolve('111', NOW)).toBe('match-7')
  })
})
