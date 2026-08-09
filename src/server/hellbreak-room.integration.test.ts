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
})
