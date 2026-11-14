import * as THREE from 'three'
import {
  createPrimitiveMesh,
  isGeometryType,
  type FloorDynamicMesh,
  type FloorVertex2D,
  type SceneMaterialProps,
  type SceneMaterialTextureSlot,
  type SceneMaterialType,
  type SceneNode,
  type SceneNodeComponentState,
  type SceneNodeMaterial,
  type Vector3Like,
} from '@schema/core'
import { componentManager } from '@schema/components'
import {
  HOUSE_RIG_COMPONENT_TYPE,
  getHouseRigRuntimeSnapshot,
} from '@schema/components'
import {
  clampHouseRigDimensions,
  getHouseRigScript,
  getLatestHouseRigScript,
  listHouseRigScripts,
  normalizeHouseRigComponentProps,
  toHouseRigAssetDescriptor,
  validateHouseRigDeformPlan,
  type HouseRigComponentProps,
} from '@schema/houseRig'
import type {
  HarmonyApplyRequest,
  HarmonyApplyResult,
  HarmonyOperation,
  HarmonyWorldTransform,
} from '@schema/editorAgentProtocol'
import {
  HARMONY_AGENT_MAX_OPERATIONS,
  HARMONY_AGENT_MAX_ITEM_BYTES,
} from '@schema/editorAgentProtocol'
import { createTextureSettings } from '@schema/material'
import { resolveSceneNodeWorldMatrix, useSceneStore } from '@/stores/sceneStore'
import { createWarpGateNode } from '@/stores/warpGateNodeUtils'
import { AgentBridgeError } from '@/agent/errors'
import { setAgentCameraState, setAgentTool } from '@/agent/viewportControl'
import {
  getProceduralLandscapeStats,
  sampleProceduralLandscapeTerrainHeight,
} from '@schema/proceduralLandscape/runtime'
import type { ProceduralLandscapeComponentProps } from '@schema/proceduralLandscape/config'
import {
  createDemTerrainFlatteningTarget,
  getLandscapeTerrainFlatteningSnapshot,
  type TerrainFlatteningComponentProps,
} from '@schema/proceduralLandscape/terrainFlattening'
import { fitTerrainFlatteningTransition } from '@schema/proceduralLandscape/terrainTransitionFit'

type SceneStore = ReturnType<typeof useSceneStore>

export type AgentOperationContext = {
  captureScreenshot?: () => Promise<Blob | null>
}

const HARMONY_MATERIAL_TYPES: readonly SceneMaterialType[] = [
  'MeshBasicMaterial',
  'MeshNormalMaterial',
  'MeshLambertMaterial',
  'MeshMatcapMaterial',
  'MeshPhongMaterial',
  'MeshToonMaterial',
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
]
const HARMONY_MATERIAL_TYPE_SET = new Set<string>(HARMONY_MATERIAL_TYPES)
const HARMONY_MATERIAL_SIDES = new Set<string>(['front', 'back', 'double'])
const HARMONY_MATERIAL_TEXTURE_SLOTS: readonly SceneMaterialTextureSlot[] = [
  'albedo',
  'normal',
  'metalness',
  'roughness',
  'ao',
  'emissive',
  'displacement',
]
const HARMONY_MATERIAL_TEXTURE_SLOT_SET = new Set<string>(HARMONY_MATERIAL_TEXTURE_SLOTS)
const HARMONY_MATERIAL_PATCH_KEYS = new Set<string>([
  'color',
  'transparent',
  'opacity',
  'alphaTest',
  'side',
  'wireframe',
  'metalness',
  'roughness',
  'specular',
  'shininess',
  'transmission',
  'thickness',
  'ior',
  'clearcoat',
  'clearcoatRoughness',
  'attenuationColor',
  'attenuationDistance',
  'emissive',
  'emissiveIntensity',
  'aoStrength',
  'envMapIntensity',
  'textures',
  'textureOverrides',
])
const HARMONY_MATERIAL_BOOLEAN_KEYS = new Set<string>(['transparent', 'wireframe'])
const HARMONY_MATERIAL_COLOR_KEYS = new Set<string>([
  'color',
  'specular',
  'attenuationColor',
  'emissive',
])
const HARMONY_MATERIAL_UNIT_RANGE_KEYS = new Set<string>([
  'opacity',
  'alphaTest',
  'metalness',
  'roughness',
  'transmission',
  'clearcoat',
  'clearcoatRoughness',
])
const HARMONY_MATERIAL_NON_NEGATIVE_KEYS = new Set<string>([
  'shininess',
  'thickness',
  'attenuationDistance',
  'emissiveIntensity',
  'aoStrength',
  'envMapIntensity',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asVector3(value: unknown, label: string): Vector3Like {
  if (!isRecord(value)) {
    throw new AgentBridgeError('VALIDATION_FAILED', `${label} must be an object with x, y, and z`)
  }
  const { x, y, z } = value
  if (![x, y, z].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new AgentBridgeError('VALIDATION_FAILED', `${label} must contain finite x, y, and z values`)
  }
  return { x: x as number, y: y as number, z: z as number }
}

function toVector3(value: Vector3Like): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z)
}

function toPlainVector(value: THREE.Vector3): Vector3Like {
  return { x: value.x, y: value.y, z: value.z }
}

function validateMaterialType(value: unknown, label: string): asserts value is SceneMaterialType {
  if (typeof value !== 'string' || !HARMONY_MATERIAL_TYPE_SET.has(value)) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `${label} must be one of: ${HARMONY_MATERIAL_TYPES.join(', ')}`,
    )
  }
}

function validateMaterialTextureMap(value: unknown, label: string): void {
  if (!isRecord(value)) {
    throw new AgentBridgeError('VALIDATION_FAILED', `${label} must be an object`)
  }
  Object.entries(value).forEach(([slot, texture]) => {
    if (!HARMONY_MATERIAL_TEXTURE_SLOT_SET.has(slot)) {
      throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${slot} is not a texture slot`)
    }
    if (texture === null) {
      return
    }
    if (!isRecord(texture) || typeof texture.assetId !== 'string' || !texture.assetId.trim()) {
      throw new AgentBridgeError(
        'VALIDATION_FAILED',
        `${label}.${slot} must be null or a texture reference with a non-empty assetId`,
      )
    }
    if (texture.settings !== undefined && !isRecord(texture.settings)) {
      throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${slot}.settings must be an object`)
    }
  })
}

function validateMaterialPatch(
  value: unknown,
  label: string,
): asserts value is Partial<SceneMaterialProps> & {
  textureOverrides?: SceneMaterialTextureSlot[]
} {
  if (!isRecord(value)) {
    throw new AgentBridgeError('VALIDATION_FAILED', `${label} must be an object`)
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (!HARMONY_MATERIAL_PATCH_KEYS.has(key)) {
      throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${key} is not a supported material property`)
    }
    if (HARMONY_MATERIAL_BOOLEAN_KEYS.has(key)) {
      if (typeof entry !== 'boolean') {
        throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${key} must be a boolean`)
      }
      return
    }
    if (HARMONY_MATERIAL_COLOR_KEYS.has(key)) {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${key} must be a non-empty color string`)
      }
      return
    }
    if (key === 'side') {
      if (typeof entry !== 'string' || !HARMONY_MATERIAL_SIDES.has(entry)) {
        throw new AgentBridgeError('VALIDATION_FAILED', `${label}.side must be front, back, or double`)
      }
      return
    }
    if (key === 'textures') {
      validateMaterialTextureMap(entry, `${label}.textures`)
      return
    }
    if (key === 'textureOverrides') {
      if (!Array.isArray(entry)) {
        throw new AgentBridgeError('VALIDATION_FAILED', `${label}.textureOverrides must be an array`)
      }
      entry.forEach((slot, index) => {
        if (typeof slot !== 'string' || !HARMONY_MATERIAL_TEXTURE_SLOT_SET.has(slot)) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            `${label}.textureOverrides[${index}] is not a texture slot`,
          )
        }
      })
      return
    }
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${key} must be a finite number`)
    }
    if (HARMONY_MATERIAL_UNIT_RANGE_KEYS.has(key) && (entry < 0 || entry > 1)) {
      throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${key} must be between 0 and 1`)
    }
    if (HARMONY_MATERIAL_NON_NEGATIVE_KEYS.has(key) && entry < 0) {
      throw new AgentBridgeError('VALIDATION_FAILED', `${label}.${key} must be non-negative`)
    }
    if (key === 'ior' && (entry < 1 || entry > 3)) {
      throw new AgentBridgeError('VALIDATION_FAILED', `${label}.ior must be between 1 and 3`)
    }
  })
}

function findNodeMaterialOrThrow(
  store: SceneStore,
  nodeId: string,
  nodeMaterialId: string,
): SceneNodeMaterial {
  const node = findNodeOrThrow(store, nodeId)
  const material = node.materials?.find((entry) => entry.id === nodeMaterialId)
  if (!material) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `Node ${nodeId} does not have material slot ${nodeMaterialId}`,
    )
  }
  return material
}

function findNodeOrThrow(store: SceneStore, nodeId: string): SceneNode {
  const node = store.getNodeById(nodeId)
  if (!node) {
    throw new AgentBridgeError('NODE_NOT_FOUND', `Node ${nodeId} does not exist`)
  }
  return node
}

function resolveLocalTransformFromWorld(
  store: SceneStore,
  node: SceneNode,
  transform: HarmonyWorldTransform,
): { position?: Vector3Like; rotation?: Vector3Like; scale?: Vector3Like } {
  const worldMatrix = resolveSceneNodeWorldMatrix(store.nodes, node.id)
  if (!worldMatrix) {
    throw new AgentBridgeError('NODE_NOT_FOUND', `Cannot resolve world transform for ${node.id}`)
  }
  const currentWorldPosition = new THREE.Vector3()
  const currentWorldQuaternion = new THREE.Quaternion()
  const currentWorldScale = new THREE.Vector3()
  worldMatrix.decompose(currentWorldPosition, currentWorldQuaternion, currentWorldScale)
  const currentWorldEuler = new THREE.Euler().setFromQuaternion(currentWorldQuaternion, 'XYZ')
  const desiredWorldPosition = transform.position ? toVector3(transform.position) : currentWorldPosition
  const desiredWorldEuler = transform.rotation
    ? new THREE.Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z, 'XYZ')
    : currentWorldEuler
  const desiredWorldQuaternion = new THREE.Quaternion().setFromEuler(desiredWorldEuler)
  const desiredWorldScale = transform.scale ? toVector3(transform.scale) : currentWorldScale
  const desiredWorldMatrix = new THREE.Matrix4().compose(
    desiredWorldPosition,
    desiredWorldQuaternion,
    desiredWorldScale,
  )

  const parentId = store.getParentNodeId(node.id)
  const parentMatrix = parentId ? resolveSceneNodeWorldMatrix(store.nodes, parentId) : null
  const localMatrix = parentMatrix
    ? new THREE.Matrix4().multiplyMatrices(parentMatrix.clone().invert(), desiredWorldMatrix)
    : desiredWorldMatrix
  const localPosition = new THREE.Vector3()
  const localQuaternion = new THREE.Quaternion()
  const localScale = new THREE.Vector3()
  localMatrix.decompose(localPosition, localQuaternion, localScale)
  const localEuler = new THREE.Euler().setFromQuaternion(localQuaternion, 'XYZ')
  return {
    position: toPlainVector(localPosition),
    rotation: { x: localEuler.x, y: localEuler.y, z: localEuler.z },
    scale: toPlainVector(localScale),
  }
}

function isSimplePatchValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (!isRecord(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length === 3
    && keys.every((key) => key === 'x' || key === 'y' || key === 'z')
    && keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
}

function resolveComponent(
  node: SceneNode,
  componentId?: string,
  componentType?: string,
): SceneNodeComponentState<Record<string, unknown>> {
  const components = Object.values(node.components ?? {}).filter(
    (entry): entry is SceneNodeComponentState<Record<string, unknown>> => Boolean(entry),
  )
  const component = componentId
    ? components.find((entry) => entry.id === componentId)
    : componentType
      ? components.find((entry) => entry.type === componentType)
      : null
  if (!component) {
    throw new AgentBridgeError(
      'COMPONENT_NOT_FOUND',
      componentId
        ? `Component ${componentId} does not exist on node ${node.id}`
        : `Component type ${componentType ?? '(missing)'} does not exist on node ${node.id}`,
    )
  }
  return component
}

export function validateSimpleComponentPatch(
  node: SceneNode,
  component: SceneNodeComponentState<Record<string, unknown>>,
  patch: Record<string, unknown>,
): void {
  const profile = componentManager.getAgentProfile(component.type)
  if (!profile || profile.editMode === 'readonly') {
    throw new AgentBridgeError(
      'OPERATION_NOT_SUPPORTED',
      `Component ${component.type} has no Agent write profile`,
    )
  }
  const keys = Object.keys(patch)
  for (const key of keys) {
    if (profile.protectedFields.includes(key)) {
      throw new AgentBridgeError(
        'FIELD_REQUIRES_DOMAIN_TOOL',
        `${component.type}.${key} requires ${profile.tool}`,
      )
    }
    if (!profile.safeFields.includes(key)) {
      throw new AgentBridgeError(
        'FIELD_REQUIRES_DOMAIN_TOOL',
        profile.tool
          ? `${component.type}.${key} requires ${profile.tool}; allowed generic fields are: ${profile.safeFields.join(', ') || '(none)'}`
          : `${component.type}.${key} is not exposed for generic Agent updates`,
      )
    }
    if (!isSimplePatchValue(patch[key])) {
      throw new AgentBridgeError(
        'FIELD_REQUIRES_DOMAIN_TOOL',
        `${component.type}.${key} is not a simple value and requires a domain operation`,
        { nodeId: node.id, componentType: component.type, tool: profile.tool },
      )
    }
  }
}

function readString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentBridgeError('VALIDATION_FAILED', `${key} must be a non-empty string`)
  }
  return value.trim()
}

function readOptionalNumber(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = args[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AgentBridgeError('VALIDATION_FAILED', `${key} must be a finite number`)
  }
  if (value < min || value > max) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `${key} must be between ${min} and ${max}`,
    )
  }
  return value
}

function readFloorVertices(value: unknown): FloorVertex2D[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 512) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      'vertices must be an array containing between 3 and 512 points',
    )
  }
  const vertices = value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new AgentBridgeError(
        'VALIDATION_FAILED',
        `vertices[${index}] must be an [x, z] pair`,
      )
    }
    const x = entry[0]
    const z = entry[1]
    if (typeof x !== 'number' || !Number.isFinite(x)
      || typeof z !== 'number' || !Number.isFinite(z)) {
      throw new AgentBridgeError(
        'VALIDATION_FAILED',
        `vertices[${index}] must contain finite x and z coordinates`,
      )
    }
    return [x, z] as FloorVertex2D
  })

  const epsilon = 1e-7
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!
    for (let otherIndex = index + 1; otherIndex < vertices.length; otherIndex += 1) {
      const other = vertices[otherIndex]!
      if (Math.hypot(current[0] - other[0], current[1] - other[1]) <= epsilon) {
        throw new AgentBridgeError(
          'VALIDATION_FAILED',
          `vertices[${index}] and vertices[${otherIndex}] are duplicate points`,
        )
      }
    }
  }

  let doubleArea = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    doubleArea += current[0] * next[1] - next[0] * current[1]
  }
  if (Math.abs(doubleArea) <= epsilon) {
    throw new AgentBridgeError('VALIDATION_FAILED', 'vertices define a degenerate polygon')
  }

  const cross = (a: FloorVertex2D, b: FloorVertex2D, c: FloorVertex2D) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const segmentsIntersect = (
    a: FloorVertex2D,
    b: FloorVertex2D,
    c: FloorVertex2D,
    d: FloorVertex2D,
  ) => {
    const abC = cross(a, b, c)
    const abD = cross(a, b, d)
    const cdA = cross(c, d, a)
    const cdB = cross(c, d, b)
    return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
      && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  }
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length
      if (
        first === second
        || first === secondNext
        || firstNext === second
        || firstNext === secondNext
      ) {
        continue
      }
      if (segmentsIntersect(
        vertices[first]!,
        vertices[firstNext]!,
        vertices[second]!,
        vertices[secondNext]!,
      )) {
        throw new AgentBridgeError('VALIDATION_FAILED', 'vertices define a self-intersecting polygon')
      }
    }
  }
  return vertices
}

function readOptionalSideUvScale(
  args: Record<string, unknown>,
): { x: number; y: number } | undefined {
  const value = args.sideUvScale
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    throw new AgentBridgeError('VALIDATION_FAILED', 'sideUvScale must be an object with x and y')
  }
  const x = value.x
  const y = value.y
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0
    || typeof y !== 'number' || !Number.isFinite(y) || y < 0) {
    throw new AgentBridgeError('VALIDATION_FAILED', 'sideUvScale x and y must be finite and non-negative')
  }
  return { x, y }
}

function analyzeTerrainTransition(
  store: SceneStore,
  args: Record<string, unknown>,
) {
  const ownerNodeId = readString(args, 'ownerNodeId')
  const landscapeNodeId = readString(args, 'landscapeNodeId')
  const ownerNode = findNodeOrThrow(store, ownerNodeId)
  const component = resolveComponent(
    ownerNode,
    typeof args.componentId === 'string' ? args.componentId : undefined,
    'terrainFlattening',
  )
  const landscapeNode = findNodeOrThrow(store, landscapeNodeId)
  if (!landscapeNode.components?.proceduralLandscape) {
    throw new AgentBridgeError(
      'COMPONENT_NOT_FOUND',
      `Node ${landscapeNodeId} has no proceduralLandscape component`,
    )
  }
  const stats = getProceduralLandscapeStats(landscapeNodeId)
  if (!stats) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `Node ${landscapeNodeId} has no active Procedural Landscape runtime`,
    )
  }
  if (stats.demStatus !== 'ready') {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `Procedural Landscape ${landscapeNodeId} is ${stats.demStatus}, not ready`,
    )
  }
  const targetSnapshot = getLandscapeTerrainFlatteningSnapshot().targets.find(
    (candidate) => (
      candidate.ownerNodeId === ownerNodeId
      && candidate.componentId === component.id
    ),
  )
  if (!targetSnapshot) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `No active Terrain Flattening target was found for ${ownerNodeId}:${component.id}`,
    )
  }
  const target = createDemTerrainFlatteningTarget(targetSnapshot)
  const componentProps = component.props as unknown as Partial<TerrainFlatteningComponentProps>
  const analysis = fitTerrainFlatteningTransition(
    target,
    (x, z) => sampleProceduralLandscapeTerrainHeight(landscapeNodeId, x, z),
    {
      maxGradeDegrees: readOptionalNumber(args, 'maxGradeDegrees', 1, 45),
      minBlendWidth: readOptionalNumber(args, 'minBlendWidth', 0.25, 100),
      maxBlendWidth: readOptionalNumber(args, 'maxBlendWidth', 0.25, 100),
      perimeterSpacing: readOptionalNumber(args, 'perimeterSpacing', 0.5, 50),
      profileSamples: readOptionalNumber(args, 'profileSamples', 4, 32),
      widthStep: readOptionalNumber(args, 'widthStep', 0.5, 20),
    },
  )
  if (analysis.reason === 'unsupported-footprint') {
    throw new AgentBridgeError(
      'OPERATION_NOT_SUPPORTED',
      'Transition fitting currently supports Floor and Region polygon footprints',
    )
  }
  return {
    ownerNodeId,
    landscapeNodeId,
    componentId: component.id,
    currentEdgeBlendWidth: Number.isFinite(componentProps.edgeBlendWidth)
      ? Number(componentProps.edgeBlendWidth)
      : target.influenceWidth,
    analysis,
  }
}

async function createNode(
  store: SceneStore,
  operation: Extract<HarmonyOperation, { op: 'node.create' }>,
): Promise<unknown> {
  if (operation.nodeType === 'Light') {
    const position = operation.world?.position ?? operation.local?.position
    const node = store.addLightNode(
      (operation.lightType ?? 'Directional') as never,
      {
        name: operation.name,
        ...(position ? { position: toVector3(position) } : {}),
      },
    )
    return { nodeId: node.id }
  }

  if (operation.nodeType !== 'Empty' && isGeometryType(operation.nodeType)) {
    const name = operation.name?.trim() || operation.nodeType
    const geometry = createPrimitiveMesh(operation.nodeType, { name })
    const requestedWorld = operation.world ?? operation.local
    const node = await store.addModelNode({
      nodeId: operation.nodeId,
      nodeType: operation.nodeType,
      object: geometry,
      name,
      parentId: operation.parentId,
      ...(requestedWorld?.position ? { position: toVector3(requestedWorld.position) } : {}),
      ...(requestedWorld?.rotation ? { rotation: toVector3(requestedWorld.rotation) } : {}),
      ...(requestedWorld?.scale ? { scale: toVector3(requestedWorld.scale) } : {}),
    })
    if (!node) {
      throw new AgentBridgeError(
        'INTERNAL_ERROR',
        `${operation.nodeType} primitive creation did not produce a scene node`,
      )
    }
    return { nodeId: node.id }
  }

  const object = operation.nodeType === 'Group' ? new THREE.Group() : new THREE.Object3D()
  const name = operation.name?.trim() || (operation.nodeType === 'Group' ? 'Group' : 'Empty')
  object.name = name
  const node = store.addSceneNode({
    nodeId: operation.nodeId,
    nodeType: operation.nodeType,
    object,
    name,
    parentId: operation.parentId ?? undefined,
    ...(operation.local?.position ? { position: operation.local.position } : {}),
    ...(operation.local?.rotation ? { rotation: operation.local.rotation } : {}),
    ...(operation.local?.scale ? { scale: operation.local.scale } : {}),
  })
  if (operation.world) {
    const local = resolveLocalTransformFromWorld(store, node, operation.world)
    store.updateNodeProperties({ id: node.id, ...local })
  }
  return { nodeId: node.id }
}

async function executeDomainOperation(
  store: SceneStore,
  operation: Extract<HarmonyOperation, { op: 'domain.apply' }>,
): Promise<unknown> {
  const args = operation.args
  if (operation.action === 'patch_component') {
    const nodeId = readString(args, 'nodeId')
    const node = findNodeOrThrow(store, nodeId)
    const component = resolveComponent(
      node,
      typeof args.componentId === 'string' ? args.componentId : undefined,
      typeof args.componentType === 'string' ? args.componentType : undefined,
    )
    const profile = componentManager.getAgentProfile(component.type)
    if (!profile || profile.editMode !== 'domain' || profile.domain !== operation.domain) {
      throw new AgentBridgeError(
        'OPERATION_NOT_SUPPORTED',
        `${component.type} is not editable through the ${operation.domain} domain`,
      )
    }
    if (!isRecord(args.patch)) {
      throw new AgentBridgeError('VALIDATION_FAILED', 'patch must be an object')
    }
    return {
      changed: store.updateNodeComponentProps(nodeId, component.id, args.patch),
      domain: operation.domain,
      componentType: component.type,
    }
  }
  switch (operation.domain) {
    case 'builder': {
      if (operation.action === 'update_floor_geometry') {
        const nodeId = readString(args, 'nodeId')
        const node = findNodeOrThrow(store, nodeId)
        if (node.dynamicMesh?.type !== 'Floor') {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            `Node ${nodeId} is not a Floor`,
          )
        }
        const vertices = readFloorVertices(args.vertices)
        const thickness = readOptionalNumber(args, 'thickness', 0, 10)
        const smooth = readOptionalNumber(args, 'smooth', 0, 1)
        const sideUvScale = readOptionalSideUvScale(args)
        const current = node.dynamicMesh as FloorDynamicMesh
        const nextMesh: FloorDynamicMesh = {
          ...current,
          vertices,
          ...(thickness !== undefined ? { thickness } : {}),
          ...(smooth !== undefined ? { smooth } : {}),
          ...(sideUvScale !== undefined ? { sideUvScale } : {}),
        }
        store.updateNodeDynamicMesh(nodeId, nextMesh)
        return {
          nodeId,
          changed: true,
          vertices,
          thickness: nextMesh.thickness ?? 0,
          smooth: nextMesh.smooth ?? 0,
          sideUvScale: nextMesh.sideUvScale ?? { x: 1, y: 1 },
        }
      }
      if (operation.action === 'create') {
        const builderType = readString(args, 'builderType')
        switch (builderType) {
          case 'wall':
            return store.createWallNode(args as never)
          case 'road':
            return store.createRoadNode(args as never)
          case 'floor':
            return store.createFloorNode(args as never)
          case 'landform':
            return store.createLandformNode(args as never)
          case 'water':
            return store.createWaterSurfaceMeshNode(args as never)
          case 'display_board':
            return store.createDisplayBoardNode(args as never)
          case 'billboard':
            return store.createBillboardNode(args as never)
          case 'region':
            return store.createRegionNode(args as never)
          case 'mesh':
            return store.createAiGeneratedMeshNode(args as never)
          case 'warp_gate':
            return createWarpGateNode(store, {
              name: typeof args.name === 'string' ? args.name : null,
              parentId: typeof args.parentId === 'string' ? args.parentId : null,
              position: isRecord(args.position) ? toVector3(asVector3(args.position, 'position')) : null,
            })
          default:
            throw new AgentBridgeError('OPERATION_NOT_SUPPORTED', `Unsupported builder type ${builderType}`)
        }
      }
      if (operation.action === 'apply_preset') {
        const nodeId = readString(args, 'nodeId')
        const assetId = readString(args, 'assetId')
        const componentType = readString(args, 'componentType')
        if (componentType === 'wall') return store.applyWallPresetToNode(nodeId, assetId)
        if (componentType === 'floor') return store.applyFloorPresetToNode(nodeId, assetId)
        if (componentType === 'landform') return store.applyLandformPresetToNode(nodeId, assetId)
        if (componentType === 'road') return store.applyRoadPresetToNode(nodeId, assetId)
      }
      break
    }
    case 'behavior': {
      const nodeId = readString(args, 'nodeId')
      const node = findNodeOrThrow(store, nodeId)
      if (operation.action === 'replace') {
        const behaviors = args.behaviors
        if (!Array.isArray(behaviors)) {
          throw new AgentBridgeError('VALIDATION_FAILED', 'behaviors must be an array')
        }
        for (const step of behaviors) {
          if (!isRecord(step)
            || typeof step.id !== 'string'
            || typeof step.action !== 'string'
            || typeof step.sequenceId !== 'string'
            || !isRecord(step.script)) {
            throw new AgentBridgeError(
              'VALIDATION_FAILED',
              'Each behavior step requires id, action, sequenceId, and script',
            )
          }
        }
        const added = store.addNodeComponent(nodeId, 'behavior')
        const component = added?.component ?? resolveComponent(node, undefined, 'behavior')
        store.updateNodeComponentProps(nodeId, component.id, { behaviors })
        return { nodeId, componentId: component.id }
      }
      break
    }
    case 'guideRoute': {
      switch (operation.action) {
        case 'create':
          return store.createGuideRouteNode(args as never)
        case 'update_waypoints':
          return store.updateGuideRouteWaypoints(readString(args, 'nodeId'), args as never)
        case 'move_stop':
          return store.moveGuideRouteStopAtPosition(
            readString(args, 'nodeId'),
            readString(args, 'stopId'),
            asVector3(args.anchor, 'anchor'),
          )
        case 'remove_stop':
          return store.removeGuideRouteStopWithLinks(
            readString(args, 'nodeId'),
            readString(args, 'stopId'),
          )
        case 'move_anchor':
          return store.moveGuideRoutePathAnchorByHandle(readString(args, 'nodeId'), args as never)
        case 'remove_anchor':
          return store.removeGuideRoutePathAnchorByHandle(readString(args, 'nodeId'), args as never)
        case 'add_branch':
          return store.createGuideRouteBranchFromStop(args as never)
        default:
          throw new AgentBridgeError('OPERATION_NOT_SUPPORTED', `Unsupported guideRoute action ${operation.action}`)
      }
    }
    case 'terrain': {
      if (operation.action === 'runtime_stats') {
        const nodeId = readString(args, 'nodeId')
        findNodeOrThrow(store, nodeId)
        const stats = getProceduralLandscapeStats(nodeId)
        if (!stats) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            `Node ${nodeId} has no active Procedural Landscape runtime`,
          )
        }
        return { nodeId, stats }
      }
      if (operation.action === 'regenerate_road') {
        const nodeId = readString(args, 'nodeId')
        const guideRoutePolicy = args.guideRoutePolicy ?? 'preserve'
        if (guideRoutePolicy !== 'preserve' && guideRoutePolicy !== 'recreate') {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            'guideRoutePolicy must be "preserve" or "recreate"',
          )
        }
        const result = store.generateProceduralLandscapeRoad(nodeId, {
          guideRoutePolicy,
        })
        if (!result.accepted) {
          return {
            nodeId,
            ...result,
            changed: false,
            guideRoutePolicy,
          }
        }
        const node = findNodeOrThrow(store, nodeId)
        const component = resolveComponent(node, undefined, 'proceduralLandscape')
        const props = component.props as unknown as ProceduralLandscapeComponentProps
        const generatedRoute = props.road.generatedRoute
        return {
          nodeId,
          ...result,
          changed: true,
          guideRoutePolicy,
          generationRevision: props.generationRevision,
          routeRevision: generatedRoute?.revision ?? null,
          waypointCount: generatedRoute?.waypoints.length ?? 0,
          compiledProfileSignature:
            generatedRoute?.centerline?.compiledProfile?.sourceSignature ?? null,
        }
      }
      if (operation.action === 'analyze_transition') {
        return analyzeTerrainTransition(store, args)
      }
      if (operation.action === 'fit_transition') {
        const analyzed = analyzeTerrainTransition(store, args)
        const recommended = analyzed.analysis.recommendedBlendWidth
        if (recommended == null) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            `Transition analysis did not produce a usable width: ${analyzed.analysis.reason}`,
          )
        }
        const changed = analyzed.analysis.requiresChange
          ? store.updateNodeComponentProps(
              analyzed.ownerNodeId,
              analyzed.componentId,
              { edgeBlendWidth: recommended },
            )
          : false
        return {
          ...analyzed,
          changed,
          edgeBlendWidth: recommended,
        }
      }
      switch (operation.action) {
        case 'raise_region':
          return store.raiseGroundRegion(args.bounds as never, Number(args.amount ?? 1))
        case 'lower_region':
          return store.lowerGroundRegion(args.bounds as never, Number(args.amount ?? 1))
        case 'reset_region':
          return store.resetGroundRegion(args.bounds as never)
        case 'compile':
          return store.ensureCurrentSceneCompiledGroundReady({ forceRebuild: args.forceRebuild === true })
        default:
          throw new AgentBridgeError('OPERATION_NOT_SUPPORTED', `Unsupported terrain action ${operation.action}`)
      }
    }
    case 'houseRig': {
      const nodeId = readString(args, 'nodeId')
      const node = findNodeOrThrow(store, nodeId)
      const component = resolveComponent(
        node,
        typeof args.componentId === 'string' ? args.componentId : undefined,
        HOUSE_RIG_COMPONENT_TYPE,
      )
      const props = normalizeHouseRigComponentProps(
        component.props as Partial<HouseRigComponentProps> & Record<string, unknown>,
        node,
      )
      const snapshot = getHouseRigRuntimeSnapshot(nodeId)
      if (operation.action === 'inspect' || operation.action === 'validate') {
        const script = getHouseRigScript(props.scriptId, props.scriptVersion)
        const compatibility = snapshot && script
          ? script.getCompatibility(toHouseRigAssetDescriptor(snapshot.rest))
          : null
        const plan = operation.action === 'validate' && snapshot && script
          ? script.buildPlan(snapshot.rest, snapshot.dimensions)
          : snapshot?.plan ?? null
        const issues = plan && snapshot
          ? validateHouseRigDeformPlan(snapshot.rest, plan)
          : []
        return {
          nodeId,
          componentId: component.id,
          scriptId: props.scriptId,
          scriptVersion: props.scriptVersion,
          assetId: snapshot?.rest.assetId ?? props.assetId,
          topologyHash: snapshot?.rest.topologyHash ?? props.topologyHash,
          dimensions: snapshot?.dimensions ?? props.dimensions,
          restDimensions: snapshot?.rest.dimensions ?? props.restDimensions,
          limits: snapshot?.rest.limits ?? null,
          compatibility,
          issues,
          warnings: snapshot?.warnings ?? [],
          handles: plan?.handles ?? null,
          bounds: plan?.bounds ?? snapshot?.rest.bounds ?? null,
          parts: (snapshot?.rest.parts ?? props.parts).map((part) => ({
            key: part.key,
            objectPath: part.objectPath,
            meshName: part.meshName,
            role: part.role,
            side: part.side,
            layer: part.layer,
            vertexCount: 'vertexCount' in part ? part.vertexCount : null,
            material: 'material' in part && part.material
              ? {
                  name: part.material.name ?? null,
                  type: part.material.type,
                  sourceMaterialAssetId: part.material.sourceMaterialAssetId ?? null,
                  textures: Object.entries(part.material.textures ?? {})
                    .filter(([, value]) => Boolean(value?.assetId))
                    .map(([slot, value]) => ({ slot, assetId: value?.assetId ?? null })),
                }
              : null,
          })),
          scripts: listHouseRigScripts().map((entry) => ({
            id: entry.id,
            label: entry.label,
            version: entry.version,
            description: entry.description,
            compatibility: snapshot
              ? entry.getCompatibility(toHouseRigAssetDescriptor(snapshot.rest))
              : null,
          })),
        }
      }
      if (operation.action === 'set_script') {
        const requestedId = readString(args, 'scriptId')
        const requestedVersion = typeof args.scriptVersion === 'string'
          ? args.scriptVersion.trim()
          : ''
        const script = requestedVersion
          ? getHouseRigScript(requestedId, requestedVersion)
          : getLatestHouseRigScript(requestedId)
        if (!script) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            `Unknown House Rig script ${requestedId}@${requestedVersion || '(latest)'}`,
          )
        }
        return {
          changed: store.updateNodeComponentProps(nodeId, component.id, {
            scriptId: script.id,
            scriptVersion: script.version,
          }),
          scriptId: script.id,
          scriptVersion: script.version,
          compatibility: snapshot
            ? script.getCompatibility(toHouseRigAssetDescriptor(snapshot.rest))
            : null,
        }
      }
      if (!snapshot) {
        throw new AgentBridgeError(
          'VALIDATION_FAILED',
          `House Rig runtime is not ready for ${nodeId}`,
        )
      }
      if (operation.action === 'set_dimensions') {
        const source = isRecord(args.dimensions) ? args.dimensions : args
        const candidate = {
          width: Number(source.width ?? props.dimensions.width),
          depth: Number(source.depth ?? props.dimensions.depth),
          wallHeight: Number(source.wallHeight ?? props.dimensions.wallHeight),
        }
        if (![candidate.width, candidate.depth, candidate.wallHeight].every(Number.isFinite)) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            'width, depth, and wallHeight must be finite numbers',
          )
        }
        const dimensions = clampHouseRigDimensions(
          candidate,
          snapshot.rest.limits,
          snapshot.rest.dimensions,
        )
        return {
          changed: store.updateNodeComponentProps(nodeId, component.id, { dimensions }),
          dimensions,
        }
      }
      if (operation.action === 'set_material') {
        const partKey = readString(args, 'partKey')
        const assetId = readString(args, 'assetId')
        const asset = store.getAsset(assetId)
        if (!asset) {
          throw new AgentBridgeError('VALIDATION_FAILED', `Unknown material or texture asset ${assetId}`)
        }
        if (asset.type === 'material') {
          const material = await store.applyMaterialAssetToHouseRigPart(
            nodeId,
            component.id,
            partKey,
            assetId,
          )
          if (!material) {
            throw new AgentBridgeError('VALIDATION_FAILED', `Unable to assign material to ${partKey}`)
          }
          return { changed: true, partKey, materialAssetId: assetId }
        }
        if (asset.type === 'image' || asset.type === 'texture') {
          const slot = typeof args.slot === 'string' ? args.slot : 'albedo'
          const material = store.applyTextureAssetToHouseRigPart(
            nodeId,
            component.id,
            partKey,
            assetId,
            slot as never,
          )
          if (!material) {
            throw new AgentBridgeError('VALIDATION_FAILED', `Unable to assign texture to ${partKey}`)
          }
          return { changed: true, partKey, textureAssetId: assetId, slot }
        }
        throw new AgentBridgeError(
          'VALIDATION_FAILED',
          'House Rig part materials accept material, image, or texture assets',
        )
      }
      if (operation.action === 'set_texture_mapping') {
        if (!Array.isArray(args.parts) || args.parts.length === 0) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            'parts must contain at least one House Rig texture mapping update',
          )
        }
        const byPartKey = new Map<string, {
          repeat: { x: number; y: number }
          tileSizeMeters: { x: number; y: number }
        }>()
        for (const [index, rawUpdate] of args.parts.entries()) {
          if (!isRecord(rawUpdate)) {
            throw new AgentBridgeError(
              'VALIDATION_FAILED',
              `parts[${index}] must be an object`,
            )
          }
          const partKey = readString(rawUpdate, 'partKey')
          if (byPartKey.has(partKey)) {
            throw new AgentBridgeError(
              'VALIDATION_FAILED',
              `Duplicate texture mapping update for part ${partKey}`,
            )
          }
          const readVector = (key: string) => {
            const value = isRecord(rawUpdate[key]) ? rawUpdate[key] : null
            const x = Number(value?.x)
            const y = Number(value?.y)
            if (!value || !Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
              throw new AgentBridgeError(
                'VALIDATION_FAILED',
                `parts[${index}].${key} must contain positive x and y values`,
              )
            }
            return { x, y }
          }
          byPartKey.set(partKey, {
            repeat: readVector('repeat'),
            tileSizeMeters: readVector('tileSizeMeters'),
          })
        }

        const updatedParts = props.parts.map((part) => {
          const mapping = byPartKey.get(part.key)
          if (!mapping) {
            return part
          }
          if (!part.material) {
            throw new AgentBridgeError(
              'VALIDATION_FAILED',
              `House Rig part ${part.key} has no material to update`,
            )
          }
          const nextTextures = Object.fromEntries(
            Object.entries(part.material.textures ?? {}).map(([slot, ref]) => {
              if (!ref) {
                return [slot, ref]
              }
              return [
                slot,
                {
                  ...ref,
                  settings: createTextureSettings({
                    ...ref.settings,
                    wrapS: 'RepeatWrapping',
                    wrapT: 'RepeatWrapping',
                    repeat: mapping.repeat,
                    tileSizeMeters: mapping.tileSizeMeters,
                  }),
                },
              ]
            }),
          )
          return {
            ...part,
            material: {
              ...part.material,
              textures: nextTextures,
              textureOverrides: Object.keys(nextTextures)
                .filter((slot) => Boolean(nextTextures[slot])) as SceneMaterialTextureSlot[],
            },
          }
        })
        const requestedKeys = new Set(byPartKey.keys())
        const knownPartKeys = new Set(props.parts.map((part) => part.key))
        const unknownKeys = Array.from(requestedKeys).filter((key) => !knownPartKeys.has(key))
        if (unknownKeys.length) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            `Unknown House Rig parts: ${unknownKeys.join(', ')}`,
          )
        }
        const changed = store.updateNodeComponentProps(nodeId, component.id, {
          ...props,
          parts: updatedParts,
        })
        return {
          changed,
          partKeys: Array.from(requestedKeys),
        }
      }
      if (operation.action === 'reset') {
        const dimensions = { ...snapshot.rest.dimensions }
        const includeMaterials = args.includeMaterials === true
        const parts = includeMaterials
          ? props.parts.map((part) => ({ ...part, material: null }))
          : props.parts
        return {
          changed: store.updateNodeComponentProps(nodeId, component.id, {
            dimensions,
            parts,
          }),
          dimensions,
          materialsReset: includeMaterials,
        }
      }
      if (operation.action === 'patch_component') {
        if (!isRecord(args.patch)) {
          throw new AgentBridgeError('VALIDATION_FAILED', 'patch must be an object')
        }
        return {
          changed: store.updateNodeComponentProps(nodeId, component.id, args.patch),
        }
      }
      break
    }
    case 'actor': {
      const nodeId = readString(args, 'nodeId')
      const node = findNodeOrThrow(store, nodeId)
      if (operation.action === 'add_character') {
        return store.addNodeComponent(nodeId, 'characterController')
      }
      if (operation.action === 'add_vehicle') {
        return store.addNodeComponent(nodeId, 'vehicle')
      }
      if (operation.action === 'patch') {
        const component = resolveComponent(
          node,
          typeof args.componentId === 'string' ? args.componentId : undefined,
          typeof args.componentType === 'string' ? args.componentType : undefined,
        )
        if (!isRecord(args.patch)) {
          throw new AgentBridgeError('VALIDATION_FAILED', 'patch must be an object')
        }
        return store.updateNodeComponentProps(nodeId, component.id, args.patch)
      }
      break
    }
  }
  throw new AgentBridgeError(
    'OPERATION_NOT_SUPPORTED',
    `Unsupported ${operation.domain} action ${operation.action}`,
  )
}

async function executeOperation(
  store: SceneStore,
  operation: HarmonyOperation,
): Promise<unknown> {
  switch (operation.op) {
    case 'node.create':
      return createNode(store, operation)
    case 'node.update': {
      const node = findNodeOrThrow(store, operation.nodeId)
      if (operation.name !== undefined) store.renameNode(node.id, operation.name)
      if (operation.visible !== undefined) store.setNodeVisibility(node.id, operation.visible)
      if (operation.locked !== undefined) store.setNodeLocked(node.id, operation.locked)
      if (operation.local) {
        store.updateNodeProperties({ id: node.id, ...operation.local })
      }
      if (operation.world) {
        store.updateNodeProperties({
          id: node.id,
          ...resolveLocalTransformFromWorld(store, node, operation.world),
        })
      }
      return { nodeId: node.id }
    }
    case 'node.delete': {
      findNodeOrThrow(store, operation.nodeId)
      store.removeSceneNodes([operation.nodeId])
      return { nodeId: operation.nodeId }
    }
    case 'node.duplicate':
      return { nodeIds: store.duplicateNodes(operation.nodeIds, { select: operation.select }) }
    case 'node.move':
      return {
        changed: store.moveNode({
          nodeId: operation.nodeId,
          targetId: operation.targetId,
          position: operation.position,
        }),
      }
    case 'node.select':
      store.setSelection(operation.nodeIds, { primaryId: operation.primaryId })
      return { nodeIds: [...store.selectedNodeIds] }
    case 'camera.focus':
      findNodeOrThrow(store, operation.nodeId)
      store.setSelection([operation.nodeId], { primaryId: operation.nodeId })
      store.requestCameraFocus(operation.nodeId)
      return { nodeId: operation.nodeId }
    case 'camera.set':
      return setAgentCameraState(operation.request)
    case 'tool.set_active':
      return setAgentTool(operation.request)
    case 'component.add': {
      const result = store.addNodeComponent(operation.nodeId, operation.componentType)
      if (!result) {
        throw new AgentBridgeError(
          'COMPONENT_NOT_ALLOWED',
          `${operation.componentType} cannot be attached to ${operation.nodeId}`,
        )
      }
      return { componentId: result.component.id, created: result.created }
    }
    case 'component.patch_simple': {
      const node = findNodeOrThrow(store, operation.nodeId)
      const component = resolveComponent(node, operation.componentId, operation.componentType)
      validateSimpleComponentPatch(node, component, operation.patch)
      return {
        changed: store.updateNodeComponentProps(node.id, component.id, operation.patch),
      }
    }
    case 'component.remove':
      return { changed: store.removeNodeComponent(operation.nodeId, operation.componentId) }
    case 'component.set_enabled':
      return {
        changed: store.setNodeComponentEnabled(
          operation.nodeId,
          operation.componentId,
          operation.enabled,
        ),
      }
    case 'asset.place': {
      const result = await store.spawnAssetAtWorldTransform(operation.assetId, {
        position: toVector3(operation.position),
        rotation: operation.rotation ? toVector3(operation.rotation) : null,
        scale: operation.scale ? toVector3(operation.scale) : null,
        parentId: operation.parentId,
        preserveWorldPosition: Boolean(operation.parentId),
      })
      return { nodeId: result.node.id, assetId: result.asset.id }
    }
    case 'material.create': {
      if (operation.type !== undefined) {
        validateMaterialType(operation.type, 'material.create.type')
      }
      if (operation.props !== undefined) {
        validateMaterialPatch(operation.props, 'material.create.props')
      }
      return store.createMaterial({
        name: operation.name,
        type: operation.type,
        props: operation.props,
      })
    }
    case 'material.update': {
      if (operation.type === undefined && operation.patch === undefined) {
        throw new AgentBridgeError(
          'VALIDATION_FAILED',
          'material.update requires a type, a non-empty patch, or both',
        )
      }
      if (operation.type !== undefined) {
        validateMaterialType(operation.type, 'material.update.type')
      }
      if (operation.patch !== undefined) {
        validateMaterialPatch(operation.patch, 'material.update.patch')
        if (!operation.type && Object.keys(operation.patch).length === 0) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            'material.update requires a non-empty patch when type is omitted',
          )
        }
      }
      findNodeMaterialOrThrow(store, operation.nodeId, operation.nodeMaterialId)

      if (operation.type !== undefined) {
        const changedType = store.updateNodeMaterialType(
          operation.nodeId,
          operation.nodeMaterialId,
          operation.type,
        )
        if (!changedType) {
          throw new AgentBridgeError(
            'VALIDATION_FAILED',
            `Material slot ${operation.nodeMaterialId} could not change type`,
          )
        }
      }
      if (operation.patch !== undefined) {
        store.updateNodeMaterialProps(
          operation.nodeId,
          operation.nodeMaterialId,
          operation.patch,
        )
      }
      return {
        nodeId: operation.nodeId,
        nodeMaterialId: operation.nodeMaterialId,
        type: operation.type ?? findNodeMaterialOrThrow(
          store,
          operation.nodeId,
          operation.nodeMaterialId,
        ).type,
      }
    }
    case 'material.apply_asset':
      return store.applyMaterialAssetToNodeMaterialSlot(
        operation.nodeId,
        operation.nodeMaterialId,
        operation.assetId,
      )
    case 'scene.patch_environment':
      return {
        changed: store.patchEnvironmentSettings(operation.patch as never),
      }
    case 'scene.set_device_adaptation':
      return {
        changed: store.setDeviceAdaptationSettings(operation.settings),
      }
    case 'scene.set_shadows_enabled':
      store.setShadowsEnabled(operation.enabled)
      return { enabled: operation.enabled }
    case 'scene.update_ground_settings':
      return {
        changed: store.setGroundInfiniteSettings(operation.patch),
      }
    case 'domain.apply':
      return await executeDomainOperation(store, operation)
    default:
      throw new AgentBridgeError(
        'OPERATION_NOT_SUPPORTED',
        `Unsupported operation ${(operation as { op?: string }).op ?? 'unknown'}`,
      )
  }
}

export async function applySceneOperations(
  store: SceneStore,
  request: HarmonyApplyRequest,
  _context: AgentOperationContext = {},
): Promise<HarmonyApplyResult> {
  if (!store.isSceneReady || !store.currentSceneId) {
    throw new AgentBridgeError('SCENE_NOT_READY', 'The editor scene is not ready')
  }
  if (!Array.isArray(request.operations) || request.operations.length === 0) {
    throw new AgentBridgeError('VALIDATION_FAILED', 'operations must contain at least one operation')
  }
  if (request.operations.length > HARMONY_AGENT_MAX_OPERATIONS) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `A batch may contain at most ${HARMONY_AGENT_MAX_OPERATIONS} operations`,
    )
  }
  const requestBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength
  if (requestBytes > HARMONY_AGENT_MAX_ITEM_BYTES) {
    throw new AgentBridgeError(
      'VALIDATION_FAILED',
      `The request is larger than ${HARMONY_AGENT_MAX_ITEM_BYTES} bytes`,
    )
  }
  if (
    typeof request.expectedRevision === 'number'
    && request.expectedRevision !== store.sceneRevision
  ) {
    throw new AgentBridgeError(
      'STALE_REVISION',
      `Expected scene revision ${request.expectedRevision}, current revision is ${store.sceneRevision}`,
      { expectedRevision: request.expectedRevision, currentRevision: store.sceneRevision },
    )
  }

  const beforeRevision = store.sceneRevision
  const hasContentChange = request.operations.some(
    (operation) => (
      operation.op !== 'node.select'
      && operation.op !== 'camera.focus'
      && operation.op !== 'camera.set'
      && operation.op !== 'tool.set_active'
      && !(
        operation.op === 'domain.apply'
        && operation.domain === 'houseRig'
        && (
          operation.action === 'inspect'
          || operation.action === 'validate'
        )
      )
      && !(
        operation.op === 'domain.apply'
        && operation.domain === 'terrain'
        && (
          operation.action === 'runtime_stats'
          || operation.action === 'analyze_transition'
        )
      )
    ),
  )
  const results: unknown[] = []
  const pending: string[] = []
  const warnings: string[] = []
  const execute = async () => {
    for (const operation of request.operations) {
      results.push(await executeOperation(store, operation))
      if (operation.op === 'asset.place') pending.push(`asset:${operation.assetId}`)
      if (
        operation.op === 'domain.apply'
        && operation.domain === 'terrain'
        && operation.action !== 'runtime_stats'
        && operation.action !== 'analyze_transition'
      ) {
        pending.push('terrain:compiled-ground')
      }
    }
  }

  if (hasContentChange) {
    await store.runAgentTransaction(execute)
  } else {
    await execute()
  }

  let savedDocument: Awaited<ReturnType<typeof store.flushPendingSceneAutoSave>> = null
  if (hasContentChange) {
    try {
      savedDocument = await store.flushPendingSceneAutoSave({ force: true })
    } catch (error) {
      warnings.push(`Scene changes were applied but save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    changeSetId: crypto.randomUUID(),
    sessionId: '',
    sceneId: store.currentSceneId,
    beforeRevision,
    afterRevision: store.sceneRevision,
    applied: request.operations.length,
    warnings,
    pending,
    results,
    saved: Boolean(savedDocument),
    canUndo: store.undoStack.length > 0,
  }
}
