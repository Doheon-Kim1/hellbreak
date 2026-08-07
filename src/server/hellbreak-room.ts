import { Room } from '@colyseus/core'
import type { Client } from '@colyseus/core'
import {
  MAX_ROOM_PLAYERS,
  ROOM_TICK_MS,
} from '../shared/multiplayer-protocol'
import type { MultiplayerInputCommand } from '../shared/multiplayer-protocol'
import {
  applyPlayerInput,
  createRoomState,
  joinRoom,
  leaveRoom,
  stepRoom,
} from './room-simulation'
import type { AuthoritativeRoomState } from './room-simulation'
import { HellbreakRoomState, PlayerSchema } from './hellbreak-state'

export class HellbreakRoom extends Room<{ state: HellbreakRoomState }> {
  private simulation: AuthoritativeRoomState = createRoomState()

  onCreate(): void {
    this.maxClients = MAX_ROOM_PLAYERS
    this.maxMessagesPerSecond = 30
    this.patchRate = ROOM_TICK_MS
    this.state = new HellbreakRoomState()

    this.onMessage<MultiplayerInputCommand>('input', (client, input) => {
      this.simulation = applyPlayerInput(this.simulation, client.sessionId, input)
      this.syncPublicState()
    })

    this.setSimulationInterval((deltaTime) => {
      this.simulation = stepRoom(this.simulation, deltaTime / 1_000)
      this.state.serverTick += 1
      this.syncPublicState()
    }, ROOM_TICK_MS)
  }

  onJoin(client: Client): void {
    this.simulation = joinRoom(this.simulation, client.sessionId, client.sessionId)
    this.syncPublicState()
  }

  onLeave(client: Client): void {
    this.simulation = leaveRoom(this.simulation, client.sessionId)
    this.syncPublicState()
  }

  private syncPublicState(): void {
    this.state.elapsed = this.simulation.elapsed

    for (const playerId of this.state.players.keys()) {
      if (!Object.hasOwn(this.simulation.players, playerId)) this.state.players.delete(playerId)
    }

    for (const [playerId, player] of Object.entries(this.simulation.players)) {
      let publicPlayer = this.state.players.get(playerId)
      if (!publicPlayer) {
        publicPlayer = new PlayerSchema()
        publicPlayer.id = playerId
        this.state.players.set(playerId, publicPlayer)
      }
      publicPlayer.x = player.x
      publicPlayer.y = player.y
      publicPlayer.z = player.z
      publicPlayer.lastProcessedInput = player.lastSequence
    }
  }
}
