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

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  background: {
    mode: 'skybox',
    solidColor: DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
    hdriAssetId: null,
  },
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

export function cloneEnvironmentSettings(source?: Partial<EnvironmentSettings> | EnvironmentSettings | null): EnvironmentSettings {
  const backgroundSource = source?.background ?? null
  const environmentMapSource = source?.environmentMap ?? null

  let backgroundMode: any = 'skybox'
  if (backgroundSource?.mode === 'hdri') {
    backgroundMode = 'hdri'
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

  return {
    background: {
      mode: backgroundMode,
      solidColor: normalizeHexColor(backgroundSource?.solidColor, DEFAULT_ENVIRONMENT_BACKGROUND_COLOR),
      hdriAssetId: normalizeAssetId(backgroundSource?.hdriAssetId ?? null),
    },
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
    a.background.hdriAssetId === b.background.hdriAssetId &&
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
