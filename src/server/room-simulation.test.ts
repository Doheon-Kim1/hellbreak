import { describe, expect, it } from 'vitest'
import { applyPlayerInput, createRoomState, joinRoom, leaveRoom, stepRoom } from './room-simulation'
import type { PlayerInputCommand } from './room-simulation'

describe('authoritative multiplayer room', () => {
  it('moves players from authenticated session input with a bounded tick', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, forward: true, sprint: true })
    room = stepRoom(room, 1)

    expect(room.players['runner-1']).toMatchObject({ x: 0, z: -0.82, lastSequence: 1 })
    expect(room.elapsed).toBe(0.1)
  })

  it('does not let a caller address another player by player id', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = joinRoom(room, 'runner-2', 'session-b')

    const attacked = applyPlayerInput(room, 'runner-2', { sequence: 1, left: true })
    expect(attacked).toEqual(room)

    room = applyPlayerInput(room, 'session-a', { sequence: 1, right: true })
    room = stepRoom(room, 0.1)
    expect(room.players['runner-1'].x).toBeCloseTo(0.58)
    expect(room.players['runner-2'].x).toBe(0)
  })

  it('ignores stale input sequences', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 2, right: true })
    room = applyPlayerInput(room, 'session-a', { sequence: 1, left: true })
    room = stepRoom(room, 0.1)

    expect(room.players['runner-1'].x).toBeCloseTo(0.58)
    expect(room.players['runner-1'].lastSequence).toBe(2)
  })

  it('normalizes diagonal movement on the server', () => {
    let room = joinRoom(createRoomState(), 'runner-1', 'session-a')
    room = applyPlayerInput(room, 'session-a', { sequence: 1, forward: true, right: true })
    room = stepRoom(room, 0.1)

    expect(Math.hypot(room.players['runner-1'].x, room.players['runner-1'].z)).toBeCloseTo(0.58)
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
