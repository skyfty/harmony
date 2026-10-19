import type { SceneJsonExportDocument, SceneNode, SceneNodeComponentState } from '@harmony/schema/core'
import type { ProceduralLandscapeComponentProps } from '@harmony/schema/proceduralLandscape/config'
import type { ProceduralLandscapeRuntimeStats } from '@harmony/schema/proceduralLandscape/runtime'
import type { SlowroadsAssetStoreStats, SlowroadsTextureDiagnostic } from '@harmony/schema/slowroads/assets/assetStore'

/**
 * Temporary runtime diagnostics for the mini-program landscape investigation.
 * Every emitted line is a single JSON string so it can be copied verbatim from
 * the real-device console. Set this to false (or remove the logger wiring) once
 * the investigation is complete.
 */
export const LANDSCAPE_DIAGNOSTICS_ENABLED = true

const DIAGNOSTICS_VERSION = 1
const BOOT_DELAY_MS = 2000
const CORE_INTERVAL_MS = 10_000
const TEXTURE_INTERVAL_MS = 30_000
const WARNING_CHECK_INTERVAL_MS = 1000
const WARNING_LOG_MIN_INTERVAL_MS = 2000
const MAX_WARNINGS = 12
const LANDSCAPE_COMPONENT_TYPE = 'proceduralLandscape'

export interface LandscapeDiagnosticsRenderer {
  info?: {
    render?: {
      calls?: number
      triangles?: number
    }
    memory?: {
      textures?: number
      geometries?: number
    }
    programs?: unknown[] | null
  }
  capabilities?: {
    maxTextureSize?: number
    maxTextures?: number
    isWebGL2?: boolean
    getMaxAnisotropy?: () => number
  }
  getPixelRatio?: () => number
}

export interface LandscapeDiagnosticsAssetStore {
  stats(): SlowroadsAssetStoreStats
  textureDiagnostics(): SlowroadsTextureDiagnostic[]
}

export interface LandscapeDiagnosticsMemoryGuard {
  enabled?: boolean
  state?: string
  extreme?: boolean
  warningCount?: number
  deviceMemoryMb?: number
  deviceBenchmarkLevel?: number
}

export interface LandscapeDiagnosticsEnvironment {
  season: string
  timeOfDay: string
  weather: string
}

export interface LandscapeDiagnosticsContext {
  getDocument: () => SceneJsonExportDocument | null
  getRenderer: () => LandscapeDiagnosticsRenderer | null
  getCanvasSize: () => { width: number; height: number } | null
  getWarnings: () => readonly string[]
  getMemoryGuard: () => LandscapeDiagnosticsMemoryGuard | null
  getAssetCacheBytes: () => number
  getEnvironment: () => LandscapeDiagnosticsEnvironment | null
  getCameraPosition: () => { x: number; y: number; z: number } | null
  getLandscapeStats: (nodeId: string) => ProceduralLandscapeRuntimeStats | null
  getAssetStore: () => LandscapeDiagnosticsAssetStore | null
  /** Test seam; defaults to console.log. Must receive exactly one string. */
  log?: (line: string) => void
  /** Test seam; defaults to Date.now. */
  now?: () => number
}

export interface LandscapeDiagnosticsLogger {
  start(): void
  tick(deltaSeconds: number): void
  dump(): void
  dispose(): void
}

type LandscapeEntry = {
  node: SceneNode
  component: SceneNodeComponentState<ProceduralLandscapeComponentProps>
  stats: ProceduralLandscapeRuntimeStats | null
}

type DiagnosticGlobal = typeof globalThis & {
  __HARMONY_PL_DIAG__?: {
    dump: () => void
    stop: () => void
  }
  wx?: {
    getDeviceInfo?: () => Record<string, unknown>
    getSystemInfoSync?: () => Record<string, unknown>
    getWindowInfo?: () => Record<string, unknown>
    getAppBaseInfo?: () => Record<string, unknown>
  }
  uni?: {
    getSystemInfoSync?: () => Record<string, unknown>
  }
}

function roundNumber(value: unknown, digits = 1): number | null {
  if (value == null || value === '') {
    return null
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }
  const factor = 10 ** digits
  return Math.round(numeric * factor) / factor
}

function finiteInteger(value: unknown): number | null {
  const rounded = roundNumber(value, 0)
  return rounded == null ? null : Math.trunc(rounded)
}

function megabytes(value: unknown): number | null {
  const bytes = roundNumber(value, 0)
  return bytes == null ? null : roundNumber(bytes / 1048576, 2)
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  return cleanText(record?.[key])
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  return roundNumber(record?.[key], 0)
}

function safeCall<T>(callback: (() => T) | undefined): T | null {
  if (typeof callback !== 'function') {
    return null
  }
  try {
    return callback()
  } catch {
    return null
  }
}

function readDeviceInfo(): Record<string, unknown> {
  const globalObject = globalThis as DiagnosticGlobal
  const device = safeCall(() => globalObject.wx?.getDeviceInfo?.())
    ?? safeCall(() => globalObject.wx?.getSystemInfoSync?.())
    ?? safeCall(() => globalObject.uni?.getSystemInfoSync?.())
  const windowInfo = safeCall(() => globalObject.wx?.getWindowInfo?.())
  const appInfo = safeCall(() => globalObject.wx?.getAppBaseInfo?.())
  return {
    platform: readString(device, 'platform'),
    model: readString(device, 'model'),
    system: readString(device, 'system'),
    benchmarkLevel: readNumber(device, 'benchmarkLevel'),
    memorySizeMb: readNumber(device, 'memorySize'),
    pixelRatio: readNumber(windowInfo, 'pixelRatio') ?? readNumber(device, 'pixelRatio'),
    screenWidth: readNumber(windowInfo, 'screenWidth') ?? readNumber(device, 'screenWidth'),
    screenHeight: readNumber(windowInfo, 'screenHeight') ?? readNumber(device, 'screenHeight'),
    sdkVersion: readString(appInfo, 'SDKVersion') ?? readString(device, 'SDKVersion'),
  }
}

function readMaxAnisotropy(renderer: LandscapeDiagnosticsRenderer | null): number | null {
  try {
    return roundNumber(renderer?.capabilities?.getMaxAnisotropy?.(), 1)
  } catch {
    return null
  }
}

function collectLandscapeEntries(
  document: SceneJsonExportDocument | null,
  getStats: (nodeId: string) => ProceduralLandscapeRuntimeStats | null,
): LandscapeEntry[] {
  const entries: LandscapeEntry[] = []
  const visit = (nodes: SceneNode[] | undefined): void => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (const node of nodes) {
      const component = (
        node.components?.[LANDSCAPE_COMPONENT_TYPE]
      ) as SceneNodeComponentState<ProceduralLandscapeComponentProps> | undefined
      if (component) {
        entries.push({
          node,
          component,
          stats: getStats(node.id),
        })
      }
      visit(node.children)
    }
  }
  visit(document?.nodes)
  return entries
}

function summarizeCamera(position: { x: number; y: number; z: number } | null): Record<string, number | null> | null {
  if (!position) {
    return null
  }
  return {
    x: roundNumber(position.x, 1),
    y: roundNumber(position.y, 1),
    z: roundNumber(position.z, 1),
  }
}

function summarizeProps(props: ProceduralLandscapeComponentProps): Record<string, unknown> {
  return {
    surfaceEnabled: props.surface?.enabled !== false,
    surfaceTextures: props.surface?.textures !== false,
    baseMapMode: props.surface?.baseMapMode ?? null,
    viewDistanceScale: roundNumber(props.surface?.viewDistanceScale, 2),
    forestCoverage: roundNumber(props.forest?.coverage, 2),
    forestDensity: roundNumber(props.forest?.density, 2),
    nearDistance: roundNumber(props.forest?.nearDistance, 1),
    nearTreeRadius: roundNumber(props.forest?.nearTreeRadius, 1),
    minScale: roundNumber(props.forest?.minScale, 1),
    maxScale: roundNumber(props.forest?.maxScale, 1),
    grassEnabled: props.grass?.enabled !== false,
    grassDensity: roundNumber(props.grass?.density, 2),
    bushesEnabled: props.bushes?.enabled !== false,
    roadEnabled: props.road?.enabled !== false,
    waterEnabled: props.water?.enabled !== false,
    wallDrystone: props.walls?.drystone?.enabled !== false,
    wallFence: props.walls?.fence?.enabled !== false,
    wallBarrier: props.walls?.barrier?.enabled !== false,
    wallSeaWall: props.walls?.seaWall?.enabled !== false,
  }
}

function summarizeStats(stats: ProceduralLandscapeRuntimeStats): Record<string, unknown> {
  return {
    phase: stats.phase,
    progress: roundNumber(stats.progress, 3),
    quality: stats.quality,
    demStatus: stats.demStatus,
    demSampleStep: finiteInteger(stats.demSampleStep),
    demBuildMs: roundNumber(stats.demBuildMs, 0),
    demError: cleanText(stats.demError),
    demMeshMB: megabytes(stats.demMeshBytes),
    demOrthoStatus: stats.demOrthoStatus,
    demOrthoBytes: stats.demOrthoBytes,
    demOrthoWidth: finiteInteger(stats.demOrthoWidth),
    demOrthoHeight: finiteInteger(stats.demOrthoHeight),
    demOrthoCoverage: roundNumber(stats.demOrthoCoverage, 3),
    demOrthoError: cleanText(stats.demOrthoError),
    worldForestInstances: finiteInteger(stats.worldForestInstances),
    broadleafTreeInstances: finiteInteger(stats.broadleafTreeInstances),
    coniferTreeInstances: finiteInteger(stats.coniferTreeInstances),
    coniferTreeFraction: roundNumber(stats.coniferTreeFraction, 3),
    treeLineMidY: roundNumber(stats.treeLineMidY, 1),
    treeLineTopY: roundNumber(stats.treeLineTopY, 1),
    nearTreeInstances: finiteInteger(stats.nearTreeInstances),
    nearCardInstances: finiteInteger(stats.nearCardInstances),
    nearTreeReady: stats.nearTreeReady === true,
    adaptive: stats.adaptive ? { ...stats.adaptive } : null,
    treeInstances: finiteInteger(stats.treeInstances),
    grassInstances: finiteInteger(stats.grassInstances),
    bushInstances: finiteInteger(stats.bushInstances),
    barrierInstances: finiteInteger(stats.barrierInstances),
    wallSegmentCount: finiteInteger(stats.wallSegmentCount),
    treeChunkCount: finiteInteger(stats.treeChunkCount),
    roadChunkCount: finiteInteger(stats.roadChunkCount),
    cameraGrassChunkCount: finiteInteger(stats.cameraGrassChunkCount),
    worldForestBuildMs: roundNumber(stats.worldForestBuildMs, 0),
    gridCols: finiteInteger(stats.gridCols),
    gridRows: finiteInteger(stats.gridRows),
    gridCellSize: roundNumber(stats.gridCellSize, 2),
    memoryMB: megabytes(stats.memoryBytes),
    roadLength: roundNumber(stats.roadLength, 1),
    roadNodeCount: finiteInteger(stats.roadNodeCount),
    roadComplete: stats.roadComplete === true,
    roadFailureReason: cleanText(stats.roadFailureReason),
    season: stats.season,
    seasonAssetsReady: stats.seasonAssetsReady,
    viewDistanceScale: roundNumber(stats.viewDistanceScale, 2),
    warnings: Array.isArray(stats.warnings) ? stats.warnings.slice(0, 6) : [],
  }
}

function mergeWarnings(groups: ReadonlyArray<readonly string[] | null | undefined>): string[] {
  const seen = new Set<string>()
  const warnings: string[] = []
  for (const group of groups) {
    for (const item of group ?? []) {
      const text = cleanText(item)
      if (!text || seen.has(text)) {
        continue
      }
      seen.add(text)
      warnings.push(text)
      if (warnings.length >= MAX_WARNINGS) {
        return warnings
      }
    }
  }
  return warnings
}

function summarizeAssets(stats: SlowroadsAssetStoreStats | null): Record<string, unknown> | null {
  if (!stats) {
    return null
  }
  return {
    variant: stats.variant,
    textureCount: finiteInteger(stats.textureCount),
    residentMB: megabytes(stats.residentBytes),
    downloadedMB: megabytes(stats.downloadedBytes),
    pendingDownloads: finiteInteger(stats.pendingDownloads),
  }
}

function summarizeTextures(textures: SlowroadsTextureDiagnostic[]): Array<Record<string, unknown>> {
  return textures.map((texture) => ({
    id: texture.id,
    w: finiteInteger(texture.width),
    h: finiteInteger(texture.height),
    mb: megabytes(texture.estimatedBytes),
    aniso: roundNumber(texture.anisotropy, 1),
    mip: texture.generateMipmaps === true,
  }))
}

export function createLandscapeDiagnosticsLogger(
  context: LandscapeDiagnosticsContext,
): LandscapeDiagnosticsLogger {
  const now = context.now ?? (() => Date.now())
  const writeLine = context.log ?? ((line: string) => {
    console.log(line)
  })
  let startedAt = 0
  let sequence = 0
  let frameCount = 0
  let frameSeconds = 0
  let lastWarningCheckAt = 0
  let lastWarningLogAt = Number.NEGATIVE_INFINITY
  let lastWarningSignature = ''
  let lastGuardSignature = ''
  let lastTextureSignature = ''
  let started = false
  let disposed = false
  let bootTimer: ReturnType<typeof setTimeout> | null = null
  let coreTimer: ReturnType<typeof setInterval> | null = null
  let textureTimer: ReturnType<typeof setInterval> | null = null
  let globalHandle: NonNullable<DiagnosticGlobal['__HARMONY_PL_DIAG__']> | null = null

  function emit(prefix: string, payload: Record<string, unknown>): void {
    writeLine(`${prefix} ${JSON.stringify(payload)}`)
  }

  function currentWarnings(entries: LandscapeEntry[], assets: SlowroadsAssetStoreStats | null): string[] {
    return mergeWarnings([
      context.getWarnings(),
      ...entries.map((entry) => entry.stats?.warnings),
      assets?.warnings,
    ])
  }

  function warningSignature(): string {
    const entries = collectLandscapeEntries(context.getDocument(), context.getLandscapeStats)
    const assets = context.getAssetStore()?.stats() ?? null
    return currentWarnings(entries, assets).join('|')
  }

  function memoryGuardSignature(): string {
    const guard = context.getMemoryGuard()
    return [
      guard?.state ?? '',
      guard?.extreme === true ? '1' : '0',
      finiteInteger(guard?.warningCount) ?? '',
      finiteInteger(guard?.deviceMemoryMb) ?? '',
      finiteInteger(guard?.deviceBenchmarkLevel) ?? '',
    ].join(':')
  }

  function logGuard(): void {
    if (!started || disposed) {
      return
    }
    const guard = context.getMemoryGuard()
    emit('[PL-DIAG-GUARD]', {
      v: DIAGNOSTICS_VERSION,
      type: 'guard',
      t: new Date(now()).toISOString(),
      state: cleanText(guard?.state),
      extreme: guard?.extreme === true,
      warningCount: finiteInteger(guard?.warningCount),
      deviceMemoryMb: finiteInteger(guard?.deviceMemoryMb),
      deviceBenchmarkLevel: finiteInteger(guard?.deviceBenchmarkLevel),
      pixelRatio: roundNumber(context.getRenderer()?.getPixelRatio?.(), 2),
    })
  }

  function buildBootPayload(): Record<string, unknown> {
    const document = context.getDocument()
    const renderer = context.getRenderer()
    const assets = context.getAssetStore()?.stats() ?? null
    const entries = collectLandscapeEntries(document, context.getLandscapeStats)
    return {
      v: DIAGNOSTICS_VERSION,
      type: 'boot',
      t: new Date(now()).toISOString(),
      scene: {
        id: document?.id ?? null,
        name: document?.name ?? null,
      },
      env: context.getEnvironment(),
      camera: summarizeCamera(context.getCameraPosition()),
      device: readDeviceInfo(),
      renderer: {
        maxTextureSize: finiteInteger(renderer?.capabilities?.maxTextureSize),
        maxTextures: finiteInteger(renderer?.capabilities?.maxTextures),
        maxAnisotropy: readMaxAnisotropy(renderer),
        isWebGL2: renderer?.capabilities?.isWebGL2 === true,
        pixelRatio: roundNumber(renderer?.getPixelRatio?.(), 2),
      },
      assets: summarizeAssets(assets),
      landscape: entries.map((entry) => ({
        nodeId: entry.node.id,
        nodeName: entry.node.name,
        enabled: entry.component.enabled !== false,
        quality: entry.stats?.quality ?? entry.component.props?.quality ?? null,
        props: summarizeProps(entry.component.props),
      })),
    }
  }

  function buildCorePayload(reason: string): Record<string, unknown> {
    const nowMs = now()
    const document = context.getDocument()
    const renderer = context.getRenderer()
    const canvas = context.getCanvasSize()
    const assets = context.getAssetStore()?.stats() ?? null
    const entries = collectLandscapeEntries(document, context.getLandscapeStats)
    const memoryGuard = context.getMemoryGuard()
    const fps = frameSeconds > 0 ? frameCount / frameSeconds : null
    const frameMs = frameSeconds > 0 && frameCount > 0
      ? (frameSeconds * 1000) / frameCount
      : null
    const info = renderer?.info
    return {
      v: DIAGNOSTICS_VERSION,
      type: 'core',
      seq: ++sequence,
      t: new Date(nowMs).toISOString(),
      elapsedMs: roundNumber(nowMs - startedAt, 0),
      reason,
      fps: roundNumber(fps, 1),
      frameMs: roundNumber(frameMs, 1),
      scene: {
        id: document?.id ?? null,
        name: document?.name ?? null,
      },
      env: context.getEnvironment(),
      camera: summarizeCamera(context.getCameraPosition()),
      renderer: {
        calls: finiteInteger(info?.render?.calls),
        tris: finiteInteger(info?.render?.triangles),
        textures: finiteInteger(info?.memory?.textures),
        geometries: finiteInteger(info?.memory?.geometries),
        programs: Array.isArray(info?.programs) ? info.programs.length : null,
        pixelRatio: roundNumber(renderer?.getPixelRatio?.(), 2),
        width: finiteInteger(canvas?.width),
        height: finiteInteger(canvas?.height),
      },
      memory: {
        guardState: cleanText(memoryGuard?.state),
        guardExtreme: memoryGuard?.extreme === true,
        guardWarnings: finiteInteger(memoryGuard?.warningCount),
        deviceMemoryMb: finiteInteger(memoryGuard?.deviceMemoryMb),
        deviceBenchmarkLevel: finiteInteger(memoryGuard?.deviceBenchmarkLevel),
        assetCacheMB: megabytes(context.getAssetCacheBytes()),
      },
      assets: summarizeAssets(assets),
      landscape: entries.map((entry) => ({
        nodeId: entry.node.id,
        nodeName: entry.node.name,
        enabled: entry.component.enabled !== false,
        props: summarizeProps(entry.component.props),
        stats: entry.stats ? summarizeStats(entry.stats) : null,
      })),
      warnings: currentWarnings(entries, assets),
    }
  }

  function buildTexturePayload(): Record<string, unknown> {
    const store = context.getAssetStore()
    const stats = store?.stats() ?? null
    const textures = store?.textureDiagnostics() ?? []
    return {
      v: DIAGNOSTICS_VERSION,
      type: 'tex',
      seq: ++sequence,
      t: new Date(now()).toISOString(),
      variant: stats?.variant ?? null,
      textureCount: finiteInteger(stats?.textureCount ?? textures.length),
      residentMB: megabytes(stats?.residentBytes ?? 0),
      textures: summarizeTextures(textures),
    }
  }

  function logCore(reason: string): void {
    if (!started || disposed) {
      return
    }
    emit('[PL-DIAG]', buildCorePayload(reason))
    frameCount = 0
    frameSeconds = 0
  }

  function logTextures(reason: string): void {
    if (!started || disposed) {
      return
    }
    const store = context.getAssetStore()
    const stats = store?.stats() ?? null
    const textures = store?.textureDiagnostics() ?? []
    const signature = `${stats?.variant ?? ''}:${stats?.textureCount ?? textures.length}:${stats?.residentBytes ?? 0}`
    lastTextureSignature = signature
    emit('[PL-DIAG-TEX]', {
      ...buildTexturePayload(),
      reason,
    })
  }

  function maybeLogLoadedTextures(): void {
    const stats = context.getAssetStore()?.stats()
    if (!stats || stats.pendingDownloads > 0 || stats.textureCount <= 0) {
      return
    }
    const signature = `${stats.variant}:${stats.textureCount}:${stats.residentBytes}`
    if (signature !== lastTextureSignature) {
      logTextures('loaded')
    }
  }

  function dump(): void {
    if (!started || disposed) {
      return
    }
    logCore('manual')
    logTextures('manual')
  }

  function start(): void {
    if (!LANDSCAPE_DIAGNOSTICS_ENABLED || started || disposed) {
      return
    }
    started = true
    startedAt = now()
    lastWarningCheckAt = startedAt
    lastWarningSignature = warningSignature()
    lastGuardSignature = memoryGuardSignature()
    bootTimer = setTimeout(() => {
      if (disposed) {
        return
      }
      emit('[PL-DIAG-BOOT]', buildBootPayload())
      logTextures('boot')
    }, BOOT_DELAY_MS)
    coreTimer = setInterval(() => {
      logCore('periodic')
      maybeLogLoadedTextures()
    }, CORE_INTERVAL_MS)
    textureTimer = setInterval(() => {
      logTextures('periodic')
    }, TEXTURE_INTERVAL_MS)
    const handle = {
      dump: () => {
        dump()
      },
      stop: () => {
        dispose()
      },
    }
    globalHandle = handle
    ;(globalThis as DiagnosticGlobal).__HARMONY_PL_DIAG__ = handle
  }

  function tick(deltaSeconds: number): void {
    if (!started || disposed) {
      return
    }
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      frameCount += 1
      frameSeconds += deltaSeconds
    }
    const nowMs = now()
    if (nowMs - lastWarningCheckAt < WARNING_CHECK_INTERVAL_MS) {
      return
    }
    lastWarningCheckAt = nowMs
    const guardSignature = memoryGuardSignature()
    if (guardSignature !== lastGuardSignature) {
      lastGuardSignature = guardSignature
      logGuard()
    }
    const signature = warningSignature()
    if (signature === lastWarningSignature) {
      return
    }
    lastWarningSignature = signature
    if (nowMs - lastWarningLogAt < WARNING_LOG_MIN_INTERVAL_MS) {
      return
    }
    lastWarningLogAt = nowMs
    logCore('warning')
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    started = false
    if (bootTimer != null) {
      clearTimeout(bootTimer)
      bootTimer = null
    }
    if (coreTimer != null) {
      clearInterval(coreTimer)
      coreTimer = null
    }
    if (textureTimer != null) {
      clearInterval(textureTimer)
      textureTimer = null
    }
    const globalObject = globalThis as DiagnosticGlobal
    if (globalHandle && globalObject.__HARMONY_PL_DIAG__ === globalHandle) {
      delete globalObject.__HARMONY_PL_DIAG__
    }
    globalHandle = null
  }

  return {
    start,
    tick,
    dump,
    dispose,
  }
}
