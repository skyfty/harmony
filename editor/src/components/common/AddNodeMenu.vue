<script setup lang="ts">
import { computed, ref, watch, type WatchStopHandle } from 'vue'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import * as THREE from 'three'
import type {
  GeometryType,
  BehaviorComponentProps,
  SceneBehavior,
  SceneBehaviorScriptBinding,
  SceneNodeComponentState,
} from '@harmony/schema'

import Loader, { type LoaderLoadedPayload, type LoaderProgressPayload } from '@schema/loader'
import { createPrimitiveMesh } from '@schema/geometry'
import { useFileDialog } from '@vueuse/core'
import { useUiStore } from '@/stores/uiStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import UrlInputDialog from './UrlInputDialog.vue'
import { generateUuid } from '@/utils/uuid'
import { type LightNodeType, type SceneNode, type Vector3Like } from '@harmony/schema'
import { determineAssetCategoryId } from '@/stores/assetCatalog'
import { blobToDataUrl } from '@/utils/blob'
import {
  BEHAVIOR_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  VIEW_POINT_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
} from '@schema/components'
import type {
  GuideboardComponentProps,
  ViewPointComponentProps,
  WarpGateComponentProps,
} from '@schema/components'
import {
  NAMED_BEHAVIOR_SEQUENCES_KEY,
  cloneBehaviorList,
  createBehaviorSequenceId,
  ensureBehaviorParams,
  normalizeNamedBehaviorSequenceMap,
  upsertNamedBehaviorSequence,
} from '@schema/behaviors/definitions'

const sceneStore = useSceneStore()
const uiStore = useUiStore()
const assetCacheStore = useAssetCacheStore()

const DISPLAY_BOARD_INITIAL_HEIGHT = 0.5
const DISPLAY_BOARD_EPSILON = 1e-4

const VIEW_POINT_RADIUS = 0.12
const VIEW_POINT_DEFAULT_OFFSET = 0.8
const VIEW_POINT_MIN_DISTANCE = 0.3
const VIEW_POINT_EDGE_MARGIN = 0.05
const VIEW_POINT_COLOR = 0xff8a65
const VIEW_POINT_SHOW_BEHAVIOR_NAME = 'Show View Point'
const VIEW_POINT_HIDE_BEHAVIOR_NAME = 'Hide View Point'

const GUIDEBOARD_RADIUS = 0.75

const tempViewPointBox = new THREE.Box3()
const tempViewPointVecA = new THREE.Vector3()
const tempViewPointVecB = new THREE.Vector3()
const tempViewPointVecC = new THREE.Vector3()
const tempViewPointQuat = new THREE.Quaternion()
const tempGroupCameraPosition = new THREE.Vector3()
const tempGroupCameraTarget = new THREE.Vector3()
const tempGroupDirection = new THREE.Vector3()
const tempGroupSpawn = new THREE.Vector3()

const GROUP_SPAWN_DISTANCE = 6

interface NodeCreationOptions {
  parentId?: string | null
  autoBehaviors?: boolean
}

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

async function addImportedObjectToScene(object: THREE.Object3D, assetId?: string) {
  prepareImportedObject(object)
  await sceneStore.addModelNode({
    object,
    name: object.name,
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
    await addImportedObjectToScene(object, normalizedUrl)
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
    const categoryId = determineAssetCategoryId(importedAsset)
    const registeredAsset = sceneStore.registerAsset(importedAsset, {
      categoryId,
      source: { type: 'url' },
      commitOptions: { updateNodes: false, updateCamera: false },
    })

    const packageKey = `url::${registeredAsset.id}`
    sceneStore.$patch((state) => {
      state.packageAssetMap = {
        ...state.packageAssetMap,
        [packageKey]: normalizedUrl,
      }
      state.assetIndex = {
        ...state.assetIndex,
        [registeredAsset.id]: {
          categoryId,
          source: { type: 'url' },
        },
      }
    })

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
      loader.removeEventListener('loaded', handleLoaded)
      loader.removeEventListener('progress', handleProgress)
    }

    loader.addEventListener('loaded', handleLoaded)
    loader.addEventListener('progress', handleProgress)

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

  loader.addEventListener('loaded', async (object: LoaderLoadedPayload) => {
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

    let assetId: string | null = null
    let localAssetHandled = false
    let registeredAsset: ProjectAsset | null = null
    if (matchedFile) {
      try {
        const ensured = await sceneStore.ensureLocalAssetFromFile(matchedFile, {
          type: 'model',
          name: imported.name && imported.name.trim().length ? imported.name : matchedFile.name,
          description: matchedFile.name,
          previewColor: '#26C6DA',
          gleaned: true,
          commitOptions: { updateNodes: false, updateCamera: false },
        })
        registeredAsset = ensured.asset
        assetId = ensured.asset.id
        localAssetHandled = true
      } catch (error) {
        console.error('缓存导入资源失败', error)
      }
    } else {
      console.warn('未能匹配到导入文件，无法缓存资源', imported.name)
    }

    if (!assetId) {
      assetId = generateUuid()
      const fallbackName = imported.name || matchedFile?.name || 'Imported Asset'
      const importedAsset: ProjectAsset = {
        id: assetId,
        name: fallbackName,
        type: 'model',
        downloadUrl: assetId,
        previewColor: '#26C6DA',
        thumbnail: null,
        description: matchedFile?.name ?? undefined,
        gleaned: true,
      }
      registeredAsset = sceneStore.registerAsset(importedAsset, { source: { type: 'local' } })
    }

    await addImportedObjectToScene(imported, assetId ?? undefined)

    if (localAssetHandled && assetId) {
      assetCacheStore.registerUsage(assetId)
      assetCacheStore.touch(assetId)
    }

    if (registeredAsset) {
      const categoryId = determineAssetCategoryId(registeredAsset)
      let packageValue: string | null = null

      if (matchedFile) {
        try {
          packageValue = await blobToDataUrl(matchedFile)
        } catch (error) {
          console.warn('无法序列化导入文件为数据 URL', error)
        }
      }

      if (!packageValue && assetId) {
        const cacheEntry = assetCacheStore.getEntry(assetId)
        if (cacheEntry?.blob) {
          try {
            packageValue = await blobToDataUrl(cacheEntry.blob)
          } catch (error) {
            console.warn('无法序列化缓存资源为数据 URL', error)
          }
        }
      }

      const packageKey = `local::${registeredAsset.id}`
      const resolvedValue = packageValue ?? registeredAsset.downloadUrl ?? registeredAsset.id

      sceneStore.$patch((state) => {
        state.packageAssetMap = {
          ...state.packageAssetMap,
          [packageKey]: resolvedValue,
        }
        state.assetIndex = {
          ...state.assetIndex,
          [registeredAsset.id]: {
            categoryId,
            source: { type: 'local' },
          },
        }
      })
    }

    const displayName = registeredAsset?.name ?? imported.name ?? matchedFile?.name ?? 'Imported Asset'

    uiStore.updateLoadingOverlay({
      message: `${displayName}导入完成`,
      progress: 100,
    })
    uiStore.updateLoadingProgress(100)
  })

  loader.addEventListener('progress', (payload: LoaderProgressPayload) => {
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
  const selectedNode = sceneStore.selectedNode
  let parentId = selectedNode && !selectedNode.isPlaceholder ? selectedNode.id : null
  if (parentId && !sceneStore.nodeAllowsChildCreation(parentId)) {
    parentId = null
  }
  const spawnPosition = computeGroupSpawnPosition(parentId)
  sceneStore.addSceneNode({
    nodeType: 'Group',
    object: group,
    name: groupName,
    ...(spawnPosition ? { position: spawnPosition } : {}),
    parentId: parentId ?? undefined,
  })
}

function computeGroupSpawnPosition(parentId: string | null): Vector3Like | null {
  if (parentId) {
    return { x: 0, y: 0, z: 0 }
  }
  const camera = sceneStore.camera
  if (!camera) {
    return null
  }

  tempGroupCameraPosition.set(camera.position.x, camera.position.y, camera.position.z)
  tempGroupCameraTarget.set(camera.target.x, camera.target.y, camera.target.z)

  if (camera.forward) {
    tempGroupDirection.set(camera.forward.x, camera.forward.y, camera.forward.z)
  } else {
    tempGroupDirection.copy(tempGroupCameraTarget).sub(tempGroupCameraPosition)
  }

  if (tempGroupDirection.lengthSq() < 1e-6) {
    tempGroupDirection.set(0, 0, -1)
  }

  if (Math.abs(tempGroupDirection.y) > 0.95) {
    tempGroupDirection.y = 0
    if (tempGroupDirection.lengthSq() < 1e-6) {
      tempGroupDirection.set(0, 0, -1)
    }
  }

  tempGroupDirection.normalize()
  tempGroupSpawn.copy(tempGroupCameraPosition).addScaledVector(tempGroupDirection, GROUP_SPAWN_DISTANCE)
  tempGroupSpawn.y = tempGroupCameraTarget.y

  return {
    x: tempGroupSpawn.x,
    y: tempGroupSpawn.y,
    z: tempGroupSpawn.z,
  }
}

function collectNodeNames(nodes: SceneNode[] | undefined, bucket: Set<string>) {
  if (!nodes?.length) {
    return
  }
  nodes.forEach((node) => {
    if (node.name) {
      bucket.add(node.name)
    }
    if (node.children?.length) {
      collectNodeNames(node.children, bucket)
    }
  })
}

function composeNodeMatrix(node: SceneNode): THREE.Matrix4 {
  const position = new THREE.Vector3(node.position.x, node.position.y, node.position.z)
  const rotation = new THREE.Euler(node.rotation.x, node.rotation.y, node.rotation.z, 'XYZ')
  const quaternion = new THREE.Quaternion().setFromEuler(rotation)
  const scale = new THREE.Vector3(node.scale.x, node.scale.y, node.scale.z)
  return new THREE.Matrix4().compose(position, quaternion, scale)
}

function computeWorldMatrixForNode(nodes: SceneNode[] | undefined, targetId: string): THREE.Matrix4 | null {
  if (!nodes?.length) {
    return null
  }

  const traverse = (list: SceneNode[], parentMatrix: THREE.Matrix4): THREE.Matrix4 | null => {
    for (const node of list) {
      const localMatrix = composeNodeMatrix(node)
      const worldMatrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, localMatrix)
      if (node.id === targetId) {
        return worldMatrix
      }
      if (node.children?.length) {
        const nested = traverse(node.children, worldMatrix)
        if (nested) {
          return nested
        }
      }
    }
    return null
  }

  return traverse(nodes, new THREE.Matrix4())
}

function getNextEmptyName(): string {
  const names = new Set<string>()
  collectNodeNames(sceneStore.nodes, names)
  if (!names.has('Empty')) {
    return 'Empty'
  }
  let index = 1
  while (names.has(`Empty ${index}`)) {
    index += 1
  }
  return `Empty ${index}`
}

function getNextViewPointName(): string {
  const names = new Set<string>()
  collectNodeNames(sceneStore.nodes, names)
  const base = 'View Point'
  if (!names.has(base)) {
    return base
  }
  let index = 1
  while (names.has(`${base} ${index}`)) {
    index += 1
  }
  return `${base} ${index}`
}

function getNextGuideboardName(): string {
  const names = new Set<string>()
  collectNodeNames(sceneStore.nodes, names)
  const base = 'Guideboard'
  if (!names.has(base)) {
    return base
  }
  let index = 1
  while (names.has(`${base} ${index}`)) {
    index += 1
  }
  return `${base} ${index}`
}

function getNextDisplayBoardName(): string {
  const names = new Set<string>()
  collectNodeNames(sceneStore.nodes, names)
  const base = 'Display Board'
  if (!names.has(base)) {
    return base
  }
  let index = 1
  while (names.has(`${base} ${index}`)) {
    index += 1
  }
  return `${base} ${index}`
}

function getNextWarpGateName(): string {
  const names = new Set<string>()
  collectNodeNames(sceneStore.nodes, names)
  const base = 'Warp Gate'
  if (!names.has(base)) {
    return base
  }
  let index = 1
  while (names.has(`${base} ${index}`)) {
    index += 1
  }
  return `${base} ${index}`
}

function resolveSelectedSceneNode(): SceneNode | null {
  const candidate = sceneStore.selectedNode
  if (!candidate || candidate.isPlaceholder) {
    return null
  }
  return candidate
}

function resolveTargetParentNode(parentId?: string | null): SceneNode | null {
  if (typeof parentId === 'string' && parentId.trim().length) {
    const located = findNodeWithParent(sceneStore.nodes, parentId)
    if (located?.node) {
      if (sceneStore.nodeAllowsChildCreation(located.node.id)) {
        return located.node
      }
      return null
    }
  }
  const selected = resolveSelectedSceneNode()
  if (selected && !sceneStore.nodeAllowsChildCreation(selected.id)) {
    return null
  }
  return selected
}

const canCreateShowcaseNodes = computed(() => Boolean(resolveSelectedSceneNode()))

function ensureBehaviorComponent(nodeId: string): SceneNodeComponentState<BehaviorComponentProps> | null {
  let behaviorComponent = findNodeWithParent(sceneStore.nodes, nodeId)?.node.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<BehaviorComponentProps>
    | undefined
  if (!behaviorComponent) {
    const created = sceneStore.addNodeComponent(nodeId, BEHAVIOR_COMPONENT_TYPE) as
      | SceneNodeComponentState<BehaviorComponentProps>
      | null
    if (created) {
      behaviorComponent = created as unknown as SceneNodeComponentState<BehaviorComponentProps>
    } else {
      const refreshed = findNodeWithParent(sceneStore.nodes, nodeId)
      behaviorComponent = refreshed?.node.components?.[BEHAVIOR_COMPONENT_TYPE] as
        | SceneNodeComponentState<BehaviorComponentProps>
        | undefined
    }
  }
  return behaviorComponent ?? null
}

function computeViewPointWorldPosition(parent: SceneNode, radius: number): THREE.Vector3 | null {
  const runtime = getRuntimeObject(parent.id)
  if (runtime) {
    runtime.updateMatrixWorld(true)
    tempViewPointBox.makeEmpty()
    tempViewPointBox.setFromObject(runtime)

    const center = tempViewPointBox.isEmpty()
      ? runtime.getWorldPosition(tempViewPointVecA)
      : tempViewPointBox.getCenter(tempViewPointVecA)

    const quaternion = runtime.getWorldQuaternion(tempViewPointQuat)
    const direction = tempViewPointVecB.set(1, 0, 0).applyQuaternion(quaternion)
    if (direction.lengthSq() < 1e-6) {
      direction.set(1, 0, 0)
    }
    direction.normalize()

    let distance = VIEW_POINT_DEFAULT_OFFSET
    if (!tempViewPointBox.isEmpty()) {
      const farthestPoint = tempViewPointVecC.set(
        direction.x >= 0 ? tempViewPointBox.max.x : tempViewPointBox.min.x,
        direction.y >= 0 ? tempViewPointBox.max.y : tempViewPointBox.min.y,
        direction.z >= 0 ? tempViewPointBox.max.z : tempViewPointBox.min.z,
      )
      const projectedCenter = center.dot(direction)
      const projectedSurface = farthestPoint.dot(direction)
      const distanceToSurface = Math.max(projectedSurface - projectedCenter, 0)
      distance = Math.max(distanceToSurface + radius + VIEW_POINT_EDGE_MARGIN, VIEW_POINT_MIN_DISTANCE)
    } else {
      distance = Math.max(distance, VIEW_POINT_MIN_DISTANCE)
    }

    const spawn = center.clone().add(tempViewPointVecC.copy(direction).multiplyScalar(distance))
    spawn.y = center.y
    return spawn
  }

  const matrix = computeWorldMatrixForNode(sceneStore.nodes, parent.id)
  if (!matrix) {
    return null
  }

  const position = new THREE.Vector3().setFromMatrixPosition(matrix)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix)
  const direction = tempViewPointVecB.set(1, 0, 0).applyQuaternion(quaternion)
  if (direction.lengthSq() < 1e-6) {
    direction.set(1, 0, 0)
  }
  direction.normalize()

  const spawn = position.clone().add(tempViewPointVecC.copy(direction).multiplyScalar(VIEW_POINT_DEFAULT_OFFSET))
  spawn.y = position.y
  return spawn
}

function findNodeWithParent(
  nodes: SceneNode[] | undefined,
  nodeId: string,
  parent: SceneNode | null = null,
): { node: SceneNode; parent: SceneNode | null } | null {
  if (!nodes?.length) {
    return null
  }
  for (const candidate of nodes) {
    if (!candidate) {
      continue
    }
    if (candidate.id === nodeId) {
      return { node: candidate, parent }
    }
    if (candidate.children?.length) {
      const nested = findNodeWithParent(candidate.children, nodeId, candidate)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

function isViewPointNodeCandidate(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  const component = node.components?.[VIEW_POINT_COMPONENT_TYPE] as
    | SceneNodeComponentState<ViewPointComponentProps>
    | undefined
  if (component?.enabled) {
    return true
  }
  const flags = node.editorFlags ?? {}
  return node.nodeType === 'Sphere' && Boolean(flags.editorOnly) && Boolean(flags.ignoreGridSnapping)
}

function findFirstViewPointUnderParent(parent: SceneNode | null, excludeNodeId?: string): SceneNode | null {
  const container = parent?.children ?? sceneStore.nodes
  if (!container?.length) {
    return null
  }
  return container.find((child) => child && child.id !== excludeNodeId && isViewPointNodeCandidate(child)) ?? null
}

function isGuideboardNodeCandidate(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  const component = node.components?.[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined
  return Boolean(component?.enabled)
}

function findFirstGuideboardUnderParent(parent: SceneNode | null): SceneNode | null {
  const container = parent?.children ?? sceneStore.nodes
  if (!container?.length) {
    return null
  }
  return container.find((child) => child && isGuideboardNodeCandidate(child)) ?? null
}

function initializeGuideboardBehavior(nodeId: string, nodeName: string): void {
  const located = findNodeWithParent(sceneStore.nodes, nodeId)
  if (!located) {
    return
  }

  let behaviorComponent = located.node.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<BehaviorComponentProps>
    | undefined

  if (!behaviorComponent) {
    const created = sceneStore.addNodeComponent(nodeId, BEHAVIOR_COMPONENT_TYPE) as
      | SceneNodeComponentState<BehaviorComponentProps>
      | null
    if (!created) {
      return
    }
    const refreshed = findNodeWithParent(sceneStore.nodes, nodeId)
    behaviorComponent = refreshed?.node.components?.[BEHAVIOR_COMPONENT_TYPE] as
      | SceneNodeComponentState<BehaviorComponentProps>
      | undefined
  }

  if (!behaviorComponent) {
    return
  }

  const props = behaviorComponent.props as BehaviorComponentProps | undefined
  const existingSource = Array.isArray(props?.behaviors) ? props.behaviors : []
  const currentList = cloneBehaviorList(existingSource)
  const nextList = currentList.filter((entry): entry is SceneBehavior => Boolean(entry) && entry.action !== 'click')

  const currentMetadata = (behaviorComponent.metadata as Record<string, unknown> | undefined) ?? {}
  const initialMap = normalizeNamedBehaviorSequenceMap(currentMetadata[NAMED_BEHAVIOR_SEQUENCES_KEY])
  const namedResult = upsertNamedBehaviorSequence(initialMap, nodeName, 'click')
  const sequenceId = namedResult.entry.sequenceId

  const script = ensureBehaviorParams({
    type: 'lantern',
    params: {},
  } as SceneBehaviorScriptBinding)

  const behavior: SceneBehavior = {
    id: generateUuid(),
    name: nodeName,
    action: 'click',
    sequenceId,
    script,
  }

  nextList.push(behavior)
  sceneStore.updateNodeComponentProps(nodeId, behaviorComponent.id, { behaviors: nextList })

  if (namedResult.map !== initialMap) {
    const nextMetadata: Record<string, unknown> = {
      ...currentMetadata,
      [NAMED_BEHAVIOR_SEQUENCES_KEY]: namedResult.map,
    }
    sceneStore.updateNodeComponentMetadata(nodeId, behaviorComponent.id, nextMetadata)
  }
}

function initializeViewPointBehavior(nodeId: string): void {
  const located = findNodeWithParent(sceneStore.nodes, nodeId)
  if (!located) {
    return
  }

  let behaviorComponent = located.node.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<BehaviorComponentProps>
    | undefined

  if (!behaviorComponent) {
    const created = sceneStore.addNodeComponent(nodeId, BEHAVIOR_COMPONENT_TYPE) as
      | SceneNodeComponentState<BehaviorComponentProps>
      | null
    if (!created) {
      return
    }
    const refreshed = findNodeWithParent(sceneStore.nodes, nodeId)
    behaviorComponent = refreshed?.node.components?.[BEHAVIOR_COMPONENT_TYPE] as
      | SceneNodeComponentState<BehaviorComponentProps>
      | undefined
  }

  if (!behaviorComponent) {
    return
  }

  const parent = located.parent
  const guideboardNode = findFirstGuideboardUnderParent(parent)

  const props = behaviorComponent.props as BehaviorComponentProps | undefined
  const behaviorListRaw = Array.isArray(props?.behaviors) ? props.behaviors : []
  const behaviorList = behaviorListRaw.filter((entry): entry is SceneBehavior => Boolean(entry))
  const normalizedShowName = VIEW_POINT_SHOW_BEHAVIOR_NAME.trim().toLowerCase()
  const normalizedHideName = VIEW_POINT_HIDE_BEHAVIOR_NAME.trim().toLowerCase()
  const existingShow = behaviorList.find(
    (entry) =>
      entry.action === 'perform' &&
      (entry.name?.trim().toLowerCase() ?? '') === normalizedShowName,
  )
  const existingHide = behaviorList.find(
    (entry) =>
      entry.action === 'perform' &&
      (entry.name?.trim().toLowerCase() ?? '') === normalizedHideName,
  )

  const nextList = cloneBehaviorList(behaviorList).filter((entry) => {
    const normalized = entry.name?.trim().toLowerCase() ?? ''
    if (entry.action === 'perform' && (normalized === normalizedShowName || normalized === normalizedHideName)) {
      return false
    }
    return true
  })

  const currentMetadata = (behaviorComponent.metadata as Record<string, unknown> | undefined) ?? {}
  const initialMap = normalizeNamedBehaviorSequenceMap(currentMetadata[NAMED_BEHAVIOR_SEQUENCES_KEY])
  let workingMap = initialMap
  let metadataChanged = false

  const showResult = upsertNamedBehaviorSequence(workingMap, VIEW_POINT_SHOW_BEHAVIOR_NAME, 'perform', {
    sequenceId: existingShow?.sequenceId,
  })
  if (showResult.map !== workingMap) {
    workingMap = showResult.map
    metadataChanged = true
  }
  let showSequenceId = showResult.entry.sequenceId
  if (existingShow?.sequenceId && existingShow.sequenceId !== showSequenceId) {
    showSequenceId = existingShow.sequenceId
    const key = showResult.entry.name.trim().toLowerCase()
    workingMap = {
      ...workingMap,
      [key]: {
        action: 'perform',
        name: VIEW_POINT_SHOW_BEHAVIOR_NAME,
        sequenceId: showSequenceId,
      },
    }
    metadataChanged = true
  }

  const hideResult = upsertNamedBehaviorSequence(workingMap, VIEW_POINT_HIDE_BEHAVIOR_NAME, 'perform', {
    sequenceId: existingHide?.sequenceId,
  })
  if (hideResult.map !== workingMap) {
    workingMap = hideResult.map
    metadataChanged = true
  }
  let hideSequenceId = hideResult.entry.sequenceId
  if (existingHide?.sequenceId && existingHide.sequenceId !== hideSequenceId) {
    hideSequenceId = existingHide.sequenceId
    const key = hideResult.entry.name.trim().toLowerCase()
    workingMap = {
      ...workingMap,
      [key]: {
        action: 'perform',
        name: VIEW_POINT_HIDE_BEHAVIOR_NAME,
        sequenceId: hideSequenceId,
      },
    }
    metadataChanged = true
  }

  // Ensure the view point exposes perform behaviors to toggle the sibling guideboard.
  const showBehavior: SceneBehavior = {
    id: existingShow?.id ?? generateUuid(),
    name: VIEW_POINT_SHOW_BEHAVIOR_NAME,
    action: 'perform',
    sequenceId: showSequenceId,
    script: ensureBehaviorParams({
      type: 'show',
      params: {
        targetNodeId: guideboardNode?.id ?? null,
      },
    } as SceneBehaviorScriptBinding),
  }

  const hideBehavior: SceneBehavior = {
    id: existingHide?.id ?? generateUuid(),
    name: VIEW_POINT_HIDE_BEHAVIOR_NAME,
    action: 'perform',
    sequenceId: hideSequenceId,
    script: ensureBehaviorParams({
      type: 'hide',
      params: {
        targetNodeId: guideboardNode?.id ?? null,
      },
    } as SceneBehaviorScriptBinding),
  }

  nextList.push(showBehavior, hideBehavior)
  sceneStore.updateNodeComponentProps(nodeId, behaviorComponent.id, { behaviors: nextList })

  if (metadataChanged) {
    const nextMetadata: Record<string, unknown> = {
      ...currentMetadata,
      [NAMED_BEHAVIOR_SEQUENCES_KEY]: workingMap,
    }
    sceneStore.updateNodeComponentMetadata(nodeId, behaviorComponent.id, nextMetadata)
  }
}

function initializeWarpGateBehavior(nodeId: string): void {
  const located = findNodeWithParent(sceneStore.nodes, nodeId)
  if (!located) {
    return
  }

  let activeNode = located.node
  let parent = located.parent

  const resolveViewPoint = () => findFirstViewPointUnderParent(parent, nodeId)

  let viewPointNode = resolveViewPoint()

  if (viewPointNode) {
    initializeViewPointBehavior(viewPointNode.id)
    const refreshed = findNodeWithParent(sceneStore.nodes, viewPointNode.id)
    if (refreshed) {
      viewPointNode = refreshed.node
    }
  }

  let behaviorComponent = activeNode.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<BehaviorComponentProps>
    | undefined

  if (!behaviorComponent) {
    const created = sceneStore.addNodeComponent(nodeId, BEHAVIOR_COMPONENT_TYPE) as
      | SceneNodeComponentState<BehaviorComponentProps>
      | null
    if (!created) {
      return
    }
    const refreshed = findNodeWithParent(sceneStore.nodes, nodeId)
    if (!refreshed) {
      return
    }
    activeNode = refreshed.node
    parent = refreshed.parent
    behaviorComponent = refreshed.node.components?.[BEHAVIOR_COMPONENT_TYPE] as
      | SceneNodeComponentState<BehaviorComponentProps>
      | undefined
    viewPointNode = resolveViewPoint()
  }

  if (!behaviorComponent) {
    return
  }

  const props = behaviorComponent.props as BehaviorComponentProps | undefined
  const existing = Array.isArray(props?.behaviors) ? props.behaviors : []
  if (existing.length) {
    return
  }

  const sharedTargetNode = viewPointNode ?? parent ?? null
  const sharedTargetNodeId = sharedTargetNode?.id ?? null
  const viewPointTargetNodeId = viewPointNode?.id ?? null
  let viewPointShowSequenceId: string | null = null
  let viewPointHideSequenceId: string | null = null

  if (viewPointNode) {
    const viewPointBehaviorComponent = viewPointNode.components?.[BEHAVIOR_COMPONENT_TYPE] as
      | SceneNodeComponentState<BehaviorComponentProps>
      | undefined
    const viewPointProps = viewPointBehaviorComponent?.props as BehaviorComponentProps | undefined
    const viewPointBehaviors = Array.isArray(viewPointProps?.behaviors) ? viewPointProps.behaviors : []
    const normalizedShowName = VIEW_POINT_SHOW_BEHAVIOR_NAME.trim().toLowerCase()
    const normalizedHideName = VIEW_POINT_HIDE_BEHAVIOR_NAME.trim().toLowerCase()

    viewPointBehaviors.forEach((behavior) => {
      if (behavior.action !== 'perform') {
        return
      }
      const normalizedName = behavior.name?.trim().toLowerCase() ?? ''
      if (normalizedName === normalizedShowName) {
        viewPointShowSequenceId = behavior.sequenceId
      } else if (normalizedName === normalizedHideName) {
        viewPointHideSequenceId = behavior.sequenceId
      }
    })
  }

  const parentName = parent?.name?.trim() || activeNode.name?.trim() || 'Warp Gate'

  const clickBehaviorName = `Click ${parentName}`
  const approachBehaviorName = `Approach ${parentName}`
  const departBehaviorName = `Depart ${parentName}`

  const nextBehaviors: SceneBehavior[] = existing.slice()

  const appendSequence = (
    action: 'click' | 'approach' | 'depart',
    name: string,
    scripts: SceneBehaviorScriptBinding[],
  ) => {
    const sequenceId = createBehaviorSequenceId()
    scripts.forEach((script) => {
      nextBehaviors.push({
        id: generateUuid(),
        name,
        action,
        sequenceId,
        script: ensureBehaviorParams(script),
      })
    })
  }

  appendSequence('click', clickBehaviorName, [
    {
      type: 'moveTo',
      params: {
        targetNodeId: nodeId,
        duration: 0.6,
      },
    },
    {
      type: 'watch',
      params: {
        targetNodeId: sharedTargetNodeId ?? null,
        caging: true,
      },
    },
  ])

  const approachScripts: SceneBehaviorScriptBinding[] = [
    {
      type: 'hide',
      params: {
        targetNodeId: nodeId,
      },
    },
    {
      type: 'showPurpose',
      params: {
        targetNodeId: sharedTargetNodeId ?? null,
      },
    },
    {
      type: 'trigger',
      params: {
        targetNodeId: viewPointTargetNodeId ?? null,
        sequenceId: viewPointShowSequenceId,
      },
    }
  ]


  appendSequence('approach', approachBehaviorName, approachScripts)

  const departScripts: SceneBehaviorScriptBinding[] = [
    {
      type: 'show',
      params: {
        targetNodeId: nodeId,
      },
    },
    {
      type: 'hidePurpose',
      params: {},
    },
    {
      type: 'trigger',
      params: {
        targetNodeId: viewPointTargetNodeId ?? null,
        sequenceId: viewPointHideSequenceId,
      },
    }
  ]

  appendSequence('depart', departBehaviorName, departScripts)

  sceneStore.updateNodeComponentProps(nodeId, behaviorComponent.id, { behaviors: nextBehaviors })
}

function handleCreateEmptyNode() {
  const emptyObject = new THREE.Object3D()
  const name = getNextEmptyName()
  emptyObject.name = name
  const parentCandidate = sceneStore.selectedNode
  let parentId = parentCandidate && !parentCandidate.isPlaceholder ? parentCandidate.id : null
  if (parentId && !sceneStore.nodeAllowsChildCreation(parentId)) {
    parentId = null
  }
  sceneStore.addSceneNode({
    nodeType: 'Empty',
    object: emptyObject,
    name,
    parentId,
  })
}

async function handleCreateDisplayBoardNode(): Promise<void> {
  const parent = resolveTargetParentNode()
  const resolvedParentId = parent?.id ?? null
  const name = getNextDisplayBoardName()

  const boardMesh = createPrimitiveMesh("Plane", {color: 0xffffff,doubleSided: true})
  boardMesh.name = `${name} Visual`
  boardMesh.castShadow = false
  boardMesh.receiveShadow = true
  boardMesh.userData = {
    ...(boardMesh.userData ?? {}),
    displayBoard: true,
  }

  const boardRoot = new THREE.Object3D()
  boardRoot.name = name
  boardRoot.add(boardMesh)

  const spawnPosition = new THREE.Vector3(0, -DISPLAY_BOARD_INITIAL_HEIGHT / 2 - DISPLAY_BOARD_EPSILON, 0)
  if (parent) {
    const matrix = computeWorldMatrixForNode(sceneStore.nodes, parent.id)
    if (matrix) {
      const worldPosition = new THREE.Vector3().setFromMatrixPosition(matrix)
      spawnPosition.copy(worldPosition)
      spawnPosition.y += -DISPLAY_BOARD_INITIAL_HEIGHT / 2 - DISPLAY_BOARD_EPSILON
    }
  }


  const created = await sceneStore.addModelNode({
    object: boardRoot,
    nodeType: 'Plane',
    name,
    parentId: resolvedParentId ?? undefined,
    position: spawnPosition,
    snapToGrid: false,
  })

  if (!created) {
    return
  }

  const primaryMaterial = created.materials?.[0] ?? null
  if (primaryMaterial) {
    sceneStore.updateNodeMaterialProps(created.id, primaryMaterial.id, { side: 'double' })
  }

  if (!created.components?.[DISPLAY_BOARD_COMPONENT_TYPE]) {
    sceneStore.addNodeComponent(created.id, DISPLAY_BOARD_COMPONENT_TYPE)
  }

  sceneStore.selectNode(created.id)
}

async function handleCreateViewPointNode(options: NodeCreationOptions = {}): Promise<SceneNode | null> {
  const { parentId, autoBehaviors = false } = options
  const name = getNextViewPointName()

  const markerMesh = createPrimitiveMesh('Plane',{color: VIEW_POINT_COLOR,doubleSided: true})
  markerMesh.name = `${name} Helper`
  markerMesh.castShadow = false
  markerMesh.receiveShadow = false
  markerMesh.renderOrder = 1000
  markerMesh.userData = {
    ...(markerMesh.userData ?? {}),
    editorOnly: true,
    ignoreGridSnapping: true,
    viewPoint: true,
  }

  const markerRoot = new THREE.Object3D()
  markerRoot.name = name
  markerRoot.add(markerMesh)
  markerRoot.userData = {
    ...(markerRoot.userData ?? {}),
    editorOnly: true,
    ignoreGridSnapping: true,
    viewPoint: true,
  }

  const parent = resolveTargetParentNode(parentId)
  const resolvedParentId = parent?.id

  const created = await sceneStore.addModelNode({
    object: markerRoot,
    nodeType: 'Sphere',
    name,
    baseY: 0,
    parentId: resolvedParentId,
    snapToGrid: false,
    editorFlags: {
      editorOnly: true,
      ignoreGridSnapping: true,
    },
  })

  if (created) {
    // Ensure the default material is double-sided for better visibility
    const primaryMaterial = created.materials?.[0] ?? null
    if (primaryMaterial) {
      sceneStore.updateNodeMaterialProps(created.id, primaryMaterial.id, { side: 'double' })
    }
    let viewPointComponent = created.components?.[VIEW_POINT_COMPONENT_TYPE] as
      | SceneNodeComponentState<ViewPointComponentProps>
      | undefined
    if (!viewPointComponent) {
      const added = sceneStore.addNodeComponent(created.id, VIEW_POINT_COMPONENT_TYPE)
      if (added) {
        viewPointComponent = added as unknown as SceneNodeComponentState<ViewPointComponentProps>
      }
    }
    ensureBehaviorComponent(created.id)
    if (autoBehaviors) {
      initializeViewPointBehavior(created.id)
    }
  }

  return created
}

async function handleCreateGuideboardNode(options: NodeCreationOptions = {}): Promise<SceneNode | null> {
  const { parentId, autoBehaviors = false } = options
  const name = getNextGuideboardName()
  const guideboardMesh = new THREE.Object3D()
  guideboardMesh.name = `${name} Visual`
  guideboardMesh.castShadow = false
  guideboardMesh.receiveShadow = false
  guideboardMesh.userData = {
    ...(guideboardMesh.userData ?? {}),
    ignoreGridSnapping: true,
    guideboardHelper: true,
  }

  const guideboardRoot = new THREE.Object3D()
  guideboardRoot.name = name
  guideboardRoot.add(guideboardMesh)
  guideboardRoot.userData = {
    ...(guideboardRoot.userData ?? {}),
    ignoreGridSnapping: true,
    guideboard: true,
  }

  const parent = resolveTargetParentNode(parentId)
  const resolvedParentId = parent?.id
  const siblingViewPoint = parent ? findFirstViewPointUnderParent(parent) : null

  const created = await sceneStore.addModelNode({
    object: guideboardRoot,
    nodeType: 'Guideboard',
    name,
    baseY: 0,
    parentId: resolvedParentId,
    snapToGrid: false,
    editorFlags: {
      ignoreGridSnapping: true,
    },
  })

  if (created) {
    // Ensure the default material is double-sided for better visibility
    const primaryMaterial = created.materials?.[0] ?? null
    if (primaryMaterial) {
      sceneStore.updateNodeMaterialProps(created.id, primaryMaterial.id, { side: 'double' })
    }
    let guideboardComponent = created.components?.[GUIDEBOARD_COMPONENT_TYPE] as
      | SceneNodeComponentState<GuideboardComponentProps>
      | undefined
    if (!guideboardComponent) {
      const added = sceneStore.addNodeComponent(created.id, GUIDEBOARD_COMPONENT_TYPE)
      if (added) {
        guideboardComponent = added as unknown as SceneNodeComponentState<GuideboardComponentProps>
      }
    }
    if (guideboardComponent && (guideboardComponent.props as GuideboardComponentProps | undefined)?.initiallyVisible !== false) {
      sceneStore.updateNodeComponentProps(created.id, guideboardComponent.id, { initiallyVisible: false })
    }

    ensureBehaviorComponent(created.id)
    if (autoBehaviors) {
      if (siblingViewPoint) {
        initializeViewPointBehavior(siblingViewPoint.id)
      }
      initializeGuideboardBehavior(created.id, created.name)
    }
  }

  return created
}

async function handleCreateWarpGateNode(options: NodeCreationOptions = {}): Promise<SceneNode | null> {
  const { parentId, autoBehaviors = false } = options
  const name = getNextWarpGateName()
  const warpGateMesh = new THREE.Object3D()
  warpGateMesh.name = `${name} Visual`
  warpGateMesh.castShadow = false
  warpGateMesh.receiveShadow = false
  warpGateMesh.userData = {
    ...(warpGateMesh.userData ?? {}),
    ignoreGridSnapping: true,
    warpGate: true,
  }

  const warpGateRoot = new THREE.Object3D()
  warpGateRoot.name = name
  warpGateRoot.add(warpGateMesh)
  warpGateRoot.userData = {
    ...(warpGateRoot.userData ?? {}),
    ignoreGridSnapping: true,
    warpGate: true,
  }

  const parent = resolveTargetParentNode(parentId)
  const resolvedParentId = parent?.id

  const created = await sceneStore.addModelNode({
    object: warpGateRoot,
    nodeType: 'WarpGate',
    name,
    baseY: 0,
    parentId: resolvedParentId,
    snapToGrid: false,
    editorFlags: {
      ignoreGridSnapping: true,
    },
  })

  if (created) {
    // Ensure the default material is double-sided for better visibility
    const primaryMaterial = created.materials?.[0] ?? null
    if (primaryMaterial) {
      sceneStore.updateNodeMaterialProps(created.id, primaryMaterial.id, { side: 'double' })
    }
    let warpGateComponent = created.components?.[WARP_GATE_COMPONENT_TYPE] as
      | SceneNodeComponentState<WarpGateComponentProps>
      | undefined
    if (!warpGateComponent) {
      const added = sceneStore.addNodeComponent(created.id, WARP_GATE_COMPONENT_TYPE)
      if (added) {
        warpGateComponent = added as unknown as SceneNodeComponentState<WarpGateComponentProps>
      }
    }
    ensureBehaviorComponent(created.id)
    if (autoBehaviors) {
      initializeWarpGateBehavior(created.id)
    }
  }

  return created
}

function applySelectionById(selectionId: string | null): void {
  if (selectionId) {
    sceneStore.selectNode(selectionId)
  } else {
    sceneStore.clearSelection()
  }
}

async function handleCreateShowcaseVisit(): Promise<void> {
  if (!canCreateShowcaseNodes.value) {
    return
  }
  const parentNode = resolveSelectedSceneNode()
  if (!parentNode) {
    return
  }
  const originalSelectionId = sceneStore.selectedNode?.id ?? null

  try {
    const parentId = parentNode.id
    const guideboard = await handleCreateGuideboardNode({ parentId, autoBehaviors: true })
    if (!guideboard) {
      return
    }

    const viewPoint = await handleCreateViewPointNode({ parentId, autoBehaviors: true })
    if (!viewPoint) {
      return
    }

    const warpGate = await handleCreateWarpGateNode({ parentId, autoBehaviors: true })
    if (!warpGate) {
      return
    }
  } finally {
    applySelectionById(originalSelectionId)
  }
}

async function handleAddNode(geometry: GeometryType) {
  const mesh = createPrimitiveMesh(geometry)
  const selectedNode = sceneStore.selectedNode
  const parentIsGroup = Boolean(
    selectedNode && !selectedNode.isPlaceholder && selectedNode.nodeType === 'Group'
  )
  const candidateParentId = parentIsGroup ? selectedNode?.id ?? null : null
  const parentId = candidateParentId && sceneStore.nodeAllowsChildCreation(candidateParentId)
    ? candidateParentId
    : null

  let spawnY = 0
  if (!parentIsGroup) {
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
  }

  mesh.position.set(0, 0, 0)
  mesh.updateMatrixWorld(true)

  const created = await sceneStore.addModelNode({
    object: mesh,
    nodeType: geometry,
    name: mesh.name,
    baseY: parentIsGroup ? 0 : spawnY,
    parentId: parentId ?? undefined,
  })

  if (created && parentIsGroup) {
    sceneStore.updateNodeProperties({
      id: created.id,
      position: { x: 0, y: 0, z: 0 },
    })
  }
}

function handleAddLight(type: LightNodeType) {
  sceneStore.addLightNode(type)
}

</script>

<template>
  <v-menu  transition="none">
    <template #activator="{ props }">
      <slot name="activator" :props="props">
        <v-btn icon="mdi-plus" variant="text" density="compact" v-bind="props" />
      </slot>
    </template>
    <v-list class="add-menu-list">
      <v-list-item title="Group" @click="handleAddGroup()" />
      <v-list-item title="Create Empty" @click="handleCreateEmptyNode()" />
      <v-menu  transition="none" location="end" offset="8">
        <template #activator="{ props: showcaseMenuProps }">
          <v-list-item
            title="Showcase"
            append-icon="mdi-chevron-right"
            v-bind="showcaseMenuProps"
          />
        </template>
        <v-list class="add-submenu-list">
          <v-list-item
            title="Display Board"
            @click="handleCreateDisplayBoardNode()"
          />
          <v-list-item title="Visit" @click="handleCreateShowcaseVisit()"  :disabled="!canCreateShowcaseNodes"/>
          <v-divider />
          <v-list-item title="Guideboard" @click="handleCreateGuideboardNode()" />
          <v-list-item title="View Point" @click="handleCreateViewPointNode()" />
          <v-list-item title="Warp Gate" @click="handleCreateWarpGateNode()" />
        </v-list>
      </v-menu>
      <v-menu  transition="none" location="end" offset="8">
        <template #activator="{ props: lightMenuProps }">
          <v-list-item title="Light" append-icon="mdi-chevron-right" v-bind="lightMenuProps" />
        </template>
        <v-list class="add-submenu-list">
          <v-list-item title="Directional Light" @click="handleAddLight('Directional')" />
          <v-list-item title="Point Light" @click="handleAddLight('Point')" />
          <v-list-item title="Spot Light" @click="handleAddLight('Spot')" />
        </v-list>
      </v-menu>
      <v-menu  transition="none" location="end" offset="8">
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
