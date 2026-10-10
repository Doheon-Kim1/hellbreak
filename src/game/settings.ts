export interface GameSettings {
  sensitivity: number
  invertY: boolean
  masterVolume: number
  effectsVolume: number
  ambientVolume: number
  muted: boolean
}
export const GAME_SETTINGS_KEY = 'hellbreak.settings.v1'
export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  sensitivity: 1, invertY: false, masterVolume: 0.65,
  effectsVolume: 0.8, ambientVolume: 0.3, muted: false,
}
export function normalizeGameSettings(value: unknown): GameSettings {
  const input = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const bounded = (key: keyof GameSettings, min: number, max: number): number => {
    const candidate = input[key]
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.min(max, Math.max(min, candidate)) : DEFAULT_GAME_SETTINGS[key] as number
  }
  return {
    sensitivity: bounded('sensitivity', 0.2, 3),
    invertY: typeof input.invertY === 'boolean' ? input.invertY : false,
    masterVolume: bounded('masterVolume', 0, 1),
    effectsVolume: bounded('effectsVolume', 0, 1),
    ambientVolume: bounded('ambientVolume', 0, 1),
    muted: typeof input.muted === 'boolean' ? input.muted : false,
  }
}
export function loadGameSettings(storage: Pick<Storage, 'getItem'>): GameSettings {
  try { return normalizeGameSettings(JSON.parse(storage.getItem(GAME_SETTINGS_KEY) ?? 'null')) }
  catch { return { ...DEFAULT_GAME_SETTINGS } }
}
export function saveGameSettings(storage: Pick<Storage, 'setItem'>, value: GameSettings): boolean {
  try { storage.setItem(GAME_SETTINGS_KEY, JSON.stringify(normalizeGameSettings(value))); return true }
  catch { return false }
}
