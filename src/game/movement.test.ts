import { describe, expect, it } from 'vitest'
import { frameHasVisibleScene, playerPresentation, sceneCoverVisible } from './player-lifecycle'
import { botPoseAt, botVisualVelocity, cycleSpectatorIndex, movementVelocity, platformPose } from './movement'

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

describe('player death presentation', () => {
  it('removes the physical player and transfers camera ownership while spectating', () => {
    expect(playerPresentation({ spectating: true, escaped: false })).toEqual({
      renderBody: false,
      cameraMode: 'spectator',
      freezeBody: false,
    })
  })

  it('keeps an escaped runner visible for the victory pose while retaining the player camera', () => {
    expect(playerPresentation({ spectating: false, escaped: true })).toEqual({
      renderBody: true,
      cameraMode: 'player',
      freezeBody: true,
    })
  })

  it('keeps the local key art visible before play and until the 3D scene renders a frame', () => {
    expect(sceneCoverVisible(false, true)).toBe(true)
    expect(sceneCoverVisible(true, false)).toBe(true)
    expect(sceneCoverVisible(true, true)).toBe(false)
  })

  it('accepts a rendered frame only when sampled pixels contain visible variation', () => {
    expect(frameHasVisibleScene([[9, 6, 13], [9, 6, 13], [9, 6, 13]])).toBe(false)
    expect(frameHasVisibleScene([[9, 6, 13], [220, 80, 30], [25, 32, 50]])).toBe(true)
  })
})

describe('runner bot route', () => {
  it('reports no synthetic motion when a restarted match rewinds elapsed time', () => {
    const out = { x: 9, y: 9, z: 9 }
    expect(botVisualVelocity(
      { x: 8, y: 7, z: 6 },
      { x: -26, y: -2.5, z: 22 },
      -32,
      out,
    )).toBe(out)
    expect(out).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('rests on the platform instead of floating between jumps', () => {
    const platform = platformPose(0)
    const start = botPoseAt(0, 0)
    const waiting = botPoseAt(0.4, 0)

    expect(start).toMatchObject({ x: platform.x, z: platform.z, escaped: false })
    expect(start.y).toBeCloseTo(platform.y + 0.7)
    expect(waiting).toMatchObject({ x: start.x, y: start.y, z: start.z })
  })

  it('uses a visible jump arc and lands on the next platform', () => {
    const jumping = botPoseAt(1.45, 0)
    const landing = botPoseAt(2.3, 0)
    const nextPlatform = platformPose(1)

    expect(jumping.y).toBeGreaterThan(nextPlatform.y + 0.7)
    expect(landing.x).toBeCloseTo(nextPlatform.x)
    expect(landing.y).toBeCloseTo(nextPlatform.y + 0.7)
    expect(landing.z).toBeCloseTo(nextPlatform.z)
  })

  it('delays bot starts and eventually reaches the exit', () => {
    expect(botPoseAt(0, 1)).toMatchObject(botPoseAt(0, 0))
    expect(botPoseAt(60, 2).escaped).toBe(true)
  })
})
