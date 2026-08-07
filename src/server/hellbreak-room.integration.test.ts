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
})
