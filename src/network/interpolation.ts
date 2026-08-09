export interface NetworkPosition {
  x: number
  y: number
  z: number
}

/**
 * Beyond this distance a patch is a teleport (spawn, restart, respawn) rather than
 * motion, so smoothing it would drag the avatar through the playground.
 */
export const NETWORK_SNAP_DISTANCE = 14

export function interpolateNetworkPosition(
  from: NetworkPosition,
  to: NetworkPosition,
  factor: number,
): NetworkPosition {
  if (!Number.isFinite(factor)) return from
  if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > NETWORK_SNAP_DISTANCE) return to
  const t = Math.min(1, Math.max(0, factor))
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  }
}
