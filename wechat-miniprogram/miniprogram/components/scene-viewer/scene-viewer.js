    },
    data: {
        loading: false,
        errorMessage: '',
    },
    observers: {
        'sceneBundle, sceneId': function () {
            this.scheduleSceneLoad();
        },
    },
    lifetimes: {
        async ready() {
            await this.initializeCanvas();
            this.scheduleSceneLoad();
        },
        detached() {
            this.dispose();
        },
    },
    methods: {
        async initializeCanvas() {
            if (this.canvas) {
                return;
            }
            const query = this.createSelectorQuery();
            query
                .select('#three-canvas')
                .node()
                .exec(async (res) => {
                var _a;
                const entry = res === null || res === void 0 ? void 0 : res[0];
                if (!entry) {
                    this.emitLoadState('error', '无法初始化渲染画布');
                    return;
                }
                const canvas = entry.node;
                const rect = entry;
                const systemInfo = typeof wx !== 'undefined' && wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
                const maxPixelRatio = this.data.maxPixelRatio || 2;
                const deviceRatio = (_a = systemInfo === null || systemInfo === void 0 ? void 0 : systemInfo.pixelRatio) !== null && _a !== void 0 ? _a : 1;
                const pixelRatio = Math.min(maxPixelRatio, deviceRatio);
                canvas.width = rect.width * pixelRatio;
                canvas.height = rect.height * pixelRatio;
                this.canvas = canvas;
                this.canvasWidth = rect.width;
                this.canvasHeight = rect.height;
                this.pixelRatio = pixelRatio;
                this.three = createScopedThreejs(canvas);
                this.registerExtensions(this.three);
                this.setupRenderer();
                this.startRenderLoop();
                this.registerResizeListener();
            });
        },
        registerExtensions(THREE) {
           
        },
        setupRenderer() {
            var _a, _b, _c, _d;
            if (!this.three || !this.canvas) {
                return;
            }
            const THREE = this.three;
            const renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true,
                alpha: false,
            });
            renderer.shadowMap.enabled = (_a = this.data.enableShadows) !== null && _a !== void 0 ? _a : true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.outputEncoding = THREE.sRGBEncoding;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.0;
            renderer.physicallyCorrectLights = true;
            renderer.setPixelRatio((_b = this.pixelRatio) !== null && _b !== void 0 ? _b : 1);
            renderer.setSize((_c = this.canvasWidth) !== null && _c !== void 0 ? _c : 1, (_d = this.canvasHeight) !== null && _d !== void 0 ? _d : 1, false);
            this.renderer = renderer;
            this.clock = new THREE.Clock();
            this.mixers = [];
        },
        registerResizeListener() {
            if (typeof wx === 'undefined' || !wx.onWindowResize) {
                return;
            }
            this.resizeHandler = () => {
                this.updateRendererSize();
            };
            wx.onWindowResize(this.resizeHandler);
        },
        updateRendererSize() {
            if (!this.renderer || !this.canvas) {
                return;
            }
            const query = this.createSelectorQuery();
            query
                .select('#three-canvas')
                .boundingClientRect((rect) => {
                var _a;
                if (!rect) {
                    return;
                }
                const width = rect.width;
                const height = rect.height;
                const pixelRatio = (_a = this.pixelRatio) !== null && _a !== void 0 ? _a : 1;
                this.canvas.width = width * pixelRatio;
                this.canvas.height = height * pixelRatio;
                this.renderer.setPixelRatio(pixelRatio);
                this.renderer.setSize(width, height, false);
                if (this.camera) {
                    this.camera.aspect = width / height;
                    this.camera.updateProjectionMatrix();
                }
            })
                .exec();
        },
        scheduleSceneLoad() {
            if (this.loadTimer) {
                clearTimeout(this.loadTimer);
            }
            this.loadTimer = setTimeout(() => {
                this.loadTimer = null;
                this.loadScene();
            }, 20);
        },
        async loadScene() {
            var _a, _b, _c;
            if (!this.three || !this.canvas) {
                return;
            }
            const bundle = this.data.sceneBundle;
            if (!bundle || !((_a = bundle.scenes) === null || _a === void 0 ? void 0 : _a.length)) {
                this.disposeScene();
                return;
            }
            const sceneId = this.data.sceneId || ((_b = bundle.scenes[0]) === null || _b === void 0 ? void 0 : _b.id);
            if (!sceneId) {
                this.emitLoadState('error', '场景信息缺失');
                return;
            }
            this.emitLoadState('loading', '场景加载中...');
            this.setData({ loading: true, errorMessage: '' });
            this.disposeScene();
            try {
                const result = await buildSceneFromBundle(this.three, this.canvas, bundle, {
                    sceneId,
                    enableShadows: this.data.enableShadows,
                });
                this.applySceneResult(result);
                this.emitLoadState('ready', `场景「${result.sceneName}」加载完成`);
                this.setData({ loading: false, errorMessage: '' });
            }
            catch (error) {
                const message = (_c = error.message) !== null && _c !== void 0 ? _c : '未知错误';
                this.setData({ loading: false, errorMessage: message });
                this.emitLoadState('error', `加载失败: ${message}`);
            }
        },
        applySceneResult(result) {
            var _a, _b;
            if (!this.three || !this.renderer) {
                return;
            }
            this.scene = result.scene;
            this.camera = result.camera;
            this.mixers = (_a = result.mixers) !== null && _a !== void 0 ? _a : [];
            const THREE = this.three;
            this.scene.background = (_b = this.scene.background) !== null && _b !== void 0 ? _b : new THREE.Color('#101720');
            const OrbitControlsCtor = THREE.OrbitControls;
            if (OrbitControlsCtor) {
                this.controls = new OrbitControlsCtor(this.camera, this.canvas);
                this.controls.enableDamping = true;
                this.controls.dampingFactor = 0.08;
                this.controls.enablePan = true;
                this.controls.minDistance = 1;
                this.controls.maxDistance = 800;
                this.controls.maxPolarAngle = Math.PI * 0.495;
                if (result.cameraTarget) {
                    this.controls.target.copy(result.cameraTarget);
                }
                this.controls.update();
            }
        },
        startRenderLoop() {
            if (!this.canvas) {
                return;
            }
            if (this.frameId) {
                this.canvas.cancelAnimationFrame(this.frameId);
            }
            const step = () => {
                var _a, _b, _c;
                this.frameId = this.canvas.requestAnimationFrame(step);
                if (!this.renderer || !this.scene || !this.camera) {
                    return;
                }
                const delta = this.clock ? this.clock.getDelta() : 0;
                if ((_a = this.mixers) === null || _a === void 0 ? void 0 : _a.length) {
                    this.mixers.forEach((mixer) => { var _a; return (_a = mixer === null || mixer === void 0 ? void 0 : mixer.update) === null || _a === void 0 ? void 0 : _a.call(mixer, delta); });
                }
                (_c = (_b = this.controls) === null || _b === void 0 ? void 0 : _b.update) === null || _c === void 0 ? void 0 : _c.call(_b);
                this.renderer.render(this.scene, this.camera);
            };
            this.frameId = this.canvas.requestAnimationFrame(step);
        },
        emitLoadState(state, message) {
            this.triggerEvent('loadstate', { state, message });
        },
        disposeScene() {
            var _a, _b;
            if (!this.scene || !this.three) {
                return;
            }
            const THREE = this.three;
            this.scene.traverse((object) => {
                var _a, _b, _c, _d;
                if (object && object.geometry) {
                    (_b = (_a = object.geometry).dispose) === null || _b === void 0 ? void 0 : _b.call(_a);
                }
                if (object && object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach((material) => { var _a; return (_a = material === null || material === void 0 ? void 0 : material.dispose) === null || _a === void 0 ? void 0 : _a.call(material); });
                    }
                    else {
                        (_d = (_c = object.material).dispose) === null || _d === void 0 ? void 0 : _d.call(_c);
                    }
                }
            });
            (_b = (_a = this.controls) === null || _a === void 0 ? void 0 : _a.dispose) === null || _b === void 0 ? void 0 : _b.call(_a);
            this.controls = null;
            this.scene = null;
            this.camera = null;
            this.mixers = [];
        },
        dispose() {
            var _a, _b;
            if (this.loadTimer) {
                clearTimeout(this.loadTimer);
                this.loadTimer = null;
            }
            if (this.frameId && this.canvas) {
                this.canvas.cancelAnimationFrame(this.frameId);
                this.frameId = null;
            }
            if (typeof wx !== 'undefined' && wx.offWindowResize && this.resizeHandler) {
                wx.offWindowResize(this.resizeHandler);
            }
            this.disposeScene();
            if (this.renderer) {
                (_b = (_a = this.renderer).dispose) === null || _b === void 0 ? void 0 : _b.call(_a);
                this.renderer = null;
            }
            this.canvas = null;
            this.three = null;
        },
    },
});
