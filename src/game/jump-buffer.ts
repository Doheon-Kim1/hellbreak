import { JUMP_BUFFER_SECONDS } from './movement'

/** One-shot local jump intent. Clearing on pause/reset prevents stale takeoff on resume. */
export class JumpBuffer {
  private expiresAt = -Infinity
  queue(now: number): void { this.expiresAt = now + JUMP_BUFFER_SECONDS }
  consume(now: number, grounded: boolean): boolean {
    if (now > this.expiresAt) this.clear()
    if (!grounded || now > this.expiresAt) return false
    this.clear()
    return true
  }
  clear(): void { this.expiresAt = -Infinity }
}
