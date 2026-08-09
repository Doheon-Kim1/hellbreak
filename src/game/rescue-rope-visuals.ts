/**
 * Presentation math for the Lava Lifeline rope.
 *
 * This module is pure arithmetic over already-published state and holds **no gameplay authority**.
 * Whether a rope exists at all, and whether its anchors are safe to draw between, is decided in
 * `rescue-rope.ts`; whether a rescue is allowed, who it targets, how hard it pulls, and how fast
 * grip drains are all decided by the room in `src/server/room-simulation.ts`. Nothing computed here
 * is ever sent back to the server, so a client that tampers with these numbers only changes what it
 * sees.
 *
 * The rope has to be readable on a broadcast stream and on a phone, which means urgency must never
 * be carried by hue alone. Two independent facts drive two independent sets of channels:
 *
 * - **lava proximity** (`urgency`) → rope width, pulse rate, sag/tension, and colour;
 * - **rescuer grip** (`gripBand`) → fray gaps, tremor, and a flicker that never fades the rope out.
 *
 * Keeping them separate matters: a rescuer with a full grip over the lava and one with a slipping
 * grip on safe ground are different emergencies, and one must not mask the other.
 */
import { RESCUE_ROPE_MIN_LENGTH } from './rescue-rope'

/**
 * Presentation mirror of the server-owned `RESCUE_BALANCE.panicHeight`.
 *
 * Duplicated rather than imported on purpose: the balance profile stays server-only, and a player
 * already learns this distance by playing. Nothing here is authority—if the mirror drifts, the room
 * still decides the rescue and only the rope's colour ramp is wrong.
 */
export const RESCUE_PANIC_HEIGHT = 1.5

/** Grip thresholds the warning and danger bands switch at, shared by the meter and the rope. */
export const RESCUE_GRIP_WARNING = 0.55
export const RESCUE_GRIP_DANGER = 0.25

/** Urgency at which the rope reads as a last-second save rather than a routine haul. */
const CRITICAL_URGENCY = 0.66

/** Metres of rope radius: a broadcast-legible silhouette that thickens with urgency. */
const RADIUS_BASE = 0.075
const RADIUS_URGENCY = 0.045
const RADIUS_PULSE = 0.018
/** Endpoint markers are sized off the rope so anchors stay obvious at any camera distance. */
const KNOT_SCALE = 2.6

/** Fraction of the span the slack rope droops by before tension pulls it straight. */
const SAG_RATIO = 0.11

/** Pulse rate in cycles per second, from a calm breathe to a panic strobe. */
const PULSE_HZ_CALM = 0.85
const PULSE_HZ_CRITICAL = 3.6

/** Metres of grip-driven shake at an empty grip. */
const TREMOR_MAX = 0.05

/** Fraction of each rope segment removed, so a slipping grip visibly frays the rope. */
const STRAND_GAP: Record<RescueGripBand, number> = { steady: 0, warning: 0.16, danger: 0.38 }

/** A flickering rope must still be a visible rope, so the dip is shallow and danger-only. */
const OPACITY_BASE = 0.95
const FLICKER_DEPTH = 0.22

const CALM_COLOR = 0xa8fbff
const CRITICAL_COLOR = 0xfff1e6
const CALM_EMISSIVE = 0x1ad7ff
const CRITICAL_EMISSIVE = 0xff4d10
const EMISSIVE_BASE = 2.2
const EMISSIVE_URGENCY = 1.5
const EMISSIVE_PULSE = 0.55

/** Exponential rate the rope eases published step changes at, in reciprocal seconds. */
const APPROACH_RATE = 9

/** Grip is a spendable resource, so it is banded rather than left as a bare percentage. */
export type RescueGripBand = 'steady' | 'warning' | 'danger'

/** How close to the lava the rescued runner is, as three deterministic bands. */
export type RescueRopeUrgencyBand = 'calm' | 'urgent' | 'critical'

export interface RescueRopeVisualInput {
  /** Anchor separation from `rescueRopePresence`; anything non-positive means no rope geometry. */
  length: number
  /** Metres the target hangs above the authoritative lava surface. */
  heightAboveLava: number
  /** Published rescuer grip, 0..1. */
  grip: number
  /** Radians of pulse phase, advanced by the caller at the returned `pulseHz`. */
  pulsePhase: number
  /** Set when the viewer asked for reduced motion; holds every animated channel still. */
  reducedMotion?: boolean
}

export interface RescueRopeVisual {
  /** 0 outside the lava panic band, 1 at or below the surface. */
  urgency: number
  urgencyBand: RescueRopeUrgencyBand
  gripBand: RescueGripBand
  /** 0..1 pulse envelope for the current phase. */
  pulse: number
  /** Cycles per second the caller should advance `pulsePhase` at; 0 under reduced motion. */
  pulseHz: number
  /** Rope radius in metres, already pulse-modulated. */
  radius: number
  /** Endpoint marker radius in metres. */
  knotRadius: number
  /** Metres the mid-span droops below a straight line between the anchors. */
  sag: number
  /** Metres of lateral shake amplitude driven by a slipping grip. */
  tremor: number
  /** 0..1 of each rope segment removed, so a failing grip frays the silhouette. */
  strandGap: number
  color: number
  emissive: number
  emissiveIntensity: number
  opacity: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Channel-wise blend of two 24-bit colours, rounded back into the range a material accepts. */
function mixHex(from: number, to: number, amount: number): number {
  const t = clamp01(amount)
  let mixed = 0
  for (let shift = 16; shift >= 0; shift -= 8) {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    const channel = Math.min(255, Math.max(0, Math.round(a + (b - a) * t)))
    mixed |= channel << shift
  }
  return mixed >>> 0
}

/**
 * How desperate the rescue is, from the target's height over the authoritative lava surface.
 *
 * An unreadable height reads as calm rather than critical: a broken frame must not raise an alarm
 * the published state does not support.
 */
export function rescueRopeUrgency(heightAboveLava: number): number {
  if (!Number.isFinite(heightAboveLava)) return 0
  return clamp01(1 - heightAboveLava / RESCUE_PANIC_HEIGHT)
}

/** Deterministic band for an urgency factor. `calm` means outside the room's own panic band. */
export function rescueRopeUrgencyBand(urgency: number): RescueRopeUrgencyBand {
  if (!Number.isFinite(urgency) || urgency <= 0) return 'calm'
  return urgency >= CRITICAL_URGENCY ? 'critical' : 'urgent'
}

/**
 * Deterministic band for a published grip. An unreadable grip reads as full, matching the readout:
 * the rope must not claim a rescuer is slipping when the snapshot never said so.
 */
export function rescueGripBand(grip: number): RescueGripBand {
  if (!Number.isFinite(grip)) return 'steady'
  return grip <= RESCUE_GRIP_DANGER ? 'danger' : grip <= RESCUE_GRIP_WARNING ? 'warning' : 'steady'
}

/**
 * Droop at `t` along the span, as a fraction of `sag`. A parabola rather than a true catenary: it
 * is anchored at both ends, deepest at the middle, and costs one multiply per rope segment.
 */
export function rescueRopeSagOffset(t: number, sag: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(sag)) return 0
  return sag * 4 * t * (1 - t)
}

/** A zeroed visual the renderer can reuse for the life of one rope. */
export function createRescueRopeVisual(): RescueRopeVisual {
  return {
    urgency: 0,
    urgencyBand: 'calm',
    gripBand: 'steady',
    pulse: 0,
    pulseHz: PULSE_HZ_CALM,
    radius: RADIUS_BASE,
    knotRadius: RADIUS_BASE * KNOT_SCALE,
    sag: 0,
    tremor: 0,
    strandGap: 0,
    color: CALM_COLOR,
    emissive: CALM_EMISSIVE,
    emissiveIntensity: EMISSIVE_BASE,
    opacity: OPACITY_BASE,
  }
}

/**
 * Resolves one frame of rope styling. Every field is overwritten, so a reused `out` never leaks
 * last frame's emergency into a calm one, and no live rope allocates per frame.
 */
export function rescueRopeVisual(
  input: RescueRopeVisualInput,
  out: RescueRopeVisual = createRescueRopeVisual(),
): RescueRopeVisual {
  // The same floor `rescueRopePresence` hides a rope at, so a span too short to orient can never
  // reach the sag term either.
  const span = Number.isFinite(input.length) && input.length >= RESCUE_ROPE_MIN_LENGTH
    ? input.length
    : 0
  const urgency = rescueRopeUrgency(input.heightAboveLava)
  const gripBand = rescueGripBand(input.grip)
  const reducedMotion = input.reducedMotion === true
  const phase = Number.isFinite(input.pulsePhase) ? input.pulsePhase : 0
  // Reduced motion parks the pulse at its crest: the animated channels stop, and the rope stays at
  // its most visible width and brightness rather than at its dimmest.
  const pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(phase)
  const slipping = clamp01((RESCUE_GRIP_WARNING - input.grip) / RESCUE_GRIP_WARNING)

  out.urgency = urgency
  out.urgencyBand = rescueRopeUrgencyBand(urgency)
  out.gripBand = gripBand
  out.pulse = pulse
  out.pulseHz = reducedMotion ? 0 : PULSE_HZ_CALM + (PULSE_HZ_CRITICAL - PULSE_HZ_CALM) * urgency
  out.radius = RADIUS_BASE + RADIUS_URGENCY * urgency + RADIUS_PULSE * pulse
  out.knotRadius = out.radius * KNOT_SCALE
  // Slack while there is time, pulled straight once the lava is on the target: tension is a shape
  // channel, so the rope still reads as urgent with the colour taken away.
  out.sag = span * SAG_RATIO * (1 - urgency)
  out.tremor = reducedMotion ? 0 : TREMOR_MAX * slipping
  out.strandGap = STRAND_GAP[gripBand]
  out.color = mixHex(CALM_COLOR, CRITICAL_COLOR, urgency)
  out.emissive = mixHex(CALM_EMISSIVE, CRITICAL_EMISSIVE, urgency)
  out.emissiveIntensity = EMISSIVE_BASE + EMISSIVE_URGENCY * urgency + EMISSIVE_PULSE * pulse
  out.opacity = gripBand === 'danger' ? OPACITY_BASE - FLICKER_DEPTH * (1 - pulse) : OPACITY_BASE

  return out
}

/**
 * Frame-rate independent ease of a smoothed presentation value toward the latest published one.
 *
 * The room patches grip and position 20 times a second while the browser draws far more often, so
 * feeding raw patches to the rope makes its width and colour step. This only smooths what is drawn:
 * the authoritative value is never modified, delayed for gameplay, or sent back.
 */
export function approachRescueValue(
  current: number,
  target: number,
  deltaSeconds: number,
  rate = APPROACH_RATE,
): number {
  if (!Number.isFinite(target)) return Number.isFinite(current) ? current : 0
  if (!Number.isFinite(current)) return target
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current
  return current + (target - current) * (1 - Math.exp(-deltaSeconds * rate))
}
