import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_SETTINGS, normalizeGameSettings, loadGameSettings, saveGameSettings, GAME_SETTINGS_KEY } from './settings'

describe('browser game preferences', () => {
  it('bounds persisted sensitivity and audio levels without trusting invalid types', () => {
    expect(normalizeGameSettings({ sensitivity: 99, masterVolume: -1, effectsVolume: NaN,
      ambientVolume: 'loud', muted: 'false', invertY: true })).toEqual({ ...DEFAULT_GAME_SETTINGS,
      sensitivity: 3, masterVolume: 0, invertY: true })
    expect(normalizeGameSettings(null)).toEqual(DEFAULT_GAME_SETTINGS)
  })
  it('round trips preferences and survives unavailable or malformed storage', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) } }
    const settings = { ...DEFAULT_GAME_SETTINGS, sensitivity: 0.5, muted: true }
    expect(saveGameSettings(storage, settings)).toBe(true)
    expect(loadGameSettings(storage)).toEqual(settings)
    values.set(GAME_SETTINGS_KEY, '{bad json')
    expect(loadGameSettings(storage)).toEqual(DEFAULT_GAME_SETTINGS)
    const denied = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadGameSettings(denied)).toEqual(DEFAULT_GAME_SETTINGS)
    expect(saveGameSettings(denied, settings)).toBe(false)
  })
})
