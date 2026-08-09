import { createHiveRoomTokenHandler } from '../../../../server/hive/routes'
import { hiveRuntimeFromEnv } from '../../../../server/hive/runtime'

/**
 * Mints the short-lived room join capability. The request body must be empty: identity comes from
 * the session cookie and the room comes from the allocator, so there is nothing for a client to say.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = createHiveRoomTokenHandler(hiveRuntimeFromEnv)
