/** Presentation-only pixel density budget, driven by this renderer's completed draw counter. */
export interface RenderBudget {
  dpr: number
  maxDpr: number
  lastFrame: number
  lastTimestamp: number | null
  slowFrames: number
  fastFrames: number
}

export function createRenderBudget(nativeDpr: number): RenderBudget {
  const maxDpr = Number.isFinite(nativeDpr) && nativeDpr > 0
    ? Math.min(1.5, Math.max(0.5, nativeDpr)) : 1
  return { dpr: maxDpr, maxDpr, lastFrame: 0, lastTimestamp: null, slowFrames: 0, fastFrames: 0 }
}

export function sampleRenderBudget(
  state: RenderBudget,
  frame: number,
  timestamp: number,
  visible: boolean,
): RenderBudget {
  if (!Number.isSafeInteger(frame) || frame < 1 || !Number.isFinite(timestamp)) return state
  // Global after-effects or another canvas cannot manufacture samples for this renderer.
  if (frame === state.lastFrame) return state
  const next = { ...state, lastFrame: frame, lastTimestamp: timestamp }
  if (!visible || state.lastTimestamp === null || frame < state.lastFrame || timestamp <= state.lastTimestamp) {
    return { ...next, slowFrames: 0, fastFrames: 0 }
  }
  const millisecondsPerDraw = (timestamp - state.lastTimestamp) / (frame - state.lastFrame)
  if (millisecondsPerDraw > 50) {
    next.slowFrames += 1
    next.fastFrames = 0
    if (next.slowFrames >= 2) {
      next.dpr = Math.max(0.5, state.dpr * 0.7)
      next.slowFrames = 0
    }
  } else if (millisecondsPerDraw < 1000 / 45) {
    next.fastFrames += 1
    next.slowFrames = 0
    // Recovery is deliberately slower than shedding work, to avoid resolution oscillation.
    if (next.fastFrames >= 180) {
      next.dpr = Math.min(state.maxDpr, state.dpr + 0.1)
      next.fastFrames = 0
    }
  } else {
    next.slowFrames = 0
    next.fastFrames = 0
  }
  return next
}
