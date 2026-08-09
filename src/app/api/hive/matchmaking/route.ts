import { createHiveMatchmakingHandler } from '../../../../server/hive/routes'
import { hiveRuntimeFromEnv } from '../../../../server/hive/runtime'

/** Queue intent only: the identity comes from the session cookie, never from the body. */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = createHiveMatchmakingHandler(hiveRuntimeFromEnv)
