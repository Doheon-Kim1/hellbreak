import { describe, expect, it } from 'vitest'
import {
  RESCUE_ROPE_MIN_LENGTH,
  rescueRopeLength,
  rescueRopePresence,
  selectRescueRopeAnchor,
} from './rescue-rope'

describe('rescue rope anchor selection', () => {
  it('uses the articulated endpoint when it is finite', () => {
    const glove = { x: 1, y: 2, z: 3 }
    const root = { x: 0, y: 0, z: 0 }

    expect(selectRescueRopeAnchor(glove, root)).toBe(glove)
  })

  it('falls back to the finite avatar root when a glove or harness is missing or broken', () => {
    const root = { x: 4, y: 5, z: 6 }

    expect(selectRescueRopeAnchor(undefined, root)).toBe(root)
    expect(selectRescueRopeAnchor({ x: Number.NaN, y: 2, z: 3 }, root)).toBe(root)
  })

  it('returns undefined when neither visual anchor is safe', () => {
    expect(selectRescueRopeAnchor(undefined, undefined)).toBeUndefined()
    expect(selectRescueRopeAnchor(
      { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
      { x: Number.NaN, y: 0, z: 0 },
    )).toBeUndefined()
  })
})

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
    expect(rescueRopeLength({ x: 0, y: 0, z: 0 }, { x: 0, y: RESCUE_ROPE_MIN_LENGTH, z: 0 }))
      .toBe(RESCUE_ROPE_MIN_LENGTH)
  })
})

describe('rescue rope presence', () => {
  const link = { rescuerId: 'rescuer', targetId: 'target' }

  it('draws a published link between two rendered avatars, and reports its span once', () => {
    const presence = rescueRopePresence(link, { x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })

    expect(presence).toEqual({ visible: true, length: 5 })
  })

  it('hides a link whose ends are not two different runners', () => {
    const anchor = { x: 0, y: 0, z: 0 }
    const far = { x: 3, y: 4, z: 0 }

    expect(rescueRopePresence({ rescuerId: 'same', targetId: 'same' }, anchor, far))
      .toEqual({ visible: false, length: 0 })
    expect(rescueRopePresence({ rescuerId: '', targetId: 'target' }, anchor, far))
      .toEqual({ visible: false, length: 0 })
    expect(rescueRopePresence({ rescuerId: 'rescuer', targetId: '' }, anchor, far))
      .toEqual({ visible: false, length: 0 })
  })

  it('hides a link an avatar has not rendered for, or has already left', () => {
    expect(rescueRopePresence(link, undefined, { x: 1, y: 1, z: 1 }))
      .toEqual({ visible: false, length: 0 })
    expect(rescueRopePresence(link, { x: 1, y: 1, z: 1 }, null))
      .toEqual({ visible: false, length: 0 })
  })

  it('writes into a reused result, so a live rope allocates nothing per frame', () => {
    const target = { visible: false, length: 0 }
    const drawn = rescueRopePresence(link, { x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, target)

    expect(drawn).toBe(target)
    expect(target).toEqual({ visible: true, length: 5 })

    // The next frame loses an avatar: the stale span must not survive in the reused result.
    rescueRopePresence(link, undefined, { x: 3, y: 4, z: 0 }, target)
    expect(target).toEqual({ visible: false, length: 0 })
  })

  it('reports zero length for every hidden frame, so no transform can read a stale span', () => {
    const hidden = [
      rescueRopePresence(link, { x: Number.NaN, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      rescueRopePresence(link, { x: 0, y: 0, z: 0 }, { x: Number.POSITIVE_INFINITY, y: 0, z: 0 }),
      rescueRopePresence(link, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      rescueRopePresence(link, { x: 0, y: 0, z: 0 }, { x: 0, y: 1e-5, z: 0 }),
    ]

    for (const presence of hidden) expect(presence).toEqual({ visible: false, length: 0 })
  })
})
