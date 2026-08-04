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

export interface PlatformPose {
  x: number
  y: number
  z: number
  width: number
}

const BOT_HOP_SECONDS = 2.3
const BOT_WAIT_FRACTION = 0.28
const LAST_PLATFORM_INDEX = 16

export function platformPose(index: number): PlatformPose {
  const safeIndex = Math.max(0, Math.min(LAST_PLATFORM_INDEX, Math.floor(index)))
  if (safeIndex === 0) return { x: 0, y: -3.2, z: 0, width: 5.2 }

  const angle = safeIndex * 0.72
  return {
    x: Math.sin(angle) * 2.25,
    y: safeIndex * 0.68 - 3.2,
    z: Math.cos(angle) * 1.75,
    width: safeIndex % 4 === 0 ? 3.7 : 2.7,
  }
}

export function botPoseAt(elapsedSeconds: number, index: number): BotPose {
  const localTime = Math.max(0, elapsedSeconds - index * 0.9)
  const routeProgress = localTime / BOT_HOP_SECONDS
  const platformIndex = Math.min(LAST_PLATFORM_INDEX, Math.floor(routeProgress))
  const current = platformPose(platformIndex)

  if (platformIndex >= LAST_PLATFORM_INDEX) {
    return { x: current.x, y: current.y + 0.7, z: current.z, escaped: true }
  }

  const phase = routeProgress - platformIndex
  if (phase <= BOT_WAIT_FRACTION) {
    return { x: current.x, y: current.y + 0.7, z: current.z, escaped: false }
  }

  const next = platformPose(platformIndex + 1)
  const jumpProgress = Math.min(1, (phase - BOT_WAIT_FRACTION) / (1 - BOT_WAIT_FRACTION))
  const eased = jumpProgress * jumpProgress * (3 - 2 * jumpProgress)
  const jumpArc = Math.sin(Math.PI * jumpProgress) * 1.15

  return {
    x: current.x + (next.x - current.x) * eased,
    y: current.y + (next.y - current.y) * eased + 0.7 + jumpArc,
    z: current.z + (next.z - current.z) * eased,
    escaped: false,
  }
}
