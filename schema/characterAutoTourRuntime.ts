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
import { evaluateGuideRoute } from './guideRouteRuntime'
import { findClosestWaypointIndex, resolvePathFollowLookaheadDistance, resolvePathFollowSample } from './pathFollowCommon'

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
  hasSample: boolean
  smoothedWorldPosition: THREE.Vector3
  smoothedYaw: number
  lastInput: CharacterAutoTourInputState
  lastTargetIndex: number
}

export type CharacterAutoTourRouteSnapResult = {
  nodeId: string
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
  forwardWorld: THREE.Vector3
  yaw: number
}

export type CharacterAutoTourRuntimeHost = {
  iterNodes: () => Iterable<[string, SceneNode]>
  resolveNode: (nodeId: string) => SceneNode | null
  nodeObjectMap: Map<string, THREE.Object3D>
  onNodeObjectTransformUpdated?: (nodeId: string, object: THREE.Object3D) => void
  shouldApplyWorldTransform?: (nodeId: string) => boolean
  onTourComplete?: (nodeId: string) => void
}

type GuideRouteWorldWaypoints = {
  points: THREE.Vector3[]
  dock: boolean[]
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
  const providerObject = props.surfaceProviderNodeId
    ? nodeObjectMap.get(props.surfaceProviderNodeId) ?? null
    : null
  const evaluation = evaluateGuideRoute({ routeNode, providerObject })
  return evaluation.status === 'ready'
    ? { points: evaluation.points, dock: evaluation.dock }
    : null
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

  has(nodeId: string): boolean {
    return this.entries.has(nodeId)
  }

  isActive(nodeId: string): boolean {
    return this.activeNodeIds.has(nodeId) && this.entries.has(nodeId)
  }

  activate(nodeId: string): void {
    this.activeNodeIds.add(nodeId)
    this.pausedNodeIds.delete(nodeId)
    this.entries.delete(nodeId)
  }

  deactivate(nodeId: string): void {
    this.activeNodeIds.delete(nodeId)
    this.pausedNodeIds.delete(nodeId)
    this.entries.delete(nodeId)
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
      loop: tourProps.loop,
      currentPosition,
      lookaheadDistance,
      outLookaheadPoint: new THREE.Vector3(),
      outClosestPoint: new THREE.Vector3(),
    })
    if (!sample) {
      return null
    }
    const segmentIndex = sample.projection.segmentIndex
    const segmentStart = routeData.points[segmentIndex] ?? sample.projection.closestPoint
    const segmentEnd = routeData.points[segmentIndex + 1]
      ?? (tourProps.loop ? routeData.points[0] : null)
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
    const worldPosition = sample.projection.closestPoint.clone()
    worldPosition.y += resolveCharacterGroundOffsetY(controllerProps)
    return {
      nodeId,
      worldPosition,
      worldQuaternion: new THREE.Quaternion().setFromAxisAngle(characterPathFollowUp, yaw),
      forwardWorld,
      yaw,
    }
  }

  clear(): void {
    this.entries.clear()
    this.activeNodeIds.clear()
    this.pausedNodeIds.clear()
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
      nextEntries.set(nodeId, {
        nodeId,
        props: normalizedProps,
        controllerProps: clampCharacterControllerComponentProps(controllerComponent.props),
        routeNodeId: normalizedProps.routeNodeId,
        routeWaypointCount: previous?.routeWaypointCount ?? 0,
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
      })
    }
    this.activeNodeIds.forEach((nodeId) => {
      if (!nextEntries.has(nodeId)) {
        this.activeNodeIds.delete(nodeId)
        this.pausedNodeIds.delete(nodeId)
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

      const routeData = resolveGuideRouteWorldWaypoints(host.resolveNode, host.nodeObjectMap, entry.routeNodeId)
      if (!routeData) {
        entry.lastInput = createIdleCharacterAutoTourInput(entry.smoothedYaw)
        return
      }

      const currentPosition = getObjectWorldPosition(object, characterPathFollowWorldPosition)
      if (!entry.hasSample || previousRouteNodeId !== entry.routeNodeId || entry.routeWaypointCount !== routeData.points.length) {
        entry.hasSample = true
        entry.routeWaypointCount = routeData.points.length
        entry.smoothedWorldPosition.copy(currentPosition)
        entry.smoothedYaw = getObjectWorldYawRadians(object, entry.controllerProps?.forwardAxis ?? '+x')
        entry.lastTargetIndex = findClosestWaypointIndex(routeData.points, currentPosition)
      }

      const controllerProps = entry.controllerProps ?? clampCharacterControllerComponentProps(null)
      const groundOffsetY = resolveCharacterGroundOffsetY(controllerProps)
      const speedMps = Math.max(0, entry.props.speedMps)
      const lookaheadDistance = resolvePathFollowLookaheadDistance({
        speedMps,
        baseMeters: 1.4,
        speedGain: 0.35,
        minMeters: 1.1,
        maxMeters: 5.5,
      })
      const sample = resolvePathFollowSample({
        points: routeData.points,
        loop: entry.props.loop,
        currentPosition,
        lookaheadDistance,
        outLookaheadPoint: characterPathFollowLookaheadPoint,
      })
      if (!sample) {
        return
      }

      if (!entry.props.loop) {
        const endPoint = routeData.points[routeData.points.length - 1]!
        const endDistance = Math.hypot(
          currentPosition.x - endPoint.x,
          currentPosition.z - endPoint.z,
        )
        const arrivalDistance = Math.max(0.35, Math.min(1.25, speedMps * 0.2))
        if (endDistance <= arrivalDistance) {
          entry.smoothedWorldPosition.copy(endPoint)
          entry.smoothedWorldPosition.y += groundOffsetY
          const prevPoint = routeData.points[Math.max(0, routeData.points.length - 2)] ?? endPoint
          characterPathFollowDirection.copy(endPoint).sub(prevPoint)
          characterPathFollowDirection.y = 0
          if (characterPathFollowDirection.lengthSq() > 1e-8) {
            characterPathFollowDirection.normalize()
            entry.smoothedYaw =
              Math.atan2(-characterPathFollowDirection.z, characterPathFollowDirection.x)
              + resolveCharacterForwardAxisOffsetRadians(controllerProps.forwardAxis)
          }

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
      const projectedPointIndex = findClosestWaypointIndex(routeData.points, sample.projection.closestPoint)
      const nextIndex = entry.props.loop
        ? (projectedPointIndex + 1) % routeData.points.length
        : Math.min(routeData.points.length - 1, projectedPointIndex + 1)
      const currentWaypoint = routeData.points[projectedPointIndex] ?? null
      const nextWaypoint = routeData.points[nextIndex] ?? null
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
      const stepDistance = Math.max(0, speedMps * deltaSeconds * speedFactor)
      const actualStep = Math.min(stepDistance, distanceToLookahead)
      characterPathFollowTargetPosition.copy(currentPosition).addScaledVector(characterPathFollowDirection, actualStep)
      const heightAlpha = distanceToLookahead > 1e-6
        ? Math.min(1, actualStep / distanceToLookahead)
        : 0
      const currentGroundY = currentPosition.y - groundOffsetY
      const targetGroundY = currentGroundY
        + (sample.lookaheadPoint.y - currentGroundY) * heightAlpha
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
    })
  }
}
