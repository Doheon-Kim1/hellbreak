import { MapSchema, Schema, defineTypes } from '@colyseus/schema'

export class PlayerSchema extends Schema {
  id = ''
  x = 0
  y = 0
  z = 0
  velocityY = 0
  grounded = true
  alive = true
  escaped = false
  lastProcessedInput = 0
  /** Sequence of the last jump the server actually applied as a grounded takeoff. */
  lastAcknowledgedJump = 0
  /** Outgoing rescue link; empty string means "not rescuing anyone". */
  grabTargetId = ''
  /** Incoming rescue link, derived by the room and never accepted from a client. */
  grabbedById = ''
  grip = 1
  /** Sequence of the last input the room actually turned into a rescue link. */
  lastAcknowledgedGrab = 0
}

defineTypes(PlayerSchema, {
  id: 'string',
  x: 'number',
  y: 'number',
  z: 'number',
  velocityY: 'number',
  grounded: 'boolean',
  alive: 'boolean',
  escaped: 'boolean',
  lastProcessedInput: 'number',
  lastAcknowledgedJump: 'number',
  grabTargetId: 'string',
  grabbedById: 'string',
  grip: 'number',
  lastAcknowledgedGrab: 'number',
})

export class HellbreakRoomState extends Schema {
  elapsed = 0
  durationSeconds = 0
  serverTick = 0
  lavaHeight = 0
  lavaPhase = 'calm'
  matchPhase = 'running'
  /** Empty string means "no winner yet"; Colyseus schema strings cannot be null. */
  winner = ''
  eliminations = 0
  players = new MapSchema<PlayerSchema>()
}

defineTypes(HellbreakRoomState, {
  elapsed: 'number',
  durationSeconds: 'number',
  serverTick: 'number',
  lavaHeight: 'number',
  lavaPhase: 'string',
  matchPhase: 'string',
  winner: 'string',
  eliminations: 'number',
  players: { map: PlayerSchema },
})
