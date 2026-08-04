import { describe, expect, it } from 'vitest'
import { createMatch, stepMatch } from './match'

describe('HELLBREAK match rules', () => {
  it('raises lava and opens vertical tiers as time advances', () => {
    const match = createMatch()

    const advanced = stepMatch(match, 60)

    expect(advanced.elapsedSeconds).toBe(60)
    expect(advanced.lavaHeight).toBeGreaterThan(match.lavaHeight)
    expect(advanced.openTier).toBe(2)
  })

  it('starts the final escape when lava reaches the top tier', () => {
    const match = createMatch()

    const finalPhase = stepMatch(match, 180)

    expect(finalPhase.phase).toBe('final-escape')
    expect(finalPhase.openTier).toBe(3)
  })

  it('awards runners a win when at least one runner escapes', () => {
    const match = createMatch({ escapedRunners: 1 })

    const finished = stepMatch(match, 1)

    expect(finished.phase).toBe('finished')
    expect(finished.winner).toBe('runners')
  })
})
