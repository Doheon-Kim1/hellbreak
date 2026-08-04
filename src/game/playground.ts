export interface PlaygroundPlatform {
  x: number
  y: number
  z: number
  width: number
}

export const PLAYGROUND_ROUTE: readonly PlaygroundPlatform[] = [
  { x: -26, y: -3.2, z: 22, width: 8 },
  { x: -22, y: -2.55, z: 18, width: 6 },
  { x: -18, y: -1.9, z: 14, width: 4.5 },
  { x: -13, y: -1.25, z: 12, width: 4.5 },
  { x: -8, y: -0.6, z: 10, width: 4 },
  { x: -3, y: 0.05, z: 7, width: 4 },
  { x: 2, y: 0.7, z: 4, width: 4 },
  { x: 6, y: 1.35, z: 1, width: 4 },
  { x: 9, y: 2, z: -3, width: 4.5 },
  { x: 11, y: 2.65, z: -7, width: 5 },
  { x: 9, y: 3.3, z: -11, width: 4 },
  { x: 5, y: 3.95, z: -14, width: 4 },
  { x: 0, y: 4.6, z: -14, width: 4 },
  { x: -5, y: 5.25, z: -12, width: 4 },
  { x: -9, y: 5.9, z: -8, width: 4 },
  { x: -12, y: 6.55, z: -3, width: 4 },
  { x: -10, y: 7.2, z: 2, width: 6 },
]

export function playgroundPlatformPose(index: number): PlaygroundPlatform {
  const safeIndex = Math.max(0, Math.min(PLAYGROUND_ROUTE.length - 1, Math.floor(index)))
  return PLAYGROUND_ROUTE[safeIndex]
}

export function playgroundBounds() {
  const xs = PLAYGROUND_ROUTE.map(({ x }) => x)
  const zs = PLAYGROUND_ROUTE.map(({ z }) => z)
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...zs) - Math.min(...zs),
  }
}
