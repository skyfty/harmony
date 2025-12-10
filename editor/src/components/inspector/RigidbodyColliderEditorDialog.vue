<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from '@/utils/transformControls.js'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import { findSceneNode } from '@/components/editor/sceneUtils'
import { getCachedModelObject } from '@schema/modelObjectCache'
import {
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  type RigidbodyComponentMetadata,
  type RigidbodyComponentProps,
  type RigidbodyPhysicsShape,
} from '@schema/components'
import type { SceneNode, SceneNodeComponentState } from '@harmony/schema'
import { resolveNodeScaleFactors } from '@/utils/rigidbodyCollider'

const props = defineProps<{
  visible: boolean
  anchor: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

type ColliderShapeKind = 'box' | 'sphere' | 'cylinder'

type EditableShape = {
  kind: ColliderShapeKind
  dimensions: THREE.Vector3
  offset: THREE.Vector3
}

const COLLIDER_SHAPE_OPTIONS: Array<{ label: string; value: ColliderShapeKind }> = [
  { label: 'Box', value: 'box' },
  { label: 'Sphere', value: 'sphere' },
  { label: 'Cylinder', value: 'cylinder' },
]

const sceneStore = useSceneStore()
const { selectedNodeId, selectedNode, nodes: sceneNodes } = storeToRefs(sceneStore)

const rigidbodyComponent = computed<SceneNodeComponentState<RigidbodyComponentProps> | null>(() => {
  const node = selectedNode.value
  if (!node) {
    return null
  }
  const component = node.components?.[RIGIDBODY_COMPONENT_TYPE]
  return (component as SceneNodeComponentState<RigidbodyComponentProps> | undefined) ?? null
})

const targetNodeId = computed(() => {
  const raw = rigidbodyComponent.value?.props.targetNodeId
  if (typeof raw === 'string' && raw.trim().length) {
    return raw.trim()
  }
  return selectedNodeId.value ?? null
})

const targetNode = computed<SceneNode | null>(() => {
  const id = targetNodeId.value
  if (!id) {
    return selectedNode.value ?? null
  }
  const tree = sceneNodes.value ?? []
  return findSceneNode(tree, id)
})

const panelStyle = computed(() => {
  if (!props.anchor) {
    return {}
  }
  const OFFSET_Y = 70
  return {
    top: `${props.anchor.top + OFFSET_Y}px`,
    left: `${props.anchor.left}px`,
  }
})

const colliderKind = ref<ColliderShapeKind>('box')
const transformMode = ref<'translate' | 'scale'>('translate')
const colliderDimensions = reactive({ x: 1, y: 1, z: 1 })
const colliderOffset = reactive({ x: 0, y: 0, z: 0 })
const isReady = ref(false)
const loadError = ref<string | null>(null)
const previewContainerRef = ref<HTMLDivElement | null>(null)

const nodeLabel = computed(() => targetNode.value?.name ?? selectedNode.value?.name ?? 'Current Node')

const componentMetadataShape = computed<RigidbodyPhysicsShape | null>(() => {
  const metadata = rigidbodyComponent.value?.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
  return metadata?.shape ?? null
})

const nodeScaleFactors = computed(() => targetNode.value ? resolveNodeScaleFactors(targetNode.value) : { x: 1, y: 1, z: 1 })

const canSave = computed(() => Boolean(rigidbodyComponent.value && selectedNodeId.value && isReady.value && !loadError.value))

let renderer: THREE.WebGLRenderer | null = null
let previewScene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let transformControls: TransformControls | null = null
let colliderGroup: THREE.Group | null = null
let colliderMesh: THREE.Mesh | null = null
let colliderEdges: THREE.LineSegments | null = null
let previewModelGroup: THREE.Group | null = null
let previewBounds: THREE.Box3 | null = null
let resizeObserver: ResizeObserver | null = null
let previewRefreshToken = 0
const previewOriginShift = new THREE.Vector3()

function collectNodeAndDescendants(node: SceneNode | null): SceneNode[] {
  if (!node) {
    return []
  }
  const list: SceneNode[] = [node]
  const stack = [...(node.children ?? [])]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    list.push(current)
    if (current.children?.length) {
      stack.push(...current.children)
    }
  }
  return list
}

function cloneRuntimeObject(runtimeObject: THREE.Object3D): THREE.Object3D | null {
  const instancedAssetId = runtimeObject.userData?.instancedAssetId as string | undefined
  if (instancedAssetId) {
    const cached = getCachedModelObject(instancedAssetId)
    if (!cached) {
      return null
    }
    return cached.object.clone(true)
  }
  return runtimeObject.clone(true)
}

function cloneNodeForPreview(node: SceneNode): THREE.Object3D | null {
  const runtimeObject = getRuntimeObject(node.id)
  let clone: THREE.Object3D | null = null

  if (runtimeObject) {
    clone = cloneRuntimeObject(runtimeObject)
  } else if (node.nodeType === 'Group') {
    clone = new THREE.Group()
  }

  if (!clone) {
    return null
  }

  clone.name = node.name ?? clone.name
  clone.userData = {
    ...(clone.userData ?? {}),
    nodeId: node.id,
  }

  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => {
      const childClone = cloneNodeForPreview(child)
      if (childClone) {
        clone.add(childClone)
      }
    })
  }

  return clone
}

function disposePreview() {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (renderer) {
    renderer.setAnimationLoop(null)
    renderer.dispose()
    const canvas = renderer.domElement
    canvas?.parentElement?.removeChild(canvas)
  }
  renderer = null

  orbitControls?.dispose()
  orbitControls = null

  if (transformControls) {
    transformControls.detach()
    transformControls.dispose?.()
  }
  transformControls = null

  if (colliderMesh) {
    colliderMesh.geometry.dispose()
    ;(colliderMesh.material as THREE.Material).dispose?.()
  }
  colliderMesh = null

  if (colliderEdges) {
    colliderEdges.geometry.dispose()
    ;(colliderEdges.material as THREE.Material).dispose?.()
  }
  colliderEdges = null

  colliderGroup = null
  previewScene = null
  camera = null
  previewModelGroup = null
  previewBounds = null
  previewOriginShift.set(0, 0, 0)
  isReady.value = false
}

function normalizeColliderKind(type: string | null | undefined): ColliderShapeKind {
  if (type === 'sphere') {
    return 'sphere'
  }
  if (type === 'cylinder') {
    return 'cylinder'
  }
  return 'box'
}

function updateColliderStateFromGroup() {
  if (!colliderGroup) {
    return
  }
  colliderOffset.x = colliderGroup.position.x
  colliderOffset.y = colliderGroup.position.y
  colliderOffset.z = colliderGroup.position.z
  colliderDimensions.x = colliderGroup.scale.x
  colliderDimensions.y = colliderGroup.scale.y
  colliderDimensions.z = colliderGroup.scale.z
}

function constrainColliderTransform() {
  if (!colliderGroup) {
    return
  }
  if (colliderKind.value === 'sphere') {
    const average = (colliderGroup.scale.x + colliderGroup.scale.y + colliderGroup.scale.z) / 3
    const safe = Math.max(0.05, average)
    colliderGroup.scale.set(safe, safe, safe)
  } else if (colliderKind.value === 'cylinder') {
    const radius = Math.max(0.05, (colliderGroup.scale.x + colliderGroup.scale.z) * 0.5)
    const height = Math.max(0.05, colliderGroup.scale.y)
    colliderGroup.scale.set(radius, height, radius)
  } else {
    colliderGroup.scale.set(
      Math.max(0.05, colliderGroup.scale.x),
      Math.max(0.05, colliderGroup.scale.y),
      Math.max(0.05, colliderGroup.scale.z),
    )
  }
}

function rebuildColliderGeometry(kind: ColliderShapeKind) {
  if (!previewScene) {
    return
  }
  const geometry = kind === 'sphere'
    ? new THREE.SphereGeometry(0.5, 36, 24)
    : kind === 'cylinder'
      ? new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1)
      : new THREE.BoxGeometry(1, 1, 1)

  if (!colliderGroup) {
    colliderGroup = new THREE.Group()
    previewScene.add(colliderGroup)
  }

  if (colliderMesh) {
    colliderGroup.remove(colliderMesh)
    colliderMesh.geometry.dispose()
    ;(colliderMesh.material as THREE.Material).dispose?.()
  }

  const fillMaterial = new THREE.MeshStandardMaterial({
    color: 0x4cc9f0,
    opacity: 0.2,
    transparent: true,
    depthWrite: false,
  })
  colliderMesh = new THREE.Mesh(geometry, fillMaterial)
  colliderGroup.add(colliderMesh)

  if (colliderEdges) {
    colliderGroup.remove(colliderEdges)
    colliderEdges.geometry.dispose()
    ;(colliderEdges.material as THREE.Material).dispose?.()
  }
  colliderEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x4cc9f0 })
  )
  colliderGroup.add(colliderEdges)
  transformControls?.attach(colliderGroup)
}

function buildDefaultShapeFromModel(kind: ColliderShapeKind): EditableShape | null {
  if (!previewBounds) {
    return null
  }
  const size = previewBounds.getSize(new THREE.Vector3())
  const center = previewBounds.getCenter(new THREE.Vector3())
  const minSize = 0.25
  if (kind === 'box') {
    return {
      kind,
      dimensions: new THREE.Vector3(
        Math.max(minSize, size.x || minSize),
        Math.max(minSize, size.y || minSize),
        Math.max(minSize, size.z || minSize),
      ),
      offset: center,
    }
  }
  if (kind === 'sphere') {
    const diameter = Math.max(size.x, size.y, size.z)
    const safeDiameter = Math.max(minSize, diameter || minSize)
    return {
      kind,
      dimensions: new THREE.Vector3(safeDiameter, safeDiameter, safeDiameter),
      offset: center,
    }
  }
  const diameter = Math.max(size.x, size.z)
  const safeDiameter = Math.max(minSize, diameter || minSize)
  const safeHeight = Math.max(minSize, size.y || minSize)
  return {
    kind,
    dimensions: new THREE.Vector3(safeDiameter, safeHeight, safeDiameter),
    offset: center,
  }
}

function convertMetadataShape(shape: RigidbodyPhysicsShape, kind: ColliderShapeKind): EditableShape | null {
  const normalized = shape.scaleNormalized !== false
  const scaleX = normalized ? nodeScaleFactors.value.x : 1
  const scaleY = normalized ? nodeScaleFactors.value.y : 1
  const scaleZ = normalized ? nodeScaleFactors.value.z : 1
  const offsetTuple = shape.offset ?? [0, 0, 0]
  const actualOffset = new THREE.Vector3(
    offsetTuple[0] * scaleX,
    offsetTuple[1] * scaleY,
    offsetTuple[2] * scaleZ,
  )
  actualOffset.sub(previewOriginShift)

  if (shape.kind === 'box' && kind === 'box') {
    const [hx, hy, hz] = shape.halfExtents
    return {
      kind: 'box',
      dimensions: new THREE.Vector3(
        Math.max(0.05, hx * 2 * scaleX),
        Math.max(0.05, hy * 2 * scaleY),
        Math.max(0.05, hz * 2 * scaleZ),
      ),
      offset: actualOffset,
    }
  }
  if (shape.kind === 'sphere' && kind === 'sphere') {
    const diameter = Math.max(0.05, shape.radius * 2 * Math.max(scaleX, scaleY, scaleZ))
    return {
      kind: 'sphere',
      dimensions: new THREE.Vector3(diameter, diameter, diameter),
      offset: actualOffset,
    }
  }
  if (shape.kind === 'cylinder' && kind === 'cylinder') {
    const diameter = Math.max(0.05, shape.radiusTop * 2 * Math.max(scaleX, scaleZ))
    const height = Math.max(0.05, shape.height * scaleY)
    return {
      kind: 'cylinder',
      dimensions: new THREE.Vector3(diameter, height, diameter),
      offset: actualOffset,
    }
  }
  return null
}

function applyEditableShape(shape: EditableShape) {
  colliderKind.value = shape.kind
  rebuildColliderGeometry(shape.kind)
  if (!colliderGroup) {
    return
  }
  colliderGroup.position.copy(shape.offset)
  colliderGroup.scale.set(shape.dimensions.x, shape.dimensions.y, shape.dimensions.z)
  constrainColliderTransform()
  updateColliderStateFromGroup()
  transformControls?.setMode(transformMode.value)
}

function resolveInitialShape(desiredKind: ColliderShapeKind): EditableShape | null {
  const metadata = componentMetadataShape.value
  if (metadata) {
    const converted = convertMetadataShape(metadata, desiredKind)
    if (converted) {
      return converted
    }
  }
  return buildDefaultShapeFromModel(desiredKind)
}

function schedulePreviewRefresh() {
  const token = ++previewRefreshToken
  nextTick(async () => {
    if (!props.visible || token !== previewRefreshToken) {
      return
    }
    try {
      await initializePreview(token)
    } catch (error) {
      console.warn('[RigidbodyColliderEditor] Failed to initialize preview', error)
      if (token === previewRefreshToken) {
        loadError.value = 'Unable to initialize the collider preview.'
      }
    }
  })
}

function handleResize() {
  if (!renderer || !camera) {
    return
  }
  const container = previewContainerRef.value
  if (!container) {
    return
  }
  const width = Math.max(1, container.clientWidth)
  const height = Math.max(1, container.clientHeight)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

async function initializePreview(requestToken: number) {
  disposePreview()
  loadError.value = null
  if (!props.visible || requestToken !== previewRefreshToken) {
    return
  }
  const container = previewContainerRef.value
  if (!container) {
    loadError.value = 'Preview container is unavailable.'
    return
  }
  const targetId = targetNodeId.value
  const node = targetNode.value
  if (!targetId || !node) {
    loadError.value = 'No node available for collider editing.'
    return
  }
  const nodesToPrepare = collectNodeAndDescendants(node)
  let runtimeObject = getRuntimeObject(targetId)

  if (node.nodeType === 'Group') {
    try {
      await sceneStore.ensureSceneAssetsReady({ nodes: nodesToPrepare, showOverlay: false, refreshViewport: false })
    } catch (error) {
      console.warn('[RigidbodyColliderEditor] Failed to prepare assets for group preview', error)
    }
    if (!props.visible || requestToken !== previewRefreshToken) {
      return
    }
    runtimeObject = getRuntimeObject(targetId)
  } else if (!runtimeObject) {
    try {
      await sceneStore.ensureSceneAssetsReady({ nodes: nodesToPrepare, showOverlay: false, refreshViewport: false })
    } catch (error) {
      console.warn('[RigidbodyColliderEditor] Failed to prepare assets for preview', error)
    }
    if (!props.visible || requestToken !== previewRefreshToken) {
      return
    }
    runtimeObject = getRuntimeObject(targetId)
  }

  if (node.nodeType !== 'Group' && !runtimeObject) {
    loadError.value = 'Unable to load the target mesh into the preview.'
    return
  }

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.shadowMap.enabled = false
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1)
  container.appendChild(renderer.domElement)

  previewScene = new THREE.Scene()
  previewScene.background = new THREE.Color(0x0f1116)
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000)
  camera.position.set(6, 4, 6)

  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = false
  orbitControls.dampingFactor = 0.06
  orbitControls.target.set(0, 0, 0)

  const ambient = new THREE.AmbientLight(0xffffff, 0.85)
  previewScene.add(ambient)
  const directional = new THREE.DirectionalLight(0xffffff, 0.8)
  directional.position.set(8, 12, 6)
  previewScene.add(directional)
  const grid = new THREE.GridHelper(40, 20, 0x242832, 0x181c24)
  grid.position.y = -2
  previewScene.add(grid)

  let clone: THREE.Object3D | null = null

  if (node.nodeType === 'Group') {
    clone = cloneNodeForPreview(node)
    if (!clone) {
      loadError.value = 'Unable to assemble the selected group for preview.'
      disposePreview()
      return
    }
  } else if (runtimeObject) {
    clone = cloneRuntimeObject(runtimeObject)
    if (!clone) {
      loadError.value = 'The instanced model is not available for preview.'
      disposePreview()
      return
    }
  }

  if (!clone) {
    loadError.value = 'No preview mesh is available.'
    disposePreview()
    return
  }

  clone.updateMatrixWorld(true)
  previewModelGroup = new THREE.Group()
  previewModelGroup.add(clone)
  previewScene.add(previewModelGroup)

  const originalBounds = new THREE.Box3().setFromObject(previewModelGroup)
  if (originalBounds.isEmpty()) {
    loadError.value = 'The selected node has no visible geometry.'
    disposePreview()
    return
  }
  const center = originalBounds.getCenter(new THREE.Vector3())
  previewOriginShift.copy(center)
  previewModelGroup.position.set(-center.x, -center.y, -center.z)
  previewModelGroup.updateMatrixWorld(true)
  previewBounds = new THREE.Box3().setFromObject(previewModelGroup)

  const size = previewBounds.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z) * 0.65 || 4
  const distance = radius * 2.2
  camera.position.set(distance, distance * 0.6, distance)
  camera.lookAt(0, 0, 0)
  orbitControls.update()

  transformControls = new TransformControls(camera, renderer.domElement)
  transformControls.setMode(transformMode.value)
  transformControls.addEventListener('mouseDown', () => {
    if (orbitControls) {
      orbitControls.enabled = false
    }
  })
  transformControls.addEventListener('mouseUp', () => {
    if (orbitControls) {
      orbitControls.enabled = true
    }
  })
  transformControls.addEventListener('objectChange', () => {
    constrainColliderTransform()
    updateColliderStateFromGroup()
  })
  previewScene.add(transformControls)

  const desiredKind = normalizeColliderKind(rigidbodyComponent.value?.props.colliderType)
  const shape = resolveInitialShape(desiredKind) ?? resolveInitialShape('box') ?? {
    kind: 'box',
    dimensions: new THREE.Vector3(1, 1, 1),
    offset: new THREE.Vector3(),
  }
  applyEditableShape(shape)
  isReady.value = true

  renderer.setAnimationLoop(() => {
    orbitControls?.update()
    previewScene && camera && renderer?.render(previewScene, camera)
  })
  handleResize()
  resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(container)
}

function handleShapeKindChange(kind: ColliderShapeKind | null) {
  if (!kind || kind === colliderKind.value) {
    return
  }
  const shape = resolveInitialShape(kind)
  if (shape) {
    applyEditableShape(shape)
  }
}

function buildMetadataShape(): RigidbodyPhysicsShape | null {
  if (!colliderGroup) {
    return null
  }
  const scale = nodeScaleFactors.value
  const offset = colliderGroup.position.clone().add(previewOriginShift)

  if (colliderKind.value === 'box') {
    return {
      kind: 'box',
      halfExtents: [
        Math.max(1e-4, (colliderGroup.scale.x * 0.5) / scale.x),
        Math.max(1e-4, (colliderGroup.scale.y * 0.5) / scale.y),
        Math.max(1e-4, (colliderGroup.scale.z * 0.5) / scale.z),
      ],
      offset: [offset.x / scale.x, offset.y / scale.y, offset.z / scale.z],
      scaleNormalized: true,
    }
  }
  if (colliderKind.value === 'sphere') {
    const radius = colliderGroup.scale.x * 0.5
    const dominant = Math.max(scale.x, scale.y, scale.z)
    return {
      kind: 'sphere',
      radius: Math.max(1e-4, radius / dominant),
      offset: [offset.x / scale.x, offset.y / scale.y, offset.z / scale.z],
      scaleNormalized: true,
    }
  }
  const radius = colliderGroup.scale.x * 0.5
  const horizontalScale = Math.max(scale.x, scale.z)
  return {
    kind: 'cylinder',
    radiusTop: Math.max(1e-4, radius / horizontalScale),
    radiusBottom: Math.max(1e-4, radius / horizontalScale),
    height: Math.max(1e-4, colliderGroup.scale.y / scale.y),
    segments: 16,
    offset: [offset.x / scale.x, offset.y / scale.y, offset.z / scale.z],
    scaleNormalized: true,
  }
}

function handleConfirm() {
  if (!canSave.value || !rigidbodyComponent.value || !selectedNodeId.value) {
    return
  }
  const shape = buildMetadataShape()
  if (!shape) {
    return
  }
  const metadata: Record<string, unknown> = { ...(rigidbodyComponent.value.metadata ?? {}) }
  const payload: RigidbodyComponentMetadata = {
    shape,
    generatedAt: new Date().toISOString(),
  }
  metadata[RIGIDBODY_METADATA_KEY] = payload
  sceneStore.updateNodeComponentMetadata(selectedNodeId.value, rigidbodyComponent.value.id, metadata)
  sceneStore.updateNodeComponentProps(selectedNodeId.value, rigidbodyComponent.value.id, {
    colliderType: colliderKind.value,
  })
  emit('close')
}

function handleCancel() {
  emit('close')
}

watch(() => props.visible, (visible) => {
  if (visible) {
    schedulePreviewRefresh()
  } else {
    disposePreview()
  }
}, { immediate: true })

watch(targetNodeId, () => {
  if (props.visible) {
    schedulePreviewRefresh()
  }
})

watch(
  () => componentMetadataShape.value,
  () => {
    if (props.visible) {
      schedulePreviewRefresh()
    }
  },
)

watch(transformMode, (mode) => {
  transformControls?.setMode(mode)
})

watch(
  () => rigidbodyComponent.value?.enabled,
  (enabled) => {
    if (props.visible && enabled === false) {
      emit('close')
    }
  },
)

watch(selectedNodeId, () => {
  if (props.visible) {
    emit('close')
  }
})

onUnmounted(() => {
  disposePreview()
})
</script>

<template>
  <Teleport to="body">
    <transition name="fade-transition">
      <div
        v-if="visible && anchor"
        class="collider-editor"
        :style="panelStyle"
      >
        <v-toolbar density="compact" height="40px" class="collider-editor__toolbar">
          <div class="collider-editor__title">
            Collider Editor · {{ nodeLabel }}
          </div>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            @click="handleCancel"
          />
        </v-toolbar>

        <v-divider />

        <div class="collider-editor__body">
          <div class="collider-editor__preview">
            <div v-if="loadError" class="collider-editor__empty">
              {{ loadError }}
            </div>
            <div v-else class="collider-editor__canvas" ref="previewContainerRef">
              <div v-if="!isReady" class="collider-editor__empty">
                Preparing preview…
              </div>
            </div>
          </div>
          <div class="collider-editor__controls">
            <v-select
              label="Collider Shape"
              density="compact"
              variant="underlined"
              :items="COLLIDER_SHAPE_OPTIONS"
              item-title="label"
              item-value="value"
              :model-value="colliderKind"
              :disabled="!isReady"
              @update:modelValue="handleShapeKindChange"
            />
            <v-btn-toggle
              v-model="transformMode"
              density="comfortable"
              class="collider-editor__mode-toggle"
              :disabled="!isReady"
            >
              <v-btn value="translate" prepend-icon="mdi-axis-arrow">
                Move
              </v-btn>
              <v-btn value="scale" prepend-icon="mdi-crop">
                Scale
              </v-btn>
            </v-btn-toggle>
            <div class="collider-editor__stats" v-if="isReady">
              <div class="collider-editor__stats-row">
                Size
                <span>{{ colliderDimensions.x.toFixed(2) }} × {{ colliderDimensions.y.toFixed(2) }} × {{ colliderDimensions.z.toFixed(2) }} m</span>
              </div>
              <div class="collider-editor__stats-row">
                Offset
                <span>{{ colliderOffset.x.toFixed(2) }}, {{ colliderOffset.y.toFixed(2) }}, {{ colliderOffset.z.toFixed(2) }} m</span>
              </div>
            </div>
            <div class="collider-editor__hint">
              Drag the gizmo in the preview to reposition or resize the collider mesh. Use the mode toggle to switch between translation and scaling.
            </div>
          </div>
        </div>

        <v-divider />

        <div class="collider-editor__actions">
          <v-btn variant="text" @click="handleCancel">
            Cancel
          </v-btn>
          <v-btn color="primary" :disabled="!canSave" @click="handleConfirm">
            Save Collider
          </v-btn>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>


.collider-editor-enter-active,
.collider-editor-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.collider-editor-enter-from,
.collider-editor-leave-to {
  opacity: 0;
  transform: translate(-105%, 10px);
}



.collider-editor {
  position: fixed;
  top: 0;
  left: 0;
  transform: translateX(-100%);
  

  width: min(860px, 70vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  z-index: 24;
}


.collider-editor__toolbar {
  background: transparent;
  color: inherit;
}

.collider-editor__title {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.collider-editor__body {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 1rem;
  padding: 1rem;
  min-height: 360px;
}

.collider-editor__preview {
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: #06070b;
  overflow: hidden;
}

.collider-editor__canvas {
  width: 100%;
  height: 100%;
  position: relative;
}

.collider-editor__canvas canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

.collider-editor__controls {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.collider-editor__mode-toggle {
  align-self: flex-start;
}

.collider-editor__stats {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.88rem;
}

.collider-editor__stats-row {
  display: flex;
  justify-content: space-between;
  color: rgba(233, 236, 241, 0.82);
}

.collider-editor__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.62);
}

.collider-editor__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1rem;
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.72);
}

.collider-editor__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.8rem;
  padding: 0.75rem 1rem;
}
</style>
