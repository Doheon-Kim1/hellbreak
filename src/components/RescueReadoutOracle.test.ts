import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, it } from 'vitest'

async function observation() {
  // Execute the unchanged actual browser observer with controlled DOM samples, not a GPU/room.
  const path = resolve('e2e/multiplayer.spec.ts')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'watchRescueReadout')!
  const code = ts.transpileModule(fn.getText(source) + '\nmodule.exports = watchRescueReadout', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  let sample: Record<string, string> = {}
  let changed = () => {}
  const attrs = (mapping: Record<string, string>) => ({ getAttribute: (name: string) => mapping[name] ?? '' })
  const window: { __rescueReadout?: { observed: boolean; semanticFrameObserved: boolean;
    rescuerRigObserved: boolean; beginAttempt?: () => void } } = {}
  const document = {
    body: {},
    querySelectorAll: () => [attrs({ 'data-state': sample.holding ?? '', 'data-urgency': 'safe' })],
    querySelector(selector: string) {
      if (selector.includes('data-own')) return attrs({
        'data-grab-target': sample.target ?? '', 'data-character-pose': sample.ownPose ?? 'idle',
        'data-character-rescue-link': sample.ownLink ?? '', 'data-grab-ack': '0',
        'data-alive': 'true',
      })
      if (selector.includes('network-player')) return attrs({
        'data-grabbed-by': sample.incoming ?? '', 'data-character-pose': sample.peerPose ?? 'idle',
        'data-character-rescue-link': sample.peerLink ?? '',
        'data-alive': 'true', 'data-grounded': 'true',
      })
      if (selector.includes('rescue-grip')) return attrs({ 'data-grip-band': 'steady' })
      return { textContent: '' }
    },
  }
  const exported = { exports: undefined as unknown }
  runInNewContext(code, { module: exported, window, document, MutationObserver: class {
    constructor(read: () => void) { changed = read }
    observe() {}
    disconnect() {}
  } })
  const watch = exported.exports as (page: unknown, options: unknown) => Promise<void>
  await watch({ evaluate: (fn: (value: unknown) => void, value: unknown) => fn(value) }, {
    rescuerId: 'owner', targetId: 'peer', urgencies: ['safe'], gripBands: ['steady'],
  })
  return { probe: window.__rescueReadout!, set(next: Record<string, string>) { sample = next; changed() } }
}

it('preserves legitimate schema-to-renderer phase lag within one rescue attempt', async () => {
  const test = await observation()
  test.set({ target: 'peer', incoming: 'owner', holding: 'holding' })
  expect(test.probe.observed).toBe(false)
  test.set({ ownPose: 'rescuing', ownLink: 'peer', peerPose: 'rescued', peerLink: 'owner' })
  expect(test.probe.observed).toBe(true)
})

it('cannot combine semantic and rig evidence from different rescue attempts', async () => {
  const test = await observation()
  test.probe.beginAttempt?.()
  test.set({ target: 'peer', incoming: 'owner', holding: 'holding', ownPose: 'rescuing', ownLink: 'peer' })
  expect(test.probe.observed).toBe(false)
  test.set({}) // Actual old reciprocal rig IDs have cleared before the next attempt.
  test.probe.beginAttempt?.()
  test.set({ peerPose: 'rescued', peerLink: 'owner' })
  expect(test.probe.observed).toBe(false)
  expect(test.probe.semanticFrameObserved).toBe(false)
  expect(test.probe.rescuerRigObserved).toBe(false)
})
