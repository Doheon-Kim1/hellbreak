import { Client } from '@colyseus/sdk'
import type { Room } from '@colyseus/sdk'
import type { AuthContext, Client as SeatedClient } from '@colyseus/core'
import { afterEach, describe, expect, it } from 'vitest'
import { HELLBREAK_ROOM_NAME } from '../shared/multiplayer-protocol'
import type { RoomJoinOptions } from '../shared/multiplayer-protocol'
import type { HellbreakRoomState } from './hellbreak-state'
import { createHellbreakServer } from './colyseus-server'
import { HellbreakRoom, configureRoomAuth } from './hellbreak-room'
import { issueRoomToken } from './hive/sign-room-token'
import { createReplayGuard } from './room-auth'
import type { RoomAuthPolicy } from './room-auth'

const ROOM_SECRET = 'integration-room-token-secret-0123456789abcd'
const AUTHENTICATED_POLICY: RoomAuthPolicy = {
  guestJoin: false,
  roomTokenSecret: ROOM_SECRET,
  clockSkewMs: 0,
}

function capability(overrides: Partial<Parameters<typeof issueRoomToken>[0]> = {}) {
  return issueRoomToken({
    playerId: '1234567890123',
    roomId: 'match-integration',
    nowMs: Date.now(),
    ttlMs: 60_000,
    secret: ROOM_SECRET,
    ...overrides,
  }).token
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  // The first patch may not have been decoded yet, so a check that reaches into a not-yet-present
  // collection counts as "not ready" rather than as a failure.
  const ready = () => {
    try {
      return check()
    } catch {
      return false
    }
  }
  const started = Date.now()
  while (!ready()) {
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
    const running = await createHellbreakServer({ port: 0, hostname: '127.0.0.1', processShutdownHooks: false })
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
    const running = await createHellbreakServer({ port: 0, hostname: '127.0.0.1', processShutdownHooks: false })
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
    const running = await createHellbreakServer({ port: 0, hostname: '127.0.0.1', processShutdownHooks: false })
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

  it('publishes the guest join mode and keeps accepting unauthenticated demo clients', async () => {
    const running = await createHellbreakServer({ port: 0, hostname: '127.0.0.1', processShutdownHooks: false })
    shutdown = running.shutdown
    const address = running.httpServer.address() as { port: number }

    const health = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json()
    expect(health).toEqual({
      ok: true,
      room: HELLBREAK_ROOM_NAME,
      guestJoin: true,
      authenticatedJoin: false,
    })

    const room = await new Client(`ws://127.0.0.1:${address.port}`)
      .create<HellbreakRoomState>(HELLBREAK_ROOM_NAME)
    rooms.push(room)

    await waitFor(() => room.state.players.size === 1)
    expect(room.state.joinMode).toBe('guest')
  })
})

describe('authenticated HELLBREAK room joins', () => {
  const rooms: Room[] = []
  let shutdown: (() => Promise<void>) | undefined
  let endpoint = ''

  const startServer = async (policy: RoomAuthPolicy = AUTHENTICATED_POLICY) => {
    const running = await createHellbreakServer({
      port: 0,
      hostname: '127.0.0.1',
      authPolicy: policy,
      processShutdownHooks: false,
    })
    shutdown = running.shutdown
    const address = running.httpServer.address() as { port: number }
    endpoint = `ws://127.0.0.1:${address.port}`
    return running
  }

  const joinWith = async (options: Record<string, unknown>) => {
    const room = await new Client(endpoint)
      .joinOrCreate<HellbreakRoomState>(HELLBREAK_ROOM_NAME, options)
    rooms.push(room)
    return room
  }

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

  it('seats a capability holder and routes a second identity into the same match', async () => {
    await startServer()

    const first = await joinWith({ roomToken: capability(), assignedRoomId: 'match-integration' })
    const second = await joinWith({
      roomToken: capability({ playerId: '9876543210987' }),
      assignedRoomId: 'match-integration',
    })

    await waitFor(() => first.state.players.size === 2 && second.state.players.size === 2)
    expect(second.roomId).toBe(first.roomId)
    expect(first.state.joinMode).toBe('authenticated')
    // Identity is authorization input, not published state: the room broadcasts session ids only.
    expect([...first.state.players.keys()].sort())
      .toEqual([first.sessionId, second.sessionId].sort())
    expect(JSON.stringify(first.state.toJSON())).not.toContain('1234567890123')
  })

  it('refuses a guest client when the deployment requires a capability', async () => {
    await startServer()

    await expect(new Client(endpoint).create(HELLBREAK_ROOM_NAME))
      .rejects.toThrow(/guest-join-disabled/)
  })

  it('refuses a tokenless client on a room an authenticated match already claimed', async () => {
    await startServer({ ...AUTHENTICATED_POLICY, guestJoin: true })
    const seated = await joinWith({ roomToken: capability(), assignedRoomId: 'match-integration' })
    await waitFor(() => seated.state.players.size === 1)

    await expect(new Client(endpoint).joinById(seated.roomId))
      .rejects.toThrow(/token-required/)
    expect(seated.state.players.size).toBe(1)
  })

  it('refuses an expired capability', async () => {
    await startServer()
    const expired = issueRoomToken({
      playerId: '1234567890123',
      roomId: 'match-integration',
      nowMs: Date.now() - 600_000,
      ttlMs: 60_000,
      secret: ROOM_SECRET,
    }).token

    await expect(joinWith({ roomToken: expired, assignedRoomId: 'match-integration' }))
      .rejects.toThrow(/expired-token/)
  })

  it('refuses a capability minted for another match', async () => {
    await startServer()
    const seated = await joinWith({ roomToken: capability(), assignedRoomId: 'match-integration' })
    await waitFor(() => seated.state.players.size === 1)

    // Same room, wrong capability: the routing hint gets the client to the door, the token does not
    // get it through.
    await expect(new Client(endpoint).joinById(seated.roomId, {
      roomToken: capability({ roomId: 'match-elsewhere' }),
      assignedRoomId: 'match-integration',
    })).rejects.toThrow(/wrong-room/)
    expect(seated.state.players.size).toBe(1)
  })

  it('refuses a capability that was forged with the wrong secret', async () => {
    await startServer()

    await expect(joinWith({
      roomToken: capability({ secret: `${ROOM_SECRET}-forged` }),
      assignedRoomId: 'match-integration',
    })).rejects.toThrow(/invalid-token/)
  })

  /**
   * The identity check runs before the nonce is spent, so a capability presented while its owner is
   * still seated is refused as a duplicate seat. Replay is the case *after* that owner has left:
   * the identity is free again and only the single-use nonce stands between the token and a seat.
   */
  it('refuses a replayed capability once its holder has left, without spending a rejected one', async () => {
    await startServer()
    const anchorToken = capability({ playerId: '1111111111111' })
    const replayedToken = capability({ playerId: '2222222222222' })

    const anchor = await joinWith({ roomToken: anchorToken, assignedRoomId: 'match-integration' })
    const leaver = await joinWith({ roomToken: replayedToken, assignedRoomId: 'match-integration' })
    await waitFor(() => anchor.state.players.size === 2)

    await leaver.leave()
    rooms.splice(rooms.indexOf(leaver), 1)
    await waitFor(() => anchor.state.players.size === 1)

    await expect(new Client(endpoint).joinById(anchor.roomId, {
      roomToken: replayedToken,
      assignedRoomId: 'match-integration',
    })).rejects.toThrow(/replayed-token/)
    expect(anchor.state.players.size).toBe(1)
  })

  it('refuses a second seat for an identity that is still holding one', async () => {
    await startServer()
    const token = capability()
    const seated = await joinWith({ roomToken: token, assignedRoomId: 'match-integration' })
    await waitFor(() => seated.state.players.size === 1)

    await expect(new Client(endpoint).joinById(seated.roomId, {
      roomToken: token,
      assignedRoomId: 'match-integration',
    })).rejects.toThrow(/identity-already-seated/)
    expect(seated.state.players.size).toBe(1)
  })

  /**
   * The duplicate-seat check and the seat it protects are two different callbacks: Colyseus awaits
   * `onAuth` and only then calls `onJoin`. Two connections arriving together, each holding its own
   * validly minted capability for one identity, are the case that gap exists for.
   */
  it('seats one connection only when two capabilities for one identity arrive together', async () => {
    await startServer()
    // A different identity opens the match, so both contenders race into the *same* room rather
    // than each creating one of their own.
    const anchor = await joinWith({
      roomToken: capability({ playerId: '5555555555555' }),
      assignedRoomId: 'match-integration',
    })
    await waitFor(() => anchor.state.players.size === 1)

    const contend = () => new Client(endpoint).joinById<HellbreakRoomState>(anchor.roomId, {
      roomToken: capability(),
      assignedRoomId: 'match-integration',
    })
    const outcomes = await Promise.allSettled([contend(), contend()])

    const seated: Room<HellbreakRoomState>[] = []
    const refusals: string[] = []
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') seated.push(outcome.value)
      else refusals.push(String(outcome.reason))
    }
    rooms.push(...seated)

    expect(seated).toHaveLength(1)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatch(/identity-already-seated/)

    await waitFor(() => anchor.state.players.size === 2)
    // The refused connection cannot show up late either.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(anchor.state.players.size).toBe(2)
  })

  /**
   * The claim `onAuth` takes has to be releasable, or refusing a duplicate seat would turn into
   * locking a player out of the match they were assigned to.
   */
  it('frees the identity again once its holder leaves', async () => {
    await startServer()
    const anchor = await joinWith({
      roomToken: capability({ playerId: '5555555555555' }),
      assignedRoomId: 'match-integration',
    })
    const first = await new Client(endpoint).joinById<HellbreakRoomState>(anchor.roomId, {
      roomToken: capability(),
      assignedRoomId: 'match-integration',
    })
    rooms.push(first)
    await waitFor(() => anchor.state.players.size === 2)

    await first.leave()
    rooms.splice(rooms.indexOf(first), 1)
    await waitFor(() => anchor.state.players.size === 1)

    // Same identity, a capability it did not spend: the seat is available again.
    const second = await new Client(endpoint).joinById<HellbreakRoomState>(anchor.roomId, {
      roomToken: capability(),
      assignedRoomId: 'match-integration',
    })
    rooms.push(second)
    await waitFor(() => anchor.state.players.size === 2)
    expect(second.roomId).toBe(anchor.roomId)
  })

  it('refuses a freshly minted capability for an identity that already holds a seat', async () => {
    await startServer()
    const seated = await joinWith({ roomToken: capability(), assignedRoomId: 'match-integration' })
    await waitFor(() => seated.state.players.size === 1)

    // A different nonce, the same player: re-minting must not create a second seat.
    await expect(new Client(endpoint).joinById(seated.roomId, {
      roomToken: capability(),
      assignedRoomId: 'match-integration',
    })).rejects.toThrow(/identity-already-seated/)
    expect(seated.state.players.size).toBe(1)
  })

  const MALFORMED_OPTIONS: [string, () => Record<string, unknown>][] = [
    ['a non-string capability', () => ({ roomToken: 42, assignedRoomId: 'match-integration' })],
    ['an object capability', () => ({ roomToken: { value: 'x' }, assignedRoomId: 'match-integration' })],
    ['a routing hint with no capability', () => ({ assignedRoomId: 'match-integration' })],
    ['a capability with no routing hint', () => ({ roomToken: capability() })],
    ['a capability with a blank routing hint', () => ({ roomToken: capability(), assignedRoomId: '' })],
  ]

  it.each(MALFORMED_OPTIONS)('refuses malformed join options (%s)', async (_label, build) => {
    await startServer()

    await expect(joinWith(build())).rejects.toThrow()
  })

  it('still enforces server authority over movement inside an authenticated room', async () => {
    await startServer()
    const room = await joinWith({ roomToken: capability(), assignedRoomId: 'match-integration' })
    await waitFor(() => room.state.players.size === 1)

    const before = room.state.players.get(room.sessionId)!.z
    room.send('input', {
      sequence: 1,
      forward: true,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      cameraYaw: 0,
      x: 999,
      z: 999,
    })

    await waitFor(() => room.state.players.get(room.sessionId)!.z < before - 0.1)
    expect(room.state.players.get(room.sessionId)!.x).toBeLessThan(900)
  })
})

/**
 * The auth/join gap, held open past the reservation window.
 *
 * Colyseus runs `onAuth` and `onJoin` in the same tick, so no networked client can spend longer in
 * that gap than its reservation lasts — which is exactly why the room is driven directly here,
 * against a clock the test moves. It is the only way to watch a connection arrive at `onJoin`
 * carrying an authorization that has already expired, and the only place the room's answer to that
 * can be observed: refuse the seat, and never hand the simulation a player.
 */
describe('a join that reaches the room after its reservation expired', () => {
  const PENDING_SEAT_MS = 1_000
  const CREATED_AT = 1_700_000_000_000
  const OPTIONS: RoomJoinOptions = { assignedRoomId: 'match-integration' }

  let pinnedNow = CREATED_AT
  let room: HellbreakRoom | undefined

  /**
   * A room built outside Colyseus, so it owns real timers nothing else will stop. `configureRoomAuth`
   * is process-wide; every networked test above re-installs its own policy when it starts a server,
   * so pinning one here cannot leak into them.
   */
  const openRoom = () => {
    pinnedNow = CREATED_AT
    configureRoomAuth({
      policy: AUTHENTICATED_POLICY,
      guard: createReplayGuard(),
      now: () => pinnedNow,
      pendingSeatMs: PENDING_SEAT_MS,
    })
    const created = new HellbreakRoom()
    room = created
    created.onCreate({
      ...OPTIONS,
      roomToken: capability({ playerId: '3333333333333', nowMs: pinnedNow }),
    })
    return created
  }

  /** Everything Colyseus does between the two callbacks, minus the transport. */
  const authorize = (open: HellbreakRoom, sessionId: string, playerId: string) => {
    const client = { sessionId, auth: undefined } as unknown as SeatedClient
    const options: RoomJoinOptions = {
      ...OPTIONS,
      roomToken: capability({ playerId, nowMs: pinnedNow }),
    }
    client.auth = open.onAuth(client, options, {} as AuthContext)
    return client
  }

  afterEach(() => {
    const open = room
    room = undefined
    if (!open) return
    open.onDispose()
    open.clock.clear()
    open.setSimulationInterval(undefined)
    open.setPatchRate(null)
  })

  it('refuses the seat and leaves the simulation untouched', () => {
    const open = openRoom()
    const late = authorize(open, 'session-late', '1234567890123')
    expect(open.state.players.size).toBe(0)

    pinnedNow += PENDING_SEAT_MS
    expect(() => open.onJoin(late)).toThrow(/identity-already-seated/)
    // Refused, not seated: the room published no player and the identity is free again.
    expect(open.state.players.size).toBe(0)
    expect(open.state.players.has('session-late')).toBe(false)

    // A late arrival cannot be retried into a seat either, however long it keeps trying.
    pinnedNow += 60 * 60_000
    expect(() => open.onJoin(late)).toThrow(/identity-already-seated/)
    expect(open.state.players.size).toBe(0)
  })

  it('seats a join that arrives inside the window, and only that one', () => {
    const open = openRoom()
    const prompt = authorize(open, 'session-prompt', '1234567890123')

    pinnedNow += PENDING_SEAT_MS - 1
    open.onJoin(prompt)
    expect(open.state.players.size).toBe(1)
    expect(open.state.players.has('session-prompt')).toBe(true)

    // The seat it took outlives the window, so a second connection for that identity is refused
    // at the door rather than colliding with it at `onJoin`.
    pinnedNow += 10 * PENDING_SEAT_MS
    expect(() => authorize(open, 'session-second', '1234567890123'))
      .toThrow(/identity-already-seated/)
    expect(open.state.players.size).toBe(1)
  })
})
