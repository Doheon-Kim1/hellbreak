import { describe, expect, it } from 'vitest'
import { PLAYGROUND_ROUTE, playgroundBounds, playgroundPlatformPose } from './playground'

describe('giant playground route', () => {
  it('spreads a small set of giant landmarks across a wide footprint', () => {
    const bounds = playgroundBounds()

    expect(PLAYGROUND_ROUTE).toHaveLength(17)
    expect(bounds.width).toBeGreaterThanOrEqual(35)
    expect(bounds.depth).toBeGreaterThanOrEqual(35)
  })

  it('keeps consecutive climbing targets reachable', () => {
    for (let index = 1; index < PLAYGROUND_ROUTE.length; index += 1) {
      const previous = playgroundPlatformPose(index - 1)
      const current = playgroundPlatformPose(index)
      const horizontalGap = Math.hypot(current.x - previous.x, current.z - previous.z)

      expect(horizontalGap).toBeLessThanOrEqual(6.5)
      expect(current.y - previous.y).toBeGreaterThan(0)
      expect(current.y - previous.y).toBeLessThanOrEqual(0.7)
    }
  })

  it('clamps route lookups to the first and final platforms', () => {
    expect(playgroundPlatformPose(-10)).toEqual(PLAYGROUND_ROUTE[0])
    expect(playgroundPlatformPose(999)).toEqual(PLAYGROUND_ROUTE.at(-1))
  })
})
