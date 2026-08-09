import { describe, expect, it } from 'vitest'
import {
  RESCUE_GRIP_DANGER,
  RESCUE_GRIP_WARNING,
  RESCUE_PANIC_HEIGHT,
  approachRescueValue,
  createRescueRopeVisual,
  rescueGripBand,
  rescueRopeSagOffset,
  rescueRopeUrgency,
  rescueRopeUrgencyBand,
  rescueRopeVisual,
} from './rescue-rope-visuals'
import type { RescueRopeVisual, RescueRopeVisualInput } from './rescue-rope-visuals'
import { RESCUE_ROPE_MIN_LENGTH } from './rescue-rope'

function input(overrides: Partial<RescueRopeVisualInput> = {}): RescueRopeVisualInput {
  return { length: 2, heightAboveLava: 6, grip: 1, pulsePhase: 0, reducedMotion: false, ...overrides }
}

/** Every number the renderer feeds to a Three transform, colour, or opacity. */
function numericChannels(visual: RescueRopeVisual): number[] {
  return [
    visual.urgency,
    visual.pulse,
    visual.pulseHz,
    visual.radius,
    visual.knotRadius,
    visual.sag,
    visual.tremor,
    visual.strandGap,
    visual.color,
    visual.emissive,
    visual.emissiveIntensity,
    visual.opacity,
  ]
}

describe('rescue rope urgency', () => {
  it('rises only inside the lava panic band the room itself uses', () => {
    expect(rescueRopeUrgency(RESCUE_PANIC_HEIGHT)).toBe(0)
    expect(rescueRopeUrgency(RESCUE_PANIC_HEIGHT + 4)).toBe(0)
    expect(rescueRopeUrgency(RESCUE_PANIC_HEIGHT / 2)).toBeCloseTo(0.5)
    expect(rescueRopeUrgency(0)).toBe(1)
  })

  it('saturates rather than overshooting once the target is at or under the surface', () => {
    expect(rescueRopeUrgency(-3)).toBe(1)
    expect(rescueRopeUrgency(-1e6)).toBe(1)
  })

  it('treats an unreadable height as calm instead of raising a false alarm', () => {
    expect(rescueRopeUrgency(Number.NaN)).toBe(0)
    expect(rescueRopeUrgency(Number.POSITIVE_INFINITY)).toBe(0)
    expect(rescueRopeUrgency(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('bands urgency deterministically, with calm meaning outside the panic band', () => {
    expect(rescueRopeUrgencyBand(rescueRopeUrgency(RESCUE_PANIC_HEIGHT))).toBe('calm')
    expect(rescueRopeUrgencyBand(rescueRopeUrgency(RESCUE_PANIC_HEIGHT - 0.01))).toBe('urgent')
    expect(rescueRopeUrgencyBand(rescueRopeUrgency(0.4))).toBe('critical')
    expect(rescueRopeUrgencyBand(rescueRopeUrgency(-2))).toBe('critical')
    expect(rescueRopeUrgencyBand(Number.NaN)).toBe('calm')
  })
})

describe('rescue grip bands', () => {
  it('bands the published grip the same way for the meter and the rope', () => {
    expect(rescueGripBand(1)).toBe('steady')
    expect(rescueGripBand(RESCUE_GRIP_WARNING + 0.01)).toBe('steady')
    expect(rescueGripBand(RESCUE_GRIP_WARNING)).toBe('warning')
    expect(rescueGripBand(RESCUE_GRIP_DANGER + 0.01)).toBe('warning')
    expect(rescueGripBand(RESCUE_GRIP_DANGER)).toBe('danger')
    expect(rescueGripBand(0)).toBe('danger')
  })

  it('reads an unpublished or out-of-range grip as a full one, never as a false alarm', () => {
    expect(rescueGripBand(Number.NaN)).toBe('steady')
    expect(rescueGripBand(4)).toBe('steady')
    expect(rescueGripBand(-4)).toBe('danger')
  })
})

describe('rescue rope sag', () => {
  it('hangs from both anchors and droops furthest at the middle', () => {
    expect(rescueRopeSagOffset(0, 1)).toBe(0)
    expect(rescueRopeSagOffset(1, 1)).toBe(0)
    expect(rescueRopeSagOffset(0.5, 1)).toBeCloseTo(1)
    expect(rescueRopeSagOffset(0.25, 1)).toBeCloseTo(0.75)
    expect(rescueRopeSagOffset(0.75, 1)).toBeCloseTo(0.75)
  })

  it('never emits a non-finite droop the rope transform would carry forward', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(rescueRopeSagOffset(value, 1)).toBe(0)
      expect(rescueRopeSagOffset(0.5, value)).toBe(0)
    }
  })
})

describe('rescue rope visual model', () => {
  it('produces only finite numbers for every published state, however broken', () => {
    const hostile = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1e9, 1e9]
    for (const value of hostile) {
      for (const field of ['length', 'heightAboveLava', 'grip', 'pulsePhase'] as const) {
        const visual = rescueRopeVisual(input({ [field]: value }))
        for (const channel of numericChannels(visual)) {
          expect(Number.isFinite(channel), `${field}=${value}`).toBe(true)
        }
      }
    }
  })

  it('keeps a zero or near-zero anchor distance from producing rope geometry', () => {
    // The same floor `rescueRopePresence` hides the rope at: a span too short to orient must not
    // reach the sag term either.
    for (const length of [0, -2, 1e-9, RESCUE_ROPE_MIN_LENGTH / 2, Number.NaN]) {
      const visual = rescueRopeVisual(input({ length }))
      expect(visual.sag).toBe(0)
      expect(Number.isFinite(visual.radius)).toBe(true)
      expect(visual.radius).toBeGreaterThan(0)
    }
  })

  it('sags in proportion to the span and pulls taut as the lava closes in', () => {
    const shortRope = rescueRopeVisual(input({ length: 1 })).sag
    const longRope = rescueRopeVisual(input({ length: 4 })).sag
    expect(longRope).toBeGreaterThan(shortRope)

    const calm = rescueRopeVisual(input({ heightAboveLava: 6 })).sag
    const urgent = rescueRopeVisual(input({ heightAboveLava: 0.75 })).sag
    const critical = rescueRopeVisual(input({ heightAboveLava: 0 })).sag
    expect(urgent).toBeLessThan(calm)
    expect(critical).toBeLessThan(urgent)
    expect(critical).toBe(0)
  })

  it('carries urgency on width, pulse rate, and shape, not on hue alone', () => {
    const calm = rescueRopeVisual(input({ heightAboveLava: 6 }))
    const critical = rescueRopeVisual(input({ heightAboveLava: 0.1 }))

    // Colour does move, but every one of these non-colour channels moves with it.
    expect(critical.color).not.toBe(calm.color)
    expect(critical.radius).toBeGreaterThan(calm.radius)
    expect(critical.knotRadius).toBeGreaterThan(calm.knotRadius)
    expect(critical.pulseHz).toBeGreaterThan(calm.pulseHz)
    expect(critical.sag).toBeLessThan(calm.sag)
    expect(critical.urgencyBand).not.toBe(calm.urgencyBand)
  })

  it('frays and shakes the rope by grip band, and leaves a steady grip alone', () => {
    const steady = rescueRopeVisual(input({ grip: 0.9 }))
    const warning = rescueRopeVisual(input({ grip: 0.4 }))
    const danger = rescueRopeVisual(input({ grip: 0.1 }))

    expect(steady.strandGap).toBe(0)
    expect(steady.tremor).toBe(0)
    expect(warning.strandGap).toBeGreaterThan(steady.strandGap)
    expect(warning.tremor).toBeGreaterThan(steady.tremor)
    expect(danger.strandGap).toBeGreaterThan(warning.strandGap)
    expect(danger.tremor).toBeGreaterThan(warning.tremor)
    // A frayed rope is still a whole rope: the gaps never eat a full segment.
    expect(danger.strandGap).toBeLessThan(1)
  })

  it('bands grip and lava proximity independently, so neither hides the other', () => {
    const calmButSlipping = rescueRopeVisual(input({ heightAboveLava: 6, grip: 0.1 }))
    const criticalButFresh = rescueRopeVisual(input({ heightAboveLava: 0.1, grip: 1 }))

    expect(calmButSlipping.urgencyBand).toBe('calm')
    expect(calmButSlipping.gripBand).toBe('danger')
    expect(criticalButFresh.urgencyBand).toBe('critical')
    expect(criticalButFresh.gripBand).toBe('steady')
  })

  it('flickers a near-broken grip without ever fading the rope out of sight', () => {
    const phases = [0, 0.7, Math.PI / 2, Math.PI, 4.2, Math.PI * 2]
    const opacities = phases.map((pulsePhase) => rescueRopeVisual(input({ grip: 0.1, pulsePhase })).opacity)

    expect(Math.min(...opacities)).toBeGreaterThan(0.6)
    expect(Math.max(...opacities)).toBeGreaterThan(Math.min(...opacities))
    for (const pulsePhase of phases) {
      expect(rescueRopeVisual(input({ grip: 1, pulsePhase })).opacity).toBeCloseTo(
        rescueRopeVisual(input({ grip: 1, pulsePhase: 0 })).opacity,
      )
    }
  })

  it('pulses width and brightness deterministically from the caller-advanced phase', () => {
    const trough = rescueRopeVisual(input({ pulsePhase: -Math.PI / 2 }))
    const crest = rescueRopeVisual(input({ pulsePhase: Math.PI / 2 }))

    expect(trough.pulse).toBeCloseTo(0)
    expect(crest.pulse).toBeCloseTo(1)
    expect(crest.radius).toBeGreaterThan(trough.radius)
    expect(crest.emissiveIntensity).toBeGreaterThan(trough.emissiveIntensity)
    // One full turn of the phase repeats exactly, so a long-lived link cannot drift.
    expect(rescueRopeVisual(input({ pulsePhase: Math.PI * 2 })).pulse)
      .toBeCloseTo(rescueRopeVisual(input({ pulsePhase: 0 })).pulse)
  })

  it('holds the animation still for reduced motion but keeps every urgency channel readable', () => {
    const calm = rescueRopeVisual(input({ heightAboveLava: 6, grip: 0.1, reducedMotion: true }))
    const critical = rescueRopeVisual(input({ heightAboveLava: 0.1, grip: 0.1, reducedMotion: true }))

    for (const visual of [calm, critical]) {
      expect(visual.pulseHz).toBe(0)
      expect(visual.tremor).toBe(0)
      // Phase no longer moves the rope, so nothing on screen animates.
      expect(rescueRopeVisual(input({ pulsePhase: 3.1, reducedMotion: true })).radius)
        .toBe(rescueRopeVisual(input({ pulsePhase: 0, reducedMotion: true })).radius)
    }

    // Width, shape, fray, and colour still separate the two states without motion.
    expect(critical.radius).toBeGreaterThan(calm.radius)
    expect(critical.sag).toBeLessThan(calm.sag)
    expect(critical.color).not.toBe(calm.color)
    expect(calm.strandGap).toBeGreaterThan(0)
    expect(critical.strandGap).toBeGreaterThan(0)
  })

  it('keeps colours inside the 24-bit range the material expects', () => {
    for (const heightAboveLava of [6, 1.4, 0.75, 0, -5, Number.NaN]) {
      const visual = rescueRopeVisual(input({ heightAboveLava }))
      for (const hex of [visual.color, visual.emissive]) {
        expect(Number.isInteger(hex)).toBe(true)
        expect(hex).toBeGreaterThanOrEqual(0)
        expect(hex).toBeLessThanOrEqual(0xffffff)
      }
    }
  })

  it('writes into a reused target so a live rope allocates nothing per frame', () => {
    const target = createRescueRopeVisual()
    const returned = rescueRopeVisual(input({ heightAboveLava: 0.2, grip: 0.1 }), target)

    expect(returned).toBe(target)
    expect(target.urgencyBand).toBe('critical')
    expect(target.gripBand).toBe('danger')

    // Reusing the same target for a calmer frame must leave nothing behind from the last one.
    rescueRopeVisual(input({ heightAboveLava: 9, grip: 1 }), target)
    expect(target.urgencyBand).toBe('calm')
    expect(target.gripBand).toBe('steady')
    expect(target.strandGap).toBe(0)
    expect(target.tremor).toBe(0)
  })
})

describe('rescue value smoothing', () => {
  it('eases toward a freshly published value without ever overshooting it', () => {
    let value = 0
    for (let frame = 0; frame < 40; frame += 1) {
      const next = approachRescueValue(value, 1, 1 / 60)
      expect(next).toBeGreaterThan(value)
      expect(next).toBeLessThanOrEqual(1)
      value = next
    }
    expect(value).toBeCloseTo(1, 2)
  })

  it('converges from either side and stays put once it has arrived', () => {
    expect(approachRescueValue(1, 0, 1 / 60)).toBeLessThan(1)
    expect(approachRescueValue(1, 0, 1 / 60)).toBeGreaterThanOrEqual(0)
    expect(approachRescueValue(0.5, 0.5, 1 / 60)).toBe(0.5)
    expect(approachRescueValue(0, 1, 0)).toBe(0)
  })

  it('is frame-rate independent rather than faster on a faster device', () => {
    const oneBigStep = approachRescueValue(0, 1, 1 / 30)
    let twoSmallSteps = 0
    twoSmallSteps = approachRescueValue(twoSmallSteps, 1, 1 / 60)
    twoSmallSteps = approachRescueValue(twoSmallSteps, 1, 1 / 60)
    expect(twoSmallSteps).toBeCloseTo(oneBigStep, 6)
  })

  it('snaps rather than smearing when a patch is a jump instead of a change', () => {
    // A long stall must not leave the rope crawling toward a value it should already show.
    expect(approachRescueValue(0, 1, 10)).toBeCloseTo(1, 6)
  })

  it('never lets a broken frame poison the smoothed value', () => {
    expect(approachRescueValue(Number.NaN, 0.5, 1 / 60)).toBe(0.5)
    expect(approachRescueValue(0.5, Number.NaN, 1 / 60)).toBe(0.5)
    expect(approachRescueValue(0.5, 0.9, Number.NaN)).toBe(0.5)
    expect(approachRescueValue(0.5, 0.9, -1)).toBe(0.5)
    expect(approachRescueValue(0.5, Number.POSITIVE_INFINITY, 1 / 60)).toBe(0.5)
  })
})
