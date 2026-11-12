import { zlibSync } from 'fflate'
import type { Camera, Scene, WebGLRenderTarget } from 'three'

export const WECHAT_WATCH_SNAPSHOT_MAX_EDGE = 1365

export type WatchSnapshotRenderer = {
  getRenderTarget: () => WebGLRenderTarget | null
  setRenderTarget: (target: WebGLRenderTarget | null) => void
  render: (scene: Scene, camera: Camera) => void
  getContext: () => WebGLRenderingContext | WebGL2RenderingContext
}

export type WatchSnapshotFrame = {
  width: number
  height: number
  pixels: Uint8Array
}

export type WatchSnapshotSize = {
  width: number
  height: number
}

export type WechatWatchSnapshotFileSystem = {
  writeFile?: (options: {
    filePath: string
    data: ArrayBuffer
    success: () => void
    fail: (error: unknown) => void
  }) => void
  unlink?: (options: {
    filePath: string
    success: () => void
    fail: (error: unknown) => void
  }) => void
}

export type WechatWatchSnapshotRuntime = {
  userDataPath: string
  fs: WechatWatchSnapshotFileSystem
}

export type WechatWatchSnapshotShareResult =
  | 'opened'
  | 'dismissed'
  | 'unsupported'
  | 'failed'

export type WechatWatchSnapshotShareRuntime = {
  showModal?: (options: {
    title: string
    content: string
    confirmText: string
    cancelText: string
    showCancel: boolean
    success: (result: { confirm?: boolean; cancel?: boolean }) => void
    fail?: (error: unknown) => void
  }) => void
  showShareImageMenu?: (options: {
    path: string
    needShowEntrance: boolean
    entrancePath: string
    success: () => void
    fail: (error: unknown) => void
  }) => void
  showToast?: (options: {
    title: string
    icon?: 'none' | 'success' | 'loading' | 'error'
  }) => void
}

export type WechatWatchSnapshotPage = {
  route?: string
  options?: Record<string, unknown>
  $page?: {
    options?: Record<string, unknown>
  }
}

type WechatWatchSnapshotRuntimeSource = {
  env?: {
    USER_DATA_PATH?: string
  }
  getFileSystemManager?: () => WechatWatchSnapshotFileSystem
}

type PrepareWatchSnapshotImageOptions = {
  pixels: Uint8Array
  sourceWidth: number
  sourceHeight: number
  maxEdge?: number
}

type EncodeWatchSnapshotPngOptions = {
  pixels: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

type WriteWatchSnapshotPngFileOptions = {
  runtime: WechatWatchSnapshotRuntime
  fileName: string
  png: Uint8Array
}

type PromptWechatWatchSnapshotShareOptions = {
  runtime?: WechatWatchSnapshotShareRuntime | null
  filePath: string
  entrancePath: string
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
let crcTable: Uint32Array | null = null

function validateSourceDimensions(sourceWidth: number, sourceHeight: number): void {
  if (
    !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0
    || sourceHeight <= 0
  ) {
    throw new Error('微信快照画布尺寸无效')
  }
}

export function resolveWechatWatchSnapshotOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = WECHAT_WATCH_SNAPSHOT_MAX_EDGE,
): WatchSnapshotSize {
  validateSourceDimensions(sourceWidth, sourceHeight)
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) {
    throw new Error('微信快照最大尺寸无效')
  }

  const width = Math.max(1, Math.floor(sourceWidth))
  const height = Math.max(1, Math.floor(sourceHeight))
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

export function hasVisibleWatchSnapshotPixels(pixels: Uint8Array): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) {
      return true
    }
  }
  return false
}

export function copyFlippedResampledRgba(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  validateSourceDimensions(sourceWidth, sourceHeight)
  validateSourceDimensions(targetWidth, targetHeight)
  const expectedLength = sourceWidth * sourceHeight * 4
  if (source.length < expectedLength) {
    throw new Error('微信快照像素数据不完整')
  }

  const target = new Uint8ClampedArray(targetWidth * targetHeight * 4)
  const scaleX = sourceWidth / targetWidth
  const scaleY = sourceHeight / targetHeight

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.max(
      0,
      Math.min(
        sourceHeight - 1,
        sourceHeight - 0.5 - (targetY + 0.5) * scaleY,
      ),
    )
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(sourceHeight - 1, y0 + 1)
    const yWeight = sourceY - y0

    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.max(
        0,
        Math.min(sourceWidth - 1, (targetX + 0.5) * scaleX - 0.5),
      )
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(sourceWidth - 1, x0 + 1)
      const xWeight = sourceX - x0

      const lowerLeft = (y0 * sourceWidth + x0) * 4
      const lowerRight = (y0 * sourceWidth + x1) * 4
      const upperLeft = (y1 * sourceWidth + x0) * 4
      const upperRight = (y1 * sourceWidth + x1) * 4
      const targetOffset = (targetY * targetWidth + targetX) * 4

      for (let channel = 0; channel < 4; channel += 1) {
        const lower = source[lowerLeft + channel] * (1 - xWeight)
          + source[lowerRight + channel] * xWeight
        const upper = source[upperLeft + channel] * (1 - xWeight)
          + source[upperRight + channel] * xWeight
        target[targetOffset + channel] = lower * (1 - yWeight) + upper * yWeight
      }
    }
  }

  return target
}

/**
 * Reads the default framebuffer synchronously in the same task as render().
 * WeChat may discard non-preserved WebGL buffers after compositing, so yielding
 * between render() and readPixels() can legitimately produce an empty image.
 */
export function captureWechatWatchSnapshotPixels(
  renderer: WatchSnapshotRenderer,
  scene: Scene,
  camera: Camera,
): WatchSnapshotFrame {
  const gl = renderer.getContext()
  const previousTarget = renderer.getRenderTarget()

  try {
    renderer.setRenderTarget(null)
    renderer.render(scene, camera)

    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    validateSourceDimensions(width, height)
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return { width, height, pixels }
  } finally {
    renderer.setRenderTarget(previousTarget)
  }
}

export function prepareWechatWatchSnapshotImage(
  options: PrepareWatchSnapshotImageOptions,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  validateSourceDimensions(options.sourceWidth, options.sourceHeight)
  if (!hasVisibleWatchSnapshotPixels(options.pixels)) {
    throw new Error('当前画面为空，无法生成微信快照')
  }

  const size = resolveWechatWatchSnapshotOutputSize(
    options.sourceWidth,
    options.sourceHeight,
    options.maxEdge,
  )
  return {
    pixels: copyFlippedResampledRgba(
      options.pixels,
      Math.floor(options.sourceWidth),
      Math.floor(options.sourceHeight),
      size.width,
      size.height,
    ),
    ...size,
  }
}

export function encodeWechatWatchSnapshotPng(
  options: EncodeWatchSnapshotPngOptions,
): Uint8Array {
  validateSourceDimensions(options.width, options.height)
  const width = Math.floor(options.width)
  const height = Math.floor(options.height)
  const expectedLength = width * height * 4
  if (options.pixels.length < expectedLength) {
    throw new Error('微信快照像素数据不完整')
  }

  const rowLength = width * 4
  const scanlines = new Uint8Array(height * (rowLength + 1))
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (rowLength + 1)
    scanlines[targetOffset] = 0
    scanlines.set(
      options.pixels.subarray(y * rowLength, (y + 1) * rowLength),
      targetOffset + 1,
    )
  }

  const header = new Uint8Array(13)
  writeUint32Be(header, 0, width)
  writeUint32Be(header, 4, height)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const chunks = [
    createPngChunk('IHDR', header),
    createPngChunk('IDAT', zlibSync(scanlines, { level: 6 })),
    createPngChunk('IEND', new Uint8Array(0)),
  ]
  const totalLength = PNG_SIGNATURE.length
    + chunks.reduce((total, chunk) => total + chunk.length, 0)
  const png = new Uint8Array(totalLength)
  let offset = 0
  png.set(PNG_SIGNATURE, offset)
  offset += PNG_SIGNATURE.length
  for (const chunk of chunks) {
    png.set(chunk, offset)
    offset += chunk.length
  }
  return png
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(type.length)
  for (let index = 0; index < type.length; index += 1) {
    typeBytes[index] = type.charCodeAt(index)
  }
  const chunk = new Uint8Array(12 + data.length)
  writeUint32Be(chunk, 0, data.length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  writeUint32Be(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

function writeUint32Be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < crcTable.length; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
      }
      crcTable[index] = value >>> 0
    }
  }

  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function resolveWechatWatchSnapshotRuntime(
  runtime: WechatWatchSnapshotRuntimeSource | null | undefined = (
    globalThis as typeof globalThis & { wx?: WechatWatchSnapshotRuntimeSource }
  ).wx,
): WechatWatchSnapshotRuntime | null {
  const userDataPath = typeof runtime?.env?.USER_DATA_PATH === 'string'
    ? runtime.env.USER_DATA_PATH.trim()
    : ''
  if (!userDataPath || typeof runtime?.getFileSystemManager !== 'function') {
    return null
  }
  try {
    return {
      userDataPath,
      fs: runtime.getFileSystemManager(),
    }
  } catch {
    return null
  }
}

export function buildWechatWatchSnapshotFilePath(
  runtime: WechatWatchSnapshotRuntime,
  fileName: string,
): string {
  const basename = fileName
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop() ?? ''
  const safeName = basename
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^\.+/, '')
    .slice(-180)
  const pngName = safeName.toLowerCase().endsWith('.png')
    ? safeName
    : `${safeName.replace(/\.+$/, '') || 'watch-snapshot'}.png`
  return `${runtime.userDataPath.replace(/\/+$/, '')}/${pngName}`
}

export async function writeWechatWatchSnapshotPngFile(
  options: WriteWatchSnapshotPngFileOptions,
): Promise<string> {
  const writeFile = options.runtime.fs.writeFile
  if (typeof writeFile !== 'function') {
    throw new Error('当前微信文件系统不支持 writeFile')
  }
  if (options.png.length === 0) {
    throw new Error('微信快照 PNG 数据为空')
  }

  const filePath = buildWechatWatchSnapshotFilePath(options.runtime, options.fileName)
  const data = new ArrayBuffer(options.png.byteLength)
  new Uint8Array(data).set(options.png)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const complete = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      callback()
    }
    try {
      writeFile({
        filePath,
        data,
        success: () => complete(resolve),
        fail: (error) => complete(() => reject(error)),
      })
    } catch (error) {
      complete(() => reject(error))
    }
  })
  return filePath
}

export async function removeWechatWatchSnapshotFile(
  runtime: WechatWatchSnapshotRuntime | null | undefined,
  filePath: string | null | undefined,
): Promise<void> {
  const normalizedPath = typeof filePath === 'string' ? filePath.trim() : ''
  const unlink = runtime?.fs.unlink
  if (!runtime || !normalizedPath || typeof unlink !== 'function') {
    return
  }

  await new Promise<void>((resolve) => {
    try {
      unlink({
        filePath: normalizedPath,
        success: resolve,
        fail: () => resolve(),
      })
    } catch {
      resolve()
    }
  })
}

export function buildWechatWatchSnapshotEntrancePath(
  page: WechatWatchSnapshotPage | null | undefined,
): string {
  const route = typeof page?.route === 'string' ? page.route.trim() : ''
  const normalizedRoute = route
    ? `/${route.replace(/^\/+/, '')}`
    : '/pages/scenery/index'
  const options = page?.options ?? page?.$page?.options ?? {}
  const query = Object.entries(options)
    .filter(([, value]) => (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ))
    .map(([key, value]) => (
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    ))
    .join('&')
  return query ? `${normalizedRoute}?${query}` : normalizedRoute
}

export function resolveWechatWatchSnapshotEntrancePath(
  pages?: WechatWatchSnapshotPage[] | null,
): string {
  const getCurrentPages = (
    globalThis as typeof globalThis & {
      getCurrentPages?: () => WechatWatchSnapshotPage[]
    }
  ).getCurrentPages
  const currentPages = pages ?? (
    typeof getCurrentPages === 'function'
      ? getCurrentPages()
      : []
  )
  return buildWechatWatchSnapshotEntrancePath(
    currentPages && currentPages.length > 0 ? currentPages[currentPages.length - 1] : null,
  )
}

export async function promptWechatWatchSnapshotShare(
  options: PromptWechatWatchSnapshotShareOptions,
): Promise<WechatWatchSnapshotShareResult> {
  const runtime = options.runtime ?? (
    globalThis as typeof globalThis & {
      wx?: WechatWatchSnapshotShareRuntime
    }
  ).wx
  const filePath = options.filePath.trim()

  if (!filePath) {
    runtime?.showToast?.({
      title: '照片尚未准备好，可从相册分享',
      icon: 'none',
    })
    return 'failed'
  }

  if (typeof runtime?.showShareImageMenu !== 'function') {
    runtime?.showToast?.({
      title: '已保存到相册',
      icon: 'success',
    })
    return 'unsupported'
  }
  const showShareImageMenu = runtime.showShareImageMenu

  let confirmed = false
  try {
    confirmed = await new Promise<boolean>((resolve, reject) => {
      if (typeof runtime.showModal !== 'function') {
        resolve(false)
        return
      }
      try {
        runtime.showModal({
          title: '照片已保存',
          content: '照片已保存到相册，要现在分享到朋友圈或发送给朋友吗？',
          confirmText: '分享照片',
          cancelText: '完成',
          showCancel: true,
          success: (result) => resolve(result.confirm === true),
          fail: reject,
        })
      } catch (error) {
        reject(error)
      }
    })
  } catch {
    runtime.showToast?.({
      title: '已保存到相册',
      icon: 'success',
    })
    return 'failed'
  }

  if (!confirmed) {
    return 'dismissed'
  }

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const complete = (callback: () => void) => {
        if (settled) {
          return
        }
        settled = true
        callback()
      }
      try {
        showShareImageMenu({
          path: filePath,
          needShowEntrance: true,
          entrancePath: options.entrancePath,
          success: () => complete(resolve),
          fail: (error) => complete(() => reject(error)),
        })
      } catch (error) {
        complete(() => reject(error))
      }
    })
    return 'opened'
  } catch {
    runtime.showToast?.({
      title: '未能打开分享面板，可从相册分享',
      icon: 'none',
    })
    return 'failed'
  }
}
