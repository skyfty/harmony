import * as THREE from 'three'
import type { SceneNode } from '@schema/index'
import { findSceneNode, setBoundingBoxFromObject } from './sceneUtils'

export type CameraResetDirection = 'pos-x' | 'neg-x' | 'pos-y' | 'neg-y' | 'pos-z' | 'neg-z'

type CameraFocusTarget = { target: THREE.Vector3; radiusEstimate: number }
type GroundPanoramaFitResult = CameraFocusTarget & { distance: number }

type CameraResetDependencies = {
  getCamera: () => THREE.PerspectiveCamera | null
  getMapControls: () => { target: THREE.Vector3; update: () => void } | null
  getGizmoControls: () => { cameraUpdate: () => void } | null
  getGroundNode: () => SceneNode | null
  getFallbackSceneNodes: () => SceneNode[]
  getSelectedNodeId: () => string | null
  getSceneNodeById: (nodeId: string) => SceneNode | null | undefined
  getRuntimeObject: (nodeId: string) => THREE.Object3D | null
  getLastCameraFocusRadius: () => number | null
  setLastCameraFocusRadius: (value: number) => void
  setApplyingCameraState: (value: boolean) => void
  syncControlsConstraintsAndSpeeds: () => void
  getCameraControlMode: () => string
  minTargetHeight: number
  minCameraHeight: number
}

function findGroundNodeInTree(nodes: SceneNode[]): SceneNode | null {
  for (const node of nodes) {
    if (node.dynamicMesh?.type === 'Ground') {
      return node
    }
    if (node.children && node.children.length > 0) {
      const nested = findGroundNodeInTree(node.children)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function directionToVector(direction: CameraResetDirection): THREE.Vector3 {
  if (direction === 'pos-x') return new THREE.Vector3(1, 0, 0)
  if (direction === 'neg-x') return new THREE.Vector3(-1, 0, 0)
  if (direction === 'pos-y') return new THREE.Vector3(0, 1, 0)
  if (direction === 'neg-y') return new THREE.Vector3(0, -1, 0)
  if (direction === 'pos-z') return new THREE.Vector3(0, 0, 1)
  return new THREE.Vector3(0, 0, -1)
}

export function createCameraResetDirectionController(deps: CameraResetDependencies) {
  const cameraResetFitMatrixHelper = new THREE.Matrix4()
  const cameraResetFitTargetHelper = new THREE.Vector3()
  const cameraResetFitCornerHelper = new THREE.Vector3()
  const cameraResetFitOffsetHelper = new THREE.Vector3()
  const cameraResetFitRightHelper = new THREE.Vector3()
  const cameraResetFitUpHelper = new THREE.Vector3()
  const cameraResetFitUpReferenceHelper = new THREE.Vector3()
  const cameraResetFitRotationHelper = new THREE.Euler(0, 0, 0, 'XYZ')
  const cameraResetFitScaleHelper = new THREE.Vector3(1, 1, 1)

  function resolveGroundNode(): SceneNode | null {
    return deps.getGroundNode() ?? findGroundNodeInTree(deps.getFallbackSceneNodes())
  }

  function resolveGroundPanoramaFitDistanceForDirection(directionVector: THREE.Vector3): GroundPanoramaFitResult | null {
    const camera = deps.getCamera()
    if (!camera) {
      return null
    }

    const groundNode = resolveGroundNode()
    if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
      return null
    }

    const definition = groundNode.dynamicMesh
    const width = Math.abs(Number(definition.width))
    const depth = Math.abs(Number(definition.depth))
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 1e-6 || depth <= 1e-6) {
      return null
    }

    const groundObject = deps.getRuntimeObject(groundNode.id)
    if (groundObject) {
      groundObject.updateWorldMatrix(true, true)
      cameraResetFitMatrixHelper.copy(groundObject.matrixWorld)
      groundObject.getWorldPosition(cameraResetFitTargetHelper)
    } else {
      cameraResetFitTargetHelper.set(
        groundNode.position.x,
        groundNode.position.y,
        groundNode.position.z,
      )
      cameraResetFitRotationHelper.set(
        groundNode.rotation.x,
        groundNode.rotation.y,
        groundNode.rotation.z,
      )
      cameraResetFitScaleHelper.set(
        groundNode.scale?.x ?? 1,
        groundNode.scale?.y ?? 1,
        groundNode.scale?.z ?? 1,
      )
      cameraResetFitMatrixHelper.compose(
        cameraResetFitTargetHelper,
        new THREE.Quaternion().setFromEuler(cameraResetFitRotationHelper),
        cameraResetFitScaleHelper,
      )
    }

    cameraResetFitUpReferenceHelper.set(0, 1, 0)
    if (Math.abs(directionVector.dot(cameraResetFitUpReferenceHelper)) >= 0.99) {
      cameraResetFitUpReferenceHelper.set(0, 0, 1)
    }

    cameraResetFitRightHelper.copy(cameraResetFitUpReferenceHelper).cross(directionVector)
    if (cameraResetFitRightHelper.lengthSq() <= 1e-10) {
      return null
    }
    cameraResetFitRightHelper.normalize()

    cameraResetFitUpHelper.copy(directionVector).cross(cameraResetFitRightHelper)
    if (cameraResetFitUpHelper.lengthSq() <= 1e-10) {
      return null
    }
    cameraResetFitUpHelper.normalize()

    const halfWidth = width * 0.5
    const halfDepth = depth * 0.5
    const corners: Array<[number, number]> = [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [-halfWidth, halfDepth],
      [halfWidth, halfDepth],
    ]

    let maxHorizontal = 0
    let maxVertical = 0
    let radiusEstimate = 0

    for (const [x, z] of corners) {
      cameraResetFitCornerHelper.set(x, 0, z).applyMatrix4(cameraResetFitMatrixHelper)
      cameraResetFitOffsetHelper.copy(cameraResetFitCornerHelper).sub(cameraResetFitTargetHelper)
      maxHorizontal = Math.max(maxHorizontal, Math.abs(cameraResetFitOffsetHelper.dot(cameraResetFitRightHelper)))
      maxVertical = Math.max(maxVertical, Math.abs(cameraResetFitOffsetHelper.dot(cameraResetFitUpHelper)))
      radiusEstimate = Math.max(radiusEstimate, cameraResetFitOffsetHelper.length())
    }

    if (!Number.isFinite(maxHorizontal) || !Number.isFinite(maxVertical)) {
      return null
    }

    let fitDistance = Math.max(0.8, radiusEstimate)
    if (camera instanceof THREE.PerspectiveCamera) {
      const fovV = THREE.MathUtils.degToRad(camera.fov)
      const aspect = Math.max(camera.aspect || 1, 1e-6)
      const fovH = 2 * Math.atan(Math.tan(Math.max(fovV / 2, 1e-6)) * aspect)
      const verticalDistance = maxVertical / Math.tan(Math.max(fovV / 2, 1e-6))
      const horizontalDistance = maxHorizontal / Math.tan(Math.max(fovH / 2, 1e-6))
      fitDistance = Math.max(verticalDistance, horizontalDistance, 0.8)
    }

    const mode = deps.getCameraControlMode()
    const margin = mode === 'map' ? 1.08 : 1.03
    const minScaleByRadius = mode === 'map' ? 1.18 : 1.05
    const distance = Math.max(fitDistance * margin, radiusEstimate * minScaleByRadius, 0.8)

    return {
      target: cameraResetFitTargetHelper.clone(),
      radiusEstimate: Math.max(radiusEstimate, 0.25),
      distance,
    }
  }

  function resolveFocusTargetFromNodeId(nodeId: string): CameraFocusTarget | null {
    const target = new THREE.Vector3()
    let radiusEstimate = 1

    const node = deps.getSceneNodeById(nodeId)
    if (node?.light?.type === 'Directional' && node.light.target) {
      target.set(node.light.target.x, node.light.target.y, node.light.target.z)
      radiusEstimate = Math.max(deps.getLastCameraFocusRadius() ?? 1, 10)
      return { target, radiusEstimate }
    }

    const object = deps.getRuntimeObject(nodeId)
    if (object) {
      object.updateWorldMatrix(true, true)
      const box = setBoundingBoxFromObject(object, new THREE.Box3())
      if (!box.isEmpty()) {
        box.getCenter(target)
        const sphere = new THREE.Sphere()
        box.getBoundingSphere(sphere)
        radiusEstimate = sphere.radius
      } else {
        object.getWorldPosition(target)
      }
      return { target, radiusEstimate }
    }

    const fallbackNode = findSceneNode(deps.getFallbackSceneNodes(), nodeId)
    if (!fallbackNode) {
      return null
    }

    target.set(fallbackNode.position.x, fallbackNode.position.y, fallbackNode.position.z)
    const scaleEstimate = Math.max(fallbackNode.scale?.x ?? 1, fallbackNode.scale?.y ?? 1, fallbackNode.scale?.z ?? 1, 1)
    radiusEstimate = scaleEstimate * 0.5
    return { target, radiusEstimate }
  }

  function resolveFallbackFocusTargetForCameraReset(): CameraFocusTarget {
    const groundNode = resolveGroundNode()
    if (groundNode) {
      const groundObject = deps.getRuntimeObject(groundNode.id)
      if (groundObject) {
        const target = new THREE.Vector3()
        groundObject.updateWorldMatrix(true, true)
        groundObject.getWorldPosition(target)
        return {
          target,
          radiusEstimate: Math.max(deps.getLastCameraFocusRadius() ?? 1, 10),
        }
      }

      return {
        target: new THREE.Vector3(
          groundNode.position.x,
          groundNode.position.y,
          groundNode.position.z,
        ),
        radiusEstimate: Math.max(deps.getLastCameraFocusRadius() ?? 1, 10),
      }
    }

    return {
      target: new THREE.Vector3(0, 0, 0),
      radiusEstimate: Math.max(deps.getLastCameraFocusRadius() ?? 1, 10),
    }
  }

  function resetCameraToSelectionDirection(direction: CameraResetDirection): boolean {
    const camera = deps.getCamera()
    const mapControls = deps.getMapControls()
    if (!camera || !mapControls) {
      return false
    }

    const directionVector = directionToVector(direction)
    const selectedId = deps.getSelectedNodeId()
    let focus: CameraFocusTarget
    let forcedDistance: number | null = null

    if (selectedId) {
      focus = resolveFocusTargetFromNodeId(selectedId) ?? resolveFallbackFocusTargetForCameraReset()
    } else {
      const groundFit = resolveGroundPanoramaFitDistanceForDirection(directionVector)
      if (groundFit) {
        focus = { target: groundFit.target, radiusEstimate: groundFit.radiusEstimate }
        forcedDistance = groundFit.distance
      } else {
        focus = resolveFallbackFocusTargetForCameraReset()
      }
    }

    const currentDistance = camera.position.distanceTo(mapControls.target)
    const fallbackDistance = Math.max(0.8, focus.radiusEstimate * 2)
    const distance = forcedDistance != null
      ? forcedDistance
      : (Number.isFinite(currentDistance) && currentDistance > 1e-4 ? currentDistance : fallbackDistance)
    const clampedTargetY = Math.max(focus.target.y, deps.minTargetHeight)
    const focusTarget = new THREE.Vector3(focus.target.x, clampedTargetY, focus.target.z)
    const nextCameraPosition = focusTarget.clone().addScaledVector(directionVector, distance)

    deps.setApplyingCameraState(true)
    try {
      camera.position.copy(nextCameraPosition)
      if (camera.position.y < deps.minCameraHeight) {
        camera.position.y = deps.minCameraHeight
      }
      mapControls.target.copy(focusTarget)
      deps.setLastCameraFocusRadius(Math.max(0.25, focus.radiusEstimate))
      deps.syncControlsConstraintsAndSpeeds()
      mapControls.update()
      deps.getGizmoControls()?.cameraUpdate()
      return true
    } finally {
      deps.setApplyingCameraState(false)
    }
  }

  return {
    resetCameraToSelectionDirection,
    resolveFocusTargetFromNodeId,
  }
}
