const LOCAL_PREFIX = 'local::'
const fs = wx.getFileSystemManager()
const USER_PATH = `${wx.env.USER_DATA_PATH}/harmony-assets`

function ensureUserPath() {
  try {
    fs.accessSync(USER_PATH)
  } catch (error) {
    try {
      fs.mkdirSync(USER_PATH, true)
    } catch (mkdirError) {
      console.warn('无法创建资源目录', mkdirError)
    }
  }
}

function dataUrlToArrayBuffer(dataUrl) {
  const [prefix, base64] = dataUrl.split(',')
  if (!prefix || !base64) {
    throw new Error('无效的 DataURL')
  }
  const matches = /data:(.*);base64/.exec(prefix)
  const mime = matches ? matches[1] : 'application/octet-stream'
  const buffer = wx.base64ToArrayBuffer(base64)
  return { buffer, mime }
}

function writeAssetFile(assetId, payload) {
  ensureUserPath()
  const filePath = `${USER_PATH}/${assetId}`
  try {
    try {
      fs.accessSync(filePath)
    } catch (accessError) {
      fs.writeFileSync(filePath, payload.buffer)
    }
  } catch (error) {
    console.warn('写入资源文件失败', assetId, error)
    throw error
  }
  return { path: filePath, mime: payload.mime }
}

function normalizeUrl(input) {
  if (!input || typeof input !== 'string') {
    return null
  }
  const trimmed = input.trim()
  return trimmed.length ? trimmed : null
}

function collectSceneAssetIds(scene) {
  const ids = new Set()
  Object.keys(scene.assetIndex || {}).forEach((assetId) => ids.add(assetId))
  const collectNode = (node) => {
    if (!node) {
      return
    }
    if (node.sourceAssetId) {
      ids.add(node.sourceAssetId)
    }
    if (Array.isArray(node.materials)) {
      node.materials.forEach((material) => {
        Object.values(material?.textures || {}).forEach((ref) => {
          if (ref?.assetId) {
            ids.add(ref.assetId)
          }
        })
      })
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(collectNode)
    }
  }
  ;(scene.nodes || []).forEach(collectNode)
  return ids
}

async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const task = wx.downloadFile({
      url,
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.tempFilePath)
        } else {
          reject(new Error(`下载失败：${res.statusCode}`))
        }
      },
      fail(error) {
        reject(error)
      },
    })
    task.onProgressUpdate?.(() => {})
  })
}

export class ResourceManager {
  constructor(scene) {
    this.scene = scene
    this.assetMap = scene.__assetMap || {}
    this.cache = new Map()
    ensureUserPath()
  }

  async preloadAll({ onProgress } = {}) {
    const assetIds = Array.from(collectSceneAssetIds(this.scene))
    if (!assetIds.length) {
      onProgress?.(1, { current: 0, total: 0, assetId: null })
      return
    }
    let processed = 0
    const total = assetIds.length
    for (const assetId of assetIds) {
      try {
        await this.ensureAsset(assetId)
      } catch (error) {
        console.warn('预加载资源失败', assetId, error)
      } finally {
        processed += 1
        onProgress?.(processed / total, { current: processed, total, assetId })
      }
    }
  }

  async ensureAsset(assetId) {
    if (this.cache.has(assetId)) {
      return this.cache.get(assetId)
    }
    const embeddedKey = `${LOCAL_PREFIX}${assetId}`
    const embeddedUrl = this.scene.packageAssetMap?.[embeddedKey]
    if (embeddedUrl) {
      const payload = dataUrlToArrayBuffer(embeddedUrl)
      const stored = writeAssetFile(assetId, payload)
      const result = { path: stored.path, mime: stored.mime, source: 'embedded' }
      this.cache.set(assetId, result)
      return result
    }

    const assetMeta = this.assetMap[assetId] || null
    const downloadUrl = normalizeUrl(assetMeta?.downloadUrl) || normalizeUrl(assetMeta?.description)
    if (!downloadUrl) {
      throw new Error(`资源 ${assetId} 缺少可用数据`)
    }
    const tempFile = await downloadFile(downloadUrl)
    this.cache.set(assetId, { path: tempFile, mime: assetMeta?.mimeType || null, source: 'remote' })
    return this.cache.get(assetId)
  }

  getAssetInfo(assetId) {
    return this.assetMap[assetId] || null
  }
}
