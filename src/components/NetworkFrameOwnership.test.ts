import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('actual network body, camera and rig draw ownership', () => {
  it('keeps snapshot commits, slow motion and same-frame camera alignment coherent', () => {
    const execution = spawnSync(process.execPath, [resolve('test-support/network-render-repro.cjs'), '--production'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
    })
    expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(0)
    const line = execution.stdout.split('\n').find(value => value.startsWith('NETWORK_RENDER_REGRESSIONS '))!
    const result = JSON.parse(line.slice('NETWORK_RENDER_REGRESSIONS '.length))
    expect(result.failed).toBe(0)
    expect(result.passed).toBe(10)
  }, 35_000)
  it('rejects stale draw rows even when committed body and rig callbacks keep running', () => {
    const execution = spawnSync(process.execPath, [resolve('test-support/network-render-repro.cjs'), '--production', '--suppress-after-warmup'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
    })
    expect(execution.status, `${execution.stdout}\n${execution.stderr}`).not.toBe(0)
    expect(execution.stdout).toContain('Fresh renderer-adapter draw required')
  }, 35_000)
})
