export type GameCameraMode = 'player' | 'spectator'

export interface PlayerPresentationInput {
  spectating: boolean
  escaped: boolean
}

export interface PlayerPresentation {
  renderBody: boolean
  cameraMode: GameCameraMode
}

export type FramePixelSample = readonly [red: number, green: number, blue: number]

export function frameHasVisibleScene(samples: readonly FramePixelSample[], tolerance = 12): boolean {
  if (samples.length < 2) return false
  const minimum = [255, 255, 255]
  const maximum = [0, 0, 0]

  for (const sample of samples) {
    for (let channel = 0; channel < 3; channel += 1) {
      minimum[channel] = Math.min(minimum[channel], sample[channel])
      maximum[channel] = Math.max(maximum[channel], sample[channel])
    }
  }

  return maximum.some((value, channel) => value - minimum[channel] > tolerance)
}

export function sceneCoverVisible(started: boolean, sceneReady: boolean): boolean {
  return !started || !sceneReady
}

export function playerPresentation({
  spectating,
  escaped,
}: PlayerPresentationInput): PlayerPresentation {
  return {
    renderBody: !spectating && !escaped,
    cameraMode: spectating ? 'spectator' : 'player',
  }
}
