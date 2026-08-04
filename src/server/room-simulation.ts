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
  sessions: Record<string, string>
}

const WALK_SPEED = 5.8
const SPRINT_SPEED = 8.2
const MAX_TICK_SECONDS = 0.1
const MAX_ROOM_PLAYERS = 6
const MAX_ID_LENGTH = 128

function validIdentity(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function withoutKey<T>(record: Record<string, T>, removedKey: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== removedKey))
}

export function createRoomState(): AuthoritativeRoomState {
  return { elapsed: 0, players: emptyRecord<RoomPlayerState>(), sessions: emptyRecord<string>() }
}

export function joinRoom(
  room: AuthoritativeRoomState,
  playerId: string,
  authenticatedSessionId: string,
): AuthoritativeRoomState {
  if (
    !validIdentity(playerId)
    || !validIdentity(authenticatedSessionId)
    || Object.keys(room.players).length >= MAX_ROOM_PLAYERS
    || Object.hasOwn(room.players, playerId)
    || Object.hasOwn(room.sessions, authenticatedSessionId)
  ) return room

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
    sessions: { ...room.sessions, [authenticatedSessionId]: playerId },
  }
}

export function leaveRoom(room: AuthoritativeRoomState, authenticatedSessionId: string): AuthoritativeRoomState {
  if (!Object.hasOwn(room.sessions, authenticatedSessionId)) return room
  const playerId = room.sessions[authenticatedSessionId]

  return {
    ...room,
    players: withoutKey(room.players, playerId),
    sessions: withoutKey(room.sessions, authenticatedSessionId),
  }
}

export function applyPlayerInput(
  room: AuthoritativeRoomState,
  authenticatedSessionId: string,
  input: PlayerInputCommand,
): AuthoritativeRoomState {
  if (!Object.hasOwn(room.sessions, authenticatedSessionId) || typeof input !== 'object' || input === null) return room
  const playerId = room.sessions[authenticatedSessionId]
  if (!Object.hasOwn(room.players, playerId)) return room

  const player = room.players[playerId]
  const controls = [input.forward, input.backward, input.left, input.right, input.sprint]
  if (
    !Number.isSafeInteger(input.sequence)
    || input.sequence <= player.lastSequence
    || controls.some((value) => value !== undefined && typeof value !== 'boolean')
  ) return room

  const command: PlayerInputCommand = {
    sequence: input.sequence,
    forward: input.forward ?? false,
    backward: input.backward ?? false,
    left: input.left ?? false,
    right: input.right ?? false,
    sprint: input.sprint ?? false,
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
  const delta = Math.min(MAX_TICK_SECONDS, Math.max(0, deltaSeconds))
  const players = Object.fromEntries(Object.entries(room.players).map(([id, player]) => {
    const speed = player.input.sprint ? SPRINT_SPEED : WALK_SPEED
    const velocity = movementVelocity(player.input, speed)
    return [id, {
      ...player,
      x: player.x + velocity.x * delta,
      z: player.z + velocity.z * delta,
    }]
  }))

  return { ...room, elapsed: room.elapsed + delta, players }
}
