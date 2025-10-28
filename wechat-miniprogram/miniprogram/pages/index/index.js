
const { parseSceneBundle } = require('../../utils/scene-loader')

const pageState = {
  registry: new Map(),
  order: [],
}

function composeSceneSummary(scene) {
  const nodeCount = scene.nodes?.length ?? 0
  const updated = scene.updatedAt ? scene.updatedAt.slice(0, 10) : '未知'
  return `节点 ${nodeCount} · 更新 ${updated}`
}

function registerBundle(scene) {
  const sceneId = scene.id
  const entry = {
    id: sceneId,
    bundle: scene,
    name: scene.name,
    summary: composeSceneSummary(scene),
  }
  if (pageState.registry.has(sceneId)) {
    // preserve ordering; simply replace stored entry with updated info
    pageState.registry.set(sceneId, entry)
  } else {
    pageState.order.push(sceneId)
    pageState.registry.set(sceneId, entry)
  }
  return sceneId
  
  // return firstKey
}

function buildOptionList() {
  return pageState.order
    .map((key) => pageState.registry.get(key))
    .filter((entry) => Boolean(entry))
    .map((entry) => ({ id: entry.id, name: entry.name, summary: entry.summary, bundle: entry.bundle }))
}

function findEntryByKey(key) {
  return pageState.registry.get(key) ?? null
}
Page({
  data: {
    sceneOptions: [],
    selectedSceneId: '',
    currentBundle: null,
    sceneUrl: '',
    statusMessage: '',
  },

  onLoad() {
    pageState.registry.clear()
    pageState.order.length = 0

    const options = buildOptionList()
    this.setData({
      sceneOptions: options,
    })
  },

  handleSelectScene(event) {
    const key = event.currentTarget?.dataset?.id
    if (!key) {
      return
    }
    const entry = findEntryByKey(key)
    if (!entry) {
      this.setData({ statusMessage: '未找到选中的场景条目' })
      return
    }
    this.setData({
      selectedSceneId: entry.id,
      currentBundle: entry.bundle,
      statusMessage: `场景「${entry.name}」加载中...`,
    })
  },

  handleChooseLocal() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (result) => {
        const file = result.tempFiles?.[0]
        if (!file) {
          this.setData({ statusMessage: '未选择文件' })
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf-8',
          success: (readRes) => {
            const content = readRes.data
            this.loadBundleFromString(content, file.name || 'local')
          },
          fail: (error) => {
            this.setData({ statusMessage: `读取文件失败: ${error.errMsg}` })
          },
        })
      },
      fail: (error) => {
        if (error && error.errMsg?.includes('cancel')) {
          this.setData({ statusMessage: '已取消选择文件' })
        } else {
          this.setData({ statusMessage: `选择文件失败: ${error?.errMsg ?? '未知错误'}` })
        }
      },
    })
  },

  handleUrlInput(event) {
    this.setData({ sceneUrl: event.detail.value })
  },

  handleLoadFromUrl() {
    const url = (this.data.sceneUrl || '').trim()
    if (!url) {
      this.setData({ statusMessage: '请输入有效的场景 JSON URL' })
      return
    }
    this.setData({ statusMessage: '正在下载场景...' })
    wx.request({
      url,
      method: 'GET',
      responseType: 'text',
      success: (res) => {
        if (res.statusCode === 200 && typeof res.data === 'string') {
          this.loadBundleFromString(res.data, url)
        } else {
          this.setData({ statusMessage: `下载失败 (${res.statusCode})` })
        }
      },
      fail: (error) => {
        this.setData({ statusMessage: `请求失败: ${error.errMsg ?? error}` })
      },
    })
  },

  loadBundleFromString(content, origin) {
    let parsed
    try {
      parsed = parseSceneBundle(content)
    } catch (error) {
      this.setData({ statusMessage: `解析场景失败: ${error?.message ?? error}` })
      return
    }
    const firstKey = registerBundle(parsed)
    const options = buildOptionList()
    const entry = firstKey ? findEntryByKey(firstKey) : null
    this.setData({
      sceneOptions: options,
      selectedSceneId: entry?.id ?? this.data.selectedSceneId,
      currentBundle: entry?.bundle ?? this.data.currentBundle,
      statusMessage: entry ? `已导入场景「${entry.name}」` : '场景导入成功',
    })
  },

  handleViewerState(event) {
    const detail = event.detail
    if (!detail) {
      return
    }
    switch (detail.state) {
      case 'loading':
        this.setData({ statusMessage: detail.message ?? '场景加载中...' })
        break
      case 'ready':
        this.setData({ statusMessage: detail.message ?? '场景加载完成' })
        break
      case 'error':
        this.setData({ statusMessage: detail.message ?? '场景加载失败' })
        break
      default:
        break
    }
  },
})
