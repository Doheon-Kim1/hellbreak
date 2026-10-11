import { normalizeGameSettings } from './settings'
import type { GameSettings } from './settings'
import { synthesizeLavaMusic } from './lava-music'
export type SoundCue = 'jump' | 'land' | 'grab' | 'death' | 'win' | 'warning' | 'start'
export interface SoundNote { frequency: number; duration: number; gain: number; endFrequency: number }
export function audioLevels(settings: Readonly<GameSettings>, playing: boolean) {
  const s = normalizeGameSettings(settings)
  const master = s.muted ? 0 : s.masterVolume
  return { effects: master * s.effectsVolume, ambient: playing ? master * s.ambientVolume : 0,
    music: playing ? master * s.musicVolume : 0 }
}
export function soundSequence(cue: SoundCue): readonly SoundNote[] {
  const note = (frequency: number, endFrequency: number, duration: number, gain = 0.15): SoundNote =>
    ({ frequency, endFrequency, duration, gain })
  switch (cue) {
    case 'jump': return [note(240, 560, 0.16)]
    case 'land': return [note(110, 45, 0.1, 0.18)]
    case 'grab': return [note(440, 220, 0.09)]
    case 'death': return [note(180, 40, 0.35, 0.2)]
    case 'win': return [note(523, 523, 0.12), note(659, 659, 0.12), note(784, 1046, 0.3)]
    case 'warning': return [note(600, 600, 0.12), note(800, 800, 0.12)]
    case 'start': return [note(262, 392, 0.12), note(523, 523, 0.18)]
  }
}

export interface GameAudio {
  update: (settings: Readonly<GameSettings>, playing: boolean) => void
  unlock: () => void
  suspend: () => void
  play: (cue: SoundCue) => void
  dispose: () => void
}

/** One gesture-created graph; no downloaded assets, autoplay, or gameplay authority. */
export function createGameAudio(context: AudioContext): GameAudio {
  const effects = context.createGain()
  const ambient = context.createGain()
  const music = context.createGain()
  effects.gain.value = 0
  ambient.gain.value = 0
  music.gain.value = 0
  effects.connect(context.destination)
  ambient.connect(context.destination)
  music.connect(context.destination)
  const noise = context.createBufferSource()
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i += 1) {
    last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02
    data[i] = last * 0.18
  }
  noise.buffer = buffer
  noise.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 500
  noise.connect(filter)
  filter.connect(ambient)
  noise.start()
  const score = synthesizeLavaMusic(22050)
  const musicBuffer = context.createBuffer(2, score.channels[0].length, score.sampleRate)
  musicBuffer.getChannelData(0).set(score.channels[0])
  musicBuffer.getChannelData(1).set(score.channels[1])
  const musicSource = context.createBufferSource()
  musicSource.buffer = musicBuffer
  musicSource.loop = true
  musicSource.connect(music)
  musicSource.start()
  let disposed = false
  let suspended = false
  const voices = new Map<OscillatorNode, GainNode>()
  const ramp = (parameter: AudioParam, value: number) => {
    parameter.cancelScheduledValues(context.currentTime)
    if (value === 0) parameter.setValueAtTime(0, context.currentTime)
    else parameter.setTargetAtTime(value, context.currentTime, 0.02)
  }
  return {
    update(settings, playing) {
      if (disposed) return
      const levels = audioLevels(settings, playing)
      ramp(effects.gain, levels.effects)
      ramp(ambient.gain, levels.ambient)
      ramp(music.gain, levels.music)
    },
    unlock() {
      if (disposed) return
      suspended = false
      void context.resume().catch(() => undefined)
    },
    suspend() {
      if (disposed) return
      suspended = true
      void context.suspend().catch(() => undefined)
    },
    play(cue) {
      if (disposed || suspended || voices.size >= 24) return
      let at = context.currentTime
      for (const note of soundSequence(cue)) {
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        oscillator.type = 'triangle'
        oscillator.frequency.setValueAtTime(note.frequency, at)
        oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, at + note.duration)
        envelope.gain.setValueAtTime(0, at)
        envelope.gain.linearRampToValueAtTime(note.gain, at + 0.008)
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + note.duration)
        oscillator.connect(envelope)
        envelope.connect(effects)
        voices.set(oscillator, envelope)
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); voices.delete(oscillator) }
        oscillator.start(at)
        oscillator.stop(at + note.duration + 0.01)
        at += note.duration
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      noise.stop()
      noise.disconnect()
      filter.disconnect()
      musicSource.stop()
      musicSource.disconnect()
      for (const [voice, envelope] of voices) { voice.stop(); voice.disconnect(); envelope.disconnect() }
      voices.clear()
      effects.disconnect()
      ambient.disconnect()
      music.disconnect()
      void context.close().catch(() => undefined)
    },
  }
}
