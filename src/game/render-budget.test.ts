import { describe, expect, it } from 'vitest'
import { createRenderBudget, sampleRenderBudget } from './render-budget'

describe('renderer-owned presentation pixel budget', () => {
  it('clamps slow rendering without changing its frame/timestamp source', () => {
    let state = createRenderBudget(1.5)
    for (let frame = 1; frame <= 30; frame++) state = sampleRenderBudget(state, frame, frame * 500, true)
    expect(state.dpr).toBe(0.5)
    expect(state.maxDpr).toBe(1.5)
    expect(state.lastFrame).toBe(30)
    expect(state.lastTimestamp).toBe(15000)
  })

  it('does not adapt from duplicated callbacks, invalid samples or hidden frames', () => {
    let state = sampleRenderBudget(createRenderBudget(1), 1, 0, true)
    for (const frame of [1, 1, NaN, Infinity, -1, 1.2]) {
      expect(sampleRenderBudget(state, frame, 1000, true)).toBe(state)
    }
    for (let frame = 2; frame <= 40; frame++) state = sampleRenderBudget(state, frame, frame * 1000, false)
    expect(state.dpr).toBe(1)
    expect(state.slowFrames).toBe(0)
  })

  it('resets streaks for reversed clocks and reset renderer counters', () => {
    let state = sampleRenderBudget(createRenderBudget(1), 10, 1000, true)
    state = sampleRenderBudget(state, 11, 2000, true)
    expect(state.slowFrames).toBe(1)
    state = sampleRenderBudget(state, 1, 3000, true)
    expect(state.slowFrames).toBe(0)
    state = sampleRenderBudget(state, 2, 2500, true)
    expect(state.slowFrames).toBe(0)
    expect(state.dpr).toBe(1)
  })

  it('uses actual draw deltas, not after-effect sample counts, for cadence', () => {
    const first = sampleRenderBudget(createRenderBudget(1), 1, 0, true)
    const next = sampleRenderBudget(first, 11, 160, true)
    expect(next.fastFrames).toBe(1)
    expect(next.slowFrames).toBe(0)
    expect(next.dpr).toBe(1)
  })

  it('recovers only after sustained fast draws and never exceeds its native cap', () => {
    let state = sampleRenderBudget(createRenderBudget(1), 1, 0, true)
    state = sampleRenderBudget(state, 2, 1000, true)
    state = sampleRenderBudget(state, 3, 2000, true)
    expect(state.dpr).toBe(0.7)
    for (let frame = 4; frame < 183; frame++) state = sampleRenderBudget(state, frame, 2000 + (frame - 3) * 16, true)
    expect(state.dpr).toBe(0.7)
    state = sampleRenderBudget(state, 183, 4880, true)
    expect(state.dpr).toBeCloseTo(0.8)
    for (let frame = 184; frame <= 2000; frame++) state = sampleRenderBudget(state, frame, 2000 + (frame - 3) * 16, true)
    expect(state.dpr).toBe(1)
  })
})
