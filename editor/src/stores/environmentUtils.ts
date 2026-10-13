import {
  cloneEnvironmentSettings,
  DEFAULT_ENVIRONMENT_SETTINGS,
  resolveDocumentEnvironment,
  type SceneNode,
  type EnvironmentSettings,
} from '@schema/core'
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
    a.slowroads.season === b.slowroads.season &&
    a.slowroads.timeOfDay === b.slowroads.timeOfDay &&
    a.slowroads.weather === b.slowroads.weather &&
    a.slowroads.showClouds === b.slowroads.showClouds &&
    a.slowroads.showStars === b.slowroads.showStars &&
    a.slowroads.showSnow === b.slowroads.showSnow &&
    Math.abs(a.slowroads.exposureScale - b.slowroads.exposureScale) <= epsilon &&
    Boolean(a.physicsEnabled ?? true) === Boolean(b.physicsEnabled ?? true) &&
    (a.physicsEngine ?? 'cannon') === (b.physicsEngine ?? 'cannon') &&
    Math.abs(a.gravityStrength - b.gravityStrength) <= epsilon &&
    Math.abs(a.collisionRestitution - b.collisionRestitution) <= epsilon &&
    Math.abs(a.collisionFriction - b.collisionFriction) <= epsilon &&
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
