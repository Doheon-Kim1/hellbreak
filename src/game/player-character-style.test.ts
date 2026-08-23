import { describe, expect, it } from 'vitest'
import { infernalClimberStyle } from './player-character-style'

describe('Infernal Climber style', () => {
  it('keeps a player accent stable across repeated and reconnected presentations', () => {
    const first = infernalClimberStyle({ playerId: 'runner-stable', isOwn: false, alive: true, escaped: false })
    const repeated = infernalClimberStyle({ playerId: 'runner-stable', isOwn: false, alive: true, escaped: false })
    const reconnected = infernalClimberStyle({ playerId: 'runner-stable', isOwn: true, alive: true, escaped: false })

    expect(repeated.accent).toBe(first.accent)
    expect(reconnected.accent).toBe(first.accent)
  })

  it('distinguishes own and teammate climbers with light and silhouette as well as colour', () => {
    const own = infernalClimberStyle({ playerId: 'runner-a', isOwn: true, alive: true, escaped: false })
    const teammate = infernalClimberStyle({ playerId: 'runner-a', isOwn: false, alive: true, escaped: false })

    expect(own.ornament).toBe('beacon')
    expect(teammate.ornament).toBe('fin')
    expect(own.emissiveIntensity).toBeGreaterThan(teammate.emissiveIntensity)
  })

  it('gives dead and escaped climbers unmistakable non-colour decorations', () => {
    const dead = infernalClimberStyle({ playerId: 'runner-a', isOwn: false, alive: false, escaped: false })
    const escaped = infernalClimberStyle({ playerId: 'runner-a', isOwn: false, alive: true, escaped: true })

    expect(dead.ornament).toBe('broken')
    expect(dead.emissiveIntensity).toBeLessThan(0.3)
    expect(escaped.ornament).toBe('flare')
    expect(escaped.emissiveIntensity).toBeGreaterThan(1)
  })

  it('returns only material-safe colours and bounded light intensities for hostile ids', () => {
    for (const playerId of ['', '🔥'.repeat(40), '\u0000runner', 'x'.repeat(10_000)]) {
      const style = infernalClimberStyle({ playerId, isOwn: false, alive: true, escaped: false })
      for (const color of [style.suit, style.helmet, style.accent, style.emissive]) {
        expect(Number.isInteger(color)).toBe(true)
        expect(color).toBeGreaterThanOrEqual(0)
        expect(color).toBeLessThanOrEqual(0xffffff)
      }
      expect(Number.isFinite(style.emissiveIntensity)).toBe(true)
      expect(style.emissiveIntensity).toBeGreaterThanOrEqual(0)
      expect(style.emissiveIntensity).toBeLessThanOrEqual(3)
    }
  })
})
