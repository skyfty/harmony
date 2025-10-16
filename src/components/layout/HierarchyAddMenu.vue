<script setup lang="ts">
import { ref, watch, type WatchStopHandle } from 'vue'
import { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import * as THREE from 'three'

import Loader, { type LoaderLoadedPayload, type LoaderProgressPayload } from '@/plugins/loader'
import { createGeometry } from '@/plugins/geometry'
import { useFileDialog } from '@vueuse/core'
import { useUiStore } from '@/stores/uiStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import UrlInputDialog from './UrlInputDialog.vue'
import type { LightNodeType, SceneNode } from '@/types/scene'

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
    object.position.y -= (minY - center.y)
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

  sceneStore.addSceneNode({
    object,
    name: object.name,
    position: { x: 0, y: 0, z: 0 },
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
    object: group,
    name: groupName,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  })
}

function handleAddNode(geometry: string) {
  let mesh = createGeometry(geometry)
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

  mesh.position.set(0, spawnY, 0)
  mesh.updateMatrixWorld(true)

  sceneStore.addSceneNode({
    object: mesh,
    name: mesh.name,
    position: { x: 0, y: spawnY, z: 0 },
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
    <v-btn
        icon="mdi-plus"
        variant="text"
        density="compact"
        v-bind="props"
    />
    </template>
  <v-list class="add-menu-list">
      <v-list-item
          title="Group"
          @click="handleAddGroup()"
      />
      <v-menu location="end" offset="8">
        <template #activator="{ props: lightMenuProps }">
          <v-list-item
            title="Light"
            append-icon="mdi-chevron-right"
            v-bind="lightMenuProps"
          />
        </template>
        <v-list class="add-submenu-list">
          <v-list-item
            title="Directional Light"
            @click="handleAddLight('directional')"
          />
          <v-list-item
            title="Point Light"
            @click="handleAddLight('point')"
          />
          <v-list-item
            title="Spot Light"
            @click="handleAddLight('spot')"
          />
        </v-list>
      </v-menu>
      <v-menu location="end" offset="8">
        <template #activator="{ props: geometryMenuProps }">
          <v-list-item
            title="Geometry"
            append-icon="mdi-chevron-right"
            v-bind="geometryMenuProps"
          />
        </template>
        <v-list class="add-submenu-list">
          <v-list-item
                  title="Box"
                  @click="handleAddNode('Box')"
              />
              <v-list-item
                  title="Capsule"
                  @click="handleAddNode('Capsule')"
              />
              <v-list-item
                  title="Circle"
                  @click="handleAddNode('Circle')"
              />
              <v-list-item
                  title="Cylinder"
                  @click="handleAddNode('Cylinder')"
              />
              <v-list-item
                  title="Dodecahedron"
                  @click="handleAddNode('Dodecahedron')"
              />
              <v-list-item
                  title="Icosahedron"
                  @click="handleAddNode('Icosahedron')"
              />
              <v-list-item
                  title="Lathe"
                  @click="handleAddNode('Lathe')"
              />
              <v-list-item
                  title="Octahedron"
                  @click="handleAddNode('Octahedron')"
              />
              <v-list-item
                  title="Plane"
                  @click="handleAddNode('Plane')"
              />
              <v-list-item
                  title="Ring"
                  @click="handleAddNode('Ring')"
              />
              <v-list-item
                  title="Sphere"
                  @click="handleAddNode('Sphere')"
              />
        </v-list>
      </v-menu>
      <v-divider class="add-menu-divider" />
      
      
      

      <v-list-item
          title="File"
          @click="handleMenuImportFromFile()"
      />
      <v-list-item
          title="URL"
          @click="handleMenuImportFromUrl()"
      />
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