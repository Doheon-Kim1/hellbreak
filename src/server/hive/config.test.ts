import { describe, expect, it } from 'vitest'
import { HIVE_ENV_KEYS, describeHiveCapability, readHiveConfig } from './config'

const SECRET = 'room-token-secret-that-is-long-enough-0123456789'
const API_KEY = 'hive-server-api-key-value-0123456789'

const COMPLETE = {
  HIVE_APP_ID: 'com.hellbreak.game',
  HIVE_SERVER_API_KEY: API_KEY,
  HIVE_AUTH_BASE_URL: 'https://sandbox-auth.qpyou.cn',
  HIVE_MATCHMAKING_BASE_URL: 'https://sandbox-api-match.withhive.com',
  HIVE_GAME_INDEX: '1234',
  HIVE_MATCH_ID: '5678',
  ROOM_TOKEN_SECRET: SECRET,
  NEXT_PUBLIC_APP_ORIGIN: 'https://hellbreak.example',
} as const

describe('HIVE server configuration', () => {
  it('accepts a complete environment and normalizes the documented shapes', () => {
    const result = readHiveConfig({ ...COMPLETE })

    expect(result).toEqual({
      ok: true,
      config: {
        appId: 'com.hellbreak.game',
        serverApiKey: API_KEY,
        authBaseUrl: 'https://sandbox-auth.qpyou.cn',
        matchmakingBaseUrl: 'https://sandbox-api-match.withhive.com',
        gameIndex: 1234,
        matchId: 5678,
        roomTokenSecret: SECRET,
        appOrigin: 'https://hellbreak.example',
      },
    })
  })

  it('strips a trailing slash so documented paths concatenate exactly once', () => {
    const result = readHiveConfig({ ...COMPLETE, HIVE_AUTH_BASE_URL: 'https://sandbox-auth.qpyou.cn/' })

    expect(result.ok && result.config.authBaseUrl).toBe('https://sandbox-auth.qpyou.cn')
  })

  it('reports every missing key by name when nothing is injected', () => {
    const result = readHiveConfig({})

    expect(result).toEqual({ ok: false, missing: [...HIVE_ENV_KEYS], invalid: [] })
  })

  it.each([
    ['non-https auth base', { HIVE_AUTH_BASE_URL: 'http://auth.example' }, 'HIVE_AUTH_BASE_URL'],
    ['non-url match base', { HIVE_MATCHMAKING_BASE_URL: 'not a url' }, 'HIVE_MATCHMAKING_BASE_URL'],
    ['base url with a path', { HIVE_AUTH_BASE_URL: 'https://auth.example/game' }, 'HIVE_AUTH_BASE_URL'],
    ['short signing secret', { ROOM_TOKEN_SECRET: 'short' }, 'ROOM_TOKEN_SECRET'],
    ['short api key', { HIVE_SERVER_API_KEY: 'k' }, 'HIVE_SERVER_API_KEY'],
    ['non-numeric game index', { HIVE_GAME_INDEX: 'main' }, 'HIVE_GAME_INDEX'],
    ['negative match id', { HIVE_MATCH_ID: '-2' }, 'HIVE_MATCH_ID'],
    ['fractional game index', { HIVE_GAME_INDEX: '1.5' }, 'HIVE_GAME_INDEX'],
    ['non-https origin', { NEXT_PUBLIC_APP_ORIGIN: 'ftp://hellbreak.example' }, 'NEXT_PUBLIC_APP_ORIGIN'],
    ['oversized app id', { HIVE_APP_ID: 'a'.repeat(129) }, 'HIVE_APP_ID'],
  ])('rejects an invalid value by key name only (%s)', (_label, override, key) => {
    const result = readHiveConfig({ ...COMPLETE, ...override })

    expect(result).toEqual({ ok: false, missing: [], invalid: [key] })
  })

  /**
   * The signing key is shared byte-for-byte with the room server. Trimming it here would make one
   * host sign with a different key than the other verifies with, so padding is a configuration
   * error and is reported as one rather than quietly rewritten.
   */
  it.each([
    ['leading space', ` ${SECRET}`],
    ['trailing space', `${SECRET} `],
    ['trailing newline', `${SECRET}\n`],
    ['surrounding tabs', `\t${SECRET}\t`],
    ['whitespace only', '                                    '],
  ])('rejects a signing secret with %s instead of normalizing it', (_label, value) => {
    const result = readHiveConfig({ ...COMPLETE, ROOM_TOKEN_SECRET: value })

    expect(result).toEqual({ ok: false, missing: [], invalid: ['ROOM_TOKEN_SECRET'] })
  })

  it('keeps an accepted signing secret exactly as configured', () => {
    const padded = `${SECRET}  `
    const result = readHiveConfig({ ...COMPLETE })

    expect(result.ok && result.config.roomTokenSecret).toBe(SECRET)
    expect(JSON.stringify(readHiveConfig({ ...COMPLETE, ROOM_TOKEN_SECRET: padded })))
      .not.toContain(SECRET)
  })

  it('allows an http origin and auth base only for local development hosts', () => {
    const local = readHiveConfig({
      ...COMPLETE,
      HIVE_AUTH_BASE_URL: 'http://127.0.0.1:4000',
      NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:5173',
    })

    expect(local.ok).toBe(true)
  })

  it('never leaks a secret value through the failure report', () => {
    const result = readHiveConfig({ ...COMPLETE, HIVE_SERVER_API_KEY: 'k', ROOM_TOKEN_SECRET: 'short' })

    expect(JSON.stringify(result)).not.toContain('short')
    expect(JSON.stringify(result)).not.toContain(API_KEY)
  })

  it('summarizes capability for the browser without disclosing any value', () => {
    expect(describeHiveCapability({ ...COMPLETE })).toEqual({ configured: true, blockers: [] })

    const partial = describeHiveCapability({ HIVE_APP_ID: 'com.hellbreak.game' })
    expect(partial.configured).toBe(false)
    expect(partial.blockers).toContain('ROOM_TOKEN_SECRET')
    expect(partial.blockers).not.toContain('HIVE_APP_ID')
    expect(JSON.stringify(partial)).not.toContain('com.hellbreak.game')
  })
})
