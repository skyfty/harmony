export const WECHAT_WAYPOINT_THUMBNAIL_DIRECTORY = 'harmony/waypoint-thumbnails'

export type WechatWaypointThumbnailFileSystem = {
  mkdirSync?: (path: string, recursive?: boolean) => void
  readdirSync?: (path: string) => string[]
  unlinkSync?: (path: string) => void
  writeFileSync?: (path: string, data: ArrayBuffer) => void
}

export type WechatWaypointThumbnailRuntime = {
  fs: WechatWaypointThumbnailFileSystem
  userDataPath: string
}

type WechatRuntimeLike = {
  env?: {
    USER_DATA_PATH?: string
  }
  getFileSystemManager?: () => WechatWaypointThumbnailFileSystem
}

type WriteWechatWaypointThumbnailFileOptions = {
  assetId: string
  bytes: ArrayBuffer | Uint8Array
  filename?: string | null
  mimeType?: string | null
  runtime: WechatWaypointThumbnailRuntime
}

type ResolveWaypointThumbnailSourceUrlOptions = {
  directUrl?: string | null
  isWechatMiniProgram: boolean
  localFilePath?: string | null
  objectUrl?: string | null
}

type ResolveWaypointThumbnailServerUrlOptions = {
  assetBaseUrl?: string | null
  fileKey?: string | null
  resolvedUrl?: string | null
}

type GuideWaypointDestinationAvailability = {
  hasCompatibleActor: boolean
  vehicleDrivePromptBusy: boolean
}

const IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

export function resolveWechatWaypointThumbnailRuntime(
  runtime: WechatRuntimeLike | null | undefined = (
    globalThis as typeof globalThis & { wx?: WechatRuntimeLike }
  ).wx,
): WechatWaypointThumbnailRuntime | null {
  const userDataPath = typeof runtime?.env?.USER_DATA_PATH === 'string'
    ? runtime.env.USER_DATA_PATH.trim()
    : ''
  if (!userDataPath || typeof runtime?.getFileSystemManager !== 'function') {
    return null
  }
  try {
    return {
      fs: runtime.getFileSystemManager(),
      userDataPath,
    }
  } catch {
    return null
  }
}

export function resolveWaypointThumbnailFileExtension(
  filename: string | null | undefined,
  mimeType: string | null | undefined,
): string {
  const filenameExtension = typeof filename === 'string'
    ? filename.trim().split(/[?#]/, 1)[0]?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
    : undefined
  if (filenameExtension && IMAGE_EXTENSIONS.has(filenameExtension)) {
    return filenameExtension === 'jpeg' ? 'jpg' : filenameExtension
  }

  const normalizedMimeType = typeof mimeType === 'string'
    ? mimeType.trim().toLowerCase()
    : ''
  return MIME_EXTENSION_MAP[normalizedMimeType] ?? 'bin'
}

export function buildWechatWaypointThumbnailFilePath(
  runtime: WechatWaypointThumbnailRuntime,
  assetId: string,
  filename: string | null | undefined,
  mimeType: string | null | undefined,
): string {
  const safeAssetKey = encodeURIComponent(assetId.trim())
    .replace(/%/g, '_')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .slice(0, 180)
  const extension = resolveWaypointThumbnailFileExtension(filename, mimeType)
  const baseDirectory = runtime.userDataPath.replace(/\/+$/, '')
  return `${baseDirectory}/${WECHAT_WAYPOINT_THUMBNAIL_DIRECTORY}/${safeAssetKey}.${extension}`
}

export function writeWechatWaypointThumbnailFile(
  options: WriteWechatWaypointThumbnailFileOptions,
): string {
  const assetId = options.assetId.trim()
  if (!assetId) {
    throw new Error('景点缩略图缺少 assetId')
  }
  const fs = options.runtime.fs
  if (typeof fs.mkdirSync !== 'function') {
    throw new Error('当前微信文件系统不支持 mkdirSync')
  }
  if (typeof fs.writeFileSync !== 'function') {
    throw new Error('当前微信文件系统不支持 writeFileSync')
  }

  const baseDirectory = options.runtime.userDataPath.replace(/\/+$/, '')
  const directory = `${baseDirectory}/${WECHAT_WAYPOINT_THUMBNAIL_DIRECTORY}`
  const filePath = buildWechatWaypointThumbnailFilePath(
    options.runtime,
    assetId,
    options.filename,
    options.mimeType,
  )
  const source = options.bytes instanceof Uint8Array ? options.bytes : new Uint8Array(options.bytes)
  const safeBytes = new ArrayBuffer(source.byteLength)
  new Uint8Array(safeBytes).set(source)

  try {
    fs.mkdirSync(directory, true)
  } catch {
    // The write below remains the authority for permission and disk failures.
  }
  fs.writeFileSync(filePath, safeBytes)
  return filePath
}

export function clearWechatWaypointThumbnailFiles(
  runtime: WechatWaypointThumbnailRuntime | null | undefined,
): void {
  if (!runtime || typeof runtime.fs.readdirSync !== 'function' || typeof runtime.fs.unlinkSync !== 'function') {
    return
  }
  const baseDirectory = runtime.userDataPath.replace(/\/+$/, '')
  const directory = `${baseDirectory}/${WECHAT_WAYPOINT_THUMBNAIL_DIRECTORY}`
  let filenames: string[] = []
  try {
    filenames = runtime.fs.readdirSync(directory)
  } catch {
    return
  }
  for (const filename of filenames) {
    try {
      runtime.fs.unlinkSync(`${directory}/${filename}`)
    } catch {
      // A failed cleanup must not prevent the next scene from rendering.
    }
  }
}

export function resolveWaypointThumbnailSourceUrl(
  options: ResolveWaypointThumbnailSourceUrlOptions,
): string | null {
  const directUrl = typeof options.directUrl === 'string' ? options.directUrl.trim() : ''
  if (directUrl && !directUrl.startsWith('blob:')) {
    return directUrl
  }
  if (options.isWechatMiniProgram) {
    const localFilePath = typeof options.localFilePath === 'string'
      ? options.localFilePath.trim()
      : ''
    return localFilePath || null
  }
  const objectUrl = typeof options.objectUrl === 'string' ? options.objectUrl.trim() : ''
  return objectUrl || directUrl || null
}

export function resolveWaypointThumbnailServerUrl(
  options: ResolveWaypointThumbnailServerUrlOptions,
): string | null {
  const assetBaseUrl = typeof options.assetBaseUrl === 'string'
    ? options.assetBaseUrl.trim().replace(/\/+$/, '')
    : ''
  const fileKey = typeof options.fileKey === 'string'
    ? options.fileKey.trim().replace(/^\/+/, '')
    : ''
  if (assetBaseUrl && fileKey) {
    return `${assetBaseUrl}/${fileKey}`
  }

  const resolvedUrl = typeof options.resolvedUrl === 'string'
    ? options.resolvedUrl.trim()
    : ''
  if (assetBaseUrl && resolvedUrl) {
    const uploadsPath = resolvedUrl.match(/\/uploads\/(.+)$/i)?.[1]
    if (uploadsPath) {
      return `${assetBaseUrl}/${uploadsPath.replace(/^\/+/, '')}`
    }
  }
  return resolvedUrl || null
}

export function isGuideWaypointDestinationDisabled(
  availability: GuideWaypointDestinationAvailability,
): boolean {
  return availability.vehicleDrivePromptBusy || !availability.hasCompatibleActor
}
