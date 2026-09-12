import { computed, reactive, ref, shallowRef } from 'vue'
import * as THREE from 'three'
import { useSceneStore } from '@/stores/sceneStore'
import { findSceneNode } from '@/components/editor/sceneUtils'
import {
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  type RigidbodyComponentMetadata,
  type RigidbodyComponentProps,
} from '@schema/components'
import type { SceneNode, SceneNodeComponentState } from '@schema/core'
import {
  applyEditableColliderShape,
  buildColliderMetadataPayload,
  buildConvexGeometryFromSamplingObject,
  buildConvexGeometryWithFallback,
  buildDefaultColliderShape,
  cloneNodeForColliderPreview,
  constrainColliderGroupTransform,
  convertColliderMetadataShape,
  createColliderGeometryForKind,
  disposeColliderGeometry,
  normalizeColliderKind,
  resolveColliderScaleFactors,
  resolveConvexSimplifyConfig,
  updateEditableColliderStateFromGroup,
  type ColliderShapeKind,
  type ConvertedEditableColliderShape,
  type EditableColliderShape,
} from '@/utils/rigidbodyColliderEdit'

export type ColliderTransformMode = 'translate' | 'rotate' | 'scale'

type RigidbodyColliderSceneEditorOptions = {
  getOverlayParent: () => THREE.Object3D | null
  getTargetObject: (nodeId: string) => THREE.Object3D | null
  onActiveChange?: (active: boolean) => void
  onTransformModeChange?: (mode: ColliderTransformMode) => void
}

const COLLIDER_FRAME_NAME = '__HarmonyRigidbodyColliderFrame'
const COLLIDER_PREVIEW_NAME = '__HarmonyRigidbodyColliderPreview'

export function useRigidbodyColliderSceneEditor(options: RigidbodyColliderSceneEditorOptions) {
  const sceneStore = useSceneStore()

  const active = ref(false)
  const ready = ref(false)
  const error = ref<string | null>(null)
  const nodeLabel = ref('')
  const colliderKind = ref<ColliderShapeKind>('convex')
  const transformMode = ref<ColliderTransformMode>('translate')
  const colliderDimensions = reactive({ x: 1, y: 1, z: 1 })
  const colliderOffset = reactive({ x: 0, y: 0, z: 0 })
  const colliderRotation = reactive({ x: 0, y: 0, z: 0 })

  const selectedNode = computed(() => sceneStore.selectedNode)
  const rigidbodyComponent = computed<SceneNodeComponentState<RigidbodyComponentProps> | null>(() => {
    const component = selectedNode.value?.components?.[RIGIDBODY_COMPONENT_TYPE]
    return (component as SceneNodeComponentState<RigidbodyComponentProps> | undefined) ?? null
  })
  const targetNodeId = computed(() => {
    const raw = rigidbodyComponent.value?.props.targetNodeId
    if (typeof raw === 'string' && raw.trim().length) {
      return raw.trim()
    }
    return selectedNode.value?.id ?? null
  })
  const targetNode = computed<SceneNode | null>(() => {
    const id = targetNodeId.value
    if (!id) {
      return null
    }
    return findSceneNode(sceneStore.nodes, id)
  })
  const available = computed(() => {
    void sceneStore.sceneGraphStructureVersion
    void sceneStore.sceneNodePropertyVersion
    return Boolean(
      rigidbodyComponent.value?.enabled
      && targetNode.value
      && (targetNode.value.nodeType === 'Group' || options.getTargetObject(targetNode.value.id)),
    )
  })

  let frame: THREE.Group | null = null
  let previewGroup: THREE.Group | null = null
  const previewGroupRef = shallowRef<THREE.Group | null>(null)
  let previewMesh: THREE.Mesh | null = null
  let previewEdges: THREE.LineSegments | null = null
  let convexGeometry: THREE.BufferGeometry | null = null
  let convexUsedPass: 'primary' | 'fallback' = 'primary'
  let samplingObject: THREE.Object3D | null = null
  let activeNodeId: string | null = null
  let activeComponentId: string | null = null
  let activeMetadata: RigidbodyComponentMetadata | undefined
  const activeScale = new THREE.Vector3(1, 1, 1)

  function replaceConvexGeometry(next: THREE.BufferGeometry | null): void {
    if (convexGeometry && convexGeometry !== previewMesh?.geometry) {
      convexGeometry.dispose()
    }
    convexGeometry = next
  }

  function clearPreviewObjects(): void {
    if (previewEdges) {
      previewGroup?.remove(previewEdges)
      previewEdges.geometry.dispose()
      ;(previewEdges.material as THREE.Material).dispose?.()
      previewEdges = null
    }
    if (previewMesh) {
      previewGroup?.remove(previewMesh)
      disposeColliderGeometry(previewMesh.geometry, convexGeometry)
      ;(previewMesh.material as THREE.Material).dispose?.()
      previewMesh = null
    }
    if (convexGeometry) {
      convexGeometry.dispose()
      convexGeometry = null
    }
    convexUsedPass = 'primary'
    if (previewGroup) {
      frame?.remove(previewGroup)
      previewGroup = null
    }
    previewGroupRef.value = null
    if (frame) {
      frame.removeFromParent()
      frame = null
    }
    samplingObject = null
    activeNodeId = null
    activeComponentId = null
    activeMetadata = undefined
    activeScale.set(1, 1, 1)
    ready.value = false
  }

  function setActive(nextActive: boolean): void {
    if (active.value === nextActive) {
      return
    }
    active.value = nextActive
    options.onActiveChange?.(nextActive)
  }

  function updateState(): void {
    if (!previewGroup) {
      return
    }
    updateEditableColliderStateFromGroup({
      colliderGroup: previewGroup,
      kind: colliderKind.value,
      dimensions: colliderDimensions,
      offset: colliderOffset,
      rotation: colliderRotation,
      convexGeometry,
    })
  }

  function syncStateFromGroup(): void {
    if (!previewGroup) {
      return
    }
    updateEditableColliderStateFromGroup({
      colliderGroup: previewGroup,
      kind: colliderKind.value,
      dimensions: colliderDimensions,
      offset: colliderOffset,
      rotation: colliderRotation,
      convexGeometry,
    })
  }

  function rebuildPreviewGeometry(kind: ColliderShapeKind, forceConvexRebuild = false): void {
    if (!previewGroup) {
      return
    }
    if (previewEdges) {
      previewGroup.remove(previewEdges)
      previewEdges.geometry.dispose()
      ;(previewEdges.material as THREE.Material).dispose?.()
      previewEdges = null
    }
    if (previewMesh) {
      previewGroup.remove(previewMesh)
      disposeColliderGeometry(previewMesh.geometry, convexGeometry)
      ;(previewMesh.material as THREE.Material).dispose?.()
      previewMesh = null
    }

    if (kind === 'convex') {
      if (forceConvexRebuild || !convexGeometry) {
        const config = resolveConvexSimplifyConfig(activeMetadata)
        convexGeometry?.dispose()
        const built = samplingObject
          ? buildConvexGeometryWithFallback(samplingObject, config)
          : null
        convexGeometry = built?.geometry ?? null
        convexUsedPass = built?.usedPass ?? 'primary'
      }
      if (!convexGeometry) {
        error.value = 'Unable to build convex collider geometry.'
        return
      }
    }

    const geometry = createColliderGeometryForKind(kind, convexGeometry)
    if (!geometry) {
      error.value = 'Unable to build collider geometry.'
      return
    }

    const fillMaterial = new THREE.MeshStandardMaterial({
      color: 0x4cc9f0,
      opacity: 0.2,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    previewMesh = new THREE.Mesh(geometry, fillMaterial)
    previewMesh.name = `${COLLIDER_PREVIEW_NAME}:mesh`
    previewMesh.castShadow = false
    previewMesh.receiveShadow = false
    previewMesh.renderOrder = 500
    previewGroup.add(previewMesh)

    previewEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x4cc9f0 }),
    )
    previewEdges.name = `${COLLIDER_PREVIEW_NAME}:edges`
    previewEdges.renderOrder = 501
    previewGroup.add(previewEdges)
  }

  function resolveDefaultShape(kind: ColliderShapeKind): EditableColliderShape | null {
    if (!samplingObject) {
      return null
    }
    const config = resolveConvexSimplifyConfig(activeMetadata)
    if (kind === 'convex') {
      const built = buildConvexGeometryWithFallback(samplingObject, config)
      replaceConvexGeometry(built?.geometry ?? null)
      convexUsedPass = built?.usedPass ?? 'primary'
      if (!convexGeometry) {
        return null
      }
    }
    return buildDefaultColliderShape({
      kind,
      samplingObject,
      convexGeometry: kind === 'convex' ? convexGeometry : null,
      convexSimplifyPass: config.primary,
    })
  }

  function resolveInitialShape(kind: ColliderShapeKind): EditableColliderShape | null {
    const metadataShape = activeMetadata?.shape
    if (metadataShape) {
      const converted = convertColliderMetadataShape(metadataShape, kind, activeScale) as ConvertedEditableColliderShape | null
      if (converted) {
        if (converted.geometry) {
          replaceConvexGeometry(converted.geometry)
          convexUsedPass = activeMetadata?.convexSimplify?.usedPass ?? 'primary'
        }
        return converted
      }
    }
    return resolveDefaultShape(kind)
  }

  function applyShape(shape: EditableColliderShape, forceConvexRebuild = false): void {
    if (!previewGroup) {
      return
    }
    colliderKind.value = shape.kind
    rebuildPreviewGeometry(shape.kind, forceConvexRebuild)
    if (!previewGroup) {
      return
    }
    applyEditableColliderShape(previewGroup, shape)
    updateState()
    if (shape.kind === 'sphere' && transformMode.value === 'rotate') {
      transformMode.value = 'translate'
      options.onTransformModeChange?.(transformMode.value)
    }
    previewGroup.updateMatrixWorld(true)
  }

  function activate(): boolean {
    if (active.value) {
      return true
    }
    clearPreviewObjects()
    error.value = null
    transformMode.value = 'translate'

    const node = selectedNode.value
    const component = rigidbodyComponent.value
    if (!node || !component || !component.enabled) {
      error.value = 'Select a node with an enabled Rigidbody component.'
      return false
    }
    const targetId = targetNodeId.value
    const target = targetNode.value
    if (!targetId || !target) {
      error.value = 'No target node available for collider editing.'
      return false
    }
    const object = options.getTargetObject(targetId)
    if (!object && target.nodeType !== 'Group') {
      error.value = 'No runtime object available for collider editing.'
      return false
    }
    const parent = options.getOverlayParent()
    if (!parent) {
      error.value = 'Scene viewport is not ready for collider editing.'
      return false
    }

    const clone = cloneNodeForColliderPreview(target, true)
    if (!clone) {
      error.value = 'The collider sampling model is not available.'
      return false
    }
    clone.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(clone)
    if (bounds.isEmpty()) {
      error.value = 'The selected node has no visible geometry.'
      return false
    }

    const worldPosition = new THREE.Vector3()
    const worldQuaternion = new THREE.Quaternion()
    const worldScale = new THREE.Vector3(1, 1, 1)
    if (object) {
      object.updateMatrixWorld(true)
      object.getWorldPosition(worldPosition)
      object.getWorldQuaternion(worldQuaternion)
      object.getWorldScale(worldScale)
    } else {
      worldPosition.set(target.position.x, target.position.y, target.position.z)
      worldQuaternion.setFromEuler(new THREE.Euler(target.rotation.x, target.rotation.y, target.rotation.z, 'XYZ'))
      const fallbackScale = resolveColliderScaleFactors(target)
      worldScale.set(fallbackScale.x, fallbackScale.y, fallbackScale.z)
    }

    frame = new THREE.Group()
    frame.name = COLLIDER_FRAME_NAME
    frame.position.copy(worldPosition)
    frame.quaternion.copy(worldQuaternion)
    frame.scale.set(1, 1, 1)
    frame.userData.editorOnly = true
    ;(frame as any).raycast = () => {}
    parent.add(frame)

    previewGroup = new THREE.Group()
    previewGroup.name = COLLIDER_PREVIEW_NAME
    previewGroup.userData.editorOnly = true
    ;(previewGroup as any).raycast = () => {}
    frame.add(previewGroup)
    previewGroupRef.value = previewGroup

    samplingObject = clone
    activeNodeId = node.id
    activeComponentId = component.id
    activeMetadata = component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
    activeScale.set(
      Math.max(1e-4, Math.abs(worldScale.x) || 1),
      Math.max(1e-4, Math.abs(worldScale.y) || 1),
      Math.max(1e-4, Math.abs(worldScale.z) || 1),
    )
    nodeLabel.value = target.name ?? node.name ?? 'Current Node'

    const desiredKind = normalizeColliderKind(component.props.colliderType)
    const shape = resolveInitialShape(desiredKind)
      ?? resolveInitialShape('convex')
      ?? {
        kind: 'box' as const,
        dimensions: new THREE.Vector3(1, 1, 1),
        offset: new THREE.Vector3(),
        rotation: new THREE.Euler(),
      }
    applyShape(shape)
    if (error.value) {
      clearPreviewObjects()
      return false
    }
    ready.value = true
    setActive(true)
    return true
  }

  function deactivate(optionsArg: { save?: boolean } = {}): boolean {
    const shouldSave = optionsArg.save === true
    let saved = false
    if (shouldSave && active.value && previewGroup && activeNodeId && activeComponentId) {
      const config = resolveConvexSimplifyConfig(activeMetadata)
      const payload = buildColliderMetadataPayload({
        kind: colliderKind.value,
        colliderGroup: previewGroup,
        scale: activeScale,
        convexGeometry: colliderKind.value === 'convex' ? convexGeometry : null,
        convexSimplifyConfig: config,
        convexSimplifyPasses: {
          primary: config.primary,
          fallback: config.fallback,
          limits: config.limits,
        },
        convexUsedPass,
        buildConvexGeometry: samplingObject
          ? (pass) => buildConvexGeometryFromSamplingObject(samplingObject as THREE.Object3D, pass)
          : undefined,
      })
      if (payload) {
        const nextMetadata: RigidbodyComponentMetadata = {
          shape: payload.shape,
          generatedAt: new Date().toISOString(),
          convexSimplify: payload.convexSimplify,
        }
        const node = sceneStore.getNodeById(activeNodeId)
        const currentComponent = node?.components?.[RIGIDBODY_COMPONENT_TYPE] as
          | SceneNodeComponentState<RigidbodyComponentProps>
          | undefined
        if (currentComponent) {
          const preservedMetadata = { ...(currentComponent.metadata ?? {}) }
          preservedMetadata[RIGIDBODY_METADATA_KEY] = nextMetadata
          sceneStore.updateNodeComponentMetadata(activeNodeId, activeComponentId, preservedMetadata)
          sceneStore.updateNodeComponentProps(activeNodeId, activeComponentId, {
            colliderType: colliderKind.value,
          })
          saved = true
        }
      }
    }
    clearPreviewObjects()
    error.value = null
    setActive(false)
    return saved
  }

  function toggle(): boolean {
    if (active.value) {
      deactivate({ save: false })
      return false
    }
    return activate()
  }

  function setTransformMode(mode: ColliderTransformMode): void {
    if (mode === 'rotate' && colliderKind.value === 'sphere') {
      return
    }
    transformMode.value = mode
    options.onTransformModeChange?.(mode)
  }

  function handleShapeKindChange(kind: ColliderShapeKind | null): void {
    if (!kind || !ready.value || kind === colliderKind.value) {
      return
    }
    const shape = resolveInitialShape(kind)
    if (shape) {
      applyShape(shape)
    }
  }

  function handleAutoFit(): void {
    if (!ready.value) {
      return
    }
    const shape = resolveDefaultShape(colliderKind.value)
    if (shape) {
      applyShape(shape)
    }
  }

  function handleTransformObjectChange(): void {
    if (!previewGroup || !active.value) {
      return
    }
    constrainColliderGroupTransform(previewGroup, colliderKind.value)
    syncStateFromGroup()
  }

  function dispose(): void {
    clearPreviewObjects()
    error.value = null
    setActive(false)
  }

  return {
    active,
    ready,
    error,
    available,
    nodeLabel,
    colliderKind,
    transformMode,
    dimensions: colliderDimensions,
    offset: colliderOffset,
    rotation: colliderRotation,
    previewGroup: previewGroupRef,
    activate,
    deactivate,
    toggle,
    dispose,
    setTransformMode,
    handleShapeKindChange,
    handleAutoFit,
    handleTransformObjectChange,
    syncStateFromGroup,
  }
}
