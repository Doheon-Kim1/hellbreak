'use client'

import { Canvas, addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, CuboidCollider, Physics, RigidBody, useRapier } from '@react-three/rapier'
import type { IntersectionEnterPayload, IntersectionExitPayload, RapierCollider, RapierRigidBody } from '@react-three/rapier'
import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { Vector3 } from 'three'
import type { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { DEFAULT_CAMERA_ORBIT, cameraOrbitOffset, rotateMovementByCamera, updateCameraOrbit } from '../game/camera'
import type { CameraOrbit } from '../game/camera'
import { createRunnerControlSources, readRunnerInput, setRunnerControlSource } from '../game/controls'
import type { RunnerControl, RunnerControlSources } from '../game/controls'
import { abilitySpec, hellEventAt, pickupAbility } from '../game/hell-events'
import type { HellEventState, RunnerAbility } from '../game/hell-events'
import { botPoseAt, cycleSpectatorIndex, movementVelocity } from '../game/movement'
import { createMatch, stepMatch } from '../game/match'
import { frameHasVisibleScene, playerPresentation, sceneCoverVisible } from '../game/player-lifecycle'
import type { FramePixelSample } from '../game/player-lifecycle'
import { GiantPlayground } from './GiantPlayground'

const PLAYER_SPEED = 5.8
const SPRINT_SPEED = 8.2
const JUMP_SPEED = 7.4
const SPAWN = { x: -26, y: -2.2, z: 22 }
const ESCAPE_HEIGHT = 7.75
const ABILITY_PICKUPS: readonly { ability: RunnerAbility; position: readonly [number, number, number] }[] = [
  { ability: 'rocket-boots', position: [-18, -0.95, 14] },
  { ability: 'spring-shoes', position: [2, 1.55, 4] },
  { ability: 'extinguisher', position: [-5, 6.05, -12] },
]
const KEY_ART_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/assets/hellbreak-key-art.webp`

type RunnerControls = {
  input: RefObject<RunnerControlSources>
  jumpQueued: RefObject<boolean>
  abilityQueued: RefObject<boolean>
}

function useRunnerControls(controls: RunnerControls) {
  useEffect(() => {
    const setKey = (code: string, pressed: boolean, repeat = false) => {
      const control: RunnerControl | null = code === 'KeyW' || code === 'ArrowUp' ? 'forward'
        : code === 'KeyS' || code === 'ArrowDown' ? 'backward'
          : code === 'KeyA' || code === 'ArrowLeft' ? 'left'
            : code === 'KeyD' || code === 'ArrowRight' ? 'right'
              : code === 'ShiftLeft' || code === 'ShiftRight' ? 'sprint'
                : null
      if (control) {
        controls.input.current = setRunnerControlSource(
          controls.input.current,
          control,
          `keyboard:${code}`,
          pressed,
        )
      }
      if (code === 'Space' && pressed && !repeat) controls.jumpQueued.current = true
      if (code === 'KeyF' && pressed && !repeat) controls.abilityQueued.current = true
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
      setKey(event.code, true, event.repeat)
    }
    const onKeyUp = (event: KeyboardEvent) => setKey(event.code, false)
    const clear = () => {
      controls.input.current = createRunnerControlSources()
      controls.jumpQueued.current = false
      controls.abilityQueued.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clear)
    }
  }, [controls])
}

function GameCamera({
  player,
  orbit,
  mode,
  elapsed,
  spectatorIndex,
  resetToken,
}: {
  player: RefObject<RapierRigidBody | null>
  orbit: RefObject<CameraOrbit>
  mode: 'player' | 'spectator'
  elapsed: number
  spectatorIndex: number
  resetToken: number
}) {
  const { camera, gl } = useThree()
  const desired = useMemo(() => new Vector3(), [])
  const lookAt = useMemo(() => new Vector3(), [])

  useEffect(() => {
    orbit.current = { ...DEFAULT_CAMERA_ORBIT }
  }, [orbit, resetToken])

  useEffect(() => {
    if (mode !== 'player') return
    const canvas = gl.domElement
    let drag: { pointerId: number; x: number; y: number } | null = null

    const endDrag = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      drag = null
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return
      event.preventDefault()
      orbit.current = updateCameraOrbit(orbit.current, {
        deltaX: event.clientX - drag.x,
        deltaY: event.clientY - drag.y,
        zoomDelta: 0,
      })
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      orbit.current = updateCameraOrbit(orbit.current, { deltaX: 0, deltaY: 0, zoomDelta: event.deltaY })
    }
    const resetOrbit = () => { orbit.current = { ...DEFAULT_CAMERA_ORBIT } }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', resetOrbit)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', resetOrbit)
    }
  }, [gl, mode, orbit])

  useFrame((_, delta) => {
    if (mode === 'spectator') {
      const pose = botPoseAt(elapsed, spectatorIndex)
      desired.set(pose.x + 5.2, pose.y + 3.3, pose.z + 6.2)
      lookAt.set(pose.x, pose.y + 0.55, pose.z)
    } else {
      const body = player.current
      if (!body) return
      const position = body.translation()
      const offset = cameraOrbitOffset(orbit.current)
      lookAt.set(position.x, position.y + 0.75, position.z)
      desired.set(lookAt.x + offset.x, lookAt.y + offset.y, lookAt.z + offset.z)
    }

    camera.position.lerp(desired, 1 - Math.exp(-delta * 7.2))
    camera.lookAt(lookAt)
  })

  return null
}

function PlayerRunner({
  body,
  active,
  renderBody,
  lavaHeight,
  elapsed,
  heldAbility,
  resetToken,
  controls,
  cameraOrbit,
  onConsumeAbility,
  onFeedback,
  onDeath,
  onEscape,
}: {
  body: RefObject<RapierRigidBody | null>
  active: boolean
  renderBody: boolean
  lavaHeight: number
  elapsed: number
  heldAbility: RunnerAbility | null
  resetToken: number
  controls: RunnerControls
  cameraOrbit: RefObject<CameraOrbit>
  onConsumeAbility: () => void
  onFeedback: (message: string) => void
  onDeath: () => void
  onEscape: () => void
}) {
  const groundContacts = useRef<Set<number>>(new Set())
  const footSensor = useRef<RapierCollider>(null)
  const { world } = useRapier()
  const deathCooldown = useRef(false)
  const rocketUntil = useRef(0)
  const springArmed = useRef(false)
  const lavaGraceUntil = useRef(0)
  useRunnerControls(controls)

  useEffect(() => {
    body.current?.setTranslation(SPAWN, true)
    body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true)
    deathCooldown.current = false
    groundContacts.current.clear()
    rocketUntil.current = 0
    springArmed.current = false
    lavaGraceUntil.current = 0
  }, [body, resetToken])

  useFrame(() => {
    const runner = body.current
    if (!runner || !active) return

    const sensor = footSensor.current
    if (sensor) {
      for (const handle of groundContacts.current) {
        const collider = world.getCollider(handle)
        if (!collider || !world.intersectionPair(sensor, collider)) groundContacts.current.delete(handle)
      }
    }

    const position = runner.translation()

    if (position.y < lavaHeight + 0.35 && elapsed >= lavaGraceUntil.current && !deathCooldown.current) {
      if (heldAbility === 'extinguisher') {
        lavaGraceUntil.current = elapsed + 1.5
        runner.setLinvel({ x: 0, y: JUMP_SPEED * 1.45, z: 0 }, true)
        onConsumeAbility()
        onFeedback('소화기 방어 · 용암에서 튕겨 올랐습니다')
      } else {
        deathCooldown.current = true
        runner.setLinvel({ x: 0, y: 0, z: 0 }, true)
        onDeath()
      }
      return
    }

    if (position.y > ESCAPE_HEIGHT) onEscape()

    if (controls.abilityQueued.current) {
      if (heldAbility === 'rocket-boots') {
        rocketUntil.current = elapsed + abilitySpec(heldAbility).durationSeconds
        onConsumeAbility()
        onFeedback('로켓 운동화 발동 · 5초 가속')
      } else if (heldAbility === 'spring-shoes') {
        springArmed.current = true
        onConsumeAbility()
        onFeedback('스프링 장전 · 다음 점프 강화')
      } else if (heldAbility === 'extinguisher') {
        onFeedback('소화기는 용암 접촉 시 자동으로 작동합니다')
      } else {
        onFeedback('능력 아이템을 먼저 획득하세요')
      }
      controls.abilityQueued.current = false
    }

    const input = readRunnerInput(controls.input.current)
    const baseSpeed = input.sprint ? SPRINT_SPEED : PLAYER_SPEED
    const speedMultiplier = elapsed < rocketUntil.current ? abilitySpec('rocket-boots').speedMultiplier : 1
    const localVelocity = movementVelocity(input, baseSpeed * speedMultiplier)
    const velocity = rotateMovementByCamera(localVelocity, cameraOrbit.current.yaw)
    const current = runner.linvel()
    runner.setLinvel({ x: velocity.x, y: current.y, z: velocity.z }, true)

    if (controls.jumpQueued.current) {
      if (groundContacts.current.size > 0) {
        const jumpMultiplier = springArmed.current ? abilitySpec('spring-shoes').jumpMultiplier : 1
        runner.setLinvel({ x: velocity.x, y: JUMP_SPEED * jumpMultiplier, z: velocity.z }, true)
        if (springArmed.current) {
          springArmed.current = false
          onFeedback('스프링 점프!')
        }
        groundContacts.current.clear()
      }
      controls.jumpQueued.current = false
    }
  })

  if (!renderBody) return null

  return (
    <RigidBody
      ref={body}
      position={[SPAWN.x, SPAWN.y, SPAWN.z]}
      colliders={false}
      enabledRotations={[false, false, false]}
      linearDamping={0.9}
      canSleep={false}
    >
      <CapsuleCollider args={[0.42, 0.3]} />
      <CuboidCollider
        ref={footSensor}
        args={[0.2, 0.08, 0.2]}
        position={[0, -0.74, 0]}
        sensor
        onIntersectionEnter={({ other }: IntersectionEnterPayload) => { groundContacts.current.add(other.collider.handle) }}
        onIntersectionExit={({ other }: IntersectionExitPayload) => { groundContacts.current.delete(other.collider.handle) }}
      />
      <mesh castShadow>
        <capsuleGeometry args={[0.3, 0.84, 8, 16]} />
        <meshStandardMaterial color="#f8f3ff" emissive="#5527a8" emissiveIntensity={0.55} />
      </mesh>
      <pointLight color="#b87cff" intensity={4} distance={3} />
    </RigidBody>
  )
}

function Lava({ height }: { height: number }) {
  const lava = useRef<Mesh<PlaneGeometry, MeshStandardMaterial>>(null)
  useFrame(({ clock }) => {
    if (!lava.current) return
    lava.current.material.emissiveIntensity = 1.8 + Math.sin(clock.elapsedTime * 3) * 0.35
  })

  return (
    <mesh ref={lava} position={[0, height, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[140, 140, 32, 32]} />
      <meshStandardMaterial color="#ff3b00" emissive="#ff2100" emissiveIntensity={2} />
    </mesh>
  )
}

function RunnerBot({ elapsed, index }: { elapsed: number; index: number }) {
  const bot = useRef<Mesh>(null)
  const pose = botPoseAt(elapsed, index)

  useFrame(() => {
    if (!bot.current) return
    const next = botPoseAt(elapsed, index)
    bot.current.position.set(next.x, next.y, next.z)
    bot.current.rotation.y += 0.025 + index * 0.004
  })

  return (
    <mesh ref={bot} position={[pose.x, pose.y, pose.z]} castShadow>
      <capsuleGeometry args={[0.25, 0.6, 8, 16]} />
      <meshStandardMaterial
        color={['#7cf7ff', '#b3ff6f', '#f6a6ff'][index]}
        emissive={pose.escaped ? '#ff9b36' : '#164d62'}
        emissiveIntensity={pose.escaped ? 1.5 : 0.45}
      />
    </mesh>
  )
}

function AbilityPickup({ ability, position }: { ability: RunnerAbility; position: readonly [number, number, number] }) {
  const mesh = useRef<Mesh>(null)
  const spec = abilitySpec(ability)
  useFrame(({ clock }) => {
    if (!mesh.current) return
    mesh.current.rotation.y = clock.elapsedTime * 1.8
    mesh.current.position.y = position[1] + Math.sin(clock.elapsedTime * 3 + position[0]) * 0.18
  })
  return (
    <mesh ref={mesh} position={[position[0], position[1], position[2]]}>
      <octahedronGeometry args={[0.55, 0]} />
      <meshStandardMaterial color={spec.color} emissive={spec.color} emissiveIntensity={2.2} />
      <pointLight color={spec.color} intensity={5} distance={3.5} />
    </mesh>
  )
}

function AbilityPickups({
  player,
  active,
  resetToken,
  onPickup,
}: {
  player: RefObject<RapierRigidBody | null>
  active: boolean
  resetToken: number
  onPickup: (ability: RunnerAbility) => void
}) {
  const [collected, setCollected] = useState<ReadonlySet<RunnerAbility>>(() => new Set())
  const collectedRef = useRef<ReadonlySet<RunnerAbility>>(collected)
  collectedRef.current = collected

  useEffect(() => {
    const empty = new Set<RunnerAbility>()
    collectedRef.current = empty
    setCollected(empty)
  }, [resetToken])

  useFrame(() => {
    const position = player.current?.translation()
    if (!active || !position) return
    for (const pickup of ABILITY_PICKUPS) {
      if (collectedRef.current.has(pickup.ability)) continue
      const [x, y, z] = pickup.position
      if ((position.x - x) ** 2 + (position.y - y) ** 2 + (position.z - z) ** 2 > 2.25) continue
      const next = new Set(collectedRef.current)
      next.add(pickup.ability)
      collectedRef.current = next
      setCollected(next)
      onPickup(pickup.ability)
      break
    }
  })

  return ABILITY_PICKUPS.map((pickup) => collected.has(pickup.ability)
    ? null
    : <AbilityPickup key={pickup.ability} ability={pickup.ability} position={pickup.position} />)
}

function Tower({
  elapsed,
  lavaHeight,
  event,
  active,
  playerEscaped,
  heldAbility,
  resetToken,
  controls,
  spectating,
  spectatorIndex,
  onPickupAbility,
  onConsumeAbility,
  onFeedback,
  onDeath,
  onEscape,
}: {
  elapsed: number
  lavaHeight: number
  event: HellEventState
  active: boolean
  playerEscaped: boolean
  heldAbility: RunnerAbility | null
  resetToken: number
  controls: RunnerControls
  spectating: boolean
  spectatorIndex: number
  onPickupAbility: (ability: RunnerAbility) => void
  onConsumeAbility: () => void
  onFeedback: (message: string) => void
  onDeath: () => void
  onEscape: () => void
}) {
  const playerBody = useRef<RapierRigidBody>(null)
  const cameraOrbit = useRef<CameraOrbit>({ ...DEFAULT_CAMERA_ORBIT })
  const presentation = playerPresentation({ spectating, escaped: playerEscaped })
  return (
    <>
      <GiantPlayground elapsed={elapsed} event={event} />
      <mesh position={[-10, 8.7, 2]}>
        <torusGeometry args={[1.5, 0.28, 16, 48]} />
        <meshStandardMaterial color="#ffcc66" emissive="#ff4d00" emissiveIntensity={1.4} />
      </mesh>
      {[0, 1, 2].map((index) => <RunnerBot key={index} elapsed={elapsed} index={index} />)}
      <GameCamera
        player={playerBody}
        orbit={cameraOrbit}
        mode={presentation.cameraMode}
        elapsed={elapsed}
        spectatorIndex={spectatorIndex}
        resetToken={resetToken}
      />
      <AbilityPickups
        player={playerBody}
        active={active}
        resetToken={resetToken}
        onPickup={onPickupAbility}
      />
      <PlayerRunner
        body={playerBody}
        active={active}
        renderBody={presentation.renderBody}
        lavaHeight={lavaHeight}
        elapsed={elapsed}
        heldAbility={heldAbility}
        resetToken={resetToken}
        controls={controls}
        cameraOrbit={cameraOrbit}
        onConsumeAbility={onConsumeAbility}
        onFeedback={onFeedback}
        onDeath={onDeath}
        onEscape={onEscape}
      />
      <Lava height={lavaHeight} />
    </>
  )
}

class SceneErrorBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError('3D 엔진 초기화에 실패했습니다.')
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function SceneHealth({
  onReady,
  onFailure,
}: {
  onReady: () => void
  onFailure: (message: string) => void
}) {
  const renderer = useThree((state) => state.gl)
  const readyCallback = useRef(onReady)
  const failureCallback = useRef(onFailure)
  readyCallback.current = onReady
  failureCallback.current = onFailure

  useEffect(() => {
    const canvas = renderer.domElement
    const context = renderer.getContext()
    const pixel = new Uint8Array(4)
    let observedFrames = 0
    let readyReported = false
    let failed = false

    const fail = (message: string) => {
      if (failed) return
      failed = true
      failureCallback.current(message)
    }
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      fail('WebGL 연결이 끊어졌습니다. 페이지를 다시 불러와 주세요.')
    }

    canvas.addEventListener('webglcontextlost', handleContextLost)
    // R3F runs after-effects after renderer.render(), so sparse readback verifies visible output rather than mere component mount.
    const unsubscribe = addAfterEffect(() => {
      if (failed || readyReported) return
      if (context.isContextLost()) {
        fail('WebGL 연결이 끊어졌습니다. 페이지를 다시 불러와 주세요.')
        return
      }

      const { width, height } = canvas
      if (width < 2 || height < 2) return
      observedFrames += 1
      if (observedFrames % 4 !== 0) return

      const samples: FramePixelSample[] = []
      try {
        for (const vertical of [0.15, 0.35, 0.55, 0.75, 0.9]) {
          for (const horizontal of [0.12, 0.3, 0.5, 0.7, 0.88]) {
            context.readPixels(
              Math.min(width - 1, Math.floor(width * horizontal)),
              Math.min(height - 1, Math.floor(height * vertical)),
              1,
              1,
              context.RGBA,
              context.UNSIGNED_BYTE,
              pixel,
            )
            samples.push([pixel[0], pixel[1], pixel[2]])
          }
        }
      } catch {
        fail('3D 화면의 출력 상태를 확인할 수 없습니다.')
        return
      }

      if (frameHasVisibleScene(samples)) {
        readyReported = true
        readyCallback.current()
      } else if (observedFrames >= 120) {
        fail('3D 장면이 검은 화면으로 감지됐습니다.')
      }
    })

    return () => {
      failed = true
      unsubscribe()
      canvas.removeEventListener('webglcontextlost', handleContextLost)
    }
  }, [renderer])

  return null
}

function GameScene({
  onReady,
  onFailure,
  ...props
}: Parameters<typeof Tower>[0] & { onReady: () => void; onFailure: (message: string) => void }) {
  return (
    <Canvas
      camera={{ position: [7, 3, 8], fov: 48 }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#09060d']} />
      <fog attach="fog" args={['#160911', 35, 105]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[18, 34, 20]} intensity={2.2} color="#ffb56f" />
      <pointLight position={[0, -1, 2]} intensity={100} color="#ff2500" distance={55} />
      <Physics gravity={[0, -18, 0]}>
        <SceneHealth onReady={onReady} onFailure={onFailure} />
        <Tower {...props} />
      </Physics>
    </Canvas>
  )
}

function MobileControls({ controls, heldAbility }: { controls: RunnerControls; heldAbility: RunnerAbility | null }) {
  const holdProps = (control: RunnerControl) => {
    const setPointer = (event: ReactPointerEvent<HTMLButtonElement>, pressed: boolean) => {
      controls.input.current = setRunnerControlSource(
        controls.input.current,
        control,
        `pointer:${event.pointerId}`,
        pressed,
      )
    }

    return {
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setPointer(event, true)
      },
      onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => setPointer(event, false),
      onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => setPointer(event, false),
      onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => setPointer(event, false),
    }
  }

  return (
    <div className="mobile-controls" aria-label="모바일 게임 조작">
      <div className="mobile-dpad">
        <button type="button" aria-label="앞으로 이동" className="up" {...holdProps('forward')}>▲</button>
        <button type="button" aria-label="왼쪽 이동" className="left" {...holdProps('left')}>◀</button>
        <button type="button" aria-label="뒤로 이동" className="down" {...holdProps('backward')}>▼</button>
        <button type="button" aria-label="오른쪽 이동" className="right" {...holdProps('right')}>▶</button>
      </div>
      <div className="mobile-actions">
        <button
          type="button"
          aria-label="능력 사용"
          className="ability"
          onPointerDown={(event) => {
            event.preventDefault()
            controls.abilityQueued.current = true
          }}
        >
          {heldAbility ? abilitySpec(heldAbility).label : '능력'}
        </button>
        <button type="button" aria-label="달리기" {...holdProps('sprint')}>달리기</button>
        <button
          type="button"
          aria-label="점프"
          className="jump"
          onPointerDown={(event) => {
            event.preventDefault()
            controls.jumpQueued.current = true
          }}
        >
          점프
        </button>
      </div>
    </div>
  )
}

function formatTime(seconds: number) {
  const remaining = Math.max(0, Math.ceil(180 - seconds))
  const minutes = Math.floor(remaining / 60)
  return `${String(minutes).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
}

export default function HellbreakGame() {
  const [started, setStarted] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneError, setSceneError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [deaths, setDeaths] = useState(0)
  const [playerEscaped, setPlayerEscaped] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const [spectating, setSpectating] = useState(false)
  const [spectatorIndex, setSpectatorIndex] = useState(0)
  const [heldAbility, setHeldAbility] = useState<RunnerAbility | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const input = useRef<RunnerControlSources>(createRunnerControlSources())
  const jumpQueued = useRef(false)
  const abilityQueued = useRef(false)
  const controls = useMemo<RunnerControls>(() => ({ input, jumpQueued, abilityQueued }), [])

  const escapedBots = [0, 1, 2].filter((index) => botPoseAt(elapsed, index).escaped).length
  const rawMatch = createMatch({ escapedRunners: escapedBots + Number(playerEscaped) })
  const match = stepMatch(rawMatch, elapsed)
  const hellEvent = hellEventAt(elapsed)
  const finished = started && match.phase === 'finished'
  const winnerLabel = match.winner === 'runners' ? '도망자' : '지옥 간수'

  useEffect(() => {
    if (!started || !sceneReady || sceneError || finished) return
    const timer = window.setInterval(() => setElapsed((value) => Math.min(180, value + 0.1)), 100)
    return () => window.clearInterval(timer)
  }, [started, sceneReady, sceneError, finished])

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  useEffect(() => {
    if (!started || sceneReady || sceneError) return
    const timeout = window.setTimeout(
      () => setSceneError('3D 엔진이 응답하지 않습니다. 페이지를 다시 불러와 주세요.'),
      8000,
    )
    return () => window.clearTimeout(timeout)
  }, [started, sceneReady, sceneError])

  useEffect(() => {
    if (!spectating) return
    const switchRunner = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.code === 'KeyQ') {
        setSpectatorIndex((current: number) => cycleSpectatorIndex(current, -1, 3))
      }
      if (event.code === 'KeyE') {
        setSpectatorIndex((current: number) => cycleSpectatorIndex(current, 1, 3))
      }
    }
    window.addEventListener('keydown', switchRunner)
    return () => window.removeEventListener('keydown', switchRunner)
  }, [spectating])

  const startMatch = () => {
    controls.input.current = createRunnerControlSources()
    controls.jumpQueued.current = false
    controls.abilityQueued.current = false
    setHeldAbility(null)
    setFeedback(null)
    setElapsed(0)
    setDeaths(0)
    setPlayerEscaped(false)
    setSpectating(false)
    setSpectatorIndex(0)
    setResetToken((value) => value + 1)
    setStarted(true)
  }

  const handleSceneFailure = (message: string) => {
    setSceneReady(false)
    setSceneError(message)
  }

  const dangerStatus = feedback
    ?? (hellEvent.phase === 'warning'
      ? `${hellEvent.label} ${Math.ceil(hellEvent.secondsRemaining)}초 전`
      : hellEvent.phase === 'active'
        ? `지옥 간수 발동 · ${hellEvent.label}!`
        : match.lavaPhase === 'warning'
          ? `용암 폭발 경고 · ${Math.ceil(Math.max(0, 27 - (elapsed % 30)))}초`
          : match.lavaPhase === 'surge'
            ? '용암 폭발 상승! 더 높은 곳으로 이동하세요'
            : null)

  const status = !started
    ? '봇 경기를 시작하세요'
    : sceneError
      ? '3D 화면 오류 · 다시 불러오기가 필요합니다'
      : !sceneReady
        ? '3D 무대 준비 중…'
        : finished
      ? `${winnerLabel} 승리 · 다시 경기를 시작하세요`
      : spectating
        ? `도망자 ${spectatorIndex + 1} 관전 중 · Q/E로 변경`
        : playerEscaped
        ? '지옥 탈출 성공'
        : dangerStatus ?? '거대한 놀이터를 건너 탈출대로 올라가세요'

  return (
    <main className={`shell${started && !finished ? ' playing' : ''}`}>
      <section className="hud" aria-label="게임 정보와 조작법">
        <div className="eyebrow">OPENAI GAME BUILDERS SEOUL · 플레이 가능한 MVP 0.3</div>
        <h1>HELL<span>BREAK</span></h1>
        <p className="tagline">올라가라. 간수를 속여라. 지옥을 탈출하라.</p>
        <div className="match-card">
          <div><strong>{3 - escapedBots}</strong><small>등반 중인 봇</small></div>
          <div><strong>{formatTime(elapsed)}</strong><small>남은 시간</small></div>
          <div><strong>{deaths}</strong><small>용암 사망</small></div>
        </div>
        <p className="brief">
          거대한 미끄럼틀, 정글짐, 폭주 그네와 붕괴 구름다리를 건너 최상단 탈출구에 도착하세요.
          30초마다 용암 파동이 솟구치며, 빛나는 능력 아이템은 한 번에 하나만 보유할 수 있습니다.
        </p>
        <button type="button" className={started && !finished ? 'active-match' : ''} onClick={startMatch}>
          {!started ? '봇 경기 시작' : finished ? '다시 경기' : '경기 재시작'}
        </button>
        <ul>
          <li><kbd>WASD</kbd> 이동</li>
          <li><kbd>SPACE</kbd> 점프</li>
          <li><kbd>SHIFT</kbd> 달리기</li>
          <li><kbd>F</kbd> 획득한 능력 사용</li>
          <li><kbd>DRAG</kbd> 시점 회전 · 휠 거리 조절</li>
          <li><kbd>Q / E</kbd> 사망 후 관전 대상 변경</li>
        </ul>
      </section>
      <section className="viewport" aria-label="플레이 가능한 거대 놀이터 3D 봇 경기">
        {!sceneError && (
          <SceneErrorBoundary onError={handleSceneFailure}>
            <GameScene
              elapsed={elapsed}
              lavaHeight={match.lavaHeight}
              event={hellEvent}
              active={started && sceneReady && !finished && !playerEscaped && !spectating}
              playerEscaped={playerEscaped}
              heldAbility={heldAbility}
              resetToken={resetToken}
              controls={controls}
              spectating={spectating}
              spectatorIndex={spectatorIndex}
              onPickupAbility={(ability) => {
                setHeldAbility((current: RunnerAbility | null) => pickupAbility(current, ability))
                setFeedback(`${abilitySpec(ability).label} 획득`)
              }}
              onConsumeAbility={() => setHeldAbility(null)}
              onFeedback={setFeedback}
              onDeath={() => {
                setDeaths((value: number) => value + 1)
                setSpectating(true)
              }}
              onEscape={() => setPlayerEscaped(true)}
              onReady={() => {
                setSceneReady(true)
                setSceneError(null)
              }}
              onFailure={handleSceneFailure}
            />
          </SceneErrorBoundary>
        )}
        {sceneCoverVisible(started, sceneReady) && (
          <div
            className="key-art"
            style={{ backgroundImage: `url(${KEY_ART_URL})` }}
            role="img"
            aria-label="거대한 지옥 놀이터와 상승하는 용암을 피해 달리는 도망자 키아트"
          />
        )}
        {sceneError && (
          <div className="scene-error" role="alert">
            <strong>3D 화면을 시작하지 못했습니다</strong>
            <p>{sceneError}</p>
            <button type="button" onClick={() => window.location.reload()}>다시 불러오기</button>
          </div>
        )}
        <div className="scanline" />
        <div className="game-banner">{status}</div>
        {started && sceneReady && !finished && (
          <div className={`danger-chip ${hellEvent.phase}`}>
            간수 · {hellEvent.label} · {hellEvent.phase === 'warning' ? `${Math.ceil(hellEvent.secondsRemaining)}초 전` : hellEvent.phase === 'active' ? '발동' : '재정비'}
          </div>
        )}
        {started && sceneReady && !finished && (
          <div className={`lava-chip ${match.lavaPhase}`}>
            용암 · {match.lavaPhase === 'calm' ? '상승 중' : match.lavaPhase === 'warning' ? '폭발 임박' : '폭발 상승'}
          </div>
        )}
        {heldAbility && started && sceneReady && !finished && (
          <div className="ability-chip" style={{ borderColor: abilitySpec(heldAbility).color }}>
            F · {abilitySpec(heldAbility).label}
          </div>
        )}
        {started && sceneReady && !finished && !playerEscaped && !spectating && (
          <div className="camera-hint">화면 드래그 · 시점 회전</div>
        )}
        {spectating && !finished && (
          <div className="spectator-controls" aria-label="관전 대상 변경">
            <button type="button" onClick={() => setSpectatorIndex((current: number) => cycleSpectatorIndex(current, -1, 3))}>
              Q · 이전
            </button>
            <strong>도망자 {spectatorIndex + 1}</strong>
            <button type="button" onClick={() => setSpectatorIndex((current: number) => cycleSpectatorIndex(current, 1, 3))}>
              E · 다음
            </button>
          </div>
        )}
        {started && sceneReady && !finished && !playerEscaped && !spectating && (
          <MobileControls controls={controls} heldAbility={heldAbility} />
        )}
        <div className="status"><i /> NEXT.JS 로컬 게임 실행 중</div>
      </section>
    </main>
  )
}
