import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAMERA_ORBIT,
  MAX_CAMERA_PITCH,
  MIN_CAMERA_PITCH,
  cameraAimDirection,
  isUsableInitialPointerLookDelta,
  requestPointerLockSafely,
  rotateMovementByCamera,
  updateCameraOrbitInPlace,
} from './camera'

describe('pointer-lock third-person camera', () => {
  it('mutates caller-owned view state instead of allocating on every mouse event', () => {
    const orbit = { ...DEFAULT_CAMERA_ORBIT }
    const updated = updateCameraOrbitInPlace(orbit, { deltaX: 100, deltaY: -40, zoomDelta: 0 })

    expect(updated).toBe(orbit)
    expect(updated.yaw).not.toBe(DEFAULT_CAMERA_ORBIT.yaw)
    expect(updated.pitch).toBeGreaterThan(DEFAULT_CAMERA_ORBIT.pitch)
  })

  it('clamps signed look pitch and zoom to playable limits', () => {
    const high = updateCameraOrbitInPlace({ ...DEFAULT_CAMERA_ORBIT }, {
      deltaX: 0,
      deltaY: -10_000,
      zoomDelta: -10_000,
    })
    const low = updateCameraOrbitInPlace({ ...DEFAULT_CAMERA_ORBIT }, {
      deltaX: 0,
      deltaY: 10_000,
      zoomDelta: 10_000,
    })

    expect(high.pitch).toBe(MAX_CAMERA_PITCH)
    expect(high.distance).toBe(6)
    expect(low.pitch).toBe(MIN_CAMERA_PITCH)
    expect(low.distance).toBe(15)
  })

  it('rejects oversized pointer-lock cursor warps before accepting raw look deltas', () => {
    expect(isUsableInitialPointerLookDelta(24, -18)).toBe(true)
    expect(isUsableInitialPointerLookDelta(100, -100)).toBe(true)
    expect(isUsableInitialPointerLookDelta(101, 0)).toBe(false)
    expect(isUsableInitialPointerLookDelta(-182.5, 0)).toBe(false)
    expect(isUsableInitialPointerLookDelta(0, 0)).toBe(false)
    expect(isUsableInitialPointerLookDelta(0, Number.NaN)).toBe(false)
  })

  it('handles pointer-lock rejection and activates fallback exactly once', async () => {
    let fallbackCalls = 0
    const accepted = await requestPointerLockSafely(
      () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      () => { fallbackCalls += 1 },
    )

    expect(accepted).toBe(false)
    expect(fallbackCalls).toBe(1)
  })

  it('writes a normalized three-dimensional aim direction into caller-owned output', () => {
    const out = { x: 9, y: 9, z: 9 }
    const direction = cameraAimDirection({ yaw: Math.PI / 2, pitch: Math.PI / 6 }, out)

    expect(direction).toBe(out)
    expect(direction.x).toBeCloseTo(-Math.cos(Math.PI / 6))
    expect(direction.y).toBeCloseTo(0.5)
    expect(direction.z).toBeCloseTo(0)
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1)
  })

  it('keeps W aligned with horizontal camera heading regardless of look pitch', () => {
    const forward = rotateMovementByCamera({ x: 0, z: -6 }, Math.PI / 2)

    expect(forward.x).toBeCloseTo(-6)
    expect(forward.z).toBeCloseTo(0)
  })
})
