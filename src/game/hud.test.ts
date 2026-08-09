import { describe, expect, it } from 'vitest'
import { formatMatchClock, nextRescueLinkMemory, onlineHudModel, rescueHudModel } from './hud'
import type { NetworkMatchSnapshot, NetworkPlayerSnapshot } from '../shared/multiplayer-protocol'

function match(overrides: Partial<NetworkMatchSnapshot> = {}): NetworkMatchSnapshot {
  return {
    elapsed: 0,
    durationSeconds: 180,
    lavaHeight: -4,
    lavaPhase: 'calm',
    phase: 'running',
    winner: '',
    eliminations: 0,
    ...overrides,
  }
}

function runner(overrides: Partial<NetworkPlayerSnapshot> = {}): NetworkPlayerSnapshot {
  return {
    id: 'own',
    x: 0,
    y: 0,
    z: 0,
    velocityY: 0,
    grounded: true,
    alive: true,
    escaped: false,
    lastProcessedInput: 0,
    lastAcknowledgedJump: 0,
    grabTargetId: '',
    grabbedById: '',
    grip: 1,
    lastAcknowledgedGrab: 0,
    ...overrides,
  }
}

describe('match clock formatting', () => {
  it('counts down from the server duration and never goes negative', () => {
    expect(formatMatchClock(0, 180)).toBe('03:00')
    expect(formatMatchClock(59.4, 180)).toBe('02:01')
    expect(formatMatchClock(180, 180)).toBe('00:00')
    expect(formatMatchClock(500, 180)).toBe('00:00')
    expect(formatMatchClock(Number.NaN, 180)).toBe('03:00')
  })
})

describe('online HUD model', () => {
  it('reports a live match the local runner can still play', () => {
    const model = onlineHudModel(match({ elapsed: 30 }), [runner(), runner({ id: 'other' })], 'own')

    expect(model.remainingLabel).toBe('02:30')
    expect(model.lavaLabel).toBe('상승 중')
    expect(model.finished).toBe(false)
    expect(model.canMove).toBe(true)
    expect(model.aliveCount).toBe(2)
    expect(model.escapedCount).toBe(0)
    expect(model.winnerLabel).toBeNull()
  })

  it('locks movement and explains elimination after a lava death', () => {
    const model = onlineHudModel(match(), [runner({ alive: false }), runner({ id: 'other' })], 'own')

    expect(model.canMove).toBe(false)
    expect(model.statusLabel).toContain('용암')
    expect(model.aliveCount).toBe(1)
  })

  it('locks movement and celebrates a finished escape', () => {
    const model = onlineHudModel(
      match({ phase: 'finished', winner: 'runners' }),
      [runner({ escaped: true })],
      'own',
    )

    expect(model.finished).toBe(true)
    expect(model.canMove).toBe(false)
    expect(model.winnerLabel).toBe('도망자 승리')
    expect(model.escapedCount).toBe(1)
  })

  it('announces a warden win when the lava clears the room', () => {
    const model = onlineHudModel(
      match({ phase: 'finished', winner: 'warden', eliminations: 2 }),
      [runner({ alive: false }), runner({ id: 'other', alive: false })],
      'own',
    )

    expect(model.winnerLabel).toBe('지옥 간수 승리')
    expect(model.statusLabel).toContain('지옥 간수 승리')
    expect(model.canMove).toBe(false)
  })

  it('surfaces lava surge urgency and the final escape phase', () => {
    expect(onlineHudModel(match({ lavaPhase: 'surge' }), [runner()], 'own').lavaLabel).toBe('폭발 상승')
    expect(onlineHudModel(match({ lavaPhase: 'warning' }), [runner()], 'own').lavaLabel).toBe('폭발 임박')
    expect(onlineHudModel(match({ phase: 'final-escape' }), [runner()], 'own').statusLabel)
      .toContain('최종 탈출')
  })

  it('keeps movement locked until the server confirms the local runner exists', () => {
    const model = onlineHudModel(match(), [runner({ id: 'other' })], 'own')

    expect(model.canMove).toBe(false)
    expect(model.statusLabel).toContain('참가')
  })
})

describe('rescue HUD model', () => {
  const lava = -4

  it('stays idle with a full grip when nobody is linked', () => {
    const model = rescueHudModel([runner(), runner({ id: 'other', x: 20 })], 'own', lava)

    expect(model.linked).toBe(false)
    expect(model.gripPercent).toBe(100)
    expect(model.showGrip).toBe(false)
    expect(model.state).toBe('idle')
    expect(model.promptVisible).toBe(false)
    expect(model.announcement).toBeNull()
    expect(model.links).toEqual([])
  })

  it('offers the rescue prompt for a nearby falling teammate only', () => {
    const falling = runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })
    expect(rescueHudModel([runner(), falling], 'own', lava).promptVisible).toBe(true)
    expect(rescueHudModel([runner(), falling], 'own', lava).state).toBe('ready')

    // A teammate standing level with the local runner is not a rescue candidate.
    const level = runner({ id: 'other', x: 1.2 })
    expect(rescueHudModel([runner(), level], 'own', lava).promptVisible).toBe(false)

    // Neither is one far out of reach.
    const distant = runner({ id: 'other', x: 9, y: -0.6, grounded: false })
    expect(rescueHudModel([runner(), distant], 'own', lava).promptVisible).toBe(false)
  })

  it('reports the local grip meter and the live link while rescuing', () => {
    const model = rescueHudModel(
      [
        runner({ grabTargetId: 'other', grip: 0.42, lastAcknowledgedGrab: 7 }),
        runner({ id: 'other', x: 1.2, y: -0.6, grounded: false, grabbedById: 'own' }),
      ],
      'own',
      lava,
    )

    expect(model.linked).toBe(true)
    expect(model.showGrip).toBe(true)
    expect(model.gripPercent).toBe(42)
    expect(model.targetLabel).toBe('구조 중')
    expect(model.rescuedByLabel).toBeNull()
    expect(model.state).toBe('holding')
    expect(model.promptVisible).toBe(false)
    expect(model.links).toEqual([
      { rescuerId: 'own', targetId: 'other', panic: false },
    ])
  })

  it('marks a link as panicking when the target hangs just above the lava', () => {
    const model = rescueHudModel(
      [
        runner({ grabTargetId: 'other', grip: 0.5 }),
        runner({ id: 'other', x: 1.2, y: lava + 1.1, grounded: false, grabbedById: 'own' }),
      ],
      'own',
      lava,
    )

    expect(model.links).toEqual([{ rescuerId: 'own', targetId: 'other', panic: true }])
  })

  it('announces only link milestones, never a per-frame grip or coordinate', () => {
    const idle = rescueHudModel([runner()], 'own', lava)
    expect(idle.announcement).toBeNull()

    const started = rescueHudModel(
      [
        runner({ grabTargetId: 'other', lastAcknowledgedGrab: 3 }),
        runner({ id: 'other', x: 1.2, y: -0.6, grounded: false, grabbedById: 'own' }),
      ],
      'own',
      lava,
    )
    expect(started.announcement).toBe('구조 시작')

    // A teammate who landed higher than they were caught is a completed rescue.
    const completed = rescueHudModel(
      [runner({ lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 1.2, y: 0.4 })],
      'own',
      lava,
      { targetId: 'other', caughtAtY: -0.6 },
    )
    expect(completed.announcement).toBe('구조 성공')

    const exhausted = rescueHudModel(
      [runner({ grip: 0, lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })],
      'own',
      lava,
      { targetId: 'other', caughtAtY: -0.6 },
    )
    expect(exhausted.announcement).toBe('그립 소진')

    const broken = rescueHudModel(
      [runner({ grip: 0.6, lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 1.2, y: -2.4, grounded: false })],
      'own',
      lava,
      { targetId: 'other', caughtAtY: -0.6 },
    )
    expect(broken.announcement).toBe('구조 실패')
  })

  it('tells the falling local runner that a teammate has hold of them', () => {
    const model = rescueHudModel(
      [
        runner({ y: -0.6, grounded: false, grabbedById: 'other' }),
        runner({ id: 'other', x: 1.2, grabTargetId: 'own' }),
      ],
      'own',
      lava,
    )

    expect(model.linked).toBe(false)
    expect(model.rescuedByLabel).toBe('구조 받는 중')
    expect(model.targetLabel).toBeNull()
    expect(model.state).toBe('held')
    // The rope is drawn from the authoritative link even though the local runner is the target.
    expect(model.links).toEqual([{ rescuerId: 'other', targetId: 'own', panic: false }])
    // A runner who is already being pulled up is not offered a rescue prompt of their own.
    expect(model.promptVisible).toBe(false)
  })
})

describe('rescue link memory', () => {
  it('captures the catch height once and holds it for the life of the link', () => {
    const caught = runner({ id: 'other', x: 1.2, y: -0.6, grounded: false, grabbedById: 'own' })
    const rescuing = [runner({ grabTargetId: 'other' }), caught]

    const started = nextRescueLinkMemory(null, rescuing, 'own')
    expect(started).toEqual({ targetId: 'other', caughtAtY: -0.6 })

    // The teammate rises while the link holds, but the remembered catch height must not follow.
    const lifted = [runner({ grabTargetId: 'other' }), { ...caught, y: 0.2 }]
    expect(nextRescueLinkMemory(started, lifted, 'own')).toBe(started)
  })

  it('forgets the link as soon as the server clears it, and retargets on a new link', () => {
    const previous = { targetId: 'other', caughtAtY: -0.6 }
    expect(nextRescueLinkMemory(previous, [runner(), runner({ id: 'other' })], 'own')).toBeNull()

    const retargeted = nextRescueLinkMemory(
      previous,
      [runner({ grabTargetId: 'third' }), runner({ id: 'third', y: -1.4, grounded: false, grabbedById: 'own' })],
      'own',
    )
    expect(retargeted).toEqual({ targetId: 'third', caughtAtY: -1.4 })
  })

  it('forgets a link whose target vanished from the roster', () => {
    expect(nextRescueLinkMemory(null, [runner({ grabTargetId: 'ghost' })], 'own')).toBeNull()
    expect(nextRescueLinkMemory(null, [runner({ grabTargetId: 'other' })], 'missing')).toBeNull()
  })
})
