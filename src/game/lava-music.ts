export const LAVA_MUSIC_BPM = 96
export const LAVA_MUSIC_BEATS = 32
const ROOTS = [38, 38, 34, 34, 41, 41, 36, 36] as const
const ARPEGGIO = [0, 7, 3, 12, 7, 15, 10, 7] as const
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const TAU = Math.PI * 2

/** Original instrumental score: low heartbeat drums, dark bass, a minor pad and ember-like plucks.
 * Rendered once per audio graph at a small fixed rate, not scheduled by gameplay frame callbacks.
 * No downloads, lyrics, samples from other music, timers or external services.
 */
export function synthesizeLavaMusic(sampleRate: number) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) throw new RangeError('Invalid music sample rate')
  const beatLength = 60 / LAVA_MUSIC_BPM
  const duration = LAVA_MUSIC_BEATS * beatLength
  const length = Math.round(duration * sampleRate)
  const left = new Float32Array(length), right = new Float32Array(length)
  const chords = ROOTS.map(root => ({ bass: frequency(root),
    pad: [frequency(root + 12), frequency(root + 15), frequency(root + 19)],
    lead: ARPEGGIO.map(offset => frequency(root + 24 + offset)) }))
  for (let i = 0; i < length; i += 1) {
    const time = i / sampleRate
    const beat = time / beatLength
    const chord = chords[Math.min(chords.length - 1, Math.floor(beat / 4))]
    const pulse = time % beatLength
    const eighth = time % (beatLength / 2)
    const bassPhase = TAU * chord.bass * pulse
    const bass = (Math.sin(bassPhase) + 0.25 * Math.sin(bassPhase * 2)) * 0.13
      * Math.min(1, pulse / 0.012) * Math.exp(-pulse * 3.5)
    const kick = Math.sin(TAU * (38 * pulse + 20 * (1 - Math.exp(-pulse * 10)) / 10))
      * 0.17 * Math.exp(-pulse * 12)
    const pad = chord.pad.reduce((sum, hz) => sum + Math.sin(TAU * hz * time), 0)
      * 0.018 * (0.8 + 0.2 * Math.sin(TAU * beat / 8))
    const leadHz = chord.lead[Math.floor(beat * 2) % ARPEGGIO.length]
    const envelope = Math.min(1, eighth / 0.006) * Math.exp(-eighth * 12) * 0.07
    const leadLeft = (Math.sin(TAU * leadHz * eighth) + 0.18 * Math.sin(TAU * leadHz * 2 * eighth)) * envelope
    const leadRight = (Math.sin(TAU * leadHz * 1.003 * eighth) + 0.18 * Math.sin(TAU * leadHz * 2.006 * eighth)) * envelope
    const hat = Math.sin(TAU * 2700 * eighth) * Math.sin(TAU * 3300 * eighth)
      * 0.008 * Math.exp(-eighth * 65)
    // Both endpoints are exactly zero; a short fade avoids a pop at the looping phrase boundary.
    const edge = Math.max(0, Math.min(1, time / 0.012, (length - 1 - i) / sampleRate / 0.012))
    left[i] = Math.max(-0.6, Math.min(0.6, bass + kick + pad + leadLeft + hat)) * edge
    right[i] = Math.max(-0.6, Math.min(0.6, bass + kick + pad + leadRight + hat)) * edge
  }
  return { duration, sampleRate, channels: [left, right] as const }
}
