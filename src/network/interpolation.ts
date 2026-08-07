export interface NetworkPosition {
  x: number
  y: number
  z: number
}

export function interpolateNetworkPosition(
  from: NetworkPosition,
  to: NetworkPosition,
  factor: number,
): NetworkPosition {
  if (!Number.isFinite(factor)) return from
  const t = Math.min(1, Math.max(0, factor))
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  }
}
