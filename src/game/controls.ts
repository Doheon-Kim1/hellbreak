export type RunnerControl = 'forward' | 'backward' | 'left' | 'right' | 'sprint'

export type RunnerInput = Record<RunnerControl, boolean>
export type RunnerControlSources = Record<RunnerControl, readonly string[]>

export function createRunnerControlSources(): RunnerControlSources {
  return {
    forward: [],
    backward: [],
    left: [],
    right: [],
    sprint: [],
  }
}

export function setRunnerControlSource(
  controls: RunnerControlSources,
  control: RunnerControl,
  source: string,
  pressed: boolean,
): RunnerControlSources {
  const activeSources = controls[control]
  const nextSources = pressed
    ? activeSources.includes(source) ? activeSources : [...activeSources, source]
    : activeSources.filter((activeSource) => activeSource !== source)

  if (nextSources === activeSources || nextSources.length === activeSources.length) return controls
  return { ...controls, [control]: nextSources }
}

export function readRunnerInput(controls: RunnerControlSources): RunnerInput {
  return {
    forward: controls.forward.length > 0,
    backward: controls.backward.length > 0,
    left: controls.left.length > 0,
    right: controls.right.length > 0,
    sprint: controls.sprint.length > 0,
  }
}
