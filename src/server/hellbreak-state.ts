import { MapSchema, Schema, defineTypes } from '@colyseus/schema'

export class PlayerSchema extends Schema {
  id = ''
  x = 0
  y = 0
  z = 0
  lastProcessedInput = 0
}

defineTypes(PlayerSchema, {
  id: 'string',
  x: 'number',
  y: 'number',
  z: 'number',
  lastProcessedInput: 'number',
})

export class HellbreakRoomState extends Schema {
  elapsed = 0
  serverTick = 0
  players = new MapSchema<PlayerSchema>()
}

defineTypes(HellbreakRoomState, {
  elapsed: 'number',
  serverTick: 'number',
  players: { map: PlayerSchema },
})
