<script setup lang="ts">
import { ref, watch, type WatchStopHandle } from 'vue'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import * as THREE from 'three'

import Loader, { type LoaderLoadedPayload, type LoaderProgressPayload } from '@/plugins/loader'
import { createGeometry, type GeometryType } from '@/plugins/geometry'
import { useFileDialog } from '@vueuse/core'
import { useUiStore } from '@/stores/uiStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import UrlInputDialog from './UrlInputDialog.vue'
import type { LightNodeType, SceneNode, Vector3Like } from '@/types/scene'

const sceneStore = useSceneStore()
const uiStore = useUiStore()
const assetCacheStore = useAssetCacheStore()

const urlDialogOpen = ref(false)
const urlDialogInitialValue = ref('')
const urlImporting = ref(false)
let resolveUrlDialog: ((value: string | null) => void) | null = null

function requestUrlFromDialog(initialUrl = ''): Promise<string | null> {
  if (resolveUrlDialog) {
    resolveUrlDialog(null)
    resolveUrlDialog = null
  }
  urlDialogInitialValue.value = initialUrl
  urlDialogOpen.value = true
  return new Promise((resolve) => {
    resolveUrlDialog = resolve
  })
}

function handleUrlDialogConfirm(value: string) {
  const resolver = resolveUrlDialog
  resolveUrlDialog = null
  resolver?.(value)
  urlDialogOpen.value = false
}

function handleUrlDialogCancel() {
  const resolver = resolveUrlDialog
  resolveUrlDialog = null
  resolver?.(null)
  urlDialogOpen.value = false
}

watch(urlDialogOpen, (open) => {
  if (!open && resolveUrlDialog) {
    const resolver = resolveUrlDialog
    resolveUrlDialog = null
    resolver(null)
  }
})

const GRID_CELL_SIZE = 1
const CAMERA_NEAR = 0.1
const CAMERA_FAR = 500
const CAMERA_DISTANCE_EPSILON = 1e-6
const MAX_SPAWN_ATTEMPTS = 64
const COLLISION_MARGIN = 0.35
const DEFAULT_SPAWN_RADIUS = GRID_CELL_SIZE * 0.75
const GROUND_ASSET_ID = 'preset:models/ground.glb'

type CollisionSphere = {
  center: THREE.Vector3
  radius: number
}

type ObjectMetrics = {
  bounds: THREE.Box3
  center: THREE.Vector3
  radius: number
}

function snapAxisToGrid(value: number): number {
  return Math.round(value / GRID_CELL_SIZE) * GRID_CELL_SIZE
}

function toPlainVector(vector: THREE.Vector3): Vector3Like {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  }
}

function createNodeMatrix(node: SceneNode): THREE.Matrix4 {
  const position = new THREE.Vector3(node.position?.x ?? 0, node.position?.y ?? 0, node.position?.z ?? 0)
  const rotation = new THREE.Euler(node.rotation?.x ?? 0, node.rotation?.y ?? 0, node.rotation?.z ?? 0, 'XYZ')
  const quaternion = new THREE.Quaternion().setFromEuler(rotation)
  const scale = new THREE.Vector3(node.scale?.x ?? 1, node.scale?.y ?? 1, node.scale?.z ?? 1)
  return new THREE.Matrix4().compose(position, quaternion, scale)
}

function collectCollisionSpheres(nodes: SceneNode[]): CollisionSphere[] {
  const spheres: CollisionSphere[] = []
  const traverse = (list: SceneNode[], parentMatrix: THREE.Matrix4) => {
    list.forEach((node) => {
      const nodeMatrix = createNodeMatrix(node)
      const worldMatrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, nodeMatrix)

      if (!node.isPlaceholder && node.nodeType !== 'light') {
        const runtimeObject = getRuntimeObject(node.id)
        if (runtimeObject && node.sourceAssetId !== GROUND_ASSET_ID) {
          runtimeObject.updateMatrixWorld(true)
          const bounds = new THREE.Box3().setFromObject(runtimeObject)
          if (!bounds.isEmpty()) {
            const localCenter = bounds.getCenter(new THREE.Vector3())
            const size = bounds.getSize(new THREE.Vector3())
            const localRadius = Math.max(size.length() * 0.5, DEFAULT_SPAWN_RADIUS)
            const worldCenter = localCenter.clone().applyMatrix4(worldMatrix)
            const position = new THREE.Vector3()
            const quaternion = new THREE.Quaternion()
            const scale = new THREE.Vector3()
            worldMatrix.decompose(position, quaternion, scale)
            const scaleFactor = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), 1)
            const radius = localRadius * scaleFactor
            spheres.push({ center: worldCenter, radius })
          }
        }
      }

      if (node.children?.length) {
        traverse(node.children, worldMatrix)
      }
    })
  }

  traverse(nodes, new THREE.Matrix4().identity())
  return spheres
}

function computeObjectMetrics(object: THREE.Object3D): ObjectMetrics {
  object.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) {
    return {
      bounds,
      center: new THREE.Vector3(),
      radius: DEFAULT_SPAWN_RADIUS,
    }
  }
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() * 0.5, DEFAULT_SPAWN_RADIUS)
  return { bounds, center, radius }
}

function resolveSpawnPosition(params: { baseY: number; radius: number; localCenter?: THREE.Vector3 }): THREE.Vector3 {
  const { baseY, radius, localCenter } = params
  const cameraState = sceneStore.camera
  if (!cameraState) {
    return new THREE.Vector3(snapAxisToGrid(0), baseY, snapAxisToGrid(0))
  }

  const cameraPosition = new THREE.Vector3(cameraState.position.x, cameraState.position.y, cameraState.position.z)
  const cameraTarget = new THREE.Vector3(cameraState.target.x, cameraState.target.y, cameraState.target.z)

  let direction = cameraState.forward
    ? new THREE.Vector3(cameraState.forward.x, cameraState.forward.y, cameraState.forward.z)
    : cameraTarget.clone().sub(cameraPosition)

  if (direction.lengthSq() < CAMERA_DISTANCE_EPSILON) {
    direction = cameraTarget.clone().sub(cameraPosition)
  }
  if (direction.lengthSq() < CAMERA_DISTANCE_EPSILON) {
    direction.set(0, 0, -1)
  }
  direction.normalize()

  if (Math.abs(direction.y) > 0.95) {
    direction.y = 0
    if (direction.lengthSq() < CAMERA_DISTANCE_EPSILON) {
      direction.set(0, 0, -1)
    } else {
      direction.normalize()
    }
  }

  const collisions = collectCollisionSpheres(sceneStore.nodes)
  const margin = Math.max(radius * 0.25, COLLISION_MARGIN)
  const minDistance = Math.max(CAMERA_NEAR * 10, radius * 2)
  const maxDistance = Math.max(minDistance + GRID_CELL_SIZE, CAMERA_FAR * 0.9)
  const targetDistance = cameraPosition.distanceTo(cameraTarget)
  let baseDistance = Number.isFinite(targetDistance)
    ? THREE.MathUtils.clamp(targetDistance, minDistance, maxDistance)
    : minDistance
  if (!Number.isFinite(baseDistance) || baseDistance < minDistance) {
    baseDistance = minDistance
  }

  const step = Math.max(radius, GRID_CELL_SIZE)
  const candidate = new THREE.Vector3()
  const worldCenter = new THREE.Vector3()
  const localCenterVec = localCenter ? localCenter.clone() : new THREE.Vector3()

  for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt += 1) {
    const distance = baseDistance + attempt * step
    if (distance > maxDistance) {
      break
    }

    candidate.copy(cameraPosition).addScaledVector(direction, distance)
    candidate.x = snapAxisToGrid(candidate.x)
    candidate.z = snapAxisToGrid(candidate.z)
    candidate.y = baseY

    worldCenter.copy(localCenterVec).add(candidate)

    const collides = collisions.some((sphere) => {
      const separation = worldCenter.distanceTo(sphere.center)
      return separation < sphere.radius + radius + margin
    })

    if (!collides) {
      return candidate
    }
  }

  candidate.copy(cameraPosition).addScaledVector(direction, Math.min(baseDistance, maxDistance))
  candidate.x = snapAxisToGrid(candidate.x)
  candidate.z = snapAxisToGrid(candidate.z)
  candidate.y = baseY
  return candidate
}

function prepareImportedObject(object: THREE.Object3D) {
  object.removeFromParent()

  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    child.matrixAutoUpdate = true
  })

  object.updateMatrixWorld(true)

  const boundingBox = new THREE.Box3().setFromObject(object)
  if (!boundingBox.isEmpty()) {
    const center = boundingBox.getCenter(new THREE.Vector3())
    const minY = boundingBox.min.y

    object.position.sub(center)
    object.position.y -= minY - center.y
    object.updateMatrixWorld(true)
  }
}

function resolveFilenameFromUrl(url: string, headers?: Headers): string {
  if (headers) {
    const contentDisposition = headers.get('content-disposition')
    if (contentDisposition) {
      const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition)
      if (match) {
        const encoded = match[1] ?? match[2]
        if (encoded) {
          try {
            return decodeURIComponent(encoded)
          } catch (error) {
            console.warn('无法解析响应头中的文件名', error)
            return encoded
          }
        }
      }
    }
  }

  try {
    const parsed = new URL(url, window.location.href)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const last = segments.pop()
    if (last) {
      return decodeURIComponent(last)
    }
  } catch (error) {
    console.warn('无法从 URL 解析文件名', error)
  }

  return 'remote-asset'
}

function addImportedObjectToScene(object: THREE.Object3D, assetId?: string) {
  prepareImportedObject(object)

  const metrics = computeObjectMetrics(object)
  const spawnVector = resolveSpawnPosition({ baseY: 0, radius: metrics.radius, localCenter: metrics.center })
  const spawnPosition = toPlainVector(spawnVector)

  sceneStore.addSceneNode({
    nodeType: 'mesh',
    object,
    name: object.name,
    position: spawnPosition,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    sourceAssetId: assetId,
  })
}

async function handleMenuImportFromUrl() {
  if (urlImporting.value) {
    return
  }

  const input = await requestUrlFromDialog(urlDialogInitialValue.value)
  if (!input) {
    return
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.trim())
  } catch (error) {
    console.warn('无法解析提供的 URL', error)
    return
  }
  const normalizedUrl = parsedUrl.toString()
  urlDialogInitialValue.value = normalizedUrl

  await importAssetFromUrl(normalizedUrl)
}

async function importAssetFromUrl(normalizedUrl: string) {
  const fallbackName = resolveFilenameFromUrl(normalizedUrl)

  urlImporting.value = true
  uiStore.startIndeterminateLoading({
    title: '导入资源',
    message: '正在下载资源…',
    closable: true,
  })

  let stopDownloadWatcher: WatchStopHandle | null = null

  try {
    stopDownloadWatcher = watch(
      () => {
        const entry = assetCacheStore.getEntry(normalizedUrl)
        return [entry.status, entry.progress, entry.filename] as const
      },
      ([status, progress, filename]) => {
        if (status !== 'downloading') {
          return
        }
        const normalizedProgress = Number.isFinite(progress) ? Math.max(0, Math.round(progress)) : 0
        const displayName = filename?.trim() || fallbackName
        uiStore.updateLoadingOverlay({
          mode: 'determinate',
          message: `正在下载：${displayName} (${normalizedProgress}%)`,
          progress: normalizedProgress,
          closable: true,
          autoClose: false,
        })
      },
      { immediate: true },
    )

    const entry = await assetCacheStore.downloadAsset(normalizedUrl, normalizedUrl, fallbackName)
    if (entry.status !== 'cached' || !entry.blob) {
      throw new Error(entry.error ?? '资源下载失败')
    }

    uiStore.updateLoadingOverlay({
      mode: 'determinate',
      message: '正在解析资源…',
      progress: 55,
      closable: true,
      autoClose: false,
    })

    const file = assetCacheStore.createFileFromCache(normalizedUrl)
    if (!file) {
      throw new Error('下载的资源数据不可用')
    }

    const object = await loadObjectFromRemoteFile(file)
    addImportedObjectToScene(object, normalizedUrl)
    assetCacheStore.registerUsage(normalizedUrl)
    assetCacheStore.touch(normalizedUrl)

    const displayName = object.name || entry.filename || fallbackName
    const importedAsset: ProjectAsset = {
      id: normalizedUrl,
      name: displayName,
      type: 'model',
      downloadUrl: normalizedUrl,
      previewColor: '#26C6DA',
      thumbnail: null,
      description: normalizedUrl,
      gleaned: true,
    }
    sceneStore.registerAsset(importedAsset, { source: { type: 'url' } })

    uiStore.updateLoadingOverlay({
      mode: 'determinate',
      message: `${displayName} 导入完成`,
      progress: 100,
      autoClose: true,
      autoCloseDelay: 900,
      closable: true,
    })
  } catch (error) {
    console.error('通过 URL 导入资源失败', error)
    uiStore.updateLoadingOverlay({
      mode: 'indeterminate',
      message: (error as Error).message ?? '导入失败，请重试',
      closable: true,
      autoClose: false,
    })
  } finally {
    stopDownloadWatcher?.()
    urlImporting.value = false
  }
}

function loadObjectFromRemoteFile(file: File): Promise<THREE.Object3D> {
  return new Promise<THREE.Object3D>((resolve, reject) => {
    const loader = new Loader()

    const handleLoaded = (payload: LoaderLoadedPayload) => {
      cleanup()
      if (!payload) {
        reject(new Error('解析资源失败'))
        return
      }
      resolve(payload as THREE.Object3D)
    }

    const handleProgress = (payload: LoaderProgressPayload) => {
      uiStore.updateLoadingOverlay({
        mode: 'determinate',
        message: `正在解析：${payload.filename}`,
      })
      if (payload.total > 0) {
        const progress = 60 + Math.round((payload.loaded / payload.total) * 35)
        uiStore.updateLoadingProgress(Math.min(99, progress), { autoClose: false })
      }
    }

    const cleanup = () => {
      loader.$off('loaded', handleLoaded)
      loader.$off('progress', handleProgress)
    }

    loader.$on('loaded', handleLoaded)
    loader.$on('progress', handleProgress)

    try {
      loader.loadFile(file)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function handleMenuImportFromFile() {
  const loader = new Loader()
  const sourceFiles = new Map<string, File[]>()

  loader.$on('loaded', async (object: LoaderLoadedPayload) => {
    if (!object) {
      console.error('Failed to load object.')
      uiStore.updateLoadingOverlay({
        message: '导入失败，请重试',
        closable: true,
        autoClose: false,
      })
      return
    }

    const imported = object as THREE.Object3D
    const assetId = crypto.randomUUID()

    let matchedFile: File | null = null
    if (imported.name && sourceFiles.has(imported.name)) {
      const list = sourceFiles.get(imported.name) ?? []
      matchedFile = list.shift() ?? null
      if (list.length) {
        sourceFiles.set(imported.name, list)
      } else {
        sourceFiles.delete(imported.name)
      }
    }

    if (!matchedFile) {
      for (const [key, list] of sourceFiles.entries()) {
        if (!list.length) {
          sourceFiles.delete(key)
          continue
        }
        matchedFile = list.shift() ?? null
        if (list.length) {
          sourceFiles.set(key, list)
        } else {
          sourceFiles.delete(key)
        }
        if (matchedFile) {
          break
        }
      }
    }

    let cached = false
    if (matchedFile) {
      try {
        await assetCacheStore.storeAssetBlob(assetId, {
          blob: matchedFile,
          mimeType: matchedFile.type || null,
          filename: matchedFile.name,
        })
        cached = true
      } catch (error) {
        console.error('缓存导入资源失败', error)
      }
    } else {
      console.warn('未能匹配到导入文件，无法缓存资源', imported.name)
    }

    addImportedObjectToScene(imported, assetId)

    if (cached) {
      assetCacheStore.registerUsage(assetId)
      assetCacheStore.touch(assetId)
    }

    const displayName = imported.name || matchedFile?.name || 'Imported Asset'
    const importedAsset: ProjectAsset = {
      id: assetId,
      name: displayName,
      type: 'model',
      downloadUrl: assetId,
      previewColor: '#26C6DA',
      thumbnail: null,
      description: matchedFile?.name ?? undefined,
      gleaned: true,
    }
    sceneStore.registerAsset(importedAsset, { source: { type: 'local' } })

    uiStore.updateLoadingOverlay({
      message: `${imported.name ?? '资源'}导入完成`,
      progress: 100,
    })
    uiStore.updateLoadingProgress(100)
  })

  loader.$on('progress', (payload: LoaderProgressPayload) => {
    const percent = (payload.loaded / payload.total) * 100
    uiStore.updateLoadingOverlay({
      mode: 'determinate',
      message: `正在导入：${payload.filename}`,
    })
    uiStore.updateLoadingProgress(percent)
    console.log(`Loading ${payload.filename}: ${percent.toFixed(2)}%`)
  })

  const { open: openFileDialog, onChange: onFileChange } = useFileDialog()

  onFileChange((files: FileList | File[] | null) => {
    if (!files || (files instanceof FileList && files.length === 0) || (Array.isArray(files) && files.length === 0)) {
      uiStore.hideLoadingOverlay(true)
      return
    }

    const fileArray = Array.isArray(files) ? files : Array.from(files)

    sourceFiles.clear()
    for (const file of fileArray) {
      const list = sourceFiles.get(file.name)
      if (list) {
        list.push(file)
      } else {
        sourceFiles.set(file.name, [file])
      }
    }

    uiStore.startIndeterminateLoading({
      title: '导入资源',
      message: '正在准备文件…',
      closable: true,
    })
    loader.loadFiles(fileArray)
  })

  openFileDialog()
}

function collectGroupIndices(nodes: SceneNode[] | undefined, used: Set<number>) {
  if (!nodes?.length) {
    return
  }
  nodes.forEach((node) => {
    const name = node.name?.trim()
    if (name) {
      const match = /^Group(?:\s+(\d+))?$/i.exec(name)
      if (match) {
        const index = match[1] ? Number.parseInt(match[1], 10) : 1
        if (Number.isFinite(index)) {
          used.add(index)
        }
      }
    }
    if (node.children?.length) {
      collectGroupIndices(node.children, used)
    }
  })
}

function getNextGroupName(): string {
  const usedIndices = new Set<number>()
  collectGroupIndices(sceneStore.nodes, usedIndices)
  let candidate = 1
  while (usedIndices.has(candidate)) {
    candidate += 1
  }
  return `Group ${candidate}`
}

function handleAddGroup() {
  const groupName = getNextGroupName()
  const group = new THREE.Group()
  group.name = groupName
  sceneStore.addSceneNode({
    nodeType: 'group',
    object: group,
    name: groupName,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  })
}

function handleAddNode(geometry: GeometryType) {
  const mesh = createGeometry(geometry)
  mesh.name = geometry

  mesh.castShadow = true
  mesh.receiveShadow = true

  let spawnY = 0
  const bufferGeometry = mesh.geometry as THREE.BufferGeometry
  if (!bufferGeometry.boundingBox) {
    bufferGeometry.computeBoundingBox()
  }
  const boundingBox = bufferGeometry.boundingBox
  if (boundingBox) {
    const minY = boundingBox.min.y
    if (Number.isFinite(minY) && minY < 0) {
      const EPSILON = 1e-3
      spawnY = -minY + EPSILON
    }
  }

  mesh.position.set(0, 0, 0)
  mesh.updateMatrixWorld(true)

  const metrics = computeObjectMetrics(mesh)
  const spawnVector = resolveSpawnPosition({ baseY: spawnY, radius: metrics.radius, localCenter: metrics.center })
  const spawnPosition = toPlainVector(spawnVector)

  sceneStore.addSceneNode({
    nodeType: geometry,
    object: mesh,
    name: mesh.name,
    position: spawnPosition,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  })
}

function handleAddLight(type: LightNodeType) {
  sceneStore.addLightNode(type)
}

</script>

<template>
  <v-menu>
    <template #activator="{ props }">
      <slot name="activator" :props="props">
        <v-btn icon="mdi-plus" variant="text" density="compact" v-bind="props" />
      </slot>
    </template>
    <v-list class="add-menu-list">
      <v-list-item title="Group" @click="handleAddGroup()" />
      <v-menu location="end" offset="8">
        <template #activator="{ props: lightMenuProps }">
          <v-list-item title="Light" append-icon="mdi-chevron-right" v-bind="lightMenuProps" />
        </template>
        <v-list class="add-submenu-list">
          <v-list-item title="Directional Light" @click="handleAddLight('directional')" />
          <v-list-item title="Point Light" @click="handleAddLight('point')" />
          <v-list-item title="Spot Light" @click="handleAddLight('spot')" />
        </v-list>
      </v-menu>
      <v-menu location="end" offset="8">
        <template #activator="{ props: geometryMenuProps }">
          <v-list-item title="Geometry" append-icon="mdi-chevron-right" v-bind="geometryMenuProps" />
        </template>
        <v-list class="add-submenu-list">
          <v-list-item title="Box" @click="handleAddNode('Box')" />
          <v-list-item title="Capsule" @click="handleAddNode('Capsule')" />
          <v-list-item title="Circle" @click="handleAddNode('Circle')" />
          <v-list-item title="Cylinder" @click="handleAddNode('Cylinder')" />
          <v-list-item title="Dodecahedron" @click="handleAddNode('Dodecahedron')" />
          <v-list-item title="Icosahedron" @click="handleAddNode('Icosahedron')" />
          <v-list-item title="Lathe" @click="handleAddNode('Lathe')" />
          <v-list-item title="Octahedron" @click="handleAddNode('Octahedron')" />
          <v-list-item title="Plane" @click="handleAddNode('Plane')" />
          <v-list-item title="Ring" @click="handleAddNode('Ring')" />
          <v-list-item title="Sphere" @click="handleAddNode('Sphere')" />
        </v-list>
      </v-menu>
      <v-divider class="add-menu-divider" />
      <v-list-item title="File" @click="handleMenuImportFromFile()" />
      <v-list-item title="URL" @click="handleMenuImportFromUrl()" />
    </v-list>
  </v-menu>
  <UrlInputDialog
    v-model="urlDialogOpen"
    :initial-url="urlDialogInitialValue"
    title="从 URL 导入资源"
    label="资源 URL"
    confirm-text="导入"
    cancel-text="取消"
    @confirm="handleUrlDialogConfirm"
    @cancel="handleUrlDialogCancel"
  />
</template>

<style scoped>
.add-menu-list {
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.add-menu-list :deep(.v-list-item) {
  min-height: 26px;
  border-radius: 8px;
  padding-inline: 12px;
  transition: background-color 160ms ease;
}

.add-menu-list :deep(.v-list-item:hover) {
  background-color: rgba(255, 255, 255, 0.08);
}

.add-menu-divider {
  align-self: stretch;
  margin: 4px 0;
  opacity: 0.2;
}

.add-submenu-list {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.add-submenu-list :deep(.v-list-item) {
  min-height: 26px;
  border-radius: 8px;
  padding-inline: 12px;
}
</style>
