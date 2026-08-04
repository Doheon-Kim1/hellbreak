export type MatchPhase = 'running' | 'final-escape' | 'finished'
export type MatchWinner = 'warden' | 'runners' | null

export interface MatchState {
  elapsedSeconds: number
  durationSeconds: number
  lavaHeight: number
  openTier: 1 | 2 | 3
  phase: MatchPhase
  winner: MatchWinner
  escapedRunners: number
  activeRunners: number
}

export function createMatch(overrides: Partial<MatchState> = {}): MatchState {
  return {
    elapsedSeconds: 0,
    durationSeconds: 180,
    lavaHeight: -4,
    openTier: 1,
    phase: 'running',
    winner: null,
    escapedRunners: 0,
    activeRunners: 3,
    ...overrides,
  }
}

export function stepMatch(state: MatchState, deltaSeconds: number): MatchState {
  if (state.phase === 'finished') return state

  if (state.escapedRunners > 0) {
    return { ...state, phase: 'finished', winner: 'runners' }
  }

  if (state.activeRunners === 0) {
    return { ...state, phase: 'finished', winner: 'warden' }
  }

  const elapsedSeconds = Math.min(
    state.durationSeconds,
    state.elapsedSeconds + Math.max(0, deltaSeconds),
  )
  const progress = elapsedSeconds / state.durationSeconds
  const openTier = Math.min(3, Math.floor(elapsedSeconds / 60) + 1) as 1 | 2 | 3

  return {
    ...state,
    elapsedSeconds,
    lavaHeight: -4 + progress * 28,
    openTier,
    phase: elapsedSeconds >= state.durationSeconds ? 'final-escape' : 'running',
  }
}
