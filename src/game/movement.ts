export interface MovementInput {
  forward?: boolean
  backward?: boolean
  left?: boolean
  right?: boolean
}

export interface HorizontalVelocity {
  x: number
  z: number
}

export interface BotPose {
  x: number
  y: number
  z: number
  escaped: boolean
}

export function movementVelocity(input: MovementInput, speed: number): HorizontalVelocity {
  const x = Number(Boolean(input.right)) - Number(Boolean(input.left))
  const z = Number(Boolean(input.backward)) - Number(Boolean(input.forward))
  const length = Math.hypot(x, z)

  if (length === 0) return { x: 0, z: 0 }

  return {
    x: (x / length) * speed,
    z: (z / length) * speed,
  }
}

export function cycleSpectatorIndex(current: number, direction: -1 | 1, runnerCount: number) {
  if (runnerCount <= 0) return 0
  return (current + direction + runnerCount) % runnerCount
}

export function botPoseAt(elapsedSeconds: number, index: number): BotPose {
  const localTime = Math.max(0, elapsedSeconds) + index * 3
  const progress = Math.min(1, localTime / 52)
  const angle = localTime * (0.72 + index * 0.04) + index * 2.1

  return {
    x: Math.sin(angle) * (2.1 + index * 0.12),
    y: -2.35 + progress * 11.6,
    z: Math.cos(angle * 0.82) * 1.55,
    escaped: progress >= 1,
  }
}
