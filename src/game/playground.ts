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

// Mirrors the rendered route geometry in GiantPlayground so server collision and visuals agree.
export const PLAYGROUND_PLATFORM_THICKNESS = 0.28
export const PLAYGROUND_PLATFORM_DEPTH = 3.2
export const PLAYGROUND_GROUND_TOP = -3.25
export const PLAYGROUND_HALF_EXTENT = 44

export interface PlatformSurface {
  index: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  top: number
}

const SURFACES: readonly PlatformSurface[] = PLAYGROUND_ROUTE.map((platform, index) => ({
  index,
  minX: platform.x - platform.width / 2,
  maxX: platform.x + platform.width / 2,
  minZ: platform.z - PLAYGROUND_PLATFORM_DEPTH / 2,
  maxZ: platform.z + PLAYGROUND_PLATFORM_DEPTH / 2,
  top: platform.y + PLAYGROUND_PLATFORM_THICKNESS / 2,
}))

export function playgroundSurfaces(): readonly PlatformSurface[] {
  return SURFACES
}

export function platformSurface(index: number): PlatformSurface {
  const safeIndex = Math.max(0, Math.min(SURFACES.length - 1, Math.floor(index)))
  return SURFACES[safeIndex]
}

export function finalPlatformSurface(): PlatformSurface {
  return SURFACES[SURFACES.length - 1]
}

export function insideWorldBounds(x: number, z: number): boolean {
  return Math.abs(x) <= PLAYGROUND_HALF_EXTENT && Math.abs(z) <= PLAYGROUND_HALF_EXTENT
}

export function coversPoint(surface: PlatformSurface, x: number, z: number): boolean {
  return x >= surface.minX && x <= surface.maxX && z >= surface.minZ && z <= surface.maxZ
}

/**
 * Highest support the feet cross while moving from `feetFrom` down to `feetTo`,
 * or null when nothing is crossed. Rising feet never snap onto a surface.
 */
export function supportTopBelow(x: number, z: number, feetFrom: number, feetTo: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(feetFrom) || !Number.isFinite(feetTo)) return null
  if (feetTo > feetFrom || !insideWorldBounds(x, z)) return null

  let support: number | null = null
  const crossed = (top: number) => top <= feetFrom && top >= feetTo

  if (crossed(PLAYGROUND_GROUND_TOP)) support = PLAYGROUND_GROUND_TOP
  for (const surface of SURFACES) {
    if (!coversPoint(surface, x, z) || !crossed(surface.top)) continue
    if (support === null || surface.top > support) support = surface.top
  }

  return support
}

export function playgroundBounds() {
  const xs = PLAYGROUND_ROUTE.map(({ x }) => x)
  const zs = PLAYGROUND_ROUTE.map(({ z }) => z)
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...zs) - Math.min(...zs),
  }
}
