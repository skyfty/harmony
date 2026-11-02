export type MotionProbeVector = {
  x: number;
  y: number;
  z: number;
}

export type MotionProbeInputSnapshot = {
  source: 'touch' | 'keyboard-or-external' | 'idle';
  touchActive: boolean;
  rawX: number;
  rawY: number;
  moveX: number;
  moveZ: number;
  turn: number;
  desiredYaw: number | null;
  resolvedYaw: number | null;
}

export type MotionProbeCameraSample = {
  anchor: MotionProbeVector;
  camera: MotionProbeVector;
  controlsTarget: MotionProbeVector;
  desiredCamera: MotionProbeVector;
  desiredTarget: MotionProbeVector;
  cameraUp: MotionProbeVector;
  desiredForward: MotionProbeVector;
  groundNormal: MotionProbeVector;
  positionLerpSpeed: number;
  targetLerpSpeed: number;
  deltaSeconds: number;
  input: MotionProbeInputSnapshot;
}

export type MotionProbeCharacterSample = {
  targetErrorM: number;
  correctionM: number;
  deltaSeconds: number;
}

export type MotionProbePhysicsStepReply = {
  bodyCount: number;
  characterMotorCount: number;
}

export type MotionProbeReport = {
  probe: 'scenery-motion';
  sequence: number;
  platform: string;
  windowMs: number;
  frames: {
    samples: number;
    fps: number;
    measuredMsAvg: number;
    measuredMsStdDev: number;
    measuredMsMax: number;
    deltaVsMeasuredMsAvg: number;
    deltaVsMeasuredMsMax: number;
    rawDeltaAvg: number;
    deltaMsAvg: number;
    lateFrameCount: number;
    over50msCount: number;
    zeroDeltaCount: number;
    workMsAvg: number;
    workMsMax: number;
  };
  physics: {
    stepRequests: number;
    stepReplies: number;
    stepReplyMsAvg: number;
    stepReplyMsMax: number;
    stepFailures: number;
    latestBodyCount: number;
    latestCharacterMotorCount: number;
    inputRequests: number;
    inputRequestCount: number;
    inputDeferredFrames: number;
    inputReplyMsAvg: number;
    inputReplyMsMax: number;
    accumulatedDeltaSeconds: number;
    stepPendingSeconds: number;
    stepInFlight: boolean;
    inputSyncPending: boolean;
  };
  character: {
    samples: number;
    targetUpdates: number;
    targetStepM: number;
    targetStepMAtLastUpdate: number;
    targetStepMWindowMax: number;
    targetErrorMAvg: number;
    targetErrorMMax: number;
    correctionMAvg: number;
    correctionMMax: number;
  };
  camera: {
    samples: number;
    position: MotionProbeVector;
    target: MotionProbeVector;
    desiredPosition: MotionProbeVector;
    desiredTarget: MotionProbeVector;
    up: MotionProbeVector;
    desiredForward: MotionProbeVector;
    groundNormal: MotionProbeVector;
    positionLerpSpeed: number;
    targetLerpSpeed: number;
    cameraToAnchorDistanceM: number;
    cameraToAnchorDistanceMinM: number;
    cameraToAnchorDistanceMaxM: number;
    stepM: number;
    stepMMax: number;
    anchorStepM: number;
    anchorStepMMax: number;
    desiredPositionErrorM: number;
    desiredPositionErrorMMax: number;
    targetErrorM: number;
    targetErrorMMax: number;
    upChangeDeg: number;
    upChangeDegMax: number;
    forwardChangeDeg: number;
    forwardChangeDegMax: number;
    groundNormalChangeDeg: number;
    groundNormalChangeDegMax: number;
    input: MotionProbeInputSnapshot;
  };
  flags: string[];
}

export type MotionProbeOptions = {
  intervalMs?: number;
  now?: () => number;
  onReport?: (report: MotionProbeReport) => void;
}

export type MotionProbePhysicsRuntimeState = {
  accumulatedDeltaSeconds: number;
  stepPendingSeconds: number;
  stepInFlight: boolean;
  inputSyncPending: boolean;
}

const DEFAULT_REPORT_INTERVAL_MS = 1000

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function copyVector(value: MotionProbeVector): MotionProbeVector {
  return {
    x: round(value.x),
    y: round(value.y),
    z: round(value.z),
  }
}

function distance(a: MotionProbeVector, b: MotionProbeVector): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz))
}

function angleDegrees(a: MotionProbeVector, b: MotionProbeVector): number {
  const aLength = Math.sqrt((a.x * a.x) + (a.y * a.y) + (a.z * a.z))
  const bLength = Math.sqrt((b.x * b.x) + (b.y * b.y) + (b.z * b.z))
  if (aLength <= 1e-8 || bLength <= 1e-8) {
    return 0
  }
  const dot = (
    (a.x * b.x)
    + (a.y * b.y)
    + (a.z * b.z)
  ) / (aLength * bLength)
  return Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI)
}

function average(sum: number, count: number): number {
  return count > 0 ? sum / count : 0
}

const IDLE_INPUT: MotionProbeInputSnapshot = {
  source: 'idle',
  touchActive: false,
  rawX: 0,
  rawY: 0,
  moveX: 0,
  moveZ: 0,
  turn: 0,
  desiredYaw: null,
  resolvedYaw: null,
}

export function createMotionDiagnosticsProbe(options: MotionProbeOptions = {}) {
  const clock = options.now ?? (() => Date.now())
  const intervalMs = Math.max(100, finiteOrZero(options.intervalMs ?? DEFAULT_REPORT_INTERVAL_MS))
  const onReport = options.onReport ?? (() => undefined)

  let platform = 'unknown'
  let sequence = 0
  let windowStartedAt = clock()
  let activeSeen = false

  let frameLastStartedAt: number | null = null
  let frameSamples = 0
  let frameMeasuredSumMs = 0
  let frameMeasuredSumSqMs = 0
  let frameMeasuredMaxMs = 0
  let frameDeltaMismatchSumMs = 0
  let frameDeltaMismatchMaxMs = 0
  let frameLateCount = 0
  let frameOver50msCount = 0
  let frameRawDeltaSum = 0
  let frameDeltaMsSum = 0
  let frameZeroDeltaCount = 0
  let frameWorkSumMs = 0
  let frameWorkMaxMs = 0

  let physicsStepRequests = 0
  let physicsStepReplies = 0
  let physicsStepReplyMsSum = 0
  let physicsStepReplyMsMax = 0
  let physicsStepFailures = 0
  let physicsLatestBodyCount = 0
  let physicsLatestCharacterMotorCount = 0
  let physicsInputRequests = 0
  let physicsInputRequestCount = 0
  let physicsInputDeferredFrames = 0
  let physicsInputReplyMsSum = 0
  let physicsInputReplyCount = 0
  let physicsInputReplyMsMax = 0
  const physicsRuntimeState: MotionProbePhysicsRuntimeState = {
    accumulatedDeltaSeconds: 0,
    stepPendingSeconds: 0,
    stepInFlight: false,
    inputSyncPending: false,
  }

  let characterSamples = 0
  let characterTargetUpdates = 0
  let characterTargetStepSum = 0
  let characterTargetStepLast = 0
  let characterTargetStepMax = 0
  let characterTargetErrorSum = 0
  let characterTargetErrorMax = 0
  let characterCorrectionSum = 0
  let characterCorrectionMax = 0

  let cameraSamples = 0
  let cameraLastStep = 0
  let cameraStepMax = 0
  let cameraAnchorStepLast = 0
  let cameraAnchorStepMax = 0
  let cameraDesiredPositionErrorLast = 0
  let cameraDesiredPositionErrorMax = 0
  let cameraTargetErrorLast = 0
  let cameraTargetErrorMax = 0
  let cameraUpChangeLast = 0
  let cameraUpChangeMax = 0
  let cameraForwardChangeLast = 0
  let cameraForwardChangeMax = 0
  let cameraGroundNormalChangeLast = 0
  let cameraGroundNormalChangeMax = 0
  let cameraPositionLerpSpeed = 0
  let cameraTargetLerpSpeed = 0
  let cameraDistanceLast = 0
  let cameraDistanceMin = Number.POSITIVE_INFINITY
  let cameraDistanceMax = 0
  const cameraPosition: MotionProbeVector = { x: 0, y: 0, z: 0 }
  const cameraTarget: MotionProbeVector = { x: 0, y: 0, z: 0 }
  const cameraDesiredPosition: MotionProbeVector = { x: 0, y: 0, z: 0 }
  const cameraDesiredTarget: MotionProbeVector = { x: 0, y: 0, z: 0 }
  const cameraUp: MotionProbeVector = { x: 0, y: 1, z: 0 }
  const cameraDesiredForward: MotionProbeVector = { x: 0, y: 0, z: 1 }
  const cameraGroundNormal: MotionProbeVector = { x: 0, y: 1, z: 0 }
  const cameraInput: MotionProbeInputSnapshot = { ...IDLE_INPUT }
  const cameraPreviousAnchor: MotionProbeVector = { x: 0, y: 0, z: 0 }
  const cameraPreviousPosition: MotionProbeVector = { x: 0, y: 0, z: 0 }
  const cameraPreviousUp: MotionProbeVector = { x: 0, y: 1, z: 0 }
  const cameraPreviousForward: MotionProbeVector = { x: 0, y: 0, z: 1 }
  const cameraPreviousGroundNormal: MotionProbeVector = { x: 0, y: 1, z: 0 }
  let hasPreviousCameraSample = false

  function resetWindow(): void {
    windowStartedAt = clock()
    activeSeen = false
    frameSamples = 0
    frameMeasuredSumMs = 0
    frameMeasuredSumSqMs = 0
    frameMeasuredMaxMs = 0
    frameDeltaMismatchSumMs = 0
    frameDeltaMismatchMaxMs = 0
    frameLateCount = 0
    frameOver50msCount = 0
    frameRawDeltaSum = 0
    frameDeltaMsSum = 0
    frameZeroDeltaCount = 0
    frameWorkSumMs = 0
    frameWorkMaxMs = 0
    physicsStepRequests = 0
    physicsStepReplies = 0
    physicsStepReplyMsSum = 0
    physicsStepReplyMsMax = 0
    physicsStepFailures = 0
    physicsInputRequests = 0
    physicsInputRequestCount = 0
    physicsInputDeferredFrames = 0
    physicsInputReplyMsSum = 0
    physicsInputReplyCount = 0
    physicsInputReplyMsMax = 0
    characterSamples = 0
    characterTargetUpdates = 0
    characterTargetStepSum = 0
    characterTargetStepLast = 0
    characterTargetStepMax = 0
    characterTargetErrorSum = 0
    characterTargetErrorMax = 0
    characterCorrectionSum = 0
    characterCorrectionMax = 0
    cameraSamples = 0
    cameraLastStep = 0
    cameraStepMax = 0
    cameraAnchorStepLast = 0
    cameraAnchorStepMax = 0
    cameraDesiredPositionErrorLast = 0
    cameraDesiredPositionErrorMax = 0
    cameraTargetErrorLast = 0
    cameraTargetErrorMax = 0
    cameraUpChangeLast = 0
    cameraUpChangeMax = 0
    cameraForwardChangeLast = 0
    cameraForwardChangeMax = 0
    cameraGroundNormalChangeLast = 0
    cameraGroundNormalChangeMax = 0
    cameraPositionLerpSpeed = 0
    cameraTargetLerpSpeed = 0
    cameraDistanceLast = 0
    cameraDistanceMin = Number.POSITIVE_INFINITY
    cameraDistanceMax = 0
  }

  function resetTracking(): void {
    resetWindow()
    frameLastStartedAt = null
    hasPreviousCameraSample = false
  }

  function buildFlags(report: Omit<MotionProbeReport, 'flags'>): string[] {
    const flags: string[] = []
    const frameSampleCount = Math.max(1, report.frames.samples)
    if (
      report.frames.measuredMsStdDev >= 4
      || report.frames.lateFrameCount >= Math.max(2, frameSampleCount * 0.1)
      || report.frames.measuredMsMax >= 50
    ) {
      flags.push('frame-cadence-jitter')
    }
    if (
      report.frames.deltaVsMeasuredMsAvg >= 4
      || report.frames.deltaVsMeasuredMsMax >= 15
    ) {
      flags.push('callback-delta-mismatch')
    }
    if (
      report.physics.stepReplyMsAvg >= 25
      || report.physics.stepReplyMsMax >= 60
      || report.physics.inputReplyMsAvg >= 25
      || report.physics.inputReplyMsMax >= 60
    ) {
      flags.push('physics-roundtrip-latency')
    }
    if (
      report.character.samples >= 20
      && report.character.targetUpdates < report.character.samples * 0.5
    ) {
      flags.push('character-target-updates-sparse')
    }
    if (report.character.targetStepMWindowMax >= 0.08) {
      flags.push('character-target-steps-spike')
    }
    if (
      report.camera.cameraToAnchorDistanceMaxM - report.camera.cameraToAnchorDistanceMinM >= 0.08
    ) {
      flags.push('camera-anchor-distance-oscillation')
    }
    if (report.camera.desiredPositionErrorMMax >= 0.25) {
      flags.push('camera-follow-lag-or-correction')
    }
    if (report.camera.upChangeDegMax >= 3) {
      flags.push('camera-up-jitter')
    }
    if (report.camera.forwardChangeDegMax >= 30) {
      flags.push('camera-forward-spike')
    }
    if (report.camera.groundNormalChangeDegMax >= 8) {
      flags.push('ground-normal-jitter')
    }
    return flags
  }

  function flush(): MotionProbeReport | null {
    if (frameSamples === 0 && cameraSamples === 0) {
      resetTracking()
      return null
    }
    const now = clock()
    const measuredAverage = average(frameMeasuredSumMs, frameSamples)
    const variance = Math.max(
      0,
      average(frameMeasuredSumSqMs, frameSamples) - (measuredAverage * measuredAverage),
    )
    sequence += 1
    const baseReport: Omit<MotionProbeReport, 'flags'> = {
      probe: 'scenery-motion',
      sequence,
      platform,
      windowMs: round(Math.max(0, now - windowStartedAt), 1),
      frames: {
        samples: frameSamples,
        fps: round(measuredAverage > 0 ? 1000 / measuredAverage : 0, 1),
        measuredMsAvg: round(measuredAverage, 2),
        measuredMsStdDev: round(Math.sqrt(variance), 2),
        measuredMsMax: round(frameMeasuredMaxMs, 2),
        deltaVsMeasuredMsAvg: round(average(frameDeltaMismatchSumMs, frameSamples), 2),
        deltaVsMeasuredMsMax: round(frameDeltaMismatchMaxMs, 2),
        rawDeltaAvg: round(average(frameRawDeltaSum, frameSamples), 3),
        deltaMsAvg: round(average(frameDeltaMsSum, frameSamples), 2),
        lateFrameCount: frameLateCount,
        over50msCount: frameOver50msCount,
        zeroDeltaCount: frameZeroDeltaCount,
        workMsAvg: round(average(frameWorkSumMs, frameSamples), 2),
        workMsMax: round(frameWorkMaxMs, 2),
      },
      physics: {
        stepRequests: physicsStepRequests,
        stepReplies: physicsStepReplies,
        stepReplyMsAvg: round(average(physicsStepReplyMsSum, physicsStepReplies), 2),
        stepReplyMsMax: round(physicsStepReplyMsMax, 2),
        stepFailures: physicsStepFailures,
        latestBodyCount: physicsLatestBodyCount,
        latestCharacterMotorCount: physicsLatestCharacterMotorCount,
        inputRequests: physicsInputRequests,
        inputRequestCount: physicsInputRequestCount,
        inputDeferredFrames: physicsInputDeferredFrames,
        inputReplyMsAvg: round(average(physicsInputReplyMsSum, physicsInputReplyCount), 2),
        inputReplyMsMax: round(physicsInputReplyMsMax, 2),
        accumulatedDeltaSeconds: round(physicsRuntimeState.accumulatedDeltaSeconds, 4),
        stepPendingSeconds: round(physicsRuntimeState.stepPendingSeconds, 4),
        stepInFlight: physicsRuntimeState.stepInFlight,
        inputSyncPending: physicsRuntimeState.inputSyncPending,
      },
      character: {
        samples: characterSamples,
        targetUpdates: characterTargetUpdates,
        targetStepM: round(average(characterTargetStepSum, characterTargetUpdates), 4),
        targetStepMAtLastUpdate: round(characterTargetStepLast, 4),
        targetStepMWindowMax: round(characterTargetStepMax, 4),
        targetErrorMAvg: round(average(characterTargetErrorSum, characterSamples), 4),
        targetErrorMMax: round(characterTargetErrorMax, 4),
        correctionMAvg: round(average(characterCorrectionSum, characterSamples), 4),
        correctionMMax: round(characterCorrectionMax, 4),
      },
      camera: {
        samples: cameraSamples,
        position: copyVector(cameraPosition),
        target: copyVector(cameraTarget),
        desiredPosition: copyVector(cameraDesiredPosition),
        desiredTarget: copyVector(cameraDesiredTarget),
        up: copyVector(cameraUp),
        desiredForward: copyVector(cameraDesiredForward),
        groundNormal: copyVector(cameraGroundNormal),
        positionLerpSpeed: round(cameraPositionLerpSpeed, 2),
        targetLerpSpeed: round(cameraTargetLerpSpeed, 2),
        cameraToAnchorDistanceM: round(cameraDistanceLast, 4),
        cameraToAnchorDistanceMinM: round(
          Number.isFinite(cameraDistanceMin) ? cameraDistanceMin : 0,
          4,
        ),
        cameraToAnchorDistanceMaxM: round(cameraDistanceMax, 4),
        stepM: round(cameraLastStep, 4),
        stepMMax: round(cameraStepMax, 4),
        anchorStepM: round(cameraAnchorStepLast, 4),
        anchorStepMMax: round(cameraAnchorStepMax, 4),
        desiredPositionErrorM: round(cameraDesiredPositionErrorLast, 4),
        desiredPositionErrorMMax: round(cameraDesiredPositionErrorMax, 4),
        targetErrorM: round(cameraTargetErrorLast, 4),
        targetErrorMMax: round(cameraTargetErrorMax, 4),
        upChangeDeg: round(cameraUpChangeLast, 3),
        upChangeDegMax: round(cameraUpChangeMax, 3),
        forwardChangeDeg: round(cameraForwardChangeLast, 3),
        forwardChangeDegMax: round(cameraForwardChangeMax, 3),
        groundNormalChangeDeg: round(cameraGroundNormalChangeLast, 3),
        groundNormalChangeDegMax: round(cameraGroundNormalChangeMax, 3),
        input: {
          ...cameraInput,
          rawX: round(cameraInput.rawX, 3),
          rawY: round(cameraInput.rawY, 3),
          moveX: round(cameraInput.moveX, 3),
          moveZ: round(cameraInput.moveZ, 3),
          turn: round(cameraInput.turn, 3),
          desiredYaw: cameraInput.desiredYaw === null ? null : round(cameraInput.desiredYaw, 4),
          resolvedYaw: cameraInput.resolvedYaw === null ? null : round(cameraInput.resolvedYaw, 4),
        },
      },
    }
    const report: MotionProbeReport = {
      ...baseReport,
      flags: buildFlags(baseReport),
    }
    onReport(report)
    resetWindow()
    return report
  }

  function setPlatform(value: string): void {
    const normalized = value.trim()
    platform = normalized || 'unknown'
  }

  function recordFrame(rawDelta: number, deltaSeconds: number, sampledAt = clock()): void {
    frameSamples += 1
    const safeRawDelta = finiteOrZero(rawDelta)
    const safeDeltaSeconds = Math.max(0, finiteOrZero(deltaSeconds))
    frameRawDeltaSum += safeRawDelta
    frameDeltaMsSum += safeDeltaSeconds * 1000
    if (safeRawDelta === 0 || safeDeltaSeconds === 0) {
      frameZeroDeltaCount += 1
    }
    if (frameLastStartedAt !== null) {
      const measuredMs = sampledAt - frameLastStartedAt
      if (Number.isFinite(measuredMs) && measuredMs >= 0) {
        frameMeasuredSumMs += measuredMs
        frameMeasuredSumSqMs += measuredMs * measuredMs
        frameMeasuredMaxMs = Math.max(frameMeasuredMaxMs, measuredMs)
        const deltaVsMeasuredMs = Math.abs(measuredMs - (safeDeltaSeconds * 1000))
        frameDeltaMismatchSumMs += deltaVsMeasuredMs
        frameDeltaMismatchMaxMs = Math.max(frameDeltaMismatchMaxMs, deltaVsMeasuredMs)
        if (measuredMs > 34) {
          frameLateCount += 1
        }
        if (measuredMs > 50) {
          frameOver50msCount += 1
        }
      }
    }
    frameLastStartedAt = sampledAt
  }

  function recordFrameWork(durationMs: number): void {
    const safeDuration = Math.max(0, finiteOrZero(durationMs))
    frameWorkSumMs += safeDuration
    frameWorkMaxMs = Math.max(frameWorkMaxMs, safeDuration)
    if (activeSeen && clock() - windowStartedAt >= intervalMs) {
      flush()
    }
  }

  function setPhysicsRuntimeState(next: Partial<MotionProbePhysicsRuntimeState>): void {
    physicsRuntimeState.accumulatedDeltaSeconds = Math.max(
      0,
      finiteOrZero(next.accumulatedDeltaSeconds ?? physicsRuntimeState.accumulatedDeltaSeconds),
    )
    physicsRuntimeState.stepPendingSeconds = Math.max(
      0,
      finiteOrZero(next.stepPendingSeconds ?? physicsRuntimeState.stepPendingSeconds),
    )
    physicsRuntimeState.stepInFlight = next.stepInFlight ?? physicsRuntimeState.stepInFlight
    physicsRuntimeState.inputSyncPending =
      next.inputSyncPending ?? physicsRuntimeState.inputSyncPending
  }

  function recordPhysicsStepRequest(): void {
    physicsStepRequests += 1
  }

  function recordPhysicsStepReply(
    durationMs: number,
    details: MotionProbePhysicsStepReply,
  ): void {
    physicsStepReplies += 1
    const safeDuration = Math.max(0, finiteOrZero(durationMs))
    physicsStepReplyMsSum += safeDuration
    physicsStepReplyMsMax = Math.max(physicsStepReplyMsMax, safeDuration)
    physicsLatestBodyCount = Math.max(0, Math.trunc(finiteOrZero(details.bodyCount)))
    physicsLatestCharacterMotorCount = Math.max(
      0,
      Math.trunc(finiteOrZero(details.characterMotorCount)),
    )
  }

  function recordPhysicsStepFailure(): void {
    physicsStepFailures += 1
  }

  function recordPhysicsInputRequest(count: number): void {
    physicsInputRequests += 1
    physicsInputRequestCount += Math.max(1, Math.trunc(finiteOrZero(count)))
  }

  function recordPhysicsInputDeferred(): void {
    physicsInputDeferredFrames += 1
  }

  function recordPhysicsInputReply(durationMs: number): void {
    physicsInputReplyCount += 1
    const safeDuration = Math.max(0, finiteOrZero(durationMs))
    physicsInputReplyMsSum += safeDuration
    physicsInputReplyMsMax = Math.max(physicsInputReplyMsMax, safeDuration)
  }

  function recordCharacterTarget(stepM: number): void {
    const safeStep = Math.max(0, finiteOrZero(stepM))
    characterTargetUpdates += 1
    characterTargetStepSum += safeStep
    characterTargetStepLast = safeStep
    characterTargetStepMax = Math.max(characterTargetStepMax, safeStep)
  }

  function recordCharacterVisual(sample: MotionProbeCharacterSample): void {
    characterSamples += 1
    const targetError = Math.max(0, finiteOrZero(sample.targetErrorM))
    const correction = Math.max(0, finiteOrZero(sample.correctionM))
    characterTargetErrorSum += targetError
    characterTargetErrorMax = Math.max(characterTargetErrorMax, targetError)
    characterCorrectionSum += correction
    characterCorrectionMax = Math.max(characterCorrectionMax, correction)
  }

  function recordCamera(sample: MotionProbeCameraSample): void {
    cameraSamples += 1
    activeSeen = activeSeen || (
      sample.input.touchActive
      || Math.abs(sample.input.moveZ) > 1e-3
      || Math.abs(sample.input.moveX) > 1e-3
      || Math.abs(sample.input.turn) > 1e-4
    )

    const cameraStep = hasPreviousCameraSample
      ? distance(cameraPreviousPosition, sample.camera)
      : 0
    const anchorStep = hasPreviousCameraSample
      ? distance(cameraPreviousAnchor, sample.anchor)
      : 0
    const desiredError = distance(sample.camera, sample.desiredCamera)
    const targetError = distance(sample.controlsTarget, sample.desiredTarget)
    const anchorDistance = distance(sample.camera, sample.anchor)
    const upChange = hasPreviousCameraSample
      ? angleDegrees(cameraPreviousUp, sample.cameraUp)
      : 0
    const forwardChange = hasPreviousCameraSample
      ? angleDegrees(cameraPreviousForward, sample.desiredForward)
      : 0
    const groundNormalChange = hasPreviousCameraSample
      ? angleDegrees(cameraPreviousGroundNormal, sample.groundNormal)
      : 0

    cameraLastStep = cameraStep
    cameraStepMax = Math.max(cameraStepMax, cameraStep)
    cameraAnchorStepLast = anchorStep
    cameraAnchorStepMax = Math.max(cameraAnchorStepMax, anchorStep)
    cameraDesiredPositionErrorLast = desiredError
    cameraDesiredPositionErrorMax = Math.max(cameraDesiredPositionErrorMax, desiredError)
    cameraTargetErrorLast = targetError
    cameraTargetErrorMax = Math.max(cameraTargetErrorMax, targetError)
    cameraUpChangeLast = upChange
    cameraUpChangeMax = Math.max(cameraUpChangeMax, upChange)
    cameraForwardChangeLast = forwardChange
    cameraForwardChangeMax = Math.max(cameraForwardChangeMax, forwardChange)
    cameraGroundNormalChangeLast = groundNormalChange
    cameraGroundNormalChangeMax = Math.max(cameraGroundNormalChangeMax, groundNormalChange)
    cameraDistanceLast = anchorDistance
    cameraDistanceMin = Math.min(cameraDistanceMin, anchorDistance)
    cameraDistanceMax = Math.max(cameraDistanceMax, anchorDistance)
    cameraPosition.x = sample.camera.x
    cameraPosition.y = sample.camera.y
    cameraPosition.z = sample.camera.z
    cameraTarget.x = sample.controlsTarget.x
    cameraTarget.y = sample.controlsTarget.y
    cameraTarget.z = sample.controlsTarget.z
    cameraDesiredPosition.x = sample.desiredCamera.x
    cameraDesiredPosition.y = sample.desiredCamera.y
    cameraDesiredPosition.z = sample.desiredCamera.z
    cameraDesiredTarget.x = sample.desiredTarget.x
    cameraDesiredTarget.y = sample.desiredTarget.y
    cameraDesiredTarget.z = sample.desiredTarget.z
    cameraUp.x = sample.cameraUp.x
    cameraUp.y = sample.cameraUp.y
    cameraUp.z = sample.cameraUp.z
    cameraDesiredForward.x = sample.desiredForward.x
    cameraDesiredForward.y = sample.desiredForward.y
    cameraDesiredForward.z = sample.desiredForward.z
    cameraGroundNormal.x = sample.groundNormal.x
    cameraGroundNormal.y = sample.groundNormal.y
    cameraGroundNormal.z = sample.groundNormal.z
    cameraPositionLerpSpeed = sample.positionLerpSpeed
    cameraTargetLerpSpeed = sample.targetLerpSpeed
    cameraInput.source = sample.input.source
    cameraInput.touchActive = sample.input.touchActive
    cameraInput.rawX = sample.input.rawX
    cameraInput.rawY = sample.input.rawY
    cameraInput.moveX = sample.input.moveX
    cameraInput.moveZ = sample.input.moveZ
    cameraInput.turn = sample.input.turn
    cameraInput.desiredYaw = sample.input.desiredYaw
    cameraInput.resolvedYaw = sample.input.resolvedYaw
    cameraPreviousAnchor.x = sample.anchor.x
    cameraPreviousAnchor.y = sample.anchor.y
    cameraPreviousAnchor.z = sample.anchor.z
    cameraPreviousPosition.x = sample.camera.x
    cameraPreviousPosition.y = sample.camera.y
    cameraPreviousPosition.z = sample.camera.z
    cameraPreviousUp.x = sample.cameraUp.x
    cameraPreviousUp.y = sample.cameraUp.y
    cameraPreviousUp.z = sample.cameraUp.z
    cameraPreviousForward.x = sample.desiredForward.x
    cameraPreviousForward.y = sample.desiredForward.y
    cameraPreviousForward.z = sample.desiredForward.z
    cameraPreviousGroundNormal.x = sample.groundNormal.x
    cameraPreviousGroundNormal.y = sample.groundNormal.y
    cameraPreviousGroundNormal.z = sample.groundNormal.z
    hasPreviousCameraSample = true
  }

  return {
    setPlatform,
    recordFrame,
    recordFrameWork,
    setPhysicsRuntimeState,
    recordPhysicsStepRequest,
    recordPhysicsStepReply,
    recordPhysicsStepFailure,
    recordPhysicsInputRequest,
    recordPhysicsInputDeferred,
    recordPhysicsInputReply,
    recordCharacterTarget,
    recordCharacterVisual,
    recordCamera,
    flush,
    reset: resetTracking,
  }
}

export type MotionDiagnosticsProbe = ReturnType<typeof createMotionDiagnosticsProbe>
