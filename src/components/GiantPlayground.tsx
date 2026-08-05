'use client'

import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import type { HellEventState } from '../game/hell-events'
import { PLAYGROUND_ROUTE } from '../game/playground'

type Vec3 = [number, number, number]

const COLORS = {
  blue: '#1976d2',
  red: '#e34343',
  yellow: '#ffc928',
  green: '#2c9b63',
  sand: '#c7a56a',
  rubber: '#252635',
  steel: '#b9c5d1',
}

function FixedBox({
  position,
  size,
  color,
  rotation = [0, 0, 0],
  roughness = 0.64,
}: {
  position: Vec3
  size: Vec3
  color: string
  rotation?: Vec3
  roughness?: number
}) {
  return (
    <RigidBody type="fixed" colliders="cuboid" position={position} rotation={rotation}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={roughness} />
      </mesh>
    </RigidBody>
  )
}

function InfernalSweep() {
  const body = useRef<RapierRigidBody>(null)
  useFrame(({ clock }) => {
    if (!body.current) return
    const time = clock.elapsedTime
    body.current.setNextKinematicTranslation({
      x: -22 + Math.sin(time * 2.8) * 5.2,
      y: -1.15,
      z: 19,
    })
  })

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders="cuboid" position={[-22, -1.15, 19]}>
      <mesh>
        <boxGeometry args={[5.4, 0.45, 0.65]} />
        <meshStandardMaterial color="#ff5b33" emissive="#ff2100" emissiveIntensity={2.4} />
      </mesh>
    </RigidBody>
  )
}

function RotatingBeam() {
  const body = useRef<RapierRigidBody>(null)
  useFrame(({ clock }) => {
    if (!body.current) return
    const angle = clock.elapsedTime * 2.4
    body.current.setNextKinematicTranslation({ x: -8, y: 0.05, z: 10 })
    body.current.setNextKinematicRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) })
  })

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders="cuboid" position={[-8, 0.05, 10]}>
      <mesh>
        <boxGeometry args={[8.5, 0.32, 0.46]} />
        <meshStandardMaterial color="#ffc928" emissive="#ff6200" emissiveIntensity={1.5} />
      </mesh>
    </RigidBody>
  )
}

function SlideFireWall({ eventProgress }: { eventProgress: number }) {
  const body = useRef<RapierRigidBody>(null)
  const startZ = -15 + eventProgress * 14
  useFrame(() => {
    if (!body.current) return
    body.current.setNextKinematicTranslation({
      x: 10.8,
      y: 3.9,
      z: startZ,
    })
  })

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders="cuboid" position={[10.8, 3.9, startZ]}>
      <mesh>
        <boxGeometry args={[7.8, 1.1, 0.55]} />
        <meshStandardMaterial color="#ff8b24" emissive="#ff2600" emissiveIntensity={3} />
      </mesh>
      <pointLight color="#ff3100" intensity={20} distance={8} />
    </RigidBody>
  )
}

function PlaygroundHazards({ elapsed, event }: { elapsed: number; event: HellEventState }) {
  const active = event.phase === 'active'
  const eventProgress = active ? Math.min(1, Math.max(0, ((elapsed % 20) - 4) / 8)) : 0
  return (
    <>
      {active && event.kind === 'swing-frenzy' && <InfernalSweep />}
      {active && event.kind === 'swing-frenzy' && <RotatingBeam />}
      {active && event.kind === 'slide-fire' && <SlideFireWall eventProgress={eventProgress} />}
    </>
  )
}

function GiantSlide() {
  const stairs = useMemo(
    () => Array.from({ length: 8 }, (_, index) => ({
      position: [7.8 + index * 0.72, -2.65 + index * 0.72, -2.5 - index * 0.72] as Vec3,
      size: [4.4, 0.45, 1.7] as Vec3,
    })),
    [],
  )

  return (
    <group>
      {stairs.map((step, index) => (
        <FixedBox key={index} position={step.position} size={step.size} color={index % 2 ? COLORS.blue : COLORS.green} />
      ))}
      <FixedBox position={[13, 3.25, -8.2]} size={[7.5, 0.55, 6]} color={COLORS.blue} />
      {[[-3.2, -2.6], [3.2, -2.6], [-3.2, 2.4], [3.2, 2.4]].map(([x, z], index) => (
        <FixedBox key={index} position={[13 + x, 0.15, -8.2 + z]} size={[0.55, 7.2, 0.55]} color={COLORS.red} />
      ))}
      <FixedBox position={[18.8, 0.5, -1.2]} size={[5.2, 0.5, 18]} color={COLORS.yellow} rotation={[-0.42, 0, 0]} roughness={0.3} />
      <FixedBox position={[16.5, 3.75, -8.2]} size={[0.35, 2.3, 6]} color={COLORS.red} />
      <FixedBox position={[9.5, 3.75, -8.2]} size={[0.35, 2.3, 6]} color={COLORS.red} />
    </group>
  )
}

function GiantSwingSet() {
  return (
    <group>
      <FixedBox position={[-23, 1.1, 0]} size={[0.65, 9, 0.65]} color={COLORS.red} rotation={[0, 0, 0.24]} />
      <FixedBox position={[-15, 1.1, 0]} size={[0.65, 9, 0.65]} color={COLORS.red} rotation={[0, 0, -0.24]} />
      <FixedBox position={[-19, 5.25, 0]} size={[10, 0.65, 0.65]} color={COLORS.blue} />
      {[-21, -17].map((x) => (
        <group key={x}>
          <FixedBox position={[x - 0.75, 1.9, 0]} size={[0.12, 6.2, 0.12]} color={COLORS.steel} />
          <FixedBox position={[x + 0.75, 1.9, 0]} size={[0.12, 6.2, 0.12]} color={COLORS.steel} />
          <FixedBox position={[x, -1.15, 0]} size={[2.4, 0.28, 1.5]} color={COLORS.yellow} />
        </group>
      ))}
    </group>
  )
}

function GiantMonkeyBars() {
  const overheadBars = useMemo(() => Array.from({ length: 9 }, (_, index) => -8 + index * 2), [])
  return (
    <group>
      <FixedBox position={[0, 5.6, -16]} size={[19, 0.5, 0.5]} color={COLORS.blue} />
      <FixedBox position={[0, 5.6, -12]} size={[19, 0.5, 0.5]} color={COLORS.blue} />
      {overheadBars.map((x) => (
        <FixedBox key={x} position={[x, 5.6, -14]} size={[0.32, 0.32, 4.4]} color={COLORS.yellow} />
      ))}
      {[-8, 8].flatMap((x) => [-16, -12].map((z) => (
        <FixedBox key={`${x}-${z}`} position={[x, 1.2, z]} size={[0.55, 9, 0.55]} color={COLORS.red} />
      )))}
    </group>
  )
}

function GiantSeesaw() {
  return (
    <group>
      <FixedBox position={[-22, -2.35, 19]} size={[15, 0.5, 2.4]} color={COLORS.green} rotation={[0, 0, 0.11]} />
      <FixedBox position={[-22, -3, 19]} size={[2.4, 1.5, 2.4]} color={COLORS.yellow} rotation={[0, 0, Math.PI / 4]} />
      <FixedBox position={[-28.4, -1.45, 19]} size={[1.4, 1.6, 2.2]} color={COLORS.red} />
      <FixedBox position={[-15.6, -2.95, 19]} size={[1.4, 1.6, 2.2]} color={COLORS.red} />
    </group>
  )
}

function Sandbox() {
  return (
    <group>
      <FixedBox position={[-3, -3.25, 10]} size={[24, 0.45, 18]} color={COLORS.sand} roughness={1} />
      <FixedBox position={[-3, -2.85, 1]} size={[25, 0.8, 1]} color={COLORS.green} />
      <FixedBox position={[-3, -2.85, 19]} size={[25, 0.8, 1]} color={COLORS.green} />
      <FixedBox position={[-15, -2.85, 10]} size={[1, 0.8, 18]} color={COLORS.green} />
      <FixedBox position={[9, -2.85, 10]} size={[1, 0.8, 18]} color={COLORS.green} />
    </group>
  )
}

function EscapeLookout() {
  return (
    <group>
      <FixedBox position={[-10, 7.2, 2]} size={[7, 0.5, 6]} color={COLORS.red} />
      {[-13, -7].flatMap((x) => [-0.5, 4.5].map((z) => (
        <FixedBox key={`${x}-${z}`} position={[x, 2, z]} size={[0.65, 10.5, 0.65]} color={COLORS.blue} />
      )))}
      <FixedBox position={[-10, 8.4, -0.7]} size={[7, 2.2, 0.35]} color={COLORS.yellow} />
      <FixedBox position={[-10, 8.4, 4.7]} size={[7, 2.2, 0.35]} color={COLORS.yellow} />
    </group>
  )
}

export function GiantPlayground({ elapsed, event }: { elapsed: number; event: HellEventState }) {
  const bridgeCollapsed = event.kind === 'bridge-collapse' && event.phase === 'active'
  return (
    <group>
      <FixedBox position={[0, -3.55, 0]} size={[90, 0.6, 90]} color={COLORS.rubber} roughness={0.94} />
      <Sandbox />
      <GiantSeesaw />
      <GiantSwingSet />
      <GiantMonkeyBars />
      <GiantSlide />
      <EscapeLookout />
      <PlaygroundHazards elapsed={elapsed} event={event} />

      {PLAYGROUND_ROUTE.map((platform, index) => {
        if (bridgeCollapsed && index >= 8 && index <= 10) return null
        return (
          <FixedBox
            key={index}
            position={[platform.x, platform.y, platform.z]}
            size={[platform.width, 0.28, 3.2]}
            color={[COLORS.blue, COLORS.red, COLORS.yellow, COLORS.green][index % 4]}
            roughness={0.58}
          />
        )
      })}

      {[-44, 44].flatMap((x) => [-44, 44].map((z) => (
        <FixedBox key={`${x}-${z}`} position={[x, 1.4, z]} size={[1.1, 10, 1.1]} color={COLORS.red} />
      )))}
    </group>
  )
}
