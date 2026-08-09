import {
  HIVE_ACCESS_TOKEN_MAX_LENGTH,
  HiveProviderError,
  failureKindForStatus,
  isHiveDeviceId,
  isHivePlayerId,
  parseHiveJson,
} from './contracts'
import type { HiveAuthProvider, HiveTransport, HiveVerifiedSession } from './contracts'

/**
 * Authentication v4 token verification, exactly as the Hive Server API documents it:
 *
 *   POST {authBaseUrl}/game/token/get-token
 *   Authorization: <token key returned to the client after sign-in>
 *   ISCRYPT: 0
 *   { "appid": ..., "did": ..., "player_id": ... }
 *   -> { "result_code": 0, "result_msg": "..." }
 *
 * The response carries no profile, so the identity this adapter returns is the *claimed* pair
 * (PlayerID, DID) that HIVE has just confirmed belongs to the presented token. That is the whole
 * security value: a browser can assert any PlayerID it likes, and HIVE is what refuses it.
 *
 * The access token only ever travels in the Authorization header of this one request. It is never
 * logged, never stored, and never included in an error.
 */

export interface HiveAuthConfig {
  appId: string
  authBaseUrl: string
}

const VERIFY_TOKEN_PATH = '/game/token/get-token'

export function createHiveAuthProvider(
  config: HiveAuthConfig,
  transport: HiveTransport,
): HiveAuthProvider {
  return {
    async verifySession({ accessToken, playerId, deviceId }): Promise<HiveVerifiedSession> {
      if (
        typeof accessToken !== 'string'
        || accessToken.length === 0
        || accessToken.length > HIVE_ACCESS_TOKEN_MAX_LENGTH
      ) throw new HiveProviderError('rejected', 'HIVE access token is missing or oversized')
      if (!isHivePlayerId(playerId)) throw new HiveProviderError('rejected', 'HIVE PlayerID is malformed')
      if (!isHiveDeviceId(deviceId)) throw new HiveProviderError('rejected', 'HIVE DID is malformed')

      // PlayerID is a BigInteger in the documented contract, so the digits are placed into the JSON
      // literally. `isHivePlayerId` has already proven the string is digits only.
      const body = `{"appid":${JSON.stringify(config.appId)},`
        + `"did":${JSON.stringify(deviceId)},`
        + `"player_id":${playerId}}`

      let response
      try {
        response = await transport({
          url: `${config.authBaseUrl}${VERIFY_TOKEN_PATH}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: accessToken,
            ISCRYPT: '0',
          },
          body,
        })
      } catch {
        throw new HiveProviderError('unavailable', 'HIVE authentication endpoint is unreachable')
      }

      if (response.status < 200 || response.status >= 300) {
        throw new HiveProviderError(
          failureKindForStatus(response.status),
          'HIVE refused the token verification request',
          response.status,
        )
      }

      const payload = parseHiveJson(response.body)
      const resultCode = payload.result_code
      if (typeof resultCode !== 'number' || !Number.isFinite(resultCode)) {
        throw new HiveProviderError('malformed-response', 'HIVE returned no numeric result_code')
      }
      // `result_msg` is HIVE's text and may echo request data, so it never reaches our error.
      if (resultCode !== 0) {
        throw new HiveProviderError('rejected', `HIVE rejected the token (result_code ${resultCode})`)
      }

      return { identity: { playerId, deviceId }, verifiedAtMs: Date.now() }
    },
  }
}
