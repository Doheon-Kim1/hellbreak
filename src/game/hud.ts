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
