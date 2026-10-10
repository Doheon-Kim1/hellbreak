import { expect, it } from 'vitest'
import { JumpBuffer } from './jump-buffer'

it('keeps a fresh airborne press for landing, consumes it once, and clears stale or paused intent', () => {
  const buffer = new JumpBuffer()
  buffer.queue(1)
  expect(buffer.consume(1.05, false)).toBe(false)
  expect(buffer.consume(1.12, true)).toBe(true)
  expect(buffer.consume(1.13, true)).toBe(false)
  buffer.queue(2)
  expect(buffer.consume(2.151, true)).toBe(false)
  buffer.queue(3)
  buffer.clear()
  expect(buffer.consume(3.01, true)).toBe(false)
})
