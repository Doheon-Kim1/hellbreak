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
        grabTargetId: '',
        grabbedById: '',
        grip: 1,
        lastAcknowledgedGrab: 0,
      },
    })
    expect(JSON.stringify(snapshot)).not.toContain('grabCooldownUntil')
    expect(JSON.stringify(snapshot)).not.toContain('grabStartFeetY')
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

  it('rejects malformed rescue intent without moving the player', () => {
    const room = joinRoom(createRoomState(), 'runner-1', 'session-a')

    expect(applyPlayerInput(room, 'session-a', { sequence: 1, grab: 'yes' } as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', { sequence: 1, grab: 1 } as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'session-a', { sequence: 1, grab: null } as unknown as PlayerInputCommand)).toEqual(room)
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

describe('server-owned lava lifeline rescue', () => {
  /**
   * The rescue geometry the mechanic is actually about: a rescuer standing on a route ledge with
   * a teammate falling through the open air beside it, well below the ledge surface.
   */
  const LEDGE = platformSurface(1)
  const LEDGE_X = -22
  const LEDGE_Z = 18
  const LEDGE_STAND_Y = LEDGE.top + PLAYER_HALF_HEIGHT
  /** Camera yaw whose validated forward vector points along +z, from the rescuer to the faller. */
  const YAW_TOWARD_TARGET = Math.PI

  function rescuePair(fallerPose: Partial<RoomPlayerState> = {}): AuthoritativeRoomState {
    let room = joinRoom(createRoomState(), 'rescuer', 'session-a')
    room = joinRoom(room, 'faller', 'session-b')
    room = placeRunner(room, 'rescuer', { x: LEDGE_X, y: LEDGE_STAND_Y, z: LEDGE_Z, grounded: true })
    return placeRunner(room, 'faller', {
      x: LEDGE_X,
      y: -2.45,
      z: 20.2,
      grounded: false,
      velocityY: 0,
      ...fallerPose,
    })
  }

  function holdGrab(
    room: AuthoritativeRoomState,
    sequence: number,
    session = 'session-a',
    held = true,
    cameraYaw = YAW_TOWARD_TARGET,
  ): AuthoritativeRoomState {
    return applyPlayerInput(room, session, { sequence, grab: held, cameraYaw })
  }

  it('creates one link when a grounded runner holds E toward an airborne teammate', () => {
    let room = holdGrab(rescuePair(), 4)
    room = stepRoom(room, 0.05)

    expect(room.players['rescuer'].grabTargetId).toBe('faller')
    expect(room.players['rescuer'].grabbedById).toBe('')
    expect(room.players['faller'].grabbedById).toBe('rescuer')
    expect(room.players['faller'].grabTargetId).toBe('')
    // Only the applied link advances the receipt, and only for the rescuer that made it.
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(4)
    expect(room.players['faller'].lastAcknowledgedGrab).toBe(0)
  })

  it('does not link before the server applies the held intent', () => {
    const room = holdGrab(rescuePair(), 4)

    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(0)
  })

  it('ignores a client-supplied target, grip, and rescue receipt', () => {
    let room = rescuePair()
    room = applyPlayerInput(room, 'session-a', {
      sequence: 1,
      grab: true,
      cameraYaw: YAW_TOWARD_TARGET,
      grabTargetId: 'faller',
      grabbedById: 'faller',
      grabStartFeetY: -99,
      grip: 99,
      lastAcknowledgedGrab: 999,
    } as unknown as PlayerInputCommand)

    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['rescuer'].grip).toBe(1)
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(0)

    room = stepRoom(room, 0.05)
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(1)
    expect(room.players['rescuer'].grip).toBeLessThan(1)
  })

  it('hauls the target up toward the rescuer against gravity', () => {
    const start = holdGrab(rescuePair(), 1)
    const before = start.players['faller']
    const room = stepRoom(start, 0.05)
    const after = room.players['faller']

    // Falling alone would only ever subtract gravity, so a rising velocity is the rescue haul.
    expect(after.velocityY).toBeGreaterThan(before.velocityY)
    expect(after.velocityY).toBeGreaterThan(0)
    expect(after.z).toBeLessThan(before.z)
    // The pull may close the gap but never drag the target past its rescuer.
    expect(after.z).toBeGreaterThan(room.players['rescuer'].z)
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.6)
    expect(Number.isFinite(after.x) && Number.isFinite(after.y) && Number.isFinite(after.z)).toBe(true)
  })

  it('stops hauling once the teammate clears the rescuer footing', () => {
    // A teammate already above the rescuer is held, not launched further out of range.
    const above = stepRoom(holdGrab(rescuePair({ y: LEDGE_STAND_Y + 0.4, velocityY: 1 }), 1), 0.05)

    expect(above.players['rescuer'].grabTargetId).toBe('faller')
    expect(above.players['faller'].velocityY).toBeLessThan(1)
  })

  it('drags the rescuer toward the target instead of anchoring them', () => {
    const start = holdGrab(rescuePair(), 1)
    const before = start.players['rescuer'].z
    const room = stepRoom(start, 0.05)

    expect(room.players['rescuer'].z).toBeGreaterThan(before)
    expect(room.players['rescuer'].z - before).toBeLessThan(0.6)
    expect(room.players['rescuer'].grounded).toBe(true)
  })

  it('reduces the rescuer walking speed while the link is held', () => {
    // With the rescue yaw, `right` walks along -x, perpendicular to the +z counter-drag.
    function walkOneTickAfter(grab: boolean): number {
      let room = applyPlayerInput(rescuePair(), 'session-a', {
        sequence: 1,
        grab,
        right: true,
        cameraYaw: YAW_TOWARD_TARGET,
      })
      room = stepRoom(room, 0.05)
      const started = room.players['rescuer'].x
      room = stepRoom(room, 0.05)
      return Math.abs(room.players['rescuer'].x - started)
    }

    const linkedStep = walkOneTickAfter(true)
    const freeStep = walkOneTickAfter(false)

    expect(freeStep).toBeGreaterThan(0)
    expect(linkedStep).toBeGreaterThan(0)
    expect(linkedStep).toBeLessThan(freeStep * 0.75)
  })

  /** A high ledge with open air beside it, so the pair can hang just above the rising lava. */
  const PANIC_LEDGE = platformSurface(4)

  function panicPair(elapsedSeconds: number, fallerPose: Partial<RoomPlayerState> = {}): AuthoritativeRoomState {
    let room = joinRoom(createRoomState(), 'rescuer', 'session-a')
    room = joinRoom(room, 'faller', 'session-b')
    room = placeRunner(room, 'rescuer', {
      x: -8,
      y: PANIC_LEDGE.top + PLAYER_HALF_HEIGHT,
      z: 11.3,
      grounded: true,
    })
    room = placeRunner(room, 'faller', {
      x: -8,
      y: -0.5,
      z: 12.1,
      grounded: false,
      velocityY: -2,
      ...fallerPose,
    })
    return { ...room, elapsed: elapsedSeconds }
  }

  it('boosts pull, lift, drag, and grip drain inside the lava panic band', () => {
    const calm = stepRoom(holdGrab(panicPair(0), 1), 0.05)
    // 39.95s of authoritative lava rise puts the same pose inside the panic band.
    const panic = stepRoom(holdGrab(panicPair(39.95), 1), 0.05)

    expect(calm.players['rescuer'].grabTargetId).toBe('faller')
    expect(panic.players['rescuer'].grabTargetId).toBe('faller')
    expect(calm.players['faller'].y - calm.lavaHeight).toBeGreaterThan(1.5)
    expect(panic.players['faller'].y - panic.lavaHeight).toBeLessThan(1.5)
    expect(panic.players['faller'].y).toBeCloseTo(calm.players['faller'].y)

    expect(panic.players['faller'].velocityY).toBeGreaterThan(calm.players['faller'].velocityY)
    expect(Math.abs(panic.players['faller'].z - 12.1)).toBeGreaterThan(Math.abs(calm.players['faller'].z - 12.1))
    expect(Math.abs(panic.players['rescuer'].z - 11.3)).toBeGreaterThan(Math.abs(calm.players['rescuer'].z - 11.3))
    expect(panic.players['rescuer'].grip).toBeLessThan(calm.players['rescuer'].grip)
  })

  it('never grants lava immunity to a linked pair', () => {
    const room = stepRoom(
      holdGrab(panicPair(39.95, { y: -1.2, velocityY: -6 }), 1),
      0.05,
    )

    expect(room.players['faller'].alive).toBe(false)
    expect(room.eliminations).toBe(1)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['faller'].grabbedById).toBe('')
  })

  it('ignores itself, eliminated teammates, escaped teammates, and an airborne rescuer', () => {
    let alone = joinRoom(createRoomState(), 'rescuer', 'session-a')
    alone = stepRoom(applyPlayerInput(alone, 'session-a', { sequence: 1, grab: true }), 0.05)
    expect(alone.players['rescuer'].grabTargetId).toBe('')
    expect(alone.players['rescuer'].lastAcknowledgedGrab).toBe(0)

    const dead = stepRoom(holdGrab(placeRunner(rescuePair(), 'faller', { alive: false }), 1), 0.05)
    expect(dead.players['rescuer'].grabTargetId).toBe('')

    const escaped = stepRoom(holdGrab(placeRunner(rescuePair(), 'faller', { escaped: true }), 1), 0.05)
    expect(escaped.players['rescuer'].grabTargetId).toBe('')

    // Still well inside reach, but a rescuer who has left the ground cannot hold anyone.
    const airborne = placeRunner(rescuePair(), 'rescuer', { grounded: false, velocityY: 2 })
    const falling = stepRoom(holdGrab(airborne, 1), 0.05)
    expect(falling.players['rescuer'].grounded).toBe(false)
    expect(falling.players['rescuer'].grabTargetId).toBe('')
  })

  it('ignores teammates beyond the reach and behind the validated camera yaw', () => {
    const behind = stepRoom(holdGrab(rescuePair(), 1, 'session-a', true, 0), 0.05)
    expect(behind.players['rescuer'].grabTargetId).toBe('')

    const far = stepRoom(holdGrab(rescuePair({ z: 21.8 }), 1), 0.05)
    expect(far.players['rescuer'].grabTargetId).toBe('')
  })

  it('pulls a grounded teammate only when they stand clearly below the rescuer', () => {
    const ledge = platformSurface(1)

    function groundedPair(targetPose: Partial<RoomPlayerState>, grab: boolean): AuthoritativeRoomState {
      let room = joinRoom(createRoomState(), 'rescuer', 'session-a')
      room = joinRoom(room, 'faller', 'session-b')
      room = placeRunner(room, 'rescuer', { x: -22, y: ledge.top + PLAYER_HALF_HEIGHT, z: 18, grounded: true })
      room = placeRunner(room, 'faller', { velocityY: 0, grounded: true, ...targetPose })
      return stepRoom(applyPlayerInput(room, 'session-a', { sequence: 1, grab, cameraYaw: Math.PI }), 0.05)
    }

    const floor = { x: -22, y: PLAYGROUND_GROUND_TOP + PLAYER_HALF_HEIGHT, z: 20.2 }
    // Left alone the teammate simply stands on the floor below the ledge.
    expect(groundedPair(floor, false).players['faller'].grounded).toBe(true)

    // Grabbing them is what lifts them off it, so the link forms and the haul takes over.
    const below = groundedPair(floor, true)
    expect(below.players['rescuer'].grabTargetId).toBe('faller')
    expect(below.players['faller'].grabbedById).toBe('rescuer')
    expect(below.players['faller'].grounded).toBe(false)
    expect(below.players['faller'].velocityY).toBeGreaterThan(0)

    // A teammate standing level on the same ledge is never a rescue target.
    const level = groundedPair({ x: -22, y: ledge.top + PLAYER_HALF_HEIGHT, z: 19.4 }, true)
    expect(level.players['faller'].grounded).toBe(true)
    expect(level.players['rescuer'].grabTargetId).toBe('')
  })

  it('gives one contested target to the nearest rescuer and breaks ties by player id', () => {
    let room = joinRoom(createRoomState(), 'rescuer-a', 'session-a')
    room = joinRoom(room, 'rescuer-z', 'session-z')
    room = joinRoom(room, 'faller', 'session-f')
    room = placeRunner(room, 'rescuer-a', { x: -26, y: SPAWN_Y, z: 22, grounded: true })
    room = placeRunner(room, 'rescuer-z', { x: -23, y: SPAWN_Y, z: 22, grounded: true })
    room = placeRunner(room, 'faller', { x: -24.5, y: SPAWN_Y + 0.9, z: 22, grounded: false, velocityY: -2 })
    room = applyPlayerInput(room, 'session-a', { sequence: 1, grab: true, cameraYaw: -Math.PI / 2 })
    room = applyPlayerInput(room, 'session-z', { sequence: 1, grab: true, cameraYaw: Math.PI / 2 })
    room = stepRoom(room, 0.05)

    expect(room.players['rescuer-a'].grabTargetId).toBe('faller')
    expect(room.players['rescuer-z'].grabTargetId).toBe('')
    expect(room.players['rescuer-z'].lastAcknowledgedGrab).toBe(0)
    expect(room.players['faller'].grabbedById).toBe('rescuer-a')
  })

  it('does not re-acknowledge a rescue while E stays held', () => {
    let room = stepRoom(holdGrab(rescuePair(), 1), 0.05)
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(1)

    for (let tick = 0; tick < 5; tick += 1) {
      room = stepRoom(holdGrab(room, 2 + tick), 0.05)
      expect(room.players['rescuer'].grabTargetId).toBe('faller')
      expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(1)
    }
  })

  it('enforces a reacquire cooldown after a released link', () => {
    let room = stepRoom(holdGrab(rescuePair(), 1), 0.05)
    expect(room.players['rescuer'].grabTargetId).toBe('faller')

    room = stepRoom(holdGrab(room, 2, 'session-a', false), 0.05)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['rescuer'].grabCooldownUntil).toBeCloseTo(room.elapsed + 1)

    // Pressing again inside the cooldown window cannot start a second link.
    room = stepRoom(holdGrab(room, 3), 0.05)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(1)
  })

  it('exhausts grip, drops the link, and applies the longer cooldown', () => {
    const room = stepRoom(holdGrab(placeRunner(rescuePair(), 'rescuer', { grip: 0.01 }), 1), 0.05)

    expect(room.players['rescuer'].grip).toBe(0)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['faller'].grabbedById).toBe('')
    expect(room.players['rescuer'].grabCooldownUntil).toBeCloseTo(room.elapsed + 1.5)
  })

  it('regenerates grip only while grounded and unlinked, and clamps it to one', () => {
    const grounded = stepRoom(placeRunner(rescuePair(), 'rescuer', { grip: 0.5 }), 0.1)
    expect(grounded.players['rescuer'].grip).toBeCloseTo(0.522)

    const airborne = stepRoom(
      placeRunner(rescuePair(), 'rescuer', { grip: 0.5, grounded: false, y: SPAWN_Y + 3, velocityY: 0 }),
      0.1,
    )
    expect(airborne.players['rescuer'].grounded).toBe(false)
    expect(airborne.players['rescuer'].grip).toBe(0.5)

    const rested = stepUntil(rescuePair(), () => false, 60)
    expect(rested.players['rescuer'].grip).toBe(1)
  })

  it('breaks the link on release, on range, and when the rescuer loses its footing', () => {
    const linked = stepRoom(holdGrab(rescuePair(), 1), 0.05)
    expect(linked.players['rescuer'].grabTargetId).toBe('faller')

    const released = stepRoom(holdGrab(linked, 2, 'session-a', false), 0.05)
    expect(released.players['rescuer'].grabTargetId).toBe('')
    expect(released.players['faller'].grabbedById).toBe('')

    const ranged = stepRoom(holdGrab(placeRunner(linked, 'faller', { y: SPAWN_Y + 8 }), 2), 0.05)
    expect(ranged.players['rescuer'].grabTargetId).toBe('')

    const slipped = stepRoom(
      holdGrab(placeRunner(linked, 'rescuer', { grounded: false, y: SPAWN_Y + 2, velocityY: 3 }), 2),
      0.05,
    )
    expect(slipped.players['rescuer'].grounded).toBe(false)
    expect(slipped.players['rescuer'].grabTargetId).toBe('')
  })

  /** A high ledge the rescuer can stand on the very lip of, so one counter-drag step clears it. */
  const LIP_LEDGE = platformSurface(4)

  it('drops the link when the counter-drag pulls the rescuer off its own ledge', () => {
    let room = joinRoom(createRoomState(), 'rescuer', 'session-a')
    room = joinRoom(room, 'faller', 'session-b')
    room = placeRunner(room, 'rescuer', {
      x: -8,
      y: LIP_LEDGE.top + PLAYER_HALF_HEIGHT,
      z: LIP_LEDGE.maxZ - 0.02,
      grounded: true,
    })
    room = placeRunner(room, 'faller', {
      x: -8,
      y: -0.5,
      z: LIP_LEDGE.maxZ + 0.6,
      grounded: false,
      velocityY: 0,
    })
    room = stepRoom(holdGrab(room, 1), 0.05)

    // The counter-drag is what carries the rescuer past the lip, with the target still in open air.
    expect(room.players['rescuer'].z).toBeGreaterThan(LIP_LEDGE.maxZ)
    expect(room.players['rescuer'].grounded).toBe(false)
    expect(room.players['faller'].grounded).toBe(false)

    // A rescuer with no footing may not hold anyone, so the link is neither published nor charged for.
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['faller'].grabbedById).toBe('')
    expect(room.players['rescuer'].grip).toBe(1)
    // The room really did make the link this tick, so the receipt stands and the failure costs a cooldown.
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(1)
    expect(room.players['rescuer'].grabCooldownUntil).toBeCloseTo(room.elapsed + 1)
  })

  it('completes a rescue when the target lands above its link-start feet height', () => {
    const ledge = platformSurface(1)
    let room = joinRoom(createRoomState(), 'rescuer', 'session-a')
    room = joinRoom(room, 'faller', 'session-b')
    room = placeRunner(room, 'rescuer', { x: -22, y: ledge.top + PLAYER_HALF_HEIGHT, z: 18, grounded: true })
    room = placeRunner(room, 'faller', { x: -22, y: -2.45, z: 20.2, grounded: false, velocityY: 0 })
    room = stepRoom(applyPlayerInput(room, 'session-a', { sequence: 1, grab: true, cameraYaw: Math.PI }), 0.05)

    const startFeet = room.players['rescuer'].grabStartFeetY
    expect(room.players['rescuer'].grabTargetId).toBe('faller')

    let sequence = 1
    for (let tick = 0; tick < 200 && !room.players['faller'].grounded; tick += 1) {
      sequence += 1
      room = applyPlayerInput(room, 'session-a', { sequence, grab: true, cameraYaw: Math.PI })
      room = stepRoom(room, 0.05)
    }

    expect(room.players['faller'].grounded).toBe(true)
    expect(room.players['faller'].y - PLAYER_HALF_HEIGHT).toBeGreaterThanOrEqual(startFeet + 0.3)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['faller'].grabbedById).toBe('')
    // A completed rescue is rewarded with no reacquire cooldown.
    expect(room.players['rescuer'].grabCooldownUntil).toBe(0)
  })

  it('clears both link sides when a linked runner disconnects', () => {
    let room = stepRoom(holdGrab(rescuePair(), 1), 0.05)
    expect(room.players['rescuer'].grabTargetId).toBe('faller')

    room = leaveRoom(room, 'session-b')
    expect(Object.hasOwn(room.players, 'faller')).toBe(false)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['rescuer'].grabbedById).toBe('')
  })

  it('makes a rescuer wait out the reacquire cooldown when its target disconnects', () => {
    let room = joinRoom(rescuePair(), 'spare', 'session-c')
    room = stepRoom(holdGrab(room, 1), 0.05)
    expect(room.players['rescuer'].grabTargetId).toBe('faller')

    // A second teammate hanging in reach is exactly what a dropped link must not hand over to.
    room = placeRunner(room, 'spare', { x: LEDGE_X, y: -2.45, z: 19.8, grounded: false, velocityY: 0 })
    room = leaveRoom(room, 'session-b')

    expect(Object.hasOwn(room.players, 'spare')).toBe(true)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['rescuer'].grabCooldownUntil).toBeGreaterThanOrEqual(room.elapsed + 1)

    // Losing a target is a failed rescue, so held E cannot hop straight onto the next teammate.
    room = stepRoom(holdGrab(room, 2), 0.05)
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['spare'].grabbedById).toBe('')
    expect(room.players['rescuer'].lastAcknowledgedGrab).toBe(1)
  })

  it('leaves a held teammate free to rescue when its own rescuer disconnects', () => {
    let room = stepRoom(holdGrab(rescuePair(), 1), 0.05)
    expect(room.players['faller'].grabbedById).toBe('rescuer')

    room = leaveRoom(room, 'session-a')

    // The target never held anything, so a vanished rescuer costs it no reacquire cooldown.
    expect(room.players['faller'].grabbedById).toBe('')
    expect(room.players['faller'].grabCooldownUntil).toBe(0)
  })

  it('clears every link when the match finishes and resets rescue state on restart', () => {
    const exit = finalPlatformSurface()
    let room = joinRoom(rescuePair(), 'winner', 'session-c')
    room = stepRoom(holdGrab(room, 1), 0.05)
    expect(room.players['rescuer'].grabTargetId).toBe('faller')

    room = placeRunner(room, 'winner', {
      x: (exit.minX + exit.maxX) / 2,
      y: exit.top + PLAYER_HALF_HEIGHT,
      z: (exit.minZ + exit.maxZ) / 2,
    })
    room = stepRoom(holdGrab(room, 2), 0.05)

    expect(room.phase).toBe('finished')
    expect(room.players['rescuer'].grabTargetId).toBe('')
    expect(room.players['faller'].grabbedById).toBe('')

    room = restartRoom(room)
    expect(room.players['rescuer']).toMatchObject({
      grabTargetId: '',
      grabbedById: '',
      grabStartFeetY: 0,
      grip: 1,
      grabCooldownUntil: 0,
      lastAcknowledgedGrab: 0,
    })
    expect(publicRoomSnapshot(room).players['rescuer'].lastAcknowledgedGrab).toBe(0)
  })

  it('never builds a chain, a cycle, or a second incoming link in a crowded room', () => {
    let room = createRoomState()
    for (let index = 0; index < 6; index += 1) room = joinRoom(room, `runner-${index}`, `session-${index}`)

    let observedLinks = 0
    for (let tick = 1; tick <= 120; tick += 1) {
      for (let index = 0; index < 6; index += 1) {
        room = applyPlayerInput(room, `session-${index}`, {
          sequence: tick,
          grab: true,
          jump: (tick + index) % 7 === 0,
          cameraYaw: (index * Math.PI) / 3,
        })
      }
      room = stepRoom(room, 0.05)

      const incoming = new Map<string, string>()
      for (const [id, player] of Object.entries(room.players)) {
        expect(Number.isFinite(player.x)).toBe(true)
        expect(Number.isFinite(player.y)).toBe(true)
        expect(Number.isFinite(player.z)).toBe(true)
        expect(Number.isFinite(player.velocityY)).toBe(true)
        expect(player.grip).toBeGreaterThanOrEqual(0)
        expect(player.grip).toBeLessThanOrEqual(1)
        expect(Math.abs(player.x)).toBeLessThanOrEqual(PLAYGROUND_HALF_EXTENT)
        expect(Math.abs(player.z)).toBeLessThanOrEqual(PLAYGROUND_HALF_EXTENT)
        if (player.grabTargetId === '') continue

        observedLinks += 1
        // A rescuer is never also somebody's target, which rules out chains and cycles.
        expect(player.grabbedById).toBe('')
        expect(player.grabTargetId).not.toBe(id)
        expect(incoming.has(player.grabTargetId)).toBe(false)
        incoming.set(player.grabTargetId, id)
      }

      for (const [targetId, rescuerId] of incoming) {
        expect(room.players[targetId].grabbedById).toBe(rescuerId)
        expect(room.players[targetId].grabTargetId).toBe('')
      }
    }

    // The soak has to actually create links, otherwise the invariants hold vacuously.
    expect(observedLinks).toBeGreaterThan(0)
  })
})
