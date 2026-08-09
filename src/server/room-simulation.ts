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
import { RESCUE_BALANCE, rescueConeCos } from './rescue-balance'

export interface PlayerInputCommand {
  sequence: number
  forward?: boolean
  backward?: boolean
  left?: boolean
  right?: boolean
  sprint?: boolean
  jump?: boolean
  /** Held rescue intent. The client may only say "I am holding E", never who it wants to pull. */
  grab?: boolean
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
  /** Player this runner is currently pulling up; empty when not rescuing. */
  grabTargetId: string
  /** Derived every tick from the outgoing links, never accepted from a client. */
  grabbedById: string
  /** Server-private feet height of the target when the link was created, for landing gain. */
  grabStartFeetY: number
  /** Normalized 0..1 rescue grip. */
  grip: number
  /** Server-private room time before which this runner may not start another rescue. */
  grabCooldownUntil: number
  /**
   * Server-owned receipt: the sequence of the input the room actually turned into a rescue link.
   * Held intent that reacquires nothing, and every client-supplied value, leaves it untouched.
   */
  lastAcknowledgedGrab: number
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
  grabTargetId: string
  grabbedById: string
  grip: number
  lastAcknowledgedGrab: number
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

/**
 * Every rescue number comes from the server-owned balance profile. It is imported here and in the
 * room's own tests only: nothing on the client may read or influence it.
 */
const RESCUE = RESCUE_BALANCE
/** Broad forward cone derived from the server-validated camera yaw. */
const RESCUE_CONE_COS = rescueConeCos()

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
    grabTargetId: '',
    grabbedById: '',
    grabStartFeetY: 0,
    grip: 1,
    grabCooldownUntil: 0,
    lastAcknowledgedGrab: 0,
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
  const remaining = withoutKey(room.players, playerId)

  return {
    ...room,
    // A disconnect clears both sides of its link immediately instead of leaving a dangling id.
    players: Object.fromEntries(Object.entries(remaining).map(([id, player]) => {
      const heldTarget = player.grabTargetId === playerId
      const heldBy = player.grabbedById === playerId
      if (!heldTarget && !heldBy) return [id, player] as const

      return [id, {
        ...player,
        grabTargetId: heldTarget ? '' : player.grabTargetId,
        grabbedById: heldBy ? '' : player.grabbedById,
        grabStartFeetY: heldTarget ? 0 : player.grabStartFeetY,
        // Losing a target mid-haul is a failed rescue, so the holder waits out the ordinary
        // reacquire cooldown instead of dropping straight onto the next teammate in reach.
        // Losing a rescuer costs the target nothing: it was never holding anyone.
        grabCooldownUntil: heldTarget
          ? Math.max(player.grabCooldownUntil, room.elapsed + RESCUE.releaseCooldown)
          : player.grabCooldownUntil,
      }] as const
    })),
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
  const controls = [
    input.forward,
    input.backward,
    input.left,
    input.right,
    input.sprint,
    input.jump,
    input.grab,
  ]
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
    grab: input.grab ?? false,
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
  const baseSpeed = player.input.sprint ? SPRINT_SPEED : WALK_SPEED
  // Holding a teammate costs footing, so a rescuer walks slower until the link ends.
  const speed = player.grabTargetId === '' ? baseSpeed : baseSpeed * RESCUE.speedScale
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

function rescueDistance(rescuer: RoomPlayerState, target: RoomPlayerState): number {
  return Math.hypot(target.x - rescuer.x, target.y - rescuer.y, target.z - rescuer.z)
}

/** True while the teammate sits inside the broad forward cone of the validated camera yaw. */
function insideRescueCone(rescuer: RoomPlayerState, target: RoomPlayerState): boolean {
  const dx = target.x - rescuer.x
  const dz = target.z - rescuer.z
  const horizontal = Math.hypot(dx, dz)
  // Someone hanging straight overhead or underfoot has no yaw to compare against.
  if (horizontal < 1e-6) return true
  const forward = rotateMovementByCamera({ x: 0, z: -1 }, rescuer.input.cameraYaw ?? 0)
  return (dx * forward.x + dz * forward.z) / horizontal >= RESCUE_CONE_COS
}

function canHoldRescue(rescuer: RoomPlayerState): boolean {
  return rescuer.alive
    && !rescuer.escaped
    && rescuer.grounded
    && rescuer.input.grab === true
    && rescuer.grip > 0
}

/** An established link survives while the rescuer holds on and the falling teammate is still airborne. */
function linkSurvives(rescuer: RoomPlayerState, target: RoomPlayerState): boolean {
  return canHoldRescue(rescuer)
    && target.alive
    && !target.escaped
    && !target.grounded
    && rescueDistance(rescuer, target) <= RESCUE.breakRange
}

function isRescueCandidate(rescuer: RoomPlayerState, target: RoomPlayerState): boolean {
  return target.alive
    && !target.escaped
    && (!target.grounded || target.y <= rescuer.y - RESCUE.minDrop)
    && rescueDistance(rescuer, target) <= RESCUE.reach
    && insideRescueCone(rescuer, target)
}

interface RescueRequest {
  rescuerId: string
  targetId: string
  distance: number
}

/**
 * Resolves every outgoing link for the tick. Requests are sorted before assignment so object
 * iteration order can never decide a contested target, and a player may hold at most one
 * outgoing and one incoming link, which rules out chains and cycles.
 */
function resolveRescueLinks(
  players: Record<string, RoomPlayerState>,
  elapsed: number,
): { links: Map<string, string>; created: Set<string> } {
  const links = new Map<string, string>()
  const rescuers = new Set<string>()
  const targets = new Set<string>()

  // A link that ends this tick also blocks its rescuer from hopping straight onto someone else.
  const cooling = new Set<string>()
  const ids = Object.keys(players).sort()
  for (const id of ids) {
    const player = players[id]
    if (player.grabTargetId === '') continue
    const target = players[player.grabTargetId]
    if (!target || !linkSurvives(player, target)) {
      cooling.add(id)
      continue
    }
    links.set(id, player.grabTargetId)
    rescuers.add(id)
    targets.add(player.grabTargetId)
  }

  const requests: RescueRequest[] = []
  for (const rescuerId of ids) {
    const rescuer = players[rescuerId]
    if (
      rescuers.has(rescuerId)
      || cooling.has(rescuerId)
      || !canHoldRescue(rescuer)
      || elapsed < rescuer.grabCooldownUntil
    ) continue
    for (const targetId of ids) {
      if (targetId === rescuerId || !isRescueCandidate(rescuer, players[targetId])) continue
      requests.push({ rescuerId, targetId, distance: rescueDistance(rescuer, players[targetId]) })
    }
  }
  requests.sort((left, right) => left.distance - right.distance
    || left.rescuerId.localeCompare(right.rescuerId)
    || left.targetId.localeCompare(right.targetId))

  const created = new Set<string>()
  for (const request of requests) {
    const busy = (id: string) => rescuers.has(id) || targets.has(id)
    if (busy(request.rescuerId) || busy(request.targetId)) continue
    links.set(request.rescuerId, request.targetId)
    rescuers.add(request.rescuerId)
    targets.add(request.targetId)
    created.add(request.rescuerId)
  }

  return { links, created }
}

/** Re-resolves downward support after a rescue nudge changed a runner's column. */
function resettleAfterRescue(player: RoomPlayerState): RoomPlayerState {
  if (player.velocityY > 0) return { ...player, grounded: false }
  const feet = player.y - PLAYER_HALF_HEIGHT
  const support = supportTopBelow(player.x, player.z, feet, feet - RESCUE.supportProbe)
  return support === null
    ? { ...player, grounded: false }
    : { ...player, y: support + PLAYER_HALF_HEIGHT, velocityY: 0, grounded: true }
}

/** Rescuers whose target hangs inside the lava panic band above the authoritative surface. */
function panickingRescuers(
  players: Record<string, RoomPlayerState>,
  links: ReadonlyMap<string, string>,
  lavaHeight: number,
): Set<string> {
  const panicking = new Set<string>()
  for (const [rescuerId, targetId] of links) {
    if (players[targetId].y - lavaHeight < RESCUE.panicHeight) panicking.add(rescuerId)
  }
  return panicking
}

/**
 * Applies one rescue force per target and one counter-drag per rescuer. Every displacement is
 * capped and split so the pair can close the gap but never swap sides or teleport.
 */
function applyRescueForces(
  players: Record<string, RoomPlayerState>,
  links: ReadonlyMap<string, string>,
  panicking: ReadonlySet<string>,
  delta: number,
): void {
  for (const [rescuerId, targetId] of links) {
    const rescuer = players[rescuerId]
    const target = players[targetId]
    const panic = panicking.has(rescuerId)
    const dx = rescuer.x - target.x
    const dz = rescuer.z - target.z
    const horizontal = Math.hypot(dx, dz)
    const unitX = horizontal < 1e-6 ? 0 : dx / horizontal
    const unitZ = horizontal < 1e-6 ? 0 : dz / horizontal
    const force = panic ? RESCUE.panicPullMultiplier : 1
    const pull = Math.min(RESCUE.maxStep, RESCUE.pullSpeed * force * delta, horizontal / 2)
    const drag = Math.min(
      RESCUE.maxStep,
      RESCUE.dragSpeed * (panic ? RESCUE.panicDragMultiplier : 1) * delta,
      horizontal / 2,
    )

    // A haul has a destination: the rescuer's own footing. Below it the teammate is lifted hard
    // against gravity; once they clear it the lift simply stops, so they arc down onto the ledge
    // instead of hovering under the lip or being launched out of rescue range.
    const hauling = target.y < rescuer.y
    players[targetId] = resettleAfterRescue({
      ...target,
      x: clampToWorld(target.x + unitX * pull),
      z: clampToWorld(target.z + unitZ * pull),
      velocityY: hauling
        ? Math.min(RESCUE.maxLiftSpeed, target.velocityY + RESCUE.liftAccel * force * delta)
        : target.velocityY,
    })
    players[rescuerId] = resettleAfterRescue({
      ...rescuer,
      x: clampToWorld(rescuer.x - unitX * drag),
      z: clampToWorld(rescuer.z - unitZ * drag),
    })
  }
}

/**
 * Writes the resolved links back onto the published players. Both sides are cleared when either
 * runner dies, escapes, or the match finishes, and the incoming side is derived here rather than
 * ever being accepted from a client.
 */
function commitRescueLinks(
  players: Record<string, RoomPlayerState>,
  links: Map<string, string>,
  created: Set<string>,
  exhausted: ReadonlySet<string>,
  elapsed: number,
  phase: MatchPhase,
): Record<string, RoomPlayerState> {
  const active = phase === 'finished' ? new Map<string, string>() : new Map(links)
  for (const [rescuerId, targetId] of active) {
    const rescuer = players[rescuerId]
    const target = players[targetId]
    if (!rescuer?.alive || rescuer.escaped || !target?.alive || target.escaped) active.delete(rescuerId)
  }

  const grabbedBy = new Map<string, string>()
  for (const [rescuerId, targetId] of active) grabbedBy.set(targetId, rescuerId)

  return Object.fromEntries(Object.entries(players).map(([id, player]) => {
    const targetId = active.get(id) ?? ''
    const startedNow = targetId !== '' && created.has(id)
    // A counter-drag can remove the rescuer's footing in the same tick that the room accepted the
    // link. Keep the real receipt and failure cooldown even though no public link survives.
    const createdThenBroken = targetId === '' && created.has(id)
    const previous = player.grabTargetId === '' ? null : players[player.grabTargetId] ?? null
    const ended = player.grabTargetId !== '' && targetId !== player.grabTargetId
    // A rescue counts as completed when the target lands measurably above its link-start feet.
    const completed = ended
      && Boolean(previous?.grounded)
      && (previous as RoomPlayerState).y - PLAYER_HALF_HEIGHT >= player.grabStartFeetY + RESCUE.landingGain

    return [id, {
      ...player,
      grabTargetId: targetId,
      grabbedById: grabbedBy.get(id) ?? '',
      grabStartFeetY: startedNow
        ? players[targetId].y - PLAYER_HALF_HEIGHT
        : targetId === '' ? 0 : player.grabStartFeetY,
      lastAcknowledgedGrab: startedNow || createdThenBroken ? player.lastSequence : player.lastAcknowledgedGrab,
      grabCooldownUntil: exhausted.has(id)
        ? elapsed + RESCUE.exhaustionCooldown
        : (ended || createdThenBroken) && !completed
            ? elapsed + RESCUE.releaseCooldown
            : player.grabCooldownUntil,
    }] as const
  }))
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

  // 1-2. Ordinary movement first, so rescue forces act on already-advanced poses.
  const advanced = emptyRecord<RoomPlayerState>()
  for (const [id, player] of Object.entries(room.players)) {
    // Eliminated and escaped runners no longer consume movement or jump intent.
    advanced[id] = !player.alive || player.escaped
      ? { ...player, queuedJumpSequence: 0 }
      : advancePlayer(player, delta)
  }

  // 3-5. Break invalidated links, then resolve new ones deterministically.
  const { links, created } = resolveRescueLinks(advanced, elapsed)

  // 6-7. One rescue force per target and one counter-drag per rescuer, then re-resolve support.
  const panicking = panickingRescuers(advanced, links, lava.height)
  applyRescueForces(advanced, links, panicking, delta)

  // 9. End a link in the same tick when its target lands or counter-drag costs the rescuer their
  // footing. A standing teammate cannot be dragged, and an airborne rescuer cannot hold anyone.
  for (const [rescuerId, targetId] of links) {
    if (!advanced[rescuerId].grounded || advanced[targetId].grounded) links.delete(rescuerId)
  }

  // 8. Grip drains while linked and only regenerates on solid ground without a link.
  const exhausted = new Set<string>()
  for (const [id, player] of Object.entries(advanced)) {
    const linked = links.has(id)
    const drain = RESCUE.gripDrainPerSecond * (panicking.has(id) ? RESCUE.panicDrainMultiplier : 1)
    const grip = linked
      ? player.grip - drain * delta
      : player.grounded ? player.grip + RESCUE.gripRegenPerSecond * delta : player.grip
    advanced[id] = { ...player, grip: Math.min(1, Math.max(0, grip)) }
    // Exhausted grip drops the link inside the same tick that emptied it.
    if (linked && advanced[id].grip <= 0) {
      links.delete(id)
      exhausted.add(id)
    }
  }

  let eliminations = room.eliminations
  const players = Object.fromEntries(Object.entries(advanced).map(([id, moved]) => {
    const player = room.players[id]
    if (!player.alive || player.escaped) return [id, moved] as const

    // On the deadline tick the lava tops out over the exit, so a completed escape resolves first.
    if (atDeadline && reachedExit(moved)) return [id, { ...moved, escaped: true }] as const

    if (drownedInLava(moved, lava.height)) {
      eliminations += 1
      return [id, {
        ...player,
        alive: false,
        velocityY: 0,
        queuedJumpSequence: 0,
        grip: moved.grip,
      }] as const
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
    players: commitRescueLinks(players, links, created, exhausted, elapsed, phase),
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
      grabTargetId: player.grabTargetId,
      grabbedById: player.grabbedById,
      grip: player.grip,
      lastAcknowledgedGrab: player.lastAcknowledgedGrab,
    }])),
  }
}
