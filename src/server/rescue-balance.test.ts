import { describe, expect, it } from 'vitest'
import {
  RESCUE_BALANCE,
  rescueConeCos,
  rescueHoldSeconds,
  rescueRecoverySeconds,
} from './rescue-balance'

/**
 * These are design guards, not a restatement of the numbers. Each one encodes a rule the tuning has
 * to keep obeying: a rescue must stay a costly save, and no retune may quietly turn it back into
 * free travel or break an anti-exploit property the simulation depends on.
 */
describe('rescue balance profile', () => {
  it('is a frozen, finite, positive server-owned profile', () => {
    expect(Object.isFrozen(RESCUE_BALANCE)).toBe(true)
    for (const [key, value] of Object.entries(RESCUE_BALANCE)) {
      expect(Number.isFinite(value), key).toBe(true)
      expect(value, key).toBeGreaterThan(0)
    }
  })

  it('keeps the geometry the link resolver depends on', () => {
    // An established link tolerates more distance than starting one, so a link cannot flicker
    // on and off across a single boundary.
    expect(RESCUE_BALANCE.breakRange).toBeGreaterThan(RESCUE_BALANCE.reach)
    // A broad but not omnidirectional forward cone: half-angle strictly inside a half turn.
    expect(RESCUE_BALANCE.coneDegrees).toBeGreaterThan(45)
    expect(RESCUE_BALANCE.coneDegrees).toBeLessThan(90)
    expect(rescueConeCos()).toBeCloseTo(Math.cos((75 * Math.PI) / 180), 6)
    expect(rescueConeCos()).toBeGreaterThan(0)
  })

  it('caps every per-tick rescue displacement below the hard step limit', () => {
    // The simulation clamps a 100 ms tick, so the fastest force the profile can ask for must still
    // fit under the teleport guard.
    const maxTick = 0.1
    const fastestPull = RESCUE_BALANCE.pullSpeed * RESCUE_BALANCE.panicPullMultiplier * maxTick
    const fastestDrag = RESCUE_BALANCE.dragSpeed * RESCUE_BALANCE.panicDragMultiplier * maxTick
    expect(fastestPull).toBeLessThan(RESCUE_BALANCE.maxStep)
    expect(fastestDrag).toBeLessThan(RESCUE_BALANCE.maxStep)
    // The support re-probe only re-resolves footing; it must never be a free downward step.
    expect(RESCUE_BALANCE.supportProbe).toBeLessThan(RESCUE_BALANCE.minDrop)
  })

  it('makes holding a teammate cost real mobility rather than granting travel', () => {
    // A rescuer keeps less than half of ordinary walking speed while linked.
    expect(RESCUE_BALANCE.speedScale).toBeLessThanOrEqual(0.4)
    // The counter-drag is a meaningful share of the pull, so hauling drags the rescuer toward the
    // drop instead of anchoring them: dragging cannot be a cheap tow for the rescuer either.
    expect(RESCUE_BALANCE.dragSpeed).toBeLessThan(RESCUE_BALANCE.pullSpeed)
    expect(RESCUE_BALANCE.pullSpeed / RESCUE_BALANCE.dragSpeed).toBeLessThanOrEqual(2.5)
    // A haul that outruns gravity, but not by so much that a target is flung out of reach.
    expect(RESCUE_BALANCE.liftAccel).toBeGreaterThan(18)
    expect(RESCUE_BALANCE.maxLiftSpeed).toBeLessThan(RESCUE_BALANCE.liftAccel / 4)
  })

  it('spends grip far faster than it regenerates and locks out failures', () => {
    expect(rescueHoldSeconds()).toBeLessThanOrEqual(2.5)
    expect(rescueHoldSeconds(true)).toBeLessThanOrEqual(rescueHoldSeconds() / 1.5)
    // Recovering a spent grip costs several holds' worth of time on solid ground.
    expect(RESCUE_BALANCE.gripRegenPerSecond).toBeLessThan(RESCUE_BALANCE.gripDrainPerSecond / 3)
    expect(rescueRecoverySeconds()).toBeGreaterThan(rescueHoldSeconds() * 3)
    // Running the bar to zero is punished harder than letting go in time.
    expect(RESCUE_BALANCE.exhaustionCooldown).toBeGreaterThan(RESCUE_BALANCE.releaseCooldown)
    expect(RESCUE_BALANCE.releaseCooldown).toBeGreaterThanOrEqual(1)
  })

  it('keeps the panic band clutch without making it a free reset', () => {
    // Panic helps, but the strongest boost is the cost side, never the reward side.
    expect(RESCUE_BALANCE.panicPullMultiplier).toBeGreaterThan(1)
    expect(RESCUE_BALANCE.panicPullMultiplier).toBeLessThan(1.25)
    expect(RESCUE_BALANCE.panicDragMultiplier).toBeGreaterThan(RESCUE_BALANCE.panicPullMultiplier)
    expect(RESCUE_BALANCE.panicDrainMultiplier).toBeGreaterThan(RESCUE_BALANCE.panicPullMultiplier)
    // A panic hold is measured in a single clutch second, not in a whole lava cycle.
    expect(rescueHoldSeconds(true)).toBeLessThanOrEqual(1)
  })

  it('derives hold and recovery windows from the profile itself', () => {
    expect(rescueHoldSeconds(false, { ...RESCUE_BALANCE, gripDrainPerSecond: 0.25 })).toBe(4)
    expect(rescueHoldSeconds(true, { ...RESCUE_BALANCE, gripDrainPerSecond: 0.25, panicDrainMultiplier: 2 })).toBe(2)
    expect(rescueRecoverySeconds({ ...RESCUE_BALANCE, gripRegenPerSecond: 0.2 })).toBeCloseTo(5)
  })
})
