import type { NetworkMatchSnapshot, NetworkPlayerSnapshot } from '../shared/multiplayer-protocol'

export interface OnlineHudModel {
  remainingLabel: string
  lavaLabel: string
  statusLabel: string
  winnerLabel: string | null
  finished: boolean
  canMove: boolean
  aliveCount: number
  escapedCount: number
}

export interface RescueLinkView {
  rescuerId: string
  targetId: string
  panic: boolean
}

/** The last link this client saw, so a cleared link can be classified without server history. */
export interface RescueLinkMemory {
  targetId: string
  caughtAtY: number
}

/**
 * Everything the readout needs to remember between authoritative patches. The room publishes no
 * rescue history and no cooldown clock, so the client keeps its own echo of both: the link it was
 * watching, the last rescue receipt it saw, and when it expects the room to accept a rescue again.
 * None of it is authority—the room re-decides every tick—it only makes the outcome readable.
 */
export interface RescueHudMemory {
  link: RescueLinkMemory | null
  /** Match-elapsed second this client expects another rescue to be accepted at; 0 when free. */
  lockedUntil: number
  lockReason: RescueLockReason
  /** Last rescue receipt seen, so a link the room made and dropped in one tick is still readable. */
  acknowledgedGrab: number
}

export type RescueLockReason = 'cooldown' | 'exhausted' | null

/**
 * How the last link ended, limited to what the published snapshot actually proves.
 *
 * The room never publishes why a link ended, and several causes—range break, the teammate
 * landing, the rescuer losing footing, a death, a disconnect—can happen in the same tick and are
 * indistinguishable from outside. Only two endings are provable, so only two are named: the
 * teammate visibly finished above where they were caught (`rescued`), and the published grip bar
 * reached empty as the link disappeared, which is the room's own exhaustion rule (`exhausted`).
 * Everything else is reported as `lost`: a rescue that failed, with no cause claimed.
 *
 * `rescued` is also the only outcome the room does not charge a cooldown for.
 */
export type RescueOutcome = 'rescued' | 'exhausted' | 'lost'

/**
 * One always-present chip state, so the rescue prompt keeps its place in the layout instead of
 * mounting and unmounting while a teammate drifts across the reach boundary.
 */
export type RescueHudState = 'idle' | 'ready' | 'holding' | 'held' | 'cooldown' | 'exhausted'

/** Grip is a spendable resource, so it is banded rather than left as a bare percentage. */
export type RescueGripBand = 'steady' | 'warning' | 'danger'

export interface RescueHudModel {
  state: RescueHudState
  linked: boolean
  showGrip: boolean
  gripPercent: number
  gripBand: RescueGripBand
  targetLabel: string | null
  rescuedByLabel: string | null
  /** Single line for the chip, already resolved for the current state. */
  statusLabel: string
  promptVisible: boolean
  outcome: RescueOutcome | null
  announcement: string | null
  /** Whole tenths of a second left on the client-mirrored lockout; 0 when a rescue is allowed. */
  lockoutSeconds: number
  links: RescueLinkView[]
}

/**
 * Presentation mirrors of the server-owned rescue profile in `src/server/rescue-balance.ts`.
 *
 * They are duplicated rather than imported on purpose: the balance profile stays server-only, and
 * these numbers are all things a player already learns by playing. Nothing here is authority—if a
 * mirror drifts, the room still refuses the rescue and the HUD is merely optimistic for a frame.
 */
const RESCUE_PROMPT_REACH = 2.4
const RESCUE_PROMPT_DROP = 0.3
const RESCUE_PANIC_HEIGHT = 1.5
const RESCUE_LANDING_GAIN = 0.3
const RESCUE_RELEASE_COOLDOWN = 1.4
const RESCUE_EXHAUSTION_COOLDOWN = 3
/** Grip thresholds the warning and danger bands switch at. */
const GRIP_WARNING = 0.55
const GRIP_DANGER = 0.25

const OUTCOME_LABELS: Record<RescueOutcome, string> = {
  rescued: '구조 성공',
  exhausted: '그립 소진',
  lost: '구조 실패',
}

const STATE_LABELS: Record<Exclude<RescueHudState, 'cooldown'>, string> = {
  idle: 'E · 구조 대기',
  ready: 'E · 구조 가능',
  holding: '구조 중',
  held: '구조 받는 중',
  exhausted: '그립 소진 · 회복 중',
}

const LAVA_LABELS: Record<string, string> = {
  calm: '상승 중',
  warning: '폭발 임박',
  surge: '폭발 상승',
}

const WINNER_LABELS: Record<string, string> = {
  runners: '도망자 승리',
  warden: '지옥 간수 승리',
}

export function formatMatchClock(elapsedSeconds: number, durationSeconds: number): string {
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0
  const remaining = Math.max(0, Math.ceil(duration - elapsed))
  const minutes = Math.floor(remaining / 60)
  return `${String(minutes).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
}

/**
 * Presentation-only view of the authoritative rescue state. It never decides a target: the prompt
 * is a hint that mirrors the room's own rules, and every link drawn comes from the server.
 *
 * Announcements are deliberately limited to link milestones. Grip and coordinates change 20 times
 * a second and must never reach an ARIA live region.
 */
export function rescueHudModel(
  players: readonly NetworkPlayerSnapshot[],
  ownPlayerId: string,
  lavaHeight: number,
  memory: RescueHudMemory | null = null,
  elapsed = 0,
): RescueHudModel {
  const own = players.find((player) => player.id === ownPlayerId) ?? null
  const byId = new Map(players.map((player) => [player.id, player]))
  const previousLink = memory?.link ?? null

  const links: RescueLinkView[] = []
  for (const player of players) {
    const target = player.grabTargetId === '' ? undefined : byId.get(player.grabTargetId)
    if (!target) continue
    links.push({
      rescuerId: player.id,
      targetId: target.id,
      panic: target.y - lavaHeight < RESCUE_PANIC_HEIGHT,
    })
  }

  const linked = Boolean(own) && own!.grabTargetId !== ''
  const grip = Number.isFinite(own?.grip) ? Math.min(1, Math.max(0, own!.grip)) : 1

  const rescued = Boolean(own) && own!.grabbedById !== ''

  // A lockout the clock has already passed is over, and one further away than the longest cooldown
  // the room can charge is a leftover from a restarted match rather than a live penalty.
  const remainingLock = (memory?.lockedUntil ?? 0) - elapsed
  const locked = !linked && !rescued
    && remainingLock > 0
    && remainingLock <= RESCUE_EXHAUSTION_COOLDOWN
  const exhausted = !linked && !rescued
    && (grip <= 0 || (locked && memory?.lockReason === 'exhausted'))

  const candidateNearby = Boolean(own) && !linked && !rescued && players.some((player) => (
    player.id !== ownPlayerId
    && player.alive
    && !player.escaped
    && player.grabbedById === ''
    && player.grabTargetId === ''
    && (!player.grounded || player.y <= own!.y - RESCUE_PROMPT_DROP)
    && Math.hypot(player.x - own!.x, player.y - own!.y, player.z - own!.z) <= RESCUE_PROMPT_REACH
  ))
  // The room refuses a rescue during a cooldown or on an empty grip, so the prompt must not
  // promise one either.
  const promptVisible = candidateNearby && !locked && !exhausted

  const justEnded = Boolean(previousLink) && !linked
  const endedTarget = justEnded ? byId.get(previousLink!.targetId) ?? null : null
  // The room made a link and dropped it inside one tick, so no link was ever published and the
  // advancing receipt is the only evidence it happened. That proves an attempt failed and nothing
  // more, least of all why, so it is reported as exactly that.
  const unseenAttemptFailed = Boolean(own) && !linked && !justEnded && memory !== null
    && own!.lastAcknowledgedGrab > memory.acknowledgedGrab

  // Two endings are provable from the snapshot alone: the teammate finished standing measurably
  // above where this client saw them caught, and the grip bar published as empty on the same patch
  // the link disappeared, which is the room's own exhaustion rule and cannot be reached any other
  // way while a link is live. Every other ending — including several causes landing in the same
  // tick — is indistinguishable from here and must not be given an invented cause.
  const outcome: RescueOutcome | null = justEnded
    ? endedTarget?.grounded && endedTarget.y >= previousLink!.caughtAtY + RESCUE_LANDING_GAIN
        ? 'rescued'
        : grip <= 0 ? 'exhausted' : 'lost'
    : unseenAttemptFailed ? 'lost' : null

  const state: RescueHudState = linked
    ? 'holding'
    : rescued
        ? 'held'
        : exhausted
            ? 'exhausted'
            : locked ? 'cooldown' : promptVisible ? 'ready' : 'idle'
  // Tenths, so a 20 Hz patch stream cannot make the countdown jitter between whole seconds.
  const lockoutSeconds = locked ? Math.ceil(remainingLock * 10) / 10 : 0

  return {
    state,
    linked,
    showGrip: linked || grip < 1 || locked,
    gripPercent: Math.round(grip * 100),
    gripBand: grip <= GRIP_DANGER ? 'danger' : grip <= GRIP_WARNING ? 'warning' : 'steady',
    targetLabel: linked ? '구조 중' : null,
    rescuedByLabel: rescued ? '구조 받는 중' : null,
    // A locked-out player is told how long, whichever failure put them there.
    statusLabel: state === 'cooldown'
      ? `구조 재시도 ${lockoutSeconds.toFixed(1)}초`
      : state === 'exhausted' && lockoutSeconds > 0
          ? `그립 소진 · ${lockoutSeconds.toFixed(1)}초`
          : STATE_LABELS[state],
    promptVisible,
    outcome,
    announcement: linked ? '구조 시작' : outcome === null ? null : OUTCOME_LABELS[outcome],
    lockoutSeconds,
    links,
  }
}

/**
 * Carries the readout's memory into the next snapshot: the link being watched, the last rescue
 * receipt, and the lockout the room is about to enforce.
 *
 * The cooldown is mirrored, never read: the room keeps its own clock and re-decides every tick.
 * A completed rescue clears the lockout because the room charges no cooldown for one.
 */
export function nextRescueHudMemory(
  previous: RescueHudMemory | null,
  players: readonly NetworkPlayerSnapshot[],
  ownPlayerId: string,
  model: RescueHudModel,
  elapsed: number,
): RescueHudMemory {
  const own = players.find((player) => player.id === ownPlayerId) ?? null
  const failed = model.outcome !== null && model.outcome !== 'rescued'

  return {
    link: nextRescueLinkMemory(previous?.link ?? null, players, ownPlayerId),
    lockedUntil: model.outcome === 'rescued'
      ? 0
      : failed
          ? elapsed + (model.outcome === 'exhausted' ? RESCUE_EXHAUSTION_COOLDOWN : RESCUE_RELEASE_COOLDOWN)
          : previous?.lockedUntil ?? 0,
    lockReason: model.outcome === 'rescued'
      ? null
      : failed
          ? (model.outcome === 'exhausted' ? 'exhausted' : 'cooldown')
          : previous?.lockReason ?? null,
    acknowledgedGrab: own?.lastAcknowledgedGrab ?? previous?.acknowledgedGrab ?? 0,
  }
}

/**
 * Carries the link the client is currently watching into the next snapshot. The catch height is
 * sampled once, when the server first publishes the link, so a completed rescue can be told apart
 * from a break without the room having to publish any history.
 */
export function nextRescueLinkMemory(
  previous: RescueLinkMemory | null,
  players: readonly NetworkPlayerSnapshot[],
  ownPlayerId: string,
): RescueLinkMemory | null {
  const own = players.find((player) => player.id === ownPlayerId)
  if (!own || own.grabTargetId === '') return null
  if (previous?.targetId === own.grabTargetId) return previous
  const target = players.find((player) => player.id === own.grabTargetId)
  return target ? { targetId: target.id, caughtAtY: target.y } : null
}

export function onlineHudModel(
  match: NetworkMatchSnapshot,
  players: readonly NetworkPlayerSnapshot[],
  ownPlayerId: string,
): OnlineHudModel {
  const own = players.find((player) => player.id === ownPlayerId) ?? null
  const finished = match.phase === 'finished'
  const winnerLabel = WINNER_LABELS[match.winner] ?? null
  const lavaLabel = LAVA_LABELS[match.lavaPhase] ?? LAVA_LABELS.calm

  const statusLabel = finished
    ? `${winnerLabel ?? '경기 종료'} · 다시 시작할 수 있습니다`
    : !own
        ? '서버 참가 확인 중…'
        : !own.alive
            ? '용암에 빠졌습니다 · 관전 중'
            : own.escaped
                ? '지옥 탈출 성공'
                : match.phase === 'final-escape'
                    ? '최종 탈출 시간 · 용암이 정점까지 차오릅니다'
                    : match.lavaPhase === 'surge'
                        ? '용암 폭발 상승! 더 높은 곳으로 이동하세요'
                        : match.lavaPhase === 'warning'
                            ? '용암 폭발 경고'
                            : '거대한 놀이터를 건너 탈출대로 올라가세요'

  return {
    remainingLabel: formatMatchClock(match.elapsed, match.durationSeconds),
    lavaLabel,
    statusLabel,
    winnerLabel,
    finished,
    canMove: Boolean(own) && Boolean(own?.alive) && !own?.escaped && !finished,
    aliveCount: players.filter((player) => player.alive).length,
    escapedCount: players.filter((player) => player.escaped).length,
  }
}
