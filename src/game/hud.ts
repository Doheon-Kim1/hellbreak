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
 * One always-present chip state, so the rescue prompt keeps its place in the layout instead of
 * mounting and unmounting while a teammate drifts across the reach boundary.
 */
export type RescueHudState = 'idle' | 'ready' | 'holding' | 'held'

export interface RescueHudModel {
  state: RescueHudState
  linked: boolean
  showGrip: boolean
  gripPercent: number
  targetLabel: string | null
  rescuedByLabel: string | null
  promptVisible: boolean
  announcement: string | null
  links: RescueLinkView[]
}

/** Mirrors the room's own reach and drop rules so the prompt matches what the server will accept. */
const RESCUE_PROMPT_REACH = 2.4
const RESCUE_PROMPT_DROP = 0.3
/** Mirrors the room's lava panic band, for link colour only. */
const RESCUE_PANIC_HEIGHT = 1.5
/** Matches the room's completed-rescue landing gain. */
const RESCUE_LANDING_GAIN = 0.3

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
  previousLink: RescueLinkMemory | null = null,
): RescueHudModel {
  const own = players.find((player) => player.id === ownPlayerId) ?? null
  const byId = new Map(players.map((player) => [player.id, player]))

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
  const candidateNearby = Boolean(own) && !linked && !rescued && players.some((player) => (
    player.id !== ownPlayerId
    && player.alive
    && !player.escaped
    && player.grabbedById === ''
    && player.grabTargetId === ''
    && (!player.grounded || player.y <= own!.y - RESCUE_PROMPT_DROP)
    && Math.hypot(player.x - own!.x, player.y - own!.y, player.z - own!.z) <= RESCUE_PROMPT_REACH
  ))

  const justEnded = Boolean(previousLink) && !linked
  const endedTarget = justEnded ? byId.get(previousLink!.targetId) ?? null : null
  const announcement = linked
    ? '구조 시작'
    : !justEnded
        ? null
        : endedTarget?.grounded && endedTarget.y >= previousLink!.caughtAtY + RESCUE_LANDING_GAIN
            ? '구조 성공'
            : grip <= 0
                ? '그립 소진'
                : '구조 실패'

  return {
    state: linked ? 'holding' : rescued ? 'held' : candidateNearby ? 'ready' : 'idle',
    linked,
    showGrip: linked || grip < 1,
    gripPercent: Math.round(grip * 100),
    targetLabel: linked ? '구조 중' : null,
    rescuedByLabel: rescued ? '구조 받는 중' : null,
    promptVisible: candidateNearby,
    announcement,
    links,
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
