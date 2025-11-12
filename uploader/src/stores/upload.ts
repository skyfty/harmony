import { ref, computed, reactive } from 'vue'
import { defineStore } from 'pinia'
import { AssetTypes, DEFAULT_ASSET_TYPE, normalizeAssetType } from '@harmony/schema/asset-types'
import type { AssetTag, AssetType, ManagedAsset } from '@/types'
import { createAssetTags, listAssetTags, uploadAsset } from '@/api/modules/resources'

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'error' | 'canceled'

export type UploadPreviewKind = 'none' | 'image' | 'text' | 'model'

export interface UploadTaskPreview {
  kind: UploadPreviewKind
  url?: string
  text?: string
}

export interface UploadTask {
  id: string
  file: File
  name: string
  description: string
  type: AssetType
  size: number
  status: UploadStatus
  progress: number
  tags: AssetTag[]
  error?: string | null
  asset?: ManagedAsset | null
  preview: UploadTaskPreview
  createdAt: number
  updatedAt: number
}

export interface CreateTaskOptions {
  rehydrate?: boolean
}

const PREVIEW_TEXT_LIMIT = 100
const controllerMap = new Map<string, AbortController>()
const objectUrlMap = new Map<string, string>()

const MODEL_EXTENSIONS = new Set([
  '3ds',
  '3mf',
  'amf',
  'dae',
  'drc',
  'fbx',
  'glb',
  'gltf',
  'kmz',
  'ldr',
  'mpd',
  'md2',
  'obj',
  'pcd',
  'ply',
  'stl',
  'svg',
  'vox',
  'vtk',
  'vtp',
  'wrl',
  'xyz',
  'prefab',
])

const IMAGE_MIME_PREFIX = 'image/'
const TEXT_MIME_PREFIX = 'text/'

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'glsl', 'frag', 'vert', 'shader', 'csv'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tga', 'tif', 'tiff', 'svg'])

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function extractExtension(file: File): string {
  const name = file.name ?? ''
  const parts = name.split('.')
  if (parts.length < 2) {
    return ''
  }
  return parts.pop()?.toLowerCase() ?? ''
}

function inferAssetType(file: File): AssetType {
  const mime = file.type ?? ''
  const extension = extractExtension(file)
  if (mime.startsWith(IMAGE_MIME_PREFIX) || IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }
  if (TEXT_EXTENSIONS.has(extension) || mime.startsWith(TEXT_MIME_PREFIX)) {
    return 'file'
  }
  if (MODEL_EXTENSIONS.has(extension)) {
    return 'model'
  }
  if (extension === 'prefab') {
    return 'prefab'
  }
  return DEFAULT_ASSET_TYPE
}

function releaseObjectUrl(taskId: string): void {
  const url = objectUrlMap.get(taskId)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrlMap.delete(taskId)
  }
}

async function buildPreview(task: UploadTask): Promise<UploadTaskPreview> {
  releaseObjectUrl(task.id)
  const type = task.type
  if (type === 'image' || task.file.type.startsWith(IMAGE_MIME_PREFIX) || IMAGE_EXTENSIONS.has(extractExtension(task.file))) {
    const url = URL.createObjectURL(task.file)
    objectUrlMap.set(task.id, url)
    return { kind: 'image', url }
  }
  if (
    type === 'model' ||
    type === 'mesh' ||
    MODEL_EXTENSIONS.has(extractExtension(task.file))
  ) {
    return { kind: 'model' }
  }
  if (task.file.type.startsWith(TEXT_MIME_PREFIX) || TEXT_EXTENSIONS.has(extractExtension(task.file))) {
    const text = await task.file.text().catch(() => '')
    if (text) {
      return { kind: 'text', text: text.slice(0, PREVIEW_TEXT_LIMIT) }
    }
  }
  return { kind: 'none' }
}

function applyPreview(task: UploadTask, preview: UploadTaskPreview): void {
  task.preview.kind = preview.kind
  task.preview.url = preview.kind === 'image' ? preview.url : undefined
  task.preview.text = preview.kind === 'text' ? preview.text : undefined
}

function mapTagByName(tags: AssetTag[]): Map<string, AssetTag> {
  const map = new Map<string, AssetTag>()
  tags.forEach((tag) => {
    map.set(tag.name.trim().toLowerCase(), tag)
  })
  return map
}

export const useUploadStore = defineStore('uploader-upload', () => {
  const tasks = ref<UploadTask[]>([])
  const activeTaskId = ref<string | null>(null)
  const availableTags = ref<AssetTag[]>([])
  const loadingTags = ref(false)

  const assetTypeOptions = computed(() =>
    AssetTypes.map((type) => ({
      value: type as AssetType,
      label:
        {
          model: '模型',
          mesh: '网格',
          image: '图片',
          texture: '纹理',
          material: '材质',
          prefab: 'Prefab',
          video: '视频',
          file: '文件',
        }[type] ?? type,
    })),
  )

  const activeTask = computed(() => tasks.value.find((task) => task.id === activeTaskId.value) ?? null)

  async function ensureTagsLoaded(): Promise<void> {
    if (loadingTags.value) {
      return
    }
    loadingTags.value = true
    try {
      const tags = await listAssetTags()
      availableTags.value = tags
    } finally {
      loadingTags.value = false
    }
  }

  async function createMissingTags(values: Array<string | AssetTag>): Promise<AssetTag[]> {
    const strings = values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    if (!strings.length) {
      return []
    }

    const existingMap = mapTagByName(availableTags.value)
    const pending = strings.filter((name) => !existingMap.has(name.toLowerCase()))
    if (!pending.length) {
      return strings
        .map((name) => existingMap.get(name.toLowerCase()))
        .filter((tag): tag is AssetTag => Boolean(tag))
    }

    const created = await createAssetTags(pending)
    availableTags.value = [...availableTags.value, ...created]
    return strings
      .map((name) => {
        const normalized = name.toLowerCase()
        return availableTags.value.find((tag) => tag.name.trim().toLowerCase() === normalized) ?? null
      })
      .filter((tag): tag is AssetTag => Boolean(tag))
  }

  function findTask(id: string): UploadTask {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) {
      throw new Error(`Task ${id} not found`)
    }
    return task
  }

  async function refreshPreview(id: string): Promise<void> {
    const task = findTask(id)
    const preview = await buildPreview(task)
    applyPreview(task, preview)
    task.updatedAt = Date.now()
  }

  async function addFiles(files: File[]): Promise<void> {
    if (!files.length) {
      return
    }
    await ensureTagsLoaded().catch((error) => console.warn('[uploader] failed to preload tags', error))

    files.forEach((file) => {
      const id = generateId()
      const inferredType = inferAssetType(file)
      const task = reactive<UploadTask>({
        id,
        file,
        name: file.name.replace(/\.[^.]+$/, '') || file.name,
        description: '',
        type: inferredType,
        size: file.size,
        status: 'pending',
        progress: 0,
        tags: [],
        error: null,
        asset: null,
        preview: {
          kind: 'none',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }) as UploadTask
      tasks.value.push(task)
      activeTaskId.value = id
      void buildPreview(task).then((preview) => {
        applyPreview(task, preview)
        task.updatedAt = Date.now()
      })
    })
  }

  function setActiveTask(id: string | null): void {
    activeTaskId.value = id
  }

  function updateTaskTags(id: string, values: Array<AssetTag | string>): void {
    const task = findTask(id)
    const resolved: AssetTag[] = []
    values.forEach((value) => {
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        const matched = availableTags.value.find((tag) => tag.name.trim().toLowerCase() === normalized)
        if (matched) {
          resolved.push(matched)
        }
      } else {
        resolved.push(value)
      }
    })
    task.tags = resolved
    task.updatedAt = Date.now()
  }

  async function syncTagValues(id: string, values: Array<AssetTag | string>): Promise<void> {
    const created = await createMissingTags(values)
    updateTaskTags(id, [...values.filter((value): value is AssetTag => typeof value !== 'string'), ...created])
  }

  async function startUpload(id: string): Promise<void> {
    const task = findTask(id)
    if (task.status === 'uploading') {
      return
    }
    const controller = new AbortController()
    controllerMap.set(id, controller)
    task.status = 'uploading'
    task.progress = 0
    task.error = null
    task.updatedAt = Date.now()

    const formData = new FormData()
    formData.append('file', task.file, task.file.name)
    formData.append('name', task.name)
    formData.append('type', normalizeAssetType(task.type))
    if (task.description) {
      formData.append('description', task.description)
    }
    task.tags.forEach((tag) => formData.append('tagIds', tag.id))

    try {
      const asset = await uploadAsset(formData, {
        signal: controller.signal,
        onUploadProgress: (event) => {
          if (event.total && event.total > 0) {
            task.progress = Math.round((event.loaded / event.total) * 100)
          } else if (event.loaded) {
            // Approximate progress when total is missing
            task.progress = Math.min(99, Math.max(task.progress, 10))
          }
        },
      })
      task.asset = asset
      task.status = 'success'
      task.progress = 100
    } catch (error) {
      if (controller.signal.aborted) {
        task.status = 'canceled'
        task.progress = 0
      } else {
        task.status = 'error'
        task.error = error instanceof Error ? error.message : '上传失败'
      }
    } finally {
      controllerMap.delete(id)
      task.updatedAt = Date.now()
    }
  }

  function cancelUpload(id: string): void {
    const controller = controllerMap.get(id)
    if (controller) {
      controller.abort()
      controllerMap.delete(id)
    }
    const task = tasks.value.find((item) => item.id === id)
    if (task && task.status === 'uploading') {
      task.status = 'canceled'
      task.progress = 0
      task.updatedAt = Date.now()
    }
  }

  function removeTask(id: string): void {
    const index = tasks.value.findIndex((task) => task.id === id)
    if (index === -1) {
      return
    }
    cancelUpload(id)
    releaseObjectUrl(id)
    tasks.value.splice(index, 1)
    if (activeTaskId.value === id) {
      const nextTask = tasks.value[index] ?? tasks.value[index - 1] ?? null
      activeTaskId.value = nextTask?.id ?? null
    }
  }

  return {
    tasks,
    activeTaskId,
    activeTask,
    availableTags,
    assetTypeOptions,
    addFiles,
    setActiveTask,
    ensureTagsLoaded,
    syncTagValues,
    updateTaskTags,
    refreshPreview,
    startUpload,
    cancelUpload,
    removeTask,
    loadingTags,
  }
})
