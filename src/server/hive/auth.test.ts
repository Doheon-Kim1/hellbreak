import { describe, expect, it } from 'vitest'
import { createHiveAuthProvider } from './auth'
import { HiveProviderError } from './contracts'
import type { HiveTransportRequest, HiveTransportResponse } from './contracts'

const CONFIG = {
  appId: 'com.hellbreak.game',
  authBaseUrl: 'https://sandbox-auth.qpyou.cn',
} as const

const VALID = {
  accessToken: 'hive-access-token-abc',
  playerId: '1234567890123',
  deviceId: 'did-9f8e7d',
} as const

function recordingTransport(response: Partial<HiveTransportResponse> = {}) {
  const calls: HiveTransportRequest[] = []
  const transport = async (request: HiveTransportRequest): Promise<HiveTransportResponse> => {
    calls.push(request)
    return {
      status: response.status ?? 200,
      body: response.body ?? JSON.stringify({ result_code: 0, result_msg: 'Success' }),
    }
  }
  return { calls, transport }
}

describe('HIVE Authentication v4 token verification adapter', () => {
  // Contract source: Hive Server API, "Verifying Authentication v4 Token".
  it('calls the documented endpoint with the documented headers and body', async () => {
    const { calls, transport } = recordingTransport()

    await createHiveAuthProvider(CONFIG, transport).verifySession(VALID)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://sandbox-auth.qpyou.cn/game/token/get-token')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'hive-access-token-abc',
      ISCRYPT: '0',
    })
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      appid: 'com.hellbreak.game',
      did: 'did-9f8e7d',
      player_id: 1234567890123,
    })
  })

  // PlayerID is documented as a BigInteger; a 19-digit id must survive the round trip exactly.
  it('serializes a PlayerID beyond IEEE-754 precision without rounding it', async () => {
    const { calls, transport } = recordingTransport()

    await createHiveAuthProvider(CONFIG, transport)
      .verifySession({ ...VALID, playerId: '9007199254740993' })

    expect(calls[0].body).toContain('"player_id":9007199254740993')
  })

  it('returns the verified identity when HIVE answers result_code 0', async () => {
    const { transport } = recordingTransport()

    const session = await createHiveAuthProvider(CONFIG, transport).verifySession(VALID)

    expect(session).toEqual({
      identity: { playerId: '1234567890123', deviceId: 'did-9f8e7d' },
      verifiedAtMs: expect.any(Number),
    })
  })

  it('rejects a non-zero result code as a refused identity', async () => {
    const { transport } = recordingTransport({
      body: JSON.stringify({ result_code: -1000, result_msg: 'invalid token' }),
    })

    await expect(createHiveAuthProvider(CONFIG, transport).verifySession(VALID))
      .rejects.toMatchObject({ kind: 'rejected' })
  })

  it.each([
    ['4xx', 401, 'rejected'],
    ['5xx', 503, 'unavailable'],
  ])('maps an HTTP %s answer onto the failure taxonomy', async (_label, status, kind) => {
    const { transport } = recordingTransport({ status, body: '{}' })

    await expect(createHiveAuthProvider(CONFIG, transport).verifySession(VALID))
      .rejects.toMatchObject({ kind })
  })

  it.each([
    ['not json', 'nope'],
    ['an array', '[]'],
    ['a missing result code', '{"result_msg":"ok"}'],
    ['a non-numeric result code', '{"result_code":"0"}'],
  ])('refuses to interpret an unexpected body (%s)', async (_label, body) => {
    const { transport } = recordingTransport({ body })

    await expect(createHiveAuthProvider(CONFIG, transport).verifySession(VALID))
      .rejects.toMatchObject({ kind: 'malformed-response' })
  })

  it('surfaces a transport failure as unavailable rather than as a rejection', async () => {
    const failing = async () => { throw new Error('socket hang up') }

    await expect(createHiveAuthProvider(CONFIG, failing).verifySession(VALID))
      .rejects.toMatchObject({ kind: 'unavailable' })
  })

  it.each([
    ['blank token', { accessToken: '' }],
    ['oversized token', { accessToken: 'a'.repeat(4_097) }],
    ['non-numeric player id', { playerId: 'root' }],
    ['zero-prefixed player id', { playerId: '0123' }],
    ['oversized player id', { playerId: '1'.repeat(20) }],
    ['hostile device id', { deviceId: 'did with spaces' }],
    ['blank device id', { deviceId: '' }],
  ])('refuses to contact HIVE with an unvalidated claim (%s)', async (_label, override) => {
    const { calls, transport } = recordingTransport()

    await expect(
      createHiveAuthProvider(CONFIG, transport).verifySession({ ...VALID, ...override }),
    ).rejects.toBeInstanceOf(HiveProviderError)
    expect(calls).toHaveLength(0)
  })

  it('never puts the access token into an error message', async () => {
    const { transport } = recordingTransport({
      body: JSON.stringify({ result_code: -1000, result_msg: VALID.accessToken }),
    })

    await expect(createHiveAuthProvider(CONFIG, transport).verifySession(VALID))
      .rejects.toThrow(/^(?!.*hive-access-token-abc).*$/)
  })
})
