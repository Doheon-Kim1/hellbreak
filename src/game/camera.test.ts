import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAMERA_ORBIT,
  cameraOrbitOffset,
  rotateMovementByCamera,
  updateCameraOrbit,
} from './camera'

describe('third-person orbit camera', () => {
  it('rotates around the player from horizontal drag input', () => {
    const rotated = updateCameraOrbit(DEFAULT_CAMERA_ORBIT, { deltaX: 100, deltaY: 0, zoomDelta: 0 })
    const before = cameraOrbitOffset(DEFAULT_CAMERA_ORBIT)
    const after = cameraOrbitOffset(rotated)

    expect(rotated.yaw).not.toBe(DEFAULT_CAMERA_ORBIT.yaw)
    expect(Math.hypot(after.x, after.y, after.z)).toBeCloseTo(Math.hypot(before.x, before.y, before.z))
  })

  it('clamps vertical rotation and zoom to playable limits', () => {
    const high = updateCameraOrbit(DEFAULT_CAMERA_ORBIT, { deltaX: 0, deltaY: -10_000, zoomDelta: -10_000 })
    const low = updateCameraOrbit(DEFAULT_CAMERA_ORBIT, { deltaX: 0, deltaY: 10_000, zoomDelta: 10_000 })

    expect(high.pitch).toBeGreaterThanOrEqual(0.18)
    expect(high.distance).toBeGreaterThanOrEqual(6)
    expect(low.pitch).toBeLessThanOrEqual(1.05)
    expect(low.distance).toBeLessThanOrEqual(15)
  })

  it('keeps forward movement aligned with the camera heading', () => {
    const forward = rotateMovementByCamera({ x: 0, z: -6 }, Math.PI / 2)

    expect(forward.x).toBeCloseTo(-6)
    expect(forward.z).toBeCloseTo(0)
  })
})
