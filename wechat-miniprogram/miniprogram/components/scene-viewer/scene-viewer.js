const { createScopedThreejs } = require('threejs-miniprogram')
const { buildSceneFromBundle } = require('../../utils/scene-loader')
import { registerGLTFLoader } from '../../utils/gltf-loader'
import registerOrbit from "../../utils/orbit"

// Converted to plain JavaScript: removed TypeScript type declarations and ESM imports

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

  lifetimes: {
    ready: async function () {
      this.initializeCanvas()
    },
    detached: function () {
      this.dispose()
    },
  },

  methods: {
    touchStart(e) {
      this.canvas.dispatchTouchEvent({...e, type:'touchstart'})
    },
    touchMove(e) {
      this.canvas.dispatchTouchEvent({...e, type:'touchmove'})
    },
    touchEnd(e) {
      this.canvas.dispatchTouchEvent({...e, type:'touchend'})
    },
    initializeCanvas: async function () {
      if (this.canvas) {
        return
      }
      const query = this.createSelectorQuery()
      query
        .select('#three-canvas')
        .node()
        .exec(async (res) => {
          const entry = res && res[0]
          if (!entry) {
            this.emitLoadState('error', '无法初始化渲染画布')
            return
          }
          const canvas = entry.node
          const rect = entry
          const systemInfo = typeof wx !== 'undefined' && wx.getSystemInfoSync ? wx.getSystemInfoSync() : null
          const maxPixelRatio = this.data.maxPixelRatio || 2
          const deviceRatio = (systemInfo && systemInfo.pixelRatio) ? systemInfo.pixelRatio : 1
          const pixelRatio = Math.min(maxPixelRatio, deviceRatio)

          this.canvas = canvas
          this.canvasWidth = canvas.width
          this.canvasHeight =  canvas.height
          this.pixelRatio = pixelRatio
          this.three = createScopedThreejs(canvas)
          registerGLTFLoader(this.three)
          this.setupRenderer();
          this.scheduleSceneLoad()
        })
    },

    setupRenderer: function () {
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
      renderer.gammaOutput = true;
      renderer.gammaFactor = 2.2;
      renderer.physicallyCorrectLights = true
      renderer.setPixelRatio(this.pixelRatio ?? 1)
      renderer.setSize(this.canvasWidth ?? 1, this.canvasHeight ?? 1, false)
      this.renderer = renderer
      this.clock = new THREE.Clock()
      this.mixers = []

      this.camera = new THREE.PerspectiveCamera(45, this.canvasWidth / this.canvasHeight, 0.25, 100);
      this.camera.position.set(-5, 3, 10);
      const { OrbitControls } = registerOrbit(THREE)
      this.controls = new OrbitControls( this.camera, renderer.domElement);
    },

    registerResizeListener: function () {
      if (typeof wx === 'undefined' || !wx.onWindowResize) {
        return
      }
      this.resizeHandler = () => {
        this.updateRendererSize()
      }
      wx.onWindowResize(this.resizeHandler)
    },

    updateRendererSize: function () {
      if (!this.renderer || !this.canvas) {
        return
      }
      const query = this.createSelectorQuery()
      query
        .select('#three-canvas')
        .boundingClientRect((rect) => {
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

    scheduleSceneLoad: function () {
      if (this.loadTimer) {
        clearTimeout(this.loadTimer)
      }
      this.loadTimer = setTimeout(() => {
        this.loadTimer = null
        this.loadScene()
      }, 20)
    },

    loadScene: async function () {
      if (!this.three || !this.canvas) {
        return
      }

      const bundle = this.data.sceneBundle || null
      if (!bundle) {
        this.disposeScene()
        return
      }
      const sceneId = this.data.sceneId || bundle.id
      if (!sceneId) {
        this.emitLoadState('error', '场景信息缺失')
        return
      }
      this.emitLoadState('loading', '场景加载中...')
      this.setData({ loading: true, errorMessage: '' })
      this.disposeScene()

      try {
        const result = await buildSceneFromBundle(this.three, this.canvas, bundle, {
          sceneId,
          enableShadows: this.data.enableShadows,
        })
        
        this.applySceneResult(result)
        this.startRenderLoop()
        this.emitLoadState('ready', `场景「${result.sceneName}」加载完成`)
        this.setData({ loading: false, errorMessage: '' })
      } catch (error) {
        const message = (error && error.message) ? error.message : '未知错误'
        this.setData({ loading: false, errorMessage: message })
        this.emitLoadState('error', `加载失败: ${message}`)
      }
    },

    applySceneResult: function (result) {
      const THREE = this.three
      const scope = this;
      // this.scene = result.scene
      scope.scene = new THREE.Scene();
      scope.scene.background = new THREE.Color(0xe0e0e0);
      scope.scene.fog = new THREE.Fog(0xe0e0e0, 20, 100);
      var light = new THREE.HemisphereLight(0xffffff, 0x444444);
      light.position.set(0, 20, 0);
      scope.scene.add(light);
      light = new THREE.DirectionalLight(0xffffff);
      light.position.set(0, 20, 10);
      scope.scene.add(light);

       // ground
      var mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2000, 2000), new THREE.MeshPhongMaterial({ color: 0x999999, depthWrite: false }));
      mesh.rotation.x = - Math.PI / 2;
      scope.scene.add(mesh);
      var grid = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
      grid.material.opacity = 0.2;
      grid.material.transparent = true;
      scope.scene.add(grid);

      var mesh1 = new THREE.Mesh( new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xff0000, depthWrite: false }));
      scope.scene.add(mesh1);

      // var loader = new THREE.GLTFLoader();
      // loader.load('https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb', function (gltf) {
      //   model = gltf.scene;
      //   console.log("dddddddddddddddddddddddddddddd lksjdfl")

      //   scope.scene.add(model);
      // }, undefined, function (e) {
      //   console.error(e);
      // });

      // this.camera = result.camera
      // this.mixers = result.mixers ?? []

      // this.scene.background = this.scene.background ?? new THREE.Color('#101720')

      // const OrbitControlsCtor = THREE.OrbitControls as unknown as new (camera: any, domElement: any) => OrbitControls
    
      // if (OrbitControlsCtor) {
      //   this.controls = new OrbitControlsCtor(this.camera, this.canvas)
      //   this.controls.enableDamping = true
      //   this.controls.dampingFactor = 0.08
      //   this.controls.enablePan = true
      //   this.controls.minDistance = 1
      //   this.controls.maxDistance = 800
      //   this.controls.maxPolarAngle = Math.PI * 0.495
      //   if (result.cameraTarget) {
      //     this.controls.target.copy(result.cameraTarget)
      //   }
      //   this.controls.update()
      // }
    },

    startRenderLoop: function () {
      const scope = this;

      if (!scope.canvas) {
        return
      }
      if (scope.frameId) {
        scope.canvas.cancelAnimationFrame(scope.frameId)
      }
      const step = () => {
        scope.frameId = scope.canvas.requestAnimationFrame(step)
        if (!scope.renderer || !scope.scene || !scope.camera) {
          return
        }
        const delta = scope.clock ? scope.clock.getDelta() : 0
        if (scope.mixers?.length) {
          scope.mixers.forEach((mixer) => mixer?.update?.(delta))
        }
        scope.controls?.update?.()
        scope.renderer.render(scope.scene, scope.camera)
      }
      scope.frameId = scope.canvas.requestAnimationFrame(step)
    },

    emitLoadState: function (state, message) {
      this.triggerEvent('loadstate', { state, message })
    },

    disposeScene: function () {
      if (!this.scene || !this.three) {
        return
      }
      const THREE = this.three
      this.scene.traverse((object) => {
        if (object && object.geometry) {
          object.geometry.dispose?.()
        }
        if (object && object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material?.dispose?.())
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

    dispose: function () {
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
