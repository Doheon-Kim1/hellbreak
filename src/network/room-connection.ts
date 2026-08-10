import type { RoomHealthReport, RoomWakeFailure, RoomWakeOutcome } from './room-wakeup'

/**
 * The startup boundary between "is the room server there" and "give me a room".
 *
 * It exists so those two questions can never be answered by the same request again. Waking is
 * retried, because a suspended instance only comes back if something keeps knocking. Opening a room
 * is not, because a refusal and a lost answer look identical from the browser, and retrying through
 * that ambiguity is how a match ends up with a duplicate room nobody is in.
 *
 * Both callbacks are injected, so the ordering rule this file is really about — nothing reaches
 * Colyseus until health has passed — is checkable without a browser or a server.
 */

export const ROOM_CONNECTION_PHASES = ['idle', 'waking', 'joining'] as const
export type RoomConnectionPhase = (typeof ROOM_CONNECTION_PHASES)[number]

export type RoomConnectionFailure =
  /** The free instance never answered inside the wake budget. */
  | 'server-asleep'
  /** It answered, and it is not accepting this way in. */
  | 'guest-closed'
  /** It was awake and still refused the one room request that was made. */
  | 'join-refused'
  /** Withdrawn by the caller. Nothing to say to the player, because they already know. */
  | 'cancelled'

/** Every failure a player is ever shown. `cancelled` is deliberately not one of them. */
export type ShownRoomFailure = Exclude<RoomConnectionFailure, 'cancelled'>

export interface RoomConnectionSteps<TRoom> {
  wake: () => Promise<RoomWakeOutcome>
  /** The single Colyseus create/join. Called at most once, and only after health passed. */
  open: () => Promise<TRoom>
  onPhase?: (phase: RoomConnectionPhase) => void
  /**
   * Whether this attempt has already been replaced. Waking can take a minute and a half, which is
   * long enough for the player to leave or ask for a different room, and a room opened after that
   * would be one nobody joins.
   */
  superseded?: () => boolean
}

export type RoomConnectionResult<TRoom> =
  | { ok: true; room: TRoom; health: RoomHealthReport }
  | { ok: false; failure: RoomConnectionFailure }

const WAKE_FAILURES: Record<RoomWakeFailure, RoomConnectionFailure> = {
  unreachable: 'server-asleep',
  'mode-closed': 'guest-closed',
  cancelled: 'cancelled',
}

export async function openRoomWhenAwake<TRoom>(
  steps: RoomConnectionSteps<TRoom>,
): Promise<RoomConnectionResult<TRoom>> {
  steps.onPhase?.('waking')
  const woken = await steps.wake()
  if (!woken.ready) return { ok: false, failure: WAKE_FAILURES[woken.failure] }
  if (steps.superseded?.()) return { ok: false, failure: 'cancelled' }

  steps.onPhase?.('joining')
  try {
    return { ok: true, room: await steps.open(), health: woken.health }
  } catch {
    // The SDK's own text names a transport, a status code, or a URL. None of that is the player's
    // problem, and none of it is ever put on screen.
    return { ok: false, failure: 'join-refused' }
  }
}

const PHASE_LABELS: Record<RoomConnectionPhase, string | null> = {
  idle: null,
  // Named as the free tier rather than as an error, because waiting is the correct thing to do.
  waking: '무료 룸 서버를 깨우는 중…',
  joining: '룸에 연결하는 중…',
}

export function roomPhaseLabel(phase: RoomConnectionPhase): string | null {
  return PHASE_LABELS[phase]
}

/**
 * What the player reads when a connection attempt ends badly.
 *
 * Fixed sentences, chosen by outcome. A browser or SDK message is never one of them: `Failed to
 * fetch` describes one socket, tells the player nothing they can act on, and is exactly the string
 * that was reaching the public build.
 */
const FAILURE_MESSAGES: Record<ShownRoomFailure, Record<'create' | 'join', string>> = {
  'server-asleep': {
    create: '무료 룸 서버가 아직 깨어나지 않았습니다. 잠시 후 다시 시도해 주세요.',
    join: '무료 룸 서버가 아직 깨어나지 않았습니다. 잠시 후 다시 시도해 주세요.',
  },
  'guest-closed': {
    create: '이 룸 서버는 지금 게스트 참가를 받지 않습니다.',
    join: '이 룸 서버는 지금 게스트 참가를 받지 않습니다.',
  },
  'join-refused': {
    create: '룸을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
    join: '해당 룸에 참가하지 못했습니다. 룸 ID를 확인하고 잠시 후 다시 시도해 주세요.',
  },
}

export function roomConnectionMessage(failure: ShownRoomFailure, kind: 'create' | 'join'): string {
  return FAILURE_MESSAGES[failure][kind]
}
