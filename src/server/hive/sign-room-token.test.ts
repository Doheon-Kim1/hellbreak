import { describe, expect, it } from 'vitest'
import {
  MAX_ROOM_TOKEN_BYTES,
  MAX_ROOM_TOKEN_TTL_MS,
  ROOM_TOKEN_AUDIENCE,
  issueRoomToken,
  verifyRoomToken,
} from './sign-room-token'
import { signEnvelope } from './signed-envelope'

const SECRET = 'room-token-secret-that-is-long-enough-0123456789'
const NOW = 1_700_000_000_000

function issue(overrides: Partial<Parameters<typeof issueRoomToken>[0]> = {}) {
  return issueRoomToken({
    playerId: 'hive-player-42',
    roomId: 'match-7',
    nowMs: NOW,
    ttlMs: 60_000,
    secret: SECRET,
    ...overrides,
  })
}

/** Signs arbitrary claims with the real key, which only the claim validator can reject. */
function forge(claims: Record<string, unknown>): string {
  return signEnvelope(claims, { secret: SECRET, audience: ROOM_TOKEN_AUDIENCE })
}

describe('room join token', () => {
  it('binds identity, room, issue time, expiry, and a fresh nonce', () => {
    const first = issue()
    const second = issue()

    expect(first.claims).toEqual({
      playerId: 'hive-player-42',
      roomId: 'match-7',
      issuedAtMs: NOW,
      expiresAtMs: NOW + 60_000,
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    })
    expect(second.claims.nonce).not.toBe(first.claims.nonce)
    expect(second.token).not.toBe(first.token)
  })

  it('stays well inside the transport ceiling for realistic identities', () => {
    const { token } = issue({ playerId: 'a'.repeat(64), roomId: 'b'.repeat(64) })

    expect(token.length).toBeLessThanOrEqual(MAX_ROOM_TOKEN_BYTES)
  })

  it('verifies a fresh token for the room it was minted for', () => {
    const { token, claims } = issue()

    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW + 1_000, expectedRoomId: 'match-7' }))
      .toEqual({ ok: true, claims })
  })

  it('rejects a token presented to a different room', () => {
    const { token } = issue()

    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW, expectedRoomId: 'match-8' }))
      .toEqual({ ok: false, reason: 'wrong-room' })
  })

  it('rejects an expired token, including one that expires exactly now', () => {
    const { token } = issue()

    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW + 59_999, clockSkewMs: 0 }).ok).toBe(true)
    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW + 60_000, clockSkewMs: 0 }))
      .toEqual({ ok: false, reason: 'expired' })
    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW + 60_001, clockSkewMs: 0 }))
      .toEqual({ ok: false, reason: 'expired' })
  })

  it('tolerates bounded clock skew on both sides but not beyond it', () => {
    const { token } = issue()

    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW - 4_000, clockSkewMs: 5_000 }).ok).toBe(true)
    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW + 63_000, clockSkewMs: 5_000 }).ok).toBe(true)
    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW - 6_000, clockSkewMs: 5_000 }))
      .toEqual({ ok: false, reason: 'not-yet-valid' })
    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW + 66_000, clockSkewMs: 5_000 }))
      .toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a token signed with another secret or another audience', () => {
    const { token } = issue()
    const otherAudience = signEnvelope(
      { v: 1, sub: 'hive-player-42', room: 'match-7', iat: NOW, exp: NOW + 60_000, jti: 'AAAAAAAAAAAAAAAAAAAAAA' },
      { secret: SECRET, audience: 'hellbreak.session.v1' },
    )

    expect(verifyRoomToken(token, { secret: `${SECRET}x`, nowMs: NOW }))
      .toEqual({ ok: false, reason: 'bad-signature' })
    expect(verifyRoomToken(otherAudience, { secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: 'bad-signature' })
  })

  it.each([
    ['garbage', 'not-a-token'],
    ['empty', ''],
    ['payload only', 'h1.abc'],
  ])('rejects a malformed token (%s)', (_label, token) => {
    expect(verifyRoomToken(token, { secret: SECRET, nowMs: NOW }).ok).toBe(false)
  })

  it('rejects an oversized token before any signature work', () => {
    expect(verifyRoomToken(`h1.${'a'.repeat(MAX_ROOM_TOKEN_BYTES)}.${'b'.repeat(43)}`, {
      secret: SECRET,
      nowMs: NOW,
    })).toEqual({ ok: false, reason: 'oversized' })
  })

  it.each([
    ['missing subject', { v: 1, room: 'match-7', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['empty subject', { v: 1, sub: '', room: 'match-7', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['non-string subject', { v: 1, sub: 42, room: 'match-7', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['oversized subject', { v: 1, sub: 'a'.repeat(65), room: 'match-7', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['hostile subject charset', { v: 1, sub: 'a b\n', room: 'match-7', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['missing room', { v: 1, sub: 'p', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['hostile room charset', { v: 1, sub: 'p', room: '../other', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['missing nonce', { v: 1, sub: 'p', room: 'match-7', iat: NOW, exp: NOW + 1_000 }],
    ['short nonce', { v: 1, sub: 'p', room: 'match-7', iat: NOW, exp: NOW + 1_000, jti: 'AAA' }],
    ['fractional timestamps', { v: 1, sub: 'p', room: 'match-7', iat: NOW + 0.5, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['non-finite expiry', { v: 1, sub: 'p', room: 'match-7', iat: NOW, exp: Number.POSITIVE_INFINITY, jti: 'A'.repeat(22) }],
    ['negative issue time', { v: 1, sub: 'p', room: 'match-7', iat: -1, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
    ['expiry before issue', { v: 1, sub: 'p', room: 'match-7', iat: NOW, exp: NOW - 1, jti: 'A'.repeat(22) }],
    ['unknown version', { v: 2, sub: 'p', room: 'match-7', iat: NOW, exp: NOW + 1_000, jti: 'A'.repeat(22) }],
  ])('rejects correctly signed but malformed claims (%s)', (_label, claims) => {
    expect(verifyRoomToken(forge(claims), { secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: 'bad-claims' })
  })

  // A stolen long-lived token is the whole reason this capability is short-lived.
  it('rejects a signed token whose own lifetime exceeds the policy ceiling', () => {
    const claims = {
      v: 1,
      sub: 'p',
      room: 'match-7',
      iat: NOW,
      exp: NOW + MAX_ROOM_TOKEN_TTL_MS + 1,
      jti: 'A'.repeat(22),
    }

    expect(verifyRoomToken(forge(claims), { secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: 'ttl-too-long' })
  })

  it.each([
    ['blank identity', { playerId: '' }],
    ['hostile identity', { playerId: 'player 1' }],
    ['blank room', { roomId: '' }],
    ['non-positive ttl', { ttlMs: 0 }],
    ['ttl beyond the ceiling', { ttlMs: MAX_ROOM_TOKEN_TTL_MS + 1 }],
    ['short secret', { secret: 'too-short' }],
  ])('refuses to mint a token from invalid server input (%s)', (_label, overrides) => {
    expect(() => issue(overrides)).toThrow(RangeError)
  })
})
