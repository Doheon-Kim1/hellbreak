/**
 * Whether a rescue rope exists at all, and whether its two anchors are safe to draw between.
 *
 * This is the boundary between the authoritative link the room publishes and the presentation math
 * in `rescue-rope-visuals.ts`. Nothing here decides a rescue: the room owns target selection,
 * forces, grip, and cooldown, and this module only refuses to draw a link the published snapshot
 * cannot support. Styling — width, colour, pulse, sag, fray — lives entirely in the visuals module.
 */
export interface RescueRopeAnchor {
  x: number
  y: number
  z: number
}

/** The published link the rope is drawn for. Both ends are server-chosen session IDs. */
export interface RescueRopeEnds {
  rescuerId: string
  targetId: string
}

export interface RescueRopePresence {
  /** False when the rope must be hidden this frame rather than drawn somewhere wrong. */
  visible: boolean
  /** Anchor separation in metres, or `0` whenever the rope is hidden. */
  length: number
}

/** Below this the two anchors share a point and normalizing their difference is meaningless. */
export const RESCUE_ROPE_MIN_LENGTH = 1e-3

/**
 * Distance between the two interpolated avatar anchors a rescue rope is drawn across, or `0` when
 * the rope must be hidden instead: an avatar that has not rendered or already left, a non-finite
 * position, or a pair so close together that the segment has no direction to point along.
 *
 * Returning zero rather than throwing keeps a bad frame invisible instead of poisoning the mesh
 * transform with `NaN`, which Three.js would carry forward for the rest of the session.
 */
export function rescueRopeLength(
  from: RescueRopeAnchor | null | undefined,
  to: RescueRopeAnchor | null | undefined,
): number {
  if (!from || !to) return 0
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  return Number.isFinite(length) && length >= RESCUE_ROPE_MIN_LENGTH ? length : 0
}

/**
 * Whether a published link names two different runners that both have a drawable anchor this frame,
 * together with the span the renderer should stretch across. One call per rope per frame, so the
 * hidden case never costs a second distance measurement.
 *
 * A link to nobody, or a link from a runner to themselves, is not a rope: the room never publishes
 * one, and drawing a degenerate segment would leave an unorientable mesh on screen.
 */
export function rescueRopePresence(
  link: RescueRopeEnds,
  from: RescueRopeAnchor | null | undefined,
  to: RescueRopeAnchor | null | undefined,
  out: RescueRopePresence = { visible: false, length: 0 },
): RescueRopePresence {
  const named = Boolean(link.rescuerId) && Boolean(link.targetId) && link.rescuerId !== link.targetId
  const length = named ? rescueRopeLength(from, to) : 0
  out.visible = length > 0
  out.length = length
  return out
}
