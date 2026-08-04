import { describe, expect, it } from 'vitest'
import { botPoseAt, cycleSpectatorIndex, movementVelocity } from './movement'

describe('runner movement rules', () => {
  it('normalizes diagonal input to the configured speed', () => {
    const velocity = movementVelocity({ forward: true, right: true }, 6)

    expect(Math.hypot(velocity.x, velocity.z)).toBeCloseTo(6)
    expect(velocity.x).toBeGreaterThan(0)
    expect(velocity.z).toBeLessThan(0)
  })

  it('cancels opposing input', () => {
    const velocity = movementVelocity(
      { forward: true, backward: true, left: true, right: true },
      6,
    )

    expect(velocity).toEqual({ x: 0, z: 0 })
  })
})

describe('spectator target selection', () => {
  it('moves forward and wraps after the last runner', () => {
    expect(cycleSpectatorIndex(1, 1, 3)).toBe(2)
    expect(cycleSpectatorIndex(2, 1, 3)).toBe(0)
  })

  it('moves backward and wraps before the first runner', () => {
    expect(cycleSpectatorIndex(1, -1, 3)).toBe(0)
    expect(cycleSpectatorIndex(0, -1, 3)).toBe(2)
  })
})

describe('runner bot route', () => {
  it('climbs as match time advances', () => {
    const start = botPoseAt(0, 0)
    const later = botPoseAt(20, 0)

    expect(later.y).toBeGreaterThan(start.y)
    expect(later.escaped).toBe(false)
  })

  it('staggers bots and eventually reaches the exit', () => {
    expect(botPoseAt(0, 1).y).not.toBe(botPoseAt(0, 0).y)
    expect(botPoseAt(60, 2).escaped).toBe(true)
  })
})
