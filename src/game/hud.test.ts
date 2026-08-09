import { describe, expect, it } from 'vitest'
import { formatMatchClock, onlineHudModel } from './hud'
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
