import { describe, expect, it } from 'vitest'
import { rescueRopeLength } from './rescue-rope'

describe('rescue rope length', () => {
  it('measures the gap between two interpolated avatar anchors', () => {
    expect(rescueRopeLength({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5)
    expect(rescueRopeLength({ x: -1.5, y: 2, z: 0.5 }, { x: -1.5, y: 0.8, z: 0.5 })).toBeCloseTo(1.2)
  })

  it('hides the rope when either avatar has not rendered yet', () => {
    expect(rescueRopeLength(undefined, { x: 1, y: 1, z: 1 })).toBe(0)
    expect(rescueRopeLength({ x: 1, y: 1, z: 1 }, null)).toBe(0)
  })

  it('hides the rope rather than emitting a non-finite transform', () => {
    expect(rescueRopeLength({ x: Number.NaN, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(0)
    expect(rescueRopeLength({ x: 0, y: 0, z: 0 }, { x: 0, y: Number.POSITIVE_INFINITY, z: 0 })).toBe(0)
  })

  it('hides a rope too short to define a direction, so the rotation stays stable', () => {
    expect(rescueRopeLength({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(0)
    expect(rescueRopeLength({ x: 0, y: 0, z: 0 }, { x: 0, y: 1e-5, z: 0 })).toBe(0)
  })
})
