import { describe, expect, it } from 'vitest'
import { createRunnerInput, setRunnerControl } from './controls'

describe('mobile runner controls', () => {
  it('tracks simultaneous touch buttons independently', () => {
    let input = createRunnerInput()

    input = setRunnerControl(input, 'forward', true)
    input = setRunnerControl(input, 'right', true)
    input = setRunnerControl(input, 'forward', false)

    expect(input).toEqual({
      forward: false,
      backward: false,
      left: false,
      right: true,
      sprint: false,
    })
  })

  it('creates a fresh released state after controls were held', () => {
    let input = createRunnerInput()
    input = setRunnerControl(input, 'forward', true)
    input = setRunnerControl(input, 'sprint', true)

    expect(createRunnerInput()).toEqual({
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
    })
    expect(input.forward).toBe(true)
    expect(input.sprint).toBe(true)
  })
})
