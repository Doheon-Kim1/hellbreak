import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
const harness = vi.hoisted(() => ({
  frame: null as null | ((state: unknown, delta: number) => void),
  camera: null as unknown as PerspectiveCamera,
}))
vi.mock('@react-three/fiber', async original => ({
  ...await original<typeof import('@react-three/fiber')>(),
  useFrame: (frame: typeof harness.frame) => { harness.frame = frame },
  useThree: () => ({ camera: harness.camera, gl: { domElement: {} } }),
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useMemo: (factory: () => unknown) => factory(), useEffect: () => undefined,
}))
import { GameCamera } from './HellbreakGame'
import { DEFAULT_CAMERA_ORBIT, cameraAimDirection, cameraAimOrigin } from '../game/camera'

describe('actual gameplay camera view origin', () => {
  it('keeps the rendered camera on the authoritative boom during turn and player motion', () => {
    const camera = harness.camera = new PerspectiveCamera(55, 16 / 9, 0.1, 200)
    camera.position.set(20, 15, 20)
    const orbit = { current: { ...DEFAULT_CAMERA_ORBIT } }
    const target = { current: new Vector3(-26, -2.34, 22) }
    GameCamera({ mode: 'network', active: true, playerPosition: null, networkTarget: target,
      orbit, controls: { blocked: { current: false } } as Parameters<typeof GameCamera>[0]['controls'],
      elapsed: 0, spectatorIndex: 0, resetToken: 0 })
    for (const turn of [0, 0.5, -0.3]) {
      orbit.current.yaw += turn
      orbit.current.pitch = 0.2
      target.current.x += 0.2
      harness.frame!({}, 1 / 60)
      const expected = cameraAimOrigin(target.current, orbit.current, new Vector3())
      expect(camera.position.distanceTo(expected)).toBeLessThan(1e-10)
      camera.updateMatrixWorld()
      const direction = cameraAimDirection(orbit.current, new Vector3())
      const centre = expected.clone().addScaledVector(direction, 10).project(camera)
      expect(Math.abs(centre.x)).toBeLessThan(1e-8)
      expect(Math.abs(centre.y)).toBeLessThan(1e-8)
    }
  })
})
