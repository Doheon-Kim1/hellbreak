import { beforeEach, describe, expect, it } from 'vitest'
import { createMatchAllocationStore } from './allocation'
import { HiveProviderError, isHivePlayerId } from './contracts'
import type { HiveQueueStatus, HiveQueueTicket, HiveVerifiedSession } from './contracts'
import {
  createHiveCapabilityHandler,
  createHiveMatchmakingHandler,
  createHiveRoomTokenHandler,
  createHiveSessionHandler,
} from './routes'
import type { HiveRuntime } from './routes'
import { HIVE_SESSION_COOKIE, issueBrowserSession } from './session'
import { isRoomTokenId, verifyRoomToken } from './sign-room-token'

const SECRET = 'room-token-secret-that-is-long-enough-0123456789'
const NOW = 1_700_000_000_000
const IDENTITY = { playerId: '1234567890123', deviceId: 'did-9f8e7d' }
const ORIGIN = 'https://hellbreak.example'

const CONFIG = {
  appId: 'com.hellbreak.game',
  serverApiKey: 'hive-server-api-key-value-0123456789',
  authBaseUrl: 'https://sandbox-auth.qpyou.cn',
  matchmakingBaseUrl: 'https://sandbox-api-match.withhive.com',
  gameIndex: 1234,
  matchId: 5678,
  roomTokenSecret: SECRET,
  appOrigin: ORIGIN,
}

type ReadyRuntime = Extract<HiveRuntime, { status: 'ready' }>

interface Harness {
  runtime: ReadyRuntime
  allocations: ReturnType<typeof createMatchAllocationStore>
  authCalls: unknown[]
  queueCalls: { action: string; playerId: string }[]
  setQueueStatus: (status: HiveQueueStatus) => void
  failAuthWith: (error: unknown) => void
  failQueueWith: (error: unknown) => void
}

function harness(): Harness {
  const allocations = createMatchAllocationStore({ now: () => NOW })
  const authCalls: unknown[] = []
  const queueCalls: { action: string; playerId: string }[] = []
  let queueStatus: HiveQueueStatus = 'queued'
  let authError: unknown = null
  let queueError: unknown = null

  const ticket = (playerId: string): HiveQueueTicket => ({ playerId, status: queueStatus })
  const guard = () => {
    if (queueError) throw queueError
  }

  const runtime: ReadyRuntime = {
    status: 'ready',
    config: CONFIG,
    now: () => NOW,
    allocations,
    auth: {
      async verifySession(input): Promise<HiveVerifiedSession> {
        authCalls.push(input)
        if (authError) throw authError
        return {
          identity: { playerId: input.playerId, deviceId: input.deviceId },
          verifiedAtMs: NOW,
        }
      },
    },
    matchmaking: {
      async enqueue({ playerId }) {
        queueCalls.push({ action: 'enqueue', playerId })
        guard()
        return ticket(playerId)
      },
      async status({ playerId }) {
        queueCalls.push({ action: 'status', playerId })
        guard()
        return ticket(playerId)
      },
      async cancel({ playerId }) {
        queueCalls.push({ action: 'cancel', playerId })
        guard()
      },
    },
  }

  return {
    runtime,
    allocations,
    authCalls,
    queueCalls,
    setQueueStatus: (status) => { queueStatus = status },
    failAuthWith: (error) => { authError = error },
    failQueueWith: (error) => { queueError = error },
  }
}

function post(path: string, body: unknown, init: { cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (init.cookie) headers.Cookie = init.cookie
  if (init.origin !== null) headers.Origin = init.origin ?? ORIGIN
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

interface StreamLog {
  /** How many times the producer was asked for more, so an abandoned read is visible. */
  pulls: number
  bytesProduced: number
  cancelled: boolean
}

/**
 * A request whose body arrives in pieces, like any chunked upload. The log is what makes the
 * difference between "refused after buffering it all" and "refused without asking for the rest"
 * observable from a test.
 */
function streamingPost(
  path: string,
  chunks: string[],
  init: { cookie?: string; contentLength?: string } = {},
): { request: Request; log: StreamLog } {
  const log: StreamLog = { pulls: 0, bytesProduced: 0, cancelled: false }
  const encoder = new TextEncoder()
  let index = 0

  const body = new ReadableStream({
    pull(controller) {
      log.pulls += 1
      if (index >= chunks.length) {
        controller.close()
        return
      }
      const chunk = encoder.encode(chunks[index])
      index += 1
      log.bytesProduced += chunk.byteLength
      controller.enqueue(chunk)
    },
    cancel() {
      log.cancelled = true
    },
  })

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: ORIGIN }
  if (init.cookie) headers.Cookie = init.cookie
  if (init.contentLength !== undefined) headers['Content-Length'] = init.contentLength

  const request = new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit)

  return { request, log }
}

function sessionCookie(overrides: Partial<typeof IDENTITY> = {}, nowMs = NOW): string {
  const { value } = issueBrowserSession({
    identity: { ...IDENTITY, ...overrides },
    nowMs,
    secret: SECRET,
  })
  return `${HIVE_SESSION_COOKIE}=${value}`
}

let fixture: Harness

beforeEach(() => {
  fixture = harness()
})

describe('GET /api/hive/session (capability)', () => {
  it('reports a ready deployment without disclosing any configured value', async () => {
    const response = await createHiveCapabilityHandler(() => fixture.runtime)(
      new Request(`${ORIGIN}/api/hive/session`),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({ configured: true, blockers: [] })
    expect(JSON.stringify(body)).not.toContain(SECRET)
  })

  it('reports the missing key names when the deployment is not configured', async () => {
    const unconfigured: HiveRuntime = {
      status: 'unconfigured',
      capability: { configured: false, blockers: ['HIVE_APP_ID', 'ROOM_TOKEN_SECRET'] },
    }

    const response = await createHiveCapabilityHandler(() => unconfigured)(
      new Request(`${ORIGIN}/api/hive/session`),
    )

    expect(response.status).toBe(200)
    expect(await response.json())
      .toEqual({ configured: false, blockers: ['HIVE_APP_ID', 'ROOM_TOKEN_SECRET'] })
  })
})

describe('POST /api/hive/session', () => {
  it('verifies the claim with HIVE and hands back an HttpOnly session cookie', async () => {
    const response = await createHiveSessionHandler(() => fixture.runtime)(post('/api/hive/session', {
      accessToken: 'hive-access-token-abc',
      playerId: IDENTITY.playerId,
      deviceId: IDENTITY.deviceId,
    }))

    expect(response.status).toBe(200)
    expect(fixture.authCalls).toEqual([{
      accessToken: 'hive-access-token-abc',
      playerId: IDENTITY.playerId,
      deviceId: IDENTITY.deviceId,
    }])

    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${HIVE_SESSION_COOKIE}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(cookie).not.toContain('hive-access-token-abc')
    expect(await response.json())
      .toEqual({ playerId: IDENTITY.playerId, expiresAtMs: expect.any(Number) })
  })

  it('marks the cookie insecure only for a local http origin', async () => {
    const local: HiveRuntime = {
      ...fixture.runtime,
      config: { ...CONFIG, appOrigin: 'http://localhost:5173' },
    }

    const response = await createHiveSessionHandler(() => local)(new Request(
      'http://localhost:5173/api/hive/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ accessToken: 'tok', ...IDENTITY }),
      },
    ))

    expect((response.headers.get('set-cookie') ?? '')).not.toContain('Secure')
  })

  it.each([
    ['a missing token', { playerId: IDENTITY.playerId, deviceId: IDENTITY.deviceId }],
    ['a non-string token', { accessToken: 1, ...IDENTITY }],
    ['a missing player id', { accessToken: 'tok', deviceId: IDENTITY.deviceId }],
    ['an unknown extra field', { accessToken: 'tok', ...IDENTITY, role: 'admin' }],
    ['a non-object body', '"string"'],
    ['broken json', '{'],
  ])('refuses %s before contacting HIVE', async (_label, body) => {
    const response = await createHiveSessionHandler(() => fixture.runtime)(post('/api/hive/session', body))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
    expect(fixture.authCalls).toHaveLength(0)
  })

  it('refuses an oversized body without reading it', async () => {
    const response = await createHiveSessionHandler(() => fixture.runtime)(post('/api/hive/session', {
      accessToken: 'a'.repeat(8_192),
      ...IDENTITY,
    }))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload_too_large' })
    expect(fixture.authCalls).toHaveLength(0)
  })

  it('refuses a cross-site origin even before the cookie policy applies', async () => {
    const response = await createHiveSessionHandler(() => fixture.runtime)(
      post('/api/hive/session', { accessToken: 'tok', ...IDENTITY }, { origin: 'https://evil.example' }),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'forbidden_origin' })
    expect(fixture.authCalls).toHaveLength(0)
  })

  it('turns a HIVE refusal into 401 and a HIVE outage into 502', async () => {
    fixture.failAuthWith(new HiveProviderError('rejected', 'nope'))
    const rejected = await createHiveSessionHandler(() => fixture.runtime)(
      post('/api/hive/session', { accessToken: 'tok', ...IDENTITY }),
    )
    expect(rejected.status).toBe(401)
    expect(await rejected.json()).toEqual({ error: 'hive_rejected' })
    expect(rejected.headers.get('set-cookie')).toBe(null)

    fixture.failAuthWith(new HiveProviderError('unavailable', 'down'))
    const unavailable = await createHiveSessionHandler(() => fixture.runtime)(
      post('/api/hive/session', { accessToken: 'tok', ...IDENTITY }),
    )
    expect(unavailable.status).toBe(502)
    expect(await unavailable.json()).toEqual({ error: 'hive_unavailable' })
  })

  it('answers 503 when the deployment has no HIVE configuration', async () => {
    const unconfigured: HiveRuntime = {
      status: 'unconfigured',
      capability: { configured: false, blockers: ['HIVE_APP_ID'] },
    }

    const response = await createHiveSessionHandler(() => unconfigured)(
      post('/api/hive/session', { accessToken: 'tok', ...IDENTITY }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'hive_not_configured', blockers: ['HIVE_APP_ID'] })
  })
})

describe('POST /api/hive/matchmaking', () => {
  it('queues the identity from the cookie and never one from the body', async () => {
    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action: 'enqueue', playerId: '999' }, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(400)
    expect(fixture.queueCalls).toHaveLength(0)
  })

  it('enqueues, reports status, and cancels for the session identity', async () => {
    const handler = createHiveMatchmakingHandler(() => fixture.runtime)
    const cookie = sessionCookie()

    const enqueued = await handler(post('/api/hive/matchmaking', { action: 'enqueue' }, { cookie }))
    expect(enqueued.status).toBe(200)
    expect(await enqueued.json()).toEqual({ status: 'queued', roomAssigned: false })

    fixture.setQueueStatus('matched')
    const status = await handler(post('/api/hive/matchmaking', { action: 'status' }, { cookie }))
    expect(await status.json()).toEqual({ status: 'matched', roomAssigned: false })

    const cancelled = await handler(post('/api/hive/matchmaking', { action: 'cancel' }, { cookie }))
    expect(await cancelled.json()).toEqual({ status: 'not-requested', roomAssigned: false })
    expect(fixture.queueCalls).toEqual([
      { action: 'enqueue', playerId: IDENTITY.playerId },
      { action: 'status', playerId: IDENTITY.playerId },
      { action: 'cancel', playerId: IDENTITY.playerId },
    ])
  })

  it('reports a room assignment once the allocator has one', async () => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })

    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action: 'status' }, { cookie: sessionCookie() }),
    )

    expect(await response.json()).toEqual({ status: 'matched', roomAssigned: true })
  })

  /**
   * An allocation belongs to the queue attempt that produced it. Cancelling or queueing again ends
   * that attempt, so the assignment is dropped before HIVE is asked for anything — otherwise a
   * `matched` answer could be paired with the *previous* attempt's room and signed into a capability
   * for a match this player already left.
   */
  it.each(['cancel', 'enqueue'])('drops a previous allocation before processing %s', async (action) => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })
    const cookie = sessionCookie()

    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action }, { cookie }),
    )

    expect(response.status).toBe(200)
    expect((await response.json()).roomAssigned).toBe(false)
    expect(fixture.allocations.resolve(IDENTITY.playerId, NOW)).toBe(null)

    // The capability route cannot be talked into signing the abandoned room either.
    const token = await createHiveRoomTokenHandler(() => fixture.runtime)(
      post('/api/hive/room-token', {}, { cookie }),
    )
    expect(token.status).toBe(409)
    expect(await token.json()).toEqual({ error: 'match_not_allocated' })
  })

  it.each(['cancel', 'enqueue'])('drops a previous allocation even when HIVE fails the %s', async (action) => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })
    fixture.failQueueWith(new HiveProviderError('unavailable', 'down'))

    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action }, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(502)
    expect(fixture.allocations.resolve(IDENTITY.playerId, NOW)).toBe(null)
  })

  it('leaves the allocation alone for a status poll, which ends no attempt', async () => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })

    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action: 'status' }, { cookie: sessionCookie() }),
    )

    expect(await response.json()).toEqual({ status: 'matched', roomAssigned: true })
    expect(fixture.allocations.resolve(IDENTITY.playerId, NOW)).toBe('match-7')
  })

  it('drops only the cancelling player\'s allocation', async () => {
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })
    fixture.allocations.record({ playerId: '999', roomId: 'match-9', expiresAtMs: NOW + 60_000 })

    await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action: 'cancel' }, { cookie: sessionCookie() }),
    )

    expect(fixture.allocations.resolve('999', NOW)).toBe('match-9')
  })

  it.each([
    ['an unauthenticated caller', { action: 'cancel' }, undefined],
    ['an unknown action', { action: 'drop-everyone' }, 'cookie'],
  ])('leaves the allocation in place for %s', async (_label, body, cookie) => {
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })

    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', body, { cookie: cookie ? sessionCookie() : undefined }),
    )

    expect(response.ok).toBe(false)
    expect(fixture.allocations.resolve(IDENTITY.playerId, NOW)).toBe('match-7')
  })

  it('forwards a bounded matching score and refuses an unbounded one', async () => {
    const handler = createHiveMatchmakingHandler(() => fixture.runtime)
    const cookie = sessionCookie()

    expect((await handler(post('/api/hive/matchmaking', { action: 'enqueue', point: 12 }, { cookie }))).status)
      .toBe(200)
    expect((await handler(post('/api/hive/matchmaking', { action: 'enqueue', point: -1 }, { cookie }))).status)
      .toBe(400)
    expect((await handler(post('/api/hive/matchmaking', { action: 'enqueue', point: 1e12 }, { cookie }))).status)
      .toBe(400)
  })

  it.each([
    ['no cookie', undefined],
    ['a forged cookie', `${HIVE_SESSION_COOKIE}=h1.aaaa.bbbb`],
    ['an expired cookie', undefined],
  ])('refuses matchmaking with %s', async (label, cookie) => {
    const header = label === 'an expired cookie'
      ? sessionCookie({}, NOW - 60 * 60_000)
      : cookie

    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action: 'status' }, { cookie: header }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
    expect(fixture.queueCalls).toHaveLength(0)
  })

  it('refuses an unknown action', async () => {
    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action: 'drop-everyone' }, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(400)
    expect(fixture.queueCalls).toHaveLength(0)
  })

  it('maps HIVE failures the same way the session route does', async () => {
    fixture.failQueueWith(new HiveProviderError('unavailable', 'down'))

    const response = await createHiveMatchmakingHandler(() => fixture.runtime)(
      post('/api/hive/matchmaking', { action: 'status' }, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'hive_unavailable' })
  })
})

describe('POST /api/hive/room-token', () => {
  it('signs a capability bound to the session identity and the allocated room', async () => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })

    const response = await createHiveRoomTokenHandler(() => fixture.runtime)(
      post('/api/hive/room-token', {}, { cookie: sessionCookie() }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      token: expect.any(String),
      roomId: 'match-7',
      expiresAtMs: expect.any(Number),
    })
    expect(verifyRoomToken(body.token, { secret: SECRET, nowMs: NOW, expectedRoomId: 'match-7' }))
      .toMatchObject({ ok: true, claims: { playerId: IDENTITY.playerId, roomId: 'match-7' } })
    // Short-lived by construction: a leaked capability is useless within the minute.
    expect(body.expiresAtMs - NOW).toBeLessThanOrEqual(60_000)
  })

  it('mints a fresh single-use capability on every call', async () => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })
    const handler = createHiveRoomTokenHandler(() => fixture.runtime)
    const cookie = sessionCookie()

    const first = await (await handler(post('/api/hive/room-token', {}, { cookie }))).json()
    const second = await (await handler(post('/api/hive/room-token', {}, { cookie }))).json()

    expect(first.token).not.toBe(second.token)
  })

  it('refuses to sign for a room the client asks for', async () => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })

    const response = await createHiveRoomTokenHandler(() => fixture.runtime)(
      post('/api/hive/room-token', { roomId: 'other-match', playerId: '42' }, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })

  it('refuses a capability while the player is still queueing', async () => {
    fixture.setQueueStatus('queued')

    const response = await createHiveRoomTokenHandler(() => fixture.runtime)(
      post('/api/hive/room-token', {}, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'not_matched' })
  })

  it('refuses a capability when HIVE matched but no room has been allocated yet', async () => {
    fixture.setQueueStatus('matched')

    const response = await createHiveRoomTokenHandler(() => fixture.runtime)(
      post('/api/hive/room-token', {}, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'match_not_allocated' })
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await createHiveRoomTokenHandler(() => fixture.runtime)(
      post('/api/hive/room-token', {}),
    )

    expect(response.status).toBe(401)
    expect(fixture.queueCalls).toHaveLength(0)
  })

  /**
   * `MatchAllocationStore` is an interface a shared implementation is expected to replace, so the
   * route is tested against a store that hands back something unsignable. The player learns their
   * allocation is unusable; nobody gets a stack trace rendered as a 500.
   */
  it('refuses an allocation it could never sign, rather than throwing on it', async () => {
    fixture.setQueueStatus('matched')
    const broken: HiveRuntime = {
      ...fixture.runtime,
      allocations: {
        record: () => ({ ok: true }),
        resolve: () => 'match 7/../elsewhere',
        invalidate: () => {},
        size: () => 1,
      },
    }

    const response = await createHiveRoomTokenHandler(() => broken)(
      post('/api/hive/room-token', {}, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'match_allocation_invalid' })
  })

  it('answers 409 for a malformed allocation the store already refused to keep', async () => {
    fixture.setQueueStatus('matched')
    // The write boundary is where this is caught, so the route never sees the bad room id at all.
    expect(fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match 7',
      expiresAtMs: NOW + 60_000,
    })).toEqual({ ok: false, reason: 'invalid-room-id' })

    const response = await createHiveRoomTokenHandler(() => fixture.runtime)(
      post('/api/hive/room-token', {}, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'match_not_allocated' })
  })

  /**
   * The other half of "the signer never throws here": the identity is not the allocator's to get
   * wrong, but it is still an input to `issueRoomToken`. Every id a session cookie can carry has to
   * be one the signer accepts, and this pins that rather than assuming it.
   */
  it('signs for every identity shape a verified session can carry', () => {
    for (const playerId of ['1', '9'.repeat(19), '1234567890123']) {
      expect(isHivePlayerId(playerId)).toBe(true)
      expect(isRoomTokenId(playerId)).toBe(true)
    }
  })

  it('answers 503 rather than signing with an absent secret', async () => {
    const unconfigured: HiveRuntime = {
      status: 'unconfigured',
      capability: { configured: false, blockers: ['ROOM_TOKEN_SECRET'] },
    }

    const response = await createHiveRoomTokenHandler(() => unconfigured)(
      post('/api/hive/room-token', {}, { cookie: sessionCookie() }),
    )

    expect(response.status).toBe(503)
  })
})

/**
 * `Content-Length` is a claim like any other, and a chunked body never makes one at all. What
 * actually bounds this process is how much it is willing to hold before it stops reading, so the
 * limit is tested through a body that arrives in pieces and keeps offering more.
 */
describe('request body bounds', () => {
  const LIMIT = 2_048
  /** 20 KB offered 512 bytes at a time: far more than a bounded reader should ever accept. */
  const FLOOD = Array.from({ length: 40 }, () => 'a'.repeat(512))

  function pieces(text: string, size = 64): string[] {
    const chunks: string[] = []
    for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size))
    return chunks
  }

  /** An otherwise valid session body padded to exactly `bytes` ASCII characters. */
  function sessionBodyOf(bytes: number): string {
    const shell = JSON.stringify({ accessToken: '', ...IDENTITY })
    return JSON.stringify({ accessToken: 'a'.repeat(bytes - shell.length), ...IDENTITY })
  }

  it('reads a chunked body that stays within the limit', async () => {
    const { request, log } = streamingPost('/api/hive/session', pieces(sessionBodyOf(LIMIT)))

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(200)
    expect(fixture.authCalls).toHaveLength(1)
    expect(log.bytesProduced).toBe(LIMIT)
    expect(log.cancelled).toBe(false)
  })

  it('refuses one byte past the limit', async () => {
    const { request } = streamingPost('/api/hive/session', pieces(sessionBodyOf(LIMIT + 1)))

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload_too_large' })
    expect(fixture.authCalls).toHaveLength(0)
  })

  it('stops reading a chunked flood that declares no length at all', async () => {
    const { request, log } = streamingPost('/api/hive/session', FLOOD)
    expect(request.headers.get('content-length')).toBe(null)

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(413)
    expect(fixture.authCalls).toHaveLength(0)
    // The refusal happens on the chunk that crosses the limit, not after draining 20 KB.
    expect(log.bytesProduced).toBeLessThanOrEqual(LIMIT + 512)
    expect(log.pulls).toBeLessThanOrEqual(8)
    expect(log.cancelled).toBe(true)
  })

  it('stops reading a flood that lies about its length', async () => {
    const { request, log } = streamingPost('/api/hive/session', FLOOD, { contentLength: '12' })

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(413)
    expect(log.bytesProduced).toBeLessThanOrEqual(LIMIT + 512)
    expect(log.cancelled).toBe(true)
  })

  it('refuses a declared length over the limit without reading the body', async () => {
    const { request, log } = streamingPost('/api/hive/session', FLOOD, { contentLength: '20480' })

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(413)
    expect(request.bodyUsed).toBe(false)
    // A `ReadableStream` primes one chunk for itself; nothing beyond that is ever asked for.
    expect(log.bytesProduced).toBeLessThanOrEqual(512)
  })

  it('counts bytes rather than characters, so multi-byte padding cannot slip past', async () => {
    // 1 024 code units, 3 072 UTF-8 bytes: under the old character check, over the byte limit.
    const { request, log } = streamingPost('/api/hive/session', pieces(`"${'★'.repeat(1_024)}"`))

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(413)
    expect(log.cancelled).toBe(true)
  })

  it('treats a request with no body at all as an empty object', async () => {
    fixture.setQueueStatus('matched')
    fixture.allocations.record({
      playerId: IDENTITY.playerId,
      roomId: 'match-7',
      expiresAtMs: NOW + 60_000,
    })

    const request = new Request(`${ORIGIN}/api/hive/room-token`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: sessionCookie() },
    })
    expect(request.body).toBe(null)

    const response = await createHiveRoomTokenHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(200)
  })

  it('refuses a chunked body that is not JSON', async () => {
    const { request } = streamingPost('/api/hive/session', pieces('{"accessToken": '))

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })

  it('refuses a body whose stream fails midway', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"accessToken":'))
        controller.error(new Error('connection reset'))
      },
    })
    const request = new Request(`${ORIGIN}/api/hive/session`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit)

    const response = await createHiveSessionHandler(() => fixture.runtime)(request)

    expect(response.status).toBe(400)
    expect(fixture.authCalls).toHaveLength(0)
  })
})
