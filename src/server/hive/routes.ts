import { HiveProviderError } from './contracts'
import type { HiveAuthProvider, HiveMatchmakingProvider } from './contracts'
import type { HiveCapability, HiveServerConfig } from './config'
import type { MatchAllocationStore } from './allocation'
import {
  DEFAULT_ROOM_TOKEN_TTL_MS,
  isRoomTokenId,
  issueRoomToken,
} from './sign-room-token'
import {
  DEFAULT_SESSION_TTL_MS,
  issueBrowserSession,
  readBrowserSession,
  serializeSessionCookie,
} from './session'

/**
 * The HIVE server boundary, as pure request handlers.
 *
 * The Next.js route files are three-line adapters over these factories, so every rule below is
 * testable without a running server. Three invariants hold across all of them:
 *
 * 1. **Secrets stay here.** No response body, header, or error ever contains the HIVE server API
 *    key, the signing secret, or the player's HIVE access token.
 * 2. **The browser expresses intent, never authority.** Identity comes from the signed session
 *    cookie and the room comes from the allocator. A body field named `playerId` or `roomId` is
 *    rejected outright rather than ignored, so a client cannot believe it chose either.
 * 3. **Unavailable is said out loud.** A deployment without configuration answers 503 with the
 *    names of the missing keys, so the lobby can explain itself instead of guessing.
 */

export type HiveRuntime =
  | {
    status: 'ready'
    config: HiveServerConfig
    auth: HiveAuthProvider
    matchmaking: HiveMatchmakingProvider
    allocations: MatchAllocationStore
    now: () => number
  }
  | { status: 'unconfigured'; capability: HiveCapability }

export type HiveRuntimeResolver = () => HiveRuntime
export type HiveRouteHandler = (request: Request) => Promise<Response>

/** Every documented body on this boundary is tiny; 2 KB is generous for all three. */
const MAX_REQUEST_BYTES = 2_048
const MAX_MATCH_POINT = 999_999_999

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

const badRequest = () => json(400, { error: 'invalid_request' })
const unauthenticated = () => json(401, { error: 'unauthenticated' })

function unconfigured(capability: HiveCapability): Response {
  return json(503, { error: 'hive_not_configured', blockers: capability.blockers })
}

/** A HIVE outage is not the caller's fault, and a HIVE refusal is not our outage. */
function hiveFailure(error: unknown): Response {
  if (error instanceof HiveProviderError && error.kind === 'rejected') {
    return json(401, { error: 'hive_rejected' })
  }
  return json(502, { error: 'hive_unavailable' })
}

/**
 * `SameSite=Strict` already stops a cross-site page from spending the session, and this refuses the
 * request one step earlier. An absent Origin (a same-origin fetch in some browsers, or a server
 * caller) is allowed; a *present and foreign* one never is.
 */
function originAllowed(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get('origin')
  return origin === null || origin === appOrigin
}

type BodyRead =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response }

const payloadTooLarge = () => json(413, { error: 'payload_too_large' })

/**
 * Reads at most `MAX_REQUEST_BYTES` of a request body, and stops reading the moment it knows the
 * body is bigger than that.
 *
 * `Content-Length` is checked first because a caller that admits to being oversized can be refused
 * without touching the socket — but it is only a claim, and a chunked body makes no claim at all.
 * So the body is pulled a chunk at a time and counted in *bytes*, the stream is cancelled as soon
 * as the limit is crossed, and nothing is decoded or parsed until the byte count is known to be
 * bounded. Buffering first and measuring afterwards is what let an unbounded upload become
 * unbounded memory in this process.
 */
async function readJsonBody(request: Request): Promise<BodyRead> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return { ok: false, response: payloadTooLarge() }
  }

  const body = request.body
  if (body === null) return { ok: true, value: {} }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        // Tells the producer to stop rather than draining what it has left to send.
        await reader.cancel().catch(() => {})
        return { ok: false, response: payloadTooLarge() }
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => {})
    return { ok: false, response: badRequest() }
  }

  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  let parsed: unknown
  try {
    const text = new TextDecoder().decode(buffer)
    parsed = text.length === 0 ? {} : JSON.parse(text)
  } catch {
    return { ok: false, response: badRequest() }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: badRequest() }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

/** Rejects rather than ignores unexpected fields, so a client is never silently overruled. */
function hasOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function sessionOf(runtime: Extract<HiveRuntime, { status: 'ready' }>, request: Request) {
  return readBrowserSession(request.headers.get('cookie'), {
    secret: runtime.config.roomTokenSecret,
    nowMs: runtime.now(),
  })
}

export function createHiveCapabilityHandler(resolve: HiveRuntimeResolver): HiveRouteHandler {
  return async () => {
    const runtime = resolve()
    return runtime.status === 'ready'
      ? json(200, { configured: true, blockers: [] })
      : json(200, { configured: false, blockers: runtime.capability.blockers })
  }
}

export function createHiveSessionHandler(resolve: HiveRuntimeResolver): HiveRouteHandler {
  return async (request) => {
    const runtime = resolve()
    if (runtime.status !== 'ready') return unconfigured(runtime.capability)
    if (!originAllowed(request, runtime.config.appOrigin)) return json(403, { error: 'forbidden_origin' })

    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const { accessToken, playerId, deviceId } = body.value
    if (
      !hasOnlyKeys(body.value, ['accessToken', 'playerId', 'deviceId'])
      || !isNonEmptyString(accessToken)
      || !isNonEmptyString(playerId)
      || !isNonEmptyString(deviceId)
    ) return badRequest()

    let verified
    try {
      verified = await runtime.auth.verifySession({ accessToken, playerId, deviceId })
    } catch (error) {
      return hiveFailure(error)
    }

    const nowMs = runtime.now()
    const session = issueBrowserSession({
      identity: verified.identity,
      nowMs,
      secret: runtime.config.roomTokenSecret,
    })

    return json(200, {
      playerId: verified.identity.playerId,
      expiresAtMs: session.expiresAtMs,
    }, {
      'Set-Cookie': serializeSessionCookie(session.value, {
        maxAgeSeconds: DEFAULT_SESSION_TTL_MS / 1_000,
        secure: runtime.config.appOrigin.startsWith('https:'),
      }),
    })
  }
}

export function createHiveMatchmakingHandler(resolve: HiveRuntimeResolver): HiveRouteHandler {
  return async (request) => {
    const runtime = resolve()
    if (runtime.status !== 'ready') return unconfigured(runtime.capability)
    if (!originAllowed(request, runtime.config.appOrigin)) return json(403, { error: 'forbidden_origin' })

    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const { action, point } = body.value
    if (
      !hasOnlyKeys(body.value, ['action', 'point'])
      || (action !== 'enqueue' && action !== 'status' && action !== 'cancel')
      || (point !== undefined
        && (!Number.isInteger(point) || (point as number) < 0 || (point as number) > MAX_MATCH_POINT))
    ) return badRequest()

    const session = sessionOf(runtime, request)
    if (!session.ok) return unauthenticated()
    const { playerId } = session.identity

    // Cancelling or queueing again ends the attempt that any existing assignment belongs to, so it
    // is dropped here — before HIVE is asked for anything, so that an upstream error cannot leave a
    // room this player has left still signable. `status` is a read and ends nothing.
    if (action === 'cancel' || action === 'enqueue') runtime.allocations.invalidate(playerId)

    try {
      if (action === 'cancel') {
        await runtime.matchmaking.cancel({ playerId })
        return json(200, { status: 'not-requested', roomAssigned: false })
      }
      const ticket = action === 'enqueue'
        ? await runtime.matchmaking.enqueue({ playerId, point: point as number | undefined })
        : await runtime.matchmaking.status({ playerId })

      return json(200, {
        status: ticket.status,
        roomAssigned: runtime.allocations.resolve(playerId, runtime.now()) !== null,
      })
    } catch (error) {
      return hiveFailure(error)
    }
  }
}

export function createHiveRoomTokenHandler(resolve: HiveRuntimeResolver): HiveRouteHandler {
  return async (request) => {
    const runtime = resolve()
    if (runtime.status !== 'ready') return unconfigured(runtime.capability)
    if (!originAllowed(request, runtime.config.appOrigin)) return json(403, { error: 'forbidden_origin' })

    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    // The browser has no input here at all: identity is the cookie, the room is the allocator's.
    if (!hasOnlyKeys(body.value, [])) return badRequest()

    const session = sessionOf(runtime, request)
    if (!session.ok) return unauthenticated()
    const { playerId } = session.identity

    let ticket
    try {
      ticket = await runtime.matchmaking.status({ playerId })
    } catch (error) {
      return hiveFailure(error)
    }
    if (ticket.status !== 'matched') return json(409, { error: 'not_matched' })

    const nowMs = runtime.now()
    const roomId = runtime.allocations.resolve(playerId, nowMs)
    // HIVE reports the match; it does not report where to play it. Until the allocator has an
    // address for this player there is nothing honest to sign.
    if (roomId === null) return json(409, { error: 'match_not_allocated' })
    // The in-process store refuses an unsignable room id at the write, but this interface is the
    // seam a shared implementation will replace, so the read is checked too: a room id the signer
    // would throw on is a broken allocation, and saying that is more use to a caller than a 500.
    if (!isRoomTokenId(roomId)) return json(409, { error: 'match_allocation_invalid' })

    const { token, claims } = issueRoomToken({
      playerId,
      roomId,
      nowMs,
      ttlMs: DEFAULT_ROOM_TOKEN_TTL_MS,
      secret: runtime.config.roomTokenSecret,
    })

    return json(200, { token, roomId, expiresAtMs: claims.expiresAtMs })
  }
}
