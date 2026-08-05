import { describe, expect, it } from 'vitest'
import { createMatch, lavaStateAt, stepMatch } from './match'

describe('HELLBREAK match rules', () => {
  it('raises lava and opens vertical tiers as time advances', () => {
    const match = createMatch()

    const advanced = stepMatch(match, 60)

    expect(advanced.elapsedSeconds).toBe(60)
    expect(advanced.lavaHeight).toBeGreaterThan(match.lavaHeight)
    expect(advanced.openTier).toBe(2)
  })

  it('surges near the end of every 30 second lava cycle without ever dropping', () => {
    const beforeWarning = lavaStateAt(22)
    const warning = lavaStateAt(24)
    const surge = lavaStateAt(28)
    const nextCycle = lavaStateAt(30)

    expect(beforeWarning.phase).toBe('calm')
    expect(warning.phase).toBe('warning')
    expect(surge.phase).toBe('surge')
    expect(beforeWarning.height).toBeLessThan(warning.height)
    expect(warning.height).toBeLessThan(surge.height)
    expect(surge.height).toBeLessThan(nextCycle.height)
    expect(lavaStateAt(180).height).toBeCloseTo(9.5)
  })

  it('never lowers the lava during the full three minute match', () => {
    const heights = Array.from({ length: 1801 }, (_, index) => lavaStateAt(index / 10).height)
    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index]).toBeGreaterThanOrEqual(heights[index - 1])
    }
    expect(heights.at(-1)).toBeCloseTo(9.5)
  })

  it('normalizes every supported match duration without a final lava drop', () => {
    for (const duration of [1, 10, 31, 60, 100, 180, 200]) {
      const heights = Array.from(
        { length: 1001 },
        (_, index) => lavaStateAt((duration * index) / 1000, duration).height,
      )
      for (let index = 1; index < heights.length; index += 1) {
        expect(heights[index]).toBeGreaterThanOrEqual(heights[index - 1])
      }
      expect(heights.at(-1)).toBeCloseTo(9.5)
    }
  })

  it('starts the final escape when lava reaches the top tier', () => {
    const match = createMatch()

    const finalPhase = stepMatch(match, 180)

    expect(finalPhase.phase).toBe('final-escape')
    expect(finalPhase.openTier).toBe(3)
    expect(finalPhase.lavaHeight).toBeCloseTo(9.5)
  })

  it('awards runners a win when at least one runner escapes', () => {
    const match = createMatch({ escapedRunners: 1 })

    const finished = stepMatch(match, 1)

    expect(finished.phase).toBe('finished')
    expect(finished.winner).toBe('runners')
  })
})
