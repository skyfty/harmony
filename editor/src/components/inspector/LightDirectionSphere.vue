<template>
  <div class="light-direction-sphere" :class="{ 'light-direction-sphere--disabled': props.disabled }">
    <div
      ref="containerRef"
      class="light-direction-sphere__viewport"
      :class="{ 'light-direction-sphere__viewport--dragging': isDragging }"
      @pointerdown="handlePointerDown"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'

type Vector3Like = { x: number; y: number; z: number }
type DirectionalLightWidgetType = 'Directional' | 'Spot'

const props = defineProps<{
  direction: Vector3Like
  disabled?: boolean
  lightType?: DirectionalLightWidgetType
}>()

const emit = defineEmits<{
  (event: 'interaction:start'): void
  (event: 'update:direction', direction: Vector3Like): void
  (event: 'interaction:end', direction: Vector3Like): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const isDragging = ref(false)

const DEFAULT_DIRECTION = new THREE.Vector3(0, -1, 0)
const BASE_DIRECTION = new THREE.Vector3(0, 0, 1)
const arcballStart = new THREE.Vector3()
const arcballCurrent = new THREE.Vector3()
const directionVector = new THREE.Vector3()
const rotationDelta = new THREE.Quaternion()
const orientationQuaternion = new THREE.Quaternion()

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let resizeObserver: ResizeObserver | null = null
let orientationGroup: THREE.Group | null = null
let accentMaterial: THREE.MeshStandardMaterial | null = null
let accentLineMaterial: THREE.LineBasicMaterial | null = null
let isPointerActive = false
let hasDragged = false
let activePointerId: number | null = null

function normalizeDirection(input: Vector3Like): THREE.Vector3 {
  directionVector.set(input.x, input.y, input.z)
  if (directionVector.lengthSq() <= 1e-10) {
    return DEFAULT_DIRECTION.clone()
  }
  return directionVector.normalize().clone()
}

function directionToPayload(vector: THREE.Vector3): Vector3Like {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  }
}

function resolveAccentColor(): string {
  return props.lightType === 'Spot' ? '#ffb347' : '#ffd54a'
}

function createCircle(radius: number): THREE.LineLoop {
  const points: THREE.Vector3[] = []
  const segments = 96
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0))
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({
    color: '#91a0b4',
    transparent: true,
    opacity: 0.28,
  })
  return new THREE.LineLoop(geometry, material)
}

function buildScene(): void {
  const container = containerRef.value
  if (!container) {
    return
  }

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20)
  camera.position.set(0, 0, 4.4)
  camera.lookAt(0, 0, 0)

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.classList.add('light-direction-sphere__canvas')
  container.appendChild(renderer.domElement)

  const ambientLight = new THREE.AmbientLight('#ffffff', 1.1)
  scene.add(ambientLight)

  const keyLight = new THREE.DirectionalLight('#ffffff', 1.4)
  keyLight.position.set(3.5, 4.5, 6)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight('#8fb8ff', 0.7)
  fillLight.position.set(-4, -2, 4)
  scene.add(fillLight)

  const sphereGeometry = new THREE.SphereGeometry(1, 48, 32)
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: '#1d2430',
    emissive: '#0a1322',
    emissiveIntensity: 0.65,
    roughness: 0.42,
    metalness: 0.08,
    transparent: true,
    opacity: 0.92,
  })
  const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial)
  scene.add(sphereMesh)

  const edgeGeometry = new THREE.EdgesGeometry(sphereGeometry)
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: '#d8dee8',
    transparent: true,
    opacity: 0.45,
  })
  scene.add(new THREE.LineSegments(edgeGeometry, edgeMaterial))

  const xyRing = createCircle(1.02)
  scene.add(xyRing)

  const yzRing = createCircle(1.02)
  yzRing.rotation.y = Math.PI / 2
  scene.add(yzRing)

  const xzRing = createCircle(1.02)
  xzRing.rotation.x = Math.PI / 2
  scene.add(xzRing)

  orientationGroup = new THREE.Group()
  scene.add(orientationGroup)

  accentLineMaterial = new THREE.LineBasicMaterial({
    color: resolveAccentColor(),
    transparent: true,
    opacity: 0.95,
  })
  accentMaterial = new THREE.MeshStandardMaterial({
    color: resolveAccentColor(),
    emissive: resolveAccentColor(),
    emissiveIntensity: 0.35,
    roughness: 0.28,
    metalness: 0.12,
  })

  const directionGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 1.18),
  ])
  const directionLine = new THREE.Line(directionGeometry, accentLineMaterial)
  orientationGroup.add(directionLine)

  const tipGeometry = new THREE.SphereGeometry(0.08, 24, 16)
  const tip = new THREE.Mesh(tipGeometry, accentMaterial)
  tip.position.z = 1.18
  orientationGroup.add(tip)

  const meridian = createCircle(0.94)
  meridian.rotation.y = Math.PI / 2
  ;(meridian.material as THREE.LineBasicMaterial).color.set(resolveAccentColor())
  ;(meridian.material as THREE.LineBasicMaterial).opacity = 0.34
  orientationGroup.add(meridian)

  const equatorMarkerGeometry = new THREE.TorusGeometry(0.28, 0.022, 16, 48)
  const equatorMarker = new THREE.Mesh(equatorMarkerGeometry, accentMaterial)
  equatorMarker.position.z = 0.68
  equatorMarker.rotation.x = Math.PI / 2
  orientationGroup.add(equatorMarker)

  syncOrientationFromProps()
  resizeRenderer()

  resizeObserver = new ResizeObserver(() => resizeRenderer())
  resizeObserver.observe(container)
}

function resizeRenderer(): void {
  const container = containerRef.value
  if (!container || !camera || !renderer) {
    return
  }
  const width = Math.max(1, Math.round(container.clientWidth))
  const height = Math.max(1, Math.round(container.clientHeight))
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
  renderScene()
}

function renderScene(): void {
  if (!scene || !camera || !renderer) {
    return
  }
  renderer.render(scene, camera)
}

function syncOrientationFromProps(): void {
  if (!orientationGroup) {
    return
  }
  const normalized = normalizeDirection(props.direction)
  orientationQuaternion.setFromUnitVectors(BASE_DIRECTION, normalized)
  orientationGroup.quaternion.copy(orientationQuaternion)
  renderScene()
}

function projectToArcball(event: PointerEvent): THREE.Vector3 {
  const container = containerRef.value
  if (!container) {
    return DEFAULT_DIRECTION.clone()
  }

  const rect = container.getBoundingClientRect()
  const size = Math.max(1, Math.min(rect.width, rect.height))
  const x = ((event.clientX - rect.left) - rect.width * 0.5) / (size * 0.5)
  const y = (rect.height * 0.5 - (event.clientY - rect.top)) / (size * 0.5)
  const lengthSq = x * x + y * y
  const projected = new THREE.Vector3(x, y, 0)

  if (lengthSq <= 1) {
    projected.z = Math.sqrt(1 - lengthSq)
  } else {
    projected.normalize()
  }

  return projected
}

function emitDirectionUpdate(): Vector3Like {
  const nextDirection = BASE_DIRECTION.clone().applyQuaternion(orientationQuaternion).normalize()
  const payload = directionToPayload(nextDirection)
  emit('update:direction', payload)
  return payload
}

function stopPointerTracking(): void {
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
  activePointerId = null
  isPointerActive = false
  isDragging.value = false
  hasDragged = false
}

function handlePointerDown(event: PointerEvent): void {
  if (props.disabled || event.button !== 0) {
    return
  }
  event.preventDefault()

  const element = containerRef.value
  element?.setPointerCapture?.(event.pointerId)
  arcballStart.copy(projectToArcball(event))
  hasDragged = false
  isPointerActive = true
  isDragging.value = true
  activePointerId = event.pointerId

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}

function handlePointerMove(event: PointerEvent): void {
  if (!isPointerActive || activePointerId !== event.pointerId || !orientationGroup) {
    return
  }

  arcballCurrent.copy(projectToArcball(event))
  if (arcballCurrent.distanceToSquared(arcballStart) <= 1e-8) {
    return
  }

  if (!hasDragged) {
    hasDragged = true
    emit('interaction:start')
  }

  rotationDelta.setFromUnitVectors(arcballStart, arcballCurrent)
  orientationQuaternion.premultiply(rotationDelta)
  orientationGroup.quaternion.copy(orientationQuaternion)
  renderScene()
  emitDirectionUpdate()
  arcballStart.copy(arcballCurrent)
}

function handlePointerUp(event: PointerEvent): void {
  if (!isPointerActive || activePointerId !== event.pointerId) {
    return
  }

  const didDrag = hasDragged
  const payload = BASE_DIRECTION.clone().applyQuaternion(orientationQuaternion).normalize()
  const nextDirection = directionToPayload(payload)
  stopPointerTracking()

  if (didDrag) {
    emit('interaction:end', nextDirection)
  }
}

function disposeScene(): void {
  stopPointerTracking()
  resizeObserver?.disconnect()
  resizeObserver = null

  if (scene) {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      const line = object as THREE.Line
      if ('geometry' in mesh && mesh.geometry) {
        mesh.geometry.dispose()
      }
      const material = (mesh.material ?? line.material) as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        material?.dispose()
      }
    })
  }

  if (renderer) {
    renderer.dispose()
    const canvas = renderer.domElement
    canvas.parentElement?.removeChild(canvas)
  }

  renderer = null
  camera = null
  scene = null
  orientationGroup = null
  accentMaterial = null
  accentLineMaterial = null
}

watch(
  () => props.direction,
  () => {
    if (!isPointerActive) {
      syncOrientationFromProps()
    }
  },
  { deep: true },
)

watch(
  () => props.lightType,
  () => {
    const accentColor = resolveAccentColor()
    accentMaterial?.color.set(accentColor)
    accentMaterial?.emissive.set(accentColor)
    accentLineMaterial?.color.set(accentColor)
    renderScene()
  },
)

onMounted(() => {
  buildScene()
})

onBeforeUnmount(() => {
  disposeScene()
})
</script>

<style scoped>
.light-direction-sphere {
  width: 100%;
}

.light-direction-sphere__viewport {
  width: 100%;
  height: 220px;
  border-radius: 12px;
  background:
    radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.06), transparent 34%),
    linear-gradient(180deg, rgba(22, 29, 40, 0.96), rgba(10, 14, 22, 0.98));
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}

.light-direction-sphere__viewport--dragging {
  cursor: grabbing;
}

.light-direction-sphere--disabled .light-direction-sphere__viewport {
  cursor: not-allowed;
  opacity: 0.58;
}

.light-direction-sphere__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>