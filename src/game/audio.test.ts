import { describe, expect, it } from 'vitest'
import { audioLevels, soundSequence } from './audio'
import { DEFAULT_GAME_SETTINGS } from './settings'
describe('game audio mixing', () => {
  it('multiplies channels by master and silences all channels on mute', () => {
    expect(audioLevels({ ...DEFAULT_GAME_SETTINGS, masterVolume: 0.5, effectsVolume: 0.8, ambientVolume: 0.2 }, true))
      .toEqual({ effects: 0.4, ambient: 0.1 })
    expect(audioLevels({ ...DEFAULT_GAME_SETTINGS, muted: true }, true)).toEqual({ effects: 0, ambient: 0 })
    expect(audioLevels(DEFAULT_GAME_SETTINGS, false).ambient).toBe(0)
  })
  it('gives jump, landing, grab, danger, and outcome distinct finite bounded cues', () => {
    const signatures = new Set<string>()
    for (const cue of ['jump', 'land', 'grab', 'death', 'win', 'warning', 'start'] as const) {
      const sequence = soundSequence(cue)
      signatures.add(JSON.stringify(sequence))
      for (const note of sequence) {
        expect(note.frequency).toBeGreaterThan(0)
        expect(note.duration).toBeGreaterThan(0)
        expect(note.duration).toBeLessThanOrEqual(0.4)
        expect(note.gain).toBeLessThanOrEqual(0.25)
      }
    }
    expect(signatures.size).toBe(7)
  })
})
