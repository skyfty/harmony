import * as THREE from 'three'

import type {
  SceneJsonExportDocument,
  SceneNode,
  SceneNodeComponentState,
} from './core'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  clampAutoTourComponentProps,
  cloneAutoTourComponentProps,
  createAutoTourComponentState,
  type AutoTourComponentProps,
} from './components/definitions/autoTourComponent'
import { CHARACTER_CONTROLLER_COMPONENT_TYPE } from './components/definitions/characterControllerComponent'
import {
  GUIDE_ROUTE_COMPONENT_TYPE,
  type GuideRouteComponentProps,
} from './components/definitions/guideRouteComponent'
import { VEHICLE_COMPONENT_TYPE } from './components/definitions/vehicleComponent'

export type SceneActorKind = 'character' | 'vehicle'

export type SceneActorAutoTourEnsureOptions = {
  /**
   * Optional explicitly selected route. It is used only when an actor has no
   * valid binding, so existing scene-authored bindings still take precedence.
   */
  preferredRouteNodeId?: string | null
}

export type SceneActorAutoTourEnsureResult = {
  actorNodeIds: string[]
  attachedNodeIds: string[]
  reboundNodeIds: string[]
  unboundNodeIds: string[]
}

type IndexedNode = {
  node: SceneNode
  order: number
  worldMatrix: THREE.Matrix4
}

type RouteCandidate = {
  nodeId: string
  order: number
  x: number
  z: number
}

function normalizeNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length ? normalized : null
}

function isEnabledComponent(node: SceneNode, type: string): boolean {
  const component = node.components?.[type]
  return Boolean(component && component.enabled !== false)
}

export function resolveSceneActorKind(node: SceneNode | null | undefined): SceneActorKind | null {
  if (!node) {
    return null
  }
  if (isEnabledComponent(node, CHARACTER_CONTROLLER_COMPONENT_TYPE)) {
    return 'character'
  }
  if (isEnabledComponent(node, VEHICLE_COMPONENT_TYPE)) {
    return 'vehicle'
  }
  return null
}

export function findFirstSceneActorNode(
  root: SceneNode | null | undefined,
  kind?: SceneActorKind | null,
): SceneNode | null {
  if (!root) {
    return null
  }
  const stack: SceneNode[] = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const resolvedKind = resolveSceneActorKind(node)
    if (resolvedKind && (!kind || resolvedKind === kind)) {
      return node
    }
    if (Array.isArray(node.children) && node.children.length) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!)
      }
    }
  }
  return null
}

export function buildSceneActorAutoTourComponentId(nodeId: string): string {
  const normalized = nodeId.trim() || 'actor'
  return `${AUTO_TOUR_COMPONENT_TYPE}:${normalized}`
}

export function transferSceneActorAutoTourComponent(
  sourceNode: SceneNode | null | undefined,
  targetNode: SceneNode | null | undefined,
): boolean {
  const sourceComponent = sourceNode?.components?.[AUTO_TOUR_COMPONENT_TYPE] as
    | SceneNodeComponentState<AutoTourComponentProps>
    | undefined
  if (!sourceComponent || !targetNode) {
    return false
  }

  const props = cloneAutoTourComponentProps(
    clampAutoTourComponentProps(sourceComponent.props),
  )
  const components = targetNode.components ?? (targetNode.components = {})
  const targetComponent = components[AUTO_TOUR_COMPONENT_TYPE] as
    | SceneNodeComponentState<AutoTourComponentProps>
    | undefined
  if (targetComponent) {
    targetComponent.props = props
    targetComponent.enabled = sourceComponent.enabled !== false
    return true
  }

  components[AUTO_TOUR_COMPONENT_TYPE] = {
    id: buildSceneActorAutoTourComponentId(targetNode.id),
    type: AUTO_TOUR_COMPONENT_TYPE,
    enabled: sourceComponent.enabled !== false,
    props,
  }
  return true
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildNodeLocalMatrix(node: SceneNode): THREE.Matrix4 {
  const scaleX = finiteNumber(node.scale?.x, 1)
  const scaleY = finiteNumber(node.scale?.y, 1)
  const scaleZ = finiteNumber(node.scale?.z, 1)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(
      finiteNumber(node.position?.x, 0),
      finiteNumber(node.position?.y, 0),
      finiteNumber(node.position?.z, 0),
    ),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      finiteNumber(node.rotation?.x, 0),
      finiteNumber(node.rotation?.y, 0),
      finiteNumber(node.rotation?.z, 0),
      'XYZ',
    )),
    new THREE.Vector3(
      Math.abs(scaleX) > 1e-8 ? scaleX : 1,
      Math.abs(scaleY) > 1e-8 ? scaleY : 1,
      Math.abs(scaleZ) > 1e-8 ? scaleZ : 1,
    ),
  )
}

function indexSceneNodes(document: SceneJsonExportDocument | null | undefined): IndexedNode[] {
  const indexed: IndexedNode[] = []
  let order = 0

  const visit = (
    nodes: SceneNode[] | undefined,
    parentWorldMatrix: THREE.Matrix4,
  ): void => {
    if (!Array.isArray(nodes)) {
      return
    }
    for (const node of nodes) {
      if (!node) {
        continue
      }
      const worldMatrix = new THREE.Matrix4().multiplyMatrices(
        parentWorldMatrix,
        buildNodeLocalMatrix(node),
      )
      indexed.push({ node, order: order++, worldMatrix })
      visit(node.children, worldMatrix)
    }
  }

  visit(document?.nodes, new THREE.Matrix4())
  return indexed
}

function resolveRouteStart(
  node: SceneNode,
  worldMatrix: THREE.Matrix4,
): { x: number; z: number } {
  const component = node.components?.[GUIDE_ROUTE_COMPONENT_TYPE] as
    | SceneNodeComponentState<Partial<GuideRouteComponentProps>>
    | undefined
  const waypoint = component?.props?.waypoints?.[0]?.position
  if (waypoint) {
    return {
      x: finiteNumber(waypoint.x, worldMatrix.elements[12]!),
      z: finiteNumber(waypoint.z, worldMatrix.elements[14]!),
    }
  }
  return {
    x: worldMatrix.elements[12]!,
    z: worldMatrix.elements[14]!,
  }
}

function isUsableGuideRoute(node: SceneNode): boolean {
  if (node.dynamicMesh?.type !== 'GuideRoute') {
    return false
  }
  const component = node.components?.[GUIDE_ROUTE_COMPONENT_TYPE] as
    | SceneNodeComponentState<Partial<GuideRouteComponentProps>>
    | undefined
  return Boolean(
    component
    && component.enabled !== false
    && component.props?.version === 2,
  )
}

function resolveNearestRouteNodeId(
  actor: IndexedNode,
  routes: readonly RouteCandidate[],
): string | null {
  const actorX = actor.worldMatrix.elements[12]!
  const actorZ = actor.worldMatrix.elements[14]!
  let nearest: RouteCandidate | null = null
  let nearestDistanceSq = Number.POSITIVE_INFINITY
  for (const route of routes) {
    const dx = actorX - route.x
    const dz = actorZ - route.z
    const distanceSq = dx * dx + dz * dz
    if (
      distanceSq < nearestDistanceSq
      || (
        distanceSq === nearestDistanceSq
        && nearest !== null
        && route.order < nearest.order
      )
    ) {
      nearest = route
      nearestDistanceSq = distanceSq
    }
  }
  return nearest?.nodeId ?? null
}

/**
 * Adds AutoTour to every enabled character/vehicle actor in a runtime scene
 * document and repairs missing or stale Guide Route bindings.
 */
export function ensureSceneActorAutoTourComponents(
  document: SceneJsonExportDocument | null | undefined,
  options: SceneActorAutoTourEnsureOptions = {},
): SceneActorAutoTourEnsureResult {
  const result: SceneActorAutoTourEnsureResult = {
    actorNodeIds: [],
    attachedNodeIds: [],
    reboundNodeIds: [],
    unboundNodeIds: [],
  }
  if (!document) {
    return result
  }

  const indexed = indexSceneNodes(document)
  const routes = indexed
    .filter((entry) => isUsableGuideRoute(entry.node))
    .map((entry) => ({
      nodeId: entry.node.id,
      order: entry.order,
      ...resolveRouteStart(entry.node, entry.worldMatrix),
    }))
  const routeNodeIds = new Set(routes.map((route) => route.nodeId))
  const preferredRouteNodeId = normalizeNodeId(options.preferredRouteNodeId)
  const fallbackRouteNodeId = preferredRouteNodeId && routeNodeIds.has(preferredRouteNodeId)
    ? preferredRouteNodeId
    : null

  for (const entry of indexed) {
    if (!resolveSceneActorKind(entry.node)) {
      continue
    }
    result.actorNodeIds.push(entry.node.id)
    const components = entry.node.components ?? (entry.node.components = {})
    let component = components[AUTO_TOUR_COMPONENT_TYPE] as
      | SceneNodeComponentState<AutoTourComponentProps>
      | undefined
    if (!component) {
      component = createAutoTourComponentState(entry.node, {
        routeNodeId: null,
      }, {
        id: buildSceneActorAutoTourComponentId(entry.node.id),
        enabled: true,
      })
      components[AUTO_TOUR_COMPONENT_TYPE] = component
      result.attachedNodeIds.push(entry.node.id)
    } else if (!normalizeNodeId(component.id)) {
      component.id = buildSceneActorAutoTourComponentId(entry.node.id)
    }

    const currentRouteNodeId = normalizeNodeId(component.props?.routeNodeId)
    if (currentRouteNodeId && routeNodeIds.has(currentRouteNodeId)) {
      continue
    }

    const nextRouteNodeId = fallbackRouteNodeId ?? resolveNearestRouteNodeId(entry, routes)
    component.props = clampAutoTourComponentProps({
      ...(component.props ?? {}),
      routeNodeId: nextRouteNodeId,
    })
    if (nextRouteNodeId) {
      result.reboundNodeIds.push(entry.node.id)
    } else {
      result.unboundNodeIds.push(entry.node.id)
    }
  }

  return result
}
