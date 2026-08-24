export const HELLBREAK_ROOM_NAME = 'hellbreak'
export const ROOM_TICK_MS = 50
export const MAX_ROOM_PLAYERS = 6

/**
 * How a room was entered. `guest` is the unauthenticated public demo; `authenticated` means every
 * seat in the room was granted against a server-issued capability. A room is one or the other for
 * its whole life and the room itself decides which, never a client.
 */
export type RoomJoinMode = 'guest' | 'authenticated'

/**
 * Everything a client may put in its join options.
 *
 * `roomToken` is opaque to the browser: it is minted by the Next.js server and only verified by the
 * room. `assignedRoomId` is a routing hint for the matchmaker and carries no authority — the room
 * requires it to match the token, so a wrong one is refused rather than honoured.
 */
export interface RoomJoinOptions {
  roomToken?: string
  assignedRoomId?: string
}

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
  cameraPitch: number
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
  /** Server-selected static route ledge; empty when not holding structure. */
  structureGripAnchorId: string
  /** Normalized 0..1 rescue or structure grip. */
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
