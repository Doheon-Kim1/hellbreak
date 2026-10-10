import { describe, expect, it } from 'vitest'
import { localPhysicsPaused } from './player-lifecycle'

describe('local physics lifecycle', () => {
  it.each([
    [false, true, false, true],
    [true, false, false, true],
    [true, true, true, true],
    [true, true, false, false],
  ])('started=%s ready=%s settings=%s pauses=%s', (started, ready, settings, paused) => {
    expect(localPhysicsPaused(started, ready, settings)).toBe(paused)
  })
})
