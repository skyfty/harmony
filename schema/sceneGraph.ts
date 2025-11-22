import * as THREE from 'three';
import Loader, { type LoaderLoadedPayload } from '@schema/loader';
import type { AssetCacheEntry } from './assetCache';
import { SceneMaterialFactory } from './material';
import type { SceneMaterialFactoryOptions } from './material';
import { createPrimitiveGeometry } from './geometry';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import ResourceCache from './ResourceCache';
import type {
  SceneJsonExportDocument,
  SceneMaterial,
  SceneNode,
  SceneNodeComponentMap,
  SceneNodeComponentState,
  SceneNodeEditorFlags,
  SceneNodeMaterial,
  SceneOutlineMesh,
  SceneOutlineMeshMap,
  GroundDynamicMesh,
  SceneResourceSummaryEntry,
  SceneMaterialTextureSlot,
} from '@harmony/schema';
import type { GuideboardComponentProps } from './components/definitions/guideboardComponent';
import { GUIDEBOARD_COMPONENT_TYPE } from './components/definitions/guideboardComponent';
import type { ViewPointComponentProps } from './components/definitions/viewPointComponent';
import { VIEW_POINT_COMPONENT_TYPE } from './components/definitions/viewPointComponent';
import type { WarpGateComponentProps } from './components/definitions/warpGateComponent';
import { WARP_GATE_COMPONENT_TYPE } from './components/definitions/warpGateComponent';
import type { EffectComponentProps } from './components/definitions/effectComponent';
import {
  EFFECT_COMPONENT_TYPE,
  EFFECT_METADATA_KEY,
  clampEffectComponentProps,
} from './components/definitions/effectComponent';

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

const MATERIAL_TEXTURE_SLOTS: SceneMaterialTextureSlot[] = [
  'albedo',
  'normal',
  'metalness',
  'roughness',
  'ao',
  'emissive',
  'displacement',
];

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
  progress?: number;
  bytesTotal?: number;
  bytesLoaded?: number;
}

export interface SceneGraphBuildOptions {
  enableGround?: boolean;
  presetAssetBaseUrl?: string;
  resolveAssetUrl?: (assetId: string) => string | Promise<string | null> | null | undefined;
  assetOverrides?: Record<string, string | ArrayBuffer>;
  onProgress?: (progress: SceneGraphResourceProgress) => void;
  lazyLoadMeshes?: boolean;
  materialFactoryOptions?: Pick<SceneMaterialFactoryOptions, 'textureLoader' | 'hdrLoader'>;
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
  private readonly groundTextureLoader: THREE.TextureLoader;
  private readonly meshTemplateCache = new Map<string, MeshTemplate>();
  private readonly pendingMeshLoads = new Map<string, Promise<MeshTemplate | null>>();
  private readonly document: SceneJsonExportDocument;
  private readonly outlineMeshMap: SceneOutlineMeshMap;
  private readonly onProgress?: (progress: SceneGraphResourceProgress) => void;
  private readonly buildOptions: SceneGraphBuildOptions;
  private progressTotal = 0;
  private progressLoaded = 0;
  private readonly assetSizeMap = new Map<string, number>();
  private readonly assetLoadedMap = new Map<string, number>();
  private progressBytesTotal = 0;
  private progressBytesLoaded = 0;
  constructor(
    document: SceneJsonExportDocument,
    options: SceneGraphBuildOptions,
    resourceCache: ResourceCache,
  ) {
    this.document = document;
    this.root = new THREE.Group();
    this.root.name = document.name ?? 'Scene';
    this.resourceCache = resourceCache;
    this.buildOptions = options;
    this.outlineMeshMap = { ...(document.outlineMeshMap ?? {}) };
    this.resourceCache.setContext(document, options);
    this.resourceCache.setHandlers({
      warn: (message) => this.warn(message),
      reportDownloadProgress: (payload) => this.reportAssetDownloadProgress(payload.assetId, payload.progress),
    });
    const materialFactoryOverrides = options.materialFactoryOptions ?? {};
    this.groundTextureLoader = new THREE.TextureLoader(this.loadingManager);
    this.materialFactory = new SceneMaterialFactory({
      provider: this.resourceCache,
      loadingManager: this.loadingManager,
      warn: (message) => this.warn(message),
      textureLoader: materialFactoryOverrides.textureLoader,
      hdrLoader: materialFactoryOverrides.hdrLoader,
    });
    this.onProgress = options.onProgress;

    const summary = document.resourceSummary;
    if (summary && Array.isArray(summary.assets)) {
      let aggregatedTotal = 0;
      let aggregatedPreloaded = 0;

      summary.assets.forEach((entry) => {
        if (!entry || typeof entry.assetId !== 'string' || !entry.assetId.length) {
          return;
        }
        const size = Number.isFinite(entry.bytes) && entry.bytes > 0 ? entry.bytes : 0;
        if (size > 0 || !this.assetSizeMap.has(entry.assetId)) {
          this.assetSizeMap.set(entry.assetId, size);
        }
        aggregatedTotal += size;
        if (this.isSummaryAssetPreloaded(entry)) {
          this.assetLoadedMap.set(entry.assetId, size);
          aggregatedPreloaded += size;
        }
      });

      const resolvedTotal = Number.isFinite(summary.totalBytes) && summary.totalBytes > 0 ? summary.totalBytes : aggregatedTotal;
      this.progressBytesTotal = resolvedTotal;

      const resolvedPreloaded = Number.isFinite(summary.embeddedBytes) && summary.embeddedBytes >= 0
        ? summary.embeddedBytes
        : aggregatedPreloaded;

      if (resolvedPreloaded > 0) {
        const cappedPreloaded = resolvedTotal > 0 ? Math.min(resolvedPreloaded, resolvedTotal) : resolvedPreloaded;
        this.progressBytesLoaded = cappedPreloaded;
      }
    }
  }

  async build(): Promise<THREE.Group> {
    const materials = Array.isArray(this.document.materials) ? (this.document.materials as SceneMaterial[]) : [];
    const nodes = Array.isArray(this.document.nodes) ? (this.document.nodes as SceneNodeWithExtras[]) : [];
    await this.preloadAssets(nodes, materials);
    await this.materialFactory.prepareTemplates(materials);
    await this.buildNodes(nodes, this.root);
    return this.root;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  dispose(): void {
    this.resourceCache.setHandlers({ warn: null, reportDownloadProgress: null });
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

  private isSummaryAssetPreloaded(entry: SceneResourceSummaryEntry | null | undefined): boolean {
    if (!entry) {
      return false;
    }
    if (entry.inline) {
      return true;
    }
    if (entry.embedded) {
      return true;
    }
    if (entry.source === 'embedded' || entry.source === 'inline') {
      return true;
    }
    return false;
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
      bytesTotal: this.progressBytesTotal,
      bytesLoaded: this.progressBytesLoaded,
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
      bytesTotal: this.progressBytesTotal,
      bytesLoaded: this.progressBytesLoaded,
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
      bytesTotal: this.progressBytesTotal,
      bytesLoaded: this.progressBytesLoaded,
    });
  }

  private reportAssetDownloadProgress(assetId: string, progress: number): void {
    if (!this.onProgress) {
      return;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    if (assetId && this.assetSizeMap.has(assetId)) {
      const size = this.assetSizeMap.get(assetId) ?? 0;
      if (size > 0) {
        const loadedBytes = Math.round((size * clamped) / 100);
        this.updateAssetLoadedBytes(assetId, loadedBytes);
      }
    }
    const label = assetId && assetId.trim().length ? assetId : '资源';
    const message = clamped >= 100
      ? `资源 ${label} 下载完成`
      : `资源 ${label} 下载中 (${clamped}%)`;
    this.onProgress({
      total: this.progressTotal,
      loaded: this.progressLoaded,
      kind: 'asset',
      assetId,
      message,
      progress: clamped,
      bytesTotal: this.progressBytesTotal,
      bytesLoaded: this.progressBytesLoaded,
    });
  }

  private async preloadAssets(
    nodes: SceneNodeWithExtras[],
    materials: SceneMaterial[],
  ): Promise<void> {
    const meshAssetIds = this.buildOptions.lazyLoadMeshes ? [] : this.collectMeshAssetIds(nodes);
    const textureAssetIds = this.collectTextureAssetIds(nodes, materials);
    const total = meshAssetIds.length + textureAssetIds.length;
    this.beginProgress(total);
    if (total === 0) {
      this.finalizeProgress();
      return;
    }

    const tasks: Promise<void>[] = [];

    meshAssetIds.forEach((assetId: string) => {
      tasks.push(
        this.preloadMeshAsset(assetId).finally(() => {
          this.incrementProgress('mesh', assetId, `模型 ${assetId}`);
        }),
      );
    });

    textureAssetIds.forEach((assetId: string) => {
      tasks.push(
        this.preloadTextureAsset(assetId).finally(() => {
          this.incrementProgress('texture', assetId, `纹理 ${assetId}`);
        }),
      );
    });

    await Promise.all(tasks);
    this.finalizeProgress();
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

  private collectTextureAssetIds(
    nodes: SceneNodeWithExtras[],
    materials: SceneMaterial[],
  ): string[] {
    const ids = new Set<string>();
    const materialMap = new Map<string, SceneMaterial>();
    materials.forEach((material: SceneMaterial) => {
      if (!material || typeof material !== 'object' || typeof material.id !== 'string') {
        return;
      }
      const trimmed = material.id.trim();
      if (trimmed) {
        materialMap.set(trimmed, material);
      }
    });

    const stack: SceneNodeWithExtras[] = Array.isArray(nodes) ? [...nodes] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (Array.isArray(node.materials) && node.materials.length) {
        (node.materials as SceneNodeMaterial[]).forEach((nodeMaterial: SceneNodeMaterial) => {
          this.collectTextureRefsFromMaterial(nodeMaterial, ids);
          const baseId = typeof nodeMaterial?.materialId === 'string' ? nodeMaterial.materialId.trim() : '';
          if (baseId) {
            const baseMaterial = materialMap.get(baseId);
            if (baseMaterial) {
              this.collectTextureRefsFromMaterial(baseMaterial, ids);
            }
          }
        });
      }
      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNodeWithExtras[]));
      }
    }

    return Array.from(ids);
  }

  private collectTextureRefsFromMaterial(
    material: SceneMaterial | SceneNodeMaterial | null | undefined,
    bucket: Set<string>,
  ): void {
    if (!material || typeof material !== 'object') {
      return;
    }
    const textures = material.textures as Partial<Record<SceneMaterialTextureSlot, { assetId?: string } | null>> | undefined;
    if (!textures) {
      return;
    }
    MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
      const ref = textures[slot];
      const assetId = typeof ref === 'object' && ref ? (ref.assetId ?? '').trim() : '';
      if (assetId) {
        bucket.add(assetId);
      }
    });
  }

  private async preloadTextureAsset(assetId: string): Promise<void> {
    if (!assetId) {
      return;
    }
    try {
      const entry = await this.resourceCache.acquireAssetEntry(assetId);
      if (entry) {
        this.registerAssetEntryLoad(assetId, entry);
      }
    } catch (error) {
      console.warn('纹理预加载失败', assetId, error);
      this.warn(`纹理 ${assetId} 预加载失败`);
    }
  }

  private resolveEntrySize(entry: AssetCacheEntry | null | undefined): number {
    if (!entry) {
      return 0;
    }
    if (typeof entry.size === 'number' && entry.size > 0) {
      return entry.size;
    }
    if (entry.arrayBuffer && entry.arrayBuffer.byteLength > 0) {
      return entry.arrayBuffer.byteLength;
    }
    if (entry.blob && typeof entry.blob.size === 'number' && entry.blob.size > 0) {
      return entry.blob.size;
    }
    return 0;
  }

  private updateAssetSize(assetId: string, size: number): void {
    if (!assetId || size <= 0) {
      return;
    }
    const previous = this.assetSizeMap.get(assetId) ?? 0;
    if (size > previous) {
      this.assetSizeMap.set(assetId, size);
      const delta = size - previous;
      this.progressBytesTotal += delta;
      if (this.progressBytesLoaded > this.progressBytesTotal) {
        this.progressBytesLoaded = this.progressBytesTotal;
      }
    } else if (!this.assetSizeMap.has(assetId)) {
      this.assetSizeMap.set(assetId, size);
    }
  }

  private updateAssetLoadedBytes(assetId: string, loadedBytes: number): void {
    if (!assetId || loadedBytes < 0) {
      return;
    }
    const size = this.assetSizeMap.get(assetId) ?? 0;
    const normalized = size > 0 ? Math.min(loadedBytes, size) : loadedBytes;
    const previous = this.assetLoadedMap.get(assetId) ?? 0;
    if (normalized > previous) {
      this.assetLoadedMap.set(assetId, normalized);
      this.progressBytesLoaded += normalized - previous;
      if (this.progressBytesTotal > 0 && this.progressBytesLoaded > this.progressBytesTotal) {
        this.progressBytesLoaded = this.progressBytesTotal;
      }
    }
  }

  private registerAssetEntryLoad(assetId: string, entry: AssetCacheEntry | null): void {
    if (!assetId || !entry) {
      return;
    }
    const size = this.resolveEntrySize(entry);
    if (size > 0) {
      this.updateAssetSize(assetId, size);
      this.updateAssetLoadedBytes(assetId, size);
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
    const placeholder = new THREE.Object3D();
    placeholder.name = node.name ?? 'Editor Marker';
    this.applyTransform(placeholder, node);
    placeholder.visible = false;
    const helperData: Record<string, unknown> = {
      ...(placeholder.userData ?? {}),
      editorOnly: true,
    };
    if (node.editorFlags?.ignoreGridSnapping) {
      helperData.ignoreGridSnapping = true;
    }
    const viewPointState = node.components?.[VIEW_POINT_COMPONENT_TYPE] as
      | SceneNodeComponentState<ViewPointComponentProps>
      | undefined;
    if (viewPointState?.enabled) {
      helperData.viewPoint = true;
      const props = viewPointState.props as ViewPointComponentProps | undefined;
      helperData.viewPointInitiallyVisible = props?.initiallyVisible === true;
    } else if (node.nodeType === 'Sphere' && node.editorFlags?.ignoreGridSnapping) {
      helperData.viewPoint = true;
    }
    const warpGateState = node.components?.[WARP_GATE_COMPONENT_TYPE] as
      | SceneNodeComponentState<WarpGateComponentProps>
      | undefined;
    if (warpGateState?.enabled) {
      helperData.warpGate = true;
    }
    const effectState = node.components?.[EFFECT_COMPONENT_TYPE] as
      | SceneNodeComponentState<EffectComponentProps>
      | undefined;
    if (effectState?.enabled) {
      const effectProps = clampEffectComponentProps(effectState.props as Partial<EffectComponentProps>);
      const registry = (helperData as Record<string, unknown>)[EFFECT_METADATA_KEY] as
        | Record<string, unknown>
        | undefined;
      const map = registry ?? {};
      map[effectState.id ?? EFFECT_COMPONENT_TYPE] = {
        type: effectProps.effectType,
        props: effectProps,
      };
      (helperData as Record<string, unknown>)[EFFECT_METADATA_KEY] = map;
    }
    placeholder.userData = helperData;

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

    const outlineMesh = this.resolveOutlineMeshForNode(node);

    if (this.buildOptions.lazyLoadMeshes && outlineMesh && node.sourceAssetId) {
      const placeholder = this.buildOutlinePlaceholder(node, outlineMesh);
      if (placeholder) {
        group.add(placeholder);
        this.recordMeshStatistics(placeholder);
      }
    } else if (node.sourceAssetId) {
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

    const outlineMesh = this.resolveOutlineMeshForNode(node);

    if (this.buildOptions.lazyLoadMeshes && outlineMesh && node.sourceAssetId) {
      const placeholder = this.buildOutlinePlaceholder(node, outlineMesh);
      if (placeholder) {
        this.applyTransform(placeholder, node);
        this.applyVisibility(placeholder, node);
        this.recordMeshStatistics(placeholder);
        return placeholder;
      }
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

  private resolveOutlineMeshForNode(node: SceneNodeWithExtras): SceneOutlineMesh | null {
    const assetId = node.sourceAssetId;
    if (assetId && this.outlineMeshMap[assetId]) {
      return this.outlineMeshMap[assetId];
    }
    const legacyOutline = (node as unknown as { outlineMesh?: SceneOutlineMesh | null }).outlineMesh;
    if (legacyOutline) {
      return legacyOutline;
    }
    return null;
  }

  private buildOutlinePlaceholder(node: SceneNodeWithExtras, outline: SceneOutlineMesh): THREE.Object3D | null {
    if (!outline) {
      return null;
    }
    if (!Array.isArray(outline.positions) || outline.positions.length < 9) {
      return null;
    }

    const geometry = new THREE.BufferGeometry();
    const positionArray = new Float32Array(outline.positions);
    geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));

    if (Array.isArray(outline.indices) && outline.indices.length > 0) {
      const indexArray = outline.indices.length > 65535
        ? new Uint32Array(outline.indices)
        : new Uint16Array(outline.indices);
      geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
    }

    geometry.computeVertexNormals();
    if (outline.boundingSphere && outline.boundingSphere.center) {
      const { center, radius } = outline.boundingSphere;
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(center.x, center.y, center.z),
        radius,
      );
    } else {
      geometry.computeBoundingSphere();
    }

    const color = outline.color && outline.color.trim().length ? outline.color : '#808080';
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = node.name ?? 'OutlinePlaceholder';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData = {
      ...mesh.userData,
      lazyAsset: {
        placeholder: true,
        assetId: node.sourceAssetId ?? null,
        objectPath: node.importMetadata?.objectPath ?? null,
        boundingSphere: outline.boundingSphere ?? null,
        vertexCount: outline.vertexCount ?? positionArray.length / 3,
        triangleCount: outline.triangleCount ?? (outline.indices?.length ?? 0) / 3,
        ownerNodeId: node.id ?? null,
      },
    };
    return mesh;
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
    const guideboardState = node.components?.[GUIDEBOARD_COMPONENT_TYPE] as
      | SceneNodeComponentState<GuideboardComponentProps>
      | undefined;
    if (guideboardState?.enabled) {
      metadata.isGuideboard = true;
      const props = guideboardState.props as GuideboardComponentProps | undefined;
      metadata.guideboardInitiallyVisible = props?.initiallyVisible === true;
    }
    const viewPointState = node.components?.[VIEW_POINT_COMPONENT_TYPE] as
      | SceneNodeComponentState<ViewPointComponentProps>
      | undefined;
    if (viewPointState?.enabled) {
      metadata.viewPoint = true;
      const viewPointProps = viewPointState.props as ViewPointComponentProps | undefined;
      metadata.viewPointInitiallyVisible = viewPointProps?.initiallyVisible === true;
    }
    const warpGateState = node.components?.[WARP_GATE_COMPONENT_TYPE] as
      | SceneNodeComponentState<WarpGateComponentProps>
      | undefined;
    if (warpGateState?.enabled) {
      metadata.warpGate = true;
    }
    const effectState = node.components?.[EFFECT_COMPONENT_TYPE] as
      | SceneNodeComponentState<EffectComponentProps>
      | undefined;
    if (effectState?.enabled) {
      const effectProps = clampEffectComponentProps(effectState.props as Partial<EffectComponentProps>);
      const existing = metadata[EFFECT_METADATA_KEY] as Record<string, unknown> | undefined;
      const map = existing ?? {};
      map[effectState.id ?? EFFECT_COMPONENT_TYPE] = {
        type: effectProps.effectType,
        props: effectProps,
      };
      metadata[EFFECT_METADATA_KEY] = map;
    }
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

    this.registerAssetEntryLoad(assetId, entry);

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

  private async buildGroundMesh(meshInfo: GroundDynamicMesh, node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const geometry = this.createGroundGeometry(meshInfo);
    const materials = await this.resolveNodeMaterials(node);
    const materialAssignment = materials.length > 1 ? materials : materials[0];
    const mesh = new THREE.Mesh(geometry, materialAssignment);
    mesh.name = node.name ?? 'Ground';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData = {
      ...(mesh.userData ?? {}),
      dynamicMeshType: 'Ground',
    };
    this.applyGroundTexture(mesh, meshInfo);
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

    const tempStart = new THREE.Vector3();
    const tempEnd = new THREE.Vector3();
    const tempDirection = new THREE.Vector3();
    const tempMidpoint = new THREE.Vector3();
    const X_AXIS = new THREE.Vector3(1, 0, 0);

    const segments = Array.isArray(meshInfo.segments) ? meshInfo.segments : [];
    segments.forEach((segment: any, index: number) => {
      const start = segment.start ?? { x: 0, y: 0, z: 0 };
      const end = segment.end ?? { x: 0, y: 0, z: 0 };
      const height = Number(segment.height) || 2.5;
      const thickness = Number(segment.thickness) || 0.2;

      tempStart.set(start.x ?? 0, start.y ?? 0, start.z ?? 0);
      tempEnd.set(end.x ?? 0, end.y ?? 0, end.z ?? 0);
      tempDirection.subVectors(tempEnd, tempStart);
      const length = tempDirection.length();
      if (length <= 1e-6) {
        return;
      }

      const geometry = new THREE.BoxGeometry(length, height, thickness);
      const wallSegment = new THREE.Mesh(geometry, material);
      wallSegment.castShadow = true;
      wallSegment.receiveShadow = true;
      wallSegment.name = `${container.name}-${index}`;

      tempMidpoint.addVectors(tempStart, tempEnd).multiplyScalar(0.5);
      const baseY = tempMidpoint.y;
      wallSegment.position.set(tempMidpoint.x, baseY + height * 0.5, tempMidpoint.z);

      tempDirection.normalize();
      wallSegment.quaternion.setFromUnitVectors(X_AXIS, tempDirection);

      container.add(wallSegment);
    });

    this.applyTransform(container, node);
    this.applyVisibility(container, node);
    return container;
  }

  private createGroundGeometry(meshInfo: GroundDynamicMesh): THREE.BufferGeometry {
  const columns = Math.max(1, Math.floor(Number(meshInfo.columns)) || 1);
  const rows = Math.max(1, Math.floor(Number(meshInfo.rows)) || 1);
    const vertexColumns = columns + 1;
    const vertexRows = rows + 1;
    const vertexCount = vertexColumns * vertexRows;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(columns * rows * 6);

    const rawCellSize = Number(meshInfo.cellSize);
    const cellSize = Number.isFinite(rawCellSize) && rawCellSize > 0
      ? rawCellSize
      : (() => {
        const rawWidth = Number(meshInfo.width);
        if (Number.isFinite(rawWidth) && rawWidth > 0 && columns > 0) {
          return rawWidth / columns;
        }
        const rawDepth = Number(meshInfo.depth);
        if (Number.isFinite(rawDepth) && rawDepth > 0 && rows > 0) {
          return rawDepth / rows;
        }
        return 1;
      })();
    const width = (() => {
      const rawWidth = Number(meshInfo.width);
      if (Number.isFinite(rawWidth) && rawWidth > 0) {
        return rawWidth;
      }
      return columns * cellSize;
    })();
    const depth = (() => {
      const rawDepth = Number(meshInfo.depth);
      if (Number.isFinite(rawDepth) && rawDepth > 0) {
        return rawDepth;
      }
      return rows * cellSize;
    })();
    const halfWidth = width * 0.5;
    const halfDepth = depth * 0.5;

    let vertexIndex = 0;
    for (let row = 0; row <= rows; row += 1) {
      const z = -halfDepth + row * cellSize;
      for (let column = 0; column <= columns; column += 1) {
        const x = -halfWidth + column * cellSize;
        const height = this.resolveGroundHeight(meshInfo, row, column);

        positions[vertexIndex * 3 + 0] = x;
        positions[vertexIndex * 3 + 1] = height;
        positions[vertexIndex * 3 + 2] = z;

        normals[vertexIndex * 3 + 0] = 0;
        normals[vertexIndex * 3 + 1] = 1;
        normals[vertexIndex * 3 + 2] = 0;

        uvs[vertexIndex * 2 + 0] = columns === 0 ? 0 : column / columns;
        uvs[vertexIndex * 2 + 1] = rows === 0 ? 0 : 1 - row / rows;

        vertexIndex += 1;
      }
    }

    let indexPointer = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const a = row * vertexColumns + column;
        const b = a + 1;
        const c = (row + 1) * vertexColumns + column;
        const d = c + 1;

        indices[indexPointer + 0] = a;
        indices[indexPointer + 1] = c;
        indices[indexPointer + 2] = b;
        indices[indexPointer + 3] = b;
        indices[indexPointer + 4] = c;
        indices[indexPointer + 5] = d;
        indexPointer += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private resolveGroundHeight(meshInfo: GroundDynamicMesh, row: number, column: number): number {
    const key = this.getGroundHeightKey(row, column);
    const heightMap = meshInfo.heightMap ?? {};
    const value = heightMap[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private getGroundHeightKey(row: number, column: number): string {
    return `${row}:${column}`;
  }

  private applyGroundTexture(mesh: THREE.Mesh, meshInfo: GroundDynamicMesh): void {
  const userData = (mesh.userData ?? (mesh.userData = {})) as Record<string, any>;
    const previousTexture = userData.groundTexture as THREE.Texture | undefined;
    if (previousTexture) {
      previousTexture.dispose?.();
      delete userData.groundTexture;
    }

    if (!meshInfo.textureDataUrl) {
      this.assignGroundTexture(mesh, null);
      return;
    }

    try {
      const texture = this.groundTextureLoader.load(
        meshInfo.textureDataUrl,
        () => {
          this.assignGroundTexture(mesh, texture);
        },
        undefined,
        (error: unknown) => {
          console.warn('Ground texture load failed', error);
          this.assignGroundTexture(mesh, null);
        },
      );
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(16, texture.anisotropy || 8);
      texture.name = meshInfo.textureName ?? 'GroundTexture';
      this.assignGroundTexture(mesh, texture);
      userData.groundTexture = texture;
    } catch (error) {
      console.warn('Ground texture load error', error);
      this.assignGroundTexture(mesh, null);
    }
  }

  private assignGroundTexture(mesh: THREE.Mesh, texture: THREE.Texture | null): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material: THREE.Material | null | undefined) => {
      if (!material) {
        return;
      }
      const typed = material as THREE.Material & { map?: THREE.Texture | null };
      if ('map' in typed) {
        typed.map = texture;
      }
      typed.needsUpdate = true;
    });
  }

  private recordMeshStatistics(object: THREE.Object3D): void {
    void object;
  }
}

export async function buildSceneGraph(
  document: SceneJsonExportDocument,
  resourceCache: ResourceCache,
  options: SceneGraphBuildOptions = {},
): Promise<SceneGraphBuildResult> {
  const builder = new SceneGraphBuilder(document, options, resourceCache);
  try {
    const root = await builder.build();
    return { root, warnings: builder.getWarnings() };
  } finally {
    builder.dispose();
  }
}
