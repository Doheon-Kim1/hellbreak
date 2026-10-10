import { describe, expect, it, vi } from 'vitest'
import { Group } from 'three'

const harness = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, frame: null as null | (() => void) }))
vi.mock('@react-three/fiber', () => ({ useFrame: (callback: () => void) => { harness.frame = callback } }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value === null ? new Group() : value }),
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect) },
}))
import { PlayerCharacter } from './PlayerCharacter'
const createCharacterFrame = () => ({ elapsed: 0, delta: 1 / 60, velocityX: 0, velocityY: 0,
  velocityZ: 0, grounded: true, alive: true, escaped: false, rescueRole: 'none' as const,
  rescueDirectionX: 0, rescueDirectionY: 0, rescueDirectionZ: -1, reducedMotion: false })

describe('PlayerCharacter rendered-pose lifecycle', () => {
  it('reports the same rendered idle pose again after effect cleanup and setup replay', () => {
    harness.effects = []
    harness.frame = null
    const report = vi.fn()
    PlayerCharacter({ playerId: 'idle-runner', isOwn: true,
      frame: { current: createCharacterFrame() }, onPose: report })
    const cleanups = harness.effects.map(effect => effect())
    harness.frame!()
    expect(report).toHaveBeenLastCalledWith('idle-runner', 'idle', '')
    cleanups.forEach(cleanup => cleanup?.())
    expect(report).toHaveBeenLastCalledWith('idle-runner', null, '')
    const replayCleanups = harness.effects.map(effect => effect())
    harness.frame!()
    expect(report).toHaveBeenLastCalledWith('idle-runner', 'idle', '')
    expect(report).toHaveBeenCalledTimes(3)
    harness.frame!()
    expect(report).toHaveBeenCalledTimes(3)
    replayCleanups.forEach(cleanup => cleanup?.())
    expect(report).toHaveBeenLastCalledWith('idle-runner', null, '')
  })
})
