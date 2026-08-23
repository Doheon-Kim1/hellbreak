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
  out?: NetworkPosition,
): NetworkPosition {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  const deltaZ = to.z - from.z
  const source = !Number.isFinite(factor)
    ? from
    : Math.hypot(deltaX, deltaY, deltaZ) > NETWORK_SNAP_DISTANCE
      ? to
      : null
  if (source) {
    if (!out) return source
    out.x = source.x
    out.y = source.y
    out.z = source.z
    return out
  }
  const t = Math.min(1, Math.max(0, factor))
  const result = out ?? { x: 0, y: 0, z: 0 }
  result.x = from.x + deltaX * t
  result.y = from.y + deltaY * t
  result.z = from.z + deltaZ * t
  return result
}
