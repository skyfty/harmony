const { decode } = require('base64')

const LOCAL_ASSET_PREFIX = 'local::';
const DEFAULT_SCENE_BACKGROUND = '#101720';
const DEFAULT_SCENE_FOG_COLOR = '#0d1520';
const WX = typeof globalThis !== 'undefined' && globalThis.wx
    ? globalThis.wx
    : undefined;
class SceneBuilder {
    constructor(context) {
        var _a;
        this.mixers = [];
        this.materialTemplates = new Map();
        this.textureCache = new Map();
        this.gltfCache = new Map();
        this.lightTargets = [];
        this.stats = {
            meshCount: 0,
            lightCount: 0,
            triangleCount: 0,
        };
        this.hasDirectionalLight = false;
        this.THREE = context.THREE;
        this.canvas = context.canvas;
        this.bundle = context.bundle;
        this.document = context.document;
        this.options = context.options;
        this.enableShadows = context.options.enableShadows !== false;
        this.scene = new this.THREE.Scene();
        this.scene.name = (_a = context.document.name) !== null && _a !== void 0 ? _a : 'Scene';
        this.scene.background = new this.THREE.Color(DEFAULT_SCENE_BACKGROUND);
        const fog = new this.THREE.Fog(DEFAULT_SCENE_FOG_COLOR, 45, 320);
        this.scene.fog = fog;
    }
    async build() {
        var _a, _b;
        this.prepareMaterialTemplates();
        await this.buildNodes(this.document.nodes, this.scene);
        this.ensureLighting();
        this.scene.updateMatrixWorld(true);
        return {
            scene: this.scene,
            mixers: this.mixers,
            statistics: { ...this.stats },
            sceneName: (_b = this.document.name) !== null && _b !== void 0 ? _b : 'Scene',
        };
    }
    prepareMaterialTemplates() {
        this.document.materials.forEach((material) => {
            const instance = this.instantiateMaterial(material);
            this.materialTemplates.set(material.id, instance);
        });
    }
    async buildNodes(nodes, parent) {
        for (const node of nodes) {
            const built = await this.buildSingleNode(node);
            if (!built) {
                continue;
            }
            parent.add(built);
        }
    }
    async buildSingleNode(node) {
        switch (node.nodeType) {
            case 'Group':
                return this.buildGroupNode(node);
            case 'Light':
                return this.buildLightNode(node);
            case 'Mesh':
                return this.buildMeshNode(node);
            default:
                return this.buildPrimitiveNode(node);
        }
    }
    async buildGroupNode(node) {
        var _a;
        const group = new this.THREE.Group();
        group.name = node.name;
        this.applyTransform(group, node);
        this.applyVisibility(group, node);
        if ((_a = node.children) === null || _a === void 0 ? void 0 : _a.length) {
            await this.buildNodes(node.children, group);
        }
        return group;
    }
    applyVisibility(object, node) {
        if (typeof node.visible === 'boolean') {
            object.visible = node.visible;
        }
    }
    async buildLightNode(node) {
        var _a;
        const lightProps = node.light;
        if (!lightProps) {
            return null;
        }
        const color = new this.THREE.Color((_a = lightProps.color) !== null && _a !== void 0 ? _a : '#ffffff');
        const intensity = Number.isFinite(lightProps.intensity) ? lightProps.intensity : 1;
        let light = null;
        switch (lightProps.type) {
            case 'Directional': {
                const dir = new this.THREE.DirectionalLight(color, intensity);
                dir.castShadow = !!lightProps.castShadow;
                dir.shadow.mapSize.set(2048, 2048);
                dir.shadow.camera.near = 0.1;
                dir.shadow.camera.far = 200;
                dir.shadow.bias = -0.0002;
                light = dir;
                this.hasDirectionalLight = true;
                break;
            }
            case 'Point': {
                const point = new this.THREE.PointLight(color, intensity, lightProps.distance, lightProps.decay);
                point.castShadow = !!lightProps.castShadow;
                light = point;
                break;
            }
            case 'Spot': {
                const spot = new this.THREE.SpotLight(color, intensity, lightProps.distance, lightProps.angle, lightProps.penumbra, lightProps.decay);
                spot.castShadow = !!lightProps.castShadow;
                spot.shadow.mapSize.set(1024, 1024);
                light = spot;
                break;
            }
            case 'Ambient':
            default:
                light = new this.THREE.AmbientLight(color, intensity);
                break;
        }
        if (!light) {
            return null;
        }
        light.name = node.name;
        this.applyTransform(light, node);
        this.applyVisibility(light, node);
        this.stats.lightCount += 1;
        if ('target' in lightProps && lightProps.target) {
            const target = new this.THREE.Object3D();
            target.position.set(lightProps.target.x, lightProps.target.y, lightProps.target.z);
            this.scene.add(target);
            if (light.target) {
                light.target = target;
            }
            this.lightTargets.push(target);
        }
        return light;
    }
    async buildMeshNode(node) {
        var _a, _b;
        if (((_a = node.dynamicMesh) === null || _a === void 0 ? void 0 : _a.type) === 'Ground') {
            return this.buildGroundMesh(node.dynamicMesh, node);
        }
        if (((_b = node.dynamicMesh) === null || _b === void 0 ? void 0 : _b.type) === 'Wall') {
            return this.buildNodesForWall(node.dynamicMesh, node);
        }
        if (node.sourceAssetId) {
            const loaded = await this.loadAssetMesh(node);
            if (loaded) {
                this.applyTransform(loaded, node);
                this.applyVisibility(loaded, node);
                this.recordMeshStatistics(loaded);
                return loaded;
            }
        }
        // Fallback to primitive box when source asset missing.
        return this.buildPrimitiveNode({ ...node, nodeType: 'Box' });
    }
    async buildPrimitiveNode(node) {
        var _a;
        const materials = this.resolveNodeMaterials(node);
        const mesh = this.createPrimitiveMesh(node.nodeType, materials);
        if (!mesh) {
            return null;
        }
        mesh.name = node.name;
        this.applyTransform(mesh, node);
        this.applyVisibility(mesh, node);
        mesh.castShadow = this.enableShadows;
        mesh.receiveShadow = true;
        this.stats.meshCount += 1;
        this.stats.triangleCount += this.estimateGeometryTriangles(mesh.geometry);
        if ((_a = node.children) === null || _a === void 0 ? void 0 : _a.length) {
            await this.buildNodes(node.children, mesh);
        }
        return mesh;
    }
    resolveNodeMaterials(node) {
        if (!node.materials || !node.materials.length) {
            return [this.createDefaultMaterial('#ffffff')];
        }
        return node.materials.map((entry) => this.createMaterialForNode(entry));
    }
    createDefaultMaterial(colorHex) {
        const material = new this.THREE.MeshStandardMaterial({
            color: new this.THREE.Color(colorHex),
            metalness: 0.2,
            roughness: 0.7,
        });
        material.side = this.THREE.DoubleSide;
        return material;
    }
    createMaterialForNode(material) {
        if (material.materialId) {
            const template = this.materialTemplates.get(material.materialId);
            if (template) {
                const clone = template.clone();
                this.applyMaterialProps(clone, material);
                return clone;
            }
        }
        const instance = this.instantiateMaterial(material);
        return instance;
    }
    instantiateMaterial(material) {
        var _a, _b;
        const type = (_a = material.type) !== null && _a !== void 0 ? _a : 'MeshStandardMaterial';
        const props = this.extractMaterialProps(material);
        const side = this.resolveMaterialSide(props.side);
        const color = new this.THREE.Color(props.color);
        const emissiveColor = new this.THREE.Color((_b = props.emissive) !== null && _b !== void 0 ? _b : '#000000');
        switch (type) {
            case 'MeshBasicMaterial': {
                const parameters = {
                    color,
                    transparent: props.transparent,
                    opacity: props.opacity,
                    wireframe: props.wireframe,
                    side,
                };
                return new this.THREE.MeshBasicMaterial(parameters);
            }
            case 'MeshLambertMaterial': {
                const parameters = {
                    color,
                    emissive: emissiveColor,
                    emissiveIntensity: props.emissiveIntensity,
                    transparent: props.transparent,
                    opacity: props.opacity,
                    wireframe: props.wireframe,
                    side,
                };
                return new this.THREE.MeshLambertMaterial(parameters);
            }
            case 'MeshPhongMaterial': {
                const parameters = {
                    color,
                    emissive: emissiveColor,
                    emissiveIntensity: props.emissiveIntensity,
                    transparent: props.transparent,
                    opacity: props.opacity,
                    wireframe: props.wireframe,
                    side,
                };
                return new this.THREE.MeshPhongMaterial(parameters);
            }
            case 'MeshToonMaterial': {
                const parameters = {
                    color,
                    emissive: emissiveColor,
                    emissiveIntensity: props.emissiveIntensity,
                    transparent: props.transparent,
                    opacity: props.opacity,
                    wireframe: props.wireframe,
                    side,
                };
                return new this.THREE.MeshToonMaterial(parameters);
            }
            case 'MeshNormalMaterial': {
                const parameters = {
                    transparent: props.transparent,
                    opacity: props.opacity,
                    wireframe: props.wireframe,
                    side,
                };
                return new this.THREE.MeshNormalMaterial(parameters);
            }
            case 'MeshPhysicalMaterial': {
                const parameters = {
                    color,
                    metalness: props.metalness,
                    roughness: props.roughness,
                    emissive: emissiveColor,
                    emissiveIntensity: props.emissiveIntensity,
                    envMapIntensity: props.envMapIntensity,
                    transparent: props.transparent,
                    opacity: props.opacity,
                    wireframe: props.wireframe,
                    side,
                };
                return new this.THREE.MeshPhysicalMaterial(parameters);
            }
            case 'MeshMatcapMaterial': {
                const parameters = {
                    color,
                    transparent: props.transparent,
                    opacity: props.opacity,
                    side,
                };
                return new this.THREE.MeshMatcapMaterial(parameters);
            }
            case 'MeshStandardMaterial':
            default: {
                const parameters = {
                    color,
                    metalness: props.metalness,
                    roughness: props.roughness,
                    emissive: emissiveColor,
                    emissiveIntensity: props.emissiveIntensity,
                    envMapIntensity: props.envMapIntensity,
                    transparent: props.transparent,
                    opacity: props.opacity,
                    wireframe: props.wireframe,
                    side,
                };
                return new this.THREE.MeshStandardMaterial(parameters);
            }
        }
    }
    extractMaterialProps(material) {
        const { color, transparent, opacity, side, wireframe, metalness, roughness, emissive, emissiveIntensity, aoStrength, envMapIntensity, textures } = material;
        return {
            color: color !== null && color !== void 0 ? color : '#ffffff',
            transparent: transparent !== null && transparent !== void 0 ? transparent : false,
            opacity: opacity !== null && opacity !== void 0 ? opacity : 1,
            side: side !== null && side !== void 0 ? side : 'front',
            wireframe: wireframe !== null && wireframe !== void 0 ? wireframe : false,
            metalness: metalness !== null && metalness !== void 0 ? metalness : 0.2,
            roughness: roughness !== null && roughness !== void 0 ? roughness : 0.7,
            emissive: emissive !== null && emissive !== void 0 ? emissive : '#000000',
            emissiveIntensity: emissiveIntensity !== null && emissiveIntensity !== void 0 ? emissiveIntensity : 0,
            aoStrength: aoStrength !== null && aoStrength !== void 0 ? aoStrength : 1,
            envMapIntensity: envMapIntensity !== null && envMapIntensity !== void 0 ? envMapIntensity : 1,
            textures: textures !== null && textures !== void 0 ? textures : {},
        };
    }
    resolveMaterialSide(side) {
        switch (side) {
            case 'double':
                return this.THREE.DoubleSide;
            case 'back':
                return this.THREE.BackSide;
            case 'front':
            default:
                return this.THREE.FrontSide;
        }
    }
    applyMaterialProps(material, props) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        material.transparent = (_a = props.transparent) !== null && _a !== void 0 ? _a : material.transparent;
        material.opacity = (_b = props.opacity) !== null && _b !== void 0 ? _b : material.opacity;
        material.side = this.resolveMaterialSide(props.side);
        if (props.color && 'color' in material && material.color) {
            material.color = new this.THREE.Color(props.color);
        }
        if ('emissive' in material && material.emissive) {
            material.emissive = new this.THREE.Color((_c = props.emissive) !== null && _c !== void 0 ? _c : '#000000');
            if ('emissiveIntensity' in material) {
                material.emissiveIntensity = (_d = props.emissiveIntensity) !== null && _d !== void 0 ? _d : material.emissiveIntensity;
            }
        }
        if ('wireframe' in material) {
            material.wireframe = (_e = props.wireframe) !== null && _e !== void 0 ? _e : material.wireframe;
        }
        if (material instanceof this.THREE.MeshStandardMaterial) {
            material.metalness = (_f = props.metalness) !== null && _f !== void 0 ? _f : material.metalness;
            material.roughness = (_g = props.roughness) !== null && _g !== void 0 ? _g : material.roughness;
            material.envMapIntensity = (_h = props.envMapIntensity) !== null && _h !== void 0 ? _h : material.envMapIntensity;
        }
        material.needsUpdate = true;
    }
    createPrimitiveMesh(type, materials) {
        const geometry = this.createGeometry(type);
        if (!geometry) {
            return null;
        }
        const material = materials.length === 1 ? materials[0] : materials;
        return new this.THREE.Mesh(geometry, material);
    }
    createGeometry(type) {
        const THREE = this.THREE;
        switch (type) {
            case 'Box':
                return new THREE.BoxGeometry(1, 1, 1);
            case 'Sphere':
                return new THREE.SphereGeometry(0.5, 32, 16);
            case 'Capsule':
                return new THREE.CapsuleGeometry(0.3, 0.8, 8, 16);
            case 'Circle':
                return new THREE.CircleGeometry(0.5, 32);
            case 'Cylinder':
                return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
            case 'Dodecahedron':
                return new THREE.DodecahedronGeometry(0.6, 0);
            case 'Icosahedron':
                return new THREE.IcosahedronGeometry(0.6, 0);
            case 'Lathe': {
                const points = [];
                for (let i = 0; i < 10; i += 1) {
                    points.push(new THREE.Vector2(Math.sin(i * 0.2) * 0.5 + 0.5, (i - 5) * 0.2));
                }
                return new THREE.LatheGeometry(points, 24);
            }
            case 'Octahedron':
                return new THREE.OctahedronGeometry(0.6, 0);
            case 'Plane':
                return new THREE.PlaneGeometry(1, 1, 1, 1);
            case 'Ring':
                return new THREE.RingGeometry(0.3, 0.6, 32);
            case 'Torus':
                return new THREE.TorusGeometry(0.5, 0.2, 16, 64);
            case 'TorusKnot':
                return new THREE.TorusKnotGeometry(0.4, 0.15, 120, 12);
            default:
                return new THREE.BoxGeometry(1, 1, 1);
        }
    }
    estimateGeometryTriangles(geometry) {
        var _a;
        if (!geometry) {
            return 0;
        }
        if (geometry.index) {
            return geometry.index.count / 3;
        }
        if ((_a = geometry.attributes) === null || _a === void 0 ? void 0 : _a.position) {
            return geometry.attributes.position.count / 3;
        }
        return 0;
    }
    recordMeshStatistics(object) {
        if (!object) {
            return;
        }
        object.traverse((child) => {
            const mesh = child;
            if ((mesh === null || mesh === void 0 ? void 0 : mesh.isMesh) && mesh.geometry) {
                this.stats.meshCount += 1;
                const geometry = mesh.geometry;
                this.stats.triangleCount += this.estimateGeometryTriangles(geometry);
            }
        });
    }
    applyTransform(object, node) {
        if (node.position) {
            object.position.set(node.position.x, node.position.y, node.position.z);
        }
        if (node.rotation) {
            object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z);
        }
        if (node.scale) {
            object.scale.set(node.scale.x, node.scale.y, node.scale.z);
        }
    }
    async buildNodesForDynamicChildren(parentNode, object) {
        var _a;
        if ((_a = parentNode.children) === null || _a === void 0 ? void 0 : _a.length) {
            await this.buildNodes(parentNode.children, object);
        }
    }
    async loadAssetMesh(node) {
        const assetId = node.sourceAssetId;
        const cached = this.gltfCache.get(assetId);
        if (cached) {
            return cached.clone(true);
        }
        const source = await this.resolveAssetSource(assetId);
        if (!source) {
            console.warn('未找到资源数据', assetId);
            return null;
        }
        let arrayBuffer = null;
        switch (source.kind) {
            case 'arraybuffer':
                arrayBuffer = source.data;
                break;
            case 'data-url':
                arrayBuffer = this.decodeDataUrl(source.data);
                break;
            case 'remote-url':
                arrayBuffer = await this.downloadArrayBuffer(source.data);
                break;
            default:
                arrayBuffer = null;
        }

        if (!arrayBuffer) {
            console.warn('资源数据为空', assetId);
            return null;
        }

        const gltfRoot = await this.parseGltf(arrayBuffer);
        if (!gltfRoot) {
            console.warn('GLTF 解析失败', assetId);
            return null;
        }
        this.prepareImportedObject(gltfRoot);
        this.gltfCache.set(assetId, gltfRoot);
        return gltfRoot.clone(true);
    }
    prepareImportedObject(object) {
        object.traverse((child) => {
            const mesh = child;
            if (mesh.isMesh) {
                mesh.castShadow = this.enableShadows;
                mesh.receiveShadow = true;
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((mat) => mat.side = this.THREE.DoubleSide);
                }
                else if (mesh.material) {
                    mesh.material.side = this.THREE.DoubleSide;
                }
            }
        });
    }
    async parseGltf(buffer) {
        const loaderCtor = this.THREE.GLTFLoader;
        if (!loaderCtor) {
            console.warn('GLTFLoader 未注册，无法解析模型');
            return null;
        }
        const loader = new loaderCtor();
        return new Promise((resolve) => {
            loader.parse(buffer, '', (gltf) => {
                var _a;
                resolve((_a = gltf.scene) !== null && _a !== void 0 ? _a : null);
            }, (error) => {
                console.error('GLTF 解析错误', error);
                resolve(null);
            });
        });
    }

    decodeDataUrl(dataUrl) {
        if (typeof dataUrl !== 'string') {
            throw new TypeError('dataUrl must be a string');
        }
        const [, base64] = dataUrl.split(',');
        const clean = (base64 !== null && base64 !== void 0 ? base64 : '').replace(/\s/g, '');
        if (!clean) {
            return new ArrayBuffer(0);
        }
        if (WX === null || WX === void 0 ? void 0 : WX.base64ToArrayBuffer) {
            return WX.base64ToArrayBuffer(clean);
        }
        try {
            return decode(clean);
        }
        catch (error) {
            console.error('Base64 解码失败', error);
            throw (error instanceof Error ? error : new Error(String(error)));
        }
    }
    downloadArrayBuffer(url) {
        return new Promise((resolve, reject) => {
            if (!(WX === null || WX === void 0 ? void 0 : WX.request)) {
                reject(new Error('wx.request 不可用'));
                return;
            }
            WX.request({
                url,
                method: 'GET',
                responseType: 'arraybuffer',
                success: (res) => {
                    const { statusCode, data } = res;
                    if (statusCode === 200 && data instanceof ArrayBuffer) {
                        resolve(data);
                        return;
                    }
                    reject(new Error(`下载失败: ${statusCode}`));
                },
                fail: (error) => {
                    reject(error instanceof Error ? error : new Error(String(error)));
                },
            });
        });
    }
    async resolveAssetSource(assetId) {
        var _a;
        const packageMap = (_a = this.document.packageAssetMap) !== null && _a !== void 0 ? _a : {};
        const embeddedKey = `${LOCAL_ASSET_PREFIX}${assetId}`;
        if (packageMap[embeddedKey]) {
            return { kind: 'data-url', data: packageMap[embeddedKey] };
        }
        const directKey = packageMap[assetId];
        if (directKey && packageMap[`${LOCAL_ASSET_PREFIX}${directKey}`]) {
            return { kind: 'data-url', data: packageMap[`${LOCAL_ASSET_PREFIX}${directKey}`] };
        }
        const asset = this.findAssetInCatalog(assetId);
        if (asset === null || asset === void 0 ? void 0 : asset.downloadUrl) {
            return { kind: 'remote-url', data: asset.downloadUrl, name: asset.name, contentType: null };
        }
        return null;
    }
    findAssetInCatalog(assetId) {
        var _a;
        const catalog = (_a = this.document.assetCatalog) !== null && _a !== void 0 ? _a : {};
        for (const list of Object.values(catalog)) {
            if (!Array.isArray(list)) {
                continue;
            }
            const assetList = list;
            const found = assetList.find((entry) => entry.id === assetId);
            if (found) {
                return found;
            }
        }
        return null;
    }
    async buildGroundMesh(mesh, node) {
        const geometry = new this.THREE.PlaneGeometry(mesh.width, mesh.depth, mesh.columns, mesh.rows);
        geometry.rotateX(-Math.PI / 2);
        const materials = this.resolveNodeMaterials(node);
        const ground = new this.THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]);
        ground.receiveShadow = this.enableShadows;
        ground.castShadow = false;
        ground.name = node.name || 'Ground';
        this.applyTransform(ground, node);
        this.applyVisibility(ground, node);
        this.stats.meshCount += 1;
        this.stats.triangleCount += this.estimateGeometryTriangles(geometry);
        await this.buildNodesForDynamicChildren(node, ground);
        return ground;
    }
    async buildNodesForWall(mesh, node) {
        const container = new this.THREE.Group();
        container.name = node.name || 'Wall';
        mesh.segments.forEach((segment, index) => {
            const length = Math.sqrt((segment.end.x - segment.start.x) ** 2 +
                (segment.end.y - segment.start.y) ** 2 +
                (segment.end.z - segment.start.z) ** 2);
            const geometry = new this.THREE.BoxGeometry(length, segment.height, segment.thickness);
            const materials = this.resolveNodeMaterials(node);
            const wallSegment = new this.THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]);
            wallSegment.castShadow = this.enableShadows;
            wallSegment.receiveShadow = true;
            wallSegment.name = `${node.name || 'Wall'}-${index}`;
            const midPoint = {
                x: (segment.start.x + segment.end.x) / 2,
                y: segment.height / 2,
                z: (segment.start.z + segment.end.z) / 2,
            };
            wallSegment.position.set(midPoint.x, midPoint.y, midPoint.z);
            wallSegment.lookAt(segment.end.x, midPoint.y, segment.end.z);
            container.add(wallSegment);
            this.stats.meshCount += 1;
            this.stats.triangleCount += this.estimateGeometryTriangles(geometry);
        });
        await this.buildNodesForDynamicChildren(node, container);
        this.applyTransform(container, node);
        this.applyVisibility(container, node);
        return container;
    }
    ensureLighting() {
        if (!this.hasDirectionalLight) {
            const dir = new this.THREE.DirectionalLight('#ffffff', 0.8);
            dir.position.set(18, 32, 18);
            dir.castShadow = this.enableShadows;
            dir.shadow.mapSize.set(1024, 1024);
            this.scene.add(dir);
            const target = new this.THREE.Object3D();
            target.position.set(0, 0, 0);
            this.scene.add(target);
            dir.target = target;
            this.lightTargets.push(target);
        }
        const ambient = new this.THREE.AmbientLight('#404040', 0.4);
        this.scene.add(ambient);
    }
}
export function parseSceneBundle(source) {
    if (typeof source === 'string') {
        return JSON.parse(source);
    }
    return source;
}
export async function buildSceneFromBundle(THREE, canvas, bundle, options = {}) {

    const builder = new SceneBuilder({ THREE, canvas, bundle, document: bundle, options });
    return builder.build();
}
