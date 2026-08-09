/**
 * The explicit split between the two ways to play online.
 *
 * HELLBREAK ships from two topologies at once, and they must not be entangled:
 *
 * - **guest** — the static GitHub Pages build talking to the public Render room server. No login,
 *   no identity, no persistence. This is the demo and it stays working.
 * - **hive** — a server-hosted Next.js origin that verifies a HIVE identity, queues through HIVE
 *   Matchmaking, and issues a short-lived room join capability.
 *
 * The rule this module exists to enforce: the HIVE branch is never presented as available unless a
 * server deployment is actually there to serve it. Every unavailable state carries a reason the
 * player can read, and none of those reasons name an environment variable.
 */

export const MULTIPLAYER_MODES = ['guest', 'hive'] as const
export type MultiplayerModeId = (typeof MULTIPLAYER_MODES)[number]

export type MultiplayerBlocker =
  /** This bundle is the static export: there are no server routes in it to call. */
  | 'static-export'
  /** The build does not ship a HIVE browser login, so a session can never be started from here. */
  | 'login-unwired'
  /** The capability probe has not answered yet, or failed. */
  | 'capability-unknown'
  /** The server answered, and it is missing HIVE configuration. */
  | 'server-unconfigured'
  /** No Colyseus address is configured, so even the guest demo has nowhere to connect. */
  | 'room-endpoint-missing'

export interface HiveCapabilityReport {
  configured: boolean
  blockers: string[]
}

export interface MultiplayerCapabilityInput {
  /** True when this bundle came from `GITHUB_PAGES=true npm run build`. */
  staticExport: boolean
  /** True when this build ships the HIVE browser login flow. */
  hiveLoginWired: boolean
  /** The latest answer from `GET /api/hive/session`, or `null` when none has arrived. */
  serverCapability: HiveCapabilityReport | null
  roomEndpointConfigured: boolean
}

export interface MultiplayerModeView {
  id: MultiplayerModeId
  label: string
  description: string
  available: boolean
  blocker: MultiplayerBlocker | null
  /** Player-facing reason. Never contains a key name, a URL, or a secret. */
  explanation: string | null
}

const EXPLANATIONS: Record<MultiplayerBlocker, string> = {
  'static-export': 'HIVE 인증 대기열은 서버가 필요합니다. 정적 GitHub Pages 빌드에서는 제공되지 않고, 정식 앱 주소에서만 열립니다.',
  'login-unwired': 'HIVE 웹 로그인이 이 빌드에 아직 연결되지 않았습니다. 연결 전까지는 게스트 데모로 플레이하세요.',
  'capability-unknown': 'HIVE 서버 상태를 확인하는 중입니다. 확인되기 전에는 대기열을 열 수 없습니다.',
  'server-unconfigured': 'HIVE 서버 설정이 이 배포에 아직 주입되지 않았습니다. 운영자가 설정을 마치면 열립니다.',
  'room-endpoint-missing': '온라인 룸 서버 주소가 설정되지 않았습니다.',
}

function view(
  id: MultiplayerModeId,
  label: string,
  description: string,
  blocker: MultiplayerBlocker | null,
): MultiplayerModeView {
  return {
    id,
    label,
    description,
    available: blocker === null,
    blocker,
    explanation: blocker === null ? null : EXPLANATIONS[blocker],
  }
}

/**
 * Reasons are checked from the most fundamental to the most specific, so the sentence a player
 * reads is the first thing that would actually have to change for the mode to open.
 */
function hiveBlocker(input: MultiplayerCapabilityInput): MultiplayerBlocker | null {
  if (input.staticExport) return 'static-export'
  if (!input.hiveLoginWired) return 'login-unwired'
  if (input.serverCapability === null) return 'capability-unknown'
  if (!input.serverCapability.configured) return 'server-unconfigured'
  return null
}

export function resolveMultiplayerModes(input: MultiplayerCapabilityInput): {
  guest: MultiplayerModeView
  hive: MultiplayerModeView
} {
  return {
    guest: view(
      'guest',
      '게스트 빠른 플레이',
      '로그인 없이 룸을 만들거나 룸 ID로 참가하는 데모입니다.',
      input.roomEndpointConfigured ? null : 'room-endpoint-missing',
    ),
    hive: view(
      'hive',
      'HIVE 인증 대기열',
      'HIVE 계정으로 인증하고 매치메이킹 대기열을 통해 배정된 룸에 참가합니다.',
      hiveBlocker(input),
    ),
  }
}

/**
 * Turns the two build-time public flags into capability facts.
 *
 * `NEXT_PUBLIC_HIVE_LOGIN` is the seam the browser queue flow flips on when it ships. It is not an
 * operator switch: setting it on a build that has no HIVE login only moves the honest explanation
 * from "this build has no login" to "the server is not configured".
 */
export function readClientBuildFlags(env: {
  staticExport?: string
  hiveLogin?: string
}): Pick<MultiplayerCapabilityInput, 'staticExport' | 'hiveLoginWired'> {
  return {
    staticExport: env.staticExport === 'true',
    hiveLoginWired: env.hiveLogin === 'enabled',
  }
}

/** Only worth a network call when the build already claims it could reach a configured server. */
export function shouldProbeHiveCapability(input: MultiplayerCapabilityInput): boolean {
  return !input.staticExport && input.hiveLoginWired && input.serverCapability === null
}

export function hiveCapabilityEndpoint(basePath: string): string {
  return `${basePath}/api/hive/session`
}

/** The probe answer is untrusted input like any other: an unreadable one means "not configured". */
export function parseHiveCapability(payload: unknown): HiveCapabilityReport {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { configured: false, blockers: [] }
  }
  const { configured, blockers } = payload as { configured?: unknown; blockers?: unknown }
  if (typeof configured !== 'boolean') return { configured: false, blockers: [] }
  const names = Array.isArray(blockers) && blockers.every((name) => typeof name === 'string')
    ? (blockers as string[])
    : []
  return { configured, blockers: names }
}
