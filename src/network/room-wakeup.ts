import { HELLBREAK_ROOM_NAME } from '../shared/multiplayer-protocol'
import type { RoomJoinMode } from '../shared/multiplayer-protocol'

/**
 * Waking the free-tier room server before anyone asks it for a room.
 *
 * The public demo runs on a free Render instance, which is suspended after idling and takes tens of
 * seconds to come back. Colyseus discovers that the hard way: `client.create()` posts to
 * `/matchmake/...` and the browser rejects that request with `Failed to fetch` while the instance is
 * still booting. That is a truthful description of one TCP connection and a useless thing to show a
 * player, so the readiness question is asked here instead — of `/health`, which is cheap, has no
 * side effects, and can be retried without ever leaving a room behind.
 *
 * Everything with a schedule in it is injected: the fetch, the waits, and the clock. That is what
 * lets a ninety-second cold start be tested in milliseconds, and it is why this module holds no
 * React and no Colyseus.
 */

export interface RoomHealthReport {
  ok: boolean
  room: string
  guestJoin: boolean
  authenticatedJoin: boolean
}

/** The only part of `RequestInit` this probe uses, named so a test double can be exact. */
export interface RoomHealthRequest {
  method: 'GET'
  headers: Record<string, string>
  signal: AbortSignal
  cache: 'no-store'
}

/** The only part of `Response` this probe reads. */
export interface RoomHealthResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type RoomHealthFetch = (url: string, request: RoomHealthRequest) => Promise<RoomHealthResponse>

export type RoomWakeFailure =
  /** Nothing usable answered inside the budget. Almost always still-booting, sometimes down. */
  | 'unreachable'
  /** The server answered plainly, and it does not accept this way of joining. */
  | 'mode-closed'
  /** The caller withdrew: unmounted, left, or asked for a different room. */
  | 'cancelled'

export type RoomWakeOutcome =
  | { ready: true; health: RoomHealthReport; attempts: number; elapsedMs: number }
  | { ready: false; failure: RoomWakeFailure; attempts: number; elapsedMs: number }

export interface RoomWakeLimits {
  /** Longest a single probe may stay outstanding before it is abandoned and retried. */
  attemptTimeoutMs: number
  /** Ceiling on the whole wake, probes and pauses together. Nothing here can outlive it. */
  totalBudgetMs: number
  /** Pause before each retry. The last entry repeats once the list runs out. */
  backoffMs: readonly number[]
  /** Cap on probes, so an endpoint that fails instantly cannot spin inside the time budget. */
  maxAttempts: number
}

/**
 * Sized against an observed Render cold start: the first request after idle hung past 30 s and a
 * retry with a 90 s allowance succeeded.
 *
 * A single probe is abandoned well before that, because a hung connection is not information and
 * a fresh one is how the instance gets poked again. The wall-clock ceiling is the real bound; the
 * attempt cap only exists so a connection refused in a millisecond cannot burn the budget in a
 * tight loop.
 */
export const DEFAULT_ROOM_WAKE_LIMITS: RoomWakeLimits = {
  attemptTimeoutMs: 15_000,
  totalBudgetMs: 90_000,
  backoffMs: [1_000, 2_000, 3_000, 5_000, 5_000],
  maxAttempts: 8,
}

export interface RoomWakeOptions {
  /** The Colyseus endpoint. `/health` is derived from it rather than configured separately. */
  endpoint: string
  /** Which way in has to be open before this counts as ready. Defaults to the guest demo. */
  mode?: RoomJoinMode
  /** Aborts the wake, including whatever request is outstanding. */
  signal?: AbortSignal
  limits?: Partial<RoomWakeLimits>
  fetch?: RoomHealthFetch
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

/**
 * `/health` under the configured endpoint.
 *
 * Colyseus takes `ws://`/`wss://` for the same server, but health is only ever served over HTTP, so
 * both are rewritten rather than left to fail as an unsupported scheme.
 */
export function roomHealthUrl(endpoint: string): string {
  const overHttp = endpoint.trim().replace(/^ws(s?):\/\//i, 'http$1://')
  return `${overHttp.replace(/\/+$/, '')}/health`
}

/**
 * The health answer is untrusted input like any other.
 *
 * A parked domain, a proxy error page, and a captive portal all answer 200, and a browser that
 * treated any of them as readiness would go straight back to the `Failed to fetch` this module
 * exists to prevent. Only this game's room server, saying it is up, in the shape it publishes,
 * counts — everything else is "not yet".
 */
export function parseRoomHealth(payload: unknown): RoomHealthReport | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const { ok, room, guestJoin, authenticatedJoin } = payload as Record<string, unknown>
  if (ok !== true || room !== HELLBREAK_ROOM_NAME) return null
  if (typeof guestJoin !== 'boolean' || typeof authenticatedJoin !== 'boolean') return null
  return { ok, room, guestJoin, authenticatedJoin }
}

/** Whether an awake server accepts this way in. The room re-decides; this only avoids a pointless join. */
export function healthAdvertises(health: RoomHealthReport, mode: RoomJoinMode): boolean {
  return mode === 'authenticated' ? health.authenticatedJoin : health.guestJoin
}

type ProbeOutcome =
  | { kind: 'ready'; health: RoomHealthReport }
  | { kind: 'closed' }
  | { kind: 'not-ready' }
  | { kind: 'cancelled' }

type RequestOutcome =
  | { kind: 'answered'; health: RoomHealthReport | null }
  | { kind: 'failed' }
  | { kind: 'expired' }

function timerDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', settle)
      resolve()
    }
    timer = setTimeout(settle, ms)
    signal?.addEventListener('abort', settle, { once: true })
  })
}

const browserFetch: RoomHealthFetch = (url, request) => fetch(url, request)

/**
 * One probe, bounded.
 *
 * The timeout races the whole request *including reading the body*, and also aborts it. Aborting
 * alone would trust the transport to honour the signal, and racing alone would leak a connection;
 * doing both means a stalled instance costs one attempt and nothing else.
 */
async function probeRoomHealth(
  url: string,
  mode: RoomJoinMode,
  timeoutMs: number,
  deps: { fetch: RoomHealthFetch; delay: (ms: number, signal?: AbortSignal) => Promise<void> },
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  if (signal.aborted) return { kind: 'cancelled' }

  const attempt = new AbortController()
  const cancel = () => attempt.abort()
  signal.addEventListener('abort', cancel, { once: true })

  const request = async (): Promise<RequestOutcome> => {
    try {
      const response = await deps.fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: attempt.signal,
        // A cached answer would say a suspended instance is up, which is the opposite of the point.
        cache: 'no-store',
      })
      if (!response.ok) return { kind: 'failed' }
      return { kind: 'answered', health: parseRoomHealth(await response.json()) }
    } catch {
      // A refused connection, a CORS failure, an abort, and unparseable JSON are all "not yet".
      return { kind: 'failed' }
    }
  }

  try {
    const settled = await Promise.race<RequestOutcome>([
      request(),
      deps.delay(timeoutMs, attempt.signal).then(() => ({ kind: 'expired' as const })),
    ])
    // Checked after the race, because an outer cancellation surfaces as an abandoned request.
    if (signal.aborted) return { kind: 'cancelled' }
    if (settled.kind !== 'answered' || settled.health === null) return { kind: 'not-ready' }
    if (!healthAdvertises(settled.health, mode)) return { kind: 'closed' }
    return { kind: 'ready', health: settled.health }
  } finally {
    // Settles the losing arm of the race, whichever it was: no dangling request, no live timer.
    attempt.abort()
    signal.removeEventListener('abort', cancel)
  }
}

function backoffFor(backoffMs: readonly number[], completedAttempts: number): number {
  if (backoffMs.length === 0) return 0
  return backoffMs[Math.min(completedAttempts - 1, backoffMs.length - 1)]
}

/**
 * Probes `/health` until the room server is ready to be joined, the caller cancels, or the budget
 * runs out. Never throws, and never leaves a timer or a listener behind.
 */
export async function wakeRoomServer(options: RoomWakeOptions): Promise<RoomWakeOutcome> {
  const limits = { ...DEFAULT_ROOM_WAKE_LIMITS, ...options.limits }
  const deps = {
    fetch: options.fetch ?? browserFetch,
    delay: options.delay ?? timerDelay,
  }
  const now = options.now ?? Date.now
  const signal = options.signal ?? new AbortController().signal
  const mode = options.mode ?? 'guest'
  const url = roomHealthUrl(options.endpoint)

  const startedAt = now()
  const elapsedMs = () => now() - startedAt
  let attempts = 0

  const stop = (failure: RoomWakeFailure): RoomWakeOutcome =>
    ({ ready: false, failure, attempts, elapsedMs: elapsedMs() })

  while (true) {
    if (signal.aborted) return stop('cancelled')
    const budgetLeft = limits.totalBudgetMs - elapsedMs()
    if (budgetLeft <= 0) return stop('unreachable')

    attempts += 1
    const probe = await probeRoomHealth(
      url,
      mode,
      Math.min(limits.attemptTimeoutMs, budgetLeft),
      deps,
      signal,
    )
    if (probe.kind === 'ready') {
      return { ready: true, health: probe.health, attempts, elapsedMs: elapsedMs() }
    }
    if (probe.kind === 'closed') return stop('mode-closed')
    if (probe.kind === 'cancelled') return stop('cancelled')
    if (attempts >= limits.maxAttempts) return stop('unreachable')

    const remaining = limits.totalBudgetMs - elapsedMs()
    if (remaining <= 0) return stop('unreachable')
    const pause = Math.min(backoffFor(limits.backoffMs, attempts), remaining)
    if (pause > 0) await deps.delay(pause, signal)
  }
}
