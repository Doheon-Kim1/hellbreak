import { describe, expect, it } from 'vitest'
import { abilitySpec, authoritativeHellEvent, hellEventAt, pickupAbility, wardenLavaBonusAt } from './hell-events'

describe('warden playground events', () => {
  it('cycles through readable warnings, active danger, and cooldown', () => {
    expect(hellEventAt(0)).toMatchObject({ kind: 'swing-frenzy', phase: 'warning' })
    expect(hellEventAt(4)).toMatchObject({ kind: 'swing-frenzy', phase: 'active' })
    expect(hellEventAt(12)).toMatchObject({ kind: 'swing-frenzy', phase: 'cooldown' })
    expect(hellEventAt(20)).toMatchObject({ kind: 'bridge-collapse', phase: 'warning' })
    expect(hellEventAt(40)).toMatchObject({ kind: 'slide-fire', phase: 'warning' })
    expect(hellEventAt(60)).toMatchObject({ kind: 'lava-boost', phase: 'warning' })
  })

  it('reports time remaining until the next phase for HUD warnings', () => {
    expect(hellEventAt(2).secondsRemaining).toBeCloseTo(2)
    expect(hellEventAt(9).secondsRemaining).toBeCloseTo(3)
  })

  it('turns the warden lava boost into a permanent monotonic height gain', () => {
    expect(wardenLavaBonusAt(64)).toBe(0)
    expect(wardenLavaBonusAt(68)).toBeCloseTo(0.375)
    expect(wardenLavaBonusAt(72)).toBeCloseTo(0.75)
    expect(wardenLavaBonusAt(120)).toBeCloseTo(0.75)
    expect(wardenLavaBonusAt(144)).toBeCloseTo(0.75)
    expect(wardenLavaBonusAt(148)).toBeCloseTo(1.125)
    expect(wardenLavaBonusAt(152)).toBeCloseTo(1.5)
  })
})

describe('authoritative online playground event', () => {
  it('never reaches a state that removes or moves rendered playground geometry', () => {
    const event = authoritativeHellEvent()
    // GiantPlayground spawns moving hazards and drops route platforms 8-10 only while
    // `phase === 'active'`, and the bridge drop additionally requires the collapse kind.
    expect(event.phase).not.toBe('active')
    expect(event.kind).not.toBe('bridge-collapse')
  })

  it('stays inert for every match time so the client matches fixed server collision', () => {
    for (let elapsed = 0; elapsed <= 180; elapsed += 0.5) {
      expect(authoritativeHellEvent()).toEqual(authoritativeHellEvent())
      expect(authoritativeHellEvent().phase).not.toBe('active')
    }
  })

  it('leaves the local bot match on the timed events that drive dynamic hazards', () => {
    expect(hellEventAt(24)).toMatchObject({ kind: 'bridge-collapse', phase: 'active' })
    expect(hellEventAt(6)).toMatchObject({ kind: 'swing-frenzy', phase: 'active' })
  })
})

describe('round ability pickups', () => {
  it('describes one clear gameplay effect per pickup', () => {
    expect(abilitySpec('rocket-boots')).toMatchObject({ speedMultiplier: 1.55, durationSeconds: 5 })
    expect(abilitySpec('spring-shoes')).toMatchObject({ jumpMultiplier: 1.55, charges: 1 })
    expect(abilitySpec('extinguisher')).toMatchObject({ lavaBlocks: 1 })
  })

  it('replaces the held ability instead of stacking permanent upgrades', () => {
    expect(pickupAbility(null, 'rocket-boots')).toBe('rocket-boots')
    expect(pickupAbility('rocket-boots', 'extinguisher')).toBe('extinguisher')
  })
})
