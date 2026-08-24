import { describe, expect, it } from 'vitest'
import {
  formatMatchClock,
  nextRescueHudMemory,
  nextRescueLinkMemory,
  onlineHudModel,
  rescueHudModel,
} from './hud'
import type { RescueHudMemory } from './hud'
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
    structureGripAnchorId: '',
    grip: 1,
    lastAcknowledgedGrab: 0,
    ...overrides,
  }
}

function memory(overrides: Partial<RescueHudMemory> = {}): RescueHudMemory {
  return { link: null, lockedUntil: 0, lockReason: null, acknowledgedGrab: 0, ...overrides }
}

/** The memory a client holds while it is watching one live link. */
function watching(targetId: string, caughtAtY: number, overrides: Partial<RescueHudMemory> = {}): RescueHudMemory {
  return memory({ link: { targetId, caughtAtY }, ...overrides })
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
    // The rope is handed published facts, never a styling decision: it derives its own urgency.
    expect(model.links).toEqual([
      { rescuerId: 'own', targetId: 'other', grip: 0.42, heightAboveLava: 3.4 },
    ])
  })

  it('measures every link against the authoritative lava surface, including other pairs', () => {
    const model = rescueHudModel(
      [
        runner({ id: 'other', x: 20 }),
        runner({ id: 'rescuer', grip: 0.3, grabTargetId: 'falling' }),
        runner({ id: 'falling', y: lava + 1.1, grounded: false, grabbedById: 'rescuer' }),
      ],
      'own',
      lava,
    )

    expect(model.links).toEqual([
      { rescuerId: 'rescuer', targetId: 'falling', grip: 0.3, heightAboveLava: 1.1 },
    ])
    // A spectator's own readout stays idle while it draws someone else's rope.
    expect(model.linked).toBe(false)
    expect(model.linkUrgency).toBeNull()
  })

  it('reads an unpublished rescuer grip as a full one rather than as a fraying rope', () => {
    const model = rescueHudModel(
      [
        runner({ grabTargetId: 'other', grip: Number.NaN }),
        runner({ id: 'other', x: 1.2, y: -0.6, grounded: false, grabbedById: 'own' }),
      ],
      'own',
      lava,
    )

    expect(model.links[0].grip).toBe(1)
    expect(model.gripBand).toBe('steady')
  })

  it('bands the local link by lava proximity and says it in words, not only in the rope', () => {
    const holding = (targetY: number) => rescueHudModel(
      [
        runner({ grabTargetId: 'other', grip: 0.8 }),
        runner({ id: 'other', x: 1.2, y: targetY, grounded: false, grabbedById: 'own' }),
      ],
      'own',
      lava,
    )

    const calm = holding(lava + 4)
    expect(calm.linkUrgency).toBe('calm')
    expect(calm.statusLabel).toBe('구조 중')

    const urgent = holding(lava + 1.1)
    expect(urgent.linkUrgency).toBe('urgent')
    expect(urgent.statusLabel).toBe('구조 중 · 용암 근접')

    const critical = holding(lava + 0.2)
    expect(critical.linkUrgency).toBe('critical')
    expect(critical.statusLabel).toBe('구조 중 · 용암 직전')

    // The runner being hauled up is told the same thing about their own drop.
    const held = rescueHudModel(
      [
        runner({ y: lava + 0.2, grounded: false, grabbedById: 'other' }),
        runner({ id: 'other', x: 1.2, grabTargetId: 'own' }),
      ],
      'own',
      lava,
    )
    expect(held.linkUrgency).toBe('critical')
    expect(held.statusLabel).toBe('구조 받는 중 · 용암 직전')

    // No link, nothing to band — an idle chip must never wear a lava warning.
    expect(rescueHudModel([runner()], 'own', lava).linkUrgency).toBeNull()
    const bystander = rescueHudModel(
      [
        runner({ y: lava + 0.2, grounded: false }),
        runner({ id: 'other', x: 1.2, grabTargetId: 'third' }),
        runner({ id: 'third', y: lava + 0.2, grounded: false, grabbedById: 'other' }),
      ],
      'own',
      lava,
    )
    expect(bystander.links).toHaveLength(1)
    expect(bystander.linkUrgency).toBeNull()
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
      watching('other', -0.6),
    )
    expect(completed.outcome).toBe('rescued')
    expect(completed.announcement).toBe('구조 성공')

    const exhausted = rescueHudModel(
      [runner({ grip: 0, lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })],
      'own',
      lava,
      watching('other', -0.6),
    )
    expect(exhausted.outcome).toBe('exhausted')
    expect(exhausted.announcement).toBe('그립 소진')

    const broken = rescueHudModel(
      [runner({ grip: 0.6, lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 1.2, y: -2.4, grounded: false })],
      'own',
      lava,
      watching('other', -0.6),
    )
    expect(broken.outcome).toBe('lost')
    expect(broken.announcement).toBe('구조 실패')
  })

  it('never names a failure cause the published snapshot cannot prove', () => {
    // The room publishes no reason, and range break, the teammate landing, the rescuer losing
    // footing, a death, and a disconnect can all land in the same tick. Every one of these ends
    // as a plain failed rescue rather than an invented cause.
    const ambiguous: [string, readonly NetworkPlayerSnapshot[]][] = [
      // The rescuer is no longer standing — but the teammate may equally have landed first.
      ['rescuer airborne', [
        runner({ grip: 0.6, grounded: false, y: -1.4, lastAcknowledgedGrab: 3 }),
        runner({ id: 'other', x: 1.2, y: -2.4, grounded: false }),
      ]],
      // The teammate is standing, below where they were caught.
      ['teammate grounded low', [
        runner({ grip: 0.6, lastAcknowledgedGrab: 3 }),
        runner({ id: 'other', x: 1.2, y: -0.8 }),
      ]],
      // The teammate drowned.
      ['teammate eliminated', [
        runner({ grip: 0.6, lastAcknowledgedGrab: 3 }),
        runner({ id: 'other', x: 1.2, y: -2.4, alive: false }),
      ]],
      // The teammate left the room, so there is nothing left to inspect at all.
      ['teammate gone', [runner({ grip: 0.6, lastAcknowledgedGrab: 3 })]],
      // Simply out of range, with both runners otherwise unremarkable.
      ['out of range', [
        runner({ grip: 0.6, lastAcknowledgedGrab: 3 }),
        runner({ id: 'other', x: 9, y: -4, grounded: false }),
      ]],
    ]

    for (const [label, players] of ambiguous) {
      const model = rescueHudModel(players, 'own', lava, watching('other', -0.6))
      expect(model.outcome, label).toBe('lost')
      expect(model.announcement, label).toBe('구조 실패')
    }
  })

  it('reports an unwitnessed same-tick failure without guessing why it failed', () => {
    // The room made a link and dropped it in one tick: no link was ever published, so only the
    // advancing rescue receipt proves the attempt happened at all.
    const sameTick = rescueHudModel(
      [runner({ grip: 1, grounded: true, lastAcknowledgedGrab: 9 }), runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })],
      'own',
      lava,
      memory({ acknowledgedGrab: 4 }),
    )
    expect(sameTick.outcome).toBe('lost')
    expect(sameTick.announcement).toBe('구조 실패')

    // Without a receipt of its own, an idle client stays silent.
    const quiet = rescueHudModel(
      [runner({ lastAcknowledgedGrab: 4 }), runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })],
      'own',
      lava,
      memory({ acknowledgedGrab: 4 }),
    )
    expect(quiet.outcome).toBeNull()
    expect(quiet.announcement).toBeNull()
  })

  it('shows a server-owned structure hold without inventing a failed player rescue', () => {
    const previous = memory({ acknowledgedGrab: 4 })
    const model = rescueHudModel([
      runner({ structureGripAnchorId: 'route-4-south-0', grip: 0.72, lastAcknowledgedGrab: 5 }),
    ], 'own', -4, previous, 10)

    expect(model.state).toBe('holding')
    expect(model.linked).toBe(false)
    expect(model.showGrip).toBe(true)
    expect(model.gripPercent).toBe(72)
    expect(model.statusLabel).toContain('구조물 그립')
    expect(model.outcome).toBeNull()
    expect(model.announcement).toBeNull()
  })

  it('claims exhaustion only when the published grip really did reach empty', () => {
    const caught = runner({ id: 'other', x: 1.2, y: -2.4, grounded: false })

    // The room's own rule: grip can only reach zero by draining under a live link.
    const empty = rescueHudModel(
      [runner({ grip: 0, lastAcknowledgedGrab: 3 }), caught],
      'own',
      lava,
      watching('other', -0.6),
    )
    expect(empty.outcome).toBe('exhausted')

    // A bar with anything left in it proves nothing about why the link ended.
    const nearlyEmpty = rescueHudModel(
      [runner({ grip: 0.02, lastAcknowledgedGrab: 3 }), caught],
      'own',
      lava,
      watching('other', -0.6),
    )
    expect(nearlyEmpty.outcome).toBe('lost')

    // A completed rescue outranks an empty bar: the teammate is visibly standing higher.
    const bothLookTrue = rescueHudModel(
      [runner({ grip: 0, lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 1.2, y: 0.4 })],
      'own',
      lava,
      watching('other', -0.6),
    )
    expect(bothLookTrue.outcome).toBe('rescued')
  })

  it('bands the grip meter instead of leaving a bare percentage', () => {
    const steady = rescueHudModel([runner({ grabTargetId: 'other', grip: 0.8 }), runner({ id: 'other' })], 'own', lava)
    const warning = rescueHudModel([runner({ grabTargetId: 'other', grip: 0.5 }), runner({ id: 'other' })], 'own', lava)
    const danger = rescueHudModel([runner({ grabTargetId: 'other', grip: 0.2 }), runner({ id: 'other' })], 'own', lava)

    expect(steady.gripBand).toBe('steady')
    expect(warning.gripBand).toBe('warning')
    expect(danger.gripBand).toBe('danger')
    expect(danger.gripPercent).toBe(20)
  })

  it('shows the failure lockout counting down and hides the prompt while it lasts', () => {
    const falling = runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })

    const locked = rescueHudModel(
      [runner({ grip: 0.6 }), falling],
      'own',
      lava,
      memory({ lockedUntil: 12.4, lockReason: 'cooldown' }),
      11.4,
    )
    expect(locked.state).toBe('cooldown')
    expect(locked.lockoutSeconds).toBe(1)
    expect(locked.statusLabel).toBe('구조 재시도 1.0초')
    expect(locked.showGrip).toBe(true)
    // A teammate is in reach, but the room would refuse, so the prompt must not promise a rescue.
    expect(locked.promptVisible).toBe(false)

    // The same memory once the room's clock has passed the lockout.
    const free = rescueHudModel(
      [runner({ grip: 0.6 }), falling],
      'own',
      lava,
      memory({ lockedUntil: 12.4, lockReason: 'cooldown' }),
      12.4,
    )
    expect(free.state).toBe('ready')
    expect(free.lockoutSeconds).toBe(0)
    expect(free.promptVisible).toBe(true)

    // A restarted match rewinds the clock; a lockout further out than any cooldown is stale.
    const restarted = rescueHudModel(
      [runner({ grip: 1 }), falling],
      'own',
      lava,
      memory({ lockedUntil: 120, lockReason: 'exhausted' }),
      0,
    )
    expect(restarted.state).toBe('ready')
    expect(restarted.lockoutSeconds).toBe(0)
  })

  it('separates an exhausted grip from an ordinary reacquire cooldown', () => {
    const falling = runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })

    const spent = rescueHudModel(
      [runner({ grip: 0 }), falling],
      'own',
      lava,
      memory({ lockedUntil: 14, lockReason: 'exhausted' }),
      11,
    )
    expect(spent.state).toBe('exhausted')
    // Locked out, and told for how long, whichever failure put them there.
    expect(spent.lockoutSeconds).toBe(3)
    expect(spent.statusLabel).toBe('그립 소진 · 3.0초')
    expect(spent.gripBand).toBe('danger')
    expect(spent.promptVisible).toBe(false)

    // An empty bar reads as exhausted even before this client has seen the failure milestone,
    // and then it has no countdown to offer.
    const emptyBar = rescueHudModel([runner({ grip: 0 }), falling], 'own', lava)
    expect(emptyBar.state).toBe('exhausted')
    expect(emptyBar.lockoutSeconds).toBe(0)
    expect(emptyBar.statusLabel).toBe('그립 소진 · 회복 중')

    // Being hauled up by someone else outranks the local runner's own lockout.
    const held = rescueHudModel(
      [runner({ grip: 0, grabbedById: 'other' }), runner({ id: 'other', x: 1.2, grabTargetId: 'own' })],
      'own',
      lava,
      memory({ lockedUntil: 14, lockReason: 'exhausted' }),
      11,
    )
    expect(held.state).toBe('held')
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
    expect(model.links).toEqual([
      { rescuerId: 'other', targetId: 'own', grip: 1, heightAboveLava: 3.4 },
    ])
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

describe('rescue HUD memory', () => {
  const lava = -4

  /** One render: model from the current memory, then the memory the next render will read. */
  function advance(
    previous: RescueHudMemory | null,
    players: readonly NetworkPlayerSnapshot[],
    elapsed: number,
  ): RescueHudMemory {
    const model = rescueHudModel(players, 'own', lava, previous, elapsed)
    return nextRescueHudMemory(previous, players, 'own', model, elapsed)
  }

  it('mirrors the room cooldown after a failure and the longer one after exhaustion', () => {
    const caught = runner({ id: 'other', x: 1.2, y: -0.6, grounded: false, grabbedById: 'own' })
    const linked = advance(null, [runner({ grabTargetId: 'other', lastAcknowledgedGrab: 3 }), caught], 10)
    expect(linked).toEqual({
      link: { targetId: 'other', caughtAtY: -0.6 },
      lockedUntil: 0,
      lockReason: null,
      acknowledgedGrab: 3,
    })

    // An ending with no provable cause still mirrors the room's ordinary reacquire cooldown.
    const lost = advance(
      linked,
      [runner({ grip: 0.6, lastAcknowledgedGrab: 3 }), { ...caught, y: -2.4, grabbedById: '' }],
      10.5,
    )
    expect(lost.link).toBeNull()
    expect(lost.lockReason).toBe('cooldown')
    expect(lost.lockedUntil).toBeCloseTo(11.9)

    const drained = advance(
      linked,
      [runner({ grip: 0, lastAcknowledgedGrab: 3 }), { ...caught, grabbedById: '' }],
      10.5,
    )
    expect(drained.lockReason).toBe('exhausted')
    expect(drained.lockedUntil).toBeCloseTo(13.5)
  })

  it('charges no lockout for a completed rescue and holds one until it expires', () => {
    const linked = memory({ link: { targetId: 'other', caughtAtY: -0.6 }, acknowledgedGrab: 3 })
    const completed = advance(
      linked,
      [runner({ lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 1.2, y: 0.4 })],
      10.5,
    )
    expect(completed.lockedUntil).toBe(0)
    expect(completed.lockReason).toBeNull()

    // Later renders inside the window neither restart nor forget an existing lockout.
    const locked = memory({ lockedUntil: 11.9, lockReason: 'cooldown', acknowledgedGrab: 3 })
    const idling = advance(locked, [runner({ grip: 0.7, lastAcknowledgedGrab: 3 }), runner({ id: 'other', x: 9 })], 11)
    expect(idling.lockedUntil).toBe(11.9)
    expect(idling.lockReason).toBe('cooldown')
  })

  it('tracks the rescue receipt so a same-tick failure is charged exactly once', () => {
    const falling = runner({ id: 'other', x: 1.2, y: -0.6, grounded: false })
    const before = memory({ acknowledgedGrab: 4 })

    // The receipt jumps without a link ever appearing: the room made and lost it in one tick.
    const charged = advance(before, [runner({ lastAcknowledgedGrab: 5 }), falling], 20)
    expect(charged.acknowledgedGrab).toBe(5)
    expect(charged.lockReason).toBe('cooldown')
    expect(charged.lockedUntil).toBeCloseTo(21.4)

    // The next render sees the same receipt, so the lockout is not restarted.
    const settled = advance(charged, [runner({ lastAcknowledgedGrab: 5 }), falling], 20.05)
    expect(settled.lockedUntil).toBeCloseTo(21.4)
  })

  it('keeps its last receipt when the local runner is missing from a patch', () => {
    const before = memory({ acknowledgedGrab: 7, lockedUntil: 30, lockReason: 'cooldown' })
    const orphaned = advance(before, [runner({ id: 'other' })], 29)

    expect(orphaned.acknowledgedGrab).toBe(7)
    expect(orphaned.lockedUntil).toBe(30)
    expect(orphaned.link).toBeNull()
  })
})
