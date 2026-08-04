export type GameCameraMode = 'player' | 'spectator'

export interface PlayerPresentationInput {
  spectating: boolean
  escaped: boolean
}

export interface PlayerPresentation {
  renderBody: boolean
  cameraMode: GameCameraMode
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
