import * as THREE from 'three'
import type { SceneNode } from './core'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import {
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  clampCharacterControllerComponentProps,
  type CharacterControllerComponentProps,
  type CharacterForwardAxis,
  writeCharacterLocalForward,
} from './components/definitions/characterControllerComponent'
import {
  AUTO_TOUR_COMPONENT_TYPE,
  clampAutoTourComponentProps,
  type AutoTourComponentProps,
} from './components/definitions/autoTourComponent'
import {
  GUIDE_ROUTE_COMPONENT_TYPE,
  clampGuideRouteComponentProps,
  type GuideRouteComponentProps,
} from './components/definitions/guideRouteComponent'
import {
  evaluateGuideRoute,
  resolveGuideRoutePrimaryProviderNodeId,
} from './guideRouteRuntime'
import {
  buildGuideRouteTravelWindow,
  type GuideRouteTourTargetOptions,
  type GuideRouteTravelWindow,
} from './guideRouteTourTarget'
import { resolvePathFollowLookaheadDistance, resolvePathFollowSample } from './pathFollowCommon'
import { sampleProceduralLandscapeGuideRouteSurface } from './proceduralLandscape/runtime'

export type CharacterAutoTourInputState = {
  moveX: number
  moveZ: number
  turn: number
  jump: boolean
  sprint: boolean
  crouch: boolean
  interact: boolean
  yaw?: number
  locallyControlled?: boolean
}

export type CharacterAutoTourRuntimeEntry = {
  nodeId: string
  props: AutoTourComponentProps
  controllerProps: CharacterControllerComponentProps | null
  routeNodeId: string | null
  routeWaypointCount: number
  sourceRouteWaypointCount: number
  target: GuideRouteTourTargetOptions | null
  travelWindow: GuideRouteTravelWindow | null
  hasSample: boolean
  smoothedWorldPosition: THREE.Vector3
  smoothedYaw: number
  lastInput: CharacterAutoTourInputState
  lastTargetIndex: number
  firedStopIds: Set<string>
  firedTransitionIds: Set<string>
  pendingTransitionId: string | null
  smoothedSpeedMps: number
  lastRouteDistance: number
}

export type CharacterAutoTourRouteSnapResult = {
  nodeId: string
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
  forwardWorld: THREE.Vector3
  yaw: number
  travelWindow: GuideRouteTravelWindow | null
  targetReached: boolean
}

export type CharacterAutoTourRuntimeHost = {
  iterNodes: () => Iterable<[string, SceneNode]>
  resolveNode: (nodeId: string) => SceneNode | null
  nodeObjectMap: Map<string, THREE.Object3D>
  onNodeObjectTransformUpdated?: (nodeId: string, object: THREE.Object3D) => void
  shouldApplyWorldTransform?: (nodeId: string) => boolean
  onTourComplete?: (nodeId: string) => void
  onGuideStop?: (
    nodeId: string,
    stop: NonNullable<ReturnType<typeof evaluateGuideRoute>['stops'][number]>,
  ) => void
  onGuideTransition?: (
    nodeId: string,
    transition: NonNullable<ReturnType<typeof evaluateGuideRoute>['transitions'][number]>,
  ) => void
}

type GuideRouteWorldWaypoints = {
  evaluation: ReturnType<typeof evaluateGuideRoute>
  points: THREE.Vector3[]
  providerNodeId: string | null
} | null

const characterPathFollowWorldPosition = new THREE.Vector3()
const characterPathFollowTargetPosition = new THREE.Vector3()
const characterPathFollowDirection = new THREE.Vector3()
const characterPathFollowLookaheadPoint = new THREE.Vector3()
const characterPathFollowWorldQuaternion = new THREE.Quaternion()
const characterPathFollowParentQuaternion = new THREE.Quaternion()
const characterPathFollowLocalPosition = new THREE.Vector3()
const characterPathFollowLocalQuaternion = new THREE.Quaternion()
const characterPathFollowUp = new THREE.Vector3(0, 1, 0)
const characterPathFollowForward = new THREE.Vector3()

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function setVector3Like(target: any, x: number, y: number, z: number): void {
  if (!target) {
    return
  }
  if (typeof target.set === 'function') {
    target.set(x, y, z)
    return
  }
  target.x = x
  target.y = y
  target.z = z
}

function syncNodeTransformFromObject(node: SceneNode, object: THREE.Object3D): void {
  setVector3Like(node.position as any, object.position.x, object.position.y, object.position.z)
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  euler.setFromQuaternion(object.quaternion)
  setVector3Like(node.rotation as any, euler.x, euler.y, euler.z)
}

function applyWorldTransformToObject(
  object: THREE.Object3D,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
): void {
  if (object.parent) {
    object.parent.updateMatrixWorld(true)
    characterPathFollowLocalPosition.copy(worldPosition)
    object.parent.worldToLocal(characterPathFollowLocalPosition)
    object.position.copy(characterPathFollowLocalPosition)
    object.parent.getWorldQuaternion(characterPathFollowParentQuaternion).invert()
    characterPathFollowLocalQuaternion.copy(characterPathFollowParentQuaternion).multiply(worldQuaternion)
    object.quaternion.copy(characterPathFollowLocalQuaternion)
  } else {
    object.position.copy(worldPosition)
    object.quaternion.copy(worldQuaternion)
  }
  object.updateMatrixWorld(true)
}

function resolveCharacterForwardAxisOffsetRadians(forwardAxis: CharacterForwardAxis): number {
  switch (forwardAxis) {
    case '+x':
      return 0
    case '+z':
      return Math.PI * 0.5
    case '-x':
      return Math.PI
    case '-z':
      return -Math.PI * 0.5
    default:
      return 0
  }
}

function resolveCharacterGroundOffsetY(props: CharacterControllerComponentProps): number {
  const radius = Math.max(0.05, props.colliderRadius)
  const halfHeight = Math.max(radius, props.colliderHeight * 0.5)
  return Math.max(0, halfHeight - radius) + 0.02
}

function resolveGuideRouteWorldWaypoints(
  resolveNode: (nodeId: string) => SceneNode | null,
  nodeObjectMap: Map<string, THREE.Object3D>,
  routeNodeId: string | null,
): GuideRouteWorldWaypoints {
  if (!routeNodeId) {
    return null
  }
  const routeNode = resolveNode(routeNodeId)
  if (!routeNode) {
    return null
  }
  const props = clampGuideRouteComponentProps(
    (routeNode.components?.[GUIDE_ROUTE_COMPONENT_TYPE]?.props ?? null) as
      | Partial<GuideRouteComponentProps>
      | null,
  )
  const providerNodeId = resolveGuideRoutePrimaryProviderNodeId(props)
  const providerObject = providerNodeId
    ? nodeObjectMap.get(providerNodeId) ?? null
    : null
  const routeObject = nodeObjectMap.get(routeNode.id) ?? null
  const evaluation = evaluateGuideRoute({ routeNode, providerObject, routeObject })
  return evaluation.status === 'ready'
    ? {
      evaluation,
      points: evaluation.points,
      providerNodeId: evaluation.providerNodeId,
    }
    : null
}

function resolveCharacterSurfaceY(
  routeData: NonNullable<GuideRouteWorldWaypoints>,
  worldX: number,
  worldZ: number,
  facingYawRad: number,
  fallbackY: number,
): number {
  if (!routeData.providerNodeId) {
    return fallbackY
  }
  return sampleProceduralLandscapeGuideRouteSurface(
    routeData.providerNodeId,
    worldX,
    worldZ,
    facingYawRad,
  )?.point.y ?? fallbackY
}

function findClosestWaypointIndexXZ(
  points: readonly THREE.Vector3[],
  position: THREE.Vector3,
): number {
  let bestIndex = 0
  let bestDistanceSq = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    if (!point) {
      continue
    }
    const deltaX = point.x - position.x
    const deltaZ = point.z - position.z
    const distanceSq = deltaX * deltaX + deltaZ * deltaZ
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestIndex = index
    }
  }
  return bestIndex
}

function getObjectWorldPosition(object: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  object.updateMatrixWorld(true)
  object.getWorldPosition(out)
  return out
}

function getObjectWorldYawRadians(object: THREE.Object3D, forwardAxis: CharacterForwardAxis): number {
  object.getWorldQuaternion(characterPathFollowWorldQuaternion)
  writeCharacterLocalForward(characterPathFollowForward, forwardAxis)
  characterPathFollowForward.applyQuaternion(characterPathFollowWorldQuaternion)
  characterPathFollowForward.y = 0
  if (characterPathFollowForward.lengthSq() < 1e-8) {
    return 0
  }
  characterPathFollowForward.normalize()
  return Math.atan2(characterPathFollowForward.x, characterPathFollowForward.z)
}

function createIdleCharacterAutoTourInput(yaw: number): CharacterAutoTourInputState {
  return {
    moveX: 0,
    moveZ: 0,
    turn: 0,
    jump: false,
    sprint: false,
    crouch: false,
    interact: false,
    yaw,
    locallyControlled: false,
  }
}

export class CharacterAutoTourRuntimeManager {
  private readonly entries = new Map<string, CharacterAutoTourRuntimeEntry>()
  private readonly activeNodeIds = new Set<string>()
  private readonly pausedNodeIds = new Set<string>()
  private readonly pendingTargets = new Map<string, GuideRouteTourTargetOptions>()

  has(nodeId: string): boolean {
    return this.entries.has(nodeId)
  }

  isActive(nodeId: string): boolean {
    return this.activeNodeIds.has(nodeId) && this.entries.has(nodeId)
  }

  activate(nodeId: string, target?: GuideRouteTourTargetOptions): void {
    this.activeNodeIds.add(nodeId)
    this.pausedNodeIds.delete(nodeId)
    this.entries.delete(nodeId)
    if (target) {
      this.pendingTargets.set(nodeId, target)
    } else {
      this.pendingTargets.delete(nodeId)
    }
  }

  deactivate(nodeId: string): void {
    this.activeNodeIds.delete(nodeId)
    this.pausedNodeIds.delete(nodeId)
    this.entries.delete(nodeId)
    this.pendingTargets.delete(nodeId)
  }

  setPaused(nodeId: string, paused: boolean): void {
    if (!this.activeNodeIds.has(nodeId)) {
      return
    }
    if (paused) {
      this.pausedNodeIds.add(nodeId)
      const entry = this.entries.get(nodeId)
      if (entry) {
        entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
      }
    } else {
      this.pausedNodeIds.delete(nodeId)
    }
  }

  getActiveNodeIds(): IterableIterator<string> {
    return this.activeNodeIds.values()
  }

  /** Number of nodes currently following an auto-tour/path-follow route. */
  get size(): number {
    return this.entries.size
  }

  getInput(nodeId: string): CharacterAutoTourInputState | null {
    return this.entries.get(nodeId)?.lastInput ?? null
  }

  resolveRouteSnap(
    host: CharacterAutoTourRuntimeHost,
    nodeId: string,
    target?: GuideRouteTourTargetOptions,
  ): CharacterAutoTourRouteSnapResult | null {
    const node = host.resolveNode(nodeId)
    const object = host.nodeObjectMap.get(nodeId) ?? null
    const component = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
    const controllerComponent = resolveEnabledComponentState<CharacterControllerComponentProps>(
      node,
      CHARACTER_CONTROLLER_COMPONENT_TYPE,
    )
    if (!node || !object || !component || !controllerComponent) {
      return null
    }
    const tourProps = clampAutoTourComponentProps(component.props)
    const controllerProps = clampCharacterControllerComponentProps(controllerComponent.props)
    const routeData = resolveGuideRouteWorldWaypoints(host.resolveNode, host.nodeObjectMap, tourProps.routeNodeId)
    if (!routeData || routeData.points.length < 2) {
      return null
    }
    const currentPosition = getObjectWorldPosition(object, new THREE.Vector3())
    const lookaheadDistance = resolvePathFollowLookaheadDistance({
      speedMps: tourProps.speedMps,
      baseMeters: 1.4,
      speedGain: 0.35,
      minMeters: 1.1,
      maxMeters: 5.5,
    })
    const sample = resolvePathFollowSample({
      points: routeData.points,
      loop: routeData.evaluation.loop,
      currentPosition,
      lookaheadDistance,
      mode: 'xz',
      outLookaheadPoint: new THREE.Vector3(),
      outClosestPoint: new THREE.Vector3(),
    })
    if (!sample) {
      return null
    }
    const travelWindow = target
      ? buildGuideRouteTravelWindow(
        routeData.evaluation,
        sample.projection.s,
        target,
        routeData.evaluation.loop,
      )
      : null
    const targetReached = Boolean(target && !travelWindow)
    const effectivePoints = travelWindow?.route.points ?? routeData.points
    const segmentIndex = travelWindow ? 0 : sample.projection.segmentIndex
    const segmentStart = effectivePoints[segmentIndex] ?? sample.projection.closestPoint
    const segmentEnd = effectivePoints[segmentIndex + 1]
      ?? (!target && routeData.evaluation.loop ? effectivePoints[0] : null)
      ?? sample.lookaheadPoint
    const forwardWorld = segmentEnd.clone().sub(segmentStart)
    forwardWorld.y = 0
    if (forwardWorld.lengthSq() <= 1e-8) {
      forwardWorld.copy(sample.lookaheadPoint).sub(sample.projection.closestPoint)
      forwardWorld.y = 0
    }
    if (forwardWorld.lengthSq() <= 1e-8) {
      forwardWorld.set(1, 0, 0)
    } else {
      forwardWorld.normalize()
    }
    const yaw = Math.atan2(-forwardWorld.z, forwardWorld.x)
      + resolveCharacterForwardAxisOffsetRadians(controllerProps.forwardAxis)
    const worldPosition = travelWindow
      ? effectivePoints[0]?.clone() ?? sample.projection.closestPoint.clone()
      : sample.projection.closestPoint.clone()
    const groundOffsetY = resolveCharacterGroundOffsetY(controllerProps)
    worldPosition.y = resolveCharacterSurfaceY(
      routeData,
      worldPosition.x,
      worldPosition.z,
      Math.atan2(-forwardWorld.z, forwardWorld.x),
      worldPosition.y,
    ) + groundOffsetY
    return {
      nodeId,
      worldPosition,
      worldQuaternion: new THREE.Quaternion().setFromAxisAngle(characterPathFollowUp, yaw),
      forwardWorld,
      yaw,
      travelWindow,
      targetReached,
    }
  }

  clear(): void {
    this.entries.clear()
    this.activeNodeIds.clear()
    this.pausedNodeIds.clear()
    this.pendingTargets.clear()
  }

  completeGuideTransition(nodeId: string, success: boolean, message?: string): void {
    const entry = this.entries.get(nodeId)
    if (!entry?.pendingTransitionId) {
      return
    }
    entry.pendingTransitionId = null
    if (!success) {
      this.deactivate(nodeId)
      void message
    }
  }

  refresh(host: CharacterAutoTourRuntimeHost): void {
    const nextEntries = new Map<string, CharacterAutoTourRuntimeEntry>()
    for (const [nodeId, node] of host.iterNodes()) {
      if (!this.activeNodeIds.has(nodeId)) {
        continue
      }
      const component = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
      if (!component) {
        continue
      }
      const controllerComponent = resolveEnabledComponentState<CharacterControllerComponentProps>(node, CHARACTER_CONTROLLER_COMPONENT_TYPE)
      if (!controllerComponent) {
        continue
      }
      const previous = this.entries.get(nodeId) ?? null
      const normalizedProps = clampAutoTourComponentProps(component.props)
      const target = this.pendingTargets.get(nodeId) ?? previous?.target ?? null
      nextEntries.set(nodeId, {
        nodeId,
        props: normalizedProps,
        controllerProps: clampCharacterControllerComponentProps(controllerComponent.props),
        routeNodeId: normalizedProps.routeNodeId,
        routeWaypointCount: previous?.routeWaypointCount ?? 0,
        sourceRouteWaypointCount: previous?.sourceRouteWaypointCount ?? 0,
        target,
        travelWindow: previous?.travelWindow ?? null,
        hasSample: previous?.hasSample ?? false,
        smoothedWorldPosition: previous?.smoothedWorldPosition?.clone?.() ?? new THREE.Vector3(),
        smoothedYaw: previous?.smoothedYaw ?? 0,
        lastInput: previous?.lastInput ?? {
          moveX: 0,
          moveZ: 0,
          turn: 0,
          jump: false,
          sprint: false,
          crouch: false,
          interact: false,
          yaw: previous?.lastInput?.yaw ?? 0,
          locallyControlled: false,
        },
        lastTargetIndex: previous?.lastTargetIndex ?? 0,
        firedStopIds: previous?.firedStopIds ?? new Set(),
        firedTransitionIds: previous?.firedTransitionIds ?? new Set(),
        pendingTransitionId: previous?.pendingTransitionId ?? null,
        smoothedSpeedMps: previous?.smoothedSpeedMps ?? 0,
        lastRouteDistance: previous?.lastRouteDistance ?? 0,
      })
      this.pendingTargets.delete(nodeId)
    }
    this.activeNodeIds.forEach((nodeId) => {
      if (!nextEntries.has(nodeId)) {
        this.activeNodeIds.delete(nodeId)
        this.pausedNodeIds.delete(nodeId)
        this.pendingTargets.delete(nodeId)
      }
    })
    this.entries.clear()
    nextEntries.forEach((entry, nodeId) => {
      this.entries.set(nodeId, entry)
    })
  }

  update(host: CharacterAutoTourRuntimeHost, deltaSeconds: number): void {
    if (!this.entries.size || !(deltaSeconds > 0)) {
      return
    }

    this.entries.forEach((entry, nodeId) => {
      const node = host.resolveNode(nodeId)
      const object = host.nodeObjectMap.get(nodeId) ?? null
      if (!node || !object) {
        return
      }

      const component = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE)
      const controllerComponent = resolveEnabledComponentState<CharacterControllerComponentProps>(node, CHARACTER_CONTROLLER_COMPONENT_TYPE)
      if (!component || !controllerComponent) {
        return
      }
      const normalizedProps = clampAutoTourComponentProps(component.props)
      const previousRouteNodeId = entry.routeNodeId
      entry.props = normalizedProps
      entry.routeNodeId = normalizedProps.routeNodeId
      entry.controllerProps = clampCharacterControllerComponentProps(controllerComponent.props)
      if (this.pausedNodeIds.has(nodeId)) {
        entry.lastInput = createIdleCharacterAutoTourInput(
          getObjectWorldYawRadians(object, entry.controllerProps.forwardAxis),
        )
        return
      }
      if (entry.pendingTransitionId) {
        entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
        return
      }

      const routeData = resolveGuideRouteWorldWaypoints(host.resolveNode, host.nodeObjectMap, entry.routeNodeId)
      if (!routeData) {
        entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
        return
      }

      const currentPosition = getObjectWorldPosition(object, characterPathFollowWorldPosition)
      const sourceRouteWaypointCount = routeData.points.length
      if (previousRouteNodeId !== entry.routeNodeId) {
        entry.travelWindow = null
        entry.target = null
      }
      if (entry.target) {
        const existingWindowMatchesRoute = entry.travelWindow
          && entry.sourceRouteWaypointCount === sourceRouteWaypointCount
        if (!existingWindowMatchesRoute) {
          const projectionSample = resolvePathFollowSample({
            points: routeData.points,
            loop: routeData.evaluation.loop,
            currentPosition,
            lookaheadDistance: 0,
            mode: 'xz',
          })
          const travelWindow = buildGuideRouteTravelWindow(
            routeData.evaluation,
            projectionSample?.projection.s ?? 0,
            entry.target,
            routeData.evaluation.loop,
          )
          if (!travelWindow) {
            entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
            this.deactivate(nodeId)
            host.onTourComplete?.(nodeId)
            return
          }
          entry.travelWindow = travelWindow
        }
      }
      const activePoints = entry.travelWindow?.route.points ?? routeData.points
      const activeLoop = entry.travelWindow ? false : routeData.evaluation.loop
      const resettingRouteProgress = (
        !entry.hasSample
        || previousRouteNodeId !== entry.routeNodeId
        || entry.sourceRouteWaypointCount !== sourceRouteWaypointCount
        || entry.routeWaypointCount !== activePoints.length
      )
      if (resettingRouteProgress) {
        entry.hasSample = true
        entry.routeWaypointCount = activePoints.length
        entry.sourceRouteWaypointCount = sourceRouteWaypointCount
        entry.smoothedWorldPosition.copy(currentPosition)
        entry.smoothedYaw = getObjectWorldYawRadians(object, entry.controllerProps?.forwardAxis ?? '+x')
        entry.lastTargetIndex = findClosestWaypointIndexXZ(activePoints, currentPosition)
      }

      const controllerProps = entry.controllerProps ?? clampCharacterControllerComponentProps(null)
      const groundOffsetY = resolveCharacterGroundOffsetY(controllerProps)
      const baseSpeedMps = Math.max(0, entry.props.speedMps)
      const lookaheadDistance = resolvePathFollowLookaheadDistance({
        speedMps: baseSpeedMps,
        baseMeters: 1.4,
        speedGain: 0.35,
        minMeters: 1.1,
        maxMeters: 5.5,
      })
      const sample = resolvePathFollowSample({
        points: activePoints,
        loop: activeLoop,
        currentPosition,
        lookaheadDistance,
        mode: 'xz',
        outLookaheadPoint: characterPathFollowLookaheadPoint,
      })
      if (!sample) {
        return
      }
      if (resettingRouteProgress) {
        entry.lastRouteDistance = entry.travelWindow ? 0 : sample.projection.s
      }
      const progressDistance = entry.travelWindow ? 0 : sample.projection.s
      const progressLeg = routeData.evaluation.legs.find((leg) => (
        progressDistance >= leg.routeStartDistance - 1e-4
        && progressDistance <= leg.routeEndDistance + 1e-4
      )) ?? routeData.evaluation.legs[routeData.evaluation.legs.length - 1]
      if (progressLeg && progressLeg.travelMode !== 'character') {
        entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
        this.deactivate(nodeId)
        host.onTourComplete?.(nodeId)
        return
      }
      const speedMps = Math.max(
        0,
        Math.min(
          baseSpeedMps,
          progressLeg?.speedProfile.cruiseSpeedMps ?? baseSpeedMps,
        ),
      )
      const speedAlpha = 1 - Math.exp(-Math.max(0, deltaSeconds) / 0.55)
      entry.smoothedSpeedMps = entry.smoothedSpeedMps <= 0
        ? speedMps
        : entry.smoothedSpeedMps + (speedMps - entry.smoothedSpeedMps) * speedAlpha
      const previousRouteDistance = entry.lastRouteDistance
      const plannedRouteDistance = sample.projection.s + entry.smoothedSpeedMps * deltaSeconds
      const crossesRouteDistance = (distance: number): boolean => (
        distance > previousRouteDistance + 1e-4
        && distance <= plannedRouteDistance + 1e-4
      )
      if (!entry.travelWindow) {
        for (const stop of routeData.evaluation.stops) {
          if (
            !entry.firedStopIds.has(stop.definition.id)
            && crossesRouteDistance(stop.routeDistance)
          ) {
            entry.firedStopIds.add(stop.definition.id)
            host.onGuideStop?.(nodeId, stop)
          }
        }
      }
      const scheduledTransition = !entry.travelWindow
        ? routeData.evaluation.transitions.find((transition) => (
          !entry.firedTransitionIds.has(transition.definition.id)
          && crossesRouteDistance(transition.routeDistance)
        )) ?? null
        : null

      if (!activeLoop) {
        const endPoint = activePoints[activePoints.length - 1]!
        const endDistance = Math.hypot(
          currentPosition.x - endPoint.x,
          currentPosition.z - endPoint.z,
        )
        const arrivalDistance = Math.max(0.35, Math.min(1.25, speedMps * 0.2))
        if (endDistance <= arrivalDistance) {
          const endpointTransition = !entry.travelWindow
            ? routeData.evaluation.transitions.find((transition) => (
              !entry.firedTransitionIds.has(transition.definition.id)
              && transition.routeDistance >= routeData.evaluation.totalLength - 0.1
            )) ?? null
            : null
          if (endpointTransition) {
            entry.firedTransitionIds.add(endpointTransition.definition.id)
            entry.pendingTransitionId = endpointTransition.definition.id
            entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
            host.onGuideTransition?.(nodeId, endpointTransition)
            return
          }
          const prevPoint = activePoints[Math.max(0, activePoints.length - 2)] ?? endPoint
          characterPathFollowDirection.copy(endPoint).sub(prevPoint)
          characterPathFollowDirection.y = 0
          let endpointFacingYaw = entry.smoothedYaw
          if (characterPathFollowDirection.lengthSq() > 1e-8) {
            characterPathFollowDirection.normalize()
            endpointFacingYaw =
              Math.atan2(-characterPathFollowDirection.z, characterPathFollowDirection.x)
              + resolveCharacterForwardAxisOffsetRadians(controllerProps.forwardAxis)
            entry.smoothedYaw = endpointFacingYaw
          }
          entry.smoothedWorldPosition.copy(endPoint)
          entry.smoothedWorldPosition.y = resolveCharacterSurfaceY(
            routeData,
            endPoint.x,
            endPoint.z,
            endpointFacingYaw - resolveCharacterForwardAxisOffsetRadians(controllerProps.forwardAxis),
            endPoint.y,
          ) + groundOffsetY

          const shouldApplyWorldTransform = host.shouldApplyWorldTransform?.(nodeId) ?? true
          if (shouldApplyWorldTransform) {
            characterPathFollowWorldQuaternion.setFromAxisAngle(characterPathFollowUp, entry.smoothedYaw)
            applyWorldTransformToObject(object, entry.smoothedWorldPosition, characterPathFollowWorldQuaternion)
            syncNodeTransformFromObject(node, object)
            host.onNodeObjectTransformUpdated?.(nodeId, object)
          }

          entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
          this.deactivate(nodeId)
          host.onTourComplete?.(nodeId)
          return
        }
      }

      characterPathFollowDirection.copy(sample.lookaheadPoint).sub(currentPosition)
      characterPathFollowDirection.y = 0
      const distanceToLookahead = characterPathFollowDirection.length()
      if (distanceToLookahead <= 1e-6) {
        entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
        return
      }
      characterPathFollowDirection.multiplyScalar(1 / distanceToLookahead)

      let speedFactor = 1
      const projectedPointIndex = findClosestWaypointIndexXZ(activePoints, sample.projection.closestPoint)
      const nextIndex = activeLoop
        ? (projectedPointIndex + 1) % activePoints.length
        : Math.min(activePoints.length - 1, projectedPointIndex + 1)
      const currentWaypoint = activePoints[projectedPointIndex] ?? null
      const nextWaypoint = activePoints[nextIndex] ?? null
      if (currentWaypoint && nextWaypoint) {
        const currentSegment = characterPathFollowTargetPosition.copy(nextWaypoint).sub(currentWaypoint)
        currentSegment.y = 0
        if (currentSegment.lengthSq() > 1e-8) {
          currentSegment.normalize()
          const cornerAngle = Math.acos(THREE.MathUtils.clamp(characterPathFollowDirection.dot(currentSegment), -1, 1))
          const cornerSharpness = THREE.MathUtils.clamp(cornerAngle / Math.PI * 2, 0, 1)
          speedFactor = Math.min(speedFactor, 1 - cornerSharpness * 0.25)
        }
      }
      let stepDistance = Math.max(0, entry.smoothedSpeedMps * deltaSeconds * speedFactor)
      if (scheduledTransition) {
        stepDistance = Math.min(
          stepDistance,
          Math.max(0, scheduledTransition.routeDistance - sample.projection.s),
        )
      }
      const actualStep = Math.min(stepDistance, distanceToLookahead)
      characterPathFollowTargetPosition.copy(currentPosition).addScaledVector(characterPathFollowDirection, actualStep)
      const heightAlpha = distanceToLookahead > 1e-6
        ? Math.min(1, actualStep / distanceToLookahead)
        : 0
      const currentGroundY = currentPosition.y - groundOffsetY
      const pathGroundY = currentGroundY
        + (sample.lookaheadPoint.y - currentGroundY) * heightAlpha
      const targetGroundY = resolveCharacterSurfaceY(
        routeData,
        characterPathFollowTargetPosition.x,
        characterPathFollowTargetPosition.z,
        Math.atan2(-characterPathFollowDirection.z, characterPathFollowDirection.x),
        pathGroundY,
      )
      characterPathFollowTargetPosition.y = targetGroundY + groundOffsetY

      const targetYaw = Math.atan2(-characterPathFollowDirection.z, characterPathFollowDirection.x) + resolveCharacterForwardAxisOffsetRadians(controllerProps.forwardAxis)
      const alpha = 1 - Math.exp(-Math.max(0, 10) * deltaSeconds)
      const yawDelta = Math.atan2(
        Math.sin(targetYaw - entry.smoothedYaw),
        Math.cos(targetYaw - entry.smoothedYaw),
      )
      entry.smoothedYaw += yawDelta * clamp01(alpha)

      entry.smoothedWorldPosition.copy(characterPathFollowTargetPosition)

      const shouldApplyWorldTransform = host.shouldApplyWorldTransform?.(nodeId) ?? true
      if (shouldApplyWorldTransform) {
        characterPathFollowWorldQuaternion.setFromAxisAngle(characterPathFollowUp, entry.smoothedYaw)
        applyWorldTransformToObject(object, entry.smoothedWorldPosition, characterPathFollowWorldQuaternion)
        syncNodeTransformFromObject(node, object)
        host.onNodeObjectTransformUpdated?.(nodeId, object)
      }

      const speedCap = Math.max(0.001, controllerProps.sprintSpeed || controllerProps.runSpeed || controllerProps.walkSpeed || 1)
      const movementMagnitude = clamp01((actualStep / Math.max(deltaSeconds, 1e-4)) / speedCap)
      entry.lastInput = {
        moveX: 0,
        moveZ: movementMagnitude,
        turn: 0,
        jump: false,
        sprint: speedMps >= Math.max(controllerProps.runSpeed, controllerProps.walkSpeed + 0.01),
        crouch: false,
        interact: false,
        yaw: entry.smoothedYaw,
        locallyControlled: false,
      }
      if (!entry.travelWindow) {
        entry.lastRouteDistance = Math.min(
          routeData.evaluation.totalLength,
          sample.projection.s + actualStep,
        )
      }
      if (scheduledTransition) {
        entry.firedTransitionIds.add(scheduledTransition.definition.id)
        entry.pendingTransitionId = scheduledTransition.definition.id
        host.onGuideTransition?.(nodeId, scheduledTransition)
      }
    })
  }
}
