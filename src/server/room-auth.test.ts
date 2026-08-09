import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PENDING_SEAT_MS,
  ROOM_AUTH_ERROR_CODE,
  authorizeRoomJoin,
  bindRoomToMatch,
  createReplayGuard,
  createSeatLedger,
  readRoomAuthPolicy,
} from './room-auth'
import type { RoomAuthPolicy } from './room-auth'
import { issueRoomToken } from './hive/sign-room-token'

const SECRET = 'room-token-secret-that-is-long-enough-0123456789'
const NOW = 1_700_000_000_000

const AUTHENTICATED_POLICY: RoomAuthPolicy = {
  guestJoin: false,
  roomTokenSecret: SECRET,
  clockSkewMs: 0,
}

function mint(overrides: Partial<Parameters<typeof issueRoomToken>[0]> = {}) {
  return issueRoomToken({
    playerId: 'hive-player-42',
    roomId: 'match-7',
    nowMs: NOW,
    ttlMs: 60_000,
    secret: SECRET,
    ...overrides,
  })
}

/** A guard whose only nonce slot is already taken, so the next `consume` refuses. */
function spentGuard() {
  const guard = createReplayGuard({ maxEntries: 1 })
  guard.consume('already-here', NOW + 600_000, NOW)
  return guard
}

function authorize(
  options: unknown,
  overrides: Partial<Parameters<typeof authorizeRoomJoin>[1]> = {},
) {
  return authorizeRoomJoin(options, {
    policy: AUTHENTICATED_POLICY,
    guard: createReplayGuard(),
    assignedRoomId: null,
    sessionId: 'session-a',
    seats: createSeatLedger(),
    nowMs: NOW,
    ...overrides,
  })
}

describe('room join policy', () => {
  it('defaults to the deployed guest demo posture and reads an explicit deny', () => {
    expect(readRoomAuthPolicy({})).toEqual({
      guestJoin: true,
      roomTokenSecret: null,
      clockSkewMs: 5_000,
    })
    expect(readRoomAuthPolicy({ HELLBREAK_GUEST_JOIN: 'deny' }).guestJoin).toBe(false)
    expect(readRoomAuthPolicy({ HELLBREAK_GUEST_JOIN: 'allow' }).guestJoin).toBe(true)
    expect(readRoomAuthPolicy({ ROOM_TOKEN_SECRET: SECRET }).roomTokenSecret).toBe(SECRET)
    expect(readRoomAuthPolicy({ ROOM_TOKEN_CLOCK_SKEW_MS: '250' }).clockSkewMs).toBe(250)
  })

  // A half-configured secret must stop the process, never silently downgrade to guest joins.
  it.each([
    ['too short', { ROOM_TOKEN_SECRET: 'short' }],
    ['blank', { ROOM_TOKEN_SECRET: '   ' }],
    ['empty', { ROOM_TOKEN_SECRET: '' }],
    ['padded with a leading space', { ROOM_TOKEN_SECRET: ` ${SECRET}` }],
    ['padded with a trailing newline', { ROOM_TOKEN_SECRET: `${SECRET}\n` }],
    ['non-numeric skew', { ROOM_TOKEN_CLOCK_SKEW_MS: 'soon' }],
    ['negative skew', { ROOM_TOKEN_CLOCK_SKEW_MS: '-1' }],
    ['unknown guest policy', { HELLBREAK_GUEST_JOIN: 'maybe' }],
  ])('refuses to start on a misconfigured room policy (%s)', (_label, env) => {
    expect(() => readRoomAuthPolicy(env)).toThrow(RangeError)
  })

  /**
   * Padding is refused rather than trimmed because the Next.js host signs with the exact bytes it
   * was configured with. A room server that quietly trimmed would report `authenticatedJoin: true`
   * and then reject every capability that host ever minted.
   */
  it('never trims the configured secret into a different key', () => {
    expect(() => readRoomAuthPolicy({ ROOM_TOKEN_SECRET: ` ${SECRET} ` }))
      .toThrow(/whitespace/)
    expect(readRoomAuthPolicy({ ROOM_TOKEN_SECRET: SECRET }).roomTokenSecret).toBe(SECRET)
  })

  it('never echoes the configured secret in its error message', () => {
    expect(() => readRoomAuthPolicy({ ROOM_TOKEN_SECRET: 'short-but-secret' }))
      .toThrow(/^(?!.*short-but-secret).*$/)
  })
})

describe('guest joins', () => {
  it('seats a tokenless client when the environment allows guest play', () => {
    const guest = authorize(undefined, {
      policy: { guestJoin: true, roomTokenSecret: null, clockSkewMs: 0 },
    })

    expect(guest).toEqual({ ok: true, mode: 'guest', identity: null, assignedRoomId: null })
  })

  it('refuses a tokenless client when guest play is switched off', () => {
    expect(authorize({})).toEqual({
      ok: false,
      code: ROOM_AUTH_ERROR_CODE,
      reason: 'guest-join-disabled',
    })
  })

  it('refuses a tokenless client on a room already claimed by an authenticated match', () => {
    const rejected = authorize({}, {
      policy: { guestJoin: true, roomTokenSecret: SECRET, clockSkewMs: 0 },
      assignedRoomId: 'match-7',
    })

    expect(rejected).toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'token-required' })
  })

  it('ignores identity, room, and mode fields a guest tries to smuggle in', () => {
    const guest = authorize({
      playerId: 'admin',
      identity: 'admin',
      assignedRoomId: 'match-7',
      mode: 'authenticated',
    }, { policy: { guestJoin: true, roomTokenSecret: null, clockSkewMs: 0 } })

    expect(guest).toEqual({ ok: true, mode: 'guest', identity: null, assignedRoomId: null })
  })
})

describe('authenticated joins', () => {
  it('accepts a valid token and pins the room to the assigned match', () => {
    const { token, claims } = mint()

    expect(authorize({ roomToken: token })).toEqual({
      ok: true,
      mode: 'authenticated',
      identity: claims.playerId,
      assignedRoomId: 'match-7',
    })
  })

  it('accepts a second identity into the room it was assigned to', () => {
    const guard = createReplayGuard()
    const seats = createSeatLedger()
    const first = mint()
    const second = mint({ playerId: 'hive-player-99' })

    expect(authorize({ roomToken: first.token }, { guard, seats, assignedRoomId: 'match-7' }).ok)
      .toBe(true)
    expect(authorize({ roomToken: second.token }, {
      guard,
      seats,
      sessionId: 'session-b',
      assignedRoomId: 'match-7',
    })).toEqual({
      ok: true,
      mode: 'authenticated',
      identity: 'hive-player-99',
      assignedRoomId: 'match-7',
    })
  })

  it('rejects a token minted for another room', () => {
    const { token } = mint()

    expect(authorize({ roomToken: token }, { assignedRoomId: 'match-8' }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'wrong-room' })
  })

  it('rejects an expired token', () => {
    const { token } = mint()

    expect(authorize({ roomToken: token }, { nowMs: NOW + 60_001 }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'expired-token' })
  })

  it('rejects a token that has not started yet', () => {
    const { token } = mint()

    expect(authorize({ roomToken: token }, { nowMs: NOW - 60_000 }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'expired-token' })
  })

  it('rejects a token signed by anything other than the room secret', () => {
    const { token } = mint({ secret: `${SECRET}-forged` })

    expect(authorize({ roomToken: token }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'invalid-token' })
  })

  it.each([
    ['truncated', (token: string) => token.slice(0, -4)],
    ['payload swapped', (token: string) => {
      const [version, , signature] = token.split('.')
      const forged = Buffer.from(JSON.stringify({ v: 1, sub: 'root', room: 'match-7' }), 'utf8')
        .toString('base64url')
      return `${version}.${forged}.${signature}`
    }],
    ['oversized', () => 'h1.'.padEnd(4_096, 'a')],
  ])('rejects a malformed token (%s)', (_label, mutate) => {
    const { token } = mint()

    expect(authorize({ roomToken: mutate(token) }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'invalid-token' })
  })

  it.each([
    ['non-string token', { roomToken: 42 }],
    ['object token', { roomToken: { token: 'x' } }],
    ['null token', { roomToken: null }],
    ['empty token', { roomToken: '' }],
  ])('rejects malformed join options (%s)', (_label, options) => {
    expect(authorize(options))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'malformed-options' })
  })

  it('rejects every token when no room secret is configured, rather than trusting it', () => {
    const { token } = mint()

    expect(authorize({ roomToken: token }, {
      policy: { guestJoin: true, roomTokenSecret: null, clockSkewMs: 0 },
    })).toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'token-unsupported' })
  })

  it('rejects a replayed token even though its signature and expiry are still valid', () => {
    const guard = createReplayGuard()
    const { token } = mint()

    expect(authorize({ roomToken: token }, { guard }).ok).toBe(true)
    expect(authorize({ roomToken: token }, { guard, nowMs: NOW + 1_000 }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'replayed-token' })
  })

  /**
   * Clock skew tolerance has to mean the same thing to both layers. A token presented just past its
   * `exp`, but inside the skew this deployment allows, is a first use and must be seated — and the
   * ledger must still refuse it a second time, so the grace window never becomes a replay window.
   */
  it('seats a first use inside the skew window and still refuses the replay of it', () => {
    const policy: RoomAuthPolicy = { ...AUTHENTICATED_POLICY, clockSkewMs: 5_000 }
    const guard = createReplayGuard()
    const { token } = mint()
    const insideSkew = NOW + 60_000 + 2_000

    expect(authorize({ roomToken: token }, { guard, policy, nowMs: insideSkew }).ok).toBe(true)
    expect(authorize({ roomToken: token }, { guard, policy, nowMs: insideSkew + 1 }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'replayed-token' })
    // Past the window the capability is expired, and the ledger no longer has to carry the nonce.
    expect(authorize({ roomToken: token }, { guard, policy, nowMs: NOW + 65_001 }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'expired-token' })
  })

  it('rejects a freshly minted token for an identity that already holds a seat', () => {
    const seats = createSeatLedger()
    // Seated the only way a seat is ever reached: reserved in `onAuth`, promoted in `onJoin`.
    seats.reserve('session-seated', 'hive-player-42', NOW)
    seats.seat('session-seated', 'hive-player-42', NOW)
    const { token } = mint()

    expect(authorize({ roomToken: token }, {
      assignedRoomId: 'match-7',
      sessionId: 'session-b',
      seats,
    })).toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'identity-already-seated' })
  })

  it('does not spend a nonce on a token it rejects for another reason', () => {
    const guard = createReplayGuard()
    const { token } = mint()

    expect(authorize({ roomToken: token }, { guard, assignedRoomId: 'match-8' }).ok).toBe(false)
    expect(guard.size()).toBe(0)
    expect(authorize({ roomToken: token }, { guard }).ok).toBe(true)
  })
})

/**
 * Colyseus decides a seat in `onAuth` and grants it in `onJoin`, and it awaits the first before
 * calling the second. Anything that claims an identity in `onJoin` is therefore checking state that
 * a second connection can still pass in the gap, however narrow that gap happens to be today.
 *
 * These cases are that gap, held open: every one of them authorizes without ever seating.
 */
describe('one seat per identity across the auth/join gap', () => {
  it('refuses a second connection that authorizes before the first one has joined', () => {
    const seats = createSeatLedger()
    const guard = createReplayGuard()
    // Two capabilities, separately minted and individually valid, for the same player.
    const first = mint()
    const second = mint()
    expect(first.token).not.toBe(second.token)

    const a = authorize({ roomToken: first.token }, { guard, seats, sessionId: 'session-a' })
    const b = authorize({ roomToken: second.token }, { guard, seats, sessionId: 'session-b' })

    expect(a.ok).toBe(true)
    expect(b).toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'identity-already-seated' })
    expect(seats.size(NOW)).toBe(1)
  })

  it('holds the claim for the whole reservation window, not for one instant', () => {
    const seats = createSeatLedger()
    const guard = createReplayGuard()

    expect(authorize({ roomToken: mint().token }, { guard, seats, sessionId: 'session-a' }).ok)
      .toBe(true)
    // Still unseated, one millisecond before the reservation lapses.
    expect(authorize({ roomToken: mint().token }, {
      guard,
      seats,
      sessionId: 'session-b',
      nowMs: NOW + DEFAULT_PENDING_SEAT_MS - 1,
    })).toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'identity-already-seated' })
  })

  /**
   * The reason the claim expires at all: Colyseus skips `onLeave` for a connection that never
   * entered the room, so a client that dies between the two callbacks leaves a claim nobody will
   * release. An unbounded claim would lock that player out of their own match.
   */
  it('frees an identity whose connection never arrived to take the seat', () => {
    const seats = createSeatLedger()
    const guard = createReplayGuard()
    const stale = NOW + DEFAULT_PENDING_SEAT_MS

    expect(authorize({ roomToken: mint().token }, { guard, seats, sessionId: 'session-a' }).ok)
      .toBe(true)
    expect(seats.size(stale)).toBe(0)
    expect(authorize({ roomToken: mint({ nowMs: stale }).token }, {
      guard,
      seats,
      sessionId: 'session-b',
      nowMs: stale,
    }).ok).toBe(true)

    // The bound has to hold in the other direction too, or freeing the identity would just mean
    // handing out two seats: a connection that turns up after its window closed gets nothing.
    expect(seats.seat('session-a', 'hive-player-42', stale)).toBe(false)
    expect(seats.size(stale)).toBe(1)
  })

  it('never claims an identity on a join it refuses', () => {
    const seats = createSeatLedger()
    const guard = createReplayGuard()
    const { token } = mint()

    // Wrong room, forged signature, expiry, and replay: every refusal path after a readable token.
    expect(authorize({ roomToken: token }, { seats, assignedRoomId: 'match-8' }).ok).toBe(false)
    expect(authorize({ roomToken: mint({ secret: `${SECRET}-forged` }).token }, { seats }).ok)
      .toBe(false)
    expect(authorize({ roomToken: token }, { seats, nowMs: NOW + 120_000 }).ok).toBe(false)
    expect(authorize({ roomToken: mint().token }, { guard: spentGuard(), seats }).ok).toBe(false)
    expect(seats.size(NOW)).toBe(0)

    // And the identity is still free afterwards, on the same ledger.
    expect(authorize({ roomToken: token }, { guard, seats }).ok).toBe(true)
  })

  it('keeps a guest room out of the ledger entirely', () => {
    const seats = createSeatLedger()

    expect(authorize(undefined, {
      seats,
      policy: { guestJoin: true, roomTokenSecret: null, clockSkewMs: 0 },
    }).ok).toBe(true)
    expect(seats.size(NOW)).toBe(0)
  })

  it('lets the identity back in once the seat it took is released', () => {
    const seats = createSeatLedger()
    const guard = createReplayGuard()

    expect(authorize({ roomToken: mint().token }, { guard, seats, sessionId: 'session-a' }).ok)
      .toBe(true)
    // `onJoin` promotes the reservation; the seat now outlives the reservation window.
    expect(seats.seat('session-a', 'hive-player-42', NOW)).toBe(true)
    expect(seats.size(NOW + 10 * DEFAULT_PENDING_SEAT_MS)).toBe(1)
    expect(authorize({ roomToken: mint().token }, { guard, seats, sessionId: 'session-b' }).ok)
      .toBe(false)

    // `onLeave` releases it.
    seats.release('session-a')
    expect(authorize({ roomToken: mint().token }, { guard, seats, sessionId: 'session-b' }).ok)
      .toBe(true)
  })
})

describe('seat ledger', () => {
  it('reports an identity as held while it is reserved and after it is seated', () => {
    const seats = createSeatLedger()

    expect(seats.holds('player-1', NOW)).toBe(false)
    expect(seats.reserve('session-a', 'player-1', NOW)).toBe(true)
    expect(seats.holds('player-1', NOW)).toBe(true)
    expect(seats.seat('session-a', 'player-1', NOW)).toBe(true)
    expect(seats.holds('player-1', NOW + 60 * 60_000)).toBe(true)
  })

  it('refuses a reservation and a seat for an identity another session holds', () => {
    const seats = createSeatLedger()
    seats.reserve('session-a', 'player-1', NOW)

    expect(seats.reserve('session-b', 'player-1', NOW)).toBe(false)
    expect(seats.seat('session-b', 'player-1', NOW)).toBe(false)
    expect(seats.size(NOW)).toBe(1)
  })

  it('lets the same session re-take what it already holds', () => {
    const seats = createSeatLedger()

    expect(seats.reserve('session-a', 'player-1', NOW)).toBe(true)
    expect(seats.reserve('session-a', 'player-1', NOW + 1)).toBe(true)
    expect(seats.seat('session-a', 'player-1', NOW + 2)).toBe(true)
    // A seated session is never demoted back to a reservation that could then lapse.
    expect(seats.reserve('session-a', 'player-1', NOW + 3)).toBe(true)
    expect(seats.holds('player-1', NOW + 60 * 60_000)).toBe(true)
  })

  it('drops a reservation that was never promoted, on its own deadline', () => {
    const seats = createSeatLedger({ pendingMs: 1_000 })
    seats.reserve('session-a', 'player-1', NOW)

    expect(seats.holds('player-1', NOW + 999)).toBe(true)
    expect(seats.holds('player-1', NOW + 1_000)).toBe(false)
    expect(seats.size(NOW + 1_000)).toBe(0)
    expect(seats.reserve('session-b', 'player-1', NOW + 1_000)).toBe(true)
  })

  /**
   * The pending window is a bound on authorization, not a hint, and `seat` is the one call standing
   * between a late connection and a claim that never expires again. Creating a seat where the
   * reservation used to be would re-grant exactly the authorization the window just withdrew — and
   * would do it permanently, since a seat has no deadline of its own.
   */
  it('never resurrects a reservation that expired before the seat was taken', () => {
    const seats = createSeatLedger({ pendingMs: 1_000 })
    expect(seats.reserve('session-a', 'player-1', NOW)).toBe(true)
    expect(seats.size(NOW + 1_000)).toBe(0)

    expect(seats.seat('session-a', 'player-1', NOW + 1_000)).toBe(false)
    // Refusing wrote nothing: the identity is free now and stays free long past the window.
    expect(seats.holds('player-1', NOW + 1_000)).toBe(false)
    expect(seats.size(NOW + 1_000)).toBe(0)
    expect(seats.holds('player-1', NOW + 60 * 60_000)).toBe(false)
  })

  it('still promotes a reservation on the last millisecond of its window', () => {
    const seats = createSeatLedger({ pendingMs: 1_000 })
    seats.reserve('session-a', 'player-1', NOW)

    expect(seats.seat('session-a', 'player-1', NOW + 999)).toBe(true)
    // Promoted in time, so the deadline no longer applies to it at all.
    expect(seats.holds('player-1', NOW + 60 * 60_000)).toBe(true)
  })

  it('refuses to seat a session that never reserved anything', () => {
    const seats = createSeatLedger()

    expect(seats.seat('session-ghost', 'player-1', NOW)).toBe(false)
    expect(seats.holds('player-1', NOW)).toBe(false)
    expect(seats.size(NOW)).toBe(0)
  })

  it('refuses to seat an identity other than the one this session reserved', () => {
    const seats = createSeatLedger()
    seats.reserve('session-a', 'player-1', NOW)

    expect(seats.seat('session-a', 'player-2', NOW)).toBe(false)
    // The refusal leaves the real reservation intact and never invents the mismatched one.
    expect(seats.holds('player-2', NOW)).toBe(false)
    expect(seats.holds('player-1', NOW)).toBe(true)
    expect(seats.size(NOW)).toBe(1)
    expect(seats.seat('session-a', 'player-1', NOW)).toBe(true)
  })

  it('refuses to let a session trade the claim it already holds for another identity', () => {
    const reserved = createSeatLedger()
    reserved.reserve('session-a', 'player-1', NOW)

    expect(reserved.reserve('session-a', 'player-2', NOW)).toBe(false)
    expect(reserved.holds('player-2', NOW)).toBe(false)
    expect(reserved.holds('player-1', NOW)).toBe(true)
    expect(reserved.size(NOW)).toBe(1)

    // And the same is true once the claim has become a seat.
    const seated = createSeatLedger()
    seated.reserve('session-a', 'player-1', NOW)
    seated.seat('session-a', 'player-1', NOW)

    expect(seated.reserve('session-a', 'player-2', NOW)).toBe(false)
    expect(seated.seat('session-a', 'player-2', NOW)).toBe(false)
    expect(seated.holds('player-2', NOW)).toBe(false)
    expect(seated.holds('player-1', NOW)).toBe(true)
    expect(seated.size(NOW)).toBe(1)
  })

  it('confirms an existing seat idempotently, long after any window would have closed', () => {
    const seats = createSeatLedger({ pendingMs: 1_000 })
    seats.reserve('session-a', 'player-1', NOW)
    expect(seats.seat('session-a', 'player-1', NOW)).toBe(true)

    const later = NOW + 60 * 60_000
    expect(seats.seat('session-a', 'player-1', later)).toBe(true)
    expect(seats.size(later)).toBe(1)
    // Confirming again never demoted the seat back into something that can lapse.
    expect(seats.holds('player-1', later + 60 * 60_000)).toBe(true)
  })

  /**
   * The two halves of the same failure: the identity a lapsed connection was promised has already
   * gone to the connection that actually arrived, and the lapsed one must not take it back.
   */
  it('refuses a lapsed connection whose identity another session has since claimed', () => {
    const seats = createSeatLedger({ pendingMs: 1_000 })
    seats.reserve('session-a', 'player-1', NOW)
    expect(seats.reserve('session-b', 'player-1', NOW + 1_000)).toBe(true)

    expect(seats.seat('session-a', 'player-1', NOW + 1_000)).toBe(false)
    expect(seats.seat('session-b', 'player-1', NOW + 1_000)).toBe(true)
    expect(seats.size(NOW + 1_000)).toBe(1)
  })

  it('releases by session and clears wholesale', () => {
    const seats = createSeatLedger()
    seats.reserve('session-a', 'player-1', NOW)
    seats.seat('session-a', 'player-1', NOW)
    seats.reserve('session-b', 'player-2', NOW)
    seats.seat('session-b', 'player-2', NOW)

    seats.release('session-a')
    seats.release('session-unknown')
    expect(seats.holds('player-1', NOW)).toBe(false)
    expect(seats.holds('player-2', NOW)).toBe(true)

    seats.clear()
    expect(seats.size(NOW)).toBe(0)
  })
})

describe('binding a new room to a match', () => {
  const bind = (options: unknown, policy: RoomAuthPolicy = AUTHENTICATED_POLICY) =>
    bindRoomToMatch(options, { policy, nowMs: NOW })

  it('creates an unclaimed guest room from a tokenless create', () => {
    expect(bind({}, { guestJoin: true, roomTokenSecret: null, clockSkewMs: 0 }))
      .toEqual({ ok: true, assignedRoomId: null })
  })

  it('refuses a tokenless create when guest play is switched off', () => {
    expect(bind({})).toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'guest-join-disabled' })
  })

  it('claims the room for the match named in the token', () => {
    const { token } = mint()

    expect(bind({ roomToken: token, assignedRoomId: 'match-7' }))
      .toEqual({ ok: true, assignedRoomId: 'match-7' })
  })

  // The matchmaker routes on this field, so a room whose filter key disagrees with its capability
  // would strand every teammate holding a valid token.
  it.each([
    ['a missing routing key', {}],
    ['a routing key for another match', { assignedRoomId: 'match-8' }],
  ])('refuses an authenticated create with %s', (_label, extra) => {
    const { token } = mint()

    expect(bind({ roomToken: token, ...extra }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'wrong-room' })
  })

  it('refuses a guest create that carries a match routing key', () => {
    expect(bind({ assignedRoomId: 'match-7' }, { guestJoin: true, roomTokenSecret: null, clockSkewMs: 0 }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'malformed-options' })
  })

  it('refuses an expired or forged capability', () => {
    const { token } = mint()

    expect(bindRoomToMatch({ roomToken: token, assignedRoomId: 'match-7' }, {
      policy: AUTHENTICATED_POLICY,
      nowMs: NOW + 120_000,
    })).toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'expired-token' })
    expect(bind({ roomToken: mint({ secret: `${SECRET}-forged` }).token, assignedRoomId: 'match-7' }))
      .toEqual({ ok: false, code: ROOM_AUTH_ERROR_CODE, reason: 'invalid-token' })
  })

  // The creator still has to pass the ordinary join check, so its nonce must survive this step.
  it('does not spend the capability it inspects', () => {
    const guard = createReplayGuard()
    const { token } = mint()

    expect(bind({ roomToken: token, assignedRoomId: 'match-7' }).ok).toBe(true)
    expect(authorize({ roomToken: token }, { guard, assignedRoomId: 'match-7' }).ok).toBe(true)
  })
})

describe('replay guard', () => {
  it('accepts a nonce once and refuses it while the token could still be live', () => {
    const guard = createReplayGuard()

    expect(guard.consume('nonce-a', NOW + 60_000, NOW)).toBe(true)
    expect(guard.consume('nonce-a', NOW + 60_000, NOW + 1)).toBe(false)
    expect(guard.consume('nonce-b', NOW + 60_000, NOW)).toBe(true)
  })

  it('refuses a nonce whose token has already expired', () => {
    const guard = createReplayGuard()

    expect(guard.consume('nonce-a', NOW, NOW)).toBe(false)
    expect(guard.size()).toBe(0)
  })

  // Memory is bounded on purpose: an unauthenticated flood must not grow this map forever.
  it('drops entries once their tokens can no longer be replayed', () => {
    const guard = createReplayGuard()

    guard.consume('nonce-a', NOW + 1_000, NOW)
    guard.consume('nonce-b', NOW + 2_000, NOW)
    expect(guard.size()).toBe(2)

    guard.consume('nonce-c', NOW + 60_000, NOW + 5_000)
    expect(guard.size()).toBe(1)
  })

  it('fails closed instead of forgetting a live nonce when the cap is reached', () => {
    const guard = createReplayGuard({ maxEntries: 2 })

    expect(guard.consume('nonce-a', NOW + 60_000, NOW)).toBe(true)
    expect(guard.consume('nonce-b', NOW + 60_000, NOW)).toBe(true)
    expect(guard.consume('nonce-c', NOW + 60_000, NOW)).toBe(false)
    // The oldest live nonce is still refused, so nothing was silently evicted.
    expect(guard.consume('nonce-a', NOW + 60_000, NOW)).toBe(false)
  })
})
