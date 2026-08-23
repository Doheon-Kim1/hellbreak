import { describe, expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import {
  PLAYER_CHARACTER_SHOULDER_X,
  PLAYER_CHARACTER_SHOULDER_Y,
  createPlayerCharacterPose,
  playerCharacterRootOffsetY,
  updatePlayerCharacterPose,
} from './player-character-pose'
import type { PlayerCharacterPoseInput } from './player-character-pose'

function input(overrides: Partial<PlayerCharacterPoseInput> = {}): PlayerCharacterPoseInput {
  return {
    elapsed: 0,
    delta: 1 / 60,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    grounded: true,
    alive: true,
    escaped: false,
    rescueRole: 'none',
    rescueDirectionX: 0,
    rescueDirectionY: 0,
    rescueDirectionZ: -1,
    reducedMotion: false,
    ...overrides,
  }
}

type Pose = ReturnType<typeof createPlayerCharacterPose>

function characterBody(pose: Pose, scale: number, supportY: number) {
  const root = new Object3D()
  root.position.y = playerCharacterRootOffsetY(scale, supportY)
  root.rotation.y = pose.heading
  root.scale.setScalar(scale)
  const body = new Object3D()
  body.position.y = pose.bodyY
  body.rotation.set(pose.bodyPitch, 0, pose.bodyRoll)
  body.scale.set(pose.bodyScaleX, pose.bodyScaleY, pose.bodyScaleX)
  root.add(body)
  return { root, body }
}

function lowestBootCornerY(pose: Pose, scale: number, supportY: number): number {
  const { root, body } = characterBody(pose, scale, supportY)
  const legs = [
    { x: -0.2, thighX: pose.leftThighX, thighZ: pose.leftThighZ, shinX: pose.leftShinX },
    { x: 0.2, thighX: pose.rightThighX, thighZ: pose.rightThighZ, shinX: pose.rightShinX },
  ]
  let lowest = Number.POSITIVE_INFINITY
  for (const leg of legs) {
    const thigh = new Object3D()
    thigh.position.set(leg.x, -0.28, 0)
    thigh.rotation.set(leg.thighX, 0, leg.thighZ)
    body.add(thigh)
    const shin = new Object3D()
    shin.position.set(0, -0.48, 0)
    shin.rotation.x = leg.shinX
    thigh.add(shin)
    const boot = new Object3D()
    boot.position.set(0, -0.45, 0.07)
    boot.scale.set(0.23, 0.16, 0.34)
    shin.add(boot)
    root.updateMatrixWorld(true)
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          lowest = Math.min(lowest, boot.localToWorld(new Vector3(x, y, z)).y)
        }
      }
    }
  }
  return lowest
}

function rescueArmAngleToPartnerRoot(
  pose: Pose,
  partnerRootOffset: Vector3,
  scale = 0.82,
): number {
  const { root, body } = characterBody(pose, scale, -0.72)
  const shoulder = new Object3D()
  const forearm = new Object3D()
  const glove = new Object3D()
  shoulder.position.set(PLAYER_CHARACTER_SHOULDER_X, PLAYER_CHARACTER_SHOULDER_Y, 0)
  forearm.position.set(0, -0.44, 0)
  glove.position.set(0, -0.43, 0)
  body.add(shoulder)
  shoulder.add(forearm)
  forearm.add(glove)
  shoulder.rotation.set(pose.rightUpperArmX, 0, pose.rightUpperArmZ)
  forearm.rotation.x = pose.rightForearmX
  root.updateMatrixWorld(true)
  const selfRootWorld = root.getWorldPosition(new Vector3())
  const shoulderWorld = shoulder.getWorldPosition(new Vector3())
  const gloveDirection = glove.getWorldPosition(new Vector3()).sub(shoulderWorld).normalize()
  const targetDirection = selfRootWorld.add(partnerRootOffset).sub(shoulderWorld).normalize()
  const dot = Math.max(-1, Math.min(1, gloveDirection.dot(targetDirection)))
  return Math.acos(dot) * 180 / Math.PI
}

const RESCUE_DIRECTIONS = Array.from(
  { length: 13 },
  (_, elevationIndex) => -Math.PI / 2 + elevationIndex * Math.PI / 12,
).flatMap((elevation) => Array.from({ length: 32 }, (_, index) => {
  const azimuth = index * Math.PI / 16
  const horizontal = Math.cos(elevation)
  return new Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal,
  )
}))

describe('Infernal Climber pose', () => {
  it('holds a readable breathing idle while grounded and still', () => {
    const pose = updatePlayerCharacterPose(input({ elapsed: 0.25 }), createPlayerCharacterPose())

    expect(pose.state).toBe('idle')
    expect(pose.presentationState).toBe('idle')
    expect(pose.bodyY).toBeGreaterThan(0)
    expect(Math.abs(pose.headYaw)).toBeLessThanOrEqual(0.12)
  })

  it('swings opposite arms and legs while running', () => {
    const pose = updatePlayerCharacterPose(
      input({ delta: 0.1, velocityX: 5, velocityZ: 0 }),
      createPlayerCharacterPose(),
    )

    expect(pose.state).toBe('run')
    expect(pose.presentationState).toBe('run')
    expect(pose.gaitPhase).toBeGreaterThan(0)
    expect(pose.leftUpperArmX * pose.rightUpperArmX).toBeLessThan(0)
    expect(pose.leftThighX * pose.rightThighX).toBeLessThan(0)
    expect(pose.bodyPitch).toBeGreaterThan(0)
  })

  it('turns toward horizontal travel and preserves the last heading at rest', () => {
    const pose = createPlayerCharacterPose()
    updatePlayerCharacterPose(input({ delta: 0.1, velocityX: 5 }), pose)
    const movingHeading = pose.heading

    updatePlayerCharacterPose(input({ delta: 0.1 }), pose)

    // The rig's visor, core, harness and boot toes establish local +Z as its front.
    expect(movingHeading).toBeGreaterThan(0.2)
    expect(pose.heading).toBe(movingHeading)
  })

  it('takes the shortest turn across the pi seam without leaving the normalized range', () => {
    const pose = createPlayerCharacterPose()
    pose.heading = Math.PI - 0.01
    const target = -Math.PI + 0.01

    updatePlayerCharacterPose(input({
      delta: 0.1,
      velocityX: Math.sin(target) * 5,
      velocityZ: Math.cos(target) * 5,
    }), pose)
    const firstHeading = pose.heading
    updatePlayerCharacterPose(input({
      delta: 0.1,
      velocityX: Math.sin(target) * 5,
      velocityZ: Math.cos(target) * 5,
    }), pose)

    expect(Math.abs(firstHeading)).toBeLessThanOrEqual(Math.PI)
    expect(Math.abs(pose.heading)).toBeLessThanOrEqual(Math.PI)
    expect(Math.abs(pose.heading)).toBeGreaterThan(3)
  })

  it('keeps every transformed boot corner above capsule and bot support surfaces', () => {
    const supports = [
      { scale: 0.82, y: -0.72 },
      { scale: 0.74, y: 0.14 - 0.7 },
    ]
    let lowestMargin = Number.POSITIVE_INFINITY
    let lowestContext = ''
    const assertSupported = (pose: Pose) => {
      for (const support of supports) {
        const margin = lowestBootCornerY(pose, support.scale, support.y) - support.y
        if (margin < lowestMargin) {
          lowestMargin = margin
          lowestContext = JSON.stringify({
            scale: support.scale,
            state: pose.state,
            bodyY: pose.bodyY,
            bodyPitch: pose.bodyPitch,
            bodyRoll: pose.bodyRoll,
          })
        }
      }
    }

    for (let frame = 0; frame < 120; frame += 1) {
      assertSupported(updatePlayerCharacterPose(input({ elapsed: frame / 60 }), createPlayerCharacterPose()))
    }

    const running = createPlayerCharacterPose()
    for (let frame = 0; frame < 240; frame += 1) {
      updatePlayerCharacterPose(input({
        elapsed: frame / 60,
        delta: 1 / 60,
        velocityX: 5,
        velocityZ: 3,
      }), running)
      assertSupported(running)
    }

    const landing = createPlayerCharacterPose()
    updatePlayerCharacterPose(input({ grounded: false, velocityY: -5 }), landing)
    for (let frame = 0; frame < 16; frame += 1) {
      updatePlayerCharacterPose(input({ elapsed: frame / 60, grounded: true }), landing)
      assertSupported(landing)
    }

    const rescueBases = [
      { label: 'plain', create: () => createPlayerCharacterPose(), overrides: {} },
      ...[0, 0.045, 0.09, 0.135, 0.175].map((landingAge) => ({
        label: `landing-${landingAge}`,
        create: () => ({ ...createPlayerCharacterPose(), wasGrounded: true, landingAge }),
        overrides: { delta: 0 },
      })),
      ...[0.121, 5, 12].flatMap((velocityX) => (
        [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4, Math.PI].map((gaitPhase) => ({
          label: `run-${velocityX}-${gaitPhase}`,
          create: () => ({ ...createPlayerCharacterPose(), gaitPhase }),
          overrides: { delta: 0, velocityX },
        }))
      )),
    ]
    for (const elapsed of [0, 0.25, 0.5, 0.75]) {
      for (const direction of RESCUE_DIRECTIONS) {
        for (const reducedMotion of [false, true]) {
          for (const base of rescueBases) {
            assertSupported(updatePlayerCharacterPose(input({
              ...base.overrides,
              elapsed,
              reducedMotion,
              rescueRole: 'rescuer',
              rescueDirectionX: direction.x,
              rescueDirectionY: direction.y,
              rescueDirectionZ: direction.z,
            }), base.create()))
            assertSupported(updatePlayerCharacterPose(input({
              ...base.overrides,
              elapsed,
              reducedMotion,
              rescueRole: 'target',
              rescueDirectionX: -direction.x,
              rescueDirectionY: -direction.y,
              rescueDirectionZ: -direction.z,
            }), base.create()))
          }
        }
      }
    }
    expect(lowestMargin, lowestContext).toBeGreaterThanOrEqual(-1e-6)
  }, 15_000)

  it('distinguishes a compressed rising jump from a spread falling silhouette', () => {
    const rising = updatePlayerCharacterPose(
      input({ grounded: false, velocityY: 6 }),
      createPlayerCharacterPose(),
    )
    const falling = updatePlayerCharacterPose(
      input({ grounded: false, velocityY: -8 }),
      createPlayerCharacterPose(),
    )

    expect(rising.state).toBe('jump')
    expect(rising.presentationState).toBe('airborne')
    expect(rising.leftShinX).toBeGreaterThan(0.45)
    expect(falling.state).toBe('fall')
    expect(falling.presentationState).toBe('airborne')
    expect(Math.abs(falling.leftUpperArmZ)).toBeGreaterThan(0.2)
  })

  it('squashes briefly when an airborne climber lands', () => {
    const pose = createPlayerCharacterPose()
    updatePlayerCharacterPose(input({ grounded: false, velocityY: -7 }), pose)
    updatePlayerCharacterPose(input({ grounded: true, delta: 1 / 60 }), pose)

    expect(pose.state).toBe('landing')
    expect(pose.bodyScaleX).toBeGreaterThan(1)
    expect(pose.bodyScaleY).toBeLessThan(1)

    updatePlayerCharacterPose(input({ grounded: true, delta: 0.1 }), pose)
    updatePlayerCharacterPose(input({ grounded: true, delta: 0.1 }), pose)
    expect(pose.state).toBe('idle')
  })

  it('reaches with one two-bone arm while rescuing and hangs from the harness while rescued', () => {
    const rescuer = updatePlayerCharacterPose(input({
      rescueRole: 'rescuer',
      rescueDirectionX: 1,
      rescueDirectionY: 0.5,
      rescueDirectionZ: 0,
    }), createPlayerCharacterPose())
    const rescued = updatePlayerCharacterPose(input({
      grounded: false,
      velocityY: -2,
      rescueRole: 'target',
      rescueDirectionX: -1,
      rescueDirectionY: 1,
      rescueDirectionZ: 0,
    }), createPlayerCharacterPose())

    expect(rescuer.state).toBe('rescuing')
    expect(rescuer.presentationState).toBe('rescuing')
    expect(rescuer.rescueReach).toBeGreaterThan(0.8)
    expect(Math.abs(rescuer.rightUpperArmX)).toBeGreaterThan(0.5)
    expect(Math.abs(rescuer.rightForearmX)).toBeLessThan(0.5)
    expect(rescued.state).toBe('rescued')
    expect(rescued.presentationState).toBe('rescued')
    expect(Math.abs(rescued.bodyRoll)).toBeGreaterThan(0.07)
    expect(rescued.leftForearmX).toBeGreaterThan(0.5)
  })

  it('aims the complete rescue arm from its shoulder toward partner roots across legal reach', () => {
    let worstAngle = Number.NEGATIVE_INFINITY
    let worstContext = 'no sample'
    for (const distance of [0.3, 0.5, 1, 2.4]) {
      for (const unitDirection of RESCUE_DIRECTIONS) {
        const direction = unitDirection.clone().multiplyScalar(distance)
        const pose = updatePlayerCharacterPose(input({
          rescueRole: 'rescuer',
          rescueDirectionX: direction.x,
          rescueDirectionY: direction.y,
          rescueDirectionZ: direction.z,
        }), createPlayerCharacterPose(), 0.82)
        const angle = rescueArmAngleToPartnerRoot(pose, direction)
        if (angle > worstAngle) {
          worstAngle = angle
          worstContext = `distance=${distance}, direction=${direction.toArray().join(',')}`
        }
      }
    }
    expect(worstAngle, worstContext).toBeLessThanOrEqual(15)
  })

  it('drops every rescue gesture into a limp dead silhouette', () => {
    const pose = updatePlayerCharacterPose(input({
      alive: false,
      grounded: false,
      velocityY: -20,
      rescueRole: 'rescuer',
    }), createPlayerCharacterPose())

    expect(pose.state).toBe('dead')
    expect(pose.presentationState).toBe('dead')
    expect(Math.abs(pose.bodyRoll)).toBeGreaterThan(0.9)
    expect(pose.rescueReach).toBe(0)
    expect(pose.leftForearmX).toBeGreaterThan(0.7)
  })

  it('raises both arms in a distinct escaped victory pose', () => {
    const pose = updatePlayerCharacterPose(input({
      elapsed: 0.25,
      escaped: true,
      rescueRole: 'target',
    }), createPlayerCharacterPose())

    expect(pose.state).toBe('escaped')
    expect(pose.presentationState).toBe('escaped')
    expect(pose.leftUpperArmX).toBeLessThan(-1)
    expect(pose.rightUpperArmX).toBeLessThan(-1)
    expect(pose.bodyY).toBeGreaterThan(0)
    expect(pose.rescueReach).toBe(0)
  })

  it('slows repeated gait motion for reduced motion without removing the rescue silhouette', () => {
    const regular = updatePlayerCharacterPose(
      input({ delta: 0.1, velocityZ: -6 }),
      createPlayerCharacterPose(),
    )
    const reduced = updatePlayerCharacterPose(
      input({ delta: 0.1, velocityZ: -6, reducedMotion: true }),
      createPlayerCharacterPose(),
    )
    const reducedRescue = updatePlayerCharacterPose(
      input({ rescueRole: 'rescuer', reducedMotion: true }),
      createPlayerCharacterPose(),
    )

    expect(reduced.gaitPhase).toBeLessThan(regular.gaitPhase * 0.5)
    expect(Math.abs(reduced.leftUpperArmX)).toBeLessThan(Math.abs(regular.leftUpperArmX) * 0.5)
    expect(reducedRescue.presentationState).toBe('rescuing')
    expect(reducedRescue.rescueReach).toBe(1)
  })

  it('reuses its output and repairs non-finite timing, motion, and prior pose values', () => {
    const target = createPlayerCharacterPose()
    target.heading = Number.NaN
    target.gaitPhase = Number.POSITIVE_INFINITY

    const pose = updatePlayerCharacterPose(input({
      elapsed: Number.NaN,
      delta: Number.POSITIVE_INFINITY,
      velocityX: Number.POSITIVE_INFINITY,
      velocityY: Number.NaN,
      velocityZ: Number.NEGATIVE_INFINITY,
      grounded: false,
      rescueDirectionX: Number.NaN,
    }), target)

    expect(pose).toBe(target)
    const transforms = [
      pose.heading, pose.gaitPhase, pose.bodyY, pose.bodyPitch, pose.bodyRoll,
      pose.bodyScaleX, pose.bodyScaleY, pose.headYaw, pose.headPitch,
      pose.leftUpperArmX, pose.leftUpperArmZ, pose.leftForearmX,
      pose.rightUpperArmX, pose.rightUpperArmZ, pose.rightForearmX,
      pose.leftThighX, pose.leftThighZ, pose.leftShinX,
      pose.rightThighX, pose.rightThighZ, pose.rightShinX,
      pose.rescueReach, pose.rescueYaw, pose.rescuePitch,
    ]
    expect(transforms.every(Number.isFinite)).toBe(true)
    expect(transforms.every((value) => Math.abs(value) <= Math.PI)).toBe(true)
  })
})
