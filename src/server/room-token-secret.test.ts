import { describe, expect, it } from 'vitest'
import { readHiveConfig } from './hive/config'
import { issueRoomToken, verifyRoomToken } from './hive/sign-room-token'
import { readRoomAuthPolicy } from './room-auth'

/**
 * The two hosts never talk to each other, so nothing at runtime would notice if they disagreed
 * about what `ROOM_TOKEN_SECRET` means. A one-character difference — a trailing newline pasted into
 * a dashboard — would leave the room server reporting `authenticatedJoin: true` while every
 * capability the Next.js host mints fails its signature check, which reads to an operator as a bug
 * in the token, not as a bug in the environment.
 *
 * These tests are the only place both readers are exercised against one value.
 */

const SECRET = 'room-token-secret-that-is-long-enough-0123456789'
const NOW = 1_700_000_000_000

const COMPLETE = {
  HIVE_APP_ID: 'com.hellbreak.game',
  HIVE_SERVER_API_KEY: 'hive-server-api-key-value-0123456789',
  HIVE_AUTH_BASE_URL: 'https://sandbox-auth.qpyou.cn',
  HIVE_MATCHMAKING_BASE_URL: 'https://sandbox-api-match.withhive.com',
  HIVE_GAME_INDEX: '1234',
  HIVE_MATCH_ID: '5678',
  NEXT_PUBLIC_APP_ORIGIN: 'https://hellbreak.example',
} as const

/** What each host makes of one deployed value. */
function bothHosts(value: string) {
  const next = readHiveConfig({ ...COMPLETE, ROOM_TOKEN_SECRET: value })
  let room: { ok: true; secret: string | null } | { ok: false; message: string }
  try {
    room = { ok: true, secret: readRoomAuthPolicy({ ROOM_TOKEN_SECRET: value }).roomTokenSecret }
  } catch (error) {
    room = { ok: false, message: (error as Error).message }
  }
  return { next, room }
}

describe('shared signing secret', () => {
  it.each([
    ['the documented shape', SECRET],
    ['exactly the minimum length', 'a'.repeat(32)],
    ['inner whitespace, which is part of the key', 'a pass phrase that is long enough to sign'],
    ['padding characters that are not whitespace', `--${SECRET}--`],
  ])('gives both hosts the same key for %s', (_label, value) => {
    const { next, room } = bothHosts(value)

    expect(next.ok).toBe(true)
    expect(room.ok).toBe(true)
    const signingKey = next.ok ? next.config.roomTokenSecret : null
    const verifyingKey = room.ok ? room.secret : null
    expect(signingKey).toBe(value)
    expect(verifyingKey).toBe(value)

    // The keys are not merely equal strings: one signs what the other verifies.
    const { token } = issueRoomToken({
      playerId: '1234567890123',
      roomId: 'match-7',
      nowMs: NOW,
      secret: signingKey as string,
    })
    expect(verifyRoomToken(token, { secret: verifyingKey as string, nowMs: NOW }))
      .toMatchObject({ ok: true, claims: { roomId: 'match-7' } })
  })

  it.each([
    ['a leading space', ` ${SECRET}`],
    ['a trailing space', `${SECRET} `],
    ['a trailing newline', `${SECRET}\n`],
    ['a trailing carriage return', `${SECRET}\r\n`],
    ['surrounding tabs', `\t${SECRET}\t`],
    ['whitespace only', '                                    '],
    ['nothing but a short value', 'short'],
  ])('refuses %s on both hosts rather than on one', (_label, value) => {
    const { next, room } = bothHosts(value)

    expect(next).toEqual({ ok: false, missing: [], invalid: ['ROOM_TOKEN_SECRET'] })
    expect(room.ok).toBe(false)
  })

  it('says why, without ever echoing the value', () => {
    const secret = `${SECRET}\n`
    const { next, room } = bothHosts(secret)

    expect(JSON.stringify(next)).not.toContain(SECRET)
    expect(room.ok).toBe(false)
    expect(room.ok === false && room.message).toMatch(/whitespace/)
    expect(room.ok === false && room.message).not.toContain(SECRET)
  })

  /**
   * The room server is allowed to have no secret at all — that is the deployed guest demo — and the
   * Next.js host is not, because it cannot sign anything without one. The two answers differ, and
   * both are correct: only a *configured* value has to be read identically.
   */
  it('lets the room server run without a secret while the Next.js host refuses to', () => {
    expect(readRoomAuthPolicy({}).roomTokenSecret).toBe(null)
    expect(readHiveConfig({ ...COMPLETE })).toEqual({
      ok: false,
      missing: ['ROOM_TOKEN_SECRET'],
      invalid: [],
    })
  })
})
