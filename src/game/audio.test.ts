import { describe, expect, it, vi } from 'vitest'
import { audioLevels, createGameAudio, soundSequence } from './audio'
import { DEFAULT_GAME_SETTINGS } from './settings'
describe('game audio mixing', () => {
  it('multiplies channels by master and silences all channels on mute', () => {
    expect(audioLevels({ ...DEFAULT_GAME_SETTINGS, masterVolume: 0.5, effectsVolume: 0.8, ambientVolume: 0.2 }, true))
      .toEqual({ effects: 0.4, ambient: 0.1, music: 0.5 * DEFAULT_GAME_SETTINGS.musicVolume })
    expect(audioLevels({ ...DEFAULT_GAME_SETTINGS, muted: true }, true)).toEqual({ effects: 0, ambient: 0, music: 0 })
    expect(audioLevels(DEFAULT_GAME_SETTINGS, false).ambient).toBe(0)
    expect(audioLevels(DEFAULT_GAME_SETTINGS, false).music).toBe(0)
    expect(audioLevels({ ...DEFAULT_GAME_SETTINGS, musicVolume: 0 }, true).music).toBe(0)
    expect(audioLevels({ ...DEFAULT_GAME_SETTINGS, effectsVolume: 0, ambientVolume: 0 }, true).music).toBeGreaterThan(0)
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
  it('owns one looping music source and stops both loop sources exactly once on disposal', () => {
    const sources: Array<{ buffer: AudioBuffer | null; loop: boolean; start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
    const parameter = () => ({ value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() })
    const gains: Array<{ gain: ReturnType<typeof parameter>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
    const close = vi.fn(async () => undefined)
    const context = {
      currentTime: 0, sampleRate: 8000, destination: {}, close,
      createGain: () => { const node = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() }; gains.push(node); return node },
      createBuffer: (channels: number, length: number, rate: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(length))
        return { length, duration: length / rate, numberOfChannels: channels, getChannelData: (channel: number) => data[channel] }
      },
      createBufferSource: () => {
        const node = { buffer: null as AudioBuffer | null, loop: false, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }
        sources.push(node); return node
      },
      createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }),
      resume: vi.fn(async () => undefined), suspend: vi.fn(async () => undefined),
    }
    const audio = createGameAudio(context as unknown as AudioContext)
    expect(sources).toHaveLength(2)
    expect(sources[1].loop).toBe(true)
    expect(sources[1].buffer?.numberOfChannels).toBe(2)
    expect(sources[1].buffer?.duration).toBeGreaterThan(15)
    expect(sources[1].connect).toHaveBeenCalledWith(gains[2])
    audio.update(DEFAULT_GAME_SETTINGS, true)
    expect(gains[2].gain.setTargetAtTime).toHaveBeenCalledWith(
      DEFAULT_GAME_SETTINGS.masterVolume * DEFAULT_GAME_SETTINGS.musicVolume, 0, 0.02)
    audio.update(DEFAULT_GAME_SETTINGS, false)
    expect(gains[2].gain.setValueAtTime).toHaveBeenCalledWith(0, 0)
    audio.dispose(); audio.dispose()
    for (const source of sources) {
      expect(source.start).toHaveBeenCalledTimes(1)
      expect(source.stop).toHaveBeenCalledTimes(1)
      expect(source.disconnect).toHaveBeenCalledTimes(1)
    }
    expect(gains[2].disconnect).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
