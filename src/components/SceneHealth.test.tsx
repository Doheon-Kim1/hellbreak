import { expect, it, vi } from 'vitest'
const harness = vi.hoisted(() => {
  const canvas = Object.assign(new EventTarget(), { dataset: {} as Record<string, string>, width: 100, height: 100 })
  const renderer = { domElement: canvas, getPixelRatio: () => 1, info: { render: { frame: 40 } }, getContext: () => ({
    isContextLost: () => false, RGBA: 6408, UNSIGNED_BYTE: 5121,
    readPixels: (x: number, _y: number, _width: number, _height: number, _format: number, _type: number, pixel: Uint8Array) => { pixel[0] = x * 2 },
  }) }
  return { renderer, after: null as null | (() => void), effects: [] as (() => void | (() => void))[] }
})
vi.mock('@react-three/fiber', async original => ({ ...await original<typeof import('@react-three/fiber')>(),
  useThree: (select: (state: unknown) => unknown) => select({ gl: harness.renderer }),
  addAfterEffect: (callback: () => void) => { harness.after = callback; return () => { harness.after = null } },
}))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (setup: () => void | (() => void)) => { harness.effects.push(setup) },
  useRef: (current: unknown) => ({ current }),
}))
import { SceneHealth } from './HellbreakGame'
it('publishes renderer-owned frame numbers after readiness, not after-effect invocations', () => {
  harness.effects = []; harness.renderer.domElement.dataset = {}; harness.renderer.info.render.frame = 40
  const ready = vi.fn(), failure = vi.fn()
  SceneHealth({ onReady: ready, onFailure: failure })
  const cleanup = harness.effects[0]()
  try {
    harness.after!()
    expect(harness.renderer.domElement.dataset.sceneRenderFrame).toBe('40')
    for (let i = 0; i < 8; i++) harness.after!()
    expect(harness.renderer.domElement.dataset.sceneRenderFrame).toBe('40')
    expect(ready).toHaveBeenCalledOnce()
    expect(harness.renderer.domElement.dataset.sceneReady).toBe('true')
    harness.renderer.info.render.frame = 41
    harness.after!()
    expect(harness.renderer.domElement.dataset.sceneRenderFrame).toBe('41')
    expect(ready).toHaveBeenCalledOnce()
    expect(failure).not.toHaveBeenCalled()
  } finally { cleanup?.() }
})
it('reduces the render pixel budget only after genuine slow renderer frames', () => {
  harness.effects = []; harness.renderer.domElement.dataset = {}; harness.renderer.info.render.frame = 1
  let now = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  const changed = vi.fn()
  SceneHealth({ onReady: vi.fn(), onFailure: vi.fn(), onDprChange: changed })
  const cleanup = harness.effects[0]()
  try {
    harness.after!()
    now = 1000; harness.renderer.info.render.frame = 2; harness.after!()
    for (let i = 0; i < 10; i++) harness.after!()
    expect(changed).not.toHaveBeenCalled()
    now = 2000; harness.renderer.info.render.frame = 3; harness.after!()
    expect(changed).toHaveBeenCalledExactlyOnceWith(0.7)
  } finally { cleanup?.(); clock.mockRestore() }
})
