import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { SceneJsonExportDocument, SceneMaterial, SceneNode, SceneNodeMaterial, SceneMaterialTextureSlotMap, Vector3Like } from '@harmony/scene-schema';

type SceneNodeWithExtras = SceneNode & {
  light?: {
    type?: string;
    color?: string;
    intensity?: number;
    distance?: number;
    decay?: number;
    angle?: number;
    penumbra?: number;
    castShadow?: boolean;
    target?: Vector3Like;
  };
  dynamicMesh?: any;
  components?: any[];
};

interface AssetSourceArrayBuffer {
  kind: 'arraybuffer';
  data: ArrayBuffer;
}

interface AssetSourceDataUrl {
  kind: 'data-url';
  dataUrl: string;
}

interface AssetSourceRemoteUrl {
  kind: 'remote-url';
  url: string;
}

type AssetSource = AssetSourceArrayBuffer | AssetSourceDataUrl | AssetSourceRemoteUrl;

interface TextureVector2 {
  x: number;
  y: number;
}

interface TextureSettings {
  wrapS: string;
  wrapT: string;
  wrapR: string;
  offset: TextureVector2;
  repeat: TextureVector2;
  rotation: number;
  center: TextureVector2;
  matrixAutoUpdate: boolean;
  generateMipmaps: boolean;
  premultiplyAlpha: boolean;
  flipY: boolean;
}

interface NormalizedMaterialProps {
  id: string;
  name: string;
  type: string;
  color: string;
  transparent: boolean;
  opacity: number;
  side: string;
  wireframe: boolean;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  aoStrength: number;
  envMapIntensity: number;
  textures: SceneMaterialTextureSlotMap;
}

const MATERIAL_TEXTURE_ASSIGNMENTS: Record<keyof SceneMaterialTextureSlotMap, { key: string; colorSpace?: 'srgb' | 'linear' }> = {
  albedo: { key: 'map', colorSpace: 'srgb' },
  normal: { key: 'normalMap' },
  metalness: { key: 'metalnessMap' },
  roughness: { key: 'roughnessMap' },
  ao: { key: 'aoMap' },
  emissive: { key: 'emissiveMap', colorSpace: 'srgb' },
};

const DEFAULT_TEXTURE_SETTINGS: TextureSettings = {
  wrapS: 'ClampToEdgeWrapping',
  wrapT: 'ClampToEdgeWrapping',
  wrapR: 'ClampToEdgeWrapping',
  offset: { x: 0, y: 0 },
  repeat: { x: 1, y: 1 },
  rotation: 0,
  center: { x: 0, y: 0 },
  matrixAutoUpdate: true,
  generateMipmaps: true,
  premultiplyAlpha: false,
  flipY: true,
};

// const presetAssetModules = import.meta.glob<string>(
//   '@/preset/**/*',
//   {
//     eager: true,
//     import: 'default',
//     query: '?url',
//   },
// ) as Record<string, string>;

function buildPresetAssetLookup(): Map<string, string> {
  const lookup = new Map<string, string>();
  // Object.entries(presetAssetModules).forEach(([path, url]) => {
  //   const normalized = path.replace(/^[.\/]+/, '').replace(/\\/g, '/');
  //   const presetIndex = normalized.indexOf('preset/');
  //   const relative = presetIndex >= 0 ? normalized.slice(presetIndex + 'preset/'.length) : normalized;
  //   const assetId = `preset:${relative}`;
  //   lookup.set(assetId, url);
  //   lookup.set(assetId.toLowerCase(), url);
  // });
  return lookup;
}

const presetAssetLookup = buildPresetAssetLookup();

const NodeBuffer: { from: (data: string, encoding: string) => any } | undefined =
  typeof globalThis !== 'undefined' && (globalThis as any).Buffer
    ? (globalThis as any).Buffer
    : undefined;

export interface SceneGraphBuildResult {
  root: THREE.Group;
  warnings: string[];
}

export interface SceneGraphBuildOptions {
  enableGround?: boolean;
  presetAssetBaseUrl?: string;
  resolveAssetUrl?: (assetId: string) => string | Promise<string | null> | null | undefined;
  assetOverrides?: Record<string, string | ArrayBuffer>;
}

class ResourceCache {
  private packageEntries: Map<string, { provider: string; value: string } | null> = new Map();
  private assetSourceCache: Map<string, Promise<AssetSource | null>> = new Map();

  constructor(
    private readonly document: SceneJsonExportDocument,
    private readonly options: SceneGraphBuildOptions,
    private readonly warn: (message: string) => void,
  ) {}

  async acquireAssetSource(assetId: string): Promise<AssetSource | null> {
    if (!assetId) {
      return null;
    }
    if (this.assetSourceCache.has(assetId)) {
      return this.assetSourceCache.get(assetId)!;
    }
    const pending = this.computeAssetSource(assetId).catch((error) => {
      console.warn('获取资源失败', assetId, error);
      this.warn(`无法加载资源 ${assetId}`);
      return null;
    });
    this.assetSourceCache.set(assetId, pending);
    return pending;
  }

  private async computeAssetSource(assetId: string): Promise<AssetSource | null> {
    const override = this.resolveOverride(assetId);
    if (override) {
      return override;
    }

    const embedded = this.resolveEmbedded(assetId);
    if (embedded) {
      return embedded;
    }

    const packageEntry = this.getPackageEntry(assetId);
    if (packageEntry) {
      const resolved = await this.resolvePackageEntry(assetId, packageEntry.provider, packageEntry.value);
      if (resolved) {
        return resolved;
      }
    }

    const assetIndex = this.document.assetIndex as Record<string, any> | undefined;
    const assetInfo = assetIndex && typeof assetIndex === 'object' ? assetIndex[assetId] : undefined;
    const assetSource = assetInfo && typeof assetInfo === 'object' ? assetInfo.source : undefined;
    if (assetSource && typeof assetSource === 'object' && assetSource.type === 'package' && assetSource.providerId) {
      const resolved = await this.resolvePackageEntry(
        assetId,
        assetSource.providerId,
        assetSource.originalAssetId ?? assetId,
      );
      if (resolved) {
        return resolved;
      }
    }

    if (typeof this.options.resolveAssetUrl === 'function') {
      const external = await this.options.resolveAssetUrl(assetId);
      if (external) {
        if (external.startsWith('data:')) {
          return { kind: 'data-url', dataUrl: external };
        }
        return { kind: 'remote-url', url: external };
      }
    }

    this.warn(`未找到资源 ${assetId}`);
    return null;
  }

  private resolveOverride(assetId: string): AssetSource | null {
    const entry = this.options.assetOverrides?.[assetId];
    if (entry == null) {
      return null;
    }
    if (typeof entry === 'string') {
      if (entry.startsWith('data:')) {
        return { kind: 'data-url', dataUrl: entry };
      }
      if (entry.startsWith('http://') || entry.startsWith('https://')) {
        return { kind: 'remote-url', url: entry };
      }
    }
    if (typeof entry === 'string') {
      const buffer = this.base64ToArrayBuffer(entry);
      return buffer ? { kind: 'arraybuffer', data: buffer } : null;
    }
    if (entry instanceof ArrayBuffer) {
      return { kind: 'arraybuffer', data: entry };
    }
    return null;
  }

  private base64ToArrayBuffer(value: string): ArrayBuffer | null {
    try {
      const clean = value.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
      if (typeof atob === 'function') {
        const binary = atob(clean);
        const length = binary.length;
        const buffer = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) {
          buffer[i] = binary.charCodeAt(i);
        }
        return buffer.buffer;
      }
      if (NodeBuffer) {
        const buf = NodeBuffer.from(clean, 'base64');
        const array = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        return array;
      }
    } catch (error) {
      console.warn('base64 转换失败', error);
    }
    return null;
  }

  private resolveEmbedded(assetId: string): AssetSource | null {
    const map = this.document.packageAssetMap ?? {};
    const key = `local::${assetId}`;
    const candidate = map[key];
    if (typeof candidate === 'string' && candidate.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: candidate };
    }
    return null;
  }

  private getPackageEntry(assetId: string): { provider: string; value: string } | null {
    if (this.packageEntries.has(assetId)) {
      return this.packageEntries.get(assetId) ?? null;
    }

    const map = this.document.packageAssetMap ?? {};
    const entries = Object.entries(map);
    for (const [key, value] of entries) {
      const separator = key.indexOf('::');
      if (separator === -1) {
        continue;
      }
      const provider = key.slice(0, separator);
      const id = key.slice(separator + 2);
      if (id === assetId && typeof value === 'string') {
        const result = { provider, value };
        this.packageEntries.set(assetId, result);
        return result;
      }
    }

    this.packageEntries.set(assetId, null);
    return null;
  }

  private async resolvePackageEntry(assetId: string, provider: string, value: string): Promise<AssetSource | null> {
    if (typeof value === 'string' && value.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: value };
    }

    if (provider === 'preset') {
      const url = this.resolvePresetUrl(value || assetId);
      if (url) {
        return { kind: 'remote-url', url };
      }
    }

    if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
      return { kind: 'remote-url', url: value };
    }

    if (provider && provider !== 'local' && value) {
      const url = this.buildProviderUrl(provider, value);
      if (url) {
        return { kind: 'remote-url', url };
      }
    }

    if (value) {
      const presetUrl = this.resolvePresetUrl(value);
      if (presetUrl) {
        return { kind: 'remote-url', url: presetUrl };
      }
    }

    const fallback = this.resolvePresetUrl(assetId);
    if (fallback) {
      return { kind: 'remote-url', url: fallback };
    }

    if (value) {
      const buffer = this.base64ToArrayBuffer(value);
      if (buffer) {
        return { kind: 'arraybuffer', data: buffer };
      }
    }

    this.warn(`未解析资源映射 ${provider}::${assetId}`);
    return null;
  }

  private buildProviderUrl(provider: string, value: string): string | null {
    if (!value) {
      return null;
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }
    if (provider === 'preset') {
      return this.resolvePresetUrl(value);
    }
    return null;
  }

  private resolvePresetUrl(assetId: string): string | null {
    const normalizedId = assetId.startsWith('preset:') ? assetId : `preset:${assetId}`;
    const direct = presetAssetLookup.get(normalizedId) ?? presetAssetLookup.get(normalizedId.toLowerCase());
    if (direct) {
      return direct;
    }
    if (this.options.presetAssetBaseUrl) {
      const base = this.options.presetAssetBaseUrl.replace(/\/+$/, '');
      const suffix = normalizedId.replace(/^preset:/, '');
      return `${base}/${suffix}`;
    }
    return null;
  }
}

class SceneGraphBuilder {
  private readonly root: THREE.Group;
  private readonly warnings: string[] = [];
  private readonly materialTemplates = new Map<string, THREE.Material>();
  private readonly textureCache = new Map<string, Promise<THREE.Texture | null>>();
  private readonly resourceCache: ResourceCache;
  private readonly loadingManager = new THREE.LoadingManager();
  private readonly textureLoader: THREE.TextureLoader;
  private readonly gltfLoader: GLTFLoader;
  private readonly disposableUrls: string[] = [];

  constructor(
    private readonly document: SceneJsonExportDocument,
    private readonly options: SceneGraphBuildOptions,
  ) {
    this.root = new THREE.Group();
    this.root.name = document.name ?? 'Scene';
    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.resourceCache = new ResourceCache(document, options, (message) => this.warn(message));
  }

  async build(): Promise<THREE.Group> {
    await this.prepareMaterialTemplates();
    const nodes = Array.isArray(this.document.nodes) ? this.document.nodes : [];
    await this.buildNodes(nodes as SceneNodeWithExtras[], this.root);
    return this.root;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  dispose(): void {
    this.disposableUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_error) {
        /* noop */
      }
    });
    this.disposableUrls.length = 0;
  }

  private warn(message: string): void {
    if (!message) {
      return;
    }
    this.warnings.push(message);
  }

  private async prepareMaterialTemplates(): Promise<void> {
    const list = Array.isArray(this.document.materials) ? this.document.materials : [];
    for (const material of list) {
      if (!material || typeof material !== 'object') {
        continue;
      }
      try {
        const instance = await this.instantiateMaterial(material);
        if (instance && material.id) {
          this.materialTemplates.set(material.id, instance);
        }
      } catch (error) {
        console.warn('创建材质失败', material.id, error);
        this.warn(`材质 ${material.name || material.id} 初始化失败`);
      }
    }
  }

  private async buildNodes(nodes: SceneNodeWithExtras[], parent: THREE.Object3D): Promise<void> {
    if (!Array.isArray(nodes)) {
      return;
    }
    for (const node of nodes) {
      if (!node) {
        continue;
      }
      const built = await this.buildSingleNode(node);
      if (!built) {
        continue;
      }
      parent.add(built);
    }
  }

  private async buildSingleNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    switch (node.nodeType) {
      case 'Group':
        return this.buildGroupNode(node);
      case 'Light':
        return this.buildLightNode(node);
      case 'Mesh':
        return this.buildMeshNode(node);
      case 'Camera':
        this.warn(`暂不支持相机节点 ${node.name ?? node.id}`);
        return null;
      default:
        return this.buildPrimitiveNode(node);
    }
  }

  private async buildGroupNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const group = new THREE.Group();
    group.name = node.name ?? 'Group';
    this.applyTransform(group, node);
    this.applyVisibility(group, node);

    if (node.sourceAssetId) {
      const asset = await this.loadAssetMesh(node.sourceAssetId);
      if (asset) {
        asset.userData = asset.userData ?? {};
        asset.userData.sourceAssetId = node.sourceAssetId;
        group.add(asset);
      }
    }

    if (Array.isArray(node.children) && node.children.length) {
      await this.buildNodes(node.children as SceneNodeWithExtras[], group);
    }

    return group;
  }

  private applyVisibility(object: THREE.Object3D, node: SceneNodeWithExtras): void {
    if (typeof node.visible === 'boolean') {
      object.visible = node.visible;
    }
  }

  private async buildLightNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const props = node.light;
    if (!props) {
      this.warn(`光源节点缺少配置 ${node.name ?? node.id}`);
      return null;
    }

    const color = new THREE.Color(props.color ?? '#ffffff');
    const intensity = Number.isFinite(props.intensity) ? Number(props.intensity) : 1;
    let light: THREE.Light | null = null;

    switch (props.type) {
      case 'Directional': {
        const directional = new THREE.DirectionalLight(color, intensity);
        directional.castShadow = !!props.castShadow;
        directional.shadow.mapSize.set(2048, 2048);
        directional.shadow.camera.near = 0.1;
        directional.shadow.camera.far = 200;
        directional.shadow.bias = -0.0002;
        light = directional;
        break;
      }
      case 'Point': {
        light = new THREE.PointLight(color, intensity, props.distance ?? 0, props.decay ?? 1);
        light.castShadow = !!props.castShadow;
        break;
      }
      case 'Spot': {
        const spot = new THREE.SpotLight(
          color,
          intensity,
          props.distance ?? 0,
          props.angle ?? Math.PI / 4,
          props.penumbra ?? 0,
          props.decay ?? 1,
        );
        spot.castShadow = !!props.castShadow;
        spot.shadow.mapSize.set(1024, 1024);
        light = spot;
        break;
      }
      case 'Ambient':
      default:
        light = new THREE.AmbientLight(color, intensity);
        break;
    }

    if (!light) {
      return null;
    }
    light.name = node.name ?? 'Light';
    this.applyTransform(light, node);
    this.applyVisibility(light, node);

    if (props.target && 'target' in light) {
      const target = new THREE.Object3D();
      target.position.set(props.target.x, props.target.y, props.target.z);
      this.root.add(target);
      (light as THREE.DirectionalLight | THREE.SpotLight).target = target;
    }

    return light;
  }

  private async buildMeshNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const meshInfo = node.dynamicMesh;
    if (meshInfo?.type === 'Ground') {
      return this.buildGroundMesh(meshInfo, node);
    }
    if (meshInfo?.type === 'Wall') {
      return this.buildWallMesh(meshInfo, node);
    }

    if (node.sourceAssetId) {
      const asset = await this.loadAssetMesh(node.sourceAssetId);
      if (asset) {
        this.applyTransform(asset, node);
        this.applyVisibility(asset, node);
        this.recordMeshStatistics(asset);
        return asset;
      }
      this.warn(`使用源资源失败 ${node.sourceAssetId}`);
    }

    return this.buildPrimitiveNode({ ...node, nodeType: node.nodeType || 'Box' });
  }

  private async buildPrimitiveNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const materials = await this.resolveNodeMaterials(node);
    const geometry = this.createGeometry(node.nodeType);
    if (!geometry) {
      this.warn(`不支持的几何类型 ${node.nodeType}`);
      return null;
    }
    const material = materials.length > 1 ? materials : materials[0];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = node.name ?? 'Primitive';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.applyTransform(mesh, node);
    this.applyVisibility(mesh, node);

    if (Array.isArray(node.children) && node.children.length) {
      await this.buildNodes(node.children as SceneNodeWithExtras[], mesh);
    }

    this.recordMeshStatistics(mesh);
    return mesh;
  }

  private async resolveNodeMaterials(node: SceneNodeWithExtras): Promise<THREE.Material[]> {
    if (!Array.isArray(node.materials) || !node.materials.length) {
      return [this.createDefaultMaterial('#ffffff')];
    }

    const resolved: THREE.Material[] = [];
    for (const entry of node.materials as SceneNodeMaterial[]) {
      if (!entry) {
        continue;
      }
      try {
        const material = await this.createMaterialForNode(entry);
        if (material) {
          resolved.push(material);
        }
      } catch (error) {
        console.warn('节点材质创建失败', entry, error);
        this.warn(`节点 ${node.name ?? node.id} 初始化材质失败`);
      }
    }

    return resolved.length ? resolved : [this.createDefaultMaterial('#ffffff')];
  }

  private createDefaultMaterial(colorHex: string): THREE.Material {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      metalness: 0.2,
      roughness: 0.7,
    });
    material.side = THREE.DoubleSide;
    material.name = 'Default Material';
    return material;
  }

  private async createMaterialForNode(entry: SceneNodeMaterial): Promise<THREE.Material | null> {
    if (entry.materialId) {
      const template = this.materialTemplates.get(entry.materialId);
      if (template) {
        const clone = template.clone();
        this.applyMaterialProps(clone, entry);
        await this.applyMaterialTextures(clone, entry.textures);
        return clone;
      }
    }
  return this.instantiateMaterial(entry);
  }

  private async instantiateMaterial(material: SceneMaterial | SceneNodeMaterial): Promise<THREE.Material | null> {
    const props = this.extractMaterialProps(material);
    const type = props.type ?? 'MeshStandardMaterial';
    const side = this.resolveMaterialSide(props.side);
    const color = new THREE.Color(props.color);
    const emissiveColor = new THREE.Color(props.emissive ?? '#000000');
    let instance: THREE.Material | null = null;

    switch (type) {
      case 'MeshBasicMaterial':
        instance = new THREE.MeshBasicMaterial({
          color,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshLambertMaterial':
        instance = new THREE.MeshLambertMaterial({
          color,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshPhongMaterial':
        instance = new THREE.MeshPhongMaterial({
          color,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshToonMaterial':
        instance = new THREE.MeshToonMaterial({
          color,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshNormalMaterial':
        instance = new THREE.MeshNormalMaterial({
          flatShading: false,
          transparent: props.transparent,
          opacity: props.opacity,
          side,
        });
        break;
      case 'MeshPhysicalMaterial':
        instance = new THREE.MeshPhysicalMaterial({
          color,
          metalness: props.metalness,
          roughness: props.roughness,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshStandardMaterial':
      default:
        instance = new THREE.MeshStandardMaterial({
          color,
          metalness: props.metalness,
          roughness: props.roughness,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
    }

    if (!instance) {
      return null;
    }

    this.applyMaterialProps(instance, material);
    await this.applyMaterialTextures(instance, props.textures);
    return instance;
  }

  private extractMaterialProps(material: SceneMaterial | SceneNodeMaterial): NormalizedMaterialProps {
    return {
      id: material.id ?? 'material',
      name: material.name ?? 'Material',
      type: material.type ?? 'MeshStandardMaterial',
      color: material.color ?? '#ffffff',
      transparent: material.transparent ?? false,
      opacity: material.opacity ?? 1,
      side: material.side ?? 'front',
      wireframe: material.wireframe ?? false,
      metalness: material.metalness ?? 0.5,
      roughness: material.roughness ?? 0.5,
      emissive: material.emissive ?? '#000000',
      emissiveIntensity: material.emissiveIntensity ?? 0,
      aoStrength: material.aoStrength ?? 1,
      envMapIntensity: material.envMapIntensity ?? 1,
      textures: (material.textures ?? {}) as SceneMaterialTextureSlotMap,
    };
  }

  private resolveMaterialSide(side?: string): THREE.Side {
    switch (side) {
      case 'back':
        return THREE.BackSide;
      case 'double':
        return THREE.DoubleSide;
      case 'front':
      default:
        return THREE.FrontSide;
    }
  }

  private applyMaterialProps(material: THREE.Material, props: SceneMaterial | SceneNodeMaterial): void {
    const materialAny = material as Record<string, any>;
    if (typeof props.transparent === 'boolean') {
      materialAny.transparent = props.transparent;
    }
    if (typeof props.opacity === 'number') {
      materialAny.opacity = props.opacity;
    }
    materialAny.side = this.resolveMaterialSide(props.side);

    if (props.color && materialAny.color?.set) {
      materialAny.color.set(props.color);
    }
    if (props.emissive && materialAny.emissive?.set) {
      materialAny.emissive.set(props.emissive);
    }
    if (typeof props.emissiveIntensity === 'number' && 'emissiveIntensity' in materialAny) {
      materialAny.emissiveIntensity = props.emissiveIntensity;
    }
    if (typeof props.wireframe === 'boolean') {
      materialAny.wireframe = props.wireframe;
    }
    if (typeof props.metalness === 'number' && 'metalness' in materialAny) {
      materialAny.metalness = props.metalness;
    }
    if (typeof props.roughness === 'number' && 'roughness' in materialAny) {
      materialAny.roughness = props.roughness;
    }
    if (typeof props.envMapIntensity === 'number' && 'envMapIntensity' in materialAny) {
      materialAny.envMapIntensity = props.envMapIntensity;
    }
    if (typeof props.aoStrength === 'number' && 'aoMapIntensity' in materialAny) {
      materialAny.aoMapIntensity = props.aoStrength;
    }

    material.needsUpdate = true;
  }

  private async applyMaterialTextures(
    material: THREE.Material,
    textures?: SceneMaterialTextureSlotMap | null,
  ): Promise<void> {
    if (!textures) {
      return;
    }
    const assignments = await this.resolveMaterialTextures(textures);
    this.assignResolvedTextures(material, assignments);
  }

  private async resolveMaterialTextures(
    textures: SceneMaterialTextureSlotMap,
  ): Promise<Record<string, THREE.Texture>> {

    const resolved: Record<string, THREE.Texture> = {};
    const entries = Object.entries(textures) as Array<[keyof SceneMaterialTextureSlotMap, any]>;
    await Promise.all(entries.map(async ([slot, ref]) => {
      if (!ref || typeof ref !== 'object' || typeof ref.assetId !== 'string') {
        return;
      }

      try {
        const texture = await this.ensureTexture(ref.assetId, ref.settings ?? null);
        if (texture) {
          const assignment = MATERIAL_TEXTURE_ASSIGNMENTS[slot];
          resolved[assignment.key] = texture;
        }
      } catch (error) {
        console.warn('材质纹理加载失败', ref, error);
        this.warn(`纹理 ${ref.assetId} 加载失败`);
      }
    }));
    return resolved;
  }

  private assignResolvedTextures(material: THREE.Material, assignments: Record<string, THREE.Texture>): void {
    if (!assignments || !material) {
      return;
    }
    Object.entries(assignments).forEach(([key, texture]) => {
      if (!texture) {
        return;
      }
      const typed = material as unknown as Record<string, any>;
      typed[key] = texture;
    });
    material.needsUpdate = true;
  }

  private async ensureTexture(
    assetId: string,
    settings: Partial<TextureSettings> | null,
  ): Promise<THREE.Texture | null> {
    const signature = `${assetId}::${this.textureSettingsSignature(settings)}`;
    if (this.textureCache.has(signature)) {
      return this.textureCache.get(signature)!;
    }
    const pending = this.createTextureInstance(assetId, settings).catch((error) => {
      console.warn('纹理加载失败', assetId, error);
      this.warn(`纹理 ${assetId} 加载失败`);
      return null;
    });
    this.textureCache.set(signature, pending);
    return pending;
  }

  private async createTextureInstance(
    assetId: string,
    settings: Partial<TextureSettings> | null,
  ): Promise<THREE.Texture | null> {
    const source = await this.resourceCache.acquireAssetSource(assetId);
    if (!source) {
      return null;
    }
    const url = await this.createTextureUrlFromSource(assetId, source);
    if (!url) {
      return null;
    }
    const texture = await this.loadTextureFromUrl(url);
    if (!texture) {
      return null;
    }
    this.applyTextureSettings(texture, settings);
    return texture;
  }

  private async createTextureUrlFromSource(assetId: string, source: AssetSource): Promise<string | null> {
    switch (source.kind) {
      case 'remote-url':
        return source.url;
      case 'data-url':
        return this.normalizeDataUrlMime(source.dataUrl, assetId);
      case 'arraybuffer': {
        const mime = this.inferMimeType(assetId) ?? 'application/octet-stream';
        const blob = new Blob([source.data], { type: mime });
        const url = URL.createObjectURL(blob);
        this.disposableUrls.push(url);
        return url;
      }
      default:
        return null;
    }
  }

  private async loadTextureFromUrl(url: string): Promise<THREE.Texture | null> {
    return new Promise((resolve) => {
      this.textureLoader.load(
        url,
        (texture) => {
          resolve(texture);
        },
        undefined,
        (error) => {
          console.warn('纹理加载错误', error);
          resolve(null);
        },
      );
    });
  }

  private applyTextureSettings(texture: THREE.Texture, overrides: Partial<TextureSettings> | null): void {
    const settings = this.createTextureSettings(overrides);
    texture.wrapS = this.resolveWrapMode(settings.wrapS);
    texture.wrapT = this.resolveWrapMode(settings.wrapT);
    if ('wrapR' in texture) {
      (texture as any).wrapR = this.resolveWrapMode(settings.wrapR);
    }

    texture.offset.set(settings.offset.x, settings.offset.y);
    texture.repeat.set(settings.repeat.x, settings.repeat.y);
    texture.center.set(settings.center.x, settings.center.y);
    texture.rotation = settings.rotation;
    texture.matrixAutoUpdate = settings.matrixAutoUpdate;
    texture.generateMipmaps = settings.generateMipmaps;
    texture.premultiplyAlpha = settings.premultiplyAlpha;
    texture.flipY = settings.flipY;
    texture.needsUpdate = true;
  }

  private resolveWrapMode(mode: string): THREE.Wrapping {
    switch (mode) {
      case 'RepeatWrapping':
        return THREE.RepeatWrapping;
      case 'MirroredRepeatWrapping':
        return THREE.MirroredRepeatWrapping;
      case 'ClampToEdgeWrapping':
      default:
        return THREE.ClampToEdgeWrapping;
    }
  }

  private createTextureSettings(overrides: Partial<TextureSettings> | null | undefined): TextureSettings {
    const base = DEFAULT_TEXTURE_SETTINGS;
    const candidate = overrides ?? {};
    return {
      wrapS: candidate.wrapS ?? base.wrapS,
      wrapT: candidate.wrapT ?? base.wrapT,
      wrapR: candidate.wrapR ?? base.wrapR,
      offset: {
        x: candidate.offset?.x ?? base.offset.x,
        y: candidate.offset?.y ?? base.offset.y,
      },
      repeat: {
        x: candidate.repeat?.x ?? base.repeat.x,
        y: candidate.repeat?.y ?? base.repeat.y,
      },
      rotation: candidate.rotation ?? base.rotation,
      center: {
        x: candidate.center?.x ?? base.center.x,
        y: candidate.center?.y ?? base.center.y,
      },
      matrixAutoUpdate: candidate.matrixAutoUpdate ?? base.matrixAutoUpdate,
      generateMipmaps: candidate.generateMipmaps ?? base.generateMipmaps,
      premultiplyAlpha: candidate.premultiplyAlpha ?? base.premultiplyAlpha,
      flipY: candidate.flipY ?? base.flipY,
    };
  }

  private textureSettingsSignature(settings: Partial<TextureSettings> | null | undefined): string {
    const resolved = this.createTextureSettings(settings);
    return [
      resolved.wrapS,
      resolved.wrapT,
      resolved.wrapR,
      resolved.offset.x,
      resolved.offset.y,
      resolved.repeat.x,
      resolved.repeat.y,
      resolved.rotation,
      resolved.center.x,
      resolved.center.y,
      resolved.matrixAutoUpdate ? 1 : 0,
      resolved.generateMipmaps ? 1 : 0,
      resolved.premultiplyAlpha ? 1 : 0,
      resolved.flipY ? 1 : 0,
    ].join('|');
  }

  private async loadAssetMesh(assetId: string): Promise<THREE.Object3D | null> {
    const source = await this.resourceCache.acquireAssetSource(assetId);
    if (!source) {
      return null;
    }

    let arrayBuffer: ArrayBuffer | null = null;

    if (source.kind === 'arraybuffer') {
      arrayBuffer = source.data;
    } else if (source.kind === 'data-url') {
      arrayBuffer = this.decodeDataUrl(source.dataUrl);

    } else if (source.kind === 'remote-url') {
      arrayBuffer = await this.downloadArrayBuffer(source.url);
    }

    if (!arrayBuffer) {
      this.warn(`资源数据为空 ${assetId}`);
      return null;
    }

    try {
      const root = await this.parseGltf(arrayBuffer);
      if (!root) {
        this.warn(`GLTF 解析失败 ${assetId}`);
        return null;
      }
      const prepared = cloneSkinned(root);
      this.prepareImportedObject(prepared);
      return prepared;
    } catch (error) {
      console.warn('GLTF 解析异常', assetId, error);
      this.warn(`模型 ${assetId} 解析失败`);
      return null;
    }
  }

  private prepareImportedObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as unknown as THREE.Mesh;
      if (mesh && (mesh as any).isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => {
            if (mat) {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            }
          });
        } else if (mesh.material) {
          const mat = mesh.material as THREE.Material;
          (mat as any).side = THREE.DoubleSide;
          mat.needsUpdate = true;
        }
      }
    });
  }

  private async parseGltf(buffer: ArrayBuffer): Promise<THREE.Object3D | null> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.parse(
        buffer,
        '',
        (gltf) => {
          resolve(gltf.scene ?? null);
        },
        (error) => {
          reject(error);
        },
      );
    });
  }


  private decodeDataUrl(dataUrl: string): ArrayBuffer | null {
    if (typeof dataUrl !== 'string') {
          throw new TypeError('dataUrl must be a string');
    }
    const [, base64] = dataUrl.split(',');
    const clean = (base64 !== null && base64 !== void 0 ? base64 : '').replace(/\s/g, '');
    if (!clean) {
        return new ArrayBuffer(0);
    }
    return uni.base64ToArrayBuffer(clean);
  }
  

  private async downloadArrayBuffer(url: string): Promise<ArrayBuffer | null> {
    if (!url) {
      return null;
    }

    if (typeof fetch === 'function') {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`下载失败 ${response.status}`);
      }
      return response.arrayBuffer();
    }

    if (typeof uni !== 'undefined' && typeof uni.request === 'function') {
      return await new Promise((resolve, reject) => {
        uni.request({
          url,
          method: 'GET',
          responseType: 'arraybuffer',
          success: (res) => {
            if ((res.statusCode === 200 || res.statusCode === undefined) && res.data) {
              resolve(res.data as ArrayBuffer);
              return;
            }
            reject(new Error(`下载失败: ${res.statusCode}`));
          },
          fail: (error: unknown) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        });
      });
    }

    throw new Error('缺少可用的下载方式');
  }

  private normalizeDataUrlMime(dataUrl: string, assetId: string): string {
    if (!dataUrl.startsWith('data:')) {
      return dataUrl;
    }
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
      return dataUrl;
    }
    const header = dataUrl.slice(0, commaIndex);
    if (header.includes(';base64')) {
      return dataUrl;
    }
    const mime = this.inferMimeType(assetId) ?? 'application/octet-stream';
    return `data:${mime};base64,${dataUrl.slice(commaIndex + 1)}`;
  }

  private inferMimeType(assetId: string): string | null {
    const lower = assetId.toLowerCase();
    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.ktx2')) {
      return 'image/ktx2';
    }
    if (lower.endsWith('.ktx')) {
      return 'image/ktx';
    }
    if (lower.endsWith('.hdr')) {
      return 'image/vnd.radiance';
    }
    if (lower.endsWith('.dds')) {
      return 'image/vnd-ms.dds';
    }
    if (lower.endsWith('.gif')) {
      return 'image/gif';
    }
    if (lower.endsWith('.bmp')) {
      return 'image/bmp';
    }
    if (lower.endsWith('.tga')) {
      return 'image/x-tga';
    }
    if (lower.endsWith('.glb')) {
      return 'model/gltf-binary';
    }
    if (lower.endsWith('.gltf')) {
      return 'model/gltf+json';
    }
    return null;
  }

  private createGeometry(type: SceneNode['nodeType']): THREE.BufferGeometry | null {
    switch (type) {
      case 'Box':
        return new THREE.BoxGeometry(1, 1, 1);
      case 'Sphere':
        return new THREE.SphereGeometry(0.5, 32, 16);
      case 'Capsule':
        return new THREE.CapsuleGeometry(0.5, 1, 16, 32);
      case 'Circle':
        return new THREE.CircleGeometry(0.5, 32);
      case 'Cylinder':
        return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
      case 'Dodecahedron':
        return new THREE.DodecahedronGeometry(0.6, 0);
      case 'Icosahedron':
        return new THREE.IcosahedronGeometry(0.6, 0);
      case 'Lathe': {
        const points: THREE.Vector2[] = [];
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

  private applyTransform(object: THREE.Object3D, node: SceneNode): void {
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

  private async buildGroundMesh(meshInfo: any, node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const width = Number(meshInfo.width) || 10;
    const depth = Number(meshInfo.depth) || 10;
    const rows = Number(meshInfo.rows) || 1;
    const columns = Number(meshInfo.columns) || 1;
    const geometry = new THREE.PlaneGeometry(width, depth, columns, rows);
    geometry.rotateX(-Math.PI / 2);
    const materials = await this.resolveNodeMaterials(node);
    const mesh = new THREE.Mesh(geometry, materials.length > 1 ? materials : materials[0]);
    mesh.name = node.name ?? 'Ground';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.applyTransform(mesh, node);
    this.applyVisibility(mesh, node);
    this.recordMeshStatistics(mesh);
    return mesh;
  }

  private async buildWallMesh(meshInfo: any, node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const container = new THREE.Group();
    container.name = node.name ?? 'Wall';
    const materials = await this.resolveNodeMaterials(node);
    const material = materials.length > 1 ? materials : materials[0];

    const segments = Array.isArray(meshInfo.segments) ? meshInfo.segments : [];
    segments.forEach((segment: any, index: number) => {
      const start = segment.start ?? { x: 0, y: 0, z: 0 };
      const end = segment.end ?? { x: 0, y: 0, z: 0 };
      const height = Number(segment.height) || 2.5;
      const thickness = Number(segment.thickness) || 0.2;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dz = end.z - start.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const geometry = new THREE.BoxGeometry(length, height, thickness);
      const wallSegment = new THREE.Mesh(geometry, material);
      wallSegment.castShadow = true;
      wallSegment.receiveShadow = true;
      wallSegment.name = `${container.name}-${index}`;
      const midpoint = {
        x: (start.x + end.x) / 2,
        y: height / 2,
        z: (start.z + end.z) / 2,
      };
      wallSegment.position.set(midpoint.x, midpoint.y, midpoint.z);
      wallSegment.lookAt(end.x, midpoint.y, end.z);
      container.add(wallSegment);
    });

    this.applyTransform(container, node);
    this.applyVisibility(container, node);
    return container;
  }

  private recordMeshStatistics(object: THREE.Object3D): void {
    void object;
  }
}

export async function buildSceneGraph(
  document: SceneJsonExportDocument,
  options: SceneGraphBuildOptions = {},
): Promise<SceneGraphBuildResult> {
  const builder = new SceneGraphBuilder(document, options);
  try {
    const root = await builder.build();
    console.log(root);
    return { root, warnings: builder.getWarnings() };
  } finally {
    builder.dispose();
  }
}
