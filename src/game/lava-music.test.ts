import { describe, expect, it } from 'vitest'
import { LAVA_MUSIC_BEATS, LAVA_MUSIC_BPM, synthesizeLavaMusic } from './lava-music'

describe('original lava escape score', () => {
  it('produces deterministic bounded stereo music with audible notes and a click-free loop edge', () => {
    const score = synthesizeLavaMusic(8000)
    expect(score.duration).toBe(LAVA_MUSIC_BEATS * 60 / LAVA_MUSIC_BPM)
    expect(score.channels).toHaveLength(2)
    expect(score.channels[0].length).toBe(Math.round(score.duration * 8000))
    let energy = 0, stereoDifference = 0, peak = 0
    for (let i = 0; i < score.channels[0].length; i += 1) {
      const left = score.channels[0][i], right = score.channels[1][i]
      expect(Number.isFinite(left) && Number.isFinite(right)).toBe(true)
      peak = Math.max(peak, Math.abs(left), Math.abs(right))
      energy += left * left
      stereoDifference += Math.abs(left - right)
    }
    expect(Math.sqrt(energy / score.channels[0].length)).toBeGreaterThan(0.02)
    expect(peak).toBeLessThanOrEqual(0.6)
    expect(stereoDifference).toBeGreaterThan(1)
    for (const channel of score.channels) {
      expect(channel[0]).toBe(0)
      expect(channel[channel.length - 1]).toBe(0)
    }
    expect(synthesizeLavaMusic(8000).channels[0]).toEqual(score.channels[0])
    expect(score.channels[0].slice(8000, 8100)).not.toEqual(score.channels[0].slice(16000, 16100))
  })
  it('rejects invalid sample rates before allocating audio', () => {
    for (const rate of [0, -1, NaN, Infinity, 1e9]) expect(() => synthesizeLavaMusic(rate)).toThrow(RangeError)
  })
})
