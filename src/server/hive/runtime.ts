import { createHiveAuthProvider } from './auth'
import { createHiveMatchmakingProvider } from './matchmaking'
import { createMatchAllocationStore } from './allocation'
import { describeHiveCapability, readHiveConfig } from './config'
import type { HiveRuntime } from './routes'
import { createFetchTransport } from './transport'

/**
 * Composition root for the HIVE routes.
 *
 * Everything above this line is injectable and unit-tested; this is the one place that reads
 * `process.env` and creates a real network transport. It resolves per request so that a deployment
 * which gains configuration does not need a restart to start answering, and so a deployment which
 * never had any keeps answering 503 with the names of what it is missing.
 *
 * The allocation store is process-wide on purpose: it has to outlive a single request.
 */

/** One clock for the whole boundary: the store expires by it and the routes read by it. */
const now = () => Date.now()
const allocations = createMatchAllocationStore({ now })
const transport = createFetchTransport()

export function hiveRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env,
): HiveRuntime {
  const result = readHiveConfig(env)
  if (!result.ok) return { status: 'unconfigured', capability: describeHiveCapability(env) }

  const { config } = result
  return {
    status: 'ready',
    config,
    allocations,
    now,
    auth: createHiveAuthProvider(config, transport),
    matchmaking: createHiveMatchmakingProvider(config, transport),
  }
}
