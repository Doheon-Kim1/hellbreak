import {
  HiveProviderError,
  failureKindForStatus,
  isHivePlayerId,
  parseHiveJson,
} from './contracts'
import type {
  HiveMatchmakingProvider,
  HiveQueueStatus,
  HiveQueueTicket,
  HiveTransport,
} from './contracts'

/**
 * Hive Matchmaking "Private Match" API, exactly as documented:
 *
 *   POST   {base}/gameindexes/{gameIndex}/matchmakings/{matchId}/players        (request a match)
 *   GET    {base}/gameindexes/{gameIndex}/matchmakings/{matchId}/players?id=..  (check status)
 *   DELETE {base}/gameindexes/{gameIndex}/matchmakings/{matchId}/players/{id}   (cancel)
 *   Authorization: Bearer <server API key>
 *
 * Documented statuses are `requestingStatus` ∈ {requested, notRequested} and `matchingInfo.status`
 * ∈ {matchingInProgress, timeout, matched}. Anything else is refused instead of guessed.
 *
 * The documented responses contain **no room id, session id, or server address**: connection
 * details are delivered to the game server through the separate match result callback. This
 * adapter therefore never claims to know where a matched player should connect; that is the job of
 * the allocation store, which is fed by the callback.
 */

export interface HiveMatchmakingConfig {
  matchmakingBaseUrl: string
  gameIndex: number
  matchId: number
  serverApiKey: string
}

/** Documented inclusive range for the optional matching score. */
const MAX_MATCH_POINT = 999_999_999

function normalizeStatus(payload: Record<string, unknown>): HiveQueueStatus {
  const matching = payload.matchingInfo
  if (typeof matching !== 'object' || matching === null || Array.isArray(matching)) {
    throw new HiveProviderError('malformed-response', 'HIVE queue payload has no matchingInfo object')
  }

  const matchingStatus = (matching as { status?: unknown }).status
  const requestingStatus = payload.requestingStatus
  if (requestingStatus !== 'requested' && requestingStatus !== 'notRequested') {
    throw new HiveProviderError('malformed-response', 'HIVE queue payload has an unknown requestingStatus')
  }

  switch (matchingStatus) {
    case 'matched': return 'matched'
    case 'timeout': return 'timeout'
    case 'matchingInProgress':
      // Documented as "no active request or match already concluded": not a live queue slot.
      return requestingStatus === 'requested' ? 'queued' : 'not-requested'
    default:
      throw new HiveProviderError('malformed-response', 'HIVE queue payload has an unknown matching status')
  }
}

export function createHiveMatchmakingProvider(
  config: HiveMatchmakingConfig,
  transport: HiveTransport,
): HiveMatchmakingProvider {
  const collection = `${config.matchmakingBaseUrl}/gameindexes/${config.gameIndex}`
    + `/matchmakings/${config.matchId}/players`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.serverApiKey}`,
  }

  const requirePlayerId = (playerId: string) => {
    // Validated before it is ever interpolated into a URL path or query.
    if (!isHivePlayerId(playerId)) throw new HiveProviderError('rejected', 'HIVE PlayerID is malformed')
  }

  const call = async (
    request: { url: string; method: 'GET' | 'POST' | 'DELETE'; body?: string },
  ): Promise<string> => {
    let response
    try {
      response = await transport({ ...request, headers })
    } catch {
      throw new HiveProviderError('unavailable', 'HIVE matchmaking endpoint is unreachable')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new HiveProviderError(
        failureKindForStatus(response.status),
        'HIVE refused the matchmaking request',
        response.status,
      )
    }
    return response.body
  }

  const ticketFrom = (playerId: string, body: string): HiveQueueTicket =>
    ({ playerId, status: normalizeStatus(parseHiveJson(body)) })

  return {
    async enqueue({ playerId, point }) {
      requirePlayerId(playerId)
      if (point !== undefined && (!Number.isInteger(point) || point < 0 || point > MAX_MATCH_POINT)) {
        throw new HiveProviderError('rejected', 'HIVE matching score is outside the documented range')
      }
      // PlayerID is a `long` in the documented body, so its digits are emitted literally.
      const body = point === undefined
        ? `{"playerId":${playerId}}`
        : `{"playerId":${playerId},"point":${point}}`

      return ticketFrom(playerId, await call({ url: collection, method: 'POST', body }))
    },

    async status({ playerId }) {
      requirePlayerId(playerId)
      return ticketFrom(playerId, await call({ url: `${collection}?id=${playerId}`, method: 'GET' }))
    },

    async cancel({ playerId }) {
      requirePlayerId(playerId)
      await call({ url: `${collection}/${playerId}`, method: 'DELETE' })
    },
  }
}
