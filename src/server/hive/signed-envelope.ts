import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The one signing primitive the HIVE boundary owns.
 *
 * It exists so the room join capability and the browser session cookie share exactly one audited
 * implementation instead of two hand-rolled ones. It is deliberately not a JWT: nothing here
 * negotiates an algorithm with the caller, so there is no `alg` field to downgrade and no key
 * lookup a token can steer.
 *
 * `audience` is mixed into the MAC input rather than into the payload, so a session cookie and a
 * room token signed with the same secret are not interchangeable even if their claims match.
 */

const VERSION = 'h1'
/** Ceiling before any hashing happens, so an anonymous caller cannot buy unbounded HMAC work. */
export const MAX_ENVELOPE_BYTES = 1_024
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

export type EnvelopeFailure =
  | 'malformed'
  | 'oversized'
  | 'unsupported-version'
  | 'bad-signature'
  | 'bad-payload'

export interface SignedEnvelopeKey {
  secret: string
  audience: string
}

export type EnvelopeVerification =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: EnvelopeFailure }

function macOf(payloadSegment: string, key: SignedEnvelopeKey): Buffer {
  return createHmac('sha256', Buffer.from(key.secret, 'utf8'))
    .update(`${VERSION}.${key.audience}.${payloadSegment}`)
    .digest()
}

export function signEnvelope(payload: Record<string, unknown>, key: SignedEnvelopeKey): string {
  const segment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${VERSION}.${segment}.${macOf(segment, key).toString('base64url')}`
}

export function verifyEnvelope(
  token: string,
  key: SignedEnvelopeKey & { maxBytes?: number },
): EnvelopeVerification {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' }
  if (token.length > Math.min(key.maxBytes ?? MAX_ENVELOPE_BYTES, MAX_ENVELOPE_BYTES)) {
    return { ok: false, reason: 'oversized' }
  }

  const segments = token.split('.')
  if (segments.length !== 3) return { ok: false, reason: 'malformed' }
  const [version, payloadSegment, signatureSegment] = segments
  if (!SEGMENT_PATTERN.test(payloadSegment) || !SEGMENT_PATTERN.test(signatureSegment)) {
    return { ok: false, reason: 'malformed' }
  }
  if (version !== VERSION) return { ok: false, reason: 'unsupported-version' }

  const expected = macOf(payloadSegment, key)
  const presented = Buffer.from(signatureSegment, 'base64url')
  // A length mismatch has to short-circuit: timingSafeEqual throws on unequal buffer lengths.
  if (presented.length !== expected.length) return { ok: false, reason: 'bad-signature' }
  if (!timingSafeEqual(presented, expected)) return { ok: false, reason: 'bad-signature' }

  // Decoding happens only after the MAC check, so untrusted bytes never reach the JSON parser.
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'bad-payload' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'bad-payload' }
  }

  return { ok: true, payload: parsed as Record<string, unknown> }
}

/** 128 bits of randomness as 22 url-safe characters, used as the single-use room token nonce. */
export function createNonce(): string {
  return randomBytes(16).toString('base64url')
}
