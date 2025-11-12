import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { AssetType, ManagedAsset } from '@/types'
import { uploadAsset } from '@/api/modules/resources'

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'error' | 'canceled'

export interface UploadTask {
  id: string
  file: File
  name: string
  description: string
  type: AssetType
  tagIds: string[]
  status: UploadStatus
  progress: number
  errorMessage: string | null
  asset?: ManagedAsset
  controller: AbortController | null
  createdAt: number
}

export interface UseUploadManager {
  tasks: Ref<UploadTask[]>
  activeTaskId: Ref<string | null>
  addFiles: (files: FileList | File[]) => string[]
  setActiveTask: (taskId: string | null) => void
  startUpload: (taskId: string) => Promise<void>
  cancelUpload: (taskId: string) => void
  removeTask: (taskId: string) => void
  resetTask: (taskId: string) => void
  inProgressCount: Ref<number>
}

function guessAssetType(file: File): AssetType {
  const name = file.name.toLowerCase()
  const extension = name.split('.').pop() ?? ''
  switch (extension) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'webp':
    case 'svg':
      return 'image'
    case 'ktx':
    case 'ktx2':
    case 'dds':
      return 'texture'
    case 'mat':
    case 'material':
      return 'material'
    case 'fbx':
    case 'obj':
    case 'gltf':
    case 'glb':
    case 'stl':
      return 'model'
    case 'mesh':
      return 'mesh'
    case 'prefab':
      return 'prefab'
    case 'mp4':
    case 'mov':
    case 'webm':
      return 'video'
    default:
      return 'file'
  }
}

function createTaskFromFile(file: File): UploadTask {
  const defaultName = file.name.replace(/\.[^.]+$/, '')
  const generatedId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return {
    id: generatedId,
    file,
    name: defaultName,
    description: '',
    type: guessAssetType(file),
    tagIds: [],
    status: 'pending',
    progress: 0,
    errorMessage: null,
    controller: null,
    createdAt: Date.now(),
  }
}

function extractErrorMessage(error: unknown): string {
  if (!error) {
    return '上传失败，请稍后重试'
  }
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message || '上传失败'
  }
  if (typeof error === 'object') {
    const maybeAxios = error as { response?: { data?: unknown; status?: number }; message?: string }
    const serverMessage = (() => {
      if (maybeAxios.response?.data && typeof maybeAxios.response.data === 'object') {
        const data = maybeAxios.response.data as Record<string, unknown>
        if (typeof data.message === 'string') {
          return data.message
        }
        if (typeof data.error === 'string') {
          return data.error
        }
      }
      return null
    })()
    if (serverMessage) {
      return serverMessage
    }
    if (typeof maybeAxios.message === 'string') {
      return maybeAxios.message
    }
  }
  return '上传失败，请检查网络后重试'
}

export function useUploadManager(): UseUploadManager {
  const tasks = ref<UploadTask[]>([])
  const activeTaskId = ref<string | null>(null)

  function ensureActiveTask(): void {
    if (tasks.value.length === 0) {
      activeTaskId.value = null
      return
    }
  if (!activeTaskId.value || !tasks.value.some((task: UploadTask) => task.id === activeTaskId.value)) {
      activeTaskId.value = tasks.value[0].id
    }
  }

  function addFiles(files: FileList | File[]): string[] {
    const fileArray = Array.isArray(files) ? files : Array.from(files ?? [])
    const createdIds: string[] = []
    if (!fileArray.length) {
      return createdIds
    }
    const nextTasks = [...tasks.value]
  fileArray.forEach((file: File) => {
      const task = createTaskFromFile(file)
      nextTasks.push(task)
      createdIds.push(task.id)
    })
    tasks.value = nextTasks
    activeTaskId.value = createdIds[createdIds.length - 1] ?? activeTaskId.value
    return createdIds
  }

  function setActiveTask(taskId: string | null): void {
    activeTaskId.value = taskId
  }

  async function startUpload(taskId: string): Promise<void> {
  const task = tasks.value.find((item: UploadTask) => item.id === taskId)
    if (!task) {
      return
    }
    if (task.status === 'uploading') {
      return
    }
    if (task.status === 'success') {
      return
    }
    task.status = 'uploading'
    task.progress = 0
    task.errorMessage = null
    const controller = new AbortController()
    task.controller = controller
    try {
      const response = await uploadAsset(
        {
          file: task.file,
          name: task.name,
          description: task.description,
          type: task.type,
          tagIds: task.tagIds,
        },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            task.progress = Math.round(progress * 100)
          },
        },
      )
      task.status = 'success'
      task.progress = 100
      task.asset = response.asset
    } catch (error) {
      if (controller.signal.aborted) {
        task.status = 'canceled'
        task.progress = 0
        task.errorMessage = null
      } else {
        task.status = 'error'
        task.errorMessage = extractErrorMessage(error)
      }
    } finally {
      task.controller = null
    }
  }

  function cancelUpload(taskId: string): void {
  const task = tasks.value.find((item: UploadTask) => item.id === taskId)
    if (!task) {
      return
    }
    if (task.controller) {
      task.controller.abort()
    }
    if (task.status === 'uploading') {
      task.status = 'canceled'
      task.progress = 0
    }
  }

  function removeTask(taskId: string): void {
  tasks.value = tasks.value.filter((task: UploadTask) => task.id !== taskId)
    ensureActiveTask()
  }

  function resetTask(taskId: string): void {
  const task = tasks.value.find((item: UploadTask) => item.id === taskId)
    if (!task) {
      return
    }
    if (task.controller) {
      task.controller.abort()
    }
    task.status = 'pending'
    task.progress = 0
    task.errorMessage = null
    task.asset = undefined
  }

  const inProgressCount = computed(() => tasks.value.filter((task: UploadTask) => task.status === 'uploading').length)

  return {
    tasks,
    activeTaskId,
    addFiles,
    setActiveTask,
    startUpload,
    cancelUpload,
    removeTask,
    resetTask,
    inProgressCount,
  }
}
