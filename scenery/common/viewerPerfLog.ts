export const VIEWER_PERF_LOG_PREFIX = '[VIEWER_PERF]'

export const VIEWER_PERF_SECTIONS = [
  'debug',
  'camera',
  'components',
  'animation',
  'vehicles',
  'physicsLocal',
  'physicsBridge',
  'entities',
  'cameras',
  'overlay',
  'ground',
  'lazy',
  'scatter',
  'instancing',
  'shadows',
  'textures',
  'render',
] as const

export type ViewerPerfSection = typeof VIEWER_PERF_SECTIONS[number]
export type ViewerPerfPrimitive = string | number | boolean | null
export type ViewerPerfValue = ViewerPerfPrimitive | ViewerPerfValue[] | ViewerPerfRecord

export interface ViewerPerfRecord {
  [key: string]: ViewerPerfValue | undefined
}

export type ViewerPerfFields = ViewerPerfRecord

export interface ViewerPerfLogger {
  readonly runId: string
  readonly startedAtMs: number
  now(): number
  elapsedMs(): number
  emit(event: string, fields?: ViewerPerfRecord): void
}

export interface ViewerPerfRendererMetrics {
  calls: number
  triangles: number
  points: number
  lines: number
  geometries: number
  textures: number
  programs: number
  pixelRatio: number
  drawingBufferWidth: number
  drawingBufferHeight: number
  renderMs: number
}

export interface ViewerPerfFrameFlags extends ViewerPerfRecord {
  mode: string
  overlay: string
  memoryGuard: string
  memoryExtreme: boolean
  hasCharacter: boolean
  hasVehicle: boolean
  activeTours: number
  nodes: number
  lazyLoads: number
  deferredInstancing: number
  instancedAssets: number
  instances: number
  scatterVisible: number
  scatterTotal: number
  waterHandles: number
  physicsBridge: string
  groundCollisionPending: boolean
  warnings: number
}

export interface ViewerPerfFrameProfiler {
  beginFrame(frameIntervalMs: number): void
  lap(section: ViewerPerfSection): number
  endFrame(metrics: ViewerPerfRendererMetrics): void
  finish(reason: string): void
}

export interface ViewerPerfFrameProfilerOptions {
  logger: ViewerPerfLogger
  getFlags: () => ViewerPerfFrameFlags
}

const FRAME_LONG_THRESHOLD_MS = 50
const FRAME_STALL_THRESHOLD_MS = 250
const FRAME_STALL_LOG_INTERVAL_MS = 2000
const FRAME_FAST_SAMPLE_INTERVAL_MS = 1000
const FRAME_SLOW_SAMPLE_INTERVAL_MS = 5000
const FRAME_FAST_SAMPLE_DURATION_MS = 10_000
const PERF_STRING_LIMIT = 160

export function viewerPerfNow(): number {
  const hostPerformance = globalThis.performance
  if (hostPerformance && typeof hostPerformance.now === 'function') {
    const value = hostPerformance.now()
    if (Number.isFinite(value)) {
      return value
    }
  }
  return Date.now()
}

export function roundViewerPerf(value: number | null | undefined, digits = 1): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const scale = 10 ** Math.max(0, Math.min(3, Math.trunc(digits)))
  const rounded = Math.round(value * scale) / scale
  return Object.is(rounded, -0) ? 0 : rounded
}

export function hashViewerPerfIdentity(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return null
  }
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sanitizePerfString(value: string): string {
  const normalized = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/\b(access_token|token|ticket|secret|password|authorization)=([^\s&;,]+)/gi, '$1=[redacted]')
    .trim()
  return normalized.length > PERF_STRING_LIMIT
    ? `${normalized.slice(0, PERF_STRING_LIMIT - 1)}…`
    : normalized
}

function perfJsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'string') {
    return sanitizePerfString(value)
  }
  return value
}

export function formatViewerPerfRecord(record: ViewerPerfRecord): string {
  try {
    const json = JSON.stringify(record, perfJsonReplacer)
    if (json) {
      return `${VIEWER_PERF_LOG_PREFIX} ${json}`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `${VIEWER_PERF_LOG_PREFIX} ${JSON.stringify({
      v: 1,
      event: 'serialization_error',
      message: sanitizePerfString(message),
    })}`
  }
  return `${VIEWER_PERF_LOG_PREFIX} ${JSON.stringify({
    v: 1,
    event: 'serialization_error',
    message: 'empty perf record',
  })}`
}

export function createViewerPerfLogger(): ViewerPerfLogger {
  const startedAtMs = Date.now()
  const startedAtPerfMs = viewerPerfNow()
  const runId = `r${startedAtMs.toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`

  const elapsedMs = (): number => {
    const nowMs = viewerPerfNow()
    return Math.max(0, nowMs - startedAtPerfMs)
  }

  const emit = (event: string, fields: ViewerPerfRecord = {}): void => {
    const record: ViewerPerfRecord = {
      v: 1,
      run: runId,
      event,
      tMs: roundViewerPerf(elapsedMs(), 1) ?? 0,
      ...fields,
    }
    const line = formatViewerPerfRecord(record)
    try {
      console.log(line)
    } catch {
      // Diagnostics must never interrupt rendering.
    }
  }

  return {
    runId,
    startedAtMs,
    now: viewerPerfNow,
    elapsedMs,
    emit,
  }
}

function createSectionNumbers(): Record<ViewerPerfSection, number> {
  const values = {} as Record<ViewerPerfSection, number>
  VIEWER_PERF_SECTIONS.forEach((section) => {
    values[section] = 0
  })
  return values
}

function resetSectionNumbers(values: Record<ViewerPerfSection, number>): void {
  VIEWER_PERF_SECTIONS.forEach((section) => {
    values[section] = 0
  })
}

function percentile(sortedValues: number[], ratio: number): number | null {
  if (!sortedValues.length) {
    return null
  }
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1))
  return sortedValues[index] ?? null
}

function roundSectionRecord(values: Record<ViewerPerfSection, number>): ViewerPerfRecord {
  const output: ViewerPerfRecord = {}
  VIEWER_PERF_SECTIONS.forEach((section) => {
    output[section] = roundViewerPerf(values[section], 1) ?? 0
  })
  return output
}

export function createViewerPerfRendererPayload(metrics: ViewerPerfRendererMetrics): ViewerPerfRecord {
  return {
    pr: roundViewerPerf(metrics.pixelRatio, 2),
    buffer: `${Math.max(0, Math.trunc(metrics.drawingBufferWidth))}x${Math.max(0, Math.trunc(metrics.drawingBufferHeight))}`,
    calls: Math.max(0, Math.trunc(metrics.calls)),
    tris: Math.max(0, Math.trunc(metrics.triangles)),
    points: Math.max(0, Math.trunc(metrics.points)),
    lines: Math.max(0, Math.trunc(metrics.lines)),
    geo: Math.max(0, Math.trunc(metrics.geometries)),
    tex: Math.max(0, Math.trunc(metrics.textures)),
    prog: Math.max(0, Math.trunc(metrics.programs)),
    submitMs: roundViewerPerf(metrics.renderMs, 1),
  }
}

export function createViewerPerfFrameProfiler(
  options: ViewerPerfFrameProfilerOptions,
): ViewerPerfFrameProfiler {
  const { logger, getFlags } = options
  const currentSections = createSectionNumbers()
  const windowSectionSums = createSectionNumbers()
  const windowSectionMax = createSectionNumbers()
  const windowIntervals: number[] = []

  let lastLapAtMs = 0
  let currentFrameIntervalMs = 0
  let currentScriptMs = 0
  let windowStartedAtMs = 0
  let windowDurationMs = 0
  let windowFrames = 0
  let windowLongFrames = 0
  let windowScriptSumMs = 0
  let windowScriptMaxMs = 0
  let windowOutsideCallbackSumMs = 0
  let firstFramePerfMs = 0
  let latestMetrics: ViewerPerfRendererMetrics = {
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    pixelRatio: 1,
    drawingBufferWidth: 0,
    drawingBufferHeight: 0,
    renderMs: 0,
  }
  let totalFrames = 0
  let totalIntervalMs = 0
  let worstFrameMs = 0
  let worstSection: ViewerPerfSection | null = null
  let worstSectionMs = 0
  let sampleCount = 0
  let stallCount = 0
  let lastStallLoggedAtMs = Number.NEGATIVE_INFINITY
  let warmupEmitted = false
  let summaryEmitted = false

  const resetWindow = (nowMs: number): void => {
    windowStartedAtMs = nowMs
    windowDurationMs = 0
    windowFrames = 0
    windowLongFrames = 0
    windowScriptSumMs = 0
    windowScriptMaxMs = 0
    windowOutsideCallbackSumMs = 0
    windowIntervals.length = 0
    resetSectionNumbers(windowSectionSums)
    resetSectionNumbers(windowSectionMax)
  }

  const emitWarmupSummary = (nowMs: number): void => {
    if (warmupEmitted || !firstFramePerfMs || nowMs - firstFramePerfMs < FRAME_FAST_SAMPLE_DURATION_MS) {
      return
    }
    warmupEmitted = true
    const fps = totalIntervalMs > 0 ? (totalFrames * 1000) / totalIntervalMs : null
    logger.emit('warmup', {
      durationMs: roundViewerPerf(nowMs - firstFramePerfMs, 1),
      frames: totalFrames,
      fps: roundViewerPerf(fps, 1),
      worstFrameMs: roundViewerPerf(worstFrameMs, 1),
      worstSection,
      worstSectionMs: roundViewerPerf(worstSectionMs, 1),
      samples: sampleCount,
      stalls: stallCount,
    })
  }

  const emitWindow = (nowMs: number): void => {
    if (windowFrames <= 0 || windowDurationMs <= 0) {
      resetWindow(nowMs)
      return
    }
    const sortedIntervals = windowIntervals.slice().sort((left, right) => left - right)
    const fps = (windowFrames * 1000) / windowDurationMs
    const sectionsAvg: Record<ViewerPerfSection, number> = createSectionNumbers()
    const sectionsMax: Record<ViewerPerfSection, number> = createSectionNumbers()
    VIEWER_PERF_SECTIONS.forEach((section) => {
      sectionsAvg[section] = windowSectionSums[section] / windowFrames
      sectionsMax[section] = windowSectionMax[section]
    })

    sampleCount += 1
    logger.emit('frame', {
      windowMs: roundViewerPerf(windowDurationMs, 1),
      frames: windowFrames,
      fps: roundViewerPerf(fps, 1),
      p50Ms: roundViewerPerf(percentile(sortedIntervals, 0.5), 1),
      p95Ms: roundViewerPerf(percentile(sortedIntervals, 0.95), 1),
      maxMs: roundViewerPerf(sortedIntervals[sortedIntervals.length - 1] ?? null, 1),
      longFrames: windowLongFrames,
      scriptAvgMs: roundViewerPerf(windowScriptSumMs / windowFrames, 1),
      scriptMaxMs: roundViewerPerf(windowScriptMaxMs, 1),
      outsideCallbackMs: roundViewerPerf(windowOutsideCallbackSumMs / windowFrames, 1),
      sectionsAvgMs: roundSectionRecord(sectionsAvg),
      sectionsMaxMs: roundSectionRecord(sectionsMax),
      render: createViewerPerfRendererPayload(latestMetrics),
      flags: getFlags(),
    })
    resetWindow(nowMs)
  }

  const beginFrame = (frameIntervalMs: number): void => {
    const nowMs = logger.now()
    lastLapAtMs = nowMs
    currentFrameIntervalMs = Number.isFinite(frameIntervalMs) ? Math.max(0, frameIntervalMs) : 0
    currentScriptMs = 0
    resetSectionNumbers(currentSections)
  }

  const lap = (section: ViewerPerfSection): number => {
    const nowMs = logger.now()
    const elapsedMs = Math.max(0, nowMs - lastLapAtMs)
    currentSections[section] += elapsedMs
    currentScriptMs += elapsedMs
    lastLapAtMs = nowMs
    return elapsedMs
  }

  const endFrame = (metrics: ViewerPerfRendererMetrics): void => {
    latestMetrics = {
      calls: metrics.calls,
      triangles: metrics.triangles,
      points: metrics.points,
      lines: metrics.lines,
      geometries: metrics.geometries,
      textures: metrics.textures,
      programs: metrics.programs,
      pixelRatio: metrics.pixelRatio,
      drawingBufferWidth: metrics.drawingBufferWidth,
      drawingBufferHeight: metrics.drawingBufferHeight,
      renderMs: metrics.renderMs,
    }

    if (currentFrameIntervalMs <= 0) {
      return
    }

    const nowMs = logger.now()
    if (!firstFramePerfMs) {
      firstFramePerfMs = nowMs
      windowStartedAtMs = nowMs
    }

    totalFrames += 1
    totalIntervalMs += currentFrameIntervalMs
    worstFrameMs = Math.max(worstFrameMs, currentFrameIntervalMs)
    VIEWER_PERF_SECTIONS.forEach((section) => {
      const sectionMs = currentSections[section]
      if (sectionMs > worstSectionMs) {
        worstSectionMs = sectionMs
        worstSection = section
      }
    })

    windowFrames += 1
    windowDurationMs += currentFrameIntervalMs
    windowScriptSumMs += currentScriptMs
    windowScriptMaxMs = Math.max(windowScriptMaxMs, currentScriptMs)
    windowOutsideCallbackSumMs += Math.max(0, currentFrameIntervalMs - currentScriptMs)
    windowIntervals.push(currentFrameIntervalMs)
    if (currentFrameIntervalMs > FRAME_LONG_THRESHOLD_MS) {
      windowLongFrames += 1
    }
    VIEWER_PERF_SECTIONS.forEach((section) => {
      const sectionMs = currentSections[section]
      windowSectionSums[section] += sectionMs
      windowSectionMax[section] = Math.max(windowSectionMax[section], sectionMs)
    })

    if (
      currentFrameIntervalMs >= FRAME_STALL_THRESHOLD_MS
      && nowMs - lastStallLoggedAtMs >= FRAME_STALL_LOG_INTERVAL_MS
    ) {
      lastStallLoggedAtMs = nowMs
      stallCount += 1
      logger.emit('stall', {
        frameMs: roundViewerPerf(currentFrameIntervalMs, 1),
        scriptMs: roundViewerPerf(currentScriptMs, 1),
        outsideCallbackMs: roundViewerPerf(Math.max(0, currentFrameIntervalMs - currentScriptMs), 1),
        sectionsMs: roundSectionRecord(currentSections),
        render: createViewerPerfRendererPayload(metrics),
        flags: getFlags(),
      })
    }

    const runtimeMs = nowMs - firstFramePerfMs
    const sampleIntervalMs = runtimeMs < FRAME_FAST_SAMPLE_DURATION_MS
      ? FRAME_FAST_SAMPLE_INTERVAL_MS
      : FRAME_SLOW_SAMPLE_INTERVAL_MS
    if (windowStartedAtMs > 0 && nowMs - windowStartedAtMs >= sampleIntervalMs) {
      emitWindow(nowMs)
    }
    emitWarmupSummary(nowMs)
  }

  const finish = (reason: string): void => {
    if (summaryEmitted) {
      return
    }
    summaryEmitted = true
    const elapsedMs = firstFramePerfMs > 0 ? logger.now() - firstFramePerfMs : 0
    const fps = totalIntervalMs > 0 ? (totalFrames * 1000) / totalIntervalMs : null
    logger.emit('summary', {
      reason,
      durationMs: roundViewerPerf(elapsedMs, 1),
      frames: totalFrames,
      fps: roundViewerPerf(fps, 1),
      worstFrameMs: roundViewerPerf(worstFrameMs, 1),
      worstSection,
      worstSectionMs: roundViewerPerf(worstSectionMs, 1),
      samples: sampleCount,
      stalls: stallCount,
    })
  }

  return {
    beginFrame,
    lap,
    endFrame,
    finish,
  }
}
