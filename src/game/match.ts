import { wardenLavaBonusAt } from './hell-events'

export type MatchPhase = 'running' | 'final-escape' | 'finished'
export type MatchWinner = 'warden' | 'runners' | null
export type LavaPhase = 'calm' | 'warning' | 'surge'

export interface LavaState {
  height: number
  phase: LavaPhase
  nextSurgeSeconds: number
}

export interface MatchState {
  elapsedSeconds: number
  durationSeconds: number
  lavaHeight: number
  lavaPhase: LavaPhase
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
    lavaPhase: 'calm',
    openTier: 1,
    phase: 'running',
    winner: null,
    escapedRunners: 0,
    activeRunners: 3,
    ...overrides,
  }
}

export function lavaStateAt(elapsedSeconds: number, durationSeconds = 180): LavaState {
  const duration = Math.max(1, Number.isFinite(durationSeconds) ? durationSeconds : 180)
  const elapsed = Math.max(0, Math.min(duration, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0))
  if (elapsed >= duration) return { height: 9.5, phase: 'surge', nextSurgeSeconds: 0 }

  const cycleDuration = 30
  const calmEnd = 22
  const warningEnd = 27
  const pulseUnitsAt = (time: number) => {
    const completedCycles = Math.floor(time / cycleDuration)
    const cycleTime = time % cycleDuration
    const cycleProgress = cycleTime <= calmEnd
      ? 0.45 * (cycleTime / calmEnd)
      : cycleTime < warningEnd
        ? 0.45 + 0.1 * ((cycleTime - calmEnd) / (warningEnd - calmEnd))
        : 0.55 + 0.45 * ((cycleTime - warningEnd) / (cycleDuration - warningEnd))
    return completedCycles + cycleProgress
  }

  const cycleTime = elapsed % cycleDuration
  const phase: LavaPhase = cycleTime <= calmEnd ? 'calm' : cycleTime < warningEnd ? 'warning' : 'surge'
  const currentRiseWeight = pulseUnitsAt(elapsed) * 2.25 + wardenLavaBonusAt(elapsed)
  const finalRiseWeight = pulseUnitsAt(duration) * 2.25 + wardenLavaBonusAt(duration)
  const height = -4 + (currentRiseWeight / finalRiseWeight) * 13.5

  return {
    height,
    phase,
    nextSurgeSeconds: phase === 'surge' ? cycleDuration - cycleTime : warningEnd - cycleTime,
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
  const openTier = Math.min(3, Math.floor(elapsedSeconds / 60) + 1) as 1 | 2 | 3
  const lava = lavaStateAt(elapsedSeconds, state.durationSeconds)

  return {
    ...state,
    elapsedSeconds,
    lavaHeight: lava.height,
    lavaPhase: lava.phase,
    openTier,
    phase: elapsedSeconds >= state.durationSeconds ? 'final-escape' : 'running',
  }
}
