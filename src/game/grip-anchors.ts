import { playgroundSurfaces } from './playground'

export interface GripAnchor {
  readonly id: string
  readonly surfaceIndex: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly normalX: number
  readonly normalZ: number
  /** Capsule-centre destination while hanging outside the ledge. */
  readonly hangX: number
  readonly hangY: number
  readonly hangZ: number
  /** Supported capsule-centre destination reached by a completed W mantle. */
  readonly mantleX: number
  readonly mantleY: number
  readonly mantleZ: number
}

const MAX_ANCHOR_SPACING = 1.2
const HANG_OUTSET = 0.38
const HANG_BELOW = 0.5
const MANTLE_INSET = 0.68
// Kept equal to the authoritative capsule half-height without importing server code into game data.
const PLAYER_CENTRE_ABOVE_SURFACE = 0.72

function edgeAnchors(
  surfaceIndex: number,
  edge: 'north' | 'south' | 'west' | 'east',
  from: number,
  to: number,
  fixed: number,
  normalX: number,
  normalZ: number,
  top: number,
): GripAnchor[] {
  const count = Math.max(1, Math.ceil((to - from) / MAX_ANCHOR_SPACING))
  return Array.from({ length: count }, (_, index) => {
    // Segment centres avoid duplicate corner anchors while keeping the whole perimeter reachable.
    const along = from + ((index + 0.5) / count) * (to - from)
    const x = edge === 'north' || edge === 'south' ? along : fixed
    const z = edge === 'west' || edge === 'east' ? along : fixed
    return Object.freeze({
      id: `route-${surfaceIndex}-${edge}-${index}`,
      surfaceIndex,
      x,
      y: top,
      z,
      normalX,
      normalZ,
      hangX: x + normalX * HANG_OUTSET,
      hangY: top - HANG_BELOW,
      hangZ: z + normalZ * HANG_OUTSET,
      mantleX: x - normalX * MANTLE_INSET,
      mantleY: top + PLAYER_CENTRE_ABOVE_SURFACE,
      mantleZ: z - normalZ * MANTLE_INSET,
    })
  })
}

const ANCHORS: readonly GripAnchor[] = Object.freeze(playgroundSurfaces().flatMap((surface) => [
  ...edgeAnchors(surface.index, 'north', surface.minX, surface.maxX, surface.minZ, 0, -1, surface.top),
  ...edgeAnchors(surface.index, 'south', surface.minX, surface.maxX, surface.maxZ, 0, 1, surface.top),
  ...edgeAnchors(surface.index, 'west', surface.minZ, surface.maxZ, surface.minX, -1, 0, surface.top),
  ...edgeAnchors(surface.index, 'east', surface.minZ, surface.maxZ, surface.maxX, 1, 0, surface.top),
]))

const ANCHOR_BY_ID = new Map(ANCHORS.map((anchor) => [anchor.id, anchor] as const))

export function playgroundGripAnchors(): readonly GripAnchor[] {
  return ANCHORS
}

export function gripAnchorById(id: string): GripAnchor | null {
  return ANCHOR_BY_ID.get(id) ?? null
}
