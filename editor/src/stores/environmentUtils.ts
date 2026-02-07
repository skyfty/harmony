import type { SceneNode, EnvironmentSettings } from '@harmony/schema'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

export const DEFAULT_ENVIRONMENT_BACKGROUND_COLOR = '#516175'
export const DEFAULT_ENVIRONMENT_AMBIENT_COLOR = '#ffffff'
export const DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY = 3.2
export const DEFAULT_ENVIRONMENT_FOG_COLOR = '#516175'
export const DEFAULT_ENVIRONMENT_FOG_DENSITY = 0.02
export const DEFAULT_ENVIRONMENT_FOG_NEAR = 1
export const DEFAULT_ENVIRONMENT_FOG_FAR = 50
export const DEFAULT_ENVIRONMENT_GRAVITY = 9.81
export const DEFAULT_ENVIRONMENT_RESTITUTION = 0.2
export const DEFAULT_ENVIRONMENT_FRICTION = 0.3
export const DEFAULT_ENVIRONMENT_ORIENTATION_PRESET = 'yUp' as const
export const DEFAULT_ENVIRONMENT_ROTATION_DEGREES = { x: 0, y: 0, z: 0 }

export const DEFAULT_ENVIRONMENT_GRADIENT_OFFSET = 33
export const DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT = 0.6

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  background: {
    mode: 'skybox',
    solidColor: DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
    hdriAssetId: null,
    skycubeFormat: 'faces',
    skycubeZipAssetId: null,
    positiveXAssetId: null,
    negativeXAssetId: null,
    positiveYAssetId: null,
    negativeYAssetId: null,
    positiveZAssetId: null,
    negativeZAssetId: null,
  },
  environmentOrientationPreset: DEFAULT_ENVIRONMENT_ORIENTATION_PRESET,
  environmentRotationDegrees: { ...DEFAULT_ENVIRONMENT_ROTATION_DEGREES },
  ambientLightColor: DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
  ambientLightIntensity: DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
  fogMode: 'none',
  fogColor: DEFAULT_ENVIRONMENT_FOG_COLOR,
  fogDensity: DEFAULT_ENVIRONMENT_FOG_DENSITY,
  fogNear: DEFAULT_ENVIRONMENT_FOG_NEAR,
  fogFar: DEFAULT_ENVIRONMENT_FOG_FAR,
  environmentMap: {
    mode: 'skybox',
    hdriAssetId: null,
  },
  gravityStrength: DEFAULT_ENVIRONMENT_GRAVITY,
  collisionRestitution: DEFAULT_ENVIRONMENT_RESTITUTION,
  collisionFriction: DEFAULT_ENVIRONMENT_FRICTION,
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const sanitized = value.trim()
    if (/^#(?:[0-9a-fA-F]{6})$/.test(sanitized)) {
      return sanitized
    }
  }
  return fallback
}

function normalizeNullableHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const sanitized = value.trim()
  if (!sanitized) {
    return null
  }
  if (/^#(?:[0-9a-fA-F]{6})$/.test(sanitized)) {
    return sanitized
  }
  return null
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  if (numeric < min) return min
  if (numeric > max) return max
  return numeric
}

function normalizeAssetId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeEnvironmentOrientationPreset(value: unknown): EnvironmentSettings['environmentOrientationPreset'] {
  if (value === 'yUp' || value === 'zUp' || value === 'xUp' || value === 'custom') {
    return value
  }
  return DEFAULT_ENVIRONMENT_ORIENTATION_PRESET
}

function normalizeSkycubeFormat(value: unknown): EnvironmentSettings['background']['skycubeFormat'] {
  return value === 'zip' ? 'zip' : 'faces'
}

function resolvePresetRotationDegrees(preset: EnvironmentSettings['environmentOrientationPreset']): { x: number; y: number; z: number } {
  if (preset === 'zUp') {
    return { x: -90, y: 0, z: 0 }
  }
  if (preset === 'xUp') {
    return { x: 0, y: 0, z: 90 }
  }
  return { ...DEFAULT_ENVIRONMENT_ROTATION_DEGREES }
}

export function cloneEnvironmentSettings(source?: Partial<EnvironmentSettings> | EnvironmentSettings | null): EnvironmentSettings {
  const backgroundSource = source?.background ?? null
  const environmentMapSource = source?.environmentMap ?? null

  let backgroundMode: any = 'skybox'
  if (backgroundSource?.mode === 'hdri') {
    backgroundMode = 'hdri'
  } else if (backgroundSource?.mode === 'skycube') {
    backgroundMode = 'skycube'
  } else if (backgroundSource?.mode === 'solidColor') {
    backgroundMode = 'solidColor'
  }
  const environmentMapMode: any = environmentMapSource?.mode === 'custom' ? 'custom' : 'skybox'
  let fogMode: any = 'none'
  if (source?.fogMode === 'linear') {
    fogMode = 'linear'
  } else if (source?.fogMode === 'exp') {
    fogMode = 'exp'
  }

  const fogNear = clampNumber(source?.fogNear, 0, 100000, DEFAULT_ENVIRONMENT_FOG_NEAR)
  const fogFar = clampNumber(source?.fogFar, 0, 100000, DEFAULT_ENVIRONMENT_FOG_FAR)
  const normalizedFogFar = fogFar > fogNear ? fogFar : fogNear + 0.001

  const preset = normalizeEnvironmentOrientationPreset((source as any)?.environmentOrientationPreset)
  const presetRotation = resolvePresetRotationDegrees(preset)
  const rotationSource = (source as any)?.environmentRotationDegrees ?? null
  const environmentRotationDegrees = {
    x: clampNumber(rotationSource?.x, -360, 360, presetRotation.x),
    y: clampNumber(rotationSource?.y, -360, 360, presetRotation.y),
    z: clampNumber(rotationSource?.z, -360, 360, presetRotation.z),
  }

  return {
    background: {
      mode: backgroundMode,
      solidColor: normalizeHexColor(backgroundSource?.solidColor, DEFAULT_ENVIRONMENT_BACKGROUND_COLOR),
      gradientTopColor: normalizeNullableHexColor((backgroundSource as any)?.gradientTopColor ?? null),
      gradientOffset: clampNumber(
        (backgroundSource as any)?.gradientOffset,
        0,
        100000,
        DEFAULT_ENVIRONMENT_GRADIENT_OFFSET,
      ),
      gradientExponent: clampNumber(
        (backgroundSource as any)?.gradientExponent,
        0,
        10,
        DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT,
      ),
      hdriAssetId: normalizeAssetId(backgroundSource?.hdriAssetId ?? null),
      skycubeFormat: normalizeSkycubeFormat((backgroundSource as any)?.skycubeFormat),
      skycubeZipAssetId:
        backgroundMode === 'skycube' ? normalizeAssetId((backgroundSource as any)?.skycubeZipAssetId ?? null) : null,
      positiveXAssetId: normalizeAssetId((backgroundSource as any)?.positiveXAssetId ?? null),
      negativeXAssetId: normalizeAssetId((backgroundSource as any)?.negativeXAssetId ?? null),
      positiveYAssetId: normalizeAssetId((backgroundSource as any)?.positiveYAssetId ?? null),
      negativeYAssetId: normalizeAssetId((backgroundSource as any)?.negativeYAssetId ?? null),
      positiveZAssetId: normalizeAssetId((backgroundSource as any)?.positiveZAssetId ?? null),
      negativeZAssetId: normalizeAssetId((backgroundSource as any)?.negativeZAssetId ?? null),
    },
    environmentOrientationPreset: preset,
    environmentRotationDegrees,
    ambientLightColor: normalizeHexColor(source?.ambientLightColor, DEFAULT_ENVIRONMENT_AMBIENT_COLOR),
    ambientLightIntensity: clampNumber(source?.ambientLightIntensity, 0, 10, DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY),
    fogMode,
    fogColor: normalizeHexColor(source?.fogColor, DEFAULT_ENVIRONMENT_FOG_COLOR),
    fogDensity: clampNumber(source?.fogDensity, 0, 5, DEFAULT_ENVIRONMENT_FOG_DENSITY),
    fogNear,
    fogFar: normalizedFogFar,
    environmentMap: {
      mode: environmentMapMode,
      hdriAssetId: normalizeAssetId(environmentMapSource?.hdriAssetId ?? null),
    },
    gravityStrength: clampNumber(source?.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY),
    collisionRestitution: clampNumber(source?.collisionRestitution, 0, 1, DEFAULT_ENVIRONMENT_RESTITUTION),
    collisionFriction: clampNumber(source?.collisionFriction, 0, 1, DEFAULT_ENVIRONMENT_FRICTION),
  }
}

export function isEnvironmentNode(node: SceneNode, id: string): boolean {
  return node.id === id
}

export function createEnvironmentSceneNode(
  id: string,
  overrides: { settings?: Partial<EnvironmentSettings> | EnvironmentSettings | null; visible?: boolean } = {},
): SceneNode {
  const settings = cloneEnvironmentSettings(overrides.settings ?? null)
  return {
    id,
    name: 'Environment',
    nodeType: 'Environment',
    canPrefab: false,
    allowChildNodes: false,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: overrides.visible ?? true,
    locked: true,
    userData: { environment: settings },
  }
}

export function normalizeEnvironmentSceneNode(node: SceneNode | null | undefined, id: string, override?: EnvironmentSettings): SceneNode {
  if (!node) {
    return createEnvironmentSceneNode(id, { settings: override })
  }
  const existingSettings = node.userData && typeof node.userData === 'object' ? (node.userData as any).environment : null
  const settings = override ? cloneEnvironmentSettings(override) : cloneEnvironmentSettings(existingSettings ?? null)
  const visible = node.visible ?? true
  const normalized = createEnvironmentSceneNode(id, { settings, visible })
  if (node.children?.length) {
    normalized.children = node.children.map((c) => ({ ...(c as any) }))
  }
  return normalized
}

export function ensureEnvironmentNode(
  nodes: SceneNode[],
  id: string,
  isSkyNodePred: (n: SceneNode) => boolean,
  isGroundNodePred: (n: SceneNode) => boolean,
  override?: EnvironmentSettings,
): SceneNode[] {
  let environment: SceneNode | null = null
  const others: SceneNode[] = []

  nodes.forEach((node) => {
    if (!environment && isEnvironmentNode(node, id)) {
      environment = normalizeEnvironmentSceneNode(node, id, override)
      return
    }
    if (!isEnvironmentNode(node, id)) {
      others.push(node)
    }
  })

  if (!environment) {
    environment = createEnvironmentSceneNode(id, { settings: override })
  }

  const result = [...others]
  const skyIndex = result.findIndex((node) => isSkyNodePred(node))
  const groundIndex = result.findIndex((node) => isGroundNodePred(node))
  const insertIndex = skyIndex >= 0 ? skyIndex + 1 : groundIndex >= 0 ? groundIndex + 1 : 0
  result.splice(insertIndex, 0, environment)
  return result
}

export function extractEnvironmentSettings(node: SceneNode | null | undefined): EnvironmentSettings {
  if (!node) return cloneEnvironmentSettings(undefined)
  if (!node.userData || typeof node.userData !== 'object') return cloneEnvironmentSettings(undefined)
  const payload = (node.userData as any).environment
  return cloneEnvironmentSettings(payload ?? undefined)
}

export function environmentSettingsEqual(a: EnvironmentSettings, b: EnvironmentSettings, epsilon = 1e-4): boolean {
  return (
    a.background.mode === b.background.mode &&
    a.background.solidColor === b.background.solidColor &&
    (a.background.gradientTopColor ?? null) === (b.background.gradientTopColor ?? null) &&
    Math.abs((a.background.gradientOffset ?? DEFAULT_ENVIRONMENT_GRADIENT_OFFSET) - (b.background.gradientOffset ?? DEFAULT_ENVIRONMENT_GRADIENT_OFFSET)) <= epsilon &&
    Math.abs((a.background.gradientExponent ?? DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT) - (b.background.gradientExponent ?? DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT)) <= epsilon &&
    a.background.hdriAssetId === b.background.hdriAssetId &&
    a.background.skycubeFormat === b.background.skycubeFormat &&
    a.background.skycubeZipAssetId === b.background.skycubeZipAssetId &&
    a.background.positiveXAssetId === b.background.positiveXAssetId &&
    a.background.negativeXAssetId === b.background.negativeXAssetId &&
    a.background.positiveYAssetId === b.background.positiveYAssetId &&
    a.background.negativeYAssetId === b.background.negativeYAssetId &&
    a.background.positiveZAssetId === b.background.positiveZAssetId &&
    a.background.negativeZAssetId === b.background.negativeZAssetId &&
    (a.environmentOrientationPreset ?? DEFAULT_ENVIRONMENT_ORIENTATION_PRESET) ===
      (b.environmentOrientationPreset ?? DEFAULT_ENVIRONMENT_ORIENTATION_PRESET) &&
    Math.abs((a.environmentRotationDegrees?.x ?? 0) - (b.environmentRotationDegrees?.x ?? 0)) <= epsilon &&
    Math.abs((a.environmentRotationDegrees?.y ?? 0) - (b.environmentRotationDegrees?.y ?? 0)) <= epsilon &&
    Math.abs((a.environmentRotationDegrees?.z ?? 0) - (b.environmentRotationDegrees?.z ?? 0)) <= epsilon &&
    a.ambientLightColor === b.ambientLightColor &&
    Math.abs(a.ambientLightIntensity - b.ambientLightIntensity) <= epsilon &&
    a.fogMode === b.fogMode &&
    a.fogColor === b.fogColor &&
    Math.abs(a.fogDensity - b.fogDensity) <= epsilon &&
    Math.abs(a.fogNear - b.fogNear) <= epsilon &&
    Math.abs(a.fogFar - b.fogFar) <= epsilon &&
    a.environmentMap.mode === b.environmentMap.mode &&
    a.environmentMap.hdriAssetId === b.environmentMap.hdriAssetId &&
    Math.abs(a.gravityStrength - b.gravityStrength) <= epsilon &&
    Math.abs(a.collisionRestitution - b.collisionRestitution) <= epsilon &&
    Math.abs(a.collisionFriction - b.collisionFriction) <= epsilon
  )
}

export function resolveSceneDocumentEnvironment(scene: StoredSceneDocument, findNodeById: (nodes: any[], id: string) => SceneNode | null, envNodeId: string): EnvironmentSettings {
  if (scene.environment) return cloneEnvironmentSettings(scene.environment)
  const environmentNode = findNodeById(scene.nodes, envNodeId)
  return extractEnvironmentSettings(environmentNode)
}

export default {
  cloneEnvironmentSettings,
  isEnvironmentNode,
  createEnvironmentSceneNode,
  normalizeEnvironmentSceneNode,
  ensureEnvironmentNode,
  extractEnvironmentSettings,
  environmentSettingsEqual,
  resolveSceneDocumentEnvironment,
}
