import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROOM_WAKE_LIMITS,
  healthAdvertises,
  parseRoomHealth,
  roomHealthUrl,
  wakeRoomServer,
} from './room-wakeup'
import type { RoomHealthRequest, RoomHealthResponse, RoomWakeLimits } from './room-wakeup'

const ENDPOINT = 'https://hellbreak-room.onrender.com'
const HEALTH_URL = 'https://hellbreak-room.onrender.com/health'
const AWAKE = { ok: true, room: 'hellbreak', guestJoin: true, authenticatedJoin: false }

/**
 * Virtual time that only advances when a wait actually completes.
 *
 * Every pause settles on a real macrotask so an already-resolved probe always wins the race a live
 * one would: microtasks drain first, so a fetch that answers cannot be mistaken for one that timed
 * out. A wait cut short by an abort adds nothing, which is what keeps a fast success from being
 * billed for the attempt budget it never spent.
 */
function createTestClock() {
  let current = 0

  const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = (waited: number) => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      current += waited
      resolve()
    }
    const abort = () => stop(0)
    timer = setTimeout(() => stop(ms), 0)
    signal?.addEventListener('abort', abort, { once: true })
  })

  return { now: () => current, delay }
}

function jsonResponse(payload: unknown, status = 200): RoomHealthResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

/** What Render's edge serves while an instance is still booting: a status page, not JSON. */
async function coldStartPage(): Promise<RoomHealthResponse> {
  return {
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
  }
}

type FetchStep = (request: RoomHealthRequest) => Promise<RoomHealthResponse>

/** A request that answers only by rejecting when it is abandoned, like a real hung connection. */
const stalls: FetchStep = (request) => new Promise<RoomHealthResponse>((_, reject) => {
  request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
})

const refuses: FetchStep = () => Promise.reject(new TypeError('Failed to fetch'))

/** Plays one step per call and repeats the last one, so "keeps failing" needs no long script. */
function scriptedFetch(steps: readonly FetchStep[]) {
  const calls: string[] = []
  return {
    calls,
    fetch: (url: string, request: RoomHealthRequest) => {
      calls.push(url)
      return steps[Math.min(calls.length - 1, steps.length - 1)](request)
    },
  }
}

function wake(steps: readonly FetchStep[], overrides: {
  limits?: Partial<RoomWakeLimits>
  signal?: AbortSignal
  mode?: 'guest' | 'authenticated'
} = {}) {
  const clock = createTestClock()
  const scripted = scriptedFetch(steps)
  return {
    calls: scripted.calls,
    elapsed: clock.now,
    outcome: wakeRoomServer({
      endpoint: ENDPOINT,
      mode: overrides.mode,
      signal: overrides.signal,
      limits: overrides.limits,
      fetch: scripted.fetch,
      delay: clock.delay,
      now: clock.now,
    }),
  }
}

describe('health url', () => {
  it.each([
    ['a bare origin', 'https://hellbreak-room.onrender.com', HEALTH_URL],
    ['a trailing slash', 'https://hellbreak-room.onrender.com/', HEALTH_URL],
    ['surrounding whitespace', '  https://hellbreak-room.onrender.com  ', HEALTH_URL],
    ['a local dev endpoint', 'http://127.0.0.1:2567', 'http://127.0.0.1:2567/health'],
    ['a sub-path deployment', 'https://edge.example/room', 'https://edge.example/room/health'],
  ])('builds the probe url from %s', (_label, endpoint, expected) => {
    expect(roomHealthUrl(endpoint)).toBe(expected)
  })

  // Colyseus accepts either scheme for the same server; `/health` is only ever served over HTTP.
  it.each([
    ['wss://hellbreak-room.onrender.com', HEALTH_URL],
    ['ws://127.0.0.1:2567/', 'http://127.0.0.1:2567/health'],
  ])('rewrites the websocket scheme %s', (endpoint, expected) => {
    expect(roomHealthUrl(endpoint)).toBe(expected)
  })
})

describe('health body', () => {
  it('accepts the room server answering for this game', () => {
    expect(parseRoomHealth(AWAKE)).toEqual(AWAKE)
  })

  // Anything that is not this game's room server saying it is up has to read as "not ready yet",
  // never as readiness: a captive portal, a parked domain, and a proxy all answer 200.
  it.each([
    ['a server that says it is not ok', { ...AWAKE, ok: false }],
    ['another service on the same host', { ok: true, room: 'lobby', guestJoin: true, authenticatedJoin: false }],
    ['an answer with no room name', { ok: true, guestJoin: true, authenticatedJoin: false }],
    ['non-boolean join flags', { ...AWAKE, guestJoin: 'yes' }],
    ['a bare string', 'ok'],
    ['an array', [AWAKE]],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_label, payload) => {
    expect(parseRoomHealth(payload)).toBe(null)
  })
})

describe('advertised join modes', () => {
  it('reads guest readiness from the guest flag only', () => {
    expect(healthAdvertises(AWAKE, 'guest')).toBe(true)
    expect(healthAdvertises({ ...AWAKE, guestJoin: false, authenticatedJoin: true }, 'guest')).toBe(false)
  })

  it('reads authenticated readiness from the authenticated flag only', () => {
    expect(healthAdvertises(AWAKE, 'authenticated')).toBe(false)
    expect(healthAdvertises({ ...AWAKE, authenticatedJoin: true }, 'authenticated')).toBe(true)
  })
})

describe('waking the room server', () => {
  it('is ready after a single probe when the server is already awake', async () => {
    const attempt = wake([() => Promise.resolve(jsonResponse(AWAKE))])

    await expect(attempt.outcome).resolves.toEqual({
      ready: true,
      health: AWAKE,
      attempts: 1,
      elapsedMs: 0,
    })
    expect(attempt.calls).toEqual([HEALTH_URL])
  })

  it('sends a no-store GET so a cached answer cannot stand in for a live one', async () => {
    const seen: RoomHealthRequest[] = []
    const clock = createTestClock()
    await wakeRoomServer({
      endpoint: ENDPOINT,
      fetch: (_url, request) => {
        seen.push(request)
        return Promise.resolve(jsonResponse(AWAKE))
      },
      delay: clock.delay,
      now: clock.now,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0].method).toBe('GET')
    expect(seen[0].cache).toBe('no-store')
    expect(seen[0].headers).toEqual({ Accept: 'application/json' })
  })

  it('keeps probing through a refused connection and a boot page, then reports ready', async () => {
    const attempt = wake([
      refuses,
      refuses,
      coldStartPage,
      () => Promise.resolve(jsonResponse(AWAKE)),
    ])

    await expect(attempt.outcome).resolves.toMatchObject({ ready: true, attempts: 4 })
    expect(attempt.calls).toHaveLength(4)
    // Backed off between probes rather than hammering the instance that is trying to boot.
    expect(attempt.elapsed()).toBe(
      DEFAULT_ROOM_WAKE_LIMITS.backoffMs[0]
      + DEFAULT_ROOM_WAKE_LIMITS.backoffMs[1]
      + DEFAULT_ROOM_WAKE_LIMITS.backoffMs[2],
    )
  })

  // The reported symptom: the first request after idle hangs until it is abandoned.
  it('survives a real cold start where early probes hang before one answers', async () => {
    const attempt = wake([stalls, stalls, () => Promise.resolve(jsonResponse(AWAKE))])

    await expect(attempt.outcome).resolves.toMatchObject({ ready: true, attempts: 3 })
    expect(attempt.elapsed()).toBe(
      DEFAULT_ROOM_WAKE_LIMITS.attemptTimeoutMs * 2
      + DEFAULT_ROOM_WAKE_LIMITS.backoffMs[0]
      + DEFAULT_ROOM_WAKE_LIMITS.backoffMs[1],
    )
    expect(attempt.elapsed()).toBeLessThan(DEFAULT_ROOM_WAKE_LIMITS.totalBudgetMs)
  })

  it('gives up on a server that never comes back, inside the attempt cap', async () => {
    const attempt = wake([refuses])

    await expect(attempt.outcome).resolves.toMatchObject({
      ready: false,
      failure: 'unreachable',
      attempts: DEFAULT_ROOM_WAKE_LIMITS.maxAttempts,
    })
    expect(attempt.calls).toHaveLength(DEFAULT_ROOM_WAKE_LIMITS.maxAttempts)
    expect(attempt.elapsed()).toBeLessThanOrEqual(DEFAULT_ROOM_WAKE_LIMITS.totalBudgetMs)
  })

  it('abandons requests that never answer instead of waiting forever', async () => {
    const attempt = wake([stalls])
    const outcome = await attempt.outcome

    expect(outcome).toMatchObject({ ready: false, failure: 'unreachable' })
    // The wall clock, not the attempt cap, is what stops a hang: every probe spends its full budget.
    expect(attempt.elapsed()).toBeLessThanOrEqual(DEFAULT_ROOM_WAKE_LIMITS.totalBudgetMs)
    expect(attempt.calls.length).toBeLessThan(DEFAULT_ROOM_WAKE_LIMITS.maxAttempts)
    expect(attempt.calls.length).toBeGreaterThan(1)
  })

  it('never spends longer than the caller allowed, however the probes fail', async () => {
    const limits = { attemptTimeoutMs: 400, totalBudgetMs: 1_000, backoffMs: [100], maxAttempts: 50 }
    const attempt = wake([stalls], { limits })

    await expect(attempt.outcome).resolves.toMatchObject({ ready: false, failure: 'unreachable' })
    expect(attempt.elapsed()).toBeLessThanOrEqual(limits.totalBudgetMs)
  })

  // A deployment that answers plainly is telling the truth already; retrying cannot change it.
  it('stops at once when the awake server does not accept this join mode', async () => {
    const attempt = wake([() => Promise.resolve(jsonResponse({ ...AWAKE, guestJoin: false }))])

    await expect(attempt.outcome).resolves.toMatchObject({
      ready: false,
      failure: 'mode-closed',
      attempts: 1,
    })
    expect(attempt.calls).toHaveLength(1)
  })

  it('checks the authenticated flag when that is the mode being opened', async () => {
    const closed = wake([() => Promise.resolve(jsonResponse(AWAKE))], { mode: 'authenticated' })
    await expect(closed.outcome).resolves.toMatchObject({ failure: 'mode-closed' })

    const open = wake(
      [() => Promise.resolve(jsonResponse({ ...AWAKE, authenticatedJoin: true }))],
      { mode: 'authenticated' },
    )
    await expect(open.outcome).resolves.toMatchObject({ ready: true })
  })

  it('makes no request at all when it is cancelled before it starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const attempt = wake([() => Promise.resolve(jsonResponse(AWAKE))], { signal: controller.signal })

    await expect(attempt.outcome).resolves.toMatchObject({
      ready: false,
      failure: 'cancelled',
      attempts: 0,
    })
    expect(attempt.calls).toEqual([])
  })

  it('stops probing as soon as the caller cancels a wake already under way', async () => {
    const controller = new AbortController()
    const attempt = wake(
      [(request) => {
        controller.abort()
        return Promise.reject(request.signal.aborted ? new Error('aborted') : new TypeError('Failed to fetch'))
      }],
      { signal: controller.signal },
    )

    await expect(attempt.outcome).resolves.toMatchObject({ ready: false, failure: 'cancelled' })
    expect(attempt.calls).toHaveLength(1)
  })

  it('cancels the outstanding request rather than leaving it running', async () => {
    const controller = new AbortController()
    let aborted = false
    const attempt = wake(
      [(request) => {
        request.signal.addEventListener('abort', () => { aborted = true }, { once: true })
        controller.abort()
        return stalls(request)
      }],
      { signal: controller.signal },
    )

    await expect(attempt.outcome).resolves.toMatchObject({ failure: 'cancelled' })
    expect(aborted).toBe(true)
  })

  it('reports a ready server even when the first answer arrives on the last allowed attempt', async () => {
    const limits = { maxAttempts: 2 }
    const attempt = wake([refuses, () => Promise.resolve(jsonResponse(AWAKE))], { limits })

    await expect(attempt.outcome).resolves.toMatchObject({ ready: true, attempts: 2 })
  })
})
