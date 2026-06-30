import * as THREE from 'three'

export type ControlledNodeMotionVectorLike = {
  x: number
  y: number
  z: number
}

export type ControlledNodeMotionQuaternionLike = {
  x: number
  y: number
  z: number
  w: number
}

export type ControlledNodeMotionSampleInput = {
  position: ControlledNodeMotionVectorLike
  quaternion: ControlledNodeMotionQuaternionLike
  deltaSeconds?: number
  nowMs?: number
  forwardAxis?: ControlledNodeMotionVectorLike | null
  fallbackLinearVelocity?: ControlledNodeMotionVectorLike | null
  fallbackAngularVelocity?: ControlledNodeMotionVectorLike | null
}

export type ControlledNodeMotionTelemetry = {
  nodeId: string
  hasSample: boolean
  timestampMs: number
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
  worldLinearVelocity: THREE.Vector3
  worldAngularVelocity: THREE.Vector3
  linearSpeedMps: number
  forwardSpeedMps: number
  angularSpeedRadPerSec: number
  headingYawRad: number
  headingYawDeg: number
}

type MotionSample = {
  timestampMs: number
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

type ControlledNodeMotionState = {
  samples: MotionSample[]
  telemetry: ControlledNodeMotionTelemetry
  lastForwardAxis: THREE.Vector3
}

const DEFAULT_WINDOW_MS = 300
const DEFAULT_LINEAR_EMA_TAU_SECONDS = 0.18
const DEFAULT_ANGULAR_EMA_TAU_SECONDS = 0.14
const TELEPORT_RESET_DISTANCE_METERS = 50
const MIN_SAMPLE_INTERVAL_SECONDS = 1 / 120

const controlledNodeMotionPositionScratch = new THREE.Vector3()
const controlledNodeMotionQuaternionScratch = new THREE.Quaternion()
const controlledNodeMotionForwardScratch = new THREE.Vector3()
const controlledNodeMotionDeltaPositionScratch = new THREE.Vector3()
const controlledNodeMotionDeltaQuaternionScratch = new THREE.Quaternion()
const controlledNodeMotionAngularAxisScratch = new THREE.Vector3()
const controlledNodeMotionAngularVelocityScratch = new THREE.Vector3()

function clampFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function getNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function normalizeVectorLike(
  target: THREE.Vector3,
  value: ControlledNodeMotionVectorLike | null | undefined,
  fallbackX: number,
  fallbackY: number,
  fallbackZ: number,
): THREE.Vector3 {
  if (!value) {
    target.set(fallbackX, fallbackY, fallbackZ)
    return target
  }
  target.set(
    clampFinite(value.x, fallbackX),
    clampFinite(value.y, fallbackY),
    clampFinite(value.z, fallbackZ),
  )
  return target
}

function easingAlpha(deltaSeconds: number, tauSeconds: number): number {
  const dt = Math.max(0, deltaSeconds)
  const tau = Math.max(1e-3, tauSeconds)
  return 1 - Math.exp(-dt / tau)
}

function applyEmaVector(target: THREE.Vector3, raw: THREE.Vector3, alpha: number): void {
  if (alpha >= 1) {
    target.copy(raw)
    return
  }
  target.x += (raw.x - target.x) * alpha
  target.y += (raw.y - target.y) * alpha
  target.z += (raw.z - target.z) * alpha
}

function applyEmaScalar(previous: number, raw: number, alpha: number): number {
  if (alpha >= 1) {
    return raw
  }
  return previous + (raw - previous) * alpha
}

function quaternionAngleBetween(prev: THREE.Quaternion, next: THREE.Quaternion, outAxis: THREE.Vector3): number {
  controlledNodeMotionDeltaQuaternionScratch.copy(prev).invert().multiply(next).normalize()
  if (controlledNodeMotionDeltaQuaternionScratch.w < 0) {
    controlledNodeMotionDeltaQuaternionScratch.x = -controlledNodeMotionDeltaQuaternionScratch.x
    controlledNodeMotionDeltaQuaternionScratch.y = -controlledNodeMotionDeltaQuaternionScratch.y
    controlledNodeMotionDeltaQuaternionScratch.z = -controlledNodeMotionDeltaQuaternionScratch.z
    controlledNodeMotionDeltaQuaternionScratch.w = -controlledNodeMotionDeltaQuaternionScratch.w
  }

  const clampedW = Math.max(-1, Math.min(1, controlledNodeMotionDeltaQuaternionScratch.w))
  const angle = 2 * Math.acos(clampedW)
  const sinHalf = Math.sqrt(Math.max(0, 1 - clampedW * clampedW))
  if (sinHalf > 1e-8) {
    outAxis.set(
      controlledNodeMotionDeltaQuaternionScratch.x / sinHalf,
      controlledNodeMotionDeltaQuaternionScratch.y / sinHalf,
      controlledNodeMotionDeltaQuaternionScratch.z / sinHalf,
    )
  } else {
    outAxis.set(0, 1, 0)
  }
  return Number.isFinite(angle) ? angle : 0
}

function trimSamples(samples: MotionSample[], nowMs: number, windowMs: number): void {
  const cutoff = nowMs - Math.max(1, windowMs)
  while (samples.length > 1 && samples[0]!.timestampMs < cutoff) {
    samples.shift()
  }
}

function getForwardAxisFromSample(
  state: ControlledNodeMotionState | null,
  sample: ControlledNodeMotionSampleInput,
  out: THREE.Vector3,
): THREE.Vector3 {
  if (sample.forwardAxis) {
    return normalizeVectorLike(out, sample.forwardAxis, 1, 0, 0)
  }
  if (state) {
    return out.copy(state.lastForwardAxis)
  }
  return out.set(1, 0, 0)
}

function computeRawTelemetryFromWindow(
  samples: MotionSample[],
  forwardAxis: THREE.Vector3,
  outLinearVelocity: THREE.Vector3,
  outAngularVelocity: THREE.Vector3,
): {
  hasRawSample: boolean
  linearSpeedMps: number
  forwardSpeedMps: number
  angularSpeedRadPerSec: number
} {
  if (samples.length < 2) {
    outLinearVelocity.set(0, 0, 0)
    outAngularVelocity.set(0, 0, 0)
    return {
      hasRawSample: false,
      linearSpeedMps: 0,
      forwardSpeedMps: 0,
      angularSpeedRadPerSec: 0,
    }
  }

  const oldest = samples[0]!
  const newest = samples[samples.length - 1]!
  const elapsedSeconds = (newest.timestampMs - oldest.timestampMs) / 1000
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    outLinearVelocity.set(0, 0, 0)
    outAngularVelocity.set(0, 0, 0)
    return {
      hasRawSample: false,
      linearSpeedMps: 0,
      forwardSpeedMps: 0,
      angularSpeedRadPerSec: 0,
    }
  }

  controlledNodeMotionDeltaPositionScratch.copy(newest.position).sub(oldest.position)
  outLinearVelocity.copy(controlledNodeMotionDeltaPositionScratch).multiplyScalar(1 / elapsedSeconds)

  controlledNodeMotionForwardScratch.copy(forwardAxis)
  if (controlledNodeMotionForwardScratch.lengthSq() < 1e-8) {
    controlledNodeMotionForwardScratch.set(1, 0, 0)
  }
  controlledNodeMotionForwardScratch.applyQuaternion(newest.quaternion)
  controlledNodeMotionForwardScratch.y = 0
  if (controlledNodeMotionForwardScratch.lengthSq() > 1e-8) {
    controlledNodeMotionForwardScratch.normalize()
  }
  const forwardSpeedMps = outLinearVelocity.dot(controlledNodeMotionForwardScratch)

  const angularMagnitude = quaternionAngleBetween(oldest.quaternion, newest.quaternion, controlledNodeMotionAngularAxisScratch)
  const angularSpeedRadPerSec = angularMagnitude / elapsedSeconds
  outAngularVelocity.copy(controlledNodeMotionAngularAxisScratch).multiplyScalar(angularSpeedRadPerSec)

  return {
    hasRawSample: true,
    linearSpeedMps: outLinearVelocity.length(),
    forwardSpeedMps,
    angularSpeedRadPerSec,
  }
}

export class ControlledNodeMotionRuntime {
  private readonly states = new Map<string, ControlledNodeMotionState>()

  reset(): void {
    this.states.clear()
  }

  clear(nodeId: string): void {
    this.states.delete(nodeId)
  }

  has(nodeId: string): boolean {
    return this.states.has(nodeId)
  }

  get(nodeId: string): ControlledNodeMotionTelemetry | null {
    return this.states.get(nodeId)?.telemetry ?? null
  }

  resolveLinearSpeedMps(nodeId: string, fallback?: number | null): number {
    const telemetry = this.get(nodeId)
    if (telemetry) {
      return telemetry.linearSpeedMps
    }
    return Number.isFinite(fallback ?? NaN) ? Math.max(0, fallback as number) : 0
  }

  resolveForwardSpeedMps(nodeId: string, fallback?: number | null): number {
    const telemetry = this.get(nodeId)
    if (telemetry) {
      return telemetry.forwardSpeedMps
    }
    return Number.isFinite(fallback ?? NaN) ? (fallback as number) : 0
  }

  resolveWorldLinearVelocity(nodeId: string, target: THREE.Vector3, fallback?: ControlledNodeMotionVectorLike | null): boolean {
    const telemetry = this.get(nodeId)
    if (telemetry) {
      target.copy(telemetry.worldLinearVelocity)
      return true
    }
    if (fallback) {
      target.set(clampFinite(fallback.x), clampFinite(fallback.y), clampFinite(fallback.z))
      return true
    }
    return false
  }

  recordSample(nodeId: string, sample: ControlledNodeMotionSampleInput): ControlledNodeMotionTelemetry {
    const nowMs = Number.isFinite(sample.nowMs ?? NaN) ? (sample.nowMs as number) : getNowMs()
    const deltaSeconds = Number.isFinite(sample.deltaSeconds ?? NaN) ? Math.max(0, sample.deltaSeconds as number) : 0

    const position = controlledNodeMotionPositionScratch.set(
      clampFinite(sample.position.x),
      clampFinite(sample.position.y),
      clampFinite(sample.position.z),
    ).clone()
    const quaternion = controlledNodeMotionQuaternionScratch.set(
      clampFinite(sample.quaternion.x),
      clampFinite(sample.quaternion.y),
      clampFinite(sample.quaternion.z),
      clampFinite(sample.quaternion.w, 1),
    ).normalize().clone()

    const existingState = this.states.get(nodeId) ?? null
    const forwardAxis = getForwardAxisFromSample(existingState, sample, controlledNodeMotionForwardScratch).clone()

    if (!existingState) {
      const telemetry: ControlledNodeMotionTelemetry = {
        nodeId,
        hasSample: true,
        timestampMs: nowMs,
        worldPosition: position.clone(),
        worldQuaternion: quaternion.clone(),
        worldLinearVelocity: new THREE.Vector3(),
        worldAngularVelocity: new THREE.Vector3(),
        linearSpeedMps: 0,
        forwardSpeedMps: 0,
        angularSpeedRadPerSec: 0,
        headingYawRad: 0,
        headingYawDeg: 0,
      }

      if (sample.fallbackLinearVelocity) {
        telemetry.worldLinearVelocity.set(
          clampFinite(sample.fallbackLinearVelocity.x),
          clampFinite(sample.fallbackLinearVelocity.y),
          clampFinite(sample.fallbackLinearVelocity.z),
        )
      }
      if (sample.fallbackAngularVelocity) {
        telemetry.worldAngularVelocity.set(
          clampFinite(sample.fallbackAngularVelocity.x),
          clampFinite(sample.fallbackAngularVelocity.y),
          clampFinite(sample.fallbackAngularVelocity.z),
        )
      }

      telemetry.linearSpeedMps = telemetry.worldLinearVelocity.length()
      telemetry.forwardSpeedMps = this.resolveForwardFromVelocity(telemetry.worldLinearVelocity, quaternion, forwardAxis)
      telemetry.angularSpeedRadPerSec = telemetry.worldAngularVelocity.length()
      this.applyHeadingTelemetry(telemetry, quaternion, forwardAxis)

      this.states.set(nodeId, {
        samples: [
          {
            timestampMs: nowMs,
            position,
            quaternion,
          },
        ],
        telemetry,
        lastForwardAxis: forwardAxis,
      })
      return telemetry
    }

    const state = existingState
    const lastSample = state.samples[state.samples.length - 1] ?? null
    const lastTimestampMs = lastSample?.timestampMs ?? nowMs
    const effectiveNowMs = Math.max(nowMs, lastTimestampMs + 1)
    const effectiveDeltaSeconds = Math.max(
      MIN_SAMPLE_INTERVAL_SECONDS,
      deltaSeconds > 0 ? deltaSeconds : (effectiveNowMs - lastTimestampMs) / 1000,
    )

    if (lastSample) {
      const jumpDistance = lastSample.position.distanceTo(position)
      if (Number.isFinite(jumpDistance) && jumpDistance > TELEPORT_RESET_DISTANCE_METERS) {
        state.samples.length = 0
        state.telemetry.worldLinearVelocity.set(0, 0, 0)
        state.telemetry.worldAngularVelocity.set(0, 0, 0)
        state.telemetry.linearSpeedMps = 0
        state.telemetry.forwardSpeedMps = 0
        state.telemetry.angularSpeedRadPerSec = 0
      }
    }

    state.samples.push({
      timestampMs: effectiveNowMs,
      position,
      quaternion,
    })
    trimSamples(state.samples, effectiveNowMs, DEFAULT_WINDOW_MS)

    const rawLinearVelocity = controlledNodeMotionPositionScratch
    const rawAngularVelocity = controlledNodeMotionAngularVelocityScratch
    const raw = computeRawTelemetryFromWindow(state.samples, forwardAxis, rawLinearVelocity, rawAngularVelocity)

    if (!raw.hasRawSample) {
      if (sample.fallbackLinearVelocity) {
        rawLinearVelocity.set(
          clampFinite(sample.fallbackLinearVelocity.x),
          clampFinite(sample.fallbackLinearVelocity.y),
          clampFinite(sample.fallbackLinearVelocity.z),
        )
      } else {
        rawLinearVelocity.copy(state.telemetry.worldLinearVelocity)
      }

      if (sample.fallbackAngularVelocity) {
        rawAngularVelocity.set(
          clampFinite(sample.fallbackAngularVelocity.x),
          clampFinite(sample.fallbackAngularVelocity.y),
          clampFinite(sample.fallbackAngularVelocity.z),
        )
      } else {
        rawAngularVelocity.copy(state.telemetry.worldAngularVelocity)
      }

      raw.linearSpeedMps = rawLinearVelocity.length()
      raw.forwardSpeedMps = this.resolveForwardFromVelocity(rawLinearVelocity, quaternion, forwardAxis)
      raw.angularSpeedRadPerSec = rawAngularVelocity.length()
    }

    const linearAlpha = easingAlpha(effectiveDeltaSeconds, DEFAULT_LINEAR_EMA_TAU_SECONDS)
    const angularAlpha = easingAlpha(effectiveDeltaSeconds, DEFAULT_ANGULAR_EMA_TAU_SECONDS)

    state.telemetry.hasSample = true
    state.telemetry.timestampMs = effectiveNowMs
    state.telemetry.worldPosition.copy(position)
    state.telemetry.worldQuaternion.copy(quaternion)
    applyEmaVector(state.telemetry.worldLinearVelocity, rawLinearVelocity, linearAlpha)
    applyEmaVector(state.telemetry.worldAngularVelocity, rawAngularVelocity, angularAlpha)
    state.telemetry.linearSpeedMps = state.telemetry.worldLinearVelocity.length()
    state.telemetry.forwardSpeedMps = applyEmaScalar(
      state.telemetry.forwardSpeedMps,
      this.resolveForwardFromVelocity(state.telemetry.worldLinearVelocity, quaternion, forwardAxis),
      linearAlpha,
    )
    state.telemetry.angularSpeedRadPerSec = applyEmaScalar(
      state.telemetry.angularSpeedRadPerSec,
      state.telemetry.worldAngularVelocity.length(),
      angularAlpha,
    )
    this.applyHeadingTelemetry(state.telemetry, quaternion, forwardAxis)

    state.lastForwardAxis.copy(forwardAxis)
    return state.telemetry
  }

  private resolveForwardFromVelocity(
    linearVelocity: THREE.Vector3,
    quaternion: THREE.Quaternion,
    forwardAxis: THREE.Vector3,
  ): number {
    const worldForward = controlledNodeMotionDeltaPositionScratch.copy(forwardAxis)
    if (worldForward.lengthSq() < 1e-8) {
      worldForward.set(1, 0, 0)
    }
    worldForward.applyQuaternion(quaternion)
    worldForward.y = 0
    if (worldForward.lengthSq() > 1e-8) {
      worldForward.normalize()
      return linearVelocity.dot(worldForward)
    }
    return 0
  }

  private applyHeadingTelemetry(
    telemetry: ControlledNodeMotionTelemetry,
    quaternion: THREE.Quaternion,
    forwardAxis: THREE.Vector3,
  ): void {
    const worldForward = controlledNodeMotionDeltaPositionScratch.copy(forwardAxis)
    if (worldForward.lengthSq() < 1e-8) {
      worldForward.set(1, 0, 0)
    }
    worldForward.applyQuaternion(quaternion)
    worldForward.y = 0
    if (worldForward.lengthSq() > 1e-8) {
      worldForward.normalize()
      telemetry.headingYawRad = Math.atan2(worldForward.z, worldForward.x)
      telemetry.headingYawDeg = THREE.MathUtils.radToDeg(telemetry.headingYawRad)
      return
    }
    telemetry.headingYawRad = 0
    telemetry.headingYawDeg = 0
  }
}

export function createControlledNodeMotionRuntime(): ControlledNodeMotionRuntime {
  return new ControlledNodeMotionRuntime()
}
