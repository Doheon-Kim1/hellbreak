import { describe, expect, it, vi } from 'vitest'
import {
  ROOM_CONNECTION_PHASES,
  openRoomWhenAwake,
  roomConnectionMessage,
  roomPhaseLabel,
} from './room-connection'
import type { RoomConnectionPhase } from './room-connection'
import type { RoomWakeOutcome } from './room-wakeup'

const AWAKE = { ok: true, room: 'hellbreak', guestJoin: true, authenticatedJoin: false } as const
const READY: RoomWakeOutcome = { ready: true, health: AWAKE, attempts: 2, elapsedMs: 4_000 }
const ROOM = { roomId: 'abc123' }

function attempt(woken: RoomWakeOutcome, overrides: {
  open?: () => Promise<typeof ROOM>
  superseded?: () => boolean
} = {}) {
  const phases: RoomConnectionPhase[] = []
  const open = vi.fn(overrides.open ?? (() => Promise.resolve(ROOM)))
  return {
    phases,
    open,
    result: openRoomWhenAwake({
      wake: () => Promise.resolve(woken),
      open,
      onPhase: (phase) => phases.push(phase),
      superseded: overrides.superseded,
    }),
  }
}

describe('opening a room only after the server is awake', () => {
  it('opens exactly one room once health has passed', async () => {
    const opening = attempt(READY)

    await expect(opening.result).resolves.toEqual({ ok: true, room: ROOM, health: AWAKE })
    expect(opening.open).toHaveBeenCalledTimes(1)
  })

  // The regression this whole boundary exists for: the SDK's matchmaking request used to be the
  // thing that discovered a sleeping server, and its raw failure was what the player was shown.
  it('never touches the room server while the wake is still failing', async () => {
    const opening = attempt({ ready: false, failure: 'unreachable', attempts: 8, elapsedMs: 90_000 })

    await expect(opening.result).resolves.toEqual({ ok: false, failure: 'server-asleep' })
    expect(opening.open).not.toHaveBeenCalled()
  })

  it('does not open a room the deployment has said it will refuse', async () => {
    const opening = attempt({ ready: false, failure: 'mode-closed', attempts: 1, elapsedMs: 120 })

    await expect(opening.result).resolves.toEqual({ ok: false, failure: 'guest-closed' })
    expect(opening.open).not.toHaveBeenCalled()
  })

  it('reports a cancelled wake as cancelled, with nothing opened', async () => {
    const opening = attempt({ ready: false, failure: 'cancelled', attempts: 1, elapsedMs: 30 })

    await expect(opening.result).resolves.toEqual({ ok: false, failure: 'cancelled' })
    expect(opening.open).not.toHaveBeenCalled()
  })

  // Waking can take a minute and a half, which is long enough for the player to leave, switch
  // modes, or ask for a different room. None of those may end with a room nobody is in.
  it('abandons the request when the attempt was superseded while the server woke', async () => {
    const opening = attempt(READY, { superseded: () => true })

    await expect(opening.result).resolves.toEqual({ ok: false, failure: 'cancelled' })
    expect(opening.open).not.toHaveBeenCalled()
  })

  // A refusal and a lost answer look identical from here, so a retry could leave a second room
  // running with nobody in it. One attempt, then the player decides.
  it('never retries the room request itself', async () => {
    const opening = attempt(READY, { open: () => Promise.reject(new Error('WebSocket closed 1006')) })

    await expect(opening.result).resolves.toEqual({ ok: false, failure: 'join-refused' })
    expect(opening.open).toHaveBeenCalledTimes(1)
  })

  it('announces waking first, and joining only after health passed', async () => {
    const opening = attempt(READY)
    await opening.result

    expect(opening.phases).toEqual(['waking', 'joining'])
  })

  it('never announces joining when the server never woke', async () => {
    const opening = attempt({ ready: false, failure: 'unreachable', attempts: 8, elapsedMs: 90_000 })
    await opening.result

    expect(opening.phases).toEqual(['waking'])
  })
})

describe('player-facing wording', () => {
  it('says the free server is being woken while it is being woken', () => {
    expect(roomPhaseLabel('waking')).toBe('무료 룸 서버를 깨우는 중…')
    expect(roomPhaseLabel('joining')).toMatch(/연결/)
    expect(roomPhaseLabel('idle')).toBe(null)
  })

  it('covers every phase it can be handed', () => {
    for (const phase of ROOM_CONNECTION_PHASES) {
      expect(() => roomPhaseLabel(phase)).not.toThrow()
    }
  })

  // Never `Failed to fetch`, never an SDK code, never a URL, and never a stack.
  it.each([
    ['server-asleep', 'create'],
    ['server-asleep', 'join'],
    ['guest-closed', 'create'],
    ['guest-closed', 'join'],
    ['join-refused', 'create'],
    ['join-refused', 'join'],
  ] as const)('writes %s for a %s attempt in Korean the player can act on', (failure, kind) => {
    const message = roomConnectionMessage(failure, kind)

    expect(message).toMatch(/[가-힣]/)
    expect(message).not.toMatch(/fetch|network|error|websocket|http|undefined|colyseus/i)
    expect(message.length).toBeGreaterThan(8)
  })

  it('tells a player whose server is asleep to try again shortly', () => {
    expect(roomConnectionMessage('server-asleep', 'create')).toMatch(/다시 시도/)
    expect(roomConnectionMessage('server-asleep', 'create')).toMatch(/서버/)
  })

  it('keeps create and join distinguishable, because the fix differs', () => {
    expect(roomConnectionMessage('join-refused', 'create'))
      .not.toBe(roomConnectionMessage('join-refused', 'join'))
    expect(roomConnectionMessage('join-refused', 'join')).toMatch(/룸 ID/)
  })

  it('says guests are closed without naming any server setting', () => {
    const message = roomConnectionMessage('guest-closed', 'create')

    expect(message).toMatch(/게스트/)
    expect(message).not.toMatch(/HELLBREAK_GUEST_JOIN|ROOM_TOKEN_SECRET/)
  })
})
