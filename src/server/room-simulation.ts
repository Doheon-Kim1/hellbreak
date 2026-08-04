import { movementVelocity } from '../game/movement'

export interface PlayerInputCommand {
  sequence: number
  forward?: boolean
  backward?: boolean
  left?: boolean
  right?: boolean
  sprint?: boolean
}

export interface RoomPlayerState {
  x: number
  z: number
  lastSequence: number
  input: PlayerInputCommand
}

export interface AuthoritativeRoomState {
  elapsed: number
  players: Record<string, RoomPlayerState>
}

const WALK_SPEED = 5.8
const SPRINT_SPEED = 8.2

export function createRoomState(): AuthoritativeRoomState {
  return { elapsed: 0, players: Object.create(null) as Record<string, RoomPlayerState> }
}

export function joinRoom(room: AuthoritativeRoomState, playerId: string): AuthoritativeRoomState {
  if (Object.hasOwn(room.players, playerId)) return room
  return {
    ...room,
    players: {
      ...room.players,
      [playerId]: {
        x: 0,
        z: 0,
        lastSequence: 0,
        input: { sequence: 0 },
      },
    },
  }
}

export function applyPlayerInput(
  room: AuthoritativeRoomState,
  playerId: string,
  input: PlayerInputCommand,
): AuthoritativeRoomState {
  if (!Object.hasOwn(room.players, playerId) || typeof input !== 'object' || input === null) return room
  const player = room.players[playerId]
  const controls = [input.forward, input.backward, input.left, input.right, input.sprint]
  if (
    !Number.isSafeInteger(input.sequence)
    || input.sequence <= player.lastSequence
    || controls.some((value) => value !== undefined && typeof value !== 'boolean')
  ) return room

  const command: PlayerInputCommand = {
    sequence: input.sequence,
    forward: Boolean(input.forward),
    backward: Boolean(input.backward),
    left: Boolean(input.left),
    right: Boolean(input.right),
    sprint: Boolean(input.sprint),
  }

  return {
    ...room,
    players: {
      ...room.players,
      [playerId]: { ...player, lastSequence: command.sequence, input: command },
    },
  }
}

export function stepRoom(room: AuthoritativeRoomState, deltaSeconds: number): AuthoritativeRoomState {
  if (!Number.isFinite(deltaSeconds)) return room
  const delta = Math.max(0, deltaSeconds)
  const players = Object.fromEntries(Object.entries(room.players).map(([id, player]) => {
    const speed = player.input.sprint ? SPRINT_SPEED : WALK_SPEED
    const velocity = movementVelocity(player.input, speed)
    return [id, {
      ...player,
      x: player.x + velocity.x * delta,
      z: player.z + velocity.z * delta,
    }]
  }))

  return { elapsed: room.elapsed + delta, players }
}
