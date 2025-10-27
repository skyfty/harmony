import {createScopedThreejs} from 'threejs-miniprogram'
import { buildSceneFromBundle, type SceneBuildResult } from '../../utils/scene-loader'
import type { SceneBundle } from '../../utils/scene-types'

declare const Component: <TProps, TData, TMethods>(options: any) => void
declare const wx: any
declare function require(path: string): any

type OrbitControls = {
  target: any
  enableDamping: boolean
  dampingFactor: number
  enablePan: boolean
  minDistance: number
  maxDistance: number
  maxPolarAngle: number
  update: () => void
  dispose?: () => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

type ScheduledLoad = ReturnType<typeof setTimeout> | null

type CanvasElement = any

type ScopedThree = ReturnType<typeof createScopedThreejs>

Component({
  properties: {
    sceneBundle: {
      type: Object,
      value: null,
    },
    sceneId: {
      type: String,
      value: '',
    },
    enableShadows: {
      type: Boolean,
      value: true,
    },
    maxPixelRatio: {
      type: Number,
      value: 2,
    },
  },

  data: {
    loading: false,
    errorMessage: '',
  },

  observers: {
    'sceneBundle, sceneId': function (this: any) {
      this.scheduleSceneLoad()
    },
  },

  lifetimes: {
    async ready(this: any) {
      await this.initializeCanvas()
      this.scheduleSceneLoad()
    },
    detached(this: any) {
      this.dispose()
    },
  },

  methods: {
    async initializeCanvas(this: any) {
      if (this.canvas) {
        return
      }
      const query = this.createSelectorQuery()
      query
        .select('#three-canvas')
        .node()
        .exec(async (res: any[]) => {
          const entry = res?.[0]
          if (!entry) {
            this.emitLoadState('error', '无法初始化渲染画布')
            return
          }
          const canvas = entry.node as CanvasElement
          const rect = entry
          const systemInfo = typeof wx !== 'undefined' && wx.getSystemInfoSync ? wx.getSystemInfoSync() : null
          const maxPixelRatio = this.data.maxPixelRatio || 2
          const deviceRatio = systemInfo?.pixelRatio ?? 1
          const pixelRatio = Math.min(maxPixelRatio, deviceRatio)

          canvas.width = rect.width * pixelRatio
          canvas.height = rect.height * pixelRatio

          this.canvas = canvas
          this.canvasWidth = rect.width
          this.canvasHeight = rect.height
          this.pixelRatio = pixelRatio

          this.three = createScopedThreejs(canvas)
          this.registerExtensions(this.three)
          this.setupRenderer()
          this.startRenderLoop()
          this.registerResizeListener()
        })
    },

    registerExtensions(this: any, THREE: ScopedThree) {
      try {
        const registerOrbitControls = require('threejs-miniprogram/plugins/OrbitControls')
        registerOrbitControls(THREE)
      } catch (error) {
        console.warn('OrbitControls 模块加载失败', error)
      }
      try {
        const registerGLTFLoader = require('threejs-miniprogram/loaders/GLTFLoader')
        registerGLTFLoader(this.three)
      } catch (error) {
        console.warn('GLTFLoader 模块加载失败', error)
      }
    },

    setupRenderer(this: any) {
      if (!this.three || !this.canvas) {
        return
      }
      const THREE = this.three
      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
      })
      renderer.shadowMap.enabled = this.data.enableShadows ?? true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.outputEncoding = THREE.sRGBEncoding
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.0
      renderer.physicallyCorrectLights = true
      renderer.setPixelRatio(this.pixelRatio ?? 1)
      renderer.setSize(this.canvasWidth ?? 1, this.canvasHeight ?? 1, false)

      this.renderer = renderer
      this.clock = new THREE.Clock()
      this.mixers = []
    },

    registerResizeListener(this: any) {
      if (typeof wx === 'undefined' || !wx.onWindowResize) {
        return
      }
      this.resizeHandler = () => {
        this.updateRendererSize()
      }
      wx.onWindowResize(this.resizeHandler)
    },

    updateRendererSize(this: any) {
      if (!this.renderer || !this.canvas) {
        return
      }
      const query = this.createSelectorQuery()
      query
        .select('#three-canvas')
        .boundingClientRect((rect: any) => {
          if (!rect) {
            return
          }
          const width = rect.width
          const height = rect.height
          const pixelRatio = this.pixelRatio ?? 1
          this.canvas.width = width * pixelRatio
          this.canvas.height = height * pixelRatio
          this.renderer.setPixelRatio(pixelRatio)
          this.renderer.setSize(width, height, false)
          if (this.camera) {
            this.camera.aspect = width / height
            this.camera.updateProjectionMatrix()
          }
        })
        .exec()
    },

    scheduleSceneLoad(this: any) {
      if (this.loadTimer) {
        clearTimeout(this.loadTimer)
      }
      this.loadTimer = setTimeout(() => {
        this.loadTimer = null
        this.loadScene()
      }, 20) as ScheduledLoad
    },

    async loadScene(this: any) {
      if (!this.three || !this.canvas) {
        return
      }
      const bundle = this.data.sceneBundle as SceneBundle | null
      if (!bundle || !bundle.scenes?.length) {
        this.disposeScene()
        return
      }
      const sceneId = this.data.sceneId || bundle.scenes[0]?.id
      if (!sceneId) {
        this.emitLoadState('error', '场景信息缺失')
        return
      }

      this.emitLoadState('loading', '场景加载中...')
      this.setData({ loading: true, errorMessage: '' })

      this.disposeScene()

      try {
        const result: SceneBuildResult = await buildSceneFromBundle(this.three, this.canvas, bundle, {
          sceneId,
          enableShadows: this.data.enableShadows,
        })
        this.applySceneResult(result)
        this.emitLoadState('ready', `场景「${result.sceneName}」加载完成`)
        this.setData({ loading: false, errorMessage: '' })
      } catch (error) {
        const message = (error as Error).message ?? '未知错误'
        this.setData({ loading: false, errorMessage: message })
        this.emitLoadState('error', `加载失败: ${message}`)
      }
    },

    applySceneResult(this: any, result: SceneBuildResult) {
      if (!this.three || !this.renderer) {
        return
      }
      this.scene = result.scene
      this.camera = result.camera
      this.mixers = result.mixers ?? []

      const THREE = this.three
      this.scene.background = this.scene.background ?? new THREE.Color('#101720')

      const OrbitControlsCtor = THREE.OrbitControls as unknown as new (camera: any, domElement: any) => OrbitControls
      if (OrbitControlsCtor) {
        this.controls = new OrbitControlsCtor(this.camera, this.canvas)
        this.controls.enableDamping = true
        this.controls.dampingFactor = 0.08
        this.controls.enablePan = true
        this.controls.minDistance = 1
        this.controls.maxDistance = 800
        this.controls.maxPolarAngle = Math.PI * 0.495
        if (result.cameraTarget) {
          this.controls.target.copy(result.cameraTarget)
        }
        this.controls.update()
      }
    },

    startRenderLoop(this: any) {
      if (!this.canvas) {
        return
      }
      if (this.frameId) {
        this.canvas.cancelAnimationFrame(this.frameId)
      }
      const step = () => {
        this.frameId = this.canvas.requestAnimationFrame(step)
        if (!this.renderer || !this.scene || !this.camera) {
          return
        }
        const delta = this.clock ? this.clock.getDelta() : 0
        if (this.mixers?.length) {
          this.mixers.forEach((mixer: any) => mixer?.update?.(delta))
        }
        this.controls?.update?.()
        this.renderer.render(this.scene, this.camera)
      }
      this.frameId = this.canvas.requestAnimationFrame(step)
    },

    emitLoadState(this: any, state: LoadState, message?: string) {
      this.triggerEvent('loadstate', { state, message })
    },

    disposeScene(this: any) {
      if (!this.scene || !this.three) {
        return
      }
      const THREE = this.three
      this.scene.traverse((object: any) => {
        if (object && object.geometry) {
          object.geometry.dispose?.()
        }
        if (object && object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material: any) => material?.dispose?.())
          } else {
            object.material.dispose?.()
          }
        }
      })
      this.controls?.dispose?.()
      this.controls = null
      this.scene = null
      this.camera = null
      this.mixers = []
    },

    dispose(this: any) {
      if (this.loadTimer) {
        clearTimeout(this.loadTimer)
        this.loadTimer = null
      }
      if (this.frameId && this.canvas) {
        this.canvas.cancelAnimationFrame(this.frameId)
        this.frameId = null
      }
      if (typeof wx !== 'undefined' && wx.offWindowResize && this.resizeHandler) {
        wx.offWindowResize(this.resizeHandler)
      }
      this.disposeScene()
      if (this.renderer) {
        this.renderer.dispose?.()
        this.renderer = null
      }
      this.canvas = null
      this.three = null
    },
  },
})
