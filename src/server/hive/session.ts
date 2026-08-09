import { isHiveDeviceId, isHivePlayerId } from './contracts'
import type { HiveIdentity } from './contracts'
import { signEnvelope, verifyEnvelope } from './signed-envelope'

/**
 * The browser's handle on a HIVE-verified identity.
 *
 * It is a signed, short-lived, HttpOnly cookie rather than a server-side session table, because the
 * Next.js host is stateless and the only fact it needs to carry between requests is "HIVE confirmed
 * this PlayerID a few minutes ago".
 *
 * The HIVE access token is *not* in it. It is used once, at verification time, and dropped.
 *
 * The audience differs from the room token's, so a session cookie can never be presented to the
 * Colyseus room as a join capability even though both are signed with the same secret.
 */

export const HIVE_SESSION_COOKIE = 'hellbreak_hive_session'
export const HIVE_SESSION_AUDIENCE = 'hellbreak.session.v1'
export const DEFAULT_SESSION_TTL_MS = 30 * 60_000
export const SESSION_CLAIM_VERSION = 1

export type SessionFailure = 'absent' | 'invalid' | 'expired'

export type SessionRead =
  | { ok: true; identity: HiveIdentity; expiresAtMs: number }
  | { ok: false; reason: SessionFailure }

export function issueBrowserSession(input: {
  identity: HiveIdentity
  nowMs: number
  secret: string
  ttlMs?: number
}): { value: string; expiresAtMs: number } {
  const expiresAtMs = input.nowMs + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS)
  return {
    expiresAtMs,
    value: signEnvelope({
      v: SESSION_CLAIM_VERSION,
      sub: input.identity.playerId,
      did: input.identity.deviceId,
      exp: expiresAtMs,
    }, { secret: input.secret, audience: HIVE_SESSION_AUDIENCE }),
  }
}

/** Reads one named cookie out of a raw header without trusting its shape. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header || header.length > 8_192) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return null
}

export function readBrowserSession(
  cookieHeader: string | null,
  options: { secret: string; nowMs: number },
): SessionRead {
  const value = readCookie(cookieHeader, HIVE_SESSION_COOKIE)
  if (value === null) return { ok: false, reason: 'absent' }

  const envelope = verifyEnvelope(value, {
    secret: options.secret,
    audience: HIVE_SESSION_AUDIENCE,
  })
  if (!envelope.ok) return { ok: false, reason: 'invalid' }

  const { v, sub, did, exp } = envelope.payload
  if (
    v !== SESSION_CLAIM_VERSION
    || !isHivePlayerId(sub)
    || !isHiveDeviceId(did)
    || typeof exp !== 'number'
    || !Number.isSafeInteger(exp)
  ) return { ok: false, reason: 'invalid' }
  if (exp <= options.nowMs) return { ok: false, reason: 'expired' }

  return { ok: true, identity: { playerId: sub, deviceId: did }, expiresAtMs: exp }
}

/**
 * `HttpOnly` keeps the cookie out of any script, including a compromised third-party bundle.
 * `SameSite=Strict` means a cross-site page cannot make the browser spend the session on
 * matchmaking or on minting a room token.
 */
export function serializeSessionCookie(
  value: string,
  options: { maxAgeSeconds: number; secure: boolean },
): string {
  return [
    `${HIVE_SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    options.secure ? 'Secure' : null,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ].filter(Boolean).join('; ')
}

export function clearedSessionCookie(options: { secure: boolean }): string {
  return serializeSessionCookie('', { maxAgeSeconds: 0, secure: options.secure })
}
