import type {
  ExternalControllableAsset,
  SceneJsonExportDocument,
  SceneNode,
  Vector3Like,
} from './core'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  createAutoTourComponentState,
} from './components/definitions/autoTourComponent'
import {
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  createCharacterControllerComponentState,
} from './components/definitions/characterControllerComponent'
import {
  createRigidbodyComponentState,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  type RigidbodyPhysicsShape,
} from './components/definitions/rigidbodyComponent'
import {
  createVehicleComponentState,
  VEHICLE_COMPONENT_TYPE,
  type VehicleWheelProps,
} from './components/definitions/vehicleComponent'
import { collectGuideRouteDestinations } from './guideRouteDestinations'
import {
  resolveSceneActorKind,
  type SceneActorKind,
} from './sceneActorAutoTour'

export type GuideRouteActorSource = 'scene' | 'player' | 'debug-proxy'
export type GuideRouteActorResolutionMode = 'player' | 'local-debug'

export type GuideRouteActorBinding = {
  nodeId: string
  kind: SceneActorKind
  label: string
  identifier: string | null
  source: GuideRouteActorSource
  routeNodeId: string | null
}

export type GuideRouteActorRequirement = {
  kind: SceneActorKind
  routeNodeIds: string[]
}

export type EnsureGuideRouteDebugActorsResult = {
  requirements: GuideRouteActorRequirement[]
  addedNodeIds: string[]
  addedKinds: SceneActorKind[]
}

export const GUIDE_ROUTE_ACTOR_SOURCE_USER_DATA_KEY = '__harmonyGuideRouteActorSource'
export const GUIDE_ROUTE_ACTOR_KIND_USER_DATA_KEY = '__harmonyGuideRouteActorKind'

const DEBUG_ACTOR_NODE_ID_PREFIX = '__harmony_debug_actor__'
const DEBUG_ACTOR_NODE_NAME_PREFIX = '[Preview]'

function flattenSceneNodes(nodes: SceneNode[] | null | undefined): SceneNode[] {
  const result: SceneNode[] = []
  const stack = Array.isArray(nodes) ? [...nodes].reverse() : []
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    result.push(node)
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children.slice().reverse())
    }
  }
  return result
}

function resolveNodeActorKind(node: SceneNode): SceneActorKind | null {
  return resolveSceneActorKind(node)
}

function resolveNodeActorSource(node: SceneNode): GuideRouteActorSource {
  const source = node.userData?.[GUIDE_ROUTE_ACTOR_SOURCE_USER_DATA_KEY]
  return source === 'player' || source === 'debug-proxy' ? source : 'scene'
}

function resolveActorRouteNodeId(node: SceneNode): string | null {
  const component = node.components?.[AUTO_TOUR_COMPONENT_TYPE]
  const routeNodeId = component?.props?.routeNodeId
  return typeof routeNodeId === 'string' && routeNodeId.trim().length
    ? routeNodeId.trim()
    : null
}

function resolveActorIdentifier(node: SceneNode): string | null {
  const raw = node.userData?.controllableIdentifier
  return typeof raw === 'string' && raw.trim().length ? raw.trim() : null
}

export function collectGuideRouteActorRequirements(
  nodes: Iterable<SceneNode>,
): GuideRouteActorRequirement[] {
  const routeNodeIdsByKind = new Map<SceneActorKind, Set<string>>()
  for (const destination of collectGuideRouteDestinations(nodes)) {
    if (destination.travelMode !== 'character' && destination.travelMode !== 'vehicle') {
      continue
    }
    const routeNodeIds = routeNodeIdsByKind.get(destination.travelMode) ?? new Set<string>()
    routeNodeIds.add(destination.routeNodeId)
    routeNodeIdsByKind.set(destination.travelMode, routeNodeIds)
  }
  return (['vehicle', 'character'] as const)
    .flatMap((kind): GuideRouteActorRequirement[] => {
      const routeNodeIds = routeNodeIdsByKind.get(kind)
      return routeNodeIds?.size
        ? [{ kind, routeNodeIds: Array.from(routeNodeIds).sort() }]
        : []
    })
}

export function collectGuideRouteActorRoster(nodes: Iterable<SceneNode>): GuideRouteActorBinding[] {
  const bindings: GuideRouteActorBinding[] = []
  for (const node of nodes) {
    const kind = resolveNodeActorKind(node)
    if (!kind) {
      continue
    }
    const autoTour = node.components?.[AUTO_TOUR_COMPONENT_TYPE]
    if (!autoTour || autoTour.enabled === false) {
      continue
    }
    bindings.push({
      nodeId: node.id,
      kind,
      label: node.name?.trim() || node.id,
      identifier: resolveActorIdentifier(node),
      source: resolveNodeActorSource(node),
      routeNodeId: resolveActorRouteNodeId(node),
    })
  }
  return bindings
}

export function selectGuideRoutePlayerActorAsset(
  assets: readonly ExternalControllableAsset[] | null | undefined,
  kind: SceneActorKind,
): ExternalControllableAsset | null {
  const candidates = (assets ?? [])
    .filter((asset) => (
      asset?.type === kind
      && asset.isActive !== false
      && asset.owned !== false
    ))
    .slice()
    .sort((left, right) => (
      Number(right.isSelected === true) - Number(left.isSelected === true)
      || Number(right.isDefault === true) - Number(left.isDefault === true)
      || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      || String(left.identifier ?? left.id).localeCompare(String(right.identifier ?? right.id))
    ))
  return candidates[0] ?? null
}

function clonePosition(position: Vector3Like | null | undefined): Vector3Like {
  return {
    x: Number.isFinite(position?.x) ? position!.x : 0,
    y: Number.isFinite(position?.y) ? position!.y : 0,
    z: Number.isFinite(position?.z) ? position!.z : 0,
  }
}

export function resolveGuideRouteActorSpawnPosition(
  document: SceneJsonExportDocument,
  kind: SceneActorKind,
): Vector3Like {
  const nodes = flattenSceneNodes(document.nodes)
  for (const node of nodes) {
    const component = node.components?.guideRoute
    if (!component || component.enabled === false || node.dynamicMesh?.type !== 'GuideRoute') {
      continue
    }
    const props = component.props as {
      legs?: Array<{
        id?: string
        kind?: string
        travelMode?: string
        anchors?: Array<Vector3Like & { id?: string }>
      }>
      stops?: Array<{
        thumbnailAssetId?: string | null
        anchor?: Vector3Like
        legId?: string
      }>
    } | null | undefined
    const compatibleLegIds = new Set(
      (props?.legs ?? [])
        .filter((leg) => leg.travelMode === kind || leg.travelMode === 'both')
        .map((leg) => leg.id)
        .filter((legId): legId is string => typeof legId === 'string'),
    )
    for (const stop of props?.stops ?? []) {
      if (
        typeof stop.thumbnailAssetId === 'string'
        && stop.thumbnailAssetId.trim().length
        && stop.legId
        && compatibleLegIds.has(stop.legId)
        && stop.anchor
      ) {
        return clonePosition(stop.anchor)
      }
    }
    const anchor = (props?.legs ?? [])
      .filter((leg) => leg.travelMode === kind || leg.travelMode === 'both')
      .flatMap((leg) => leg.anchors ?? [])
      .find(Boolean)
    if (anchor) {
      return clonePosition(anchor)
    }
    return clonePosition(node.position)
  }
  return { x: 0, y: 0, z: 0 }
}

function buildDebugCharacterNode(position: Vector3Like, routeNodeId: string | null): SceneNode {
  const nodeId = `${DEBUG_ACTOR_NODE_ID_PREFIX}character`
  const node: SceneNode = {
    id: nodeId,
    name: `${DEBUG_ACTOR_NODE_NAME_PREFIX} 角色`,
    nodeType: 'Capsule',
    position: clonePosition(position),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.7, y: 0.9, z: 0.7 },
    visible: true,
    userData: {
      [GUIDE_ROUTE_ACTOR_SOURCE_USER_DATA_KEY]: 'debug-proxy',
      [GUIDE_ROUTE_ACTOR_KIND_USER_DATA_KEY]: 'character',
      controllableIdentifier: 'preview-character',
    },
    components: {},
  }
  node.components![CHARACTER_CONTROLLER_COMPONENT_TYPE] = createCharacterControllerComponentState(node, {
    label: `${DEBUG_ACTOR_NODE_NAME_PREFIX} 角色 Controller`,
    colliderRadius: 0.35,
    colliderHeight: 1.8,
    walkSpeed: 2,
  }, {
    id: `${nodeId}:controller`,
    enabled: true,
  })
  const rigidbody = createRigidbodyComponentState(node, {
    mass: 70,
    bodyType: 'DYNAMIC',
    colliderType: 'capsule',
    targetNodeId: nodeId,
  }, {
    id: `${nodeId}:rigidbody`,
    enabled: true,
  })
  rigidbody.metadata = {
    [RIGIDBODY_METADATA_KEY]: {
      shape: {
        kind: 'capsule',
        radius: 0.35,
        height: 1.8,
        applyScale: true,
      } satisfies RigidbodyPhysicsShape,
    },
  }
  node.components![RIGIDBODY_COMPONENT_TYPE] = rigidbody
  node.components![AUTO_TOUR_COMPONENT_TYPE] = createAutoTourComponentState(node, {
    routeNodeId,
    speedMps: 2,
  }, {
    id: `${nodeId}:auto-tour`,
    enabled: true,
  })
  return node
}

function buildDebugVehicleNode(position: Vector3Like, routeNodeId: string | null): SceneNode {
  const nodeId = `${DEBUG_ACTOR_NODE_ID_PREFIX}vehicle`
  const chassisId = `${nodeId}:chassis`
  const wheelIds = ['front-left', 'front-right', 'rear-left', 'rear-right']
    .map((suffix) => `${nodeId}:wheel:${suffix}`)
  const wheelPositions: Array<{ x: number; z: number; front: boolean }> = [
    { x: 1.05, z: -0.8, front: true },
    { x: 1.05, z: 0.8, front: true },
    { x: -1.05, z: -0.8, front: false },
    { x: -1.05, z: 0.8, front: false },
  ]
  const wheels: VehicleWheelProps[] = wheelIds.map((wheelNodeId, index) => {
    const wheelPosition = wheelPositions[index]!
    return {
      id: `${nodeId}:wheel-config:${index}`,
      nodeId: wheelNodeId,
      chassisConnectionPointLocal: {
        x: wheelPosition.x,
        y: 0.36,
        z: wheelPosition.z,
      },
      radius: 0.36,
      suspensionRestLength: 0.3,
      suspensionStiffness: 32,
      dampingRelaxation: 2.5,
      dampingCompression: 4.8,
      frictionSlip: 2.6,
      maxSuspensionTravel: 0.3,
      maxSuspensionForce: 100000,
      useCustomSlidingRotationalSpeed: false,
      customSlidingRotationalSpeed: -30,
      isFrontWheel: wheelPosition.front,
      rollInfluence: 0.01,
      directionLocal: { x: 0, y: -1, z: 0 },
      axleLocal: { x: 0, y: 0, z: 1 },
    }
  })
  const node: SceneNode = {
    id: nodeId,
    name: `${DEBUG_ACTOR_NODE_NAME_PREFIX} 车辆`,
    nodeType: 'Group',
    position: clonePosition(position),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    userData: {
      [GUIDE_ROUTE_ACTOR_SOURCE_USER_DATA_KEY]: 'debug-proxy',
      [GUIDE_ROUTE_ACTOR_KIND_USER_DATA_KEY]: 'vehicle',
      controllableIdentifier: 'preview-vehicle',
    },
    children: [
      {
        id: chassisId,
        name: 'Preview Vehicle Chassis',
        nodeType: 'Box',
        position: { x: 0, y: 0.72, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 3.2, y: 0.7, z: 1.6 },
        visible: true,
      },
      ...wheelIds.map((wheelId, index): SceneNode => ({
        id: wheelId,
        name: `Preview Vehicle Wheel ${index + 1}`,
        nodeType: 'Cylinder',
        position: {
          x: wheelPositions[index]!.x,
          y: 0.36,
          z: wheelPositions[index]!.z,
        },
        rotation: { x: Math.PI / 2, y: 0, z: 0 },
        scale: { x: 0.36, y: 0.2, z: 0.36 },
        visible: true,
      })),
    ],
    components: {},
  }
  const rigidbody = createRigidbodyComponentState(node, {
    mass: 1200,
    bodyType: 'DYNAMIC',
    colliderType: 'box',
    targetNodeId: nodeId,
  }, {
    id: `${nodeId}:rigidbody`,
    enabled: true,
  })
  rigidbody.metadata = {
    [RIGIDBODY_METADATA_KEY]: {
      shape: {
        kind: 'box',
        halfExtents: [1.6, 0.55, 0.8],
        applyScale: true,
      } satisfies RigidbodyPhysicsShape,
    },
  }
  node.components![RIGIDBODY_COMPONENT_TYPE] = rigidbody
  node.components![VEHICLE_COMPONENT_TYPE] = createVehicleComponentState(node, {
    wheelScaleMode: 'relative',
    indexRightAxis: 2,
    indexUpAxis: 1,
    indexForwardAxis: 0,
    maxSteerDegrees: 28,
    maxSteerRateDegPerSec: 150,
    engineForceMax: 340,
    brakeForceMax: 24,
    maxSpeedKmh: 40,
    wheels,
  }, {
    id: `${nodeId}:vehicle`,
    enabled: true,
  })
  node.components![AUTO_TOUR_COMPONENT_TYPE] = createAutoTourComponentState(node, {
    routeNodeId,
    speedMps: 11.11111111111111,
  }, {
    id: `${nodeId}:auto-tour`,
    enabled: true,
  })
  return node
}

export function ensureGuideRouteDebugActors(
  document: SceneJsonExportDocument,
): EnsureGuideRouteDebugActorsResult {
  const nodes = flattenSceneNodes(document.nodes)
  const requirements = collectGuideRouteActorRequirements(nodes)
  const existingKinds = new Set(
    nodes
      .map((node) => resolveNodeActorKind(node))
      .filter((kind): kind is SceneActorKind => Boolean(kind)),
  )
  const addedNodeIds: string[] = []
  const addedKinds: SceneActorKind[] = []
  for (const requirement of requirements) {
    if (existingKinds.has(requirement.kind)) {
      continue
    }
    const position = resolveGuideRouteActorSpawnPosition(document, requirement.kind)
    const routeNodeId = requirement.routeNodeIds[0] ?? null
    const node = requirement.kind === 'character'
      ? buildDebugCharacterNode(position, routeNodeId)
      : buildDebugVehicleNode(position, routeNodeId)
    document.nodes = [...(document.nodes ?? []), node]
    existingKinds.add(requirement.kind)
    addedNodeIds.push(node.id)
    addedKinds.push(requirement.kind)
  }
  return {
    requirements,
    addedNodeIds,
    addedKinds,
  }
}
