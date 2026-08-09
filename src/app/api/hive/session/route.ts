import { createHiveCapabilityHandler, createHiveSessionHandler } from '../../../../server/hive/routes'
import { hiveRuntimeFromEnv } from '../../../../server/hive/runtime'

/**
 * `GET` answers what this deployment can actually do, so the lobby never claims that authenticated
 * matchmaking exists when the keys are absent. `POST` exchanges a HIVE access token for an
 * HttpOnly session cookie.
 *
 * This file is a `.ts` route and the static export build only treats `.tsx` as pages, so no part
 * of it is emitted into the GitHub Pages guest fallback.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createHiveCapabilityHandler(hiveRuntimeFromEnv)
export const POST = createHiveSessionHandler(hiveRuntimeFromEnv)
