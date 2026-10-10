import type { Collider, World } from '@dimforge/rapier3d-compat'

/** Refresh the runner's cached foot contacts against the current physics world. */
export function refreshFootContacts(world: World, sensor: Collider, contacts: Set<number>): void {
  contacts.clear()
  world.intersectionPairsWith(sensor, (collider) => {
    if (!collider.isSensor()) contacts.add(collider.handle)
  })
}
