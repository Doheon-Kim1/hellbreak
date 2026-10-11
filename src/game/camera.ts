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
  // Face the first climb, rather than an unrelated diagonal of the playground.
  yaw: -Math.PI / 4,
  pitch: 0,
  distance: 10.765802338887706,
}

export const MIN_CAMERA_PITCH = -Math.PI * (65 / 180)
export const MAX_CAMERA_PITCH = Math.PI * (70 / 180)
export const MAX_POINTER_LOOK_DELTA = 100
export const POINTER_LOCK_SETTLE_MS = 100

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
export function isUsableInitialPointerLookDelta(deltaX: number, deltaY: number, elapsedSinceLockMs = Infinity): boolean {
  const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY))
  return elapsedSinceLockMs >= POINTER_LOCK_SETTLE_MS && Number.isFinite(deltaX)
    && Number.isFinite(deltaY)
    && magnitude >= 0.5
    && magnitude <= MAX_POINTER_LOOK_DELTA
}
export const MIN_CAMERA_DISTANCE = 6
export const MAX_CAMERA_DISTANCE = 15
export const CAMERA_EYE_HEIGHT = 1.05
const MOUSE_YAW_SPEED = 0.0028
const MOUSE_PITCH_SPEED = 0.0024
const ZOOM_SPEED = 0.01

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Mutates a caller-owned camera state so raw pointer-lock motion does not allocate per event. */
export function updateCameraOrbitInPlace(
  orbit: CameraOrbit, input: CameraOrbitInput,
  settings: { sensitivity: number; invertY: boolean } = { sensitivity: 1, invertY: false },
): CameraOrbit {
  const sensitivity = Number.isFinite(settings.sensitivity) ? clamp(settings.sensitivity, 0.2, 3) : 1
  orbit.yaw -= input.deltaX * MOUSE_YAW_SPEED * sensitivity
  orbit.pitch = clamp(orbit.pitch - input.deltaY * MOUSE_PITCH_SPEED * sensitivity * (settings.invertY ? -1 : 1), MIN_CAMERA_PITCH, MAX_CAMERA_PITCH)
  orbit.distance = clamp(orbit.distance + input.zoomDelta * ZOOM_SPEED, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE)
  return orbit
}

/** Compatibility helper for callers that explicitly need an immutable result. */
export function updateCameraOrbit(orbit: CameraOrbit, input: CameraOrbitInput): CameraOrbit {
  return updateCameraOrbitInPlace({ ...orbit }, input)
}

/** Shared desired view origin; the server reconstructs it from its own body, never client XYZ. */
export function cameraAimOrigin<T extends CameraOffset>(position: CameraOffset, orbit: CameraOrbit, out: T): T {
  out.x = position.x + Math.sin(orbit.yaw) * orbit.distance
  out.y = position.y + CAMERA_EYE_HEIGHT
  out.z = position.z + Math.cos(orbit.yaw) * orbit.distance
  return out
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
