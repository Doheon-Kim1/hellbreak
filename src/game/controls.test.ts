import { describe, expect, it } from 'vitest'
import {
  createRunnerControlSources,
  readRunnerInput,
  setRunnerControlSource,
} from './controls'

describe('runner control sources', () => {
  it('tracks simultaneous directions independently', () => {
    let controls = createRunnerControlSources()

    controls = setRunnerControlSource(controls, 'forward', 'touch:1', true)
    controls = setRunnerControlSource(controls, 'right', 'touch:2', true)
    controls = setRunnerControlSource(controls, 'forward', 'touch:1', false)

    expect(readRunnerInput(controls)).toEqual({
      forward: false,
      backward: false,
      left: false,
      right: true,
      sprint: false,
    })
  })

  it('keeps a control active until every pointer on that button releases', () => {
    let controls = createRunnerControlSources()

    controls = setRunnerControlSource(controls, 'forward', 'touch:1', true)
    controls = setRunnerControlSource(controls, 'forward', 'touch:2', true)
    controls = setRunnerControlSource(controls, 'forward', 'touch:1', false)

    expect(readRunnerInput(controls).forward).toBe(true)
    controls = setRunnerControlSource(controls, 'forward', 'touch:2', false)
    expect(readRunnerInput(controls).forward).toBe(false)
  })

  it('keeps keyboard input active when the matching touch input releases', () => {
    let controls = createRunnerControlSources()

    controls = setRunnerControlSource(controls, 'forward', 'keyboard:KeyW', true)
    controls = setRunnerControlSource(controls, 'forward', 'touch:7', true)
    controls = setRunnerControlSource(controls, 'forward', 'touch:7', false)

    expect(readRunnerInput(controls).forward).toBe(true)
    controls = setRunnerControlSource(controls, 'forward', 'keyboard:KeyW', false)
    expect(readRunnerInput(controls).forward).toBe(false)
  })

  it('tracks keyboard aliases as separate sources', () => {
    let controls = createRunnerControlSources()

    controls = setRunnerControlSource(controls, 'forward', 'keyboard:KeyW', true)
    controls = setRunnerControlSource(controls, 'forward', 'keyboard:ArrowUp', true)
    controls = setRunnerControlSource(controls, 'forward', 'keyboard:KeyW', false)

    expect(readRunnerInput(controls).forward).toBe(true)
  })
})
