import { Client } from '@colyseus/sdk'
import type { Room } from '@colyseus/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import type { HellbreakRoomState } from './hellbreak-state'
import { createHellbreakServer } from './colyseus-server'

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for synchronized room state')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('Colyseus HELLBREAK room', () => {
  const rooms: Room[] = []
  let shutdown: (() => Promise<void>) | undefined

  afterEach(async () => {
    await Promise.all(rooms.splice(0).map(async (room) => {
      try {
        await room.leave()
      } catch {
        // The server may already have closed the connection during a failed test.
      }
    }))
    await shutdown?.()
    shutdown = undefined
  })

  it('creates a room, joins by id, synchronizes authoritative movement, and removes leavers', async () => {
    const running = await createHellbreakServer({ port: 0, hostname: '127.0.0.1' })
    shutdown = running.shutdown
    const address = running.httpServer.address() as { port: number }
    const endpoint = `ws://127.0.0.1:${address.port}`
    const httpEndpoint = `http://127.0.0.1:${address.port}`
    const rejectedOrigin = await fetch(`${httpEndpoint}/health`, {
      headers: { Origin: 'https://untrusted.example' },
    })
    expect(rejectedOrigin.status).toBe(403)
    const allowedOrigin = await fetch(`${httpEndpoint}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(allowedOrigin.status).toBe(200)
    expect(allowedOrigin.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    const clientA = new Client(endpoint)
    const clientB = new Client(endpoint)

    const roomA = await clientA.create<HellbreakRoomState>('hellbreak')
    rooms.push(roomA)
    const roomB = await clientB.joinById<HellbreakRoomState>(roomA.roomId)
    rooms.push(roomB)

    await waitFor(() => roomA.state.players.size === 2 && roomB.state.players.size === 2)
    expect(roomA.roomId).toBe(roomB.roomId)
    expect(roomA.state.players.has(roomA.sessionId)).toBe(true)
    expect(roomA.state.players.has(roomB.sessionId)).toBe(true)

    const before = roomA.state.players.get(roomA.sessionId)!.z
    roomA.send('input', {
      sequence: 1,
      forward: true,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      cameraYaw: 0,
    })

    await waitFor(() => roomA.state.players.get(roomA.sessionId)!.z < before - 0.1)
    await waitFor(() => roomB.state.players.get(roomA.sessionId)!.z < before - 0.1)
    expect(roomB.state.players.get(roomA.sessionId)!.z).toBeCloseTo(
      roomA.state.players.get(roomA.sessionId)!.z,
      1,
    )

    const processed = roomA.state.players.get(roomA.sessionId)!.lastProcessedInput
    roomA.send('input', {
      sequence: 1,
      forward: false,
      backward: true,
      left: false,
      right: false,
      sprint: false,
      cameraYaw: 0,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(roomA.state.players.get(roomA.sessionId)!.lastProcessedInput).toBe(processed)

    await roomB.leave()
    rooms.splice(rooms.indexOf(roomB), 1)
    await waitFor(() => roomA.state.players.size === 1)
    expect(roomA.state.players.has(roomB.sessionId)).toBe(false)
  })

  it('broadcasts authoritative jump, lava, and match state and ignores client coordinates', async () => {
    const running = await createHellbreakServer({ port: 0, hostname: '127.0.0.1' })
    shutdown = running.shutdown
    const address = running.httpServer.address() as { port: number }
    const endpoint = `ws://127.0.0.1:${address.port}`

    const roomA = await new Client(endpoint).create<HellbreakRoomState>('hellbreak')
    rooms.push(roomA)
    const roomB = await new Client(endpoint).joinById<HellbreakRoomState>(roomA.roomId)
    rooms.push(roomB)
    await waitFor(() => roomA.state.players.size === 2 && roomB.state.players.size === 2)

    // The observer's view of the mover is the authoritative one under test.
    const mover = () => roomB.state.players.get(roomA.sessionId)!
    const groundY = mover().y
    expect(mover().grounded).toBe(true)
    expect(mover().alive).toBe(true)
    expect(mover().escaped).toBe(false)
    expect(mover().lastAcknowledgedJump).toBe(0)

    roomA.send('input', {
      sequence: 1,
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: true,
      cameraYaw: 0,
    })

    await waitFor(() => mover().y > groundY + 0.25 && mover().velocityY > 0 && !mover().grounded)
    // Both clients receive the same server-owned acknowledgement of the applied impulse.
    await waitFor(() => mover().lastAcknowledgedJump === 1)
    expect(roomA.state.players.get(roomA.sessionId)!.lastAcknowledgedJump).toBe(1)
    await waitFor(() => mover().grounded && Math.abs(mover().y - groundY) < 0.05)
    expect(mover().lastAcknowledgedJump).toBe(1)

    await waitFor(() => roomA.state.elapsed > 0.3)
    expect(roomA.state.durationSeconds).toBe(180)
    expect(roomA.state.matchPhase).toBe('running')
    expect(roomA.state.winner).toBe('')
    expect(roomA.state.lavaHeight).toBeGreaterThan(-4)
    expect(['calm', 'warning', 'surge']).toContain(roomA.state.lavaPhase)
    expect(roomB.state.lavaHeight).toBeCloseTo(roomA.state.lavaHeight, 3)

    // A client may only submit intent: smuggled coordinates must never move an avatar.
    const before = { x: mover().x, y: mover().y, z: mover().z }
    roomA.send('input', {
      sequence: 2,
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false,
      cameraYaw: 0,
      x: 999,
      y: 999,
      z: 999,
      velocityY: 999,
      grounded: false,
      alive: false,
      escaped: true,
      lastAcknowledgedJump: 999,
    })
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(mover().x).toBeCloseTo(before.x, 3)
    expect(mover().z).toBeCloseTo(before.z, 3)
    expect(mover().y).toBeCloseTo(before.y, 3)
    expect(mover().alive).toBe(true)
    expect(mover().escaped).toBe(false)
    expect(mover().lastAcknowledgedJump).toBe(1)

    // Restart is a finished-match affordance only; a running match must ignore it.
    roomA.send('restart')
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(roomA.state.matchPhase).toBe('running')
    expect(roomA.state.elapsed).toBeGreaterThan(0.3)
  })

  it('creates a rescue link from a held grab alone and clears it on release and disconnect', async () => {
    const running = await createHellbreakServer({ port: 0, hostname: '127.0.0.1' })
    shutdown = running.shutdown
    const address = running.httpServer.address() as { port: number }
    const endpoint = `ws://127.0.0.1:${address.port}`

    // Spawn slot 0 rescues slot 1, so the rescuer looks along +x toward the jumper.
    const roomA = await new Client(endpoint).create<HellbreakRoomState>('hellbreak')
    rooms.push(roomA)
    const roomB = await new Client(endpoint).joinById<HellbreakRoomState>(roomA.roomId)
    rooms.push(roomB)
    const roomC = await new Client(endpoint).joinById<HellbreakRoomState>(roomA.roomId)
    rooms.push(roomC)
    await waitFor(() => [roomA, roomB, roomC].every((room) => room.state.players.size === 3))

    const rescuerId = roomA.sessionId
    const jumperId = roomB.sessionId
    const idlerId = roomC.sessionId
    const seenBy = (room: typeof roomA, playerId: string) => room.state.players.get(playerId)!

    expect(seenBy(roomA, rescuerId).grabTargetId).toBe('')
    expect(seenBy(roomA, rescuerId).grabbedById).toBe('')
    expect(seenBy(roomA, rescuerId).grip).toBe(1)
    expect(seenBy(roomA, rescuerId).lastAcknowledgedGrab).toBe(0)

    // Held intent persists server-side, so one message is a held E until the client says otherwise.
    // The payload carries no target id, coordinates, force, or grip.
    roomA.send('input', {
      sequence: 1,
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false,
      grab: true,
      cameraYaw: -Math.PI / 2,
    })
    roomB.send('input', {
      sequence: 1,
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: true,
      grab: false,
      cameraYaw: 0,
    })

    await waitFor(() => seenBy(roomA, rescuerId).lastAcknowledgedGrab > 0, 5_000)
    const acknowledged = seenBy(roomA, rescuerId).lastAcknowledgedGrab
    expect(seenBy(roomA, rescuerId).grabTargetId).toBe(jumperId)

    // Grip is a spendable resource on the wire, not only in the simulation: while the room
    // publishes the link it only ever falls, and it never falls below empty.
    const drainSamples: number[] = []
    for (let sample = 0; sample < 4; sample += 1) {
      drainSamples.push(seenBy(roomA, rescuerId).grip)
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    for (const [index, grip] of drainSamples.entries()) {
      expect(grip).toBeLessThanOrEqual(index === 0 ? 1 : drainSamples[index - 1])
      expect(grip).toBeGreaterThanOrEqual(0)
    }
    expect(drainSamples.at(-1)).toBeLessThan(1)

    // Every client receives the same authoritative link, grip, and receipt.
    await waitFor(() => seenBy(roomC, rescuerId).lastAcknowledgedGrab === acknowledged, 5_000)
    expect(seenBy(roomB, rescuerId).grabTargetId).toBe(jumperId)
    expect(seenBy(roomC, rescuerId).grabTargetId).toBe(jumperId)
    expect(seenBy(roomB, jumperId).grabbedById).toBe(rescuerId)
    expect(seenBy(roomC, jumperId).grabbedById).toBe(rescuerId)
    expect(seenBy(roomB, rescuerId).grip).toBeLessThan(1)
    expect(seenBy(roomB, rescuerId).grip).toBeGreaterThan(0)
    // The idler never asked for anything and is never selected.
    expect(seenBy(roomA, idlerId).grabbedById).toBe('')
    expect(seenBy(roomA, idlerId).lastAcknowledgedGrab).toBe(0)

    // A smuggled target, grip, and receipt are all ignored by the authoritative room.
    roomA.send('input', {
      sequence: 2,
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false,
      grab: true,
      cameraYaw: -Math.PI / 2,
      grabTargetId: idlerId,
      grabbedById: idlerId,
      grip: 99,
      lastAcknowledgedGrab: 999,
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(seenBy(roomA, idlerId).grabbedById).toBe('')
    expect(seenBy(roomA, rescuerId).grip).toBeLessThanOrEqual(1)
    expect(seenBy(roomA, rescuerId).lastAcknowledgedGrab).toBe(acknowledged)

    // Releasing E clears both sides for every observer.
    roomA.send('input', {
      sequence: 3,
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      jump: false,
      grab: false,
      cameraYaw: -Math.PI / 2,
    })
    await waitFor(() => seenBy(roomA, rescuerId).grabTargetId === '', 5_000)
    await waitFor(() => seenBy(roomC, jumperId).grabbedById === '', 5_000)
    expect(seenBy(roomA, rescuerId).lastAcknowledgedGrab).toBe(acknowledged)

    // Recovery is the slow half of the economy: an unlinked runner on solid ground regains grip,
    // but at a small fraction of the rate a held link spends it.
    const beforeRegen = seenBy(roomA, rescuerId).grip
    const regenWindowMs = 500
    await new Promise((resolve) => setTimeout(resolve, regenWindowMs))
    const afterRegen = seenBy(roomA, rescuerId).grip
    expect(afterRegen).toBeGreaterThanOrEqual(beforeRegen)
    expect(afterRegen).toBeLessThanOrEqual(1)
    expect((afterRegen - beforeRegen) / (regenWindowMs / 1_000)).toBeLessThan(0.3)

    await roomB.leave()
    rooms.splice(rooms.indexOf(roomB), 1)
    await waitFor(() => roomA.state.players.size === 2)
    expect(seenBy(roomA, rescuerId).grabTargetId).toBe('')
  })
})
