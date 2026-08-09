import { describe, expect, it } from 'vitest'
import { NETWORK_SNAP_DISTANCE, interpolateNetworkPosition } from './interpolation'

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

  it('snaps instead of sliding when the server teleports an avatar', () => {
    // A match restart moves a runner from the exit platform back to spawn in one patch,
    // but an ordinary jump must still smooth vertically.
    expect(NETWORK_SNAP_DISTANCE).toBeGreaterThan(11)
    const from = { x: 0, y: 0, z: 0 }
    const teleported = { x: -16, y: 9.5, z: 20 }

    expect(interpolateNetworkPosition(from, teleported, 0.2)).toEqual(teleported)
    expect(interpolateNetworkPosition(from, { x: 0, y: 1, z: 0 }, 0.5)).toEqual({ x: 0, y: 0.5, z: 0 })
  })
})
