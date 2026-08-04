import { describe, expect, it } from 'vitest'
import { applyPlayerInput, createRoomState, joinRoom, stepRoom } from './room-simulation'
import type { PlayerInputCommand } from './room-simulation'

describe('authoritative multiplayer room', () => {
  it('moves players from input commands without accepting client positions', () => {
    let room = joinRoom(createRoomState(), 'runner-1')
    room = applyPlayerInput(room, 'runner-1', { sequence: 1, forward: true, sprint: true })
    room = stepRoom(room, 1)

    expect(room.players['runner-1']).toMatchObject({ x: 0, z: -8.2, lastSequence: 1 })
  })

  it('ignores stale input sequences', () => {
    let room = joinRoom(createRoomState(), 'runner-1')
    room = applyPlayerInput(room, 'runner-1', { sequence: 2, right: true })
    room = applyPlayerInput(room, 'runner-1', { sequence: 1, left: true })
    room = stepRoom(room, 1)

    expect(room.players['runner-1'].x).toBe(5.8)
    expect(room.players['runner-1'].lastSequence).toBe(2)
  })

  it('normalizes diagonal movement on the server', () => {
    let room = joinRoom(createRoomState(), 'runner-1')
    room = applyPlayerInput(room, 'runner-1', { sequence: 1, forward: true, right: true })
    room = stepRoom(room, 1)

    expect(Math.hypot(room.players['runner-1'].x, room.players['runner-1'].z)).toBeCloseTo(5.8)
  })

  it('rejects non-finite server tick durations', () => {
    const room = joinRoom(createRoomState(), 'runner-1')

    expect(stepRoom(room, Number.NaN)).toEqual(room)
    expect(stepRoom(room, Number.POSITIVE_INFINITY)).toEqual(room)
  })

  it('rejects malformed network input without throwing', () => {
    const room = joinRoom(createRoomState(), 'runner-1')

    expect(applyPlayerInput(room, 'runner-1', null as unknown as PlayerInputCommand)).toEqual(room)
    expect(applyPlayerInput(room, 'runner-1', { sequence: 1, forward: 'yes' } as unknown as PlayerInputCommand)).toEqual(room)
  })

  it('stores special player ids as own room entries', () => {
    const room = joinRoom(createRoomState(), '__proto__')

    expect(Object.hasOwn(room.players, '__proto__')).toBe(true)
    expect(room.players['__proto__'].x).toBe(0)
  })
})
