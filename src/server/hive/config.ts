import { readRoomTokenSecret } from './sign-room-token'

/**
 * The one place HIVE server credentials are read, and the only place that decides whether the
 * authenticated path exists at all.
 *
 * Nothing here is exported to the browser bundle: the module is imported exclusively by route
 * handlers and by tests. `describeHiveCapability` deliberately returns *key names* rather than
 * values, so the lobby can explain honestly why the HIVE branch is unavailable without ever
 * disclosing a configured secret.
 */

/** Required keys, in the order the capability report lists them. */
export const HIVE_ENV_KEYS = [
  'HIVE_APP_ID',
  'HIVE_SERVER_API_KEY',
  'HIVE_AUTH_BASE_URL',
  'HIVE_MATCHMAKING_BASE_URL',
  'HIVE_GAME_INDEX',
  'HIVE_MATCH_ID',
  'ROOM_TOKEN_SECRET',
  'NEXT_PUBLIC_APP_ORIGIN',
] as const

export type HiveEnvKey = (typeof HIVE_ENV_KEYS)[number]

export interface HiveServerConfig {
  /** `appid` in the Authentication v4 token verification body. */
  appId: string
  /** Bearer credential for the Matchmaking API. Never leaves the server. */
  serverApiKey: string
  /** Origin of the Hive Auth server, e.g. `https://sandbox-auth.qpyou.cn`. */
  authBaseUrl: string
  /** Origin of the Hive Matchmaking API, e.g. `https://sandbox-api-match.withhive.com`. */
  matchmakingBaseUrl: string
  /** `gameIndex` path parameter issued by the Hive Console. */
  gameIndex: number
  /** `matchId` path parameter of the private match configured in the Hive Console. */
  matchId: number
  /** Signs browser sessions and room join capabilities; shared with the room server. */
  roomTokenSecret: string
  appOrigin: string
}

export type HiveConfigResult =
  | { ok: true; config: HiveServerConfig }
  | { ok: false; missing: HiveEnvKey[]; invalid: HiveEnvKey[] }

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MIN_API_KEY_LENGTH = 16

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** Accepts an origin only: a documented path is appended by the adapters, never configured here. */
function readOrigin(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) return null
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null
  return url.origin
}

function readPositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function readHiveConfig(env: Record<string, string | undefined>): HiveConfigResult {
  const missing: HiveEnvKey[] = []
  const invalid: HiveEnvKey[] = []
  const present = new Map<HiveEnvKey, string>()

  for (const key of HIVE_ENV_KEYS) {
    // Surrounding whitespace is a copy-paste artefact in a URL or an id, and is dropped. It is not
    // dropped from the signing key: that value is shared byte-for-byte with the room server, so
    // rewriting it here would silently produce a different key than the other host verifies with.
    const raw = key === 'ROOM_TOKEN_SECRET' ? env[key] : env[key]?.trim()
    if (!raw) missing.push(key)
    else present.set(key, raw)
  }

  const read = <T>(key: HiveEnvKey, parse: (raw: string) => T | null): T | null => {
    const raw = present.get(key)
    if (raw === undefined) return null
    const parsed = parse(raw)
    if (parsed === null) invalid.push(key)
    return parsed
  }

  const appId = read('HIVE_APP_ID', (raw) => (APP_ID_PATTERN.test(raw) ? raw : null))
  const serverApiKey = read('HIVE_SERVER_API_KEY', (raw) => (raw.length >= MIN_API_KEY_LENGTH ? raw : null))
  const authBaseUrl = read('HIVE_AUTH_BASE_URL', readOrigin)
  const matchmakingBaseUrl = read('HIVE_MATCHMAKING_BASE_URL', readOrigin)
  const gameIndex = read('HIVE_GAME_INDEX', readPositiveInteger)
  const matchId = read('HIVE_MATCH_ID', readPositiveInteger)
  const roomTokenSecret = read('ROOM_TOKEN_SECRET', (raw) => {
    const result = readRoomTokenSecret(raw)
    return result.ok ? result.secret : null
  })
  const appOrigin = read('NEXT_PUBLIC_APP_ORIGIN', readOrigin)

  if (
    missing.length > 0
    || invalid.length > 0
    || appId === null
    || serverApiKey === null
    || authBaseUrl === null
    || matchmakingBaseUrl === null
    || gameIndex === null
    || matchId === null
    || roomTokenSecret === null
    || appOrigin === null
  ) return { ok: false, missing, invalid }

  return {
    ok: true,
    config: {
      appId,
      serverApiKey,
      authBaseUrl,
      matchmakingBaseUrl,
      gameIndex,
      matchId,
      roomTokenSecret,
      appOrigin,
    },
  }
}

export interface HiveCapability {
  configured: boolean
  /** Names of the keys that are missing or invalid. Values are never included. */
  blockers: HiveEnvKey[]
}

export function describeHiveCapability(env: Record<string, string | undefined>): HiveCapability {
  const result = readHiveConfig(env)
  if (result.ok) return { configured: true, blockers: [] }
  return {
    configured: false,
    blockers: HIVE_ENV_KEYS.filter(
      (key) => result.missing.includes(key) || result.invalid.includes(key),
    ),
  }
}
