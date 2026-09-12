import { computed, reactive, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { findSceneNode } from '@/components/editor/sceneUtils'
import {
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG,
  DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_LEVEL,
  clampRigidbodyComponentProps,
  clampRigidbodyConvexDecompositionConfig,
  type RigidbodyComponentMetadata,
  type RigidbodyComponentProps,
  type RigidbodyConvexDecompositionConfig,
  type RigidbodyConvexDecompositionCustomConfig,
  type RigidbodyConvexDecompositionLevel,
  type RigidbodyConvexSimplifyConfig,
  type RigidbodyPhysicsShape,
} from '@schema/components'
import type { SceneNode, SceneNodeComponentState } from '@schema/core'
import {
  buildExportConvexShape,
  buildRigidbodySamplingObject,
  buildSceneNodeLookup,
  buildSceneNodeWorldTransformMap,
  findGroundNode,
  mergeRigidbodyMetadata,
  resolveRigidbodySamplingNode,
  type SceneNodeWorldTransform,
} from '@/utils/rigidbodyShapeBuild'
import {
  applyEditableColliderShape,
  buildColliderMetadataPayload,
  buildConvexShapeOverlay,
  buildDefaultColliderShape,
  constrainColliderGroupTransform,
  convertColliderMetadataShape,
  createColliderGeometryForKind,
  disposeColliderGeometry,
  normalizeColliderKind,
  resolveColliderScaleFactors,
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

type ConvexShapeState = {
  shape: RigidbodyPhysicsShape
  convexSimplify?: RigidbodyConvexSimplifyConfig
  convexDecomposition?: RigidbodyConvexDecompositionConfig
}

const COLLIDER_FRAME_NAME = '__HarmonyRigidbodyColliderFrame'
const COLLIDER_PREVIEW_NAME = '__HarmonyRigidbodyColliderPreview'

function normalizeScaleComponent(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : 1
  return Math.max(1e-4, numeric || 1)
}

function resolveTransformScale(transform: SceneNodeWorldTransform | null | undefined): THREE.Vector3 {
  return new THREE.Vector3(
    normalizeScaleComponent(transform?.scale.x),
    normalizeScaleComponent(transform?.scale.y),
    normalizeScaleComponent(transform?.scale.z),
  )
}

export function useRigidbodyColliderSceneEditor(options: RigidbodyColliderSceneEditorOptions) {
  const sceneStore = useSceneStore()

  const active = ref(false)
  const ready = ref(false)
  const error = ref<string | null>(null)
  const nodeLabel = ref('')
  const colliderKind = ref<ColliderShapeKind>('convex')
  const convexDetailLevel = ref<RigidbodyConvexDecompositionLevel>(
    DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_LEVEL,
  )
  const convexDecompositionConfig = ref<RigidbodyConvexDecompositionCustomConfig>(
    clampRigidbodyConvexDecompositionConfig(DEFAULT_RIGIDBODY_CONVEX_DECOMPOSITION_CONFIG),
  )
  const transformMode = ref<ColliderTransformMode>('translate')
  const colliderDimensions = reactive({ x: 1, y: 1, z: 1 })
  const colliderOffset = reactive({ x: 0, y: 0, z: 0 })
  const colliderRotation = reactive({ x: 0, y: 0, z: 0 })
  const canTransform = computed(() => ready.value && colliderKind.value !== 'convex')

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
  let convexShapeState: ConvexShapeState | null = null
  let samplingObject: THREE.Object3D | null = null
  let samplingNode: SceneNode | null = null
  let sourceWorldTransform: SceneNodeWorldTransform | null = null
  let hostWorldTransform: SceneNodeWorldTransform | null = null
  let activeComponentProps: RigidbodyComponentProps | null = null
  let activeNodeId: string | null = null
  let activeComponentId: string | null = null
  let activeMetadata: RigidbodyComponentMetadata | undefined
  let buildToken = 0
  let convexConfigRegenerateTimer: number | null = null
  const activeScale = new THREE.Vector3(1, 1, 1)

  function replaceConvexGeometry(next: THREE.BufferGeometry | null): void {
    if (convexGeometry && convexGeometry !== previewMesh?.geometry) {
      convexGeometry.dispose()
    }
    convexGeometry = next
  }

  function clearPreviewObjects(): void {
    buildToken += 1
    if (convexConfigRegenerateTimer !== null) {
      window.clearTimeout(convexConfigRegenerateTimer)
      convexConfigRegenerateTimer = null
    }
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
    convexShapeState = null
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
    samplingNode = null
    sourceWorldTransform = null
    hostWorldTransform = null
    activeComponentProps = null
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

  function clearPreviewGeometryObjects(): void {
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
  }

  function rebuildPreviewGeometry(kind: ColliderShapeKind): boolean {
    if (!previewGroup) {
      return false
    }
    clearPreviewGeometryObjects()

    if (kind === 'convex' && !convexGeometry) {
      error.value = 'Unable to build convex collider geometry.'
      return false
    }

    const geometry = createColliderGeometryForKind(kind, convexGeometry)
    if (!geometry) {
      error.value = 'Unable to build collider geometry.'
      return false
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
    return true
  }

  function applyShape(shape: EditableColliderShape): void {
    if (!previewGroup) {
      return
    }
    colliderKind.value = shape.kind
    if (!rebuildPreviewGeometry(shape.kind)) {
      return
    }
    if (!previewGroup) {
      return
    }
    applyEditableColliderShape(previewGroup, shape)
    updateState()
    if (shape.kind === 'sphere' && transformMode.value === 'rotate') {
      transformMode.value = 'translate'
    }
    previewGroup.updateMatrixWorld(true)
    options.onTransformModeChange?.(transformMode.value)
    ready.value = true
  }

  function applyConvexShapeState(state: ConvexShapeState): void {
    if (!previewGroup) {
      return
    }
    const overlay = buildConvexShapeOverlay({ shape: state.shape, scale: activeScale })
    if (!overlay) {
      error.value = 'Unable to build convex collider geometry.'
      return
    }
    const previousState = convexShapeState
    convexShapeState = state
    replaceConvexGeometry(overlay.geometry)
    colliderKind.value = 'convex'
    if (!rebuildPreviewGeometry('convex')) {
      convexShapeState = previousState
      return
    }
    if (!previewGroup) {
      return
    }
    previewGroup.position.copy(overlay.offset)
    previewGroup.rotation.set(0, 0, 0)
    previewGroup.scale.set(1, 1, 1)
    previewGroup.updateMatrixWorld(true)
    transformMode.value = 'translate'
    updateState()
    options.onTransformModeChange?.(transformMode.value)
    ready.value = true
  }

  function readStoredConvexState(): ConvexShapeState | null {
    const shape = activeMetadata?.shape
    if (!shape || (shape.kind !== 'convex' && shape.kind !== 'convex-mesh')) {
      return null
    }
    return {
      shape,
      convexSimplify: activeMetadata?.convexSimplify,
      convexDecomposition: activeMetadata?.convexDecomposition,
    }
  }

  async function ensureSamplingObject(): Promise<THREE.Object3D | null> {
    if (samplingObject) {
      return samplingObject
    }
    if (!samplingNode) {
      return null
    }
    const assetCacheStore = useAssetCacheStore()
    const groundNode = findGroundNode(sceneStore.nodes)
    const built = await buildRigidbodySamplingObject(
      samplingNode,
      assetCacheStore,
      groundNode,
      sourceWorldTransform,
    )
    if (!built) {
      return null
    }
    samplingObject = built
    return samplingObject
  }

  async function buildConvexStateFromExportLogic(): Promise<ConvexShapeState | null> {
    const object = await ensureSamplingObject()
    if (!object || !samplingNode) {
      return null
    }
    const props = clampRigidbodyComponentProps(readActiveComponentProps() ?? undefined)
    const built = await buildExportConvexShape({
      samplingObject: object,
      samplingNode,
      nodeScale: { x: activeScale.x, y: activeScale.y, z: activeScale.z },
      sourceWorldTransform,
      hostWorldTransform,
      decompositionLevel: props.convexDecompositionLevel,
      decompositionCustomConfig: props.convexDecompositionConfig,
    })
    if (!built) {
      return null
    }
    return {
      shape: built.shape,
      convexSimplify: built.convexSimplify,
      convexDecomposition: built.convexDecomposition,
    }
  }

  /** Reads the live component props so level changes (this panel or the Rigidbody panel) are honored. */
  function readActiveComponentProps(): RigidbodyComponentProps | null {
    if (activeNodeId) {
      const node = sceneStore.getNodeById(activeNodeId)
      const component = node?.components?.[RIGIDBODY_COMPONENT_TYPE] as
        | SceneNodeComponentState<RigidbodyComponentProps>
        | undefined
      if (component?.props) {
        return component.props
      }
    }
    return activeComponentProps
  }

  function invalidateConvexShape(): void {
    convexShapeState = null
  }

  function handleConvexDetailChange(level: RigidbodyConvexDecompositionLevel | null): void {
    if (!level || level === convexDetailLevel.value) {
      return
    }
    convexDetailLevel.value = level
    if (activeNodeId && activeComponentId) {
      sceneStore.updateNodeComponentProps(activeNodeId, activeComponentId, {
        convexDecompositionLevel: level,
      })
    }
    if (activeComponentProps) {
      activeComponentProps = { ...activeComponentProps, convexDecompositionLevel: level }
    }
    if (active.value && colliderKind.value === 'convex') {
      invalidateConvexShape()
      void prepareShape('convex', true)
    }
  }

  function cancelPendingConvexConfigRegeneration(): void {
    if (convexConfigRegenerateTimer !== null) {
      window.clearTimeout(convexConfigRegenerateTimer)
      convexConfigRegenerateTimer = null
    }
  }

  /** Custom decomposition inputs fire per keystroke, so regeneration is debounced. */
  function scheduleConvexConfigRegeneration(): void {
    cancelPendingConvexConfigRegeneration()
    convexConfigRegenerateTimer = window.setTimeout(() => {
      convexConfigRegenerateTimer = null
      if (!active.value || colliderKind.value !== 'convex' || convexDetailLevel.value !== 'custom') {
        return
      }
      invalidateConvexShape()
      void prepareShape('convex', true)
    }, 350)
  }

  function handleConvexDecompositionConfigChange(
    config: RigidbodyConvexDecompositionCustomConfig,
  ): void {
    const next = clampRigidbodyConvexDecompositionConfig(config)
    convexDecompositionConfig.value = next
    if (activeNodeId && activeComponentId) {
      sceneStore.updateNodeComponentProps(activeNodeId, activeComponentId, {
        convexDecompositionConfig: next,
      })
    }
    if (activeComponentProps) {
      activeComponentProps = { ...activeComponentProps, convexDecompositionConfig: next }
    }
    if (active.value && colliderKind.value === 'convex' && convexDetailLevel.value === 'custom') {
      scheduleConvexConfigRegeneration()
    }
  }

  watch(
    () => rigidbodyComponent.value?.props?.convexDecompositionLevel,
    (level) => {
      if (!level || level === convexDetailLevel.value) {
        return
      }
      convexDetailLevel.value = level
      if (active.value && colliderKind.value === 'convex') {
        invalidateConvexShape()
        void prepareShape('convex', true)
      }
    },
  )

  watch(
    () => rigidbodyComponent.value?.props?.convexDecompositionConfig,
    (config) => {
      const next = clampRigidbodyConvexDecompositionConfig(config)
      if (JSON.stringify(next) === JSON.stringify(convexDecompositionConfig.value)) {
        return
      }
      convexDecompositionConfig.value = next
      if (active.value && colliderKind.value === 'convex' && convexDetailLevel.value === 'custom') {
        scheduleConvexConfigRegeneration()
      }
    },
    { deep: true },
  )

  async function resolveEditableShapeFromSamplingObject(
    kind: ColliderShapeKind,
    forceRegenerate: boolean,
  ): Promise<EditableColliderShape | null> {
    if (!forceRegenerate) {
      const metadataShape = activeMetadata?.shape
      if (metadataShape) {
        const converted = convertColliderMetadataShape(
          metadataShape,
          kind,
          activeScale,
        ) as ConvertedEditableColliderShape | null
        if (converted) {
          return converted
        }
      }
    }
    const object = await ensureSamplingObject()
    if (!object) {
      return null
    }
    return buildDefaultColliderShape({ kind, samplingObject: object, scale: activeScale })
  }

  async function prepareShape(kind: ColliderShapeKind, forceRegenerate = false): Promise<void> {
    const token = buildToken + 1
    buildToken = token
    error.value = null
    ready.value = false

    try {
      if (kind === 'convex') {
        if (!forceRegenerate) {
          const stored = convexShapeState ?? readStoredConvexState()
          if (stored) {
            if (token !== buildToken) {
              return
            }
            applyConvexShapeState(stored)
            return
          }
        }
        const generated = await buildConvexStateFromExportLogic()
        if (token !== buildToken || !previewGroup) {
          return
        }
        if (!generated) {
          error.value = 'Unable to build convex collider geometry.'
          return
        }
        applyConvexShapeState(generated)
        return
      }

      const shape = await resolveEditableShapeFromSamplingObject(kind, forceRegenerate)
      if (token !== buildToken || !previewGroup) {
        return
      }
      if (!shape) {
        error.value = 'Unable to build collider geometry from the selected node.'
        return
      }
      applyShape(shape)
    } catch (buildError) {
      if (token !== buildToken) {
        return
      }
      console.warn('[SceneViewport] Failed to build collider preview geometry', buildError)
      error.value = 'Unable to build collider geometry from the selected node.'
    }
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
    const target = targetNode.value
    if (!target) {
      error.value = 'No target node available for collider editing.'
      return false
    }
    const parent = options.getOverlayParent()
    if (!parent) {
      error.value = 'Scene viewport is not ready for collider editing.'
      return false
    }

    const nodes = sceneStore.nodes
    const lookup = buildSceneNodeLookup(nodes)
    const resolvedSamplingNode = resolveRigidbodySamplingNode(node, component, lookup)
    if (!resolvedSamplingNode) {
      error.value = 'The collider sampling model is not available.'
      return false
    }
    const worldTransformMap = buildSceneNodeWorldTransformMap(nodes)
    const hostTransform = worldTransformMap.get(node.id) ?? null
    const sourceTransform = worldTransformMap.get(resolvedSamplingNode.id) ?? hostTransform
    let scale: THREE.Vector3
    if (hostTransform) {
      scale = resolveTransformScale(hostTransform)
    } else {
      const fallback = resolveColliderScaleFactors(node)
      scale = new THREE.Vector3(
        normalizeScaleComponent(fallback.x),
        normalizeScaleComponent(fallback.y),
        normalizeScaleComponent(fallback.z),
      )
    }

    frame = new THREE.Group()
    frame.name = COLLIDER_FRAME_NAME
    if (hostTransform) {
      frame.position.copy(hostTransform.position)
      frame.quaternion.copy(hostTransform.quaternion)
    } else {
      frame.position.set(node.position.x, node.position.y, node.position.z)
      frame.quaternion.setFromEuler(
        new THREE.Euler(node.rotation.x, node.rotation.y, node.rotation.z, 'XYZ'),
      )
    }
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

    samplingNode = resolvedSamplingNode
    sourceWorldTransform = sourceTransform
    hostWorldTransform = hostTransform
    activeComponentProps = component.props
    activeNodeId = node.id
    activeComponentId = component.id
    activeMetadata = component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
    const clampedProps = clampRigidbodyComponentProps(component.props)
    convexDetailLevel.value = clampedProps.convexDecompositionLevel
    convexDecompositionConfig.value = clampRigidbodyConvexDecompositionConfig(
      clampedProps.convexDecompositionConfig,
    )
    activeScale.copy(scale)
    nodeLabel.value = target.name ?? node.name ?? 'Current Node'

    const desiredKind = normalizeColliderKind(component.props.colliderType)
    // Mark the session active before resolving the shape: the stored-shape path of
    // `prepareShape` resolves synchronously, so it must not observe a stale inactive state.
    setActive(true)
    ready.value = false
    void prepareShape(desiredKind)
    return true
  }

  function deactivate(optionsArg: { save?: boolean } = {}): boolean {
    const shouldSave = optionsArg.save === true
    let saved = false
    if (shouldSave && active.value && previewGroup && activeNodeId && activeComponentId) {
      const node = sceneStore.getNodeById(activeNodeId)
      const currentComponent = node?.components?.[RIGIDBODY_COMPONENT_TYPE] as
        | SceneNodeComponentState<RigidbodyComponentProps>
        | undefined
      if (currentComponent) {
        let shape: RigidbodyPhysicsShape | null = null
        let convexSimplify: RigidbodyConvexSimplifyConfig | undefined
        let convexDecomposition: RigidbodyConvexDecompositionConfig | undefined
        if (colliderKind.value === 'convex') {
          if (convexShapeState) {
            shape = convexShapeState.shape
            convexSimplify = convexShapeState.convexSimplify
            convexDecomposition = convexShapeState.convexDecomposition
          }
        } else {
          const payload = buildColliderMetadataPayload({
            kind: colliderKind.value,
            colliderGroup: previewGroup,
            scale: activeScale,
          })
          shape = payload?.shape ?? null
        }
        if (shape) {
          const existingPayload = currentComponent.metadata?.[RIGIDBODY_METADATA_KEY] as
            | RigidbodyComponentMetadata
            | undefined
          const merged = mergeRigidbodyMetadata(
            { ...(existingPayload ?? {}) },
            shape,
            convexSimplify,
            convexDecomposition,
          )
          const preservedMetadata = { ...(currentComponent.metadata ?? {}) }
          preservedMetadata[RIGIDBODY_METADATA_KEY] = merged[RIGIDBODY_METADATA_KEY]
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
    if (colliderKind.value === 'convex') {
      return
    }
    if (mode === 'rotate' && colliderKind.value === 'sphere') {
      return
    }
    transformMode.value = mode
    options.onTransformModeChange?.(mode)
  }

  function handleShapeKindChange(kind: ColliderShapeKind | null): void {
    if (!kind || !active.value || kind === colliderKind.value) {
      return
    }
    void prepareShape(kind)
  }

  function handleAutoFit(): void {
    if (!active.value) {
      return
    }
    void prepareShape(colliderKind.value, true)
  }

  function handleTransformObjectChange(): void {
    if (!previewGroup || !active.value || colliderKind.value === 'convex') {
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
    convexDetailLevel,
    convexDecompositionConfig,
    transformMode,
    canTransform,
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
    handleConvexDetailChange,
    handleConvexDecompositionConfigChange,
    handleAutoFit,
    handleTransformObjectChange,
    syncStateFromGroup,
  }
}
