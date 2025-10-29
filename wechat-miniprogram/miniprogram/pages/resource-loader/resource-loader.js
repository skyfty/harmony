const resourceCache = require('../../utils/resource-cache')

function clampPercent(value) {
  if (value <= 0 || !Number.isFinite(value)) {
    return 0
  }
  if (value >= 100) {
    return 100
  }
  return Math.min(100, Math.max(0, Math.round(value)))
}

Page({
  data: {
    sceneId: '',
    sceneName: '',
    totalAssets: 0,
    completedAssets: 0,
    failedAssets: 0,
    progressPercent: 0,
    currentAssetId: '',
    statusMessage: '准备预加载资源...',
    loading: true,
  },

  onLoad(options) {
    const app = getApp()
    const bundle = app?.globalData?.currentBundle ?? null
    const sceneId = options?.sceneId ?? app?.globalData?.currentSceneId ?? ''
    const sceneName = app?.globalData?.currentSceneName ?? bundle?.name ?? ''

    if (!bundle || !sceneId) {
      this.setData({ statusMessage: '未找到场景数据', loading: false })
      setTimeout(() => {
        if (wx && wx.navigateBack) {
          wx.navigateBack({ delta: 1 })
        }
      }, 1500)
      return
    }

    this.bundle = bundle
    this.sceneId = sceneId
    this._cancelled = false
    this._completed = false

    this.setData({
      sceneId,
      sceneName: sceneName || '未命名场景',
      totalAssets: resourceCache.collectSceneAssetIds(bundle).length,
    })

    this.startPreload()
  },
  async startPreload() {
    const bundle = this.bundle
    const sceneId = this.sceneId
    if (!bundle || !sceneId) {
      return
    }
    const updateProgress = (detail) => {
      if (this._cancelled) {
        return
      }
      const { assetId, status, completed, total, failed } = detail
      if (status === 'start') {
        this.setData({
          currentAssetId: assetId,
          statusMessage: `加载 ${assetId}`,
        })
        return
      }
      if (status === 'success') {
        const percent = total ? clampPercent((completed / total) * 100) : 100
        this.setData({
          completedAssets: completed,
          totalAssets: total,
          failedAssets: failed,
          progressPercent: percent,
          currentAssetId: assetId,
          statusMessage: `已缓存 ${completed}/${total}`,
        })
        return
      }
      if (status === 'error') {
        const percent = total ? clampPercent((completed / total) * 100) : this.data.progressPercent
        this.setData({
          completedAssets: completed,
          totalAssets: total,
          failedAssets: failed,
          progressPercent: percent,
          currentAssetId: assetId,
          statusMessage: `资源下载失败: ${assetId}`,
        })
        return
      }
      if (status === 'skip') {
        const percent = total ? clampPercent((completed / total) * 100) : this.data.progressPercent
        this.setData({
          completedAssets: completed,
          totalAssets: total,
          progressPercent: percent,
          currentAssetId: assetId,
        })
      }
    }

    let result
    try {
      result = await resourceCache.preloadSceneResources(sceneId, bundle, {
        onProgress: updateProgress,
        shouldCancel: () => this._cancelled,
      })
    } catch (error) {
      if (this._cancelled) {
        return
      }
      this.setData({
        statusMessage: error?.message || error?.errMsg || '预加载失败',
        loading: false,
      })
      return
    }

    if (this._cancelled) {
      return
    }

    const { total, completed, failed, cancelled } = result
    const percent = total ? clampPercent((completed / total) * 100) : 100
    const finishedMessage = failed
      ? `预加载完成，但有 ${failed} 个资源失败`
      : '预加载完成'
    this.setData({
      completedAssets: completed,
      failedAssets: failed,
      totalAssets: total,
      progressPercent: percent,
      statusMessage: finishedMessage,
      loading: false,
    })

    this._completed = !cancelled

    if (cancelled) {
      return
    }

    setTimeout(() => {
      if (this._cancelled) {
        return
      }
      wx.redirectTo({
        url: '/pages/viewer/viewer?sceneId=' + encodeURIComponent(sceneId),
      })
    }, 500)
  },

  handleCancel() {
    if (this._cancelled) {
      return
    }
    this._cancelled = true
    if (wx && wx.navigateBack) {
      wx.navigateBack({ delta: 1 })
    }
  },

  onUnload() {
    if (!this._completed && this.sceneId) {
      resourceCache.releaseSceneResources(this.sceneId)
    }
    this._cancelled = true
  },
})
