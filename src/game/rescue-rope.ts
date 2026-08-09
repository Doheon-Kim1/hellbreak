export interface RescueRopeAnchor {
  x: number
  y: number
  z: number
}

/** Below this the two anchors share a point and normalizing their difference is meaningless. */
const MIN_ROPE_LENGTH = 1e-3

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
  return Number.isFinite(length) && length >= MIN_ROPE_LENGTH ? length : 0
}
