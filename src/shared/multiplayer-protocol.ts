export const HELLBREAK_ROOM_NAME = 'hellbreak'
export const ROOM_TICK_MS = 50
export const MAX_ROOM_PLAYERS = 6

/**
 * Everything a client may send. Coordinates, velocity, grounded/alive/escaped
 * state, lava, and the match outcome are server-owned and never appear here.
 */
export interface MultiplayerInputCommand {
  sequence: number
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  sprint: boolean
  jump: boolean
  /**
   * Held rescue intent only. The client says "I am holding E" and nothing else: the target player,
   * pull direction, force, grip, and completion are all chosen by the authoritative room.
   */
  grab: boolean
  cameraYaw: number
}

export interface NetworkPlayerSnapshot {
  id: string
  x: number
  y: number
  z: number
  velocityY: number
  grounded: boolean
  alive: boolean
  escaped: boolean
  lastProcessedInput: number
  /** Sequence of the last jump the server applied as a grounded takeoff; 0 before any takeoff. */
  lastAcknowledgedJump: number
  /** Player this runner is pulling up; empty when not rescuing. */
  grabTargetId: string
  /** Player pulling this runner up; empty when not being rescued. */
  grabbedById: string
  /** Normalized 0..1 rescue grip. */
  grip: number
  /** Sequence of the last input the server turned into a rescue link; 0 before any link. */
  lastAcknowledgedGrab: number
}

export interface NetworkMatchSnapshot {
  elapsed: number
  durationSeconds: number
  lavaHeight: number
  lavaPhase: string
  phase: string
  winner: string
  eliminations: number
}
