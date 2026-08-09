'use client'

import { useEffect, useState } from 'react'
import {
  hiveCapabilityEndpoint,
  parseHiveCapability,
  readClientBuildFlags,
  resolveMultiplayerModes,
  shouldProbeHiveCapability,
} from '../shared/multiplayer-modes'
import type { HiveCapabilityReport, MultiplayerCapabilityInput } from '../shared/multiplayer-modes'

/**
 * Resolves which multiplayer branches this build may honestly offer.
 *
 * All of the decision logic lives in `src/shared/multiplayer-modes.ts` and is unit tested there;
 * this hook only supplies the two build flags and, when a probe could still change the answer, the
 * server's own capability report.
 *
 * The probe is deliberately conditional. On the static Pages export there is no server to ask, so
 * no request is made and the branch is closed with the "this is the static build" explanation. A
 * build that has not shipped the browser HIVE login is closed for that reason before any network
 * call, because a configured server cannot make a missing login flow appear.
 */
export function useMultiplayerModes(roomEndpointConfigured: boolean) {
  const [serverCapability, setServerCapability] = useState<HiveCapabilityReport | null>(null)

  const input: MultiplayerCapabilityInput = {
    ...readClientBuildFlags({
      staticExport: process.env.NEXT_PUBLIC_STATIC_EXPORT,
      hiveLogin: process.env.NEXT_PUBLIC_HIVE_LOGIN,
    }),
    serverCapability,
    roomEndpointConfigured,
  }

  const probeWanted = shouldProbeHiveCapability(input)

  useEffect(() => {
    if (!probeWanted) return
    const controller = new AbortController()

    void (async () => {
      try {
        const response = await fetch(
          hiveCapabilityEndpoint(process.env.NEXT_PUBLIC_BASE_PATH ?? ''),
          { signal: controller.signal, headers: { Accept: 'application/json' } },
        )
        // A non-JSON answer is what a static host returns for a route that does not exist, and it
        // has to read as "not configured" rather than as an exception.
        setServerCapability(parseHiveCapability(response.ok ? await response.json() : null))
      } catch {
        if (!controller.signal.aborted) setServerCapability({ configured: false, blockers: [] })
      }
    })()

    return () => controller.abort()
  }, [probeWanted])

  return resolveMultiplayerModes(input)
}
