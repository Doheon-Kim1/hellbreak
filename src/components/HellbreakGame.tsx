'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Text } from '@react-three/drei'
import { CapsuleCollider, Physics, RigidBody } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import type { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import { botPoseAt, cycleSpectatorIndex, movementVelocity, platformPose } from '../game/movement'
import { createMatch, stepMatch } from '../game/match'
import { playerPresentation } from '../game/player-lifecycle'

const PLATFORM_COUNT = 17
const PLAYER_SPEED = 5.8
const JUMP_SPEED = 7.4
const SPAWN = { x: 0, y: -2.2, z: 0 }

type KeyState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

function useRunnerControls() {
  const keys = useRef<KeyState>({ forward: false, backward: false, left: false, right: false })
  const jumpQueued = useRef(false)

  useEffect(() => {
    const setKey = (code: string, pressed: boolean, repeat = false) => {
      if (code === 'KeyW' || code === 'ArrowUp') keys.current.forward = pressed
      if (code === 'KeyS' || code === 'ArrowDown') keys.current.backward = pressed
      if (code === 'KeyA' || code === 'ArrowLeft') keys.current.left = pressed
      if (code === 'KeyD' || code === 'ArrowRight') keys.current.right = pressed
      if (code === 'Space' && pressed && !repeat) jumpQueued.current = true
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
      setKey(event.code, true, event.repeat)
    }
    const onKeyUp = (event: KeyboardEvent) => setKey(event.code, false)
    const clear = () => {
      keys.current = { forward: false, backward: false, left: false, right: false }
      jumpQueued.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return { keys, jumpQueued }
}

function GameCamera({
  player,
  mode,
  elapsed,
  spectatorIndex,
}: {
  player: React.RefObject<RapierRigidBody | null>
  mode: 'player' | 'spectator'
  elapsed: number
  spectatorIndex: number
}) {
  const { camera } = useThree()
  const desired = useMemo(() => new Vector3(), [])
  const lookAt = useMemo(() => new Vector3(), [])

  useFrame((_, delta) => {
    if (mode === 'spectator') {
      const pose = botPoseAt(elapsed, spectatorIndex)
      desired.set(pose.x + 5.2, pose.y + 3.3, pose.z + 6.2)
      lookAt.set(pose.x, pose.y + 0.55, pose.z)
    } else {
      const body = player.current
      if (!body) return
      const position = body.translation()
      desired.set(position.x + 6.8, position.y + 4.2, position.z + 7.6)
      lookAt.set(position.x, position.y + 0.75, position.z)
    }

    camera.position.lerp(desired, 1 - Math.exp(-delta * 4.8))
    camera.lookAt(lookAt)
  })

  return null
}

function PlayerRunner({
  body,
  active,
  renderBody,
  lavaHeight,
  resetToken,
  onDeath,
  onEscape,
}: {
  body: React.RefObject<RapierRigidBody | null>
  active: boolean
  renderBody: boolean
  lavaHeight: number
  resetToken: number
  onDeath: () => void
  onEscape: () => void
}) {
  const grounded = useRef(false)
  const deathCooldown = useRef(false)
  const { keys, jumpQueued } = useRunnerControls()

  useEffect(() => {
    body.current?.setTranslation(SPAWN, true)
    body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true)
    deathCooldown.current = false
  }, [body, resetToken])

  useFrame(() => {
    const runner = body.current
    if (!runner || !active) return
    const position = runner.translation()

    if (position.y < lavaHeight + 0.35 && !deathCooldown.current) {
      deathCooldown.current = true
      runner.setLinvel({ x: 0, y: 0, z: 0 }, true)
      onDeath()
      return
    }

    if (position.y > 8.65) onEscape()

    const velocity = movementVelocity(keys.current, PLAYER_SPEED)
    const current = runner.linvel()
    runner.setLinvel({ x: velocity.x, y: current.y, z: velocity.z }, true)

    if (jumpQueued.current) {
      if (grounded.current) {
        runner.setLinvel({ x: velocity.x, y: JUMP_SPEED, z: velocity.z }, true)
        grounded.current = false
      }
      jumpQueued.current = false
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
      onCollisionEnter={() => { grounded.current = true }}
      onCollisionExit={() => { grounded.current = false }}
    >
      <CapsuleCollider args={[0.42, 0.3]} />
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
      <planeGeometry args={[30, 30, 32, 32]} />
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

function Tower({ elapsed, lavaHeight, active, playerEscaped, resetToken, spectating, spectatorIndex, onDeath, onEscape }: {
  elapsed: number
  lavaHeight: number
  active: boolean
  playerEscaped: boolean
  resetToken: number
  spectating: boolean
  spectatorIndex: number
  onDeath: () => void
  onEscape: () => void
}) {
  const playerBody = useRef<RapierRigidBody>(null)
  const presentation = playerPresentation({ spectating, escaped: playerEscaped })
  const platforms = useMemo(
    () => Array.from({ length: PLATFORM_COUNT }, (_, index) => platformPose(index)),
    [],
  )

  return (
    <>
      {platforms.map((platform, index) => (
        <RigidBody type="fixed" key={index} colliders="cuboid" position={[platform.x, platform.y, platform.z]}>
          <mesh receiveShadow>
            <boxGeometry args={[platform.width, 0.24, 1.65]} />
            <meshStandardMaterial color={index > 12 ? '#745783' : '#3b303f'} roughness={0.72} />
          </mesh>
        </RigidBody>
      ))}
      <mesh position={[0, 8.8, 0]}>
        <torusGeometry args={[1.5, 0.28, 16, 48]} />
        <meshStandardMaterial color="#ffcc66" emissive="#ff4d00" emissiveIntensity={1.4} />
      </mesh>
      <Text position={[0, 10.25, 0]} fontSize={0.7} color="#ffd7a0" anchorX="center">
        탈출구
      </Text>
      {[0, 1, 2].map((index) => <RunnerBot key={index} elapsed={elapsed} index={index} />)}
      <GameCamera
        player={playerBody}
        mode={presentation.cameraMode}
        elapsed={elapsed}
        spectatorIndex={spectatorIndex}
      />
      <PlayerRunner
        body={playerBody}
        active={active}
        renderBody={presentation.renderBody}
        lavaHeight={lavaHeight}
        resetToken={resetToken}
        onDeath={onDeath}
        onEscape={onEscape}
      />
      <Lava height={lavaHeight} />
    </>
  )
}

function GameScene(props: Parameters<typeof Tower>[0]) {
  return (
    <Canvas camera={{ position: [7, 3, 8], fov: 48 }} shadows>
      <color attach="background" args={['#09060d']} />
      <fog attach="fog" args={['#160911', 12, 31]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 12, 8]} intensity={2.2} color="#ffb56f" castShadow />
      <pointLight position={[0, -2, 2]} intensity={65} color="#ff2500" distance={18} />
      <Physics gravity={[0, -18, 0]}>
        <Tower {...props} />
      </Physics>
      <Environment preset="night" />
    </Canvas>
  )
}

function formatTime(seconds: number) {
  const remaining = Math.max(0, Math.ceil(180 - seconds))
  const minutes = Math.floor(remaining / 60)
  return `${String(minutes).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
}

export default function HellbreakGame() {
  const [started, setStarted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [deaths, setDeaths] = useState(0)
  const [playerEscaped, setPlayerEscaped] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const [spectating, setSpectating] = useState(false)
  const [spectatorIndex, setSpectatorIndex] = useState(0)

  const escapedBots = [0, 1, 2].filter((index) => botPoseAt(elapsed, index).escaped).length
  const rawMatch = createMatch({ escapedRunners: escapedBots + Number(playerEscaped) })
  const match = stepMatch(rawMatch, elapsed)
  const finished = started && match.phase === 'finished'
  const winnerLabel = match.winner === 'runners' ? '도망자' : '지옥 간수'

  useEffect(() => {
    if (!started || finished) return
    const timer = window.setInterval(() => setElapsed((value) => Math.min(180, value + 0.1)), 100)
    return () => window.clearInterval(timer)
  }, [started, finished])

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
    setElapsed(0)
    setDeaths(0)
    setPlayerEscaped(false)
    setSpectating(false)
    setSpectatorIndex(0)
    setResetToken((value) => value + 1)
    setStarted(true)
  }

  const status = !started
    ? '봇 경기를 시작하세요'
    : finished
      ? `${winnerLabel} 승리 · 다시 경기를 시작하세요`
      : spectating
        ? `도망자 ${spectatorIndex + 1} 관전 중 · Q/E로 변경`
        : playerEscaped
        ? '지옥 탈출 성공'
        : '용암을 피해 위로 올라가세요'

  return (
    <main className="shell">
      <section className="hud" aria-label="게임 정보와 조작법">
        <div className="eyebrow">OPENAI GAME BUILDERS SEOUL · 플레이 가능한 MVP 0.2</div>
        <h1>HELL<span>BREAK</span></h1>
        <p className="tagline">올라가라. 간수를 속여라. 지옥을 탈출하라.</p>
        <div className="match-card">
          <div><strong>{3 - escapedBots}</strong><small>등반 중인 봇</small></div>
          <div><strong>{formatTime(elapsed)}</strong><small>남은 시간</small></div>
          <div><strong>{deaths}</strong><small>용암 사망</small></div>
        </div>
        <p className="brief">
          상승하는 용암을 피해 발판을 올라 탈출구에 도착하세요. 용암에 빠져 죽으면 경기는
          관전 모드로 계속되며, Q와 E로 살아 있는 도망자를 바꿔 볼 수 있습니다.
        </p>
        <button type="button" className={started && !finished ? 'active-match' : ''} onClick={startMatch}>
          {!started ? '봇 경기 시작' : finished ? '다시 경기' : '경기 재시작'}
        </button>
        <ul>
          <li><kbd>WASD</kbd> 이동</li>
          <li><kbd>SPACE</kbd> 점프</li>
          <li><kbd>Q / E</kbd> 사망 후 관전 대상 변경</li>
        </ul>
      </section>
      <section className="viewport" aria-label="플레이 가능한 3D 수직 감옥 봇 경기">
        <GameScene
          elapsed={elapsed}
          lavaHeight={match.lavaHeight}
          active={started && !finished && !playerEscaped && !spectating}
          playerEscaped={playerEscaped}
          resetToken={resetToken}
          spectating={spectating}
          spectatorIndex={spectatorIndex}
          onDeath={() => {
            setDeaths((value: number) => value + 1)
            setSpectating(true)
          }}
          onEscape={() => setPlayerEscaped(true)}
        />
        <div className="scanline" />
        <div className="game-banner">{status}</div>
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
        <div className="status"><i /> NEXT.JS 로컬 게임 실행 중</div>
      </section>
    </main>
  )
}
