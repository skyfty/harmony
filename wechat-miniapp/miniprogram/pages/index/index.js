const fs = wx.getFileSystemManager()
const { createScopedThreejs, registerGLTFLoader, registerTextureLoader } = require('threejs-miniprogram')
const { parseScenePayload, mergeScenes } = require('../../utils/scene-parser.js')
const { ResourceManager } = require('../../utils/resource-manager.js')
const { buildSceneGraph, applyCameraState } = require('../../utils/scene-builder.js')
const { FirstPersonController } = require('../../utils/first-person-controller.js')

function showErrorToast(message) {
  wx.showToast({ title: message, icon: 'none', duration: 2500 })
}

Page({
  data: {
    sceneList: [],
    activeSceneId: null,
    loadUrl: '',
    loadingState: { visible: false, percent: 0, message: '' },
  },

  onLoad() {
    this._sceneRoot = null
    this._rendererLoopHandle = null
    this._resourceManager = null
    this._threeReady = this.initThreeContext()
  },

  onUnload() {
    if (this._animationFrameId) {
      this._canvas.cancelAnimationFrame(this._animationFrameId)
    }
    this._three?.controller?.dispose?.()
    if (typeof wx.offWindowResize === 'function' && this._resizeHandler) {
      wx.offWindowResize(this._resizeHandler)
    }
  },

  async initThreeContext() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#scene-canvas')
        .node()
        .exec((res) => {
          if (!res || !res.length) {
            reject(new Error('无法获取 canvas 节点'))
            return
          }
          const canvas = res[0].node
          const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
          canvas.width = info.windowWidth
          canvas.height = info.windowHeight * 0.6

          const THREE = createScopedThreejs(canvas)
          try {
            registerGLTFLoader(THREE)
          } catch (error) {
            console.warn('GLTFLoader 注册失败', error)
          }
          try {
            registerTextureLoader(THREE)
          } catch (error) {
            console.warn('TextureLoader 注册失败', error)
          }

          const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
          renderer.setPixelRatio(info.pixelRatio)
          renderer.setSize(canvas.width, canvas.height)
          renderer.shadowMap.enabled = true

          const scene = new THREE.Scene()
          scene.background = new THREE.Color('#0f172a')

          const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 2000)
          camera.position.set(0, 2, 8)

          const ambient = new THREE.AmbientLight(0xffffff, 0.5)
          const directional = new THREE.DirectionalLight(0xffffff, 0.6)
          directional.position.set(8, 12, 8)
          directional.castShadow = true
          scene.add(ambient)
          scene.add(directional)

          const controller = new FirstPersonController(canvas, camera, THREE)
          controller.setSize(canvas.width, canvas.height)

          this._canvas = canvas
          this._three = { THREE, renderer, scene, camera, controller }
          this._clock = new THREE.Clock()
          this._resizeHandler = (event) => {
            const sizeInfo = event?.size || (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync())
            const width = sizeInfo.windowWidth || canvas.width
            const height = (sizeInfo.windowHeight || canvas.height) * 0.6
            canvas.width = width
            canvas.height = height
            renderer.setSize(width, height)
            camera.aspect = width / height
            camera.updateProjectionMatrix()
            controller.setSize(width, height)
          }
          if (typeof wx.onWindowResize === 'function') {
            wx.onWindowResize(this._resizeHandler)
          }
          this.startRenderLoop()
          resolve()
        })
    })
  },

  startRenderLoop() {
    const { renderer, scene, camera, controller } = this._three
    const loop = () => {
      const delta = this._clock.getDelta?.() ?? 0.016
      controller.update(delta)
      renderer.render(scene, camera)
      this._animationFrameId = this._canvas.requestAnimationFrame(loop)
    }
    loop()
  },

  setLoadingState(visible, message, percent) {
    this.setData({
      loadingState: {
        visible,
        message,
        percent: Math.min(100, Math.max(0, Math.round(percent))),
      },
    })
  },

  async loadSceneById(sceneId) {
    await this._threeReady
    const sceneDocument = this.data.sceneList.find((item) => item.id === sceneId)
    if (!sceneDocument) {
      showErrorToast('场景不存在或已被移除')
      return
    }
    this.setLoadingState(true, '准备加载资源…', 5)

    try {
      const resourceManager = new ResourceManager(sceneDocument)
      this._resourceManager = resourceManager
      await resourceManager.preloadAll({
        onProgress: (ratio, info) => {
          const message = info?.assetId ? `加载资源 ${info.current}/${info.total}` : '加载资源…'
          this.setLoadingState(true, message, 5 + ratio * 70)
        },
      })

      const { THREE } = this._three
      const gltfCtor = THREE.GLTFLoader || (THREE.loaders && THREE.loaders.GLTFLoader)
      if (!gltfCtor) {
        throw new Error('GLTFLoader 未注册')
      }
      const textureCtor = THREE.TextureLoader || (THREE.loaders && THREE.loaders.TextureLoader)
      if (!textureCtor) {
        throw new Error('TextureLoader 未注册')
      }
      const loaders = {
        gltf: new gltfCtor(),
      }
      const textureLoader = new textureCtor()

      const sceneRoot = await buildSceneGraph({
        THREE,
        loaders,
        textureLoader,
        resourceManager,
        sceneDocument,
      })

      if (this._sceneRoot) {
        this._three.scene.remove(this._sceneRoot)
      }
      this._sceneRoot = sceneRoot
      this._three.scene.add(sceneRoot)

      applyCameraState(this._three.camera, sceneDocument)
      this._three.controller.resetOrientation(this._three.camera)

      this.setData({ activeSceneId: sceneDocument.id })
      this.setLoadingState(false, '', 100)
    } catch (error) {
      console.warn('加载场景失败', error)
      this.setLoadingState(false, '', 0)
      showErrorToast(error.message || '加载场景失败')
    }
  },

  async handleSelectScene(event) {
    const sceneId = event.currentTarget.dataset.id
    if (!sceneId || sceneId === this.data.activeSceneId) {
      return
    }
    await this.loadSceneById(sceneId)
  },

  async handleChooseFile() {
    try {
      const result = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'] })
      if (!result.tempFiles?.length) {
        return
      }
      const file = result.tempFiles[0]
      const content = fs.readFileSync(file.path, 'utf8')
      await this.loadScenesFromContent(content)
    } catch (error) {
      console.warn('读取文件失败', error)
      showErrorToast('导入场景失败')
    }
  },

  handleUrlInput(event) {
    this.setData({ loadUrl: event.detail.value })
  },

  async handleLoadFromUrl() {
    const url = (this.data.loadUrl || '').trim()
    if (!url) {
      showErrorToast('请输入有效的 URL')
      return
    }
    this.setLoadingState(true, '正在下载场景文件…', 10)
    try {
      const tempFile = await this.downloadSceneFile(url)
      const content = fs.readFileSync(tempFile, 'utf8')
      await this.loadScenesFromContent(content)
    } catch (error) {
      console.warn('下载场景失败', error)
      showErrorToast('下载场景失败')
    } finally {
      this.setLoadingState(false, '', 0)
    }
  },

  downloadSceneFile(url) {
    return new Promise((resolve, reject) => {
      const task = wx.downloadFile({
        url,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve(res.tempFilePath)
          } else {
            reject(new Error(`下载失败：${res.statusCode}`))
          }
        },
        fail: reject,
      })
      task.onProgressUpdate?.((progress) => {
        this.setLoadingState(true, `下载中 ${progress.progress}%`, 10 + progress.progress * 0.6)
      })
    })
  },

  async loadScenesFromContent(content) {
    try {
      const scenes = parseScenePayload(content)
      const merged = mergeScenes(this.data.sceneList, scenes)
      this.setData({ sceneList: merged })
      if (!this.data.activeSceneId && merged.length) {
        await this.loadSceneById(merged[0].id)
      }
      wx.showToast({ title: `加载成功 ${scenes.length} 个场景`, icon: 'success', duration: 1800 })
    } catch (error) {
      console.warn('解析场景失败', error)
      showErrorToast('解析场景文件失败')
    }
  },

  async handleResetCamera() {
    await this._threeReady
    const activeScene = this.data.sceneList.find((item) => item.id === this.data.activeSceneId)
    if (activeScene) {
      applyCameraState(this._three.camera, activeScene)
    } else {
      this._three.camera.position.set(0, 2, 8)
      this._three.camera.lookAt(0, 0, 0)
    }
    this._three.controller.resetOrientation(this._three.camera)
  },
})
