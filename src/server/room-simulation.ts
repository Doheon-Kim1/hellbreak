import { rotateMovementByCamera } from '../game/camera'
import { movementVelocity } from '../game/movement'

export interface PlayerInputCommand {
  sequence: number
  forward?: boolean
  backward?: boolean
  left?: boolean
  right?: boolean
  sprint?: boolean
  cameraYaw?: number
}

export interface RoomPlayerState {
  x: number
  y: number
  z: number
  spawnSlot: number
  lastSequence: number
  input: PlayerInputCommand
}

export interface AuthoritativeRoomState {
  elapsed: number
  players: Record<string, RoomPlayerState>
  sessions: Record<string, string>
}

export interface PublicRoomPlayerSnapshot {
  id: string
  x: number
  y: number
  z: number
  lastProcessedInput: number
}

export interface PublicRoomSnapshot {
  elapsed: number
  players: Record<string, PublicRoomPlayerSnapshot>
}

const WALK_SPEED = 5.8
const SPRINT_SPEED = 8.2
const MAX_TICK_SECONDS = 0.1
const MAX_ROOM_PLAYERS = 6
const MAX_ID_LENGTH = 128
const SPAWN_Y = -2.2
const SPAWN_POSITIONS = [
  { x: 0, z: 0 },
  { x: 1.5, z: 0 },
  { x: -1.5, z: 0 },
  { x: 0, z: 1.5 },
  { x: 1.5, z: 1.5 },
  { x: -1.5, z: 1.5 },
] as const

function validIdentity(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function withoutKey<T>(record: Record<string, T>, removedKey: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== removedKey))
}

function availableSpawnSlot(room: AuthoritativeRoomState): number {
  const occupied = new Set(Object.values(room.players).map((player) => player.spawnSlot))
  return SPAWN_POSITIONS.findIndex((_, index) => !occupied.has(index))
}

function normalizeYaw(yaw: number): number {
  const fullTurn = Math.PI * 2
  return ((yaw + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI
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

  const spawnSlot = availableSpawnSlot(room)
  if (spawnSlot < 0) return room
  const spawn = SPAWN_POSITIONS[spawnSlot]

  return {
    ...room,
    players: {
      ...room.players,
      [playerId]: {
        x: spawn.x,
        y: SPAWN_Y,
        z: spawn.z,
        spawnSlot,
        lastSequence: 0,
        input: { sequence: 0, cameraYaw: 0 },
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
    || (input.cameraYaw !== undefined && !Number.isFinite(input.cameraYaw))
  ) return room

  const command: PlayerInputCommand = {
    sequence: input.sequence,
    forward: input.forward ?? false,
    backward: input.backward ?? false,
    left: input.left ?? false,
    right: input.right ?? false,
    sprint: input.sprint ?? false,
    cameraYaw: normalizeYaw(input.cameraYaw ?? 0),
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
    const localVelocity = movementVelocity(player.input, speed)
    const velocity = rotateMovementByCamera(localVelocity, player.input.cameraYaw ?? 0)
    return [id, {
      ...player,
      x: player.x + velocity.x * delta,
      z: player.z + velocity.z * delta,
    }]
  }))

  return { ...room, elapsed: room.elapsed + delta, players }
}

export function publicRoomSnapshot(room: AuthoritativeRoomState): PublicRoomSnapshot {
  return {
    elapsed: room.elapsed,
    players: Object.fromEntries(Object.entries(room.players).map(([id, player]) => [id, {
      id,
      x: player.x,
      y: player.y,
      z: player.z,
      lastProcessedInput: player.lastSequence,
    }])),
  }
}
