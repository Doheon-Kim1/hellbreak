/**
 * The normalized contract the rest of HELLBREAK is allowed to see.
 *
 * HIVE's own payloads stop at this boundary. Route handlers, the room token issuer, and the browser
 * only ever handle the types below, so a change in a HIVE field name is a change in one adapter
 * rather than a change across the app.
 *
 * Everything here is derived from the publicly documented Hive Server API and Hive Matchmaking
 * Private Match API. No endpoint, field, or status value is invented: where the public
 * documentation stops (notably how a matched group is turned into a room address), this file stops
 * too and the gap is represented explicitly rather than guessed.
 */

/** HIVE PlayerID is documented as a BigInteger, so it is carried as digits and never as a float. */
export const HIVE_PLAYER_ID_PATTERN = /^[1-9][0-9]{0,18}$/
/** DID is opaque to us; the ceiling only exists to bound what we forward. */
export const HIVE_DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
export const HIVE_ACCESS_TOKEN_MAX_LENGTH = 4_096

export interface HiveIdentity {
  /** HIVE PlayerID, verified against the presented access token. */
  playerId: string
  /** HIVE DID, verified in the same call. */
  deviceId: string
}

export interface HiveVerifiedSession {
  identity: HiveIdentity
  verifiedAtMs: number
}

/**
 * Normalized queue state.
 *
 * `queued` ← `matchingInProgress`, `matched` ← `matched`, `timeout` ← `timeout`,
 * `not-requested` ← `requestingStatus: notRequested` with no conclusive matching status.
 */
export type HiveQueueStatus = 'queued' | 'matched' | 'timeout' | 'not-requested'

export interface HiveQueueTicket {
  playerId: string
  status: HiveQueueStatus
}

export type HiveFailureKind =
  /** HIVE answered and refused: a bad token, an unknown player, a rejected queue request. */
  | 'rejected'
  /** HIVE could not be reached or failed internally. Retrying may work. */
  | 'unavailable'
  /** HIVE answered with something this adapter refuses to interpret. */
  | 'malformed-response'

export class HiveProviderError extends Error {
  readonly kind: HiveFailureKind
  readonly status: number | null

  constructor(kind: HiveFailureKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'HiveProviderError'
    this.kind = kind
    this.status = status
  }
}

export interface HiveTransportRequest {
  url: string
  method: 'GET' | 'POST' | 'DELETE'
  headers: Record<string, string>
  body?: string
}

export interface HiveTransportResponse {
  status: number
  body: string
}

/**
 * Injectable HTTP boundary. Adapters never call `fetch` directly, so contract tests can assert the
 * exact URL, method, headers, and body that would go to HIVE without a network or a credential.
 */
export type HiveTransport = (request: HiveTransportRequest) => Promise<HiveTransportResponse>

export interface HiveAuthProvider {
  verifySession(input: {
    accessToken: string
    playerId: string
    deviceId: string
  }): Promise<HiveVerifiedSession>
}

export interface HiveMatchmakingProvider {
  enqueue(input: { playerId: string; point?: number }): Promise<HiveQueueTicket>
  status(input: { playerId: string }): Promise<HiveQueueTicket>
  cancel(input: { playerId: string }): Promise<void>
}

export function isHivePlayerId(value: unknown): value is string {
  return typeof value === 'string' && HIVE_PLAYER_ID_PATTERN.test(value)
}

export function isHiveDeviceId(value: unknown): value is string {
  return typeof value === 'string' && HIVE_DEVICE_ID_PATTERN.test(value)
}

/** Maps an HTTP status onto the failure taxonomy. 4xx is HIVE's answer; 5xx is HIVE's outage. */
export function failureKindForStatus(status: number): HiveFailureKind {
  return status >= 400 && status < 500 ? 'rejected' : 'unavailable'
}

export function parseHiveJson(body: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new HiveProviderError('malformed-response', 'HIVE returned a body that is not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HiveProviderError('malformed-response', 'HIVE returned a non-object body')
  }
  return parsed as Record<string, unknown>
}
