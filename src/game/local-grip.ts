import { cameraAimDirection, cameraAimOrigin, type CameraOrbit, type CameraOffset } from './camera'
import { gripAnchorById, playgroundGripAnchors, segmentHitsPlatformBeforeAnchor, type GripAnchor } from './grip-anchors'
export type LocalGripState = { anchorId: string; grip: number; cooldownUntil: number; stage: 'hold' | 'raise' | 'inward' }
export type LocalGripInput = { grab: boolean; forward: boolean; jump: boolean }
export function emptyLocalGrip(): LocalGripState { return { anchorId: '', grip: 1, cooldownUntil: 0, stage: 'hold' } }
function findGrip(position: CameraOffset, orbit: CameraOrbit): GripAnchor | null {
  const origin = cameraAimOrigin(position, orbit, { x: 0, y: 0, z: 0 })
  const view = cameraAimDirection(orbit, { x: 0, y: 0, z: 0 })
  let best: GripAnchor | null = null, bestDot = Math.cos(42 * Math.PI / 180)
  for (const anchor of playgroundGripAnchors()) {
    const handY = position.y + 0.25
    if (Math.hypot(anchor.x - position.x, anchor.y - handY, anchor.z - position.z) > 1.65) continue
    if ((position.x - anchor.x) * anchor.normalX + (position.z - anchor.z) * anchor.normalZ < -0.05) continue
    if (view.x * anchor.normalX + view.z * anchor.normalZ >= -0.05) continue
    if (segmentHitsPlatformBeforeAnchor(position.x, handY, position.z, anchor.x, anchor.y, anchor.z)) continue
    const dx = anchor.x - origin.x, dy = anchor.y - origin.y, dz = anchor.z - origin.z
    const dot = (view.x * dx + view.y * dy + view.z * dz) / Math.hypot(dx, dy, dz)
    if (dot > bestDot) { best = anchor; bestDot = dot }
  }
  return best
}
function velocityTo(position: CameraOffset, goal: CameraOffset, delta: number): CameraOffset {
  const dx = goal.x - position.x, dy = goal.y - position.y, dz = goal.z - position.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 0.005) return { x: 0, y: 0, z: 0 }
  const scale = Math.min(4.2, distance / delta) / distance
  return { x: dx * scale, y: dy * scale, z: dz * scale }
}
/** Offline ledge motor. Registered geometry only; online motion stays server-owned. */
export function stepLocalGrip(previous: LocalGripState, position: CameraOffset, orbit: CameraOrbit,
  input: LocalGripInput, grounded: boolean, delta: number, elapsed: number) {
  // Match Physics' actual integration cap instead of overshooting during a slow WebGL frame.
  const dt = Math.max(1e-5, Math.min(0.5, Number.isFinite(delta) ? delta : 0))
  let state = { ...previous }
  const passive = (completed = false, velocity: CameraOffset | null = null, jumped = false) => ({
    state, gravityScale: 1, velocity, grabbed: false, jumped, completed,
  })
  if (state.anchorId && (!input.grab || state.grip <= 0)) {
    state = { ...state, anchorId: '', stage: 'hold', cooldownUntil: elapsed + (state.grip <= 0 ? 3 : 0.45) }
    return passive()
  }
  if (state.anchorId && input.jump) {
    state = { ...state, anchorId: '', stage: 'hold', cooldownUntil: elapsed + 0.65 }
    return passive(false, { x: 0, y: 7.4, z: 0 }, true)
  }
  let anchor = gripAnchorById(state.anchorId), grabbed = false
  if (!anchor) {
    state.grip = Math.min(1, state.grip + (grounded ? 0.22 : 0) * dt)
    if (grounded || !input.grab || state.grip <= 0 || elapsed < state.cooldownUntil) return passive()
    anchor = findGrip(position, orbit)
    if (!anchor) return passive()
    state.anchorId = anchor.id
    state.stage = 'hold'
    grabbed = true
  }
  state.grip = Math.max(0, state.grip - 0.14 * dt)
  if (state.grip <= 0) {
    state = { ...state, anchorId: '', stage: 'hold', cooldownUntil: elapsed + 3 }
    return passive()
  }
  const safeY = anchor.mantleY + 0.08
  if (state.stage === 'hold' && input.forward) state.stage = 'raise'
  if (state.stage === 'raise' && position.y >= safeY - 0.025) state.stage = 'inward'
  if (state.stage === 'inward' && Math.hypot(position.x - anchor.mantleX, position.z - anchor.mantleZ) < 0.06) {
    state = { ...state, anchorId: '', stage: 'hold', cooldownUntil: elapsed + 0.45 }
    return passive(true, { x: 0, y: 0, z: 0 })
  }
  // Clear the top vertically outside the wall before crossing it. Never push a capsule diagonally through the slab.
  const goal = state.stage === 'hold' ? { x: anchor.hangX, y: anchor.hangY, z: anchor.hangZ }
    : state.stage === 'raise' ? { x: anchor.hangX, y: safeY, z: anchor.hangZ }
    : { x: anchor.mantleX, y: safeY, z: anchor.mantleZ }
  return { state, gravityScale: 0, velocity: velocityTo(position, goal, dt), grabbed, jumped: false, completed: false }
}
