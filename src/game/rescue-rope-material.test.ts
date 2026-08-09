import { describe, expect, it } from 'vitest'
import { DynamicDrawUsage } from 'three'
import type { BufferGeometry, Material } from 'three'
import { RESCUE_ROPE_SEGMENTS, createRescueRopeResources } from './rescue-rope-material'

/** Records every `dispose` event Three fires, so a leak shows up as a missing label. */
function trackDisposal(resources: ReturnType<typeof createRescueRopeResources>): string[] {
  const disposed: string[] = []
  const watch = (label: string, target: BufferGeometry | Material) => {
    target.addEventListener('dispose', () => disposed.push(label))
  }
  watch('strands', resources.strands.geometry)
  watch('rescuerKnot', resources.rescuerKnot.geometry)
  watch('targetRing', resources.targetRing.geometry)
  watch('material', resources.material)
  return disposed
}

describe('rescue rope resources', () => {
  it('builds the whole rope once, as one instanced strand plus two endpoint markers', () => {
    const resources = createRescueRopeResources()

    try {
      expect(resources.strands.count).toBe(RESCUE_ROPE_SEGMENTS)
      expect(resources.group.children).toEqual([
        resources.strands,
        resources.rescuerKnot,
        resources.targetRing,
      ])
      // One material for every part, so a frame of styling is a single colour write.
      expect(resources.strands.material).toBe(resources.material)
      expect(resources.rescuerKnot.material).toBe(resources.material)
      expect(resources.targetRing.material).toBe(resources.material)
      expect(resources.material.transparent).toBe(true)
    } finally {
      resources.dispose()
    }
  })

  it('gives the two ends different shapes, so who is holding whom is not a colour', () => {
    const resources = createRescueRopeResources()

    try {
      expect(resources.rescuerKnot.geometry.type).toBe('SphereGeometry')
      expect(resources.targetRing.geometry.type).toBe('TorusGeometry')
    } finally {
      resources.dispose()
    }
  })

  it('starts hidden and stays drawable while its instances move every frame', () => {
    const resources = createRescueRopeResources()

    try {
      // Nothing is positioned until the first frame resolves the link, so nothing may be drawn.
      expect(resources.group.visible).toBe(false)
      // Instance matrices are rewritten per frame without recomputing bounds, so culling them
      // against a stale bounding sphere would blink the rope out mid-rescue.
      expect(resources.strands.frustumCulled).toBe(false)
      expect(resources.strands.instanceMatrix.usage).toBe(DynamicDrawUsage)
    } finally {
      resources.dispose()
    }
  })

  it('scales the strand count with the requested smoothness', () => {
    const resources = createRescueRopeResources(4)

    try {
      expect(resources.strands.count).toBe(4)
    } finally {
      resources.dispose()
    }
  })

  it('releases every geometry and material, and keeps releasing them on a remount', () => {
    const resources = createRescueRopeResources()
    const disposed = trackDisposal(resources)
    const everything = ['material', 'rescuerKnot', 'strands', 'targetRing']

    resources.dispose()
    expect(disposed.sort()).toEqual(everything)

    // A React strict-mode remount disposes, renders the same objects again, and disposes again.
    // Skipping that second pass would leak the buffers Three re-uploaded in between, so the
    // release has to repeat rather than latch.
    disposed.length = 0
    resources.dispose()
    expect(disposed.sort()).toEqual(everything)
  })
})
