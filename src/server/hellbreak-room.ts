import { Room, ServerError } from '@colyseus/core'
import type { AuthContext, Client } from '@colyseus/core'
import {
  MAX_ROOM_PLAYERS,
  ROOM_TICK_MS,
} from '../shared/multiplayer-protocol'
import type { MultiplayerInputCommand, RoomJoinOptions } from '../shared/multiplayer-protocol'
import {
  applyPlayerInput,
  createRoomState,
  joinRoom,
  leaveRoom,
  publicRoomSnapshot,
  restartRoom,
  stepRoom,
} from './room-simulation'
import type { AuthoritativeRoomState } from './room-simulation'
import { HellbreakRoomState, PlayerSchema } from './hellbreak-state'
import {
  ROOM_AUTH_ERROR_CODE,
  authorizeRoomJoin,
  bindRoomToMatch,
  createReplayGuard,
  createSeatLedger,
  readRoomAuthPolicy,
} from './room-auth'
import type { ReplayGuard, RoomAuthPolicy, SeatLedger } from './room-auth'

export interface RoomAuthEnvironment {
  policy: RoomAuthPolicy
  guard: ReplayGuard
  now: () => number
  /** How long an approved-but-not-yet-seated identity stays claimed. Tests pin it; deployments do not. */
  pendingSeatMs?: number
}

let configuredAuth: RoomAuthEnvironment | null = null

/**
 * Installs the join policy for every room this process creates. Colyseus constructs rooms itself,
 * so the policy is handed to the class rather than to a constructor.
 */
export function configureRoomAuth(environment: RoomAuthEnvironment): void {
  configuredAuth = environment
}

/** Falls back to the ambient environment, so a directly constructed room is never policy-free. */
function roomAuth(): RoomAuthEnvironment {
  if (!configuredAuth) {
    configuredAuth = {
      policy: readRoomAuthPolicy(process.env),
      guard: createReplayGuard(),
      now: () => Date.now(),
    }
  }
  return configuredAuth
}

/** What `onAuth` hands to `onJoin` through `client.auth`. Never sent to any client. */
interface SeatGrant {
  mode: 'guest' | 'authenticated'
  identity: string | null
}

export class HellbreakRoom extends Room<{
  state: HellbreakRoomState
  metadata: { assignedRoomId: string }
}> {
  private simulation: AuthoritativeRoomState = createRoomState()
  /** The match this room serves, or `null` for a guest demo room. Decided once, in `onCreate`. */
  private assignedRoomId: string | null = null
  /**
   * Which HIVE identities this room has promised a seat to. Server-side only: identities are never
   * published in room state. `onAuth` claims, `onJoin` promotes, `onLeave` and `onDispose` release.
   */
  private readonly seats: SeatLedger = createSeatLedger({ pendingMs: roomAuth().pendingSeatMs })

  onCreate(options: RoomJoinOptions): void {
    const { policy, now } = roomAuth()
    // A room is claimed for a match before it exists, so a guest can never inherit an
    // authenticated room and an authenticated match can never land in a guest room.
    const binding = bindRoomToMatch(options, { policy, nowMs: now() })
    if (!binding.ok) throw new ServerError(binding.code, binding.reason)

    this.assignedRoomId = binding.assignedRoomId
    this.maxClients = MAX_ROOM_PLAYERS
    this.maxMessagesPerSecond = 30
    this.patchRate = ROOM_TICK_MS
    this.state = new HellbreakRoomState()
    this.state.joinMode = binding.assignedRoomId === null ? 'guest' : 'authenticated'

    this.onMessage<MultiplayerInputCommand>('input', (client, input) => {
      this.simulation = applyPlayerInput(this.simulation, client.sessionId, input)
      this.syncPublicState()
    })

    // Restart carries no payload: only a seated session may reset an already finished match.
    this.onMessage('restart', (client) => {
      if (
        !Object.hasOwn(this.simulation.sessions, client.sessionId)
        || this.simulation.phase !== 'finished'
      ) return
      this.simulation = restartRoom(this.simulation)
      this.syncPublicState()
    })

    this.setSimulationInterval((deltaTime) => {
      this.simulation = stepRoom(this.simulation, deltaTime / 1_000)
      this.state.serverTick += 1
      this.syncPublicState()
    }, ROOM_TICK_MS)
  }

  /**
   * The single gate for room ownership. It runs before a seat exists, so a refusal here means the
   * connection never reaches the simulation at all.
   *
   * An approval also claims the identity, inside `authorizeRoomJoin`, before this returns. Colyseus
   * awaits this callback and only then calls `onJoin`, so leaving the claim until then would be a
   * check on state that a second connection is free to pass in the meantime.
   */
  onAuth(client: Client, options: RoomJoinOptions, _context: AuthContext): SeatGrant {
    const { policy, guard, now } = roomAuth()
    const authorization = authorizeRoomJoin(options, {
      policy,
      guard,
      assignedRoomId: this.assignedRoomId,
      sessionId: client.sessionId,
      seats: this.seats,
      nowMs: now(),
    })
    if (!authorization.ok) throw new ServerError(authorization.code, authorization.reason)

    return { mode: authorization.mode, identity: authorization.identity }
  }

  onJoin(client: Client): void {
    const grant = client.auth as SeatGrant | undefined
    if (grant?.identity && !this.seats.seat(client.sessionId, grant.identity, roomAuth().now())) {
      // The reservation `onAuth` took has not survived the trip here: it lapsed on the way, or
      // another connection holds the identity now. A promotion that cannot find its own live
      // reservation is a refusal, never a new seat — so the simulation never sees this client.
      throw new ServerError(ROOM_AUTH_ERROR_CODE, 'identity-already-seated')
    }
    // The published player id stays the Colyseus session id: a HIVE identity is authorization
    // input, not something every other browser in the room gets to see.
    this.simulation = joinRoom(this.simulation, client.sessionId, client.sessionId)
    this.syncPublicState()
  }

  onLeave(client: Client): void {
    this.seats.release(client.sessionId)
    this.simulation = leaveRoom(this.simulation, client.sessionId)
    this.syncPublicState()
  }

  /**
   * A room that is gone holds nothing. `onLeave` already releases every seated client, so this only
   * matters for a reservation whose connection died between `onAuth` and `onJoin` — Colyseus skips
   * `onLeave` for a client that never entered the room.
   */
  onDispose(): void {
    this.seats.clear()
  }

  private syncPublicState(): void {
    const snapshot = publicRoomSnapshot(this.simulation)
    this.state.elapsed = snapshot.elapsed
    this.state.durationSeconds = snapshot.durationSeconds
    this.state.lavaHeight = snapshot.lavaHeight
    this.state.lavaPhase = snapshot.lavaPhase
    this.state.matchPhase = snapshot.phase
    this.state.winner = snapshot.winner ?? ''
    this.state.eliminations = snapshot.eliminations

    for (const playerId of this.state.players.keys()) {
      if (!Object.hasOwn(snapshot.players, playerId)) this.state.players.delete(playerId)
    }

    for (const [playerId, player] of Object.entries(snapshot.players)) {
      let publicPlayer = this.state.players.get(playerId)
      if (!publicPlayer) {
        publicPlayer = new PlayerSchema()
        publicPlayer.id = playerId
        this.state.players.set(playerId, publicPlayer)
      }
      publicPlayer.x = player.x
      publicPlayer.y = player.y
      publicPlayer.z = player.z
      publicPlayer.velocityY = player.velocityY
      publicPlayer.grounded = player.grounded
      publicPlayer.alive = player.alive
      publicPlayer.escaped = player.escaped
      publicPlayer.lastProcessedInput = player.lastProcessedInput
      publicPlayer.lastAcknowledgedJump = player.lastAcknowledgedJump
      publicPlayer.grabTargetId = player.grabTargetId
      publicPlayer.grabbedById = player.grabbedById
      publicPlayer.grip = player.grip
      publicPlayer.lastAcknowledgedGrab = player.lastAcknowledgedGrab
    }
  }
}
