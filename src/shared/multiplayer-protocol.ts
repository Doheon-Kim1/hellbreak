export const HELLBREAK_ROOM_NAME = 'hellbreak'
export const ROOM_TICK_MS = 50
export const MAX_ROOM_PLAYERS = 6

export interface MultiplayerInputCommand {
  sequence: number
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  sprint: boolean
  cameraYaw: number
}

export interface NetworkPlayerSnapshot {
  id: string
  x: number
  y: number
  z: number
  lastProcessedInput: number
}
