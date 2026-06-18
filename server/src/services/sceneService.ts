import fs from 'fs-extra'
import { Types, type FilterQuery } from 'mongoose'
import { FileUploadModel } from '@/models/FileUpload'
import { SceneModel } from '@/models/Scene'
import type { SceneDocument } from '@/types/models'
import { deleteStoredFile, resolveStorageAbsolutePath, storeUploadedFile, type UploadedFilePayload } from '@/services/uploadStorageService'
import {
  decodeScenePackageSceneDocument,
  deserializeScenePackageManifest,
  readBinaryFileFromScenePackage,
  readTextFileFromScenePackage,
  unzipScenePackage,
  MULTIUSER_NODE_ID,
  type SceneJsonExportDocument,
  type SceneNode,
  type SceneNodeComponentState,
} from '@harmony/schema/core'

export type { UploadedFilePayload } from '@/services/uploadStorageService'

type StoredSceneFile = {
  fileUploadId: Types.ObjectId
  fileKey: string
  fileUrl: string
  fileSize: number
  fileType: string | null
  originalFilename: string | null
}

export type SceneData = {
  id: string
  name: string
  fileKey: string
  fileUrl: string
  packageDownloadPath: string
  fileSize: number
  checkpointTotal: number
  metadata: Record<string, unknown> | null
  fileType: string | null
  originalFilename: string | null
  publishedBy: string | null
  publishedByType: 'User' | 'Admin'
  createdAt: string
  updatedAt: string
}

export type SceneListQuery = {
  page: number
  pageSize: number
  keyword?: string
  createdFrom?: Date | null
  createdTo?: Date | null
}

export type SceneCreatePayload = {
  name: string
  file: UploadedFilePayload
  publishedBy: string
  publishedByType: 'User' | 'Admin'
  uploaderAdminId?: string | null
  uploaderUsername?: string | null
}

export type SceneUpdatePayload = {
  name?: string
  file?: UploadedFilePayload | null
  uploaderAdminId?: string | null
  uploaderUsername?: string | null
}

type SceneDocLike = SceneDocument & { _id: Types.ObjectId }

type ParsedScenePackageMetadata = {
  checkpointTotal: number
  metadata: Record<string, unknown> | null
  multiuser: ScenePackageMultiuserSummary | null
}

export type ScenePackageMultiuserSceneSummary = {
  sceneId: string
  sceneName: string | null
  nodeCount: number
  enabledNodeCount: number
  replicatedNodeCount: number
  replicatedPhysicsNodeCount: number
  physicsAuthorityNodeCount: number
  maxVisiblePeers: number | null
  server: string | null
  port: number | null
  syncInterval: number | null
  maxUsers: number | null
}

export type ScenePackageMultiuserSummary = {
  enabled: boolean
  sceneCount: number
  nodeCount: number
  enabledNodeCount: number
  replicatedNodeCount: number
  replicatedPhysicsNodeCount: number
  physicsAuthorityNodeCount: number
  scenes: ScenePackageMultiuserSceneSummary[]
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseNonNegativeInteger(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function buildManifestMetadataFallback(manifestRaw: unknown): Record<string, unknown> | null {
  const manifest = asPlainRecord(manifestRaw)
  const resources = Array.isArray(manifest?.resources) ? manifest.resources : []
  if (!resources.length) {
    return null
  }
  const manifestResourceBytes = resources.reduce((sum, entry) => {
    const record = asPlainRecord(entry)
    return sum + parseNonNegativeInteger(record?.size)
  }, 0)
  return {
    generatedAt: typeof manifest?.createdAt === 'string' ? manifest.createdAt : new Date().toISOString(),
    sceneCount: Array.isArray(manifest?.scenes) ? manifest.scenes.length : 0,
    resourceCount: resources.length,
    manifestResourceBytes,
  }
}

function buildScenePackageDownloadPath(sceneId: string): string {
  return `/api/mini/scenes/${encodeURIComponent(sceneId)}/package`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function toFiniteInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.trunc(parsed)
}

function collectMultiuserNodeSummaries(nodes: SceneNode[] | undefined | null): Array<SceneNodeComponentState<Record<string, unknown>>> {
  const matches: Array<SceneNodeComponentState<Record<string, unknown>>> = []
  if (!Array.isArray(nodes)) {
    return matches
  }
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.id === MULTIUSER_NODE_ID && isRecord(node.components)) {
      for (const component of Object.values(node.components)) {
        if (!component || typeof component !== 'object') {
          continue
        }
        if (component.type === 'online') {
          matches.push(component as SceneNodeComponentState<Record<string, unknown>>)
        }
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return matches
}

const NETWORK_SYNC_COMPONENT_TYPE = 'networkSync'
const PHYSICS_AUTHORITY_COMPONENT_TYPE = 'physicsAuthority'
const RIGIDBODY_COMPONENT_TYPE = 'rigidbody'

function collectNetworkSyncNodeSummaries(nodes: SceneNode[] | undefined | null): Array<{
  networkSync: SceneNodeComponentState<Record<string, unknown>>
  hasRigidbody: boolean
}> {
  const matches: Array<{ networkSync: SceneNodeComponentState<Record<string, unknown>>; hasRigidbody: boolean }> = []
  if (!Array.isArray(nodes)) {
    return matches
  }
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const networkSync = node.components?.[NETWORK_SYNC_COMPONENT_TYPE]
    if (networkSync && typeof networkSync === 'object' && networkSync.type === NETWORK_SYNC_COMPONENT_TYPE) {
      matches.push({
        networkSync: networkSync as SceneNodeComponentState<Record<string, unknown>>,
        hasRigidbody: Boolean(node.components?.[RIGIDBODY_COMPONENT_TYPE]),
      })
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return matches
}

function collectPhysicsAuthorityNodeCount(nodes: SceneNode[] | undefined | null): number {
  if (!Array.isArray(nodes)) {
    return 0
  }
  let count = 0
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const component = node.components?.[PHYSICS_AUTHORITY_COMPONENT_TYPE]
    if (component && typeof component === 'object' && component.type === PHYSICS_AUTHORITY_COMPONENT_TYPE && component.enabled !== false) {
      count += 1
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return count
}

function normalizeMultiuserSceneSummary(
  sceneEntryId: string,
  document: SceneJsonExportDocument,
): ScenePackageMultiuserSceneSummary {
  const onlineComponents = collectMultiuserNodeSummaries(document.nodes)
  const networkSyncNodes = collectNetworkSyncNodeSummaries(document.nodes)
  const firstOnlineComponent = onlineComponents.find((component) => component.enabled !== false) ?? onlineComponents[0] ?? null
  const props = isRecord(firstOnlineComponent?.props) ? firstOnlineComponent.props : null
  const server = toNonEmptyString(props?.server)
  const port = toFiniteInteger(props?.port)
  const syncInterval = toFiniteInteger(props?.syncInterval)
  const maxUsers = toFiniteInteger(props?.maxUsers)
  const maxVisiblePeers = toFiniteInteger(props?.maxVisiblePeers)
  const replicatedNodeCount = networkSyncNodes.length
  const replicatedPhysicsNodeCount = networkSyncNodes.filter((entry) => entry.hasRigidbody).length
  const physicsAuthorityNodeCount = collectPhysicsAuthorityNodeCount(document.nodes)
  return {
    sceneId: sceneEntryId || document.id,
    sceneName: toNonEmptyString(document.name),
    nodeCount: onlineComponents.length,
    enabledNodeCount: onlineComponents.filter((component) => component.enabled !== false).length,
    replicatedNodeCount,
    replicatedPhysicsNodeCount,
    physicsAuthorityNodeCount,
    maxVisiblePeers,
    server,
    port,
    syncInterval,
    maxUsers,
  }
}

function buildScenePackageMultiuserSummary(scenes: Array<{ sceneId: string; document: SceneJsonExportDocument }>): ScenePackageMultiuserSummary | null {
  if (!scenes.length) {
    return null
  }
  const summaries = scenes.map((scene) => normalizeMultiuserSceneSummary(scene.sceneId, scene.document))
  const enabledNodeCount = summaries.reduce((sum, scene) => sum + scene.enabledNodeCount, 0)
  const nodeCount = summaries.reduce((sum, scene) => sum + scene.nodeCount, 0)
  const replicatedNodeCount = summaries.reduce((sum, scene) => sum + scene.replicatedNodeCount, 0)
  const replicatedPhysicsNodeCount = summaries.reduce((sum, scene) => sum + scene.replicatedPhysicsNodeCount, 0)
  const physicsAuthorityNodeCount = summaries.reduce((sum, scene) => sum + Number(scene.physicsAuthorityNodeCount ?? 0), 0)
  const enabled = enabledNodeCount > 0
  return {
    enabled,
    sceneCount: summaries.length,
    nodeCount,
    enabledNodeCount,
    replicatedNodeCount,
    replicatedPhysicsNodeCount,
    physicsAuthorityNodeCount,
    scenes: summaries,
  }
}

function normalizeStoredMultiuserSummary(value: unknown): ScenePackageMultiuserSummary | null {
  if (!isRecord(value)) {
    return null
  }
  const scenes = Array.isArray(value.scenes)
    ? value.scenes
        .map((scene) => {
          if (!isRecord(scene)) {
            return null
          }
          const sceneId = toNonEmptyString(scene.sceneId)
          if (!sceneId) {
            return null
          }
          return {
            sceneId,
            sceneName: toNonEmptyString(scene.sceneName),
            nodeCount: Number(scene.nodeCount ?? 0) || 0,
            enabledNodeCount: Number(scene.enabledNodeCount ?? 0) || 0,
            replicatedNodeCount: Number(scene.replicatedNodeCount ?? 0) || 0,
            replicatedPhysicsNodeCount: Number(scene.replicatedPhysicsNodeCount ?? 0) || 0,
            physicsAuthorityNodeCount: Number(scene.physicsAuthorityNodeCount ?? 0) || 0,
            maxVisiblePeers: toFiniteInteger(scene.maxVisiblePeers),
            server: toNonEmptyString(scene.server),
            port: toFiniteInteger(scene.port),
            syncInterval: toFiniteInteger(scene.syncInterval),
            maxUsers: toFiniteInteger(scene.maxUsers),
          } satisfies ScenePackageMultiuserSceneSummary
        })
        .filter((scene): scene is ScenePackageMultiuserSceneSummary => Boolean(scene))
    : []
  return {
    enabled: Boolean(value.enabled),
    sceneCount: Number(value.sceneCount ?? scenes.length) || scenes.length,
    nodeCount: Number(value.nodeCount ?? 0) || 0,
    enabledNodeCount: Number(value.enabledNodeCount ?? 0) || 0,
    replicatedNodeCount: Number(value.replicatedNodeCount ?? 0) || 0,
    replicatedPhysicsNodeCount: Number(value.replicatedPhysicsNodeCount ?? 0) || 0,
    physicsAuthorityNodeCount: Number(value.physicsAuthorityNodeCount ?? 0) || 0,
    scenes,
  }
}

async function loadScenePackageMultiuserSummary(fileKey: string | null | undefined): Promise<ScenePackageMultiuserSummary | null> {
  const normalizedFileKey = toNonEmptyString(fileKey)
  if (!normalizedFileKey) {
    return null
  }
  try {
    const sourcePath = resolveStorageAbsolutePath(normalizedFileKey)
    const exists = await fs.pathExists(sourcePath)
    if (!exists) {
      return null
    }
    const zipBytes = await fs.readFile(sourcePath)
    const pkg = unzipScenePackage(zipBytes)
    const sceneDocuments: Array<{ sceneId: string; document: SceneJsonExportDocument }> = []
    for (const sceneEntry of pkg.manifest.scenes ?? []) {
      const sceneBytes = readBinaryFileFromScenePackage(pkg, sceneEntry.path)
      sceneDocuments.push({
        sceneId: sceneEntry.sceneId,
        document: decodeScenePackageSceneDocument(sceneBytes),
      })
    }
    return buildScenePackageMultiuserSummary(sceneDocuments)
  } catch {
    return null
  }
}

async function parseScenePackageMetadataFromSceneFile(file: UploadedFilePayload): Promise<ParsedScenePackageMetadata> {
  try {
    const sourcePath = file.filepath
    if (!sourcePath) {
      return { checkpointTotal: 0, metadata: null, multiuser: null }
    }
    const zipBytes = await fs.readFile(sourcePath)
    const pkg = unzipScenePackage(zipBytes)
    const projectRaw = JSON.parse(readTextFileFromScenePackage(pkg, 'project/project.json')) as Record<string, unknown>
    const checkpointTotal = parseNonNegativeInteger(projectRaw?.checkpointTotal)
    const metadata = asPlainRecord(projectRaw?.metadata)
    const sceneDocuments: Array<{ sceneId: string; document: SceneJsonExportDocument }> = []
    for (const sceneEntry of pkg.manifest.scenes ?? []) {
      const sceneBytes = readBinaryFileFromScenePackage(pkg, sceneEntry.path)
      const sceneDocument = decodeScenePackageSceneDocument(sceneBytes)
      sceneDocuments.push({
        sceneId: sceneEntry.sceneId,
        document: sceneDocument,
      })
    }
    const multiuser = buildScenePackageMultiuserSummary(sceneDocuments)
    const mergedMetadata = metadata ? { ...metadata } : null
    if (mergedMetadata) {
      mergedMetadata.multiuser = multiuser
    } else if (multiuser) {
      return { checkpointTotal, metadata: { multiuser }, multiuser }
    }
    if (metadata) {
      return { checkpointTotal, metadata: mergedMetadata, multiuser }
    }
    try {
      const manifestRaw = deserializeScenePackageManifest(readBinaryFileFromScenePackage(pkg, 'manifest.bin'))
      const fallbackMetadata = buildManifestMetadataFallback(manifestRaw)
      if (fallbackMetadata) {
        fallbackMetadata.multiuser = multiuser
      }
      return { checkpointTotal, metadata: fallbackMetadata, multiuser }
    } catch {
      return { checkpointTotal, metadata: multiuser ? { multiuser } : null, multiuser }
    }
  } catch {
    return { checkpointTotal: 0, metadata: null, multiuser: null }
  }
}

async function storeSceneFile(file: UploadedFilePayload, uploaderAdminId?: string | null, uploaderUsername?: string | null, label?: string | null): Promise<StoredSceneFile> {
  const stored = await storeUploadedFile(file, 'scene')
  const upload = await FileUploadModel.create({
    module: 'scene',
    label: label ?? stored.originalFilename,
    fileKey: stored.fileKey,
    url: stored.url,
    originalFilename: stored.originalFilename,
    mimeType: stored.mimeType,
    size: stored.size,
    uploaderAdminId: uploaderAdminId && Types.ObjectId.isValid(uploaderAdminId) ? new Types.ObjectId(uploaderAdminId) : null,
    uploaderUsername: uploaderUsername ?? null,
  })
  return {
    fileUploadId: upload._id as Types.ObjectId,
    fileKey: stored.fileKey,
    fileUrl: stored.url,
    fileSize: stored.size,
    fileType: stored.mimeType,
    originalFilename: stored.originalFilename,
  }
}

export async function deleteSceneFile(fileUploadIdOrKey: Types.ObjectId | string | null | undefined, fileKey?: string | null): Promise<void> {
  const fileUploadId = typeof fileUploadIdOrKey === 'string' ? null : fileUploadIdOrKey
  const resolvedFileKey = typeof fileUploadIdOrKey === 'string' ? fileUploadIdOrKey : fileKey
  if (!fileUploadId && !resolvedFileKey) {
    return
  }
  if (fileUploadId) {
    await FileUploadModel.findByIdAndDelete(fileUploadId).exec().catch(() => undefined)
  }
  await deleteStoredFile(resolvedFileKey)
}

async function mapSceneDocument(scene: SceneDocLike): Promise<SceneData> {
  const id = scene._id instanceof Types.ObjectId ? scene._id.toString() : String(scene._id)
  const createdAt = scene.createdAt instanceof Date ? scene.createdAt.toISOString() : new Date(scene.createdAt).toISOString()
  const updatedAt = scene.updatedAt instanceof Date ? scene.updatedAt.toISOString() : new Date(scene.updatedAt).toISOString()
  let publishedBy: string | null = null
  if (scene.publishedBy instanceof Types.ObjectId) {
    publishedBy = scene.publishedBy.toString()
  } else if (scene.publishedBy) {
    publishedBy = String(scene.publishedBy)
  }
  const publishedByType = scene.publishedByType === 'Admin' ? 'Admin' : 'User'
  const metadata = asPlainRecord(scene.metadata)
  const storedMultiuser = normalizeStoredMultiuserSummary(metadata?.multiuser)
  const multiuser = storedMultiuser ?? await loadScenePackageMultiuserSummary(scene.fileKey)
  const resolvedMetadata = metadata ? { ...metadata } : null
  if (resolvedMetadata) {
    resolvedMetadata.multiuser = multiuser
  } else if (multiuser) {
    return {
      id,
      name: scene.name,
      fileKey: scene.fileKey,
      fileUrl: scene.fileUrl,
      packageDownloadPath: buildScenePackageDownloadPath(id),
      fileSize: scene.fileSize ?? 0,
      checkpointTotal: typeof scene.checkpointTotal === 'number' && scene.checkpointTotal > 0 ? Math.floor(scene.checkpointTotal) : 0,
      metadata: { multiuser },
      fileType: sanitizeString(scene.fileType),
      originalFilename: sanitizeString(scene.originalFilename),
      publishedBy,
      publishedByType,
      createdAt,
      updatedAt,
    }
  }
  return {
    id,
    name: scene.name,
    fileKey: scene.fileKey,
    fileUrl: scene.fileUrl,
    packageDownloadPath: buildScenePackageDownloadPath(id),
    fileSize: scene.fileSize ?? 0,
    checkpointTotal: typeof scene.checkpointTotal === 'number' && scene.checkpointTotal > 0 ? Math.floor(scene.checkpointTotal) : 0,
    metadata: resolvedMetadata,
    fileType: sanitizeString(scene.fileType),
    originalFilename: sanitizeString(scene.originalFilename),
    publishedBy,
    publishedByType,
    createdAt,
    updatedAt,
  }
}

export async function listScenes(query: SceneListQuery): Promise<{ data: SceneData[]; total: number }> {
  const filter: FilterQuery<SceneDocument> = {}
  if (query.keyword) {
    filter.name = new RegExp(escapeRegex(query.keyword), 'i')
  }
  if (query.createdFrom || query.createdTo) {
    const createdAt: Record<string, Date> = {}
    if (query.createdFrom) {
      createdAt.$gte = query.createdFrom
    }
    if (query.createdTo) {
      createdAt.$lte = query.createdTo
    }
    filter.createdAt = createdAt
  }
  const skip = (query.page - 1) * query.pageSize
  const [records, total] = await Promise.all([
    SceneModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.pageSize)
      .lean()
      .exec() as Promise<SceneDocLike[]>,
    SceneModel.countDocuments(filter).exec(),
  ])
  const data = await Promise.all(records.map((record) => mapSceneDocument(record)))
  return {
    data,
    total,
  }
}

export async function createScene(payload: SceneCreatePayload): Promise<SceneData> {
  const packageMetadata = await parseScenePackageMetadataFromSceneFile(payload.file)
  const stored = await storeSceneFile(payload.file, payload.uploaderAdminId, payload.uploaderUsername, payload.name)
  try {
    const created = await SceneModel.create({
      name: payload.name,
      fileUploadId: stored.fileUploadId,
      fileKey: stored.fileKey,
      fileUrl: stored.fileUrl,
      fileSize: stored.fileSize,
      checkpointTotal: packageMetadata.checkpointTotal,
      metadata: packageMetadata.metadata,
      fileType: stored.fileType,
      originalFilename: stored.originalFilename,
      publishedBy: new Types.ObjectId(payload.publishedBy),
      publishedByType: payload.publishedByType,
    })
    return await mapSceneDocument(created.toObject() as SceneDocLike)
  } catch (error) {
    await deleteSceneFile(stored.fileUploadId, stored.fileKey)
    throw error
  }
}

export async function updateScene(id: string, payload: SceneUpdatePayload): Promise<SceneData | null> {
  const scene = await SceneModel.findById(id).exec()
  if (!scene) {
    return null
  }
  let newFile: StoredSceneFile | null = null
  let newPackageMetadata: ParsedScenePackageMetadata | null = null
  if (payload.file) {
    newPackageMetadata = await parseScenePackageMetadataFromSceneFile(payload.file)
    newFile = await storeSceneFile(payload.file, payload.uploaderAdminId, payload.uploaderUsername, payload.name ?? scene.name)
  }
  const previousFileKey = scene.fileKey
  const previousFileUploadId = scene.fileUploadId ?? null
  if (typeof payload.name === 'string' && payload.name.trim().length) {
    scene.name = payload.name.trim()
  }
  if (newFile) {
    scene.fileUploadId = newFile.fileUploadId
    scene.fileKey = newFile.fileKey
    scene.fileUrl = newFile.fileUrl
    scene.fileSize = newFile.fileSize
    scene.checkpointTotal = newPackageMetadata?.checkpointTotal ?? 0
    scene.metadata = newPackageMetadata?.metadata ?? null
    scene.fileType = newFile.fileType
    scene.originalFilename = newFile.originalFilename
  }
  try {
    await scene.save()
  } catch (error) {
    if (newFile) {
      await deleteSceneFile(newFile.fileUploadId, newFile.fileKey)
    }
    throw error
  }
  if (newFile && (previousFileKey !== newFile.fileKey || String(previousFileUploadId ?? '') !== String(newFile.fileUploadId ?? ''))) {
    await deleteSceneFile(previousFileUploadId, previousFileKey)
  }
  return await mapSceneDocument(scene.toObject() as SceneDocLike)
}

export async function deleteSceneById(id: string): Promise<boolean> {
  const deleted = (await SceneModel.findByIdAndDelete(id).lean().exec()) as SceneDocLike | null
  if (!deleted) {
    return false
  }
  await deleteSceneFile((deleted as any).fileUploadId ?? null, deleted.fileKey)
  return true
}

export async function findSceneById(id: string): Promise<SceneData | null> {
  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocLike | null
  if (!scene) {
    return null
  }
  return await mapSceneDocument(scene)
}

export async function findSceneDocument(id: string): Promise<SceneDocLike | null> {
  const scene = (await SceneModel.findById(id).lean().exec()) as SceneDocLike | null
  return scene
}

export function extractUploadedFile(files: Record<string, unknown> | undefined, field: string): UploadedFilePayload | null {
  if (!files) {
    return null
  }
  const raw = files[field]
  const payload = Array.isArray(raw) ? raw[0] : raw
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const file = payload as UploadedFilePayload & { path?: string }
  const filepath = file.filepath ?? file.path
  if (!filepath) {
    return null
  }
  return {
    filepath,
    originalFilename: file.originalFilename ?? file.newFilename ?? null,
    newFilename: file.newFilename ?? null,
    mimetype: file.mimetype ?? null,
    size: file.size,
  }
}

export function resolveSceneFilePath(fileKey: string): string {
  return resolveStorageAbsolutePath(fileKey)
}
