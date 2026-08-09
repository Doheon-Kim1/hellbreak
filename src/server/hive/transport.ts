import { HiveProviderError } from './contracts'
import type { HiveTransport } from './contracts'

/**
 * The only place in HELLBREAK that performs an outbound HIVE request.
 *
 * It is deliberately thin: adapters decide *what* to send and how to read the answer, this decides
 * how long to wait and how much to read. Both limits exist because a route handler blocked on a
 * slow upstream, or reading an unbounded body, is a denial-of-service surface on our side.
 *
 * Redirects are refused rather than followed, so a compromised or misconfigured upstream cannot
 * bounce a request that carries the server API key to another host.
 */

export interface FetchTransportOptions {
  timeoutMs?: number
  maxResponseBytes?: number
  fetchImpl?: typeof fetch
}

export const DEFAULT_HIVE_TIMEOUT_MS = 5_000
export const DEFAULT_HIVE_MAX_RESPONSE_BYTES = 64 * 1_024

/** Reads at most `maxBytes` and cancels the stream instead of buffering whatever arrives. */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const stream = response.body
  if (!stream) return ''

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new HiveProviderError('malformed-response', 'HIVE response exceeded the size ceiling')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export function createFetchTransport(options: FetchTransportOptions = {}): HiveTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HIVE_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_HIVE_MAX_RESPONSE_BYTES
  const fetchImpl = options.fetchImpl ?? fetch

  return async ({ url, method, headers, body }) => {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })

    return { status: response.status, body: await readBounded(response, maxResponseBytes) }
  }
}
