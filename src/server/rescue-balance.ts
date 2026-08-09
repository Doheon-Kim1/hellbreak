/**
 * Server-owned Lava Lifeline tuning.
 *
 * Every rescue number lives here so balance can be reviewed in one place instead of being read out
 * of the simulation. The profile is deliberately a frozen constant rather than runtime
 * configuration: a client must never be able to send, negotiate, or override a rescue number, and
 * only room-owned code (`room-simulation.ts` and its tests) may import it. The HUD keeps its own
 * presentation-only mirrors of the handful of numbers a player can already infer by playing.
 *
 * Design intent of the current profile: a rescue is a **costly save, not free travel**. Holding a
 * teammate nearly halves the rescuer's mobility, drains a grip bar that empties in about two
 * seconds, drags the rescuer toward the drop hard enough to threaten their own footing, and locks
 * out reacquisition after every failure. The lava panic band shortens the "teammate is about to
 * touch lava" window without letting a rescuer reverse a badly lost position for free: panic buys
 * a slightly stronger haul in exchange for double grip burn and much heavier counter-drag.
 */
export interface RescueBalance {
  /** Three-dimensional reach a rescuer may start a link within. */
  reach: number
  /** Three-dimensional distance that snaps an established link. */
  breakRange: number
  /** A grounded teammate must be at least this far below the rescuer to be worth pulling. */
  minDrop: number
  /** Half-angle of the forward cone derived from the server-validated camera yaw. */
  coneDegrees: number
  /** Horizontal speed the target is reeled in at. */
  pullSpeed: number
  /** Horizontal counter-drag the rescuer suffers toward the target. */
  dragSpeed: number
  /** Upward acceleration applied to a target hanging below the rescuer's footing. */
  liftAccel: number
  /** Ceiling on the rescue-driven rise speed of a target. */
  maxLiftSpeed: number
  /** Fraction of ordinary walking speed a rescuer keeps while a link is held. */
  speedScale: number
  /** Hard per-tick displacement cap, so no force combination can teleport a runner. */
  maxStep: number
  /** Downward probe used to re-resolve support after a rescue nudge moved a runner sideways. */
  supportProbe: number
  /** A target this close above the authoritative lava surface makes the rescue desperate. */
  panicHeight: number
  /** Panic multiplier on pull and lift. */
  panicPullMultiplier: number
  /** Panic multiplier on the rescuer counter-drag. */
  panicDragMultiplier: number
  /** Panic multiplier on grip drain. */
  panicDrainMultiplier: number
  /** Grip spent per second while a link is held. */
  gripDrainPerSecond: number
  /** Grip recovered per second while grounded and unlinked. */
  gripRegenPerSecond: number
  /** Lockout after a link that ended without a completed rescue. */
  releaseCooldown: number
  /** Longer lockout after grip ran out mid-haul. */
  exhaustionCooldown: number
  /** Height the target must gain over its link-start feet for the landing to count as a rescue. */
  landingGain: number
}

export const RESCUE_BALANCE: Readonly<RescueBalance> = Object.freeze({
  reach: 2.4,
  breakRange: 3.2,
  minDrop: 0.3,
  coneDegrees: 75,
  pullSpeed: 3,
  dragSpeed: 1.35,
  // Vertical rescue power is deliberately left alone: the cost of a save went up, but a runner
  // caught just above the lava must still be liftable, or the mechanic stops existing at the
  // exact moment it matters. Only the fling ceiling comes down, so a haul lands a teammate on the
  // ledge instead of launching them out of the rescuer's reach.
  liftAccel: 26,
  maxLiftSpeed: 5,
  speedScale: 0.32,
  maxStep: 0.5,
  supportProbe: 0.02,
  panicHeight: 1.5,
  panicPullMultiplier: 1.15,
  panicDragMultiplier: 1.7,
  panicDrainMultiplier: 2,
  gripDrainPerSecond: 0.5,
  gripRegenPerSecond: 0.14,
  releaseCooldown: 1.4,
  exhaustionCooldown: 3,
  landingGain: 0.3,
})

/** Cosine the forward-cone dot product is compared against. */
export function rescueConeCos(balance: Readonly<RescueBalance> = RESCUE_BALANCE): number {
  return Math.cos((balance.coneDegrees * Math.PI) / 180)
}

/** Seconds a full grip survives an uninterrupted hold, calm or inside the lava panic band. */
export function rescueHoldSeconds(
  panicking = false,
  balance: Readonly<RescueBalance> = RESCUE_BALANCE,
): number {
  return 1 / (balance.gripDrainPerSecond * (panicking ? balance.panicDrainMultiplier : 1))
}

/** Seconds an emptied grip needs on solid ground before another full-length hold is possible. */
export function rescueRecoverySeconds(balance: Readonly<RescueBalance> = RESCUE_BALANCE): number {
  return 1 / balance.gripRegenPerSecond
}
