import * as THREE from 'three';
import Loader, { type LoaderLoadedPayload } from '@schema/loader';
import { AssetCache, AssetLoader, type AssetCacheEntry, type AssetSource } from './assetCache';
import { SceneMaterialFactory, type MaterialAssetProvider, type MaterialAssetSource, textureSettingsSignature } from './material';
import { createPrimitiveGeometry } from './geometry';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type {
  SceneJsonExportDocument,
  SceneMaterial,
  SceneNode,
  SceneNodeComponentMap,
  SceneNodeEditorFlags,
  SceneNodeMaterial,
  SceneMaterialTextureSettings,
} from '@harmony/schema';
declare const uni: {
  base64ToArrayBuffer?: (input: string) => ArrayBuffer;
  request?: (options: {
    url: string;
    method?: string;
    responseType?: 'arraybuffer' | 'text';
    success: (payload: { statusCode?: number; data?: unknown }) => void;
    fail: (error: unknown) => void;
  }) => void;
} | undefined;

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
    target?: THREE.Vector3;
  };
  dynamicMesh?: any;
  components?: SceneNodeComponentMap;
  editorFlags?: SceneNodeEditorFlags;
};


function extractPresetRelativePath(candidate: string): string | null {
  if (!candidate) {
    return null;
  }
  const withoutQuery = candidate.replace(/\?.*$/, '');
  const parts = withoutQuery.split(/[\\/]+/).filter(Boolean);
  const presetIndex = parts.lastIndexOf('preset');
  if (presetIndex === -1) {
    return null;
  }
  const relativeSegments = parts.slice(presetIndex + 1);
  if (!relativeSegments.length) {
    return null;
  }
  return relativeSegments.join('/');
}

function buildPresetAssetLookup(): Map<string, string> {
  const lookup = new Map<string, string>();

  const glob = (import.meta as unknown as { glob?: (pattern: string, options?: Record<string, unknown>) => Record<string, unknown> }).glob;
  if (typeof glob === 'function') {
    const modules = glob('../src/preset/**/*', {
      eager: true,
      import: 'default',
      query: '?url',
    }) as Record<string, string>;
    Object.entries(modules).forEach(([key, url]) => {
      const relative = extractPresetRelativePath(key);
      if (!relative) {
        return;
      }
      const normalized = relative.replace(/^[\\/]+/, '').replace(/\\/g, '/');
      const lower = normalized.toLowerCase();
      lookup.set(`preset:${normalized}`, url);
      lookup.set(`preset:${lower}`, url);
    });
  }

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

export type SceneGraphResourceKind = 'asset' | 'texture' | 'mesh';

export interface SceneGraphResourceProgress {
  total: number;
  loaded: number;
  kind: SceneGraphResourceKind;
  assetId: string | null;
  message?: string;
}

export interface SceneGraphBuildOptions {
  enableGround?: boolean;
  presetAssetBaseUrl?: string;
  resolveAssetUrl?: (assetId: string) => string | Promise<string | null> | null | undefined;
  assetOverrides?: Record<string, string | ArrayBuffer>;
  onProgress?: (progress: SceneGraphResourceProgress) => void;
}

class ResourceCache implements MaterialAssetProvider {
  private packageEntries: Map<string, { provider: string; value: string } | null> = new Map();
  private readonly assetEntryCache = new Map<string, Promise<AssetCacheEntry | null>>();
  private readonly document: SceneJsonExportDocument;
  private readonly options: SceneGraphBuildOptions;
  private readonly warn: (message: string) => void;
  private readonly assetLoader: AssetLoader;

  constructor(
    document: SceneJsonExportDocument,
    options: SceneGraphBuildOptions,
    warn: (message: string) => void,
    assetLoader: AssetLoader,
  ) {
    this.document = document;
    this.options = options;
    this.warn = warn;
    this.assetLoader = assetLoader;
  }

  async acquireAssetSource(assetId: string): Promise<MaterialAssetSource | null> {
    const entry = await this.acquireAssetEntry(assetId);
    if (!entry) {
      return null;
    }
    if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
      return { kind: 'arraybuffer', data: entry.arrayBuffer };
    }
    if (entry.blobUrl) {
      return { kind: 'remote-url', url: entry.blobUrl };
    }
    if (entry.downloadUrl) {
      return { kind: 'remote-url', url: entry.downloadUrl };
    }
    return null;
  }

  async acquireAssetEntry(assetId: string): Promise<AssetCacheEntry | null> {
    if (!assetId) {
      return null;
    }
    const cached = this.assetLoader.getCache().getEntry(assetId);
    if (cached?.status === 'cached') {
      this.assetLoader.getCache().touch(assetId);
    }
    if (this.assetEntryCache.has(assetId)) {
      return this.assetEntryCache.get(assetId)!;
    }

    const pending = this.resolveAssetSource(assetId)
      .then(async (source) => {
        if (!source) {
          return null;
        }
        try {
          const entry = await this.assetLoader.load(assetId, source);
          this.assetLoader.getCache().registerUsage(assetId);
          return entry;
        } catch (error) {
          console.warn('资源加载失败', assetId, error);
          this.warn(`无法加载资源 ${assetId}`);
          return null;
        }
      })
      .then((entry) => {
        if (!entry) {
          this.assetEntryCache.delete(assetId);
        }
        return entry;
      })
      .catch((error) => {
        console.warn('获取资源来源失败', assetId, error);
        this.warn(`无法解析资源 ${assetId}`);
        this.assetEntryCache.delete(assetId);
        return null;
      });

    this.assetEntryCache.set(assetId, pending);
    return pending;
  }

  private async resolveAssetSource(assetId: string): Promise<AssetSource | null> {
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
      const buffer = this.base64ToArrayBuffer(entry);
      if (buffer) {
        return { kind: 'arraybuffer', data: buffer };
      }
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

  private async resolvePackageEntry(
    assetId: string,
    provider: string,
    value: string,
  ): Promise<AssetSource | null> {
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
    const relative = normalizedId.replace(/^preset:/, '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
    if (relative) {
      return `/src/preset/${relative}`;
    }
    return null;
  }
}

type MeshTemplate = {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
};

class SceneGraphBuilder {
  private readonly root: THREE.Group;
  private readonly warnings: string[] = [];
  private readonly resourceCache: ResourceCache;
  private readonly loadingManager = new THREE.LoadingManager();
  private readonly materialFactory: SceneMaterialFactory;
  private readonly binaryCache = new AssetCache();
  private readonly assetLoader = new AssetLoader(this.binaryCache);
  private readonly meshTemplateCache = new Map<string, MeshTemplate>();
  private readonly pendingMeshLoads = new Map<string, Promise<MeshTemplate | null>>();
  private readonly document: SceneJsonExportDocument;
  private readonly onProgress?: (progress: SceneGraphResourceProgress) => void;
  private progressTotal = 0;
  private progressLoaded = 0;

  constructor(
    document: SceneJsonExportDocument,
    options: SceneGraphBuildOptions,
  ) {
    this.document = document;
    this.root = new THREE.Group();
    this.root.name = document.name ?? 'Scene';
    this.resourceCache = new ResourceCache(document, options, (message) => this.warn(message), this.assetLoader);
    this.materialFactory = new SceneMaterialFactory({
      provider: this.resourceCache,
      loadingManager: this.loadingManager,
      warn: (message) => this.warn(message),
    });
    this.onProgress = options.onProgress;
  }

  async build(): Promise<THREE.Group> {
    const materials = Array.isArray(this.document.materials) ? (this.document.materials as SceneMaterial[]) : [];
    const nodes = Array.isArray(this.document.nodes) ? (this.document.nodes as SceneNodeWithExtras[]) : [];
    await this.preloadAssets(materials, nodes);
    await this.materialFactory.prepareTemplates(materials);
    await this.buildNodes(nodes, this.root);
    return this.root;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  dispose(): void {
    this.materialFactory.dispose();
    this.meshTemplateCache.clear();
    this.pendingMeshLoads.clear();
  }

  private warn(message: string): void {
    if (!message) {
      return;
    }
    this.warnings.push(message);
  }

  private beginProgress(total: number): void {
    this.progressTotal = total;
    this.progressLoaded = 0;
    if (!this.onProgress) {
      return;
    }
    const message = total > 0 ? '开始加载资源' : '无需加载额外资源';
    this.onProgress({
      total,
      loaded: 0,
      kind: 'asset',
      assetId: null,
      message,
    });
  }

  private incrementProgress(kind: SceneGraphResourceKind, assetId: string | null, message?: string): void {
    if (!this.onProgress) {
      return;
    }
    if (this.progressTotal > 0) {
      this.progressLoaded = Math.min(this.progressLoaded + 1, this.progressTotal);
    }
    this.onProgress({
      total: this.progressTotal,
      loaded: this.progressLoaded,
      kind,
      assetId,
      message,
    });
  }

  private finalizeProgress(message = '资源加载完成'): void {
    if (!this.onProgress) {
      return;
    }
    if (this.progressTotal > 0 && this.progressLoaded < this.progressTotal) {
      this.progressLoaded = this.progressTotal;
    }
    this.onProgress({
      total: this.progressTotal,
      loaded: this.progressLoaded,
      kind: 'asset',
      assetId: null,
      message,
    });
  }

  private async preloadAssets(
    materials: SceneMaterial[],
    nodes: SceneNodeWithExtras[],
  ): Promise<void> {
    const textureRequests = this.collectTexturePreloadRequests(materials, nodes);
    const meshAssetIds = this.collectMeshAssetIds(nodes);
    const total = textureRequests.length + meshAssetIds.length;
    this.beginProgress(total);
    if (total === 0) {
      this.finalizeProgress();
      return;
    }

    const tasks: Promise<void>[] = [];

    textureRequests.forEach((request) => {
      tasks.push(
        this.preloadTextureAsset(request.assetId, request.settings).finally(() => {
          this.incrementProgress('texture', request.assetId, `纹理 ${request.assetId}`);
        }),
      );
    });

    meshAssetIds.forEach((assetId) => {
      tasks.push(
        this.preloadMeshAsset(assetId).finally(() => {
          this.incrementProgress('mesh', assetId, `模型 ${assetId}`);
        }),
      );
    });

    await Promise.all(tasks);
    this.finalizeProgress();
  }

  private collectTexturePreloadRequests(
    materials: SceneMaterial[],
    nodes: SceneNodeWithExtras[],
  ): Array<{ assetId: string; settings: SceneMaterialTextureSettings | null }> {
    const requests = new Map<string, { assetId: string; settings: SceneMaterialTextureSettings | null }>();

    const enqueue = (
      candidate: { assetId?: string; settings?: SceneMaterialTextureSettings | null } | null | undefined,
    ): void => {
      if (!candidate || typeof candidate.assetId !== 'string' || !candidate.assetId) {
        return;
      }
      const signature = `${candidate.assetId}::${textureSettingsSignature(candidate.settings ?? null)}`;
      if (!requests.has(signature)) {
        requests.set(signature, {
          assetId: candidate.assetId,
          settings: candidate.settings ?? null,
        });
      }
    };

    materials.forEach((material) => {
      if (!material) {
        return;
      }
      const textures = material.textures ?? {};
      Object.values(textures).forEach((ref) => {
        enqueue(ref as { assetId?: string; settings?: SceneMaterialTextureSettings | null } | null);
      });
    });

    const stack: SceneNodeWithExtras[] = [...nodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (Array.isArray(node.materials)) {
        node.materials.forEach((entry) => {
          if (!entry) {
            return;
          }
          const textures = entry.textures ?? {};
          Object.values(textures).forEach((ref) => {
            enqueue(ref as { assetId?: string; settings?: SceneMaterialTextureSettings | null } | null);
          });
        });
      }
      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNodeWithExtras[]));
      }
    }

    return Array.from(requests.values());
  }

  private collectMeshAssetIds(nodes: SceneNodeWithExtras[]): string[] {
    const ids = new Set<string>();
    const stack: SceneNodeWithExtras[] = [...nodes];
    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (typeof node.sourceAssetId === 'string' && node.sourceAssetId) {
        ids.add(node.sourceAssetId);
      }
      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNodeWithExtras[]));
      }
    }
    return Array.from(ids);
  }

  private async preloadTextureAsset(
    assetId: string,
    settings: SceneMaterialTextureSettings | null,
  ): Promise<void> {
    if (!assetId) {
      return;
    }
    try {
      await this.materialFactory.preloadTexture(assetId, settings ?? null);
    } catch (error) {
      console.warn('纹理预加载失败', assetId, error);
      this.warn(`纹理 ${assetId} 预加载失败`);
    }
  }

  private async preloadMeshAsset(assetId: string): Promise<void> {
    if (!assetId) {
      return;
    }
    try {
      await this.warmMeshAsset(assetId);
    } catch (error) {
      console.warn('模型预加载失败', assetId, error);
      this.warn(`模型 ${assetId} 预加载失败`);
    }
  }

  private async warmMeshAsset(assetId: string): Promise<void> {
    if (!assetId || this.meshTemplateCache.has(assetId)) {
      return;
    }

    const existing = this.pendingMeshLoads.get(assetId);
    if (existing) {
      await existing;
      return;
    }

    const pending = this.fetchAndParseMesh(assetId);
    this.pendingMeshLoads.set(assetId, pending);

    try {
      const base = await pending;
      if (base) {
        this.meshTemplateCache.set(assetId, base);
      }
    } finally {
      this.pendingMeshLoads.delete(assetId);
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
      this.applyNodeMetadata(built, node);
      parent.add(built);
    }
  }

  private async buildSingleNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    if (node.editorFlags?.editorOnly) {
      return this.buildEditorOnlyNode(node);
    }
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

  private async buildEditorOnlyNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const placeholder = new THREE.Group();
    placeholder.name = node.name ?? 'Editor Marker';
    this.applyTransform(placeholder, node);
    placeholder.visible = false;
    placeholder.userData = {
      ...(placeholder.userData ?? {}),
      editorOnly: true,
    };

    if (Array.isArray(node.children) && node.children.length) {
      await this.buildNodes(node.children as SceneNodeWithExtras[], placeholder);
    }

    return placeholder;
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
    const geometry = createPrimitiveGeometry(node.nodeType);
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

  private applyNodeMetadata(object: THREE.Object3D, node: SceneNodeWithExtras): void {
    if (!object || !node || !node.id) {
      return;
    }
    const metadata = object.userData ?? (object.userData = {});
    metadata.nodeId = node.id;
    const resolvedType = node.nodeType ?? (node.light ? 'Light' : node.dynamicMesh ? 'Mesh' : 'Group');
    metadata.nodeType = resolvedType;
    metadata.dynamicMeshType = node.dynamicMesh?.type ?? null;
    metadata.lightType = node.light?.type ?? null;
    metadata.sourceAssetId = node.sourceAssetId ?? null;
  }

  private async resolveNodeMaterials(node: SceneNodeWithExtras): Promise<THREE.Material[]> {
    return this.materialFactory.resolveNodeMaterials(node.materials as SceneNodeMaterial[] | null | undefined, {
      nodeId: node.id,
      nodeName: node.name,
    });
  }

  private async loadAssetMesh(assetId: string): Promise<THREE.Object3D | null> {
    if (!assetId) {
      return null;
    }
    if (this.meshTemplateCache.has(assetId)) {
      return this.instantiateCachedMesh(this.meshTemplateCache.get(assetId)!);
    }

    await this.warmMeshAsset(assetId);

    const base = this.meshTemplateCache.get(assetId);
    return base ? this.instantiateCachedMesh(base) : null;
  }

  private instantiateCachedMesh(base: MeshTemplate): THREE.Object3D {
    const prepared = cloneSkinned(base.scene);
    if (base.animations?.length) {
      const animations = base.animations.map((clip) => clip.clone());
      (prepared as unknown as { animations?: THREE.AnimationClip[] }).animations = animations;
      prepared.userData = prepared.userData ?? {};
      prepared.userData.__animations = animations.map((clip) => clip.name);
    }
    this.prepareImportedObject(prepared);
    return prepared;
  }

  private loadObjectFromFile(file: File): Promise<THREE.Object3D> {
    return new Promise<THREE.Object3D>((resolve, reject) => {
      const loader = new Loader()

      const handleLoaded = (payload: LoaderLoadedPayload) => {
        cleanup()
        if (!payload) {
          reject(new Error('解析资源失败'))
          return
        }
        resolve(payload as THREE.Object3D)
      }

      const cleanup = () => {
        loader.removeEventListener('loaded', handleLoaded)
      }
      loader.addEventListener('loaded', handleLoaded)

      try {
        loader.loadFile(file)
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  private createFileFromEntry(assetId: string, entry: AssetCacheEntry): File | null {
    const filename = entry.filename && entry.filename.trim().length ? entry.filename : `${assetId}.glb`;
    const mimeType = entry.mimeType ?? 'application/octet-stream';

    if (entry.blob instanceof File) {
      return entry.blob;
    }

    if (entry.blob) {
      try {
        return new File([entry.blob], filename, { type: mimeType });
      } catch (_error) {
        /* noop */
      }
    }

    if (entry.arrayBuffer) {
      try {
        return new File([entry.arrayBuffer], filename, { type: mimeType });
      } catch (_error) {
        if (typeof Blob !== 'undefined') {
          try {
            const blob = new Blob([entry.arrayBuffer], { type: mimeType });
            return new File([blob], filename, { type: mimeType });
          } catch (_innerError) {
            /* noop */
          }
        }
      }
    }

    if (entry.blob) {
      return null;
    }

    return null;
  }

  private async fetchAndParseMesh(assetId: string): Promise<MeshTemplate | null> {
    const entry = await this.resourceCache.acquireAssetEntry(assetId);
    if (!entry) {
      return null;
    }

    const file = this.createFileFromEntry(assetId, entry);
    if (!file) {
      this.warn(`无法创建文件对象 ${assetId}`);
      return null;
    }

    try {
      const parsed = await this.loadObjectFromFile(file);
      const animations = (parsed as unknown as { animations?: THREE.AnimationClip[] }).animations ?? [];
      return { scene: parsed, animations };
    } catch (error) {
      console.warn('GLTF 解析异常', assetId, error);
      this.warn(`模型 ${assetId} 解析失败`);
      return null;
    }
  }

  private prepareImportedObject(object: THREE.Object3D): void {
    object.traverse((child: THREE.Object3D) => {
      const mesh = child as unknown as THREE.Mesh;
      if (mesh && (mesh as any).isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat: THREE.Material | null | undefined) => {
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
    return { root, warnings: builder.getWarnings() };
  } finally {
    builder.dispose();
  }
}
