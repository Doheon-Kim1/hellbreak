import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_TTL_MS,
  HIVE_SESSION_COOKIE,
  clearedSessionCookie,
  issueBrowserSession,
  readBrowserSession,
  readCookie,
  serializeSessionCookie,
} from './session'
import { ROOM_TOKEN_AUDIENCE } from './sign-room-token'
import { signEnvelope } from './signed-envelope'

const SECRET = 'room-token-secret-that-is-long-enough-0123456789'
const NOW = 1_700_000_000_000
const IDENTITY = { playerId: '1234567890123', deviceId: 'did-9f8e7d' }

function cookieHeader(value: string): string {
  return `theme=dark; ${HIVE_SESSION_COOKIE}=${value}; other=1`
}

describe('HIVE browser session cookie', () => {
  it('round-trips the verified identity', () => {
    const session = issueBrowserSession({ identity: IDENTITY, nowMs: NOW, secret: SECRET })

    expect(session.expiresAtMs).toBe(NOW + DEFAULT_SESSION_TTL_MS)
    expect(readBrowserSession(cookieHeader(session.value), { secret: SECRET, nowMs: NOW + 1_000 }))
      .toEqual({ ok: true, identity: IDENTITY, expiresAtMs: session.expiresAtMs })
  })

  it('never carries the HIVE access token', () => {
    const session = issueBrowserSession({ identity: IDENTITY, nowMs: NOW, secret: SECRET })
    const [, payload] = session.value.split('.')

    expect(Object.keys(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).sort())
      .toEqual(['did', 'exp', 'sub', 'v'])
  })

  it.each([
    ['absent', null, 'absent'],
    ['unrelated cookies', 'theme=dark', 'absent'],
    ['garbage value', cookieHeader('not-a-token'), 'invalid'],
    ['foreign secret', cookieHeader(
      issueBrowserSession({ identity: IDENTITY, nowMs: NOW, secret: `${SECRET}x` }).value,
    ), 'invalid'],
  ])('refuses a session that is %s', (_label, header, reason) => {
    expect(readBrowserSession(header, { secret: SECRET, nowMs: NOW })).toEqual({ ok: false, reason })
  })

  // A room join capability must not double as a browser session, and vice versa.
  it('refuses a token minted for the room audience', () => {
    const foreign = signEnvelope(
      { v: 1, sub: IDENTITY.playerId, did: IDENTITY.deviceId, exp: NOW + 60_000 },
      { secret: SECRET, audience: ROOM_TOKEN_AUDIENCE },
    )

    expect(readBrowserSession(cookieHeader(foreign), { secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: 'invalid' })
  })

  it('expires exactly at its stated expiry', () => {
    const session = issueBrowserSession({ identity: IDENTITY, nowMs: NOW, secret: SECRET, ttlMs: 1_000 })

    expect(readBrowserSession(cookieHeader(session.value), { secret: SECRET, nowMs: NOW + 999 }).ok).toBe(true)
    expect(readBrowserSession(cookieHeader(session.value), { secret: SECRET, nowMs: NOW + 1_000 }))
      .toEqual({ ok: false, reason: 'expired' })
  })

  it.each([
    ['non-numeric identity', { v: 1, sub: 'root', did: 'did-1', exp: NOW + 1_000 }],
    ['hostile device id', { v: 1, sub: '12', did: 'a b', exp: NOW + 1_000 }],
    ['missing expiry', { v: 1, sub: '12', did: 'did-1' }],
    ['unknown version', { v: 9, sub: '12', did: 'did-1', exp: NOW + 1_000 }],
  ])('refuses correctly signed but malformed session claims (%s)', (_label, claims) => {
    const forged = signEnvelope(claims, { secret: SECRET, audience: 'hellbreak.session.v1' })

    expect(readBrowserSession(cookieHeader(forged), { secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: 'invalid' })
  })

  it('ignores an oversized cookie header instead of scanning it', () => {
    expect(readCookie(`${'a'.repeat(9_000)}; ${HIVE_SESSION_COOKIE}=x`, HIVE_SESSION_COOKIE)).toBe(null)
  })

  it('serializes a cookie the browser cannot read or send cross-site', () => {
    const serialized = serializeSessionCookie('value', { maxAgeSeconds: 1_800, secure: true })

    expect(serialized).toBe(
      `${HIVE_SESSION_COOKIE}=value; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=1800`,
    )
    expect(serializeSessionCookie('value', { maxAgeSeconds: 1_800, secure: false }))
      .not.toContain('Secure')
    expect(clearedSessionCookie({ secure: true })).toContain('Max-Age=0')
  })
})
