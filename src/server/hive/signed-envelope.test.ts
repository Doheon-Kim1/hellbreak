import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_ENVELOPE_BYTES,
  createNonce,
  signEnvelope,
  verifyEnvelope,
} from './signed-envelope'

const SECRET = 'test-secret-value-that-is-long-enough-0123456789'
const OTHER_SECRET = 'other-secret-value-that-is-long-enough-9876543'

describe('signed envelope', () => {
  it('round-trips a payload under the same audience and secret', () => {
    const token = signEnvelope({ sub: 'player-1', n: 7 }, { secret: SECRET, audience: 'room' })
    const verified = verifyEnvelope(token, { secret: SECRET, audience: 'room' })

    expect(verified).toEqual({ ok: true, payload: { sub: 'player-1', n: 7 } })
  })

  it('never puts the secret or the raw signature material in the token payload segment', () => {
    const token = signEnvelope({ sub: 'player-1' }, { secret: SECRET, audience: 'room' })

    expect(token).not.toContain(SECRET)
    const [, payload] = token.split('.')
    expect(Buffer.from(payload, 'base64url').toString('utf8')).toBe('{"sub":"player-1"}')
  })

  it('rejects a token signed with a different secret', () => {
    const token = signEnvelope({ sub: 'player-1' }, { secret: OTHER_SECRET, audience: 'room' })

    expect(verifyEnvelope(token, { secret: SECRET, audience: 'room' }))
      .toEqual({ ok: false, reason: 'bad-signature' })
  })

  // Domain separation: a session cookie must never be replayable as a room join capability.
  it('rejects a token signed for a different audience', () => {
    const token = signEnvelope({ sub: 'player-1' }, { secret: SECRET, audience: 'session' })

    expect(verifyEnvelope(token, { secret: SECRET, audience: 'room' }))
      .toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects a tampered payload segment', () => {
    const token = signEnvelope({ sub: 'player-1' }, { secret: SECRET, audience: 'room' })
    const [version, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'player-2' }), 'utf8').toString('base64url')

    expect(verifyEnvelope(`${version}.${forged}.${signature}`, { secret: SECRET, audience: 'room' }))
      .toEqual({ ok: false, reason: 'bad-signature' })
  })

  it.each([
    ['empty', ''],
    ['no separators', 'h1'],
    ['too few segments', 'h1.abc'],
    ['too many segments', 'h1.abc.def.ghi'],
    ['empty payload segment', 'h1..abc'],
    ['empty signature segment', 'h1.abc.'],
    ['non-base64url payload', 'h1.****.abc'],
  ])('rejects a malformed token (%s)', (_label, token) => {
    expect(verifyEnvelope(token, { secret: SECRET, audience: 'room' }).ok).toBe(false)
  })

  it('rejects an unsupported version prefix before doing any signature work', () => {
    const token = signEnvelope({ sub: 'player-1' }, { secret: SECRET, audience: 'room' })
    const [, payload, signature] = token.split('.')

    expect(verifyEnvelope(`h9.${payload}.${signature}`, { secret: SECRET, audience: 'room' }))
      .toEqual({ ok: false, reason: 'unsupported-version' })
  })

  // An unbounded token would let an anonymous caller pay for arbitrary HMAC work.
  it('rejects an oversized token without hashing it', () => {
    const token = `h1.${'a'.repeat(MAX_ENVELOPE_BYTES)}.${'b'.repeat(64)}`

    expect(verifyEnvelope(token, { secret: SECRET, audience: 'room' }))
      .toEqual({ ok: false, reason: 'oversized' })
  })

  it('honours a caller-supplied byte ceiling', () => {
    const token = signEnvelope({ sub: 'player-1' }, { secret: SECRET, audience: 'room' })

    expect(verifyEnvelope(token, { secret: SECRET, audience: 'room', maxBytes: 8 }))
      .toEqual({ ok: false, reason: 'oversized' })
  })

  it('rejects a signature of the wrong length instead of throwing', () => {
    const token = signEnvelope({ sub: 'player-1' }, { secret: SECRET, audience: 'room' })
    const [version, payload] = token.split('.')

    expect(verifyEnvelope(`${version}.${payload}.AAAA`, { secret: SECRET, audience: 'room' }))
      .toEqual({ ok: false, reason: 'bad-signature' })
  })

  // A holder of the signing key still cannot smuggle a non-object claim set past the parser.
  it.each([
    ['a bare string', '"just-a-string"'],
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['broken json', '{"sub":'],
  ])('rejects a correctly signed payload that is not a JSON object (%s)', (_label, json) => {
    const forged = signRawSegment(Buffer.from(json, 'utf8').toString('base64url'))

    expect(verifyEnvelope(forged, { secret: SECRET, audience: 'room' }))
      .toEqual({ ok: false, reason: 'bad-payload' })
  })

  it('emits nonces that are unique, url-safe, and bounded', () => {
    const nonces = new Set(Array.from({ length: 64 }, () => createNonce()))

    expect(nonces.size).toBe(64)
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/)
    }
  })
})

/** Signs an arbitrary already-encoded payload segment, which the public API deliberately forbids. */
function signRawSegment(payloadSegment: string): string {
  const [version] = signEnvelope({}, { secret: SECRET, audience: 'room' }).split('.')
  const signature = createHmac('sha256', Buffer.from(SECRET, 'utf8'))
    .update(`${version}.room.${payloadSegment}`)
    .digest('base64url')
  return `${version}.${payloadSegment}.${signature}`
}
