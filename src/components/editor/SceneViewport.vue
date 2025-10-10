<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { SceneNode, Vector3Like } from '@/types/scene'

type EditorTool = 'select' | 'translate' | 'rotate' | 'scale'

const props = defineProps<{
  activeTool: EditorTool
  sceneNodes: SceneNode[]
  selectedNodeId: string | null
}>()

const emit = defineEmits<{
  (event: 'changeTool', tool: EditorTool): void
  (event: 'selectNode', nodeId: string | null): void
  (event: 'updateNodeTransform', payload: {
    id: string
    position: Vector3Like
    rotation: Vector3Like
    scale: Vector3Like
  }): void
}>()

const tools: Array<{ label: string; icon: string; value: EditorTool }> = [
  { label: 'Select', icon: 'mdi-cursor-default', value: 'select' },
  { label: 'Move', icon: 'mdi-axis-arrow', value: 'translate' },
  { label: 'Rotate', icon: 'mdi-rotate-3d-variant', value: 'rotate' },
  { label: 'Scale', icon: 'mdi-cube-scan', value: 'scale' },
]

const viewportEl = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let transformControls: TransformControls | null = null
let resizeObserver: ResizeObserver | null = null

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const rootGroup = new THREE.Group()
const objectMap = new Map<string, THREE.Object3D>()

const draggingChangedHandler = (event: unknown) => {
  const value = (event as { value?: boolean })?.value ?? false
  if (orbitControls) {
    orbitControls.enabled = !value
  }
}

const gridHelper = new THREE.GridHelper(40, 40, 0x4dd0e1, 0x263238)
const gridMaterial = gridHelper.material as THREE.Material
gridMaterial.depthWrite = false
gridMaterial.opacity = 0.25
gridMaterial.transparent = true

const axesHelper = new THREE.AxesHelper(4)

function initScene() {
  if (!canvasRef.value || !viewportEl.value) {
    return
  }

  const width = viewportEl.value.clientWidth
  const height = viewportEl.value.clientHeight

  renderer = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x101318)
  scene.add(rootGroup)
  scene.add(gridHelper)
  scene.add(axesHelper)

  const hemiLight = new THREE.HemisphereLight(0xb3e5fc, 0x1c313a, 0.5)
  scene.add(hemiLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(10, 20, 10)
  dirLight.castShadow = true
  scene.add(dirLight)

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500)
  camera.position.set(12, 9, 12)
  camera.lookAt(new THREE.Vector3(0, 1, 0))

  orbitControls = new OrbitControls(camera, canvasRef.value)
  orbitControls.enableDamping = false
  orbitControls.dampingFactor = 0.05
  orbitControls.target.set(0, 1, 0)

  transformControls = new TransformControls(camera, canvasRef.value)
  transformControls.addEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls.addEventListener('objectChange', handleTransformChange)
  scene.add(transformControls.getHelper())

  canvasRef.value.addEventListener('pointerdown', handlePointerDown)

  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !camera || !viewportEl.value) return
    const w = viewportEl.value.clientWidth
    const h = viewportEl.value.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  })
  resizeObserver.observe(viewportEl.value)

  animate()
}

function animate() {
  if (!renderer || !scene || !camera) {
    return
  }

  requestAnimationFrame(animate)

  if (orbitControls) {
    orbitControls.update()
  }

  renderer.render(scene, camera)
}

function disposeScene() {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (canvasRef.value) {
    canvasRef.value.removeEventListener('pointerdown', handlePointerDown)
  }

  transformControls?.removeEventListener('dragging-changed', draggingChangedHandler as any)
  transformControls?.removeEventListener('objectChange', handleTransformChange)
  transformControls?.dispose()
  transformControls = null

  orbitControls?.dispose()
  orbitControls = null

  renderer?.dispose()
  renderer = null

  scene = null
  camera = null

  objectMap.clear()
}

function handlePointerDown(event: PointerEvent) {
  if (!canvasRef.value || !camera || !scene) {
    return
  }

  if (transformControls?.dragging) {
    return
  }

  const rect = canvasRef.value.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(pointer, camera)
  const intersects = raycaster.intersectObjects(rootGroup.children, true)

  const hit = intersects.find((intersection) => intersection.object.userData?.nodeId)

  if (hit) {
    const nodeId = hit.object.userData.nodeId as string
    emit('selectNode', nodeId)
  } else {
    emit('selectNode', null)
  }
}

function handleTransformChange() {
  if (!transformControls) return
  const target = transformControls.object as THREE.Object3D | null
  if (!target || !target.userData?.nodeId) {
    return
  }

  emit('updateNodeTransform', {
    id: target.userData.nodeId as string,
    position: toVector3Like(target.position),
    rotation: toEulerLike(target.rotation),
    scale: toVector3Like(target.scale),
  })
}

function syncSceneGraph() {
  if (!scene) return

  disposeSceneNodes()
  rootGroup.clear()
  objectMap.clear()

  for (const node of props.sceneNodes) {
    const object = createObjectFromNode(node)
    rootGroup.add(object)
  }

  // 重新附加选择并确保工具模式正确
  attachSelection(props.selectedNodeId, props.activeTool)
}

function disposeSceneNodes() {
  rootGroup.traverse((child) => {
    if ((child as THREE.Mesh).geometry) {
      (child as THREE.Mesh).geometry.dispose()
    }
    if ((child as THREE.Mesh).material) {
      const material = (child as THREE.Mesh).material
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose())
      } else {
        material.dispose()
      }
    }
  })
}

function createObjectFromNode(node: SceneNode): THREE.Object3D {
  let mesh: THREE.Mesh

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(node.material.color),
    wireframe: node.material.wireframe ?? false,
    opacity: node.material.opacity ?? 1,
    transparent: (node.material.opacity ?? 1) < 1,
    metalness: 0.1,
    roughness: 0.6,
  })

  switch (node.geometry) {
    case 'sphere':
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), material)
      break
    case 'plane':
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
      mesh.rotateX(-Math.PI / 2)
      break
    case 'box':
    default:
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
      break
  }

  mesh.position.set(node.position.x, node.position.y, node.position.z)
  mesh.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  mesh.scale.set(node.scale.x, node.scale.y, node.scale.z)

  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.nodeId = node.id

  objectMap.set(node.id, mesh)

  if (node.children) {
    for (const child of node.children) {
      mesh.add(createObjectFromNode(child))
    }
  }

  return mesh
}

function attachSelection(nodeId: string | null, tool: EditorTool = props.activeTool) {
  if (!transformControls) return

  if (!nodeId) {
    transformControls.detach()
    return
  }

  const object = objectMap.get(nodeId)
  if (!object) {
    transformControls.detach()
    return
  }

  if (tool === 'select') {
    transformControls.detach()
    return
  }

  // 确保在附加前设置正确的模式
  transformControls.setMode(tool)
  transformControls.attach(object)
}

function updateToolMode(tool: EditorTool) {
  if (!transformControls) return

  transformControls.enabled = tool !== 'select'

  if (tool === 'select') {
    transformControls.detach()
    return
  }

  transformControls.setMode(tool)
  if (props.selectedNodeId) {
    attachSelection(props.selectedNodeId, tool)
  }
}

function toVector3Like(vec: THREE.Vector3): Vector3Like {
  return { x: vec.x, y: vec.y, z: vec.z }
}

function toEulerLike(euler: THREE.Euler): Vector3Like {
  return { x: euler.x, y: euler.y, z: euler.z }
}

onMounted(() => {
  initScene()
  syncSceneGraph()
  updateToolMode(props.activeTool)
  attachSelection(props.selectedNodeId)
})

onBeforeUnmount(() => {
  disposeSceneNodes()
  disposeScene()
})

watch(
  () => props.sceneNodes,
  () => {
    syncSceneGraph()
  }
)

watch(
  () => props.selectedNodeId,
  (id) => {
    attachSelection(id)
  }
)

watch(
  () => props.activeTool,
  (tool) => {
    updateToolMode(tool)
  }
)
</script>

<template>
  <div ref="viewportEl" class="scene-viewport">
    <div class="tool-strip">
      <v-card class="tool-card" elevation="6">
        <v-btn
          v-for="tool in tools"
          :key="tool.value"
          :icon="tool.icon"
          :color="props.activeTool === tool.value ? 'primary' : undefined"
          :variant="props.activeTool === tool.value ? 'flat' : 'text'"
          density="comfortable"
          class="tool-button"
          @click="emit('changeTool', tool.value)"
        />
      </v-card>
    </div>
    <div class="viewport-surface">
      <canvas ref="canvasRef" class="viewport-canvas" />
    </div>
  </div>
</template>

<style scoped>
.scene-viewport {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: radial-gradient(circle at 20% 20%, rgba(81, 199, 247, 0.08), rgba(12, 15, 21, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  overflow: hidden;
}

.tool-strip {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 5;
}

.tool-card {
  display: flex;
  flex-direction: column;
  background-color: rgba(18, 21, 26, 0.92);
  border-radius: 12px;
  padding: 8px;
  gap: 4px;
}

.tool-button {
  border-radius: 10px;
}

.viewport-surface {
  flex: 1;
  position: relative;
}

.viewport-canvas {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
}

.viewport-canvas:active {
  cursor: grabbing;
}
</style>
