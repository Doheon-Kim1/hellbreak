export interface CameraOrbit {
  /** Horizontal view heading. Yaw zero looks toward world -Z. */
  yaw: number
  /** Signed view pitch. Positive looks upward; it never contributes to movement velocity. */
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
  pitch: 0,
  distance: 10.765802338887706,
}

export const MIN_CAMERA_PITCH = -Math.PI * (65 / 180)
export const MAX_CAMERA_PITCH = Math.PI * (70 / 180)
export const MAX_POINTER_LOOK_DELTA = 100

export async function requestPointerLockSafely(
  request: () => void | Promise<void>,
  onRejected: () => void,
): Promise<boolean> {
  try {
    await request()
    return true
  } catch {
    onRejected()
    return false
  }
}

/** Reject the oversized cursor-warp event some browsers emit while acquiring pointer lock. */
export function isUsableInitialPointerLookDelta(deltaX: number, deltaY: number): boolean {
  const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY))
  return Number.isFinite(deltaX)
    && Number.isFinite(deltaY)
    && magnitude >= 0.5
    && magnitude <= MAX_POINTER_LOOK_DELTA
}
const MIN_DISTANCE = 6
const MAX_DISTANCE = 15
const MOUSE_YAW_SPEED = 0.0028
const MOUSE_PITCH_SPEED = 0.0024
const ZOOM_SPEED = 0.01

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Mutates a caller-owned camera state so raw pointer-lock motion does not allocate per event. */
export function updateCameraOrbitInPlace(orbit: CameraOrbit, input: CameraOrbitInput): CameraOrbit {
  orbit.yaw -= input.deltaX * MOUSE_YAW_SPEED
  orbit.pitch = clamp(orbit.pitch - input.deltaY * MOUSE_PITCH_SPEED, MIN_CAMERA_PITCH, MAX_CAMERA_PITCH)
  orbit.distance = clamp(orbit.distance + input.zoomDelta * ZOOM_SPEED, MIN_DISTANCE, MAX_DISTANCE)
  return orbit
}

/** Compatibility helper for callers that explicitly need an immutable result. */
export function updateCameraOrbit(orbit: CameraOrbit, input: CameraOrbitInput): CameraOrbit {
  return updateCameraOrbitInPlace({ ...orbit }, input)
}

/** Third-person boom stays horizontal; signed look pitch changes aim without burying the camera. */
export function cameraOrbitOffset(orbit: CameraOrbit): CameraOffset {
  return {
    x: Math.sin(orbit.yaw) * orbit.distance,
    y: 0,
    z: Math.cos(orbit.yaw) * orbit.distance,
  }
}

export function cameraAimDirection<T extends CameraOffset>(
  view: Pick<CameraOrbit, 'yaw' | 'pitch'>,
  out: T,
): T {
  const horizontal = Math.cos(view.pitch)
  out.x = -Math.sin(view.yaw) * horizontal
  out.y = Math.sin(view.pitch)
  out.z = -Math.cos(view.yaw) * horizontal
  return out
}

export function rotateMovementByCamera(movement: { x: number; z: number }, yaw: number) {
  const sine = Math.sin(yaw)
  const cosine = Math.cos(yaw)
  return {
    x: movement.x * cosine + movement.z * sine,
    z: -movement.x * sine + movement.z * cosine,
  }
}
