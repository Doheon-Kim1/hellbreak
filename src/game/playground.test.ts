import { describe, expect, it } from 'vitest'
import {
  PLAYGROUND_GROUND_TOP,
  PLAYGROUND_HALF_EXTENT,
  PLAYGROUND_PLATFORM_DEPTH,
  PLAYGROUND_PLATFORM_THICKNESS,
  PLAYGROUND_ROUTE,
  finalPlatformSurface,
  platformSurface,
  playgroundBounds,
  playgroundPlatformPose,
  playgroundSurfaces,
  supportTopBelow,
} from './playground'

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

describe('playground collision surfaces', () => {
  it('derives 3D platform bounds from the rendered route geometry', () => {
    const surfaces = playgroundSurfaces()
    const first = platformSurface(0)

    expect(surfaces).toHaveLength(PLAYGROUND_ROUTE.length)
    expect(first).toEqual({
      index: 0,
      minX: -30,
      maxX: -22,
      minZ: 22 - PLAYGROUND_PLATFORM_DEPTH / 2,
      maxZ: 22 + PLAYGROUND_PLATFORM_DEPTH / 2,
      top: -3.2 + PLAYGROUND_PLATFORM_THICKNESS / 2,
    })
    expect(finalPlatformSurface()).toEqual(platformSurface(PLAYGROUND_ROUTE.length - 1))
  })

  it('lands feet on the platform surface they cross downward', () => {
    const platform = platformSurface(4)

    expect(supportTopBelow(platform.minX + 0.5, 10, platform.top + 0.4, platform.top - 0.2))
      .toBeCloseTo(platform.top)
  })

  it('does not land on a platform the feet never cross', () => {
    const platform = platformSurface(4)

    // Rising through the platform from below must not snap the runner on top of it.
    expect(supportTopBelow(platform.minX + 0.5, 10, platform.top - 2, platform.top - 1.5)).toBeNull()
    // Falling past the platform but outside its horizontal footprint keeps falling to the floor.
    expect(supportTopBelow(platform.maxX + 3, 10, platform.top + 0.4, platform.top - 0.2)).toBeNull()
  })

  it('supports the playground floor everywhere inside the world bounds', () => {
    expect(supportTopBelow(0, 0, PLAYGROUND_GROUND_TOP + 0.2, PLAYGROUND_GROUND_TOP - 0.2))
      .toBeCloseTo(PLAYGROUND_GROUND_TOP)
    expect(supportTopBelow(PLAYGROUND_HALF_EXTENT + 5, 0, PLAYGROUND_GROUND_TOP + 0.2, PLAYGROUND_GROUND_TOP - 0.2))
      .toBeNull()
  })
})
