import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '@harmony/schema'
import { PROTAGONIST_COMPONENT_TYPE, type ProtagonistComponentProps } from '@schema/components'
import { findSceneNode, setBoundingBoxFromObject } from './sceneUtils'

export type NodePatchLike = {
  id: string
  fields: string[]
}

export type ProtagonistInitialVisibilityCapture = {
  queueTransformUpdateIds: (ids: string[]) => void
  flushAfterPatches: (nodePatches: NodePatchLike[]) => void
}

type Options = {
  getNodes: () => SceneNode[]
  isSceneReady: () => boolean
  updateNodeComponentProps: (
    nodeId: string,
    componentId: string,
    propsPatch: Partial<ProtagonistComponentProps>,
  ) => void

  objectMap: Map<string, THREE.Object3D>
  rootGroup: THREE.Object3D
  instancedMeshGroup: THREE.Object3D
  getRenderer: () => THREE.WebGLRenderer | null
  isObjectWorldVisible: (object: THREE.Object3D) => boolean
}

const CAMERA_OFFSET = new THREE.Vector3(0, 0.35, 0)
const WORLD_POSITION = new THREE.Vector3()
const TARGET = new THREE.Vector3()
const OFFSET_TARGET = new THREE.Vector3()
const DIRECTION = new THREE.Vector3(0, 0, -1)
const RENDERER_SIZE = new THREE.Vector2()

const CAMERA = new THREE.PerspectiveCamera(55, 1, 0.1, 2000)
CAMERA.name = 'ProtagonistVisibilityCamera'

const FRUSTUM = new THREE.Frustum()
const PROJECTION_VIEW = new THREE.Matrix4()
const BOUNDS = new THREE.Box3()

const HELPER_TYPES = new Set<string>([
  'GridHelper',
  'AxesHelper',
  'Box3Helper',
  'PointLightHelper',
  'SpotLightHelper',
  'DirectionalLightHelper',
  'HemisphereLightHelper',
  'TransformControls',
  'TransformControlsGizmo',
  'TransformControlsPlane',
])

const HELPER_NAMES = new Set<string>(['DragPreview', 'GridHighlight'])
const LIGHT_HELPER_NAME_SUFFIX = 'LightHelper'

function isEditorHelperObject(object: THREE.Object3D): boolean {
  const name = object.name ?? ''
  if (name && (HELPER_NAMES.has(name) || name.endsWith(LIGHT_HELPER_NAME_SUFFIX))) {
    return true
  }
  if (HELPER_TYPES.has(object.type)) {
    return true
  }
  if ((object as any).isTransformControlsRoot) {
    return true
  }
  return false
}

function shouldExcludeNode(node: SceneNode): boolean {
  if (node.visible === false) {
    return true
  }
  if (node.editorFlags?.editorOnly) {
    return true
  }
  if (node.nodeType === 'Light' || Boolean(node.light)) {
    return true
  }
  if (node.nodeType === 'Environment') {
    return true
  }
  return false
}

function buildSceneNodeLookup(nodes: SceneNode[]): Map<string, SceneNode> {
  const lookup = new Map<string, SceneNode>()
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    lookup.set(current.id, current)
    if (Array.isArray(current.children) && current.children.length) {
      stack.push(...current.children)
    }
  }
  return lookup
}

function collectNodeTreeIds(node: SceneNode, bucket: Set<string>): void {
  if (shouldExcludeNode(node)) {
    return
  }
  bucket.add(node.id)
  if (Array.isArray(node.children) && node.children.length) {
    for (const child of node.children) {
      collectNodeTreeIds(child, bucket)
    }
  }
}

function syncCamera(protagonistObject: THREE.Object3D, renderer: THREE.WebGLRenderer): void {
  protagonistObject.updateWorldMatrix(true, false)
  protagonistObject.getWorldPosition(WORLD_POSITION)

  const cameraQuaternion = CAMERA.quaternion
  protagonistObject.getWorldQuaternion(cameraQuaternion)

  OFFSET_TARGET.copy(CAMERA_OFFSET).applyQuaternion(cameraQuaternion)
  CAMERA.position.copy(WORLD_POSITION).add(OFFSET_TARGET)

  TARGET.copy(WORLD_POSITION)
  DIRECTION.set(1, 0, 0).applyQuaternion(cameraQuaternion)
  TARGET.add(DIRECTION)

  renderer.getSize(RENDERER_SIZE)
  const width = Math.max(1, Math.round(RENDERER_SIZE.x))
  const height = Math.max(1, Math.round(RENDERER_SIZE.y))
  CAMERA.aspect = width / height
  CAMERA.near = 0.1
  CAMERA.far = 2000
  CAMERA.updateProjectionMatrix()

  CAMERA.lookAt(TARGET)
  CAMERA.updateMatrixWorld(true)

  PROJECTION_VIEW.multiplyMatrices(CAMERA.projectionMatrix, CAMERA.matrixWorldInverse)
  FRUSTUM.setFromProjectionMatrix(PROJECTION_VIEW)
}

function computeInitialVisibleNodeIds(options: Options, protagonistNodeId: string): string[] {
  if (!options.isSceneReady()) {
    return []
  }

  const renderer = options.getRenderer()
  if (!renderer) {
    return []
  }

  const protagonistObject = options.objectMap.get(protagonistNodeId) ?? null
  if (!protagonistObject) {
    return []
  }
  if (isEditorHelperObject(protagonistObject)) {
    return []
  }

  syncCamera(protagonistObject, renderer)

  options.rootGroup.updateMatrixWorld(true)
  options.instancedMeshGroup.updateMatrixWorld(true)

  const nodes = options.getNodes()
  const lookup = buildSceneNodeLookup(nodes)

  const visibleRootIds = new Set<string>()
  for (const [nodeId, object] of options.objectMap.entries()) {
    if (nodeId === protagonistNodeId) {
      continue
    }
    const node = lookup.get(nodeId) ?? null
    if (!node) {
      continue
    }
    if (shouldExcludeNode(node)) {
      continue
    }
    if (isEditorHelperObject(object)) {
      continue
    }
    if (!options.isObjectWorldVisible(object)) {
      continue
    }

    setBoundingBoxFromObject(object, BOUNDS)
    if (BOUNDS.isEmpty()) {
      continue
    }
    if (FRUSTUM.intersectsBox(BOUNDS)) {
      visibleRootIds.add(nodeId)
    }
  }

  const resultIds = new Set<string>()
  visibleRootIds.forEach((rootId) => {
    const node = lookup.get(rootId) ?? null
    if (node) {
      collectNodeTreeIds(node, resultIds)
    }
  })
  resultIds.delete(protagonistNodeId)

  return Array.from(resultIds).sort()
}

function updateInitialVisibleNodeIds(options: Options, protagonistNodeId: string, reason: 'drag-end' | 'component-added') {
  const nodes = options.getNodes()
  const node = findSceneNode(nodes, protagonistNodeId)
  if (!node) {
    return
  }
  const component = node.components?.[PROTAGONIST_COMPONENT_TYPE] as
    | SceneNodeComponentState<ProtagonistComponentProps>
    | undefined
  if (!component?.enabled || !component.id) {
    return
  }

  const previous = Array.isArray(component.props?.initialVisibleNodeIds)
    ? component.props.initialVisibleNodeIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
    : []

  if (reason === 'component-added' && previous.length > 0) {
    return
  }

  const next = computeInitialVisibleNodeIds(options, protagonistNodeId)
  if (previous.length === next.length && previous.every((id, index) => id === next[index])) {
    return
  }

  options.updateNodeComponentProps(protagonistNodeId, component.id, {
    initialVisibleNodeIds: next,
  })
}

export function createProtagonistInitialVisibilityCapture(options: Options): ProtagonistInitialVisibilityCapture {
  let pendingRecomputeIds: Set<string> | null = null

  const queueTransformUpdateIds = (ids: string[]) => {
    if (!ids.length) {
      return
    }
    if (!pendingRecomputeIds) {
      pendingRecomputeIds = new Set<string>()
    }
    ids.forEach((id) => {
      if (typeof id === 'string' && id.trim().length) {
        pendingRecomputeIds?.add(id)
      }
    })
  }

  const flushAfterPatches = (nodePatches: NodePatchLike[]) => {
    const dragEndIds = pendingRecomputeIds
    pendingRecomputeIds = null

    if (dragEndIds && dragEndIds.size) {
      dragEndIds.forEach((id) => updateInitialVisibleNodeIds(options, id, 'drag-end'))
    }

    if (!nodePatches.length) {
      return
    }

    // Discrete transform changes (e.g. right-click rotate) should also refresh protagonist visibility.
    for (const patch of nodePatches) {
      if (!Array.isArray(patch.fields) || !patch.fields.includes('transform')) {
        continue
      }
      if (dragEndIds?.has(patch.id)) {
        continue
      }
      const node = findSceneNode(options.getNodes(), patch.id)
      const component = node?.components?.[PROTAGONIST_COMPONENT_TYPE] as
        | SceneNodeComponentState<ProtagonistComponentProps>
        | undefined
      if (!component?.enabled) {
        continue
      }
      updateInitialVisibleNodeIds(options, patch.id, 'drag-end')
    }

    for (const patch of nodePatches) {
      if (!Array.isArray(patch.fields) || !patch.fields.includes('components')) {
        continue
      }
      if (dragEndIds?.has(patch.id)) {
        continue
      }

      const node = findSceneNode(options.getNodes(), patch.id)
      const component = node?.components?.[PROTAGONIST_COMPONENT_TYPE] as
        | SceneNodeComponentState<ProtagonistComponentProps>
        | undefined
      if (!component?.enabled) {
        continue
      }

      const existing = Array.isArray(component.props?.initialVisibleNodeIds) ? component.props.initialVisibleNodeIds : []
      if (existing.length > 0) {
        continue
      }

      updateInitialVisibleNodeIds(options, patch.id, 'component-added')
    }
  }

  return {
    queueTransformUpdateIds,
    flushAfterPatches,
  }
}
