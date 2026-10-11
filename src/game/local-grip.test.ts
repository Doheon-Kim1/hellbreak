import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { DEFAULT_CAMERA_ORBIT } from './camera'
import { playgroundGripAnchors } from './grip-anchors'
import { playgroundPlatformPose, PLAYGROUND_PLATFORM_THICKNESS, PLAYGROUND_PLATFORM_DEPTH } from './playground'
import { emptyLocalGrip, stepLocalGrip, type LocalGripInput } from './local-grip'
beforeAll(async () => { await RAPIER.init() })
const anchor = playgroundGripAnchors().find(a => a.surfaceIndex === 4 && a.normalZ === 1)!
function fixture() {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  world.timestep = 1 / 60
  const bounds = playgroundPlatformPose(anchor.surfaceIndex)
  const platform = world.createCollider(RAPIER.ColliderDesc.cuboid(bounds.width / 2, PLAYGROUND_PLATFORM_THICKNESS / 2, PLAYGROUND_PLATFORM_DEPTH / 2)
    .setTranslation(bounds.x, bounds.y, bounds.z))
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(anchor.hangX, anchor.y - 0.9, anchor.hangZ).lockRotations().setCanSleep(false))
  world.createCollider(RAPIER.ColliderDesc.capsule(0.42, 0.3), body)
  const sensor = world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 0.08, 0.2)
    .setTranslation(0, -0.74, 0).setSensor(true), body)
  let state = emptyLocalGrip(), elapsed = 0
  const orbit = { ...DEFAULT_CAMERA_ORBIT, yaw: 0,
    pitch: Math.atan2(anchor.y - (body.translation().y + 1.05), body.translation().z - anchor.z + DEFAULT_CAMERA_ORBIT.distance) }
  function frame(input: LocalGripInput = { grab: true, forward: false, jump: false }, delta = 1 / 60) {
    elapsed += delta
    const grounded = world.intersectionPair(sensor, platform) && body.linvel().y <= 0.1
    const result = stepLocalGrip(state, body.translation(), orbit, input, grounded, delta, elapsed)
    state = result.state
    body.setGravityScale(result.gravityScale, true)
    if (result.velocity) body.setLinvel(result.velocity, true)
    for (let i = 0; i < Math.max(1, Math.round(delta * 60)); i++) world.step()
    return result
  }
  return { world, body, platform, sensor, orbit, frame, get state() { return state },
    setGrip: (grip: number) => { state = { ...state, grip } } }
}
it('catches the screen-centred ledge and physically holds a local capsule', () => {
  const f = fixture()
  try {
    const initial = f.body.translation()
    expect(f.frame().grabbed).toBe(true)
    for (let i = 0; i < 60; i++) f.frame()
    expect(f.state.anchorId).toBe(anchor.id)
    expect(f.body.translation().y).toBeGreaterThan(initial.y + 0.2)
    expect(f.body.translation().y).toBeCloseTo(anchor.hangY, 1)
    expect(f.state.grip).toBeLessThan(1)
    expect(f.state.grip).toBeGreaterThan(0)
  } finally { f.world.free() }
})
it('raises clear of the wall, moves inward, and actually lands on the ledge after W', () => {
  const f = fixture()
  try {
    for (let i = 0; i < 30; i++) f.frame()
    let completed = false
    for (let i = 0; i < 150; i++) {
      const result = f.frame({ grab: true, forward: true, jump: false })
      completed = completed || result.completed
    }
    expect(completed).toBe(true)
    expect(f.state.anchorId).toBe('')
    expect(f.body.translation().z).toBeLessThan(anchor.z - 0.4)
    expect(f.body.translation().y).toBeCloseTo(anchor.mantleY, 1)
    expect(f.world.intersectionPair(f.sensor, f.platform)).toBe(true)
    expect(Math.abs(f.body.linvel().y)).toBeLessThan(0.1)
  } finally { f.world.free() }
})
it('fresh Space launches from the hang without an immediate recatch', () => {
  const f = fixture()
  try {
    for (let i = 0; i < 30; i++) f.frame()
    expect(f.state.anchorId).toBe(anchor.id)
    const before = f.body.translation().y
    expect(f.frame({ grab: true, forward: false, jump: true }).jumped).toBe(true)
    for (let i = 0; i < 8; i++) f.frame()
    expect(f.state.anchorId).toBe('')
    expect(f.body.translation().y).toBeGreaterThan(before + 0.5)
  } finally { f.world.free() }
})
it.each(['release', 'exhaustion'])('restores genuine gravity on %s', reason => {
  const f = fixture()
  try {
    for (let i = 0; i < 30; i++) f.frame()
    expect(f.state.anchorId).toBe(anchor.id)
    const before = f.body.translation().y
    if (reason === 'exhaustion') f.setGrip(0.001)
    for (let i = 0; i < 20; i++) f.frame({ grab: reason === 'exhaustion', forward: false, jump: false })
    expect(f.state.anchorId).toBe('')
    expect(f.body.translation().y).toBeLessThan(before - 0.5)
  } finally { f.world.free() }
})
it('does not grab a wall while looking away or before becoming airborne', () => {
  const f = fixture()
  try {
    f.orbit.yaw = Math.PI
    expect(f.frame().grabbed).toBe(false)
    expect(stepLocalGrip(emptyLocalGrip(), f.body.translation(), { ...f.orbit, yaw: 0 },
      { grab: true, forward: false, jump: false }, true, 1 / 60, 0).grabbed).toBe(false)
  } finally { f.world.free() }
})
it('holds the actual capsule without low-frame-rate overshoot', () => {
  const f = fixture()
  try {
    for (let i = 0; i < 8; i++) f.frame({ grab: true, forward: false, jump: false }, 0.3)
    expect(f.state.anchorId).toBe(anchor.id)
    expect(Math.abs(f.body.translation().y - anchor.hangY)).toBeLessThan(0.06)
  } finally { f.world.free() }
})
