const { createScopedThreejs } = require('threejs-miniprogram')
const { buildSceneFromBundle } = require('../../utils/scene-loader')
import { registerGLTFLoader } from '../../utils/gltf-loader'

// Converted to plain JavaScript: removed TypeScript type declarations and ESM imports

Component({
  options: {
    // Relax style isolation so cover-view inside the component renders/stacks correctly over canvas
    styleIsolation: 'apply-shared',
    addGlobalClass: true,
    // Use virtualHost to avoid extra wrapper affecting native layering in some WeChat versions
    virtualHost: true,
  },
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
    joystickActive: false,
    joystickStickX: 0,
    joystickStickY: 0,
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
          this.registerResizeListener();
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

      this.cameraHeight = 1.6
      this.camera = new THREE.PerspectiveCamera(70, this.canvasWidth / this.canvasHeight, 0.1, 200);
      this.camera.position.set(0, this.cameraHeight, 6);
      // Cap yaw/translation speeds so the joystick remains comfortable to use
      this.maxYawSpeed = Math.PI * 0.75
      this.maxMoveSpeed = 2.5
      this.turnSmoothing = 6
      this.joystickState = { yawSpeed: 0, moveSpeed: 0 }
      this.cameraVelocity = { yawSpeed: 0, moveSpeed: 0 }
      this.cameraYaw = 0
      this.cameraPitch = 0
      this.syncCameraOrientation()
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
      scope.scene = new THREE.Scene();
      scope.scene.background = new THREE.Color(0xe0e0e0);
      scope.scene.fog = new THREE.Fog(0xe0e0e0, 20, 100);
      // var light = new THREE.HemisphereLight(0xffffff, 0x444444);
      // light.position.set(0, 20, 0);
      // scope.scene.add(light);
      // light = new THREE.DirectionalLight(0xffffff);
      // light.position.set(0, 20, 10);
      // scope.scene.add(light);

      // var mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2000, 2000), new THREE.MeshPhongMaterial({ color: 0x999999, depthWrite: false }));
      // mesh.rotation.x = - Math.PI / 2;
      // scope.scene.add(mesh);
      // var grid = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
      // grid.material.opacity = 0.2;
      // grid.material.transparent = true;
      // scope.scene.add(grid);

      // var loader = new THREE.GLTFLoader();
      //   loader.load('https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb', function (gltf) {
      //     scope.scene.add(gltf.scene);

      //   }, undefined, function (e) {
      //     console.error(e);
      //   });

      //    var mesh1 = new THREE.Mesh(new THREE.BoxBufferGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0x999999, depthWrite: false }));
      //   scope.scene.add(mesh1);

      if (result && result.scene) {
        scope.scene.add(result.scene)
      }

      console.log('Scene loaded:', scope.scene)

      if (scope.camera) {
        scope.camera.position.set(0, scope.cameraHeight ?? 1.6, 6)
      }
      scope.cameraYaw = 0
      scope.cameraPitch = 0
      scope.syncCameraOrientation()
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
        if (scope.joystickState || scope.cameraVelocity) {
          scope.updateCameraFromJoystick(delta)
        }
        scope.syncCameraOrientation()
        scope.renderer.render(scope.scene, scope.camera)
      }
      scope.frameId = scope.canvas.requestAnimationFrame(step)
    },

    updateCameraFromJoystick: function (delta) {
      if (!this.camera || !this.three) {
        return
      }
      const THREE = this.three
      const targetState = this.joystickState || { yawSpeed: 0, moveSpeed: 0 }
      const currentState = this.cameraVelocity || { yawSpeed: 0, moveSpeed: 0 }
      const smoothing = this.turnSmoothing ?? 6
      const lerpFactor = Math.min(1, delta * smoothing)

      currentState.yawSpeed += (targetState.yawSpeed - currentState.yawSpeed) * lerpFactor
      currentState.moveSpeed += (targetState.moveSpeed - currentState.moveSpeed) * lerpFactor

      // Snap very small residual speeds to zero to avoid slow drifting
      if (Math.abs(currentState.yawSpeed) < 1e-4) {
        currentState.yawSpeed = 0
      }
      if (Math.abs(currentState.moveSpeed) < 1e-4) {
        currentState.moveSpeed = 0
      }

      const yaw = (this.cameraYaw ?? 0) + currentState.yawSpeed * delta
      this.cameraYaw = yaw

      if (currentState.moveSpeed) {
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
        const displacement = forward.multiplyScalar(currentState.moveSpeed * delta)
        this.camera.position.add(displacement)
      }

      const height = this.cameraHeight ?? 1.6
      this.camera.position.y = height
      this.cameraVelocity = currentState
    },

    syncCameraOrientation: function () {
      if (!this.camera || !this.three) {
        return
      }
      const THREE = this.three
      const yaw = this.cameraYaw ?? 0
      const pitch = this.cameraPitch ?? 0
      const cosPitch = Math.cos(pitch)
      const direction = new THREE.Vector3(
        Math.sin(yaw) * cosPitch,
        Math.sin(pitch),
        Math.cos(yaw) * cosPitch
      )
      const target = new THREE.Vector3().copy(this.camera.position).add(direction)
      this.camera.up.set(0, 1, 0)
      this.camera.lookAt(target)
    },

    ensureJoystickMetrics: function (callback) {
      if (this.joystickRect && this.joystickRadius) {
        callback?.()
        return
      }
      const query = this.createSelectorQuery()
      query
        .select('#joystick-base')
        .boundingClientRect((rect) => {
          if (rect) {
            this.joystickRect = rect
            this.joystickRadius = Math.min(rect.width, rect.height) / 2
          } else {
            this.joystickRect = null
            this.joystickRadius = 0
          }
          callback?.()
        })
        .exec()
    },

    findJoystickTouch: function (touches) {
      if (!touches || !touches.length) {
        return null
      }
      const id = this.joystickTouchId
      for (let i = 0; i < touches.length; i += 1) {
        const touch = touches[i]
        if (id === undefined || id === null || touch.identifier === id) {
          return touch
        }
      }
      return null
    },

    applyJoystickDelta: function (touch) {
      if (!touch || !this.joystickRect) {
        return
      }
      const radius = this.joystickRadius || 0
      const centerX = this.joystickRect.left + (this.joystickRect.width / 2)
      const centerY = this.joystickRect.top + (this.joystickRect.height / 2)
      const pageX = touch.pageX ?? touch.x ?? 0
      const pageY = touch.pageY ?? touch.y ?? 0
      let dx = pageX - centerX
      let dy = pageY - centerY
      const distance = Math.sqrt((dx * dx) + (dy * dy))
      const limitDistance = radius ? Math.min(distance, radius) : 0
      if (distance > 0 && limitDistance > 0) {
        const scale = limitDistance / distance
        dx *= scale
        dy *= scale
      } else {
        dx = 0
        dy = 0
      }
      const normalizedX = radius ? dx / radius : 0
      const normalizedY = radius ? dy / radius : 0
      const maxYawSpeed = this.maxYawSpeed || (Math.PI * 0.75)
      const maxMoveSpeed = this.maxMoveSpeed || 2.5
      // Invert yaw so dragging left rotates the view to the right as specified
      this.joystickState = {
        yawSpeed: -normalizedX * maxYawSpeed,
        moveSpeed: -normalizedY * maxMoveSpeed,
      }
      this.setData({
        joystickActive: true,
        joystickStickX: dx,
        joystickStickY: dy,
      })
    },

    resetJoystick: function () {
      this.joystickTouchId = null
      this.joystickState = { yawSpeed: 0, moveSpeed: 0 }
      this.cameraVelocity = { yawSpeed: 0, moveSpeed: 0 }
      this.setData({
        joystickActive: false,
        joystickStickX: 0,
        joystickStickY: 0,
      })
    },

    onJoystickTouchStart: function (e) {
      const touch = e?.changedTouches?.[0]
      if (!touch) {
        return
      }
      this.ensureJoystickMetrics(() => {
        this.joystickTouchId = touch.identifier
        this.applyJoystickDelta(touch)
      })
    },

    onJoystickTouchMove: function (e) {
      const touch = this.findJoystickTouch(e?.changedTouches)
      if (!touch) {
        return
      }
      if (!this.joystickRect || !this.joystickRadius) {
        this.ensureJoystickMetrics(() => this.applyJoystickDelta(touch))
        return
      }
      this.applyJoystickDelta(touch)
    },

    onJoystickTouchEnd: function (e) {
      const touch = this.findJoystickTouch(e?.changedTouches)
      if (!touch) {
        return
      }
      this.resetJoystick()
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
      this.scene = null
      this.mixers = []
      this.cameraYaw = 0
      this.cameraPitch = 0
      this.joystickState = { yawSpeed: 0, moveSpeed: 0 }
      this.cameraVelocity = { yawSpeed: 0, moveSpeed: 0 }
      if (this.camera) {
        this.camera.position.set(0, this.cameraHeight ?? 1.6, 6)
        this.syncCameraOrientation()
      }
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
      this.resetJoystick?.()
      this.cameraYaw = 0
      this.cameraPitch = 0
    },
  },
})
