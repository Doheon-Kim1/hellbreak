import { createNonce, signEnvelope, verifyEnvelope } from './signed-envelope'
import type { EnvelopeFailure } from './signed-envelope'

/**
 * The short-lived room join capability.
 *
 * The browser never mints one of these and never learns the secret: it asks the Next.js server,
 * which only signs after HIVE has verified the identity and the matchmaker has assigned the room.
 * The Colyseus room then verifies it before granting a seat, so room ownership is derived from a
 * server-issued capability rather than from anything the client claims.
 *
 * A token binds exactly four things, and every one of them is checked on the room side:
 * identity (`sub`), assigned room (`room`), lifetime (`iat`/`exp`), and a single-use `jti` nonce.
 */

export const ROOM_TOKEN_AUDIENCE = 'hellbreak.room-join.v1'
export const ROOM_TOKEN_CLAIM_VERSION = 1
/** Transport ceiling. Two 64-character ids plus timestamps and a nonce fit with room to spare. */
export const MAX_ROOM_TOKEN_BYTES = 512
export const DEFAULT_ROOM_TOKEN_TTL_MS = 60_000
/** Nothing signed here may outlive five minutes, whoever minted it. */
export const MAX_ROOM_TOKEN_TTL_MS = 300_000
export const DEFAULT_CLOCK_SKEW_MS = 5_000
/** Signing keys shorter than this are a deployment mistake, not a policy choice. */
export const MIN_ROOM_TOKEN_SECRET_LENGTH = 32

/** Ids are opaque to us, so the charset is narrow enough to be safe in logs, paths, and filters. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,43}$/

export interface RoomTokenClaims {
  playerId: string
  roomId: string
  issuedAtMs: number
  expiresAtMs: number
  nonce: string
}

export type RoomTokenFailure =
  | EnvelopeFailure
  | 'bad-claims'
  | 'ttl-too-long'
  | 'not-yet-valid'
  | 'expired'
  | 'wrong-room'

export type RoomTokenVerification =
  | { ok: true; claims: RoomTokenClaims }
  | { ok: false; reason: RoomTokenFailure }

export interface IssueRoomTokenInput {
  playerId: string
  roomId: string
  nowMs: number
  secret: string
  ttlMs?: number
  /** Injectable only so tests can pin a nonce; production always takes the random one. */
  nonce?: string
}

export function isRoomTokenId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export type RoomTokenSecretRefusal = 'missing' | 'padded' | 'too-short'

export type RoomTokenSecretRead =
  | { ok: true; secret: string }
  | { ok: false; reason: RoomTokenSecretRefusal }

const SECRET_REFUSAL_MESSAGES: Record<RoomTokenSecretRefusal, string> = {
  missing: 'ROOM_TOKEN_SECRET must not be empty',
  padded: 'ROOM_TOKEN_SECRET must not begin or end with whitespace, because both hosts sign with '
    + 'exactly the bytes configured',
  'too-short': `ROOM_TOKEN_SECRET must be at least ${MIN_ROOM_TOKEN_SECRET_LENGTH} characters`,
}

/**
 * The single rule both hosts apply to the shared signing key.
 *
 * The Next.js host signs with it and the Colyseus host verifies with it, over different processes
 * and usually different dashboards, and nothing at runtime would notice if they disagreed about
 * what the configured value *is*. So there is one reader, used by both, and it does not normalize:
 * surrounding whitespace is a configuration error rather than something to quietly strip, because
 * stripping on one side is precisely how a deployment ends up reporting that authenticated joins
 * are enabled while every capability it mints fails its signature check.
 *
 * Whitespace *inside* the value is part of the key — a passphrase is a legitimate secret.
 */
export function readRoomTokenSecret(value: unknown): RoomTokenSecretRead {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'missing' }
  if (value !== value.trim()) return { ok: false, reason: 'padded' }
  if (value.length < MIN_ROOM_TOKEN_SECRET_LENGTH) return { ok: false, reason: 'too-short' }
  return { ok: true, secret: value }
}

/** Explains a refusal by name. The configured value is never part of the message. */
export function describeRoomTokenSecretRefusal(reason: RoomTokenSecretRefusal): string {
  return SECRET_REFUSAL_MESSAGES[reason]
}

function isWholeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function issueRoomToken(input: IssueRoomTokenInput): { token: string; claims: RoomTokenClaims } {
  const ttlMs = input.ttlMs ?? DEFAULT_ROOM_TOKEN_TTL_MS
  if (!isRoomTokenId(input.playerId)) throw new RangeError('room token requires a valid player id')
  if (!isRoomTokenId(input.roomId)) throw new RangeError('room token requires a valid room id')
  if (!isWholeTimestamp(input.nowMs)) throw new RangeError('room token requires a whole millisecond clock')
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_ROOM_TOKEN_TTL_MS) {
    throw new RangeError('room token lifetime is outside the allowed window')
  }
  if (typeof input.secret !== 'string' || input.secret.length < MIN_ROOM_TOKEN_SECRET_LENGTH) {
    throw new RangeError('room token secret is too short to sign with')
  }

  const claims: RoomTokenClaims = {
    playerId: input.playerId,
    roomId: input.roomId,
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + ttlMs,
    nonce: input.nonce ?? createNonce(),
  }

  return {
    claims,
    token: signEnvelope({
      v: ROOM_TOKEN_CLAIM_VERSION,
      sub: claims.playerId,
      room: claims.roomId,
      iat: claims.issuedAtMs,
      exp: claims.expiresAtMs,
      jti: claims.nonce,
    }, { secret: input.secret, audience: ROOM_TOKEN_AUDIENCE }),
  }
}

export interface VerifyRoomTokenOptions {
  secret: string
  nowMs: number
  /** When present, the token must have been minted for this room and no other. */
  expectedRoomId?: string
  clockSkewMs?: number
}

export function verifyRoomToken(token: string, options: VerifyRoomTokenOptions): RoomTokenVerification {
  const envelope = verifyEnvelope(token, {
    secret: options.secret,
    audience: ROOM_TOKEN_AUDIENCE,
    maxBytes: MAX_ROOM_TOKEN_BYTES,
  })
  if (!envelope.ok) return { ok: false, reason: envelope.reason }

  const { v, sub, room, iat, exp, jti } = envelope.payload
  if (
    v !== ROOM_TOKEN_CLAIM_VERSION
    || !isRoomTokenId(sub)
    || !isRoomTokenId(room)
    || !isWholeTimestamp(iat)
    || !isWholeTimestamp(exp)
    || typeof jti !== 'string'
    || !NONCE_PATTERN.test(jti)
    || exp <= iat
  ) return { ok: false, reason: 'bad-claims' }

  // A valid signature does not make a decade-long capability acceptable.
  if (exp - iat > MAX_ROOM_TOKEN_TTL_MS) return { ok: false, reason: 'ttl-too-long' }

  const skewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS
  if (options.nowMs + skewMs < iat) return { ok: false, reason: 'not-yet-valid' }
  if (options.nowMs - skewMs >= exp) return { ok: false, reason: 'expired' }

  if (options.expectedRoomId !== undefined && options.expectedRoomId !== room) {
    return { ok: false, reason: 'wrong-room' }
  }

  return {
    ok: true,
    claims: { playerId: sub, roomId: room, issuedAtMs: iat, expiresAtMs: exp, nonce: jti },
  }
}
