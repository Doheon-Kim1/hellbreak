'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import type { Group, Object3D } from 'three'
import {
  PLAYER_CHARACTER_SHOULDER_X,
  PLAYER_CHARACTER_SHOULDER_Y,
  createPlayerCharacterPose,
  playerCharacterRootOffsetY,
  updatePlayerCharacterPose,
} from '../game/player-character-pose'
import type {
  PlayerCharacterPoseInput,
  PlayerCharacterPresentationState,
} from '../game/player-character-pose'
import { infernalClimberStyle } from '../game/player-character-style'

/** Mutable presentation state written by an avatar adapter and read without a React render per frame. */
export type PlayerCharacterFrame = PlayerCharacterPoseInput

export interface PlayerCharacterAnchorRegistries {
  root: Map<string, Vector3>
  rightGlove: Map<string, Vector3>
  harness: Map<string, Vector3>
}

export interface PlayerCharacterProps {
  playerId: string
  isOwn: boolean
  frame: { current: PlayerCharacterFrame }
  anchors?: PlayerCharacterAnchorRegistries
  scale?: number
  supportY?: number
  rescueLinkId?: string
  onPose?: (
    playerId: string,
    pose: PlayerCharacterPresentationState | null,
    rescueLinkId: string,
  ) => void
}

/** App-lifetime primitive resources shared by every local, bot, own, and remote climber. */
const GEOMETRY = {
  box: new BoxGeometry(1, 1, 1),
  cone: new ConeGeometry(1, 1, 7),
  limb: new CylinderGeometry(1, 0.88, 1, 8),
  glove: new DodecahedronGeometry(1, 0),
  core: new OctahedronGeometry(1, 0),
  sphere: new SphereGeometry(1, 12, 8),
  ring: new TorusGeometry(1, 0.18, 6, 16),
}

/** App-lifetime shared cache; individual avatar unmounts must never dispose these entries. */
const MATERIALS = new Map<string, MeshStandardMaterial>()

function sharedMaterial(
  key: string,
  color: number,
  emissive = 0x000000,
  emissiveIntensity = 0,
  metalness = 0.15,
): MeshStandardMaterial {
  const cached = MATERIALS.get(key)
  if (cached) return cached
  const material = new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    metalness,
    roughness: 0.52,
  })
  MATERIALS.set(key, material)
  return material
}

const VISOR_MATERIAL = sharedMaterial('visor', 0x100f1d, 0x371f66, 0.45, 0.35)
const JOINT_MATERIAL = sharedMaterial('joint', 0x171522, 0x281742, 0.2, 0.5)

function removeOwnedAnchor(registry: Map<string, Vector3>, id: string, anchor: Vector3) {
  if (registry.get(id) === anchor) registry.delete(id)
}

/**
 * Original primitive-built HELLBREAK rescue climber. The rig is presentation-only: it consumes the
 * completed pure pose API, mutates Three refs directly, and publishes only render anchors locally.
 */
export function PlayerCharacter({
  playerId,
  isOwn,
  frame,
  anchors,
  scale = 1,
  supportY = -0.72,
  rescueLinkId = '',
  onPose,
}: PlayerCharacterProps) {
  const root = useRef<Group>(null)
  const body = useRef<Group>(null)
  const head = useRef<Group>(null)
  const leftUpperArm = useRef<Group>(null)
  const leftForearm = useRef<Group>(null)
  const rightUpperArm = useRef<Group>(null)
  const rightForearm = useRef<Group>(null)
  const leftThigh = useRef<Group>(null)
  const leftShin = useRef<Group>(null)
  const rightThigh = useRef<Group>(null)
  const rightShin = useRef<Group>(null)
  const rightGlove = useRef<Object3D>(null)
  const harness = useRef<Object3D>(null)
  const pose = useRef(createPlayerCharacterPose())
  const lastReportedPose = useRef<PlayerCharacterPresentationState | null>(null)
  const lastReportedRescueLink = useRef('')
  const ownedAnchors = useMemo(() => ({
    root: new Vector3(),
    rightGlove: new Vector3(),
    harness: new Vector3(),
  }), [])

  const alive = frame.current.alive
  const escaped = frame.current.escaped
  const style = useMemo(() => infernalClimberStyle({
    playerId,
    isOwn,
    alive,
    escaped,
  }), [alive, escaped, isOwn, playerId])
  const materials = useMemo(() => ({
    suit: sharedMaterial(`suit:${style.suit}`, style.suit),
    helmet: sharedMaterial(
      `helmet:${style.helmet}:${style.emissive}:${style.emissiveIntensity}`,
      style.helmet,
      style.emissive,
      style.emissiveIntensity * 0.12,
      0.3,
    ),
    accent: sharedMaterial(
      `accent:${style.accent}:${style.emissiveIntensity}`,
      style.accent,
      style.accent,
      style.emissiveIntensity * 0.45,
      0.2,
    ),
    core: sharedMaterial(
      `core:${style.accent}:${style.emissive}:${style.emissiveIntensity}`,
      style.accent,
      style.emissive,
      style.emissiveIntensity,
      0.2,
    ),
  }), [style.accent, style.emissive, style.emissiveIntensity, style.helmet, style.suit])

  useEffect(() => {
    if (!anchors) return
    anchors.root.set(playerId, ownedAnchors.root)
    anchors.rightGlove.set(playerId, ownedAnchors.rightGlove)
    anchors.harness.set(playerId, ownedAnchors.harness)
    return () => {
      removeOwnedAnchor(anchors.root, playerId, ownedAnchors.root)
      removeOwnedAnchor(anchors.rightGlove, playerId, ownedAnchors.rightGlove)
      removeOwnedAnchor(anchors.harness, playerId, ownedAnchors.harness)
    }
  }, [anchors, ownedAnchors, playerId])

  useEffect(() => () => onPose?.(playerId, null, ''), [onPose, playerId])

  useFrame(() => {
    const next = updatePlayerCharacterPose(frame.current, pose.current, scale)
    const rootGroup = root.current
    const bodyGroup = body.current
    if (!rootGroup || !bodyGroup) return

    rootGroup.rotation.y = next.heading
    rootGroup.userData.pose = next.presentationState
    rootGroup.userData.playerId = playerId
    bodyGroup.position.y = next.bodyY
    bodyGroup.rotation.set(next.bodyPitch, 0, next.bodyRoll)
    bodyGroup.scale.set(next.bodyScaleX, next.bodyScaleY, next.bodyScaleX)
    if (head.current) head.current.rotation.set(next.headPitch, next.headYaw, 0)
    if (leftUpperArm.current) leftUpperArm.current.rotation.set(next.leftUpperArmX, 0, next.leftUpperArmZ)
    if (leftForearm.current) leftForearm.current.rotation.x = next.leftForearmX
    if (rightUpperArm.current) rightUpperArm.current.rotation.set(next.rightUpperArmX, 0, next.rightUpperArmZ)
    if (rightForearm.current) rightForearm.current.rotation.x = next.rightForearmX
    if (leftThigh.current) leftThigh.current.rotation.set(next.leftThighX, 0, next.leftThighZ)
    if (leftShin.current) leftShin.current.rotation.x = next.leftShinX
    if (rightThigh.current) rightThigh.current.rotation.set(next.rightThighX, 0, next.rightThighZ)
    if (rightShin.current) rightShin.current.rotation.x = next.rightShinX

    if (anchors) {
      rootGroup.getWorldPosition(ownedAnchors.root)
      rightGlove.current?.getWorldPosition(ownedAnchors.rightGlove)
      harness.current?.getWorldPosition(ownedAnchors.harness)
    }

    if (
      lastReportedPose.current !== next.presentationState
      || lastReportedRescueLink.current !== rescueLinkId
    ) {
      lastReportedPose.current = next.presentationState
      lastReportedRescueLink.current = rescueLinkId
      onPose?.(playerId, next.presentationState, rescueLinkId)
    }
  })

  const ornament = useMemo(() => ({
    rotation: (style.ornament === 'broken'
      ? [0.4, 0, 0.9]
      : style.ornament === 'flare'
        ? [0, 0, Math.PI]
        : [0, 0, 0]) as [number, number, number],
    scale: (style.ornament === 'beacon'
      ? [0.09, 0.16, 0.09]
      : style.ornament === 'flare'
        ? [0.17, 0.28, 0.17]
        : style.ornament === 'broken'
          ? [0.13, 0.18, 0.06]
          : [0.08, 0.22, 0.2]) as [number, number, number],
  }), [style.ornament])

  return (
    <group
      ref={root}
      name={`infernal-climber:${playerId}`}
      position={[0, playerCharacterRootOffsetY(scale, supportY), 0]}
      scale={scale}
    >
      <group ref={body}>
        {/* Compact heat-suit torso with a separate rescue harness and chest core. */}
        <mesh geometry={GEOMETRY.box} material={materials.suit} scale={[0.56, 0.62, 0.34]} castShadow />
        <mesh
          ref={harness}
          geometry={GEOMETRY.ring}
          material={materials.accent}
          position={[0, 0.02, 0.2]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[0.31, 0.39, 0.31]}
          castShadow
        />
        <mesh geometry={GEOMETRY.box} material={materials.accent} position={[0, -0.27, 0.19]} scale={[0.48, 0.09, 0.08]} />
        <mesh geometry={GEOMETRY.core} material={materials.core} position={[0, 0.06, 0.28]} scale={0.14} />

        {/* Helmet, broad visor, and state-dependent crest keep status readable in silhouette. */}
        <group ref={head} position={[0, 0.58, 0]}>
          <mesh geometry={GEOMETRY.sphere} material={materials.helmet} scale={[0.37, 0.31, 0.34]} castShadow />
          <mesh geometry={GEOMETRY.box} material={VISOR_MATERIAL} position={[0, 0, 0.29]} scale={[0.42, 0.14, 0.09]} />
          <mesh
            geometry={style.ornament === 'broken' ? GEOMETRY.box : GEOMETRY.cone}
            material={materials.accent}
            position={[0, 0.35, style.ornament === 'fin' ? -0.08 : 0]}
            rotation={ornament.rotation}
            scale={ornament.scale}
            castShadow
          />
        </group>

        {/* Long two-bone arms; the right glove owns the visual lifeline endpoint. */}
        <group ref={leftUpperArm} position={[-PLAYER_CHARACTER_SHOULDER_X, PLAYER_CHARACTER_SHOULDER_Y, 0]}>
          <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.105} />
          <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.22, 0]} scale={[0.09, 0.44, 0.09]} castShadow />
          <group ref={leftForearm} position={[0, -0.44, 0]}>
            <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.09} />
            <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.2, 0]} scale={[0.08, 0.4, 0.08]} castShadow />
            <mesh geometry={GEOMETRY.glove} material={materials.accent} position={[0, -0.43, 0]} scale={[0.15, 0.17, 0.14]} castShadow />
          </group>
        </group>
        <group ref={rightUpperArm} position={[PLAYER_CHARACTER_SHOULDER_X, PLAYER_CHARACTER_SHOULDER_Y, 0]}>
          <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.105} />
          <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.22, 0]} scale={[0.09, 0.44, 0.09]} castShadow />
          <group ref={rightForearm} position={[0, -0.44, 0]}>
            <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.09} />
            <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.2, 0]} scale={[0.08, 0.4, 0.08]} castShadow />
            <mesh
              ref={rightGlove}
              geometry={GEOMETRY.glove}
              material={materials.accent}
              position={[0, -0.43, 0]}
              scale={[0.15, 0.17, 0.14]}
              castShadow
            />
          </group>
        </group>

        {/* Long jointed legs and oversized heat boots finish the original rescue-runner shape. */}
        <group ref={leftThigh} position={[-0.2, -0.28, 0]}>
          <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.11} />
          <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.24, 0]} scale={[0.105, 0.48, 0.105]} castShadow />
          <group ref={leftShin} position={[0, -0.48, 0]}>
            <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.095} />
            <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.21, 0]} scale={[0.09, 0.42, 0.09]} castShadow />
            <mesh geometry={GEOMETRY.box} material={materials.accent} position={[0, -0.45, 0.07]} scale={[0.23, 0.16, 0.34]} castShadow />
          </group>
        </group>
        <group ref={rightThigh} position={[0.2, -0.28, 0]}>
          <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.11} />
          <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.24, 0]} scale={[0.105, 0.48, 0.105]} castShadow />
          <group ref={rightShin} position={[0, -0.48, 0]}>
            <mesh geometry={GEOMETRY.sphere} material={JOINT_MATERIAL} scale={0.095} />
            <mesh geometry={GEOMETRY.limb} material={materials.suit} position={[0, -0.21, 0]} scale={[0.09, 0.42, 0.09]} castShadow />
            <mesh geometry={GEOMETRY.box} material={materials.accent} position={[0, -0.45, 0.07]} scale={[0.23, 0.16, 0.34]} castShadow />
          </group>
        </group>
      </group>
      <pointLight color={style.emissive} intensity={style.emissiveIntensity * 2.2} distance={2.4} />
    </group>
  )
}
