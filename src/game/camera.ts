export interface CameraOrbit {
  yaw: number
  pitch: number
  distance: number
}

export interface CameraOrbitInput {
  deltaX: number
  deltaY: number
  zoomDelta: number
}

export interface CameraOffset {
  x: number
  y: number
  z: number
}

export const DEFAULT_CAMERA_ORBIT: Readonly<CameraOrbit> = {
  yaw: 0.7298996581517315,
  pitch: 0.32621417327184976,
  distance: 10.765802338887706,
}

const MIN_PITCH = 0.18
const MAX_PITCH = 1.05
const MIN_DISTANCE = 6
const MAX_DISTANCE = 15
const DRAG_YAW_SPEED = 0.008
const DRAG_PITCH_SPEED = 0.006
const ZOOM_SPEED = 0.01

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function updateCameraOrbit(orbit: CameraOrbit, input: CameraOrbitInput): CameraOrbit {
  return {
    yaw: orbit.yaw - input.deltaX * DRAG_YAW_SPEED,
    pitch: clamp(orbit.pitch + input.deltaY * DRAG_PITCH_SPEED, MIN_PITCH, MAX_PITCH),
    distance: clamp(orbit.distance + input.zoomDelta * ZOOM_SPEED, MIN_DISTANCE, MAX_DISTANCE),
  }
}

export function cameraOrbitOffset(orbit: CameraOrbit): CameraOffset {
  const horizontalDistance = Math.cos(orbit.pitch) * orbit.distance
  return {
    x: Math.sin(orbit.yaw) * horizontalDistance,
    y: Math.sin(orbit.pitch) * orbit.distance,
    z: Math.cos(orbit.yaw) * horizontalDistance,
  }
}

export function rotateMovementByCamera(movement: { x: number; z: number }, yaw: number) {
  const sine = Math.sin(yaw)
  const cosine = Math.cos(yaw)
  return {
    x: movement.x * cosine + movement.z * sine,
    z: -movement.x * sine + movement.z * cosine,
  }
}
