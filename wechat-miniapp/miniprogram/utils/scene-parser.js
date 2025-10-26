function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSceneDocument(entry) {
  if (!isObject(entry)) {
    throw new Error('无效的场景数据：缺少基础字段')
  }
  if (!Array.isArray(entry.nodes)) {
    throw new Error('无效的场景数据：缺少节点列表')
  }
  if (typeof entry.id !== 'string') {
    entry.id = `scene-${Math.random().toString(36).slice(2)}`
  }
  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    entry.name = '未命名场景'
  }
  if (!entry.packageAssetMap || typeof entry.packageAssetMap !== 'object') {
    entry.packageAssetMap = {}
  }
  if (!isObject(entry.assetCatalog)) {
    entry.assetCatalog = {}
  }
  if (!isObject(entry.assetIndex)) {
    entry.assetIndex = {}
  }
  if (!Array.isArray(entry.materials)) {
    entry.materials = []
  }
  if (!isObject(entry.camera)) {
    entry.camera = {
      position: { x: 0, y: 2, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
    }
  }
  entry.updatedAt = entry.updatedAt || new Date().toISOString()
  return entry
}

function flattenCatalog(catalog) {
  const map = {}
  Object.values(catalog).forEach((list) => {
    if (!Array.isArray(list)) {
      return
    }
    list.forEach((asset) => {
      if (asset && asset.id) {
        map[asset.id] = asset
      }
    })
  })
  return map
}

export function parseScenePayload(raw) {
  if (!raw) {
    throw new Error('场景文件为空')
  }

  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw
  const scenesArray = Array.isArray(payload?.scenes) ? payload.scenes : Array.isArray(payload) ? payload : [payload]
  const normalizedScenes = scenesArray.map((scene) => normalizeSceneDocument(scene))
  normalizedScenes.forEach((scene) => {
    scene.__assetMap = flattenCatalog(scene.assetCatalog)
  })
  return normalizedScenes
}

export function mergeScenes(existingList, incoming) {
  const map = new Map()
  existingList.forEach((scene) => {
    map.set(scene.id, scene)
  })
  incoming.forEach((scene) => {
    map.set(scene.id, scene)
  })
  return Array.from(map.values())
}
