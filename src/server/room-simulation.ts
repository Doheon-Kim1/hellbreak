import { rotateMovementByCamera } from '../game/camera'
import { movementVelocity } from '../game/movement'
import { lavaStateAt } from '../game/match'
import type { LavaPhase, MatchPhase, MatchWinner } from '../game/match'
import {
  PLAYGROUND_HALF_EXTENT,
  coversPoint,
  finalPlatformSurface,
  platformSurface,
  supportTopBelow,
} from '../game/playground'

export interface PlayerInputCommand {
  sequence: number
  forward?: boolean
  backward?: boolean
  left?: boolean
  right?: boolean
  sprint?: boolean
  jump?: boolean
  cameraYaw?: number
}

export interface RoomPlayerState {
  x: number
  y: number
  z: number
  velocityY: number
  grounded: boolean
  alive: boolean
  escaped: boolean
  /** Sequence of the input that armed a takeoff for the next tick; 0 when nothing is armed. */
  queuedJumpSequence: number
  /**
   * Server-owned receipt: the sequence of the input whose jump the room actually turned into a
   * grounded takeoff impulse. Clients cannot set it, and held, replayed, or airborne jump intent
   * leaves it untouched, so an increase is proof that one real jump started.
   */
  lastAcknowledgedJump: number
  spawnSlot: number
  lastSequence: number
  input: PlayerInputCommand
}

export interface AuthoritativeRoomState {
  elapsed: number
  durationSeconds: number
  lavaHeight: number
  lavaPhase: LavaPhase
  phase: MatchPhase
  winner: MatchWinner
  eliminations: number
  players: Record<string, RoomPlayerState>
  sessions: Record<string, string>
}

export interface PublicRoomPlayerSnapshot {
  id: string
  x: number
  y: number
  z: number
  velocityY: number
  grounded: boolean
  alive: boolean
  escaped: boolean
  lastProcessedInput: number
  lastAcknowledgedJump: number
}

export interface PublicRoomSnapshot {
  elapsed: number
  durationSeconds: number
  lavaHeight: number
  lavaPhase: LavaPhase
  phase: MatchPhase
  winner: MatchWinner
  eliminations: number
  players: Record<string, PublicRoomPlayerSnapshot>
}

const WALK_SPEED = 5.8
const SPRINT_SPEED = 8.2
const JUMP_SPEED = 7.4
const GRAVITY = -18
const MAX_TICK_SECONDS = 0.1
const MAX_FALL_SPEED = 45
const MAX_ROOM_PLAYERS = 6
const MAX_ID_LENGTH = 128

const DEFAULT_MATCH_SECONDS = 180
const LAVA_LETHAL_MARGIN = 0.35
const LANDING_EPSILON = 0.01

/** Half the rendered capsule height, so `y` is the avatar centre and `y - half` its feet. */
export const PLAYER_HALF_HEIGHT = 0.72

const START_SURFACE = platformSurface(0)
const EXIT_SURFACE = finalPlatformSurface()
const START_X = (START_SURFACE.minX + START_SURFACE.maxX) / 2
const START_Z = (START_SURFACE.minZ + START_SURFACE.maxZ) / 2
const SPAWN_Y = START_SURFACE.top + PLAYER_HALF_HEIGHT
const SPAWN_POSITIONS = [
  { x: 0, z: 0 },
  { x: 1.5, z: 0 },
  { x: -1.5, z: 0 },
  { x: 0, z: 1.2 },
  { x: 1.5, z: 1.2 },
  { x: -1.5, z: 1.2 },
].map((offset) => ({ x: START_X + offset.x, z: START_Z + offset.z }))

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

export interface RoomOptions {
  durationSeconds?: number
}

export function createRoomState(options: RoomOptions = {}): AuthoritativeRoomState {
  const requested = options.durationSeconds
  const durationSeconds = Number.isFinite(requested) && (requested as number) > 0
    ? (requested as number)
    : DEFAULT_MATCH_SECONDS
  const lava = lavaStateAt(0, durationSeconds)

  return {
    elapsed: 0,
    durationSeconds,
    lavaHeight: lava.height,
    lavaPhase: lava.phase,
    phase: 'running',
    winner: null,
    eliminations: 0,
    players: emptyRecord<RoomPlayerState>(),
    sessions: emptyRecord<string>(),
  }
}

function spawnedPlayer(spawnSlot: number, previous?: RoomPlayerState): RoomPlayerState {
  const spawn = SPAWN_POSITIONS[spawnSlot]
  return {
    x: spawn.x,
    y: SPAWN_Y,
    z: spawn.z,
    velocityY: 0,
    grounded: true,
    alive: true,
    escaped: false,
    queuedJumpSequence: 0,
    // A spawn or restart clears the receipt even though input sequences keep counting up.
    lastAcknowledgedJump: 0,
    spawnSlot,
    lastSequence: previous?.lastSequence ?? 0,
    input: { sequence: previous?.lastSequence ?? 0, cameraYaw: 0 },
  }
}

/** Resets the competitive state while keeping authenticated sessions and their spawn slots. */
export function restartRoom(room: AuthoritativeRoomState): AuthoritativeRoomState {
  const fresh = createRoomState({ durationSeconds: room.durationSeconds })

  return {
    ...fresh,
    players: Object.fromEntries(Object.entries(room.players).map(
      ([id, player]) => [id, spawnedPlayer(player.spawnSlot, player)],
    )),
    sessions: { ...room.sessions },
  }
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

  return {
    ...room,
    players: { ...room.players, [playerId]: spawnedPlayer(spawnSlot) },
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
  const controls = [input.forward, input.backward, input.left, input.right, input.sprint, input.jump]
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
    jump: input.jump ?? false,
    cameraYaw: normalizeYaw(input.cameraYaw ?? 0),
  }

  // Only a false→true transition arms a jump, so a held button cannot buffer repeated takeoffs.
  const jumpEdge = Boolean(command.jump) && !player.input.jump

  return {
    ...room,
    players: {
      ...room.players,
      [playerId]: {
        ...player,
        lastSequence: command.sequence,
        // The first armed sequence wins, so a later input in the same tick cannot rewrite the
        // receipt the client is waiting for.
        queuedJumpSequence: player.queuedJumpSequence || (jumpEdge ? command.sequence : 0),
        input: command,
      },
    },
  }
}

function clampToWorld(value: number): number {
  return Math.min(PLAYGROUND_HALF_EXTENT, Math.max(-PLAYGROUND_HALF_EXTENT, value))
}

function advancePlayer(player: RoomPlayerState, delta: number): RoomPlayerState {
  const speed = player.input.sprint ? SPRINT_SPEED : WALK_SPEED
  const localVelocity = movementVelocity(player.input, speed)
  const velocity = rotateMovementByCamera(localVelocity, player.input.cameraYaw ?? 0)
  const x = clampToWorld(player.x + velocity.x * delta)
  const z = clampToWorld(player.z + velocity.z * delta)

  const takeoff = player.queuedJumpSequence > 0 && player.grounded
  const velocityY = Math.max(
    -MAX_FALL_SPEED,
    (takeoff ? JUMP_SPEED : player.velocityY) + GRAVITY * delta,
  )
  const y = player.y + velocityY * delta
  // Sweeping the feet between ticks keeps fast falls from tunnelling through thin route platforms.
  const support = velocityY <= 0
    ? supportTopBelow(x, z, player.y - PLAYER_HALF_HEIGHT, y - PLAYER_HALF_HEIGHT)
    : null

  return {
    ...player,
    x,
    z,
    y: support === null ? y : support + PLAYER_HALF_HEIGHT,
    velocityY: support === null ? velocityY : 0,
    grounded: support !== null,
    // Unused intent expires with the tick, so an airborne press cannot buffer a later takeoff.
    queuedJumpSequence: 0,
    lastAcknowledgedJump: takeoff ? player.queuedJumpSequence : player.lastAcknowledgedJump,
  }
}

function drownedInLava(player: RoomPlayerState, lavaHeight: number): boolean {
  return player.y < lavaHeight + LAVA_LETHAL_MARGIN
}

function reachedExit(player: RoomPlayerState): boolean {
  return player.grounded
    && coversPoint(EXIT_SURFACE, player.x, player.z)
    && player.y - PLAYER_HALF_HEIGHT >= EXIT_SURFACE.top - LANDING_EPSILON
}

export function stepRoom(room: AuthoritativeRoomState, deltaSeconds: number): AuthoritativeRoomState {
  if (!Number.isFinite(deltaSeconds) || room.phase === 'finished') return room
  const delta = Math.min(MAX_TICK_SECONDS, Math.max(0, deltaSeconds))
  const elapsed = Math.min(room.durationSeconds, room.elapsed + delta)
  const lava = lavaStateAt(elapsed, room.durationSeconds)
  const atDeadline = elapsed >= room.durationSeconds

  let eliminations = room.eliminations
  const players = Object.fromEntries(Object.entries(room.players).map(([id, player]) => {
    // Eliminated and escaped runners no longer consume movement or jump intent.
    if (!player.alive || player.escaped) return [id, { ...player, queuedJumpSequence: 0 }] as const

    const moved = advancePlayer(player, delta)
    // On the deadline tick the lava tops out over the exit, so a completed escape resolves first.
    if (atDeadline && reachedExit(moved)) return [id, { ...moved, escaped: true }] as const

    if (drownedInLava(moved, lava.height)) {
      eliminations += 1
      return [id, { ...player, alive: false, velocityY: 0, queuedJumpSequence: 0 }] as const
    }

    return [id, reachedExit(moved) ? { ...moved, escaped: true } : moved] as const
  }))

  const roster = Object.values(players)
  const escaped = roster.some((player) => player.escaped)
  // An empty room has nobody to lose the race, so it keeps ticking without a winner.
  const wardenWins = roster.length > 0 && (atDeadline || roster.every((player) => !player.alive))
  const winner: MatchWinner = escaped ? 'runners' : wardenWins ? 'warden' : null
  const phase: MatchPhase = winner !== null
    ? 'finished'
    : elapsed >= room.durationSeconds ? 'final-escape' : 'running'

  return {
    ...room,
    elapsed,
    lavaHeight: lava.height,
    lavaPhase: lava.phase,
    phase,
    winner,
    eliminations,
    players,
  }
}

export function publicRoomSnapshot(room: AuthoritativeRoomState): PublicRoomSnapshot {
  return {
    elapsed: room.elapsed,
    durationSeconds: room.durationSeconds,
    lavaHeight: room.lavaHeight,
    lavaPhase: room.lavaPhase,
    phase: room.phase,
    winner: room.winner,
    eliminations: room.eliminations,
    players: Object.fromEntries(Object.entries(room.players).map(([id, player]) => [id, {
      id,
      x: player.x,
      y: player.y,
      z: player.z,
      velocityY: player.velocityY,
      grounded: player.grounded,
      alive: player.alive,
      escaped: player.escaped,
      lastProcessedInput: player.lastSequence,
      lastAcknowledgedJump: player.lastAcknowledgedJump,
    }])),
  }
}
