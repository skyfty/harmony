import {
  cloneEnvironmentSettings,
  DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT,
  DEFAULT_ENVIRONMENT_GRADIENT_OFFSET,
  DEFAULT_ENVIRONMENT_SETTINGS,
  resolveDocumentEnvironment,
  type SceneNode,
  type EnvironmentSettings,
} from '@schema'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

export { cloneEnvironmentSettings, DEFAULT_ENVIRONMENT_SETTINGS }

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
  let groundIndex = -1
  for (let index = 0; index < result.length; index += 1) {
    const candidate = result[index]
    if (candidate && isGroundNodePred(candidate)) {
      groundIndex = index
      break
    }
  }
  const insertIndex = groundIndex >= 0 ? groundIndex + 1 : 0
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
    a.environmentOrientationPreset === b.environmentOrientationPreset &&
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
    Boolean(a.fogAutoFitToGround) === Boolean(b.fogAutoFitToGround) &&
    Boolean(a.physicsEnabled ?? true) === Boolean(b.physicsEnabled ?? true) &&
    Math.abs(a.gravityStrength - b.gravityStrength) <= epsilon &&
    Math.abs(a.collisionRestitution - b.collisionRestitution) <= epsilon &&
    Math.abs(a.collisionFriction - b.collisionFriction) <= epsilon &&
    Boolean(a.csm?.enabled ?? true) === Boolean(b.csm?.enabled ?? true) &&
    Boolean(a.csm?.shadowEnabled ?? true) === Boolean(b.csm?.shadowEnabled ?? true) &&
    (a.csm?.lightColor ?? '#ffffff') === (b.csm?.lightColor ?? '#ffffff') &&
    Math.abs((a.csm?.lightIntensity ?? 1) - (b.csm?.lightIntensity ?? 1)) <= epsilon &&
    Math.abs((a.csm?.sunAzimuthDeg ?? 45) - (b.csm?.sunAzimuthDeg ?? 45)) <= epsilon &&
    Math.abs((a.csm?.sunElevationDeg ?? 42) - (b.csm?.sunElevationDeg ?? 42)) <= epsilon &&
    Math.abs((a.csm?.cascades ?? 4) - (b.csm?.cascades ?? 4)) <= epsilon &&
    Math.abs((a.csm?.maxFar ?? 1200) - (b.csm?.maxFar ?? 1200)) <= epsilon &&
    Math.abs((a.csm?.shadowMapSize ?? 2048) - (b.csm?.shadowMapSize ?? 2048)) <= epsilon &&
    Math.abs((a.csm?.shadowBias ?? -0.00015) - (b.csm?.shadowBias ?? -0.00015)) <= epsilon &&
    Boolean(a.viewportPerformanceMode) === Boolean(b.viewportPerformanceMode) &&
    a.northDirection === b.northDirection
  )
}

export function resolveSceneDocumentEnvironment(scene: StoredSceneDocument, findNodeById: (nodes: any[], id: string) => SceneNode | null, envNodeId: string): EnvironmentSettings {
  void findNodeById
  void envNodeId
  return resolveDocumentEnvironment(scene)
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
