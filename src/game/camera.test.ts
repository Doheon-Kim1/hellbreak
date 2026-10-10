import { describe, expect, it } from 'vitest'
import { PLAYGROUND_ROUTE } from './playground'
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
  it('starts facing the next foothold so W and jump follow the visible climb route', () => {
    const dx = PLAYGROUND_ROUTE[1].x - PLAYGROUND_ROUTE[0].x
    const dz = PLAYGROUND_ROUTE[1].z - PLAYGROUND_ROUTE[0].z
    const forward = rotateMovementByCamera({ x: 0, z: -1 }, DEFAULT_CAMERA_ORBIT.yaw)
    expect((forward.x * dx + forward.z * dz) / Math.hypot(dx, dz)).toBeGreaterThan(0.99)
  })
  it('applies bounded sensitivity and inverted Y without changing wheel zoom', () => {
    const input = { deltaX: 20, deltaY: 20, zoomDelta: 100 }
    const normal = updateCameraOrbitInPlace({ ...DEFAULT_CAMERA_ORBIT }, input)
    const slow = updateCameraOrbitInPlace({ ...DEFAULT_CAMERA_ORBIT }, input, { sensitivity: 0.5, invertY: true })
    expect(DEFAULT_CAMERA_ORBIT.yaw - slow.yaw).toBeCloseTo((DEFAULT_CAMERA_ORBIT.yaw - normal.yaw) / 2)
    expect(slow.pitch).toBeCloseTo(-normal.pitch / 2)
    expect(slow.distance).toBe(normal.distance)
  })
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
    expect(isUsableInitialPointerLookDelta(20, -10)).toBe(true)
  })

  it('ignores even bounded cursor warp during lock transition, then accepts real look', () => {
    expect(isUsableInitialPointerLookDelta(100, 100, 20)).toBe(false)
    expect(isUsableInitialPointerLookDelta(20, -10, 80)).toBe(false)
    expect(isUsableInitialPointerLookDelta(20, -10, 150)).toBe(true)
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
