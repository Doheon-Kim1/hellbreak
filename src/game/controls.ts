export type RunnerControl = 'forward' | 'backward' | 'left' | 'right' | 'sprint'

export type RunnerInput = Record<RunnerControl, boolean>

export function createRunnerInput(): RunnerInput {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
  }
}

export function setRunnerControl(input: RunnerInput, control: RunnerControl, pressed: boolean): RunnerInput {
  return { ...input, [control]: pressed }
}
