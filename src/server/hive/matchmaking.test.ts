import { describe, expect, it } from 'vitest'
import { createHiveMatchmakingProvider } from './matchmaking'
import type { HiveTransportRequest, HiveTransportResponse } from './contracts'

const CONFIG = {
  matchmakingBaseUrl: 'https://sandbox-api-match.withhive.com',
  gameIndex: 1234,
  matchId: 5678,
  serverApiKey: 'hive-server-api-key-value-0123456789',
} as const

const PLAYER_ID = '1234567890123'
const BASE_PATH = 'https://sandbox-api-match.withhive.com/gameindexes/1234/matchmakings/5678/players'

function queueBody(matching: string, requesting = 'requested') {
  return JSON.stringify({
    playerId: 1234567890123,
    matchInfo: { gameIndex: 1234, matchId: 5678 },
    requestingStatus: requesting,
    requestingInfo: { requestTimeUtc: '2026-08-09T00:00:00Z', point: 0, extraData: '' },
    matchingInfo: { status: matching },
  })
}

function recordingTransport(response: Partial<HiveTransportResponse> = {}) {
  const calls: HiveTransportRequest[] = []
  const transport = async (request: HiveTransportRequest): Promise<HiveTransportResponse> => {
    calls.push(request)
    return { status: response.status ?? 200, body: response.body ?? queueBody('matchingInProgress') }
  }
  return { calls, transport }
}

describe('HIVE Private Match matchmaking adapter', () => {
  // Contract source: Hive Matchmaking API, "Private Match API".
  it('enqueues against the documented path with a bearer credential', async () => {
    const { calls, transport } = recordingTransport()

    const ticket = await createHiveMatchmakingProvider(CONFIG, transport)
      .enqueue({ playerId: PLAYER_ID, point: 120 })

    expect(calls[0].url).toBe(BASE_PATH)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer hive-server-api-key-value-0123456789',
    })
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ playerId: 1234567890123, point: 120 })
    expect(ticket).toEqual({ playerId: PLAYER_ID, status: 'queued' })
  })

  it('omits an unset score rather than inventing one', async () => {
    const { calls, transport } = recordingTransport()

    await createHiveMatchmakingProvider(CONFIG, transport).enqueue({ playerId: PLAYER_ID })

    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ playerId: 1234567890123 })
  })

  it('reads status from the documented query parameter', async () => {
    const { calls, transport } = recordingTransport({ body: queueBody('matched') })

    const ticket = await createHiveMatchmakingProvider(CONFIG, transport).status({ playerId: PLAYER_ID })

    expect(calls[0].url).toBe(`${BASE_PATH}?id=${PLAYER_ID}`)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].body).toBeUndefined()
    expect(ticket).toEqual({ playerId: PLAYER_ID, status: 'matched' })
  })

  it('cancels through the documented player-scoped path', async () => {
    const { calls, transport } = recordingTransport({ body: '' })

    await createHiveMatchmakingProvider(CONFIG, transport).cancel({ playerId: PLAYER_ID })

    expect(calls[0].url).toBe(`${BASE_PATH}/${PLAYER_ID}`)
    expect(calls[0].method).toBe('DELETE')
  })

  it.each([
    ['matchingInProgress', 'requested', 'queued'],
    ['matched', 'requested', 'matched'],
    ['matched', 'notRequested', 'matched'],
    ['timeout', 'notRequested', 'timeout'],
    ['matchingInProgress', 'notRequested', 'not-requested'],
  ])('normalizes %s/%s to %s', async (matching, requesting, expected) => {
    const { transport } = recordingTransport({ body: queueBody(matching, requesting) })

    const ticket = await createHiveMatchmakingProvider(CONFIG, transport).status({ playerId: PLAYER_ID })

    expect(ticket.status).toBe(expected)
  })

  it.each([
    ['an unknown matching status', queueBody('exploded')],
    ['an unknown requesting status', queueBody('matchingInProgress', 'pending')],
    ['a missing matchingInfo', JSON.stringify({ requestingStatus: 'requested' })],
    ['a non-object matchingInfo', JSON.stringify({ requestingStatus: 'requested', matchingInfo: 1 })],
    ['a non-json body', 'nope'],
  ])('refuses to guess at an unexpected queue payload (%s)', async (_label, body) => {
    const { transport } = recordingTransport({ body })

    await expect(createHiveMatchmakingProvider(CONFIG, transport).status({ playerId: PLAYER_ID }))
      .rejects.toMatchObject({ kind: 'malformed-response' })
  })

  it.each([
    ['4xx', 404, 'rejected'],
    ['5xx', 500, 'unavailable'],
  ])('maps an HTTP %s answer onto the failure taxonomy', async (_label, status, kind) => {
    const { transport } = recordingTransport({ status, body: '{}' })

    await expect(createHiveMatchmakingProvider(CONFIG, transport).status({ playerId: PLAYER_ID }))
      .rejects.toMatchObject({ kind })
  })

  it('treats an empty 200 from cancel as success', async () => {
    const { transport } = recordingTransport({ body: '' })

    await expect(createHiveMatchmakingProvider(CONFIG, transport).cancel({ playerId: PLAYER_ID }))
      .resolves.toBeUndefined()
  })

  it.each([
    ['hostile player id', { playerId: 'me OR 1=1' }],
    ['path traversal in the player id', { playerId: '../../admin' }],
    ['blank player id', { playerId: '' }],
  ])('never builds a request from an unvalidated player id (%s)', async (_label, override) => {
    const { calls, transport } = recordingTransport()
    const provider = createHiveMatchmakingProvider(CONFIG, transport)

    await expect(provider.status({ playerId: override.playerId })).rejects.toMatchObject({ kind: 'rejected' })
    await expect(provider.cancel({ playerId: override.playerId })).rejects.toMatchObject({ kind: 'rejected' })
    await expect(provider.enqueue({ playerId: override.playerId })).rejects.toMatchObject({ kind: 'rejected' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['negative', -1],
    ['above the documented ceiling', 1_000_000_000],
    ['fractional', 1.5],
  ])('rejects a matching score outside the documented range (%s)', async (_label, point) => {
    const { calls, transport } = recordingTransport()

    await expect(createHiveMatchmakingProvider(CONFIG, transport).enqueue({ playerId: PLAYER_ID, point }))
      .rejects.toMatchObject({ kind: 'rejected' })
    expect(calls).toHaveLength(0)
  })

  it('never puts the server API key into an error message', async () => {
    const { transport } = recordingTransport({ status: 500, body: '{}' })

    await expect(createHiveMatchmakingProvider(CONFIG, transport).status({ playerId: PLAYER_ID }))
      .rejects.toThrow(/^(?!.*hive-server-api-key-value).*$/)
  })
})
