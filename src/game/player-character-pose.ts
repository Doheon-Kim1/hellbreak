export type PlayerCharacterPoseState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'landing'
  | 'rescuing'
  | 'rescued'
  | 'dead'
  | 'escaped'

export type PlayerCharacterPresentationState =
  | 'idle'
  | 'run'
  | 'airborne'
  | 'rescuing'
  | 'rescued'
  | 'dead'
  | 'escaped'

export type PlayerCharacterRescueRole = 'none' | 'rescuer' | 'target'

const TAU = Math.PI * 2
const BOOT_SOLE_Y = -1.29
const SUPPORT_CLEARANCE = 0.026
export const PLAYER_CHARACTER_SHOULDER_X = 0.38
export const PLAYER_CHARACTER_SHOULDER_Y = 0.27

function wrapAngle(angle: number): number {
  const wrapped = (angle + Math.PI) % TAU
  return (wrapped < 0 ? wrapped + TAU : wrapped) - Math.PI
}

function shortestAngle(from: number, to: number): number {
  let difference = (to - from) % TAU
  if (difference > Math.PI) difference -= TAU
  if (difference < -Math.PI) difference += TAU
  return difference
}

/** Positions the procedural sole exactly on the collider/platform support plane after scaling. */
export function playerCharacterRootOffsetY(scale: number, supportY = -0.72): number {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const safeSupport = Number.isFinite(supportY) ? supportY : -0.72
  return safeSupport - BOOT_SOLE_Y * safeScale + SUPPORT_CLEARANCE
}

/** Server-published state plus client-only render observations. No value in this contract is sent. */
export interface PlayerCharacterPoseInput {
  elapsed: number
  delta: number
  velocityX: number
  velocityY: number
  velocityZ: number
  grounded: boolean
  alive: boolean
  escaped: boolean
  rescueRole: PlayerCharacterRescueRole
  rescueDirectionX: number
  rescueDirectionY: number
  rescueDirectionZ: number
  reducedMotion: boolean
}

/** Mutable render pose. Callers may reuse one instance forever to avoid frame allocations. */
export interface PlayerCharacterPose {
  state: PlayerCharacterPoseState
  presentationState: PlayerCharacterPresentationState
  heading: number
  gaitPhase: number
  landingAge: number
  wasGrounded: boolean
  bodyY: number
  bodyPitch: number
  bodyRoll: number
  bodyScaleX: number
  bodyScaleY: number
  headYaw: number
  headPitch: number
  leftUpperArmX: number
  leftUpperArmZ: number
  leftForearmX: number
  rightUpperArmX: number
  rightUpperArmZ: number
  rightForearmX: number
  leftThighX: number
  leftThighZ: number
  leftShinX: number
  rightThighX: number
  rightThighZ: number
  rightShinX: number
  rescueReach: number
  rescueYaw: number
  rescuePitch: number
}

export function createPlayerCharacterPose(): PlayerCharacterPose {
  return {
    state: 'idle',
    presentationState: 'idle',
    heading: 0,
    gaitPhase: 0,
    landingAge: Number.POSITIVE_INFINITY,
    wasGrounded: true,
    bodyY: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    bodyScaleX: 1,
    bodyScaleY: 1,
    headYaw: 0,
    headPitch: 0,
    leftUpperArmX: 0,
    leftUpperArmZ: 0,
    leftForearmX: 0,
    rightUpperArmX: 0,
    rightUpperArmZ: 0,
    rightForearmX: 0,
    leftThighX: 0,
    leftThighZ: 0,
    leftShinX: 0,
    rightThighX: 0,
    rightThighZ: 0,
    rightShinX: 0,
    rescueReach: 0,
    rescueYaw: 0,
    rescuePitch: 0,
  }
}

export function updatePlayerCharacterPose(
  input: PlayerCharacterPoseInput,
  out: PlayerCharacterPose = createPlayerCharacterPose(),
  renderScale = 1,
): PlayerCharacterPose {
  const elapsed = Number.isFinite(input.elapsed) ? input.elapsed : 0
  const delta = Number.isFinite(input.delta) && input.delta > 0 ? Math.min(input.delta, 0.1) : 0
  const velocityX = Number.isFinite(input.velocityX) ? input.velocityX : 0
  const velocityY = Number.isFinite(input.velocityY) ? Math.max(-20, Math.min(20, input.velocityY)) : 0
  const velocityZ = Number.isFinite(input.velocityZ) ? input.velocityZ : 0
  const speed = Math.min(12, Math.hypot(velocityX, velocityZ))
  const grounded = Boolean(input.grounded)
  const motionScale = input.reducedMotion ? 0.2 : 1
  if (!Number.isFinite(out.heading) || Math.abs(out.heading) > Math.PI) out.heading = 0
  if (!Number.isFinite(out.gaitPhase) || out.gaitPhase < 0 || out.gaitPhase >= TAU) out.gaitPhase = 0
  const landedThisFrame = grounded && !out.wasGrounded
  if (!grounded) out.landingAge = Number.POSITIVE_INFINITY
  else if (landedThisFrame) out.landingAge = 0
  else if (Number.isFinite(out.landingAge)) out.landingAge += delta

  const groundedMotionState: PlayerCharacterPoseState = speed > 0.12 ? 'run' : 'idle'
  out.state = grounded ? groundedMotionState : (velocityY > 0.25 ? 'jump' : 'fall')
  out.presentationState = grounded ? (speed > 0.12 ? 'run' : 'idle') : 'airborne'
  if (grounded && out.landingAge < 0.18) out.state = 'landing'
  const breathingY = (Math.sin(elapsed * Math.PI * 2) + 1) * 0.0125 * motionScale
  out.bodyY = breathingY
  out.bodyPitch = 0
  out.bodyRoll = 0
  out.bodyScaleX = 1
  out.bodyScaleY = 1
  out.headYaw = Math.sin(elapsed * 1.7) * 0.08 * motionScale
  out.headPitch = 0
  out.leftUpperArmX = 0
  out.leftUpperArmZ = 0
  out.leftForearmX = 0
  out.rightUpperArmX = 0
  out.rightUpperArmZ = 0
  out.rightForearmX = 0
  out.leftThighX = 0
  out.leftThighZ = 0
  out.leftShinX = 0
  out.rightThighX = 0
  out.rightThighZ = 0
  out.rightShinX = 0
  out.rescueReach = 0
  out.rescueYaw = 0
  out.rescuePitch = 0

  if (speed > 0.12) {
    const targetHeading = Math.atan2(velocityX, velocityZ)
    out.heading = wrapAngle(
      out.heading + shortestAngle(out.heading, targetHeading) * (1 - Math.exp(-delta * 14)),
    )
  }

  if (out.state === 'landing') {
    const squash = Math.max(0, 1 - out.landingAge / 0.18) * motionScale
    out.bodyY -= 0.08 * squash
    out.bodyScaleX = 1 + 0.14 * squash
    out.bodyScaleY = 1 - 0.18 * squash
    out.leftThighX = -0.38
    out.rightThighX = -0.38
    out.leftShinX = 0.62
    out.rightShinX = 0.62
  } else if (out.state === 'run') {
    out.gaitPhase = (out.gaitPhase + delta * speed * 1.8 * (input.reducedMotion ? 0.25 : 1)) % TAU
    const swing = Math.sin(out.gaitPhase) * Math.min(0.82, 0.25 + speed * 0.075) * motionScale
    out.leftUpperArmX = -swing
    out.rightUpperArmX = swing
    out.leftThighX = swing
    out.rightThighX = -swing
    out.bodyPitch = Math.min(0.28, speed * 0.025)
    out.bodyY += Math.abs(Math.sin(out.gaitPhase * 2)) * 0.045 * motionScale
  } else if (out.state === 'jump') {
    out.bodyPitch = 0.1
    out.bodyScaleY = 0.94
    out.leftUpperArmX = -0.42
    out.rightUpperArmX = -0.42
    out.leftThighX = -0.48
    out.rightThighX = -0.48
    out.leftShinX = 0.78
    out.rightShinX = 0.78
  } else if (out.state === 'fall') {
    out.bodyPitch = -0.08
    out.leftUpperArmX = 0.25
    out.rightUpperArmX = 0.25
    out.leftUpperArmZ = -0.48
    out.rightUpperArmZ = 0.48
    out.leftThighZ = -0.18
    out.rightThighZ = 0.18
    out.leftShinX = 0.2
    out.rightShinX = 0.2
  }

  if (input.rescueRole === 'rescuer' || input.rescueRole === 'target') {
    const directionX = Number.isFinite(input.rescueDirectionX) ? input.rescueDirectionX : 0
    const directionY = Number.isFinite(input.rescueDirectionY) ? input.rescueDirectionY : 0
    const directionZ = Number.isFinite(input.rescueDirectionZ) ? input.rescueDirectionZ : -1
    const horizontal = Math.hypot(directionX, directionZ)
    const length = Math.hypot(horizontal, directionY)
    const safeLength = length > 1e-4 ? length : 1
    const normalizedX = directionX / safeLength
    const normalizedY = directionY / safeLength
    const normalizedZ = directionZ / safeLength
    const targetYaw = horizontal > 1e-4 ? Math.atan2(normalizedX, normalizedZ) : out.heading
    out.rescueYaw = Math.max(-Math.PI, Math.min(Math.PI, shortestAngle(out.heading, targetYaw)))
    out.rescuePitch = Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, Math.atan2(normalizedY, horizontal / safeLength)),
    )
    // Rescue silhouettes are atomic presentation states. Do not compound a prior-frame landing
    // squash or run bob with the reach/hang transform: those combinations can drive boots through
    // the support plane and make the body shape depend on update order.
    out.bodyY = breathingY
    out.bodyScaleX = 1
    out.bodyScaleY = 1
    out.leftThighZ = 0
    out.rightThighZ = 0

    if (input.rescueRole === 'rescuer') {
      out.state = 'rescuing'
      out.presentationState = 'rescuing'
      out.rescueReach = 1
      out.bodyY += 0.028
      out.bodyPitch = 0.18
      if (horizontal > 1e-4) {
        out.heading = wrapAngle(targetYaw)
        out.rescueYaw = 0
      }
      out.bodyRoll = Math.max(-0.18, Math.min(0.18, normalizedX * -0.18))
      // Aim from the actual articulated shoulder, not from the character root. Close overhead links
      // put those origins far apart angularly. Convert the world-space root offset through inverse
      // root/body transforms, subtract the shoulder in body space, then rotate the straight two-bone
      // chain onto that vector. This is presentation-only and never feeds a position back to Rapier.
      const safeRenderScale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1
      const headingCos = Math.cos(out.heading)
      const headingSin = Math.sin(out.heading)
      const rootTargetX = (headingCos * directionX - headingSin * directionZ) / safeRenderScale
      const rootTargetY = directionY / safeRenderScale - out.bodyY
      const rootTargetZ = (headingSin * directionX + headingCos * directionZ) / safeRenderScale
      const pitchCos = Math.cos(out.bodyPitch)
      const pitchSin = Math.sin(out.bodyPitch)
      const rollCos = Math.cos(out.bodyRoll)
      const rollSin = Math.sin(out.bodyRoll)
      const pitchedY = pitchCos * rootTargetY + pitchSin * rootTargetZ
      const shoulderTargetX = rollCos * rootTargetX + rollSin * pitchedY
        - PLAYER_CHARACTER_SHOULDER_X
      const shoulderTargetY = -rollSin * rootTargetX + rollCos * pitchedY
        - PLAYER_CHARACTER_SHOULDER_Y
      const shoulderTargetZ = -pitchSin * rootTargetY + pitchCos * rootTargetZ
      const shoulderTargetLength = Math.hypot(
        shoulderTargetX,
        shoulderTargetY,
        shoulderTargetZ,
      )
      const aimX = shoulderTargetLength > 1e-4 ? shoulderTargetX / shoulderTargetLength : 0
      const aimY = shoulderTargetLength > 1e-4 ? shoulderTargetY / shoulderTargetLength : -1
      const aimZ = shoulderTargetLength > 1e-4 ? shoulderTargetZ / shoulderTargetLength : 0
      out.rightUpperArmX = Math.atan2(-aimZ, -aimY)
      out.rightUpperArmZ = Math.asin(Math.max(-1, Math.min(1, aimX)))
      out.rightForearmX = 0
      out.leftUpperArmX = 0.32
      out.leftUpperArmZ = -0.18
      out.leftForearmX = 0.42
      out.leftThighX = 0
      out.rightThighX = 0
      out.leftShinX = 0
      out.rightShinX = 0
    } else {
      out.state = 'rescued'
      out.presentationState = 'rescued'
      out.rescueReach = 0.65
      out.bodyY += 0.045
      out.bodyPitch = -0.2 + normalizedY * 0.12
      out.bodyRoll = Math.max(-0.12, Math.min(0.12, -normalizedX * 0.12))
      out.headPitch = -0.2
      out.rightUpperArmX = -0.72
      out.rightUpperArmZ = Math.max(-0.7, Math.min(0.7, -out.rescueYaw * 0.35))
      out.rightForearmX = 0.38
      // The unheld side hangs loose, making the harness pull readable without a physics ragdoll.
      out.leftUpperArmX = 0.62
      out.leftUpperArmZ = -0.28
      out.leftForearmX = 0.82
      out.leftThighX = 0.22
      out.rightThighX = -0.18
      out.leftShinX = 0.32
      out.rightShinX = 0.12
    }
  }

  if (input.escaped && input.alive) {
    const victoryBounce = Math.abs(Math.sin(elapsed * 4)) * 0.1 * motionScale
    out.state = 'escaped'
    out.presentationState = 'escaped'
    out.rescueReach = 0
    out.bodyY = 0.08 + victoryBounce
    out.bodyPitch = -0.08
    out.bodyRoll = Math.sin(elapsed * 3) * 0.08 * motionScale
    out.bodyScaleX = 1
    out.bodyScaleY = 1.04
    out.headYaw = Math.sin(elapsed * 2) * 0.12 * motionScale
    out.headPitch = -0.14
    out.leftUpperArmX = -1.34
    out.leftUpperArmZ = -0.48
    out.leftForearmX = 0.18
    out.rightUpperArmX = -1.34
    out.rightUpperArmZ = 0.48
    out.rightForearmX = 0.18
    out.leftThighX = -0.08
    out.leftThighZ = -0.18
    out.leftShinX = 0.14
    out.rightThighX = -0.08
    out.rightThighZ = 0.18
    out.rightShinX = 0.14
  }

  if (!input.alive) {
    out.state = 'dead'
    out.presentationState = 'dead'
    out.rescueReach = 0
    out.bodyY = -0.38
    out.bodyPitch = 0.36
    out.bodyRoll = 1.18
    out.bodyScaleX = 1
    out.bodyScaleY = 0.94
    out.headYaw = 0.24
    out.headPitch = 0.52
    out.leftUpperArmX = 0.72
    out.leftUpperArmZ = -0.52
    out.leftForearmX = 0.9
    out.rightUpperArmX = 0.45
    out.rightUpperArmZ = 0.62
    out.rightForearmX = 1.02
    out.leftThighX = 0.36
    out.leftThighZ = -0.34
    out.leftShinX = 0.52
    out.rightThighX = -0.28
    out.rightThighZ = 0.46
    out.rightShinX = 0.7
  }

  out.wasGrounded = grounded
  return out
}
