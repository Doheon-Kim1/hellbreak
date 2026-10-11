import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
const harness = vi.hoisted(() => ({
  world: null as unknown as RAPIER.World, canvas: { dataset: {} as Record<string, string> },
  effects: [] as (() => void)[], cursor: 0, refs: [] as { current: unknown }[], frame: null as null | ((state: { clock: { elapsedTime: number } }, delta: number) => void),
}))
vi.mock('@react-three/fiber', async original => ({ ...await original<typeof import('@react-three/fiber')>(),
  useFrame: (frame: typeof harness.frame) => { harness.frame = frame },
  useThree: (select: (state: unknown) => unknown) => select({ gl: { domElement: harness.canvas } }),
}))
vi.mock('@react-three/rapier', async original => ({ ...await original<typeof import('@react-three/rapier')>(),
  useRapier: () => ({ world: harness.world }),
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => void) => { harness.effects.push(effect) }, useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => { const index = harness.cursor++; return harness.refs[index] ??= { current: value } },
}))
import { PlayerRunner } from './HellbreakGame'
import { createRunnerControlSources, setRunnerControlSource } from '../game/controls'
import { DEFAULT_GAME_SETTINGS } from '../game/settings'
import { DEFAULT_CAMERA_ORBIT } from '../game/camera'
import { playgroundGripAnchors } from '../game/grip-anchors'
import { playgroundPlatformPose, PLAYGROUND_PLATFORM_THICKNESS, PLAYGROUND_PLATFORM_DEPTH } from '../game/playground'
beforeAll(async () => { await RAPIER.init() })
it('actual PlayerRunner holds a registered ledge and launches on fresh Space', () => {
  harness.cursor = 0; harness.refs = []; harness.canvas.dataset = {}
  const world = harness.world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  try {
    const anchor = playgroundGripAnchors().find(a => a.surfaceIndex === 4 && a.normalZ === 1)!
    const platform = playgroundPlatformPose(anchor.surfaceIndex)
    world.createCollider(RAPIER.ColliderDesc.cuboid(platform.width / 2, PLAYGROUND_PLATFORM_THICKNESS / 2, PLAYGROUND_PLATFORM_DEPTH / 2)
      .setTranslation(platform.x, platform.y, platform.z))
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().lockRotations()
      .setTranslation(anchor.hangX, anchor.y - 0.9, anchor.hangZ))
    world.createCollider(RAPIER.ColliderDesc.capsule(0.42, 0.3), body)
    const sensor = world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 0.08, 0.2).setSensor(true).setTranslation(0, -0.74, 0), body)
    const controls = { input: { current: setRunnerControlSource(createRunnerControlSources(), 'rescue', 'mouse:left', true) },
      jumpQueued: { current: false }, abilityQueued: { current: false }, blocked: { current: false },
      settings: { current: { ...DEFAULT_GAME_SETTINGS } }, audio: { current: null } }
    PlayerRunner({ body: { current: body }, positionRef: { current: new Vector3() }, active: true, renderBody: true,
      freezeBody: false, escaped: false, reducedMotion: true, lavaHeight: -100, elapsed: 0, heldAbility: null,
      resetToken: 0, controls, cameraOrbit: { current: { ...DEFAULT_CAMERA_ORBIT, yaw: 0,
        pitch: Math.atan2(anchor.y - (body.translation().y + 1.05), body.translation().z - anchor.z + DEFAULT_CAMERA_ORBIT.distance) } },
      onConsumeAbility: vi.fn(), onFeedback: vi.fn(), onDeath: vi.fn(), onEscape: vi.fn() })
    harness.refs.find(ref => ref.current === null)!.current = sensor
    let time = 0
    const frame = () => { time += 1 / 60; harness.frame!({ clock: { elapsedTime: time } }, 1 / 60); world.step() }
    for (let i = 0; i < 30; i++) frame()
    expect(harness.canvas.dataset.localStructureGrip).toBe(anchor.id)
    expect(body.translation().y).toBeCloseTo(anchor.hangY, 1)
    const before = body.translation().y
    controls.jumpQueued.current = true
    for (let i = 0; i < 8; i++) frame()
    expect(body.translation().y).toBeGreaterThan(before + 0.5)
    expect(harness.canvas.dataset.localJumpAck).toBe('1')
    expect(harness.canvas.dataset.localStructureGrip).toBe('')
  } finally { world.free() }
})
it('never reads the removed Rapier body while the eliminated player is spectating', () => {
  harness.cursor = 0; harness.refs = []; harness.canvas.dataset = {}
  const world = harness.world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  try {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0))
    world.createCollider(RAPIER.ColliderDesc.capsule(0.42, 0.3), body)
    const controls = { input: { current: createRunnerControlSources() }, jumpQueued: { current: false },
      abilityQueued: { current: false }, blocked: { current: false }, settings: { current: { ...DEFAULT_GAME_SETTINGS } }, audio: { current: null } }
    const props: Parameters<typeof PlayerRunner>[0] = { body: { current: body }, positionRef: { current: new Vector3() },
      active: true, renderBody: true, freezeBody: false, escaped: false, reducedMotion: true,
      lavaHeight: -100, elapsed: 0, heldAbility: null, resetToken: 0, controls, cameraOrbit: { current: { ...DEFAULT_CAMERA_ORBIT } },
      onConsumeAbility: vi.fn(), onFeedback: vi.fn(), onDeath: vi.fn(), onEscape: vi.fn() }
    PlayerRunner(props)
    harness.frame!({ clock: { elapsedTime: 0 } }, 1 / 60)
    const read = vi.spyOn(body, 'translation')
    world.removeRigidBody(body)
    controls.blocked.current = true
    harness.cursor = 0
    harness.effects = []
    PlayerRunner({ ...props, active: false, renderBody: false })
    expect(() => harness.frame!({ clock: { elapsedTime: 1 } }, 1 / 60)).not.toThrow()
    expect(read).not.toHaveBeenCalled()
    expect(() => harness.effects.slice(-2).forEach(setup => setup())).not.toThrow()
  } finally { world.free() }
})
it('extinguisher releases a real hanging capsule before its defensive lava bounce', () => {
  harness.cursor = 0; harness.refs = []; harness.effects = []; harness.canvas.dataset = {}
  const world = harness.world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  try {
    const anchor = playgroundGripAnchors().find(a => a.surfaceIndex === 4 && a.normalZ === 1)!
    const platform = playgroundPlatformPose(anchor.surfaceIndex)
    world.createCollider(RAPIER.ColliderDesc.cuboid(platform.width / 2, PLAYGROUND_PLATFORM_THICKNESS / 2, PLAYGROUND_PLATFORM_DEPTH / 2)
      .setTranslation(platform.x, platform.y, platform.z))
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().lockRotations().setTranslation(anchor.hangX, anchor.y - 0.9, anchor.hangZ))
    world.createCollider(RAPIER.ColliderDesc.capsule(0.42, 0.3), body)
    const sensor = world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 0.08, 0.2).setSensor(true).setTranslation(0, -0.74, 0), body)
    const controls = { input: { current: setRunnerControlSource(createRunnerControlSources(), 'rescue', 'mouse:left', true) },
      jumpQueued: { current: false }, abilityQueued: { current: false }, blocked: { current: false },
      settings: { current: { ...DEFAULT_GAME_SETTINGS } }, audio: { current: null } }
    const props: Parameters<typeof PlayerRunner>[0] = { body: { current: body }, positionRef: { current: new Vector3() },
      active: true, renderBody: true, freezeBody: false, escaped: false, reducedMotion: true,
      lavaHeight: -100, elapsed: 0, heldAbility: 'extinguisher', resetToken: 0, controls,
      cameraOrbit: { current: { ...DEFAULT_CAMERA_ORBIT, yaw: 0, pitch: Math.atan2(anchor.y - (body.translation().y + 1.05), body.translation().z - anchor.z + DEFAULT_CAMERA_ORBIT.distance) } },
      onConsumeAbility: vi.fn(), onFeedback: vi.fn(), onDeath: vi.fn(), onEscape: vi.fn() }
    let time = 0
    const frame = () => {
      harness.cursor = 0
      PlayerRunner({ ...props, elapsed: time })
      harness.frame!({ clock: { elapsedTime: time } }, 1 / 60)
      world.step(); time += 1 / 60
    }
    PlayerRunner(props)
    harness.refs.find(ref => ref.current === null)!.current = sensor
    for (let i = 0; i < 30; i++) frame()
    expect(harness.canvas.dataset.localStructureGrip).toBe(anchor.id)
    expect(body.gravityScale()).toBe(0)
    const before = body.translation().y
    const gripBefore = Number(harness.canvas.dataset.localGrip)
    props.lavaHeight = before
    frame()
    expect(props.onConsumeAbility).toHaveBeenCalledOnce()
    props.heldAbility = null
    expect(body.gravityScale()).toBe(1)
    for (let i = 0; i < 8; i++) {
      frame()
      expect(harness.canvas.dataset.localStructureGrip).toBe('')
    }
    expect(body.translation().y).toBeGreaterThan(before + 0.5)
    expect(Number(harness.canvas.dataset.localGrip)).toBeLessThanOrEqual(gripBefore)
    expect(props.onConsumeAbility).toHaveBeenCalledOnce()
    expect(props.onDeath).not.toHaveBeenCalled()
  } finally { world.free() }
})
