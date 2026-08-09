import { describe, expect, it } from 'vitest'
import {
  PLAYER_HALF_HEIGHT,
  applyPlayerInput,
  createRoomState,
  joinRoom,
  leaveRoom,
  publicRoomSnapshot,
  restartRoom,
  stepRoom,
} from './room-simulation'
import { lavaStateAt } from '../game/match'
import type { AuthoritativeRoomState, PlayerInputCommand, RoomPlayerState } from './room-simulation'
import {
  PLAYGROUND_GROUND_TOP,
  PLAYGROUND_HALF_EXTENT,
  finalPlatformSurface,
  platformSurface,
} from '../game/playground'

const START = platformSurface(0)
const SPAWN_X = -26
const SPAWN_Z = 22
const SPAWN_Y = START.top + PLAYER_HALF_HEIGHT

/** Tests place runners directly because no client message may set authoritative coordinates. */
function placeRunner(
  room: AuthoritativeRoomState,
  playerId: string,
  pose: Partial<RoomPlayerState>,
): AuthoritativeRoomState {
  return {
    ...room,
    players: { ...room.players, [playerId]: { ...room.players[playerId], ...pose } },
  }
}

function stepUntil(
  room: AuthoritativeRoomState,
  done: (state: AuthoritativeRoomState) => boolean,
  maxTicks = 400,
): AuthoritativeRoomState {
  let current = room
  for (let tick = 0; tick < maxTicks && !done(current); tick += 1) current = stepRoom(current, 0.05)
  return current
}

describe('authoritative multiplayer room', () => {
  it('assigns deterministic spawn slots on the first route platform and reuses a released slot', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')

    expect(room.players['runner-1']).toMatchObject({ x: SPAWN_X, y: SPAWN_Y, z: SPAWN_Z, spawnSlot: 0 })
    expect(room.players['runner-2']).toMatchObject({ x: SPAWN_X + 1.5, y: SPAWN_Y, z: SPAWN_Z, spawnSlot: 1 })
    expect(room.players['runner-1'].x).toBeGreaterThanOrEqual(START.minX)
    expect(room.players['runner-1'].z).toBeLessThanOrEqual(START.maxZ)

    room = leaveRoom(room, 'session-a')
    room = joinRoom(room, 'runner-3', 'session-c')
    expect(room.players['runner-3']).toMatchObject({ x: SPAWN_X, y: SPAWN_Y, z: SPAWN_Z, spawnSlot: 0 })
  })

  it('holds a spawned runner on the platform instead of drifting under gravity', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    for (let tick = 0; tick < 20; tick += 1) room = stepRoom(room, 0.05)

    expect(room.players['runner-1'].y).toBeCloseTo(SPAWN_Y)
    expect(room.players['runner-1'].grounded).toBe(true)
    expect(room.players['runner-1'].velocityY).toBe(0)
  })

  it('lands a falling runner on the route platform beneath it', () => {
    const target = platformSurface(4)
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = placeRunner(room, 'runner-1', { x: -8, y: target.top + 6, z: 10, grounded: false, velocityY: 0 })
    room = stepUntil(room, (state) => state.players['runner-1'].grounded)

    expect(room.players['runner-1'].y).toBeCloseTo(target.top + PLAYER_HALF_HEIGHT)
    expect(room.players['runner-1'].velocityY).toBe(0)
  })

  it('keeps falling to the floor past a platform the runner misses horizontally', () => {
    const target = platformSurface(4)
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = placeRunner(room, 'runner-1', { x: target.maxX + 3, y: target.top + 6, z: 10, grounded: false, velocityY: 0 })
    room = stepUntil(room, (state) => state.players['runner-1'].grounded)

    expect(room.players['runner-1'].y).toBeCloseTo(PLAYGROUND_GROUND_TOP + PLAYER_HALF_HEIGHT)
  })

  it('does not snap a rising runner onto a platform it passes from below', () => {
    const target = platformSurface(4)
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = placeRunner(room, 'runner-1', { x: -8, y: target.top - 1, z: 10, grounded: false, velocityY: 12 })
    room = stepRoom(room, 0.05)

    expect(room.players['runner-1'].grounded).toBe(false)
    expect(room.players['runner-1'].y).toBeGreaterThan(target.top - 1)
  })

  it('caps oversized ticks so a long stall cannot tunnel a runner through the world', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = placeRunner(room, 'runner-1', { x: 0, y: 30, z: 0, grounded: false, velocityY: 0 })
    room = stepRoom(room, 3_600)

    expect(room.elapsed).toBe(0.1)
    expect(room.players['runner-1'].y).toBeGreaterThan(PLAYGROUND_GROUND_TOP)

    room = stepUntil(room, (state) => state.players['runner-1'].grounded)
    expect(room.players['runner-1'].y).toBeCloseTo(PLAYGROUND_GROUND_TOP + PLAYER_HALF_HEIGHT)
  })

  it('clamps runners to the playground world bounds', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = placeRunner(room, 'runner-1', { x: PLAYGROUND_HALF_EXTENT - 0.2, z: 0 })
    room = applyPlayerInput(room, 'session-a', { sequence: 1, right: true, cameraYaw: 0 })
    for (let tick = 0; tick < 10; tick += 1) room = stepRoom(room, 0.05)

    expect(room.players['runner-1'].x).toBe(PLAYGROUND_HALF_EXTENT)
  })

  it('exposes the final route platform as the shared exit geometry', () => {
    expect(finalPlatformSurface().index).toBeGreaterThan(0)
  })
})

describe('server-owned match, lava, and outcome', () => {
  const EXIT = finalPlatformSurface()

  function runTicks(room: AuthoritativeRoomState, ticks: number, delta = 0.1): AuthoritativeRoomState {
    let current = room
    for (let tick = 0; tick < ticks; tick += 1) current = stepRoom(current, delta)
    return current
  }

  it('raises lava from server elapsed time for a non-cycle-aligned duration', () => {
    const room = runTicks(createRoomState({ durationSeconds: 20 }), 100)

    expect(room.elapsed).toBeCloseTo(10)
    expect(room.durationSeconds).toBe(20)
    expect(room.lavaHeight).toBeCloseTo(lavaStateAt(10, 20).height)
    expect(room.lavaPhase).toBe(lavaStateAt(10, 20).phase)
  })

  it('keeps rising through later lava cycles of a full length match', () => {
    const room = runTicks(createRoomState(), 950)

    expect(room.elapsed).toBeCloseTo(95)
    expect(room.lavaHeight).toBeCloseTo(lavaStateAt(95, 180).height)
    expect(room.lavaHeight).toBeGreaterThan(lavaStateAt(35, 180).height)
  })

  it('eliminates a runner touching lava exactly once and freezes them', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')
    room = placeRunner(room, 'runner-1', { y: -3.7 })
    room = stepRoom(room, 0.1)

    expect(room.players['runner-1'].alive).toBe(false)
    expect(room.players['runner-2'].alive).toBe(true)
    expect(room.eliminations).toBe(1)

    const frozen = { ...room.players['runner-1'] }
    room = runTicks(room, 5)
    expect(room.eliminations).toBe(1)
    expect(room.players['runner-1'].x).toBe(frozen.x)
    expect(room.players['runner-1'].y).toBe(frozen.y)
    expect(room.players['runner-1'].z).toBe(frozen.z)
  })

  it('stops accepting movement and jump from an eliminated runner', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')
    room = placeRunner(room, 'runner-1', { y: -3.7 })
    room = stepRoom(room, 0.1)
    const dead = { ...room.players['runner-1'] }

    room = applyPlayerInput(room, 'session-a', { sequence: 1, forward: true, jump: true, sprint: true })
    room = runTicks(room, 4)

    expect(room.players['runner-1'].x).toBe(dead.x)
    expect(room.players['runner-1'].z).toBe(dead.z)
    expect(room.players['runner-1'].velocityY).toBe(0)
  })

  it('marks escape on the final route platform and awards runners the win', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')
    room = placeRunner(room, 'runner-1', {
      x: (EXIT.minX + EXIT.maxX) / 2,
      y: EXIT.top + PLAYER_HALF_HEIGHT,
      z: (EXIT.minZ + EXIT.maxZ) / 2,
    })
    room = stepRoom(room, 0.1)

    expect(room.players['runner-1'].escaped).toBe(true)
    expect(room.players['runner-2'].escaped).toBe(false)
    expect(room.phase).toBe('finished')
    expect(room.winner).toBe('runners')
  })

  it('freezes the whole room once the match is finished', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = placeRunner(room, 'runner-1', {
      x: (EXIT.minX + EXIT.maxX) / 2,
      y: EXIT.top + PLAYER_HALF_HEIGHT,
      z: (EXIT.minZ + EXIT.maxZ) / 2,
    })
    room = stepRoom(room, 0.1)
    const finished = room

    room = applyPlayerInput(room, 'session-a', { sequence: 9, forward: true })
    room = runTicks(room, 10)

    expect(room.elapsed).toBe(finished.elapsed)
    expect(room.players['runner-1'].x).toBe(finished.players['runner-1'].x)
    expect(room.winner).toBe('runners')
  })

  it('awards the warden the win when every runner is eliminated', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')
    room = placeRunner(room, 'runner-1', { y: -3.7 })
    room = placeRunner(room, 'runner-2', { y: -3.7 })
    room = stepRoom(room, 0.1)

    expect(room.eliminations).toBe(2)
    expect(room.phase).toBe('finished')
    expect(room.winner).toBe('warden')
  })

  /** Places the room one tick short of the deadline so the next tick lands exactly on it. */
  function pinToDeadlineEve(room: AuthoritativeRoomState, remaining: number): AuthoritativeRoomState {
    return { ...room, elapsed: room.durationSeconds - remaining }
  }

  it('lets a runner grounded on the exit at the deadline escape instead of drowning', () => {
    let room = joinRoom(createRoomState({ durationSeconds: 20 }), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')
    room = placeRunner(room, 'runner-1', {
      x: (EXIT.minX + EXIT.maxX) / 2,
      y: EXIT.top + PLAYER_HALF_HEIGHT,
      z: (EXIT.minZ + EXIT.maxZ) / 2,
    })
    room = stepRoom(pinToDeadlineEve(room, 0.05), 0.1)

    expect(room.elapsed).toBe(20)
    expect(room.lavaHeight).toBeGreaterThan(EXIT.top + PLAYER_HALF_HEIGHT)
    expect(room.players['runner-1'].alive).toBe(true)
    expect(room.players['runner-1'].escaped).toBe(true)
    expect(room.phase).toBe('finished')
    expect(room.winner).toBe('runners')
  })

  it('awards the warden the win when the deadline arrives with no escape', () => {
    let room = joinRoom(createRoomState({ durationSeconds: 20 }), 'runner-1', 'session-a')
    // Parked far above the final lava height, so only the deadline itself can end the match.
    room = placeRunner(room, 'runner-1', { x: 0, y: 30, z: 0, grounded: false, velocityY: 0 })
    room = stepRoom(pinToDeadlineEve(room, 0.05), 0.1)

    expect(room.elapsed).toBe(20)
    expect(room.players['runner-1'].alive).toBe(true)
    expect(room.players['runner-1'].escaped).toBe(false)
    expect(room.phase).toBe('finished')
    expect(room.winner).toBe('warden')
  })

  it('never declares a winner in an empty room', () => {
    const room = runTicks(createRoomState({ durationSeconds: 5 }), 100)

    expect(room.elapsed).toBe(5)
    expect(room.phase).toBe('final-escape')
    expect(room.winner).toBeNull()
  })

  it('restarts a finished match back to spawn for the remaining sessions', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = placeRunner(room, 'runner-1', { y: -3.7 })
    room = stepRoom(room, 0.1)
    expect(room.winner).toBe('warden')

    room = restartRoom(room)

    expect(room.elapsed).toBe(0)
    expect(room.phase).toBe('running')
    expect(room.winner).toBeNull()
    expect(room.eliminations).toBe(0)
    expect(room.players['runner-1']).toMatchObject({
      x: SPAWN_X,
      y: SPAWN_Y,
      z: SPAWN_Z,
      alive: true,
      escaped: false,
    })
    expect(room.sessions['session-a']).toBe('runner-1')
  })

  it('publishes match state without leaking authority-only fields', () => {
    let room = joinRoom(createRoomState({ durationSeconds: 20 }), 'runner-1', 'session-a')
    room = stepRoom(room, 0.1)

    const snapshot = publicRoomSnapshot(room)
    expect(snapshot).toMatchObject({
      elapsed: room.elapsed,
      durationSeconds: 20,
      lavaHeight: room.lavaHeight,
      lavaPhase: room.lavaPhase,
      phase: 'running',
      winner: null,
      eliminations: 0,
    })
    expect(JSON.stringify(snapshot)).not.toContain('queuedJumpSequence')
  })

  it('rotates forward input by validated camera yaw on the server', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', {
      sequence: 1,
      forward: true,
      cameraYaw: Math.PI / 2,
    })
    room = stepRoom(room, 0.1)

    expect(room.players['runner-1'].x - SPAWN_X).toBeCloseTo(-0.58)
    expect(room.players['runner-1'].z - SPAWN_Z).toBeCloseTo(0)
  })

  it('rejects non-finite camera yaw', () => {
    const room = joinRoom(createRoomState(), 'runner-1', 'session-a')

    expect(applyPlayerInput(room, 'session-a', {
      sequence: 1,
      forward: true,
      cameraYaw: Number.NaN,
    })).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', {
      sequence: 1,
      forward: true,
      cameraYaw: Number.POSITIVE_INFINITY,
    })).toEqual(room)
  })

  it('keeps private ownership and raw input out of public snapshots', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, right: true, cameraYaw: 0 })

    const snapshot = publicRoomSnapshot(room)
    expect(snapshot.players).toEqual({
      'runner-1': {
        id: 'runner-1',
        x: SPAWN_X,
        y: SPAWN_Y,
        z: SPAWN_Z,
        velocityY: 0,
        grounded: true,
        alive: true,
        escaped: false,
        lastProcessedInput: 1,
        lastAcknowledgedJump: 0,
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('session-a')
    expect(JSON.stringify(snapshot)).not.toContain('input')
    expect(JSON.stringify(snapshot)).not.toContain('spawnSlot')
  })

  it('moves players from authenticated session input with a bounded tick', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, forward: true, sprint: true })
    room = stepRoom(room, 1)

    expect(room.players['runner-1'].x - SPAWN_X).toBeCloseTo(0)
    expect(room.players['runner-1'].z - SPAWN_Z).toBeCloseTo(-0.82)
    expect(room.players['runner-1'].lastSequence).toBe(1)
    expect(room.elapsed).toBe(0.1)
  })

  it('does not let a caller address another player by player id', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')

    const attacked = applyPlayerInput(room, 'runner-2', { sequence: 1, left: true })
    expect(attacked).toEqual(room)

    room = applyPlayerInput(room, 'session-a', { sequence: 1, right: true })
    room = stepRoom(room, 0.1)
    expect(room.players['runner-1'].x - SPAWN_X).toBeCloseTo(0.58)
    expect(room.players['runner-2'].x).toBe(SPAWN_X + 1.5)
  })

  it('ignores stale input sequences', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 2, right: true })
    room = applyPlayerInput(room, 'session-a', { sequence: 1, left: true })
    room = stepRoom(room, 0.1)

    expect(room.players['runner-1'].x - SPAWN_X).toBeCloseTo(0.58)
    expect(room.players['runner-1'].lastSequence).toBe(2)
  })

  it('normalizes diagonal movement on the server', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, forward: true, right: true })
    room = stepRoom(room, 0.1)

    expect(Math.hypot(
      room.players['runner-1'].x - SPAWN_X,
      room.players['runner-1'].z - SPAWN_Z,
    )).toBeCloseTo(0.58)
  })

  it('rejects non-finite server tick durations', () => {
    const room = joinRoom(createRoomState(), 'runner-1', 'session-a')

    expect(stepRoom(room, Number.NaN)).toEqual(room)
    expect(stepRoom(room, Number.POSITIVE_INFINITY)).toEqual(room)
    expect(stepRoom(room, Number.NEGATIVE_INFINITY)).toEqual(room)
  })

  it('rejects malformed network input without throwing', () => {
    const room = joinRoom(createRoomState(), 'runner-1', 'session-a')

    expect(applyPlayerInput(room, 'session-a', undefined as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', null as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', { sequence: 1, forward: 'yes' } as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', { sequence: 1, right: 1 } as unknown as PlayerInputCommand)).toEqual(room)
  })

  it('stores special player and session ids as own room entries', () => {
    const room = joinRoom(createRoomState(), '__proto__', 'constructor')

    expect(Object.hasOwn(room.players, '__proto__')).toBe(true)
    expect(Object.hasOwn(room.sessions, 'constructor')).toBe(true)
    expect(room.sessions['constructor']).toBe('__proto__')
  })

  it('removes player ownership immediately when a session leaves', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = leaveRoom(room, 'session-a')

    expect(Object.hasOwn(room.players, 'runner-1')).toBe(false)
    expect(Object.hasOwn(room.sessions, 'session-a')).toBe(false)
    expect(applyPlayerInput(room, 'session-a', { sequence: 1, forward: true })).toEqual(room)
  })

  it('rejects malformed jump intent without moving the player', () => {
    const room = joinRoom(createRoomState(), 'runner-1', 'session-a')

    expect(applyPlayerInput(room, 'session-a', { sequence: 1, jump: 'yes' } as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', { sequence: 1, jump: 1 } as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', { sequence: 1, jump: null } as unknown as PlayerInputCommand)).toEqual(room)
  })

  it('starts a grounded jump with positive vertical velocity', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    const spawnY = room.players['runner-1'].y
    expect(room.players['runner-1'].grounded).toBe(true)

    room = applyPlayerInput(room, 'session-a', { sequence: 1, jump: true })
    room = stepRoom(room, 0.05)

    expect(room.players['runner-1'].velocityY).toBeGreaterThan(0)
    expect(room.players['runner-1'].y).toBeGreaterThan(spawnY)
    expect(room.players['runner-1'].grounded).toBe(false)
  })

  it('ignores a held jump while airborne instead of boosting again', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, jump: true })
    room = stepRoom(room, 0.05)
    const takeoffVelocity = room.players['runner-1'].velocityY

    room = applyPlayerInput(room, 'session-a', { sequence: 2, jump: true })
    room = stepRoom(room, 0.05)

    expect(room.players['runner-1'].velocityY).toBeLessThan(takeoffVelocity)
  })

  it('rejects a stale sequence carrying a jump intent', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 5, jump: false })
    room = applyPlayerInput(room, 'session-a', { sequence: 4, jump: true })
    room = stepRoom(room, 0.05)

    expect(room.players['runner-1'].velocityY).toBeLessThanOrEqual(0)
    expect(room.players['runner-1'].lastSequence).toBe(5)
  })

  it('acknowledges a grounded takeoff with the input sequence that armed the jump', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(0)

    room = applyPlayerInput(room, 'session-a', { sequence: 7, jump: true })
    // Intent alone is not an acknowledgement: only the applied impulse counts.
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(0)

    room = stepRoom(room, 0.05)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(7)
    expect(room.players['runner-1'].velocityY).toBeGreaterThan(0)
    expect(room.players['runner-1'].grounded).toBe(false)
  })

  it('acknowledges the arming sequence even when later input lands before the takeoff tick', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 3, jump: true })
    room = applyPlayerInput(room, 'session-a', { sequence: 4, jump: false })
    room = stepRoom(room, 0.05)

    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(3)
    expect(room.players['runner-1'].lastSequence).toBe(4)
  })

  it('never re-acknowledges held or replayed jump intent while airborne', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, jump: true })
    room = stepRoom(room, 0.05)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(1)

    // A held button raises no false→true edge, so it arms nothing.
    room = applyPlayerInput(room, 'session-a', { sequence: 2, jump: true })
    room = stepRoom(room, 0.05)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(1)

    // A fresh mid-air edge is discarded instead of buffering into a later takeoff.
    room = applyPlayerInput(room, 'session-a', { sequence: 3, jump: false })
    room = applyPlayerInput(room, 'session-a', { sequence: 4, jump: true })
    room = stepRoom(room, 0.05)
    expect(room.players['runner-1'].grounded).toBe(false)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(1)

    const landed = stepUntil(room, (state) => state.players['runner-1'].grounded)
    expect(landed.players['runner-1'].grounded).toBe(true)
    expect(landed.players['runner-1'].lastAcknowledgedJump).toBe(1)

    // Only the next real takeoff advances the acknowledgement again.
    let again = applyPlayerInput(landed, 'session-a', { sequence: 5, jump: false })
    again = applyPlayerInput(again, 'session-a', { sequence: 6, jump: true })
    again = stepRoom(again, 0.05)
    expect(again.players['runner-1'].lastAcknowledgedJump).toBe(6)
  })

  it('resets the jump acknowledgement when the match restarts', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, jump: true })
    room = stepRoom(room, 0.05)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(1)

    room = restartRoom(room)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(0)
    expect(publicRoomSnapshot(room).players['runner-1'].lastAcknowledgedJump).toBe(0)
  })

  it('ignores a client-supplied jump acknowledgement', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', {
      sequence: 1,
      jump: false,
      lastAcknowledgedJump: 999,
    } as unknown as PlayerInputCommand)
    room = stepRoom(room, 0.05)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(0)

    room = applyPlayerInput(room, 'session-a', {
      sequence: 2,
      jump: true,
      lastAcknowledgedJump: 999,
    } as unknown as PlayerInputCommand)
    room = stepRoom(room, 0.05)
    expect(room.players['runner-1'].lastAcknowledgedJump).toBe(2)
  })

  it('limits room capacity and rejects invalid identity lengths', () => {
    let room = createRoomState()
    for (let index = 0; index < 6; index += 1) {
      room = joinRoom(room, `player-${index}`, `session-${index}`)
    }

    expect(Object.keys(room.players)).toHaveLength(6)
    expect(joinRoom(room, 'player-6', 'session-6')).toEqual(room)
    expect(joinRoom(createRoomState(), '', 'session-a')).toEqual(createRoomState())
    expect(joinRoom(createRoomState(), 'runner-1', '')).toEqual(createRoomState())
    expect(joinRoom(createRoomState(), 'x'.repeat(129), 'session-a')).toEqual(createRoomState())
  })
})
