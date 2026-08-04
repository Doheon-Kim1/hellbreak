import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Float, Text } from '@react-three/drei'
import { Physics, RigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import type { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'
import './App.css'

const PLATFORM_COUNT = 16

function Lava() {
  const lava = useRef<Mesh<PlaneGeometry, MeshStandardMaterial>>(null)
  useFrame(({ clock }) => {
    if (!lava.current) return
    lava.current.position.y = -5 + ((clock.elapsedTime * 0.22) % 4)
    lava.current.material.emissiveIntensity = 1.8 + Math.sin(clock.elapsedTime * 3) * 0.35
  })

  return (
    <mesh ref={lava} position={[0, -5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[28, 28, 32, 32]} />
      <meshStandardMaterial color="#ff3b00" emissive="#ff2100" emissiveIntensity={2} />
    </mesh>
  )
}

function RunnerBot({ index }: { index: number }) {
  const bot = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    if (!bot.current) return
    const t = clock.elapsedTime * (0.65 + index * 0.07) + index * 2
    bot.current.position.x = Math.sin(t) * 2.4
    bot.current.position.z = Math.cos(t * 0.8) * 1.8
    bot.current.position.y = 1.2 + ((clock.elapsedTime * 0.35 + index * 1.5) % 9)
  })

  return (
    <Float speed={3} rotationIntensity={0.2} floatIntensity={0.2}>
      <mesh ref={bot}>
        <capsuleGeometry args={[0.28, 0.65, 8, 16]} />
        <meshStandardMaterial color={['#7cf7ff', '#b3ff6f', '#f6a6ff'][index]} emissive="#164d62" />
      </mesh>
    </Float>
  )
}

function Tower() {
  const platforms = useMemo(
    () => Array.from({ length: PLATFORM_COUNT }, (_, index) => ({
      y: index * 0.72 - 3.2,
      x: Math.sin(index * 1.9) * 2.2,
      z: Math.cos(index * 1.4) * 1.5,
      width: index % 4 === 0 ? 3.8 : 2.5,
    })),
    [],
  )

  return (
    <>
      {platforms.map((platform, index) => (
        <RigidBody type="fixed" key={index} colliders="cuboid">
          <mesh position={[platform.x, platform.y, platform.z]}>
            <boxGeometry args={[platform.width, 0.22, 1.45]} />
            <meshStandardMaterial color={index > 11 ? '#745783' : '#3b303f'} roughness={0.72} />
          </mesh>
        </RigidBody>
      ))}
      <mesh position={[0, 8.5, 0]}>
        <torusGeometry args={[1.5, 0.28, 16, 48]} />
        <meshStandardMaterial color="#ffcc66" emissive="#ff4d00" emissiveIntensity={1.4} />
      </mesh>
      <Text position={[0, 10.5, 0]} fontSize={0.7} color="#ffd7a0" anchorX="center">
        ESCAPE
      </Text>
      {[0, 1, 2].map((index) => <RunnerBot key={index} index={index} />)}
      <Lava />
    </>
  )
}

function GamePreview() {
  return (
    <Canvas camera={{ position: [9, 7, 13], fov: 48 }} shadows>
      <color attach="background" args={['#09060d']} />
      <fog attach="fog" args={['#160911', 12, 31]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 12, 8]} intensity={2.2} color="#ffb56f" castShadow />
      <pointLight position={[0, -2, 2]} intensity={65} color="#ff2500" distance={18} />
      <Physics gravity={[0, -18, 0]}>
        <Tower />
      </Physics>
      <Environment preset="night" />
    </Canvas>
  )
}

export default function App() {
  return (
    <main className="shell">
      <section className="hud" aria-label="Game prototype information">
        <div className="eyebrow">OPENAI GAME BUILDERS SEOUL · MVP 0.1</div>
        <h1>HELL<span>BREAK</span></h1>
        <p className="tagline">RUN UP. FOOL THE WARDEN. ESCAPE HELL.</p>
        <div className="match-card">
          <div><strong>3</strong><small>RUNNER BOTS</small></div>
          <div><strong>01:48</strong><small>LAVA RISING</small></div>
          <div><strong>1 / 3</strong><small>SEALS BROKEN</small></div>
        </div>
        <p className="brief">
          A browser-first asymmetric vertical chase. Soul echoes deceive the Warden—and become
          temporary platforms when sacrificed to the lava.
        </p>
        <button type="button">BOT MATCH · COMING NEXT</button>
        <ul>
          <li><kbd>WASD</kbd> move</li>
          <li><kbd>SPACE</kbd> jump</li>
          <li><kbd>Q</kbd> soul echo</li>
        </ul>
      </section>
      <section className="viewport" aria-label="Animated 3D vertical prison preview">
        <GamePreview />
        <div className="scanline" />
        <div className="status"><i /> LOCAL PROTOTYPE ONLINE</div>
      </section>
    </main>
  )
}
