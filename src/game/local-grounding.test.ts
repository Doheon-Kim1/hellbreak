import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { refreshFootContacts } from './local-grounding'

beforeAll(async () => { await RAPIER.init() })
it('reacquires real floor contact after a low overhead obstacle blocks takeoff', () => {
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  const events = new RAPIER.EventQueue(true)
  try {
    const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.3, 5).setTranslation(0, -0.3, 0))
    const ceiling = world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.1, 5).setTranslation(0, 1.35, 0))
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.73, 0).lockRotations())
    world.createCollider(RAPIER.ColliderDesc.capsule(0.42, 0.3), body)
    const sensor = world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 0.08, 0.2)
      .setTranslation(0, -0.74, 0).setSensor(true).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body)
    const contacts = new Set<number>()
    function step() {
      world.step(events)
      events.drainCollisionEvents((first, second, started) => {
        if (first !== sensor.handle && second !== sensor.handle) return
        const other = first === sensor.handle ? second : first
        if (started) contacts.add(other)
        else contacts.delete(other)
      })
    }
    for (let frame = 0; frame < 30; frame++) step()
    expect(contacts.has(floor.handle)).toBe(true)
    contacts.clear() // The actual runner used to clear this cache on every takeoff.
    body.setLinvel({ x: 0, y: 7.4, z: 0 }, true)
    for (let frame = 0; frame < 30; frame++) step()
    world.removeCollider(ceiling, true) // Moving hazards can stop blocking without a floor exit.
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    for (let frame = 0; frame < 30; frame++) step()
    expect(body.translation().y).toBeCloseTo(0.72, 2)
    expect(world.intersectionPair(sensor, floor)).toBe(true)
    expect(contacts.has(floor.handle)).toBe(false) // No new enter event can repair the old cache.
    refreshFootContacts(world, sensor, contacts)
    expect(contacts.has(floor.handle)).toBe(true)
    body.setLinvel({ x: 0, y: 7.4, z: 0 }, true)
    for (let frame = 0; frame < 8; frame++) step()
    refreshFootContacts(world, sensor, contacts)
    expect(contacts.size).toBe(0) // Genuine airborne motion cannot reuse the recovered floor.
  } finally {
    events.free()
    world.free()
  }
})
