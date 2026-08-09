import { describe, expect, it } from 'vitest'
import { createFetchTransport } from './transport'

describe('bounded HIVE fetch transport', () => {
  it('forwards the adapter request verbatim and returns status plus body', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const transport = createFetchTransport({
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init: init ?? {} })
        return new Response('{"result_code":0}', { status: 200 })
      },
    })

    const response = await transport({
      url: 'https://auth.example/game/token/get-token',
      method: 'POST',
      headers: { Authorization: 'token', ISCRYPT: '0' },
      body: '{"appid":"a"}',
    })

    expect(response).toEqual({ status: 200, body: '{"result_code":0}' })
    expect(seen[0].url).toBe('https://auth.example/game/token/get-token')
    expect(seen[0].init.method).toBe('POST')
    expect(seen[0].init.body).toBe('{"appid":"a"}')
    expect(seen[0].init.headers).toEqual({ Authorization: 'token', ISCRYPT: '0' })
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal)
    expect(seen[0].init.redirect).toBe('error')
  })

  it('returns a non-2xx status instead of throwing, so the adapter can classify it', async () => {
    const transport = createFetchTransport({
      fetchImpl: async () => new Response('nope', { status: 503 }),
    })

    await expect(transport({ url: 'https://auth.example/x', method: 'GET', headers: {} }))
      .resolves.toEqual({ status: 503, body: 'nope' })
  })

  // An unbounded read would let a compromised or misbehaving upstream exhaust the route's memory.
  it('refuses a response body beyond the ceiling', async () => {
    const transport = createFetchTransport({
      maxResponseBytes: 16,
      fetchImpl: async () => new Response('x'.repeat(64), { status: 200 }),
    })

    await expect(transport({ url: 'https://auth.example/x', method: 'GET', headers: {} }))
      .rejects.toMatchObject({ kind: 'malformed-response' })
  })

  it('accepts a body exactly at the ceiling', async () => {
    const transport = createFetchTransport({
      maxResponseBytes: 8,
      fetchImpl: async () => new Response('12345678', { status: 200 }),
    })

    await expect(transport({ url: 'https://auth.example/x', method: 'GET', headers: {} }))
      .resolves.toEqual({ status: 200, body: '12345678' })
  })

  it('propagates a network failure to the adapter', async () => {
    const transport = createFetchTransport({
      fetchImpl: async () => { throw new Error('ECONNREFUSED') },
    })

    await expect(transport({ url: 'https://auth.example/x', method: 'GET', headers: {} }))
      .rejects.toThrow()
  })
})
