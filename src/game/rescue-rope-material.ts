import {
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three'

/**
 * The Three objects one rescue rope owns for its whole life.
 *
 * The rope is rebuilt every frame from server-published anchors, which rules out regenerating
 * geometry: a tube or line rebuilt per frame would allocate and re-upload vertex buffers 60 times a
 * second, which is exactly the mobile regression this slice has to avoid. Instead the rope is a
 * fixed set of unit-sized primitives whose **transforms** move, so a frame costs matrix writes and
 * one colour write and nothing else.
 *
 * The two ends are deliberately different shapes. A knot on the rescuer and a ring around the
 * rescued runner say who is holding whom without spending colour, which is already carrying lava
 * proximity.
 */
export interface RescueRopeResources {
  /** Added to the scene as a single object, and hidden as one when the link is not drawable. */
  group: Group
  /** One instanced unit cylinder per rope segment, so the sagging rope is still one draw call. */
  strands: InstancedMesh
  rescuerKnot: Mesh
  targetRing: Mesh
  /** Shared by every part: one write styles the whole rope. */
  material: MeshStandardMaterial
  /**
   * Releases every geometry and the material. Safe to call more than once, because a strict-mode
   * remount disposes, re-renders the same objects, and disposes again — and skipping that second
   * pass would leak the buffers Three re-uploaded in between.
   */
  dispose(): void
}

/**
 * Segments the rope is drawn with. Enough for the sag to read as a curve at broadcast distance,
 * few enough that a phone draws six live ropes without noticing.
 */
export const RESCUE_ROPE_SEGMENTS = 14

export function createRescueRopeResources(segments = RESCUE_ROPE_SEGMENTS): RescueRopeResources {
  // Unit primitives: every dimension is supplied per frame as a scale, never as new geometry.
  const strandGeometry = new CylinderGeometry(1, 1, 1, 8, 1, true)
  const knotGeometry = new SphereGeometry(1, 12, 8)
  const ringGeometry = new TorusGeometry(1, 0.32, 8, 20)
  const material = new MeshStandardMaterial({ transparent: true })

  const strands = new InstancedMesh(strandGeometry, material, segments)
  // Instance matrices are rewritten every frame and the bounding sphere is not, so culling would
  // blink a live rope out as soon as the pair drifted away from the stale bounds.
  strands.frustumCulled = false
  strands.instanceMatrix.setUsage(DynamicDrawUsage)

  const rescuerKnot = new Mesh(knotGeometry, material)
  rescuerKnot.frustumCulled = false
  const targetRing = new Mesh(ringGeometry, material)
  targetRing.frustumCulled = false

  const group = new Group()
  // Nothing is positioned until the first frame resolves the link's anchors, so start hidden.
  group.visible = false
  group.add(strands, rescuerKnot, targetRing)

  return {
    group,
    strands,
    rescuerKnot,
    targetRing,
    material,
    dispose() {
      strandGeometry.dispose()
      knotGeometry.dispose()
      ringGeometry.dispose()
      material.dispose()
    },
  }
}
