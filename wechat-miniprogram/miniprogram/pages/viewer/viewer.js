const resourceCache = require('../../utils/resource-cache')

Page({
  data: {
    currentBundle: null,
    sceneId: '',
    statusMessage: '',
  },

  onLoad(options) {
    const app = getApp();
    const bundle = app?.globalData?.currentBundle ?? null;
    const sceneId = options?.sceneId ?? app?.globalData?.currentSceneId ?? '';
    this.setData({ currentBundle: bundle, sceneId });
  },

  onUnload() {
    if (this.data.sceneId) {
      resourceCache.releaseSceneResources(this.data.sceneId);
    }
  },

  handleViewerState(event) {
    const detail = event.detail;
    if (!detail) return;
    switch (detail.state) {
      case 'loading':
        this.setData({ statusMessage: detail.message ?? '场景加载中...' });
        break;
      case 'ready':
        this.setData({ statusMessage: detail.message ?? '场景加载完成' });
        break;
      case 'error':
        this.setData({ statusMessage: detail.message ?? '场景加载失败' });
        break;
    }
  },
});
