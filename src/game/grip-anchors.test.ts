import { describe, expect, it } from 'vitest'
import { gripAnchorById, playgroundGripAnchors } from './grip-anchors'
import { platformSurface, playgroundSurfaces } from './playground'

describe('authoritative playground grip anchors', () => {
  it('publishes stable unique ledge anchors only on server-owned route surfaces', () => {
    const anchors = playgroundGripAnchors()
    const ids = new Set(anchors.map((anchor) => anchor.id))

    expect(anchors.length).toBeGreaterThan(playgroundSurfaces().length * 4)
    expect(ids.size).toBe(anchors.length)
    for (const anchor of anchors) {
      const surface = platformSurface(anchor.surfaceIndex)
      expect(anchor.y).toBe(surface.top)
      expect(anchor.x >= surface.minX && anchor.x <= surface.maxX).toBe(true)
      expect(anchor.z >= surface.minZ && anchor.z <= surface.maxZ).toBe(true)
      const onEdge = anchor.x === surface.minX
        || anchor.x === surface.maxX
        || anchor.z === surface.minZ
        || anchor.z === surface.maxZ
      expect(onEdge).toBe(true)
      expect(Math.hypot(anchor.normalX, anchor.normalZ)).toBeCloseTo(1)
      expect(gripAnchorById(anchor.id)).toBe(anchor)
    }
  })

  it('returns no anchor for arbitrary client-controlled ids', () => {
    expect(gripAnchorById('client-hit:999,999,999')).toBeNull()
  })
})
