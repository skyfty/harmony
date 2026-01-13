import { defineStore } from 'pinia'
import type { Project, ProjectSceneMeta } from '@schema/index'
import { toRaw, watch } from 'vue'
import type { WatchStopHandle } from 'vue'
import type { SessionUser } from '@/types/auth'
import { useAuthStore } from '@/stores/authStore'
import { buildServerApiUrl } from '@/api/serverApiConfig'
import type { ProjectSummary } from '@/types/project-summary'
import { useScenesStore } from '@/stores/scenesStore'
import { generateUuid } from '@/utils/uuid'

export type ProjectWorkspaceType = 'local' | 'user'

interface ProjectWorkspaceDescriptor {
  id: string
  type: ProjectWorkspaceType
  label: string
  userId: string | null
  username: string | null
}

interface ProjectsState {
  metadata: ProjectSummary[]
  initialized: boolean
  initializing: boolean
  error: string | null
  workspaceId: string
  workspaceType: ProjectWorkspaceType
  workspaceLabel: string
  workspaceUserId: string | null
  workspaceUsername: string | null
  workspaceRevision: number
  activeProjectId: string | null
}

const LOCAL_WORKSPACE_DESCRIPTOR: ProjectWorkspaceDescriptor = {
  id: 'local',
  type: 'local',
  label: '本地用户',
  userId: null,
  username: null,
}

const USER_PROJECT_API_PREFIX = '/api/user-projects'

function resolveWorkspaceDescriptor(user: SessionUser | null | undefined): ProjectWorkspaceDescriptor {
  if (!user) {
    return { ...LOCAL_WORKSPACE_DESCRIPTOR }
  }
  const labelCandidate = user.displayName?.trim() || user.username?.trim()
  return {
    id: user.id,
    type: 'user',
    label: labelCandidate && labelCandidate.length ? labelCandidate : `用户 ${user.username}`,
    userId: user.id,
    username: user.username ?? null,
  }
}

const DB_NAME = 'harmony-editor-projects'
const DB_VERSION = 1
const STORE_METADATA = 'projectMetadata'
const STORE_DOCUMENTS = 'projectDocuments'

const memoryWorkspaceDocuments = new Map<string, Map<string, Project>>()
const workspaceDbPromises = new Map<string, Promise<IDBDatabase>>()
const workspaceDbInstances = new Map<string, IDBDatabase>()

let authWatcherStop: WatchStopHandle | null = null
let initializationPromise: Promise<void> | null = null

function getMemoryWorkspace(workspaceId: string): Map<string, Project> {
  let bucket = memoryWorkspaceDocuments.get(workspaceId)
  if (!bucket) {
    bucket = new Map()
    memoryWorkspaceDocuments.set(workspaceId, bucket)
  }
  return bucket
}

function getWorkspaceDbName(workspaceId: string): string {
  return `${DB_NAME}::${workspaceId}`
}

function cloneForIndexedDb<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T
  }
  if (value instanceof URL) {
    return new URL(value.toString()) as T
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return new DataView(value.buffer.slice(0), value.byteOffset, value.byteLength) as T
    }
    const ctor = (value as any).constructor as { new (buffer: ArrayBufferLike | ArrayLike<unknown>): any }
    return new ctor(value as any) as T
  }

  const rawObject = toRaw(value as object)
  if (seen.has(rawObject)) {
    return seen.get(rawObject)
  }

  if (rawObject instanceof Map) {
    const clone = new Map()
    seen.set(rawObject, clone)
    rawObject.forEach((mapValue, mapKey) => {
      clone.set(mapKey, cloneForIndexedDb(mapValue, seen))
    })
    return clone as unknown as T
  }

  if (rawObject instanceof Set) {
    const clone = new Set()
    seen.set(rawObject, clone)
    rawObject.forEach((setValue) => {
      clone.add(cloneForIndexedDb(setValue, seen))
    })
    return clone as unknown as T
  }

  if (Array.isArray(rawObject)) {
    const clone: unknown[] = []
    seen.set(rawObject, clone)
    rawObject.forEach((item) => {
      clone.push(cloneForIndexedDb(item, seen))
    })
    return clone as T
  }

  const clone: Record<string, unknown> = {}
  seen.set(rawObject, clone)
  Object.keys(rawObject).forEach((key) => {
    clone[key] = cloneForIndexedDb((rawObject as Record<string, unknown>)[key], seen)
  })
  return clone as T
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function openDatabase(workspaceId: string): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'))
  }
  const dbName = getWorkspaceDbName(workspaceId)
  if (!workspaceDbPromises.has(dbName)) {
    workspaceDbPromises.set(
      dbName,
      new Promise((resolve, reject) => {
        const request = window.indexedDB.open(dbName, DB_VERSION)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_METADATA)) {
            db.createObjectStore(STORE_METADATA, { keyPath: 'id' })
          }
          if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
            db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' })
          }
        }
        request.onsuccess = () => {
          const db = request.result
          workspaceDbInstances.set(dbName, db)
          resolve(db)
        }
        request.onerror = () => reject(request.error ?? new Error('Failed to open projects database'))
      }),
    )
  }
  return workspaceDbPromises.get(dbName) as Promise<IDBDatabase>
}

async function deleteWorkspaceStorage(workspaceId: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    memoryWorkspaceDocuments.delete(workspaceId)
    return
  }
  const dbName = getWorkspaceDbName(workspaceId)
  const existing = workspaceDbInstances.get(dbName)
  if (existing) {
    existing.close()
    workspaceDbInstances.delete(dbName)
  }
  workspaceDbPromises.delete(dbName)
  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to delete workspace storage'))
    request.onblocked = () => {
      console.warn(`[ProjectsStore] Deleting workspace "${workspaceId}" is blocked by another tab`)
    }
  })
  memoryWorkspaceDocuments.delete(workspaceId)
}

function toMetadata(document: Project): ProjectSummary {
  return {
    id: document.id,
    name: document.name,
    sceneCount: Array.isArray(document.scenes) ? document.scenes.length : 0,
    updatedAt: new Date().toISOString(),
  }
}

async function readAllMetadata(workspaceId: string): Promise<ProjectSummary[]> {
  if (!isIndexedDbAvailable()) {
    const records: ProjectSummary[] = []
    const bucket = getMemoryWorkspace(workspaceId)
    bucket.forEach((doc) => {
      records.push(toMetadata(doc))
    })
    return records
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_METADATA, 'readonly')
  const store = tx.objectStore(STORE_METADATA)
  return await requestToPromise<ProjectSummary[]>(store.getAll())
}

async function readProjectDocument(workspaceId: string, id: string): Promise<Project | null> {
  if (!isIndexedDbAvailable()) {
    return getMemoryWorkspace(workspaceId).get(id) ?? null
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction(STORE_DOCUMENTS, 'readonly')
  const store = tx.objectStore(STORE_DOCUMENTS)
  const result = await requestToPromise<Project | undefined>(store.get(id))
  return result ?? null
}

async function writeProjectDocument(workspaceId: string, document: Project): Promise<void> {
  const prepared = cloneForIndexedDb(document)
  if (!isIndexedDbAvailable()) {
    getMemoryWorkspace(workspaceId).set(prepared.id, prepared)
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  docs.put(prepared)
  meta.put(toMetadata(prepared))
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write project document'))
    tx.onabort = () => reject(tx.error ?? new Error('Project write aborted'))
  })
}

async function writeProjectDocuments(workspaceId: string, documents: Project[]): Promise<void> {
  const preparedDocs = documents.map((doc) => cloneForIndexedDb(doc))
  if (!isIndexedDbAvailable()) {
    const bucket = getMemoryWorkspace(workspaceId)
    preparedDocs.forEach((doc) => bucket.set(doc.id, doc))
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  preparedDocs.forEach((document) => {
    docs.put(document)
    meta.put(toMetadata(document))
  })
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write project documents'))
    tx.onabort = () => reject(tx.error ?? new Error('Project batch write aborted'))
  })
}

async function removeProjectDocument(workspaceId: string, id: string): Promise<void> {
  if (!isIndexedDbAvailable()) {
    getMemoryWorkspace(workspaceId).delete(id)
    return
  }
  const db = await openDatabase(workspaceId)
  const tx = db.transaction([STORE_DOCUMENTS, STORE_METADATA], 'readwrite')
  const docs = tx.objectStore(STORE_DOCUMENTS)
  const meta = tx.objectStore(STORE_METADATA)
  docs.delete(id)
  meta.delete(id)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete project document'))
    tx.onabort = () => reject(tx.error ?? new Error('Project delete aborted'))
  })
}

async function fetchUserProjectsFromServer(authStore: ReturnType<typeof useAuthStore>): Promise<Project[] | null> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return null
  }
  const url = buildServerApiUrl(USER_PROJECT_API_PREFIX)
  const headers = new Headers({ Accept: 'application/json' })
  headers.set('Authorization', authorization)
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers,
    cache: 'no-cache',
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch projects (${response.status})`)
  }
  const payload = await response.json().catch(() => null)
  const entries: unknown =
    payload && typeof payload === 'object' && Array.isArray((payload as { projects?: unknown[] }).projects)
      ? (payload as { projects?: unknown[] }).projects
      : payload
  if (!Array.isArray(entries)) {
    return []
  }
  return (entries as Project[]).filter((doc): doc is Project => !!doc && typeof doc.id === 'string')
}

async function uploadProjectToServer(document: Project, authStore: ReturnType<typeof useAuthStore>): Promise<void> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return
  }
  const payload = cloneForIndexedDb(document)
  const url = buildServerApiUrl(`${USER_PROJECT_API_PREFIX}/${encodeURIComponent(document.id)}`)
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })
  headers.set('Authorization', authorization)
  const response = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Failed to save project (${response.status})`)
  }
}

async function removeProjectFromServer(projectId: string, authStore: ReturnType<typeof useAuthStore>): Promise<{ deletedSceneIds: string[]; failedSceneIds: string[] } | null> {
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    return null
  }
  const url = buildServerApiUrl(`${USER_PROJECT_API_PREFIX}/${encodeURIComponent(projectId)}`)
  const headers = new Headers({ Accept: 'application/json' })
  headers.set('Authorization', authorization)
  const response = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete project (${response.status})`)
  }
  if (response.status === 204 || response.status === 404) {
    return { deletedSceneIds: [], failedSceneIds: [] }
  }
  const payload = await response.json().catch(() => null)
  const result = payload && typeof payload === 'object' ? (payload as any).result : null
  return {
    deletedSceneIds: Array.isArray(result?.deletedSceneIds) ? (result.deletedSceneIds as string[]) : [],
    failedSceneIds: Array.isArray(result?.failedSceneIds) ? (result.failedSceneIds as string[]) : [],
  }
}

function buildSceneJsonUrl(sceneId: string): string {
  return buildServerApiUrl(`/api/user-scenes/${encodeURIComponent(sceneId)}`)
}

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsState => ({
    metadata: [],
    initialized: false,
    initializing: false,
    error: null,
    workspaceId: LOCAL_WORKSPACE_DESCRIPTOR.id,
    workspaceType: LOCAL_WORKSPACE_DESCRIPTOR.type,
    workspaceLabel: LOCAL_WORKSPACE_DESCRIPTOR.label,
    workspaceUserId: LOCAL_WORKSPACE_DESCRIPTOR.userId,
    workspaceUsername: LOCAL_WORKSPACE_DESCRIPTOR.username,
    workspaceRevision: 0,
    activeProjectId: null,
  }),
  getters: {
    sortedMetadata(state): ProjectSummary[] {
      return [...state.metadata].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    },
  },
  actions: {
    async initialize() {
      if (this.initialized && !this.initializing) {
        this.attachAuthWatcher()
        return
      }
      if (initializationPromise) {
        await initializationPromise
        return
      }
      initializationPromise = this.bootstrapWorkspace()
      try {
        await initializationPromise
      } finally {
        initializationPromise = null
      }
    },
    async bootstrapWorkspace() {
      const authStore = useAuthStore()
      try {
        await authStore.initialize()
      } catch (error) {
        console.warn('[ProjectsStore] Failed to initialize auth store', error)
      }
      const descriptor = resolveWorkspaceDescriptor(authStore.user)
      await this.switchWorkspace(descriptor, { forceReload: true, syncFromServer: descriptor.type === 'user' })
      this.attachAuthWatcher(authStore)
      this.initialized = true
      this.error = null
    },
    attachAuthWatcher(authStore?: ReturnType<typeof useAuthStore>) {
      if (authWatcherStop) {
        return
      }
      const store = authStore ?? useAuthStore()
      authWatcherStop = watch(
        () => store.user,
        (next, prev) => {
          const nextDescriptor = resolveWorkspaceDescriptor(next)
          const prevDescriptor = resolveWorkspaceDescriptor(prev)
          void this.handleAuthStateChange(nextDescriptor, prevDescriptor)
        },
      )
    },
    async handleAuthStateChange(nextDescriptor: ProjectWorkspaceDescriptor, prevDescriptor: ProjectWorkspaceDescriptor) {
      const workspaceChanged = nextDescriptor.id !== prevDescriptor.id || nextDescriptor.type !== prevDescriptor.type
      this.workspaceLabel = nextDescriptor.label
      this.workspaceUserId = nextDescriptor.userId
      this.workspaceUsername = nextDescriptor.username
      if (!workspaceChanged) {
        return
      }
      try {
        await this.switchWorkspace(nextDescriptor, {
          forceReload: true,
          syncFromServer: nextDescriptor.type === 'user',
        })
      } catch (error) {
        console.error('[ProjectsStore] handleAuthStateChange failed', error)
      }
      if (prevDescriptor.type === 'user' && prevDescriptor.id !== nextDescriptor.id) {
        try {
          await deleteWorkspaceStorage(prevDescriptor.id)
        } catch (error) {
          console.warn('[ProjectsStore] Failed to purge previous workspace cache', error)
        }
      }
      if (this.activeProjectId && nextDescriptor.type === 'local') {
        this.activeProjectId = null
      }
    },
    async switchWorkspace(
      descriptor: ProjectWorkspaceDescriptor,
      options: { forceReload?: boolean; syncFromServer?: boolean } = {},
    ) {
      const shouldReload =
        options.forceReload ||
        descriptor.id !== this.workspaceId ||
        descriptor.type !== this.workspaceType ||
        !this.initialized
      this.workspaceLabel = descriptor.label
      this.workspaceUserId = descriptor.userId
      this.workspaceUsername = descriptor.username
      if (!shouldReload) {
        return
      }
      this.initializing = true
      try {
        const records = await readAllMetadata(descriptor.id)
        this.metadata = records
        this.workspaceId = descriptor.id
        this.workspaceType = descriptor.type
        this.workspaceRevision += 1
        this.error = null
        if (options.syncFromServer && descriptor.type === 'user') {
          await this.syncUserWorkspaceFromServer({ replace: true })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load projects workspace'
        this.error = message
        console.error('[ProjectsStore] switchWorkspace failed', error)
        throw error
      } finally {
        this.initializing = false
      }
    },
    setActiveProject(projectId: string | null) {
      this.activeProjectId = projectId
    },
    async refreshMetadata() {
      try {
        const records = await readAllMetadata(this.workspaceId)
        this.metadata = records
        this.workspaceRevision += 1
        this.error = null
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh projects metadata'
        this.error = message
        console.error('[ProjectsStore] refreshMetadata failed', error)
      }
    },
    async loadProjectDocument(id: string): Promise<Project | null> {
      try {
        return await readProjectDocument(this.workspaceId, id)
      } catch (error) {
        console.error('[ProjectsStore] loadProjectDocument failed', error)
        return null
      }
    },
    async saveProjectDocument(document: Project) {
      await writeProjectDocument(this.workspaceId, document)
      await this.refreshMetadata()
      if (this.workspaceType === 'user') {
        await this.syncProjectToServer(document)
      }
      if (!this.initialized) {
        this.initialized = true
      }
    },
    async syncUserWorkspaceFromServer(options: { replace?: boolean } = {}) {
      if (this.workspaceType !== 'user') {
        return
      }
      const authStore = useAuthStore()
      try {
        const remote = await fetchUserProjectsFromServer(authStore)
        if (!remote) {
          return
        }
        if (options.replace) {
          await deleteWorkspaceStorage(this.workspaceId)
          if (remote.length) {
            await writeProjectDocuments(this.workspaceId, remote)
          }
          this.metadata = remote.map((doc) => toMetadata(doc))
        } else {
          await writeProjectDocuments(this.workspaceId, remote)
          await this.refreshMetadata()
        }
        this.workspaceRevision += 1
      } catch (error) {
        console.warn('[ProjectsStore] syncUserWorkspaceFromServer failed', error)
      }
    },
    async syncProjectToServer(document: Project) {
      if (this.workspaceType !== 'user') {
        return
      }
      const authStore = useAuthStore()
      try {
        await uploadProjectToServer(document, authStore)
      } catch (error) {
        console.warn('[ProjectsStore] syncProjectToServer failed', error)
      }
    },
    async deleteProjectCascade(projectId: string): Promise<{ deletedSceneIds: string[]; failedSceneIds: string[] }> {
      const project = await this.loadProjectDocument(projectId)
      const sceneIds = project?.scenes?.map((scene) => scene.id) ?? []

      if (this.workspaceType === 'user') {
        const authStore = useAuthStore()
        try {
          const result = await removeProjectFromServer(projectId, authStore)
          if (result) {
            // Server already cascaded deletion. Clean local without server calls.
            const scenesStore = useScenesStore()
            await scenesStore.initialize()
            await scenesStore.deleteScenesLocalOnly(sceneIds)
            await removeProjectDocument(this.workspaceId, projectId)
            await this.refreshMetadata()
            if (this.activeProjectId === projectId) {
              this.activeProjectId = null
            }
            return result
          }
        } catch (error) {
          console.warn('[ProjectsStore] deleteProjectCascade failed (server)', error)
        }
      }

      // Local cascade (offline or server failed).
      const scenesStore = useScenesStore()
      await scenesStore.initialize()
      for (const sceneId of sceneIds) {
        await scenesStore.deleteScene(sceneId)
      }
      await removeProjectDocument(this.workspaceId, projectId)
      await this.refreshMetadata()
      if (this.activeProjectId === projectId) {
        this.activeProjectId = null
      }
      return { deletedSceneIds: sceneIds, failedSceneIds: [] }
    },
    async ensureDefaultScene(projectId: string, scene: { id: string; name: string }) {
      const project = await this.loadProjectDocument(projectId)
      if (!project) {
        return
      }
      if (project.scenes.length) {
        return
      }
      const meta: ProjectSceneMeta = {
        id: scene.id,
        name: scene.name,
        sceneJsonUrl: buildSceneJsonUrl(scene.id),
        projectId,
      }
      const next: Project = {
        ...project,
        scenes: [meta],
        lastEditedSceneId: scene.id,
      }
      await this.saveProjectDocument(next)
    },
    async setLastEditedScene(projectId: string, sceneId: string) {
      const project = await this.loadProjectDocument(projectId)
      if (!project) {
        return
      }
      if (project.lastEditedSceneId === sceneId) {
        return
      }
      const next: Project = {
        ...project,
        lastEditedSceneId: sceneId,
      }
      await this.saveProjectDocument(next)
    },
    async addSceneToProject(projectId: string, scene: { id: string; name: string }) {
      const project = await this.loadProjectDocument(projectId)
      if (!project) {
        throw new Error('Project not found')
      }
      const existing = project.scenes.find((entry) => entry.id === scene.id)
      if (existing) {
        if (existing.name !== scene.name || existing.sceneJsonUrl !== buildSceneJsonUrl(scene.id)) {
          const nextScenes = project.scenes.map((entry) =>
            entry.id === scene.id
              ? { ...entry, name: scene.name, sceneJsonUrl: buildSceneJsonUrl(scene.id), projectId }
              : entry,
          )
          await this.saveProjectDocument({ ...project, scenes: nextScenes, lastEditedSceneId: scene.id })
        } else if (project.lastEditedSceneId !== scene.id) {
          await this.saveProjectDocument({ ...project, lastEditedSceneId: scene.id })
        }
        return
      }

      const meta: ProjectSceneMeta = {
        id: scene.id,
        name: scene.name,
        sceneJsonUrl: buildSceneJsonUrl(scene.id),
        projectId,
      }
      const next: Project = {
        ...project,
        scenes: [...project.scenes, meta],
        lastEditedSceneId: scene.id,
      }
      await this.saveProjectDocument(next)
    },
    async removeSceneFromProject(projectId: string, sceneId: string) {
      const project = await this.loadProjectDocument(projectId)
      if (!project) {
        return
      }
      const nextScenes = project.scenes.filter((entry) => entry.id !== sceneId)
      const nextLast = project.lastEditedSceneId === sceneId ? (nextScenes[0]?.id ?? null) : project.lastEditedSceneId
      await this.saveProjectDocument({ ...project, scenes: nextScenes, lastEditedSceneId: nextLast })
    },
    async renameSceneInProject(projectId: string, sceneId: string, name: string) {
      const project = await this.loadProjectDocument(projectId)
      if (!project) {
        return
      }
      const nextScenes = project.scenes.map((entry) => (entry.id === sceneId ? { ...entry, name } : entry))
      await this.saveProjectDocument({ ...project, scenes: nextScenes })
    },
    async createProject(name: string): Promise<Project> {
      const trimmed = name.trim()
      const id = generateUuid()
      const project: Project = {
        id,
        name: trimmed.length ? trimmed : '新工程',
        scenes: [],
        lastEditedSceneId: null,
      }
      await this.saveProjectDocument(project)
      return project
    },
  },
})
