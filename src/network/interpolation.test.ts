import { describe, expect, it } from 'vitest'
import { interpolateNetworkPosition } from './interpolation'

describe('network position interpolation', () => {
  it('interpolates between authoritative positions', () => {
    expect(interpolateNetworkPosition(
      { x: 0, y: -2.2, z: 0 },
      { x: 10, y: -2.2, z: -4 },
      0.25,
    )).toEqual({ x: 2.5, y: -2.2, z: -1 })
  })

  it('clamps interpolation outside the snapshot range', () => {
    const from = { x: 1, y: 2, z: 3 }
    const to = { x: 4, y: 5, z: 6 }

    expect(interpolateNetworkPosition(from, to, -1)).toEqual(from)
    expect(interpolateNetworkPosition(from, to, 2)).toEqual(to)
  })

  it('rejects a non-finite interpolation factor by keeping the prior position', () => {
    const from = { x: 1, y: 2, z: 3 }
    expect(interpolateNetworkPosition(from, { x: 4, y: 5, z: 6 }, Number.NaN)).toEqual(from)
  })
})
