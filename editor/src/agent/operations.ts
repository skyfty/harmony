import * as THREE from 'three'
import {
  createPrimitiveMesh,
  isGeometryType,
  type SceneNode,
  type SceneNodeComponentState,
  type Vector3Like,
} from '@schema/core'
import { componentManager } from '@schema/components'
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
    case 'material.create':
      return store.createMaterial({
        name: operation.name,
        props: operation.props,
      })
    case 'material.update':
      store.updateNodeMaterialProps(operation.nodeId, operation.nodeMaterialId, operation.patch)
      return { nodeId: operation.nodeId, nodeMaterialId: operation.nodeMaterialId }
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
