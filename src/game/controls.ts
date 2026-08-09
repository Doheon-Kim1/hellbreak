/**
 * `rescue` is held intent shared by the keyboard and the mobile button. Only the online room
 * consumes it; the local bot match has no rescue mechanic and ignores it entirely.
 */
export type RunnerControl = 'forward' | 'backward' | 'left' | 'right' | 'sprint' | 'rescue'

export type RunnerInput = Record<RunnerControl, boolean>
export type RunnerControlSources = Record<RunnerControl, readonly string[]>

export function createRunnerControlSources(): RunnerControlSources {
  return {
    forward: [],
    backward: [],
    left: [],
    right: [],
    sprint: [],
    rescue: [],
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
    rescue: controls.rescue.length > 0,
  }
}
