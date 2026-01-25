import * as THREE from 'three';
import type { AssetCacheEntry } from './assetCache';
import { SceneMaterialFactory, MATERIAL_TEXTURE_SLOTS } from './material';
import type { SceneMaterialFactoryOptions } from './material';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import ResourceCache from './ResourceCache';
import type {
  SceneJsonExportDocument,
  SceneMaterial,
  SceneNode,
  SceneNodeComponentState,
  
  SceneNodeMaterial,
  SceneOutlineMesh,
  SceneOutlineMeshMap,
  GroundDynamicMesh,
  WallDynamicMesh,
  RoadDynamicMesh,
  FloorDynamicMesh,
  GuideRouteDynamicMesh,
  SceneResourceSummaryEntry,
  SceneMaterialTextureSlot,
} from '@harmony/schema';
import {
  createPrimitiveGeometry,
} from '@harmony/schema';
import { clampSceneNodeInstanceLayout, resolveInstanceLayoutTemplateAssetId } from '@harmony/schema'
import type { GuideboardComponentProps } from './components/definitions/guideboardComponent';
import { GUIDEBOARD_COMPONENT_TYPE } from './components/definitions/guideboardComponent';
import type { ViewPointComponentProps } from './components/definitions/viewPointComponent';
import { VIEW_POINT_COMPONENT_TYPE } from './components/definitions/viewPointComponent';
import type { WarpGateComponentProps } from './components/definitions/warpGateComponent';
import {
  WARP_GATE_COMPONENT_TYPE,
  WARP_GATE_EFFECT_METADATA_KEY,
  clampWarpGateComponentProps,
  cloneWarpGateComponentProps,
} from './components/definitions/warpGateComponent';
// NOTE: Water rendering is handled via runtime components; SceneGraph just ensures materials are applied.
import { createFileFromEntry } from './modelAssetLoader'
import { loadObjectFromFile } from './assetImport'
import type { WallComponentProps } from './components/definitions/wallComponent'
import { WALL_COMPONENT_TYPE, clampWallProps } from './components/definitions/wallComponent'
import type { RoadComponentProps } from './components/definitions/roadComponent'
import { ROAD_COMPONENT_TYPE, clampRoadProps } from './components/definitions/roadComponent'

import { getOrLoadModelObject } from './modelObjectCache'
import { loadNodeObject } from './modelAssetLoader'

import type { SceneNodeWithExtras } from './sceneGraph/types';
import { applyNodeMetadata as applyNodeMetadataToObject } from './sceneGraph/nodeMetadata';
import { applyMaterialConfigAssignment, buildMaterialConfigMap } from './sceneGraph/materialAssignment';
import { buildGroundMesh as buildGroundDynamicMesh } from './sceneGraph/dynamicMeshes/ground';
import { buildWallMesh as buildWallDynamicMesh } from './sceneGraph/dynamicMeshes/wall';
import { buildRoadMesh as buildRoadDynamicMesh } from './sceneGraph/dynamicMeshes/road';
import { buildFloorMesh as buildFloorDynamicMesh } from './sceneGraph/dynamicMeshes/floor';
import { buildGuideRouteMesh as buildGuideRouteDynamicMesh } from './sceneGraph/dynamicMeshes/guideRoute';

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
  assetOverrides?: Record<
    string,
    string | ArrayBuffer | { bytes: ArrayBuffer | Uint8Array; mimeType?: string | null; filename?: string | null }
  >;
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
  private readonly meshTemplateCache = new Map<string, MeshTemplate>();
  private readonly pendingMeshLoads = new Map<string, Promise<MeshTemplate | null>>();
  private readonly document: SceneJsonExportDocument;
  private readonly outlineMeshMap: SceneOutlineMeshMap;
  private readonly onProgress?: (progress: SceneGraphResourceProgress) => void;
  private readonly lazyLoadMeshes: boolean;
  private progressTotal = 0;
  private progressLoaded = 0;
  private readonly assetSizeMap = new Map<string, number>();
  private readonly assetLoadedMap = new Map<string, number>();
  private readonly expectedDownloadAssetIds = new Set<string>();
  private readonly preloadedAssetIds = new Set<string>();
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
    const documentLazyLoad = document.lazyLoadMeshes;
    if (typeof options.lazyLoadMeshes === 'boolean') {
      this.lazyLoadMeshes = options.lazyLoadMeshes;
    } else if (typeof documentLazyLoad === 'boolean') {
      this.lazyLoadMeshes = documentLazyLoad;
    } else {
      this.lazyLoadMeshes = true;
    }
    this.outlineMeshMap = { ...(document.outlineMeshMap ?? {}) };
    this.resourceCache.setContext(document, options);
    this.resourceCache.setHandlers({
      warn: (message) => this.warn(message),
      reportDownloadProgress: (payload) => this.reportAssetDownloadProgress(payload.assetId, payload.progress),
    });
    const materialFactoryOverrides = options.materialFactoryOptions ?? {};
    this.materialFactory = new SceneMaterialFactory({
      provider: this.resourceCache,
      resources: document.resourceSummary?.assets ?? [],
      loadingManager: this.loadingManager,
      warn: (message) => this.warn(message),
      textureLoader: materialFactoryOverrides.textureLoader,
      hdrLoader: materialFactoryOverrides.hdrLoader,
    });
    this.onProgress = options.onProgress;

    const materials = Array.isArray(document.materials) ? (document.materials as SceneMaterial[]) : [];
    const nodes = Array.isArray(document.nodes) ? (document.nodes as SceneNodeWithExtras[]) : [];
    this.computeExpectedDownloadAssetIds(nodes, materials);

    const summary = document.resourceSummary;
    if (summary && Array.isArray(summary.assets)) {
      let aggregatedTotal = 0;

      summary.assets.forEach((entry) => {
        if (!entry || typeof entry.assetId !== 'string' || !entry.assetId.length) {
          return;
        }

        const assetId = entry.assetId.trim();
        if (!assetId) {
          return;
        }

        if (this.isSummaryAssetPreloaded(entry)) {
          this.preloadedAssetIds.add(assetId);
        }

        // Only count assets expected to be requested during build.
        if (!this.expectedDownloadAssetIds.has(assetId)) {
          return;
        }

        const size = Number.isFinite(entry.bytes) && entry.bytes > 0 ? entry.bytes : 0;
        if (size > 0) {
          this.assetSizeMap.set(assetId, size);
        }

        // Only network/downloaded assets should contribute to total bytes.
        if (!this.preloadedAssetIds.has(assetId)) {
          aggregatedTotal += size;
        }
      });

      this.progressBytesTotal = aggregatedTotal;
      this.progressBytesLoaded = 0;
    }
  }

  private computeExpectedDownloadAssetIds(nodes: SceneNodeWithExtras[], materials: SceneMaterial[]): void {
    this.expectedDownloadAssetIds.clear();

    const textureAssetIds = this.collectTextureAssetIds(nodes, materials);
    textureAssetIds.forEach((id) => this.expectedDownloadAssetIds.add(id));

    // Preload meshes (depends on lazyLoadMeshes and document.assetPreload).
    const preloadMeshAssetIds = this.getMeshPreloadIds(nodes);
    preloadMeshAssetIds.forEach((id) => this.expectedDownloadAssetIds.add(id));

    // Meshes that will be loaded during build even when lazy-load placeholders exist.
    const buildMeshAssetIds = this.collectBuildTimeMeshAssetIds(nodes);
    buildMeshAssetIds.forEach((id) => this.expectedDownloadAssetIds.add(id));
  }

  private collectBuildTimeMeshAssetIds(nodes: SceneNodeWithExtras[]): string[] {
    const ids = new Set<string>();
    const stack: SceneNodeWithExtras[] = Array.isArray(nodes) ? [...nodes] : [];

    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }

      const explicitType = typeof node.nodeType === 'string' ? node.nodeType : '';
      const normalizedType = explicitType.toLowerCase();

      // Nodes that never load meshes on themselves.
      if (normalizedType === 'light' || normalizedType === 'camera') {
        // Still traverse children.
      } else if (normalizedType === 'warpgate' || this.hasEnabledWarpGateComponent(node)) {
        // Still traverse children.
      } else if (normalizedType === 'guideboard' || this.hasEnabledGuideboardComponent(node)) {
        // Still traverse children.
      } else if (normalizedType === 'group') {
        const assetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : '';
        if (assetId) {
          const outline = this.resolveOutlineMeshForNode(node);
          const shouldLazySkip = this.lazyLoadMeshes && outline && assetId;
          if (!shouldLazySkip) {
            ids.add(assetId);
          }
        }
      } else if (normalizedType === 'mesh') {
        const meshInfo = node.dynamicMesh;

        if (meshInfo?.type === 'Wall') {
          const wallState = node.components?.[WALL_COMPONENT_TYPE] as
            | SceneNodeComponentState<WallComponentProps>
            | undefined;
          // Mirrors buildWallMesh: clamp props regardless, ids only when present.
          const props = clampWallProps(wallState?.props as Partial<WallComponentProps> | null | undefined);
          if (props.bodyAssetId) {
            ids.add(props.bodyAssetId);
          }
          if (props.jointAssetId) {
            ids.add(props.jointAssetId);
          }
        } else if (meshInfo?.type === 'Road') {
          const roadState = node.components?.[ROAD_COMPONENT_TYPE] as
            | SceneNodeComponentState<RoadComponentProps>
            | undefined;
          const props = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined);
          if (props.bodyAssetId) {
            ids.add(props.bodyAssetId);
          }
        } else if (!meshInfo || !meshInfo.type || meshInfo.type === 'Mesh') {
          const assetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : '';
          if (assetId) {
            const outline = this.resolveOutlineMeshForNode(node);
            const shouldLazySkip = this.lazyLoadMeshes && outline && assetId;
            if (!shouldLazySkip) {
              ids.add(assetId);
            }
          }
        }
      }

      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNodeWithExtras[]));
      }
    }

    return Array.from(ids);
  }

  async build(): Promise<THREE.Group> {
    const materials = Array.isArray(this.document.materials) ? (this.document.materials as SceneMaterial[]) : [];
    const nodes = Array.isArray(this.document.nodes) ? (this.document.nodes as SceneNodeWithExtras[]) : [];
    await this.preloadAssets(nodes, materials);
    await this.preloadInstanceLayoutModels(nodes);
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
    const meshAssetIds = this.getMeshPreloadIds(nodes);
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

  private getMeshPreloadIds(nodes: SceneNodeWithExtras[]): string[] {
    const meshInfo = this.document.assetPreload?.mesh;
    if (this.lazyLoadMeshes) {
      if (Array.isArray(meshInfo?.essential) && meshInfo.essential.length) {
        const essential = this.normalizeAssetIdList(meshInfo.essential);
        const layout = this.collectInstanceLayoutAssetIds(nodes);
        if (!layout.length) {
          return essential;
        }
        return this.normalizeAssetIdList([...essential, ...layout]);
      }
      return this.collectInstanceLayoutAssetIds(nodes);
    }
    if (Array.isArray(meshInfo?.all) && meshInfo.all.length) {
      return this.normalizeAssetIdList(meshInfo.all);
    }
    return this.collectMeshAssetIds(nodes);
  }

  private normalizeAssetIdList(list: string[]): string[] {
    const uniqueIds = new Set<string>();
    for (const entry of list) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed) {
        uniqueIds.add(trimmed);
      }
    }
    return Array.from(uniqueIds);
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
      const wallState = node.components?.[WALL_COMPONENT_TYPE] as
        | SceneNodeComponentState<WallComponentProps>
        | undefined;
      if (wallState?.enabled !== false) {
        const props = clampWallProps(wallState?.props as Partial<WallComponentProps> | null | undefined);
        if (props.bodyAssetId) {
          ids.add(props.bodyAssetId);
        }
        if (props.jointAssetId) {
          ids.add(props.jointAssetId);
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNodeWithExtras[]));
      }
    }
    return Array.from(ids);
  }

  private collectInstanceLayoutAssetIds(nodes: SceneNodeWithExtras[]): string[] {
    const ids = new Set<string>()
    const stack: SceneNodeWithExtras[] = Array.isArray(nodes) ? [...nodes] : []
    while (stack.length) {
      const node = stack.pop()
      if (!node) {
        continue
      }
      // Only preload when we need template bounds for multi-instance layout.
      const rawLayout = (node as unknown as { instanceLayout?: unknown }).instanceLayout
      const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : null
      if (layout?.mode === 'grid') {
        const assetId = resolveInstanceLayoutTemplateAssetId(layout, typeof node.sourceAssetId === 'string' ? node.sourceAssetId : null)
        if (assetId) {
          ids.add(assetId)
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...(node.children as SceneNodeWithExtras[]))
      }
    }
    return Array.from(ids)
  }

  private async preloadInstanceLayoutModels(nodes: SceneNodeWithExtras[]): Promise<void> {
    const assetIds = this.collectInstanceLayoutAssetIds(nodes)
    if (!assetIds.length) {
      return
    }

    await Promise.all(
      assetIds.map(async (assetId) => {
        try {
          await getOrLoadModelObject(assetId, async () => {
            const object = await loadNodeObject(this.resourceCache, assetId, null)
            if (!object) {
              throw new Error('Instance layout preload returned empty object')
            }
            return object
          })
        } catch (error) {
          this.warn(`Failed to preload instance layout model ${assetId}: ${(error as Error)?.message ?? String(error)}`)
        }
      }),
    )
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
    if (entry.blob && typeof entry.blob.size === 'number' && entry.blob.size > 0) {
      return entry.blob.size;
    }
    return 0;
  }

  private updateAssetSize(assetId: string, size: number): void {
    if (!assetId || size <= 0) {
      return;
    }
    if (!this.expectedDownloadAssetIds.has(assetId)) {
      this.expectedDownloadAssetIds.add(assetId);
    }
    const previous = this.assetSizeMap.get(assetId) ?? 0;
    if (size > previous) {
      this.assetSizeMap.set(assetId, size);
      const delta = size - previous;
      if (!this.preloadedAssetIds.has(assetId)) {
        this.progressBytesTotal += delta;
        if (this.progressBytesLoaded > this.progressBytesTotal) {
          this.progressBytesLoaded = this.progressBytesTotal;
        }
      }
    } else if (!this.assetSizeMap.has(assetId)) {
      this.assetSizeMap.set(assetId, size);
    }
  }

  private updateAssetLoadedBytes(assetId: string, loadedBytes: number): void {
    if (!assetId || loadedBytes < 0) {
      return;
    }
    if (this.preloadedAssetIds.has(assetId)) {
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

    // If something is actually requested during build, ensure it's tracked.
    if (!this.expectedDownloadAssetIds.has(assetId)) {
      this.expectedDownloadAssetIds.add(assetId);
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

  private hasEnabledWarpGateComponent(node: SceneNodeWithExtras): boolean {
    const state = node.components?.[WARP_GATE_COMPONENT_TYPE] as
      | SceneNodeComponentState<WarpGateComponentProps>
      | undefined
    return Boolean(state?.enabled)
  }

  private hasEnabledGuideboardComponent(node: SceneNodeWithExtras): boolean {
    const state = node.components?.[GUIDEBOARD_COMPONENT_TYPE] as
      | SceneNodeComponentState<GuideboardComponentProps>
      | undefined
    return Boolean(state?.enabled)
  }

  private async buildSingleNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    if (node.editorFlags?.editorOnly) {
      return this.buildEditorOnlyNode(node);
    }
    const explicitType = typeof node.nodeType === 'string' ? node.nodeType : ''
    const normalizedType = explicitType.toLowerCase()

    if (normalizedType === 'group') {
      return this.buildGroupNode(node)
    }
    if (normalizedType === 'light') {
      return this.buildLightNode(node)
    }
    if (normalizedType === 'warpgate') {
      return this.buildWarpGateNode(node)
    }
    if (normalizedType === 'guideboard') {
      return this.buildGuideboardNode(node)
    }
    if (normalizedType === 'camera') {
      this.warn(`暂不支持相机节点 ${node.name ?? node.id}`)
      return null
    }

    if (this.hasEnabledWarpGateComponent(node)) {
      return this.buildWarpGateNode(node)
    }
    if (this.hasEnabledGuideboardComponent(node)) {
      return this.buildGuideboardNode(node)
    }

    if (normalizedType === 'mesh') {
      return this.buildMeshNode(node)
    }

    return this.buildPrimitiveNode(node)
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
      const props = clampWarpGateComponentProps(warpGateState.props as Partial<WarpGateComponentProps>);
      (helperData as Record<string, unknown>)[WARP_GATE_EFFECT_METADATA_KEY] = cloneWarpGateComponentProps(props);
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

    if (this.lazyLoadMeshes && outlineMesh && node.sourceAssetId) {
      const placeholder = this.buildOutlinePlaceholder(node, outlineMesh);
      if (placeholder) {
        group.add(placeholder);
        this.recordMeshStatistics(placeholder);
      }
    } else if (node.sourceAssetId) {
      const asset = await this.loadAssetMesh(node.sourceAssetId);
      if (asset) {
        await this.applyMaterialOverridesToImportedObject(asset, node);
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

  private async buildWarpGateNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const group = new THREE.Group();
    group.name = node.name ?? 'Warp Gate';
    this.applyTransform(group, node);
    this.applyVisibility(group, node);

    if (Array.isArray(node.children) && node.children.length) {
      await this.buildNodes(node.children as SceneNodeWithExtras[], group);
    }

    return group;
  }

  private async buildGuideboardNode(node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    const group = new THREE.Group();
    group.name = node.name ?? 'Guideboard';
    this.applyTransform(group, node);
    this.applyVisibility(group, node);

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
    if (meshInfo?.type === 'Road') {
      return this.buildRoadMesh(meshInfo as RoadDynamicMesh, node);
    }
    if (meshInfo?.type === 'Floor') {
      return this.buildFloorMesh(meshInfo as FloorDynamicMesh, node);
    }
    if (meshInfo?.type === 'GuideRoute') {
      return this.buildGuideRouteMesh(meshInfo as GuideRouteDynamicMesh, node);
    }

    const outlineMesh = this.resolveOutlineMeshForNode(node);

    if (this.lazyLoadMeshes && outlineMesh && node.sourceAssetId) {
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
        await this.applyMaterialOverridesToImportedObject(asset, node);
        this.applyTransform(asset, node);
        this.applyVisibility(asset, node);
        this.recordMeshStatistics(asset);
        return asset;
      }
      this.warn(`使用源资源失败 ${node.sourceAssetId}`);
    }

    return this.buildPrimitiveNode({ ...node, nodeType: node.nodeType || 'Box' });
  }

  private async applyMaterialOverridesToImportedObject(object: THREE.Object3D, node: SceneNodeWithExtras): Promise<void> {
    if (!object) {
      return;
    }
    const nodeMaterialConfigs = Array.isArray(node.materials) ? (node.materials as SceneNodeMaterial[]) : [];
    if (!nodeMaterialConfigs.length) {
      return;
    }

    const resolvedMaterials = await this.resolveNodeMaterials(node);
    const defaultMaterialAssignment = this.pickMaterialAssignment(resolvedMaterials);
    if (!defaultMaterialAssignment) {
      return;
    }

    const materialByConfigId = buildMaterialConfigMap(nodeMaterialConfigs, resolvedMaterials);
    applyMaterialConfigAssignment(object, {
      defaultMaterial: defaultMaterialAssignment,
      materialByConfigId,
    });
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
      nodeId: node.id ?? null,
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
    applyNodeMetadataToObject(object, node);
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

  private async fetchAndParseMesh(assetId: string): Promise<MeshTemplate | null> {
    const entry = await this.resourceCache.acquireAssetEntry(assetId);
    if (!entry) {
      return null;
    }

    this.registerAssetEntryLoad(assetId, entry);

    const file = createFileFromEntry(assetId, entry);
    if (!file) {
      this.warn(`无法创建文件对象 ${assetId}`);
      return null;
    }

    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const parsed = await loadObjectFromFile(file, ext);
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
    return buildGroundDynamicMesh(
      {
        resolveNodeMaterials: (targetNode) => this.resolveNodeMaterials(targetNode),
        pickMaterialAssignment: (materials) => this.pickMaterialAssignment(materials),
        extractGroundTextureFromMaterial: (material) => this.extractGroundTextureFromMaterial(material),
        assignTextureToMaterial: (material, texture) => this.assignTextureToMaterial(material, texture),
        applyTransform: (object, targetNode) => this.applyTransform(object, targetNode),
        applyVisibility: (object, targetNode) => this.applyVisibility(object, targetNode),
        recordMeshStatistics: (object) => this.recordMeshStatistics(object),
      },
      meshInfo,
      node,
    );
  }

  private async buildWallMesh(meshInfo: WallDynamicMesh, node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    return buildWallDynamicMesh(
      {
        loadAssetMesh: (assetId) => this.loadAssetMesh(assetId),
        resolveNodeMaterials: (targetNode) => this.resolveNodeMaterials(targetNode),
        pickMaterialAssignment: (materials) => this.pickMaterialAssignment(materials),
        applyTransform: (object, targetNode) => this.applyTransform(object, targetNode),
        applyVisibility: (object, targetNode) => this.applyVisibility(object, targetNode),
      },
      meshInfo,
      node,
    );
  }

  private async buildRoadMesh(meshInfo: RoadDynamicMesh, node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    return buildRoadDynamicMesh(
      {
        loadAssetMesh: (assetId) => this.loadAssetMesh(assetId),
        resolveNodeMaterials: (targetNode) => this.resolveNodeMaterials(targetNode),
        pickMaterialAssignment: (materials) => this.pickMaterialAssignment(materials),
        applyTransform: (object, targetNode) => this.applyTransform(object, targetNode),
        applyVisibility: (object, targetNode) => this.applyVisibility(object, targetNode),
        getDocumentNodes: () => Array.isArray(this.document.nodes) ? (this.document.nodes as SceneNodeWithExtras[]) : [],
      },
      meshInfo,
      node,
    );
  }

  private async buildFloorMesh(meshInfo: FloorDynamicMesh, node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    return buildFloorDynamicMesh(
      {
        resolveNodeMaterials: (targetNode) => this.resolveNodeMaterials(targetNode),
        pickMaterialAssignment: (materials) => this.pickMaterialAssignment(materials),
        applyTransform: (object, targetNode) => this.applyTransform(object, targetNode),
        applyVisibility: (object, targetNode) => this.applyVisibility(object, targetNode),
      },
      meshInfo,
      node,
    );
  }

  private async buildGuideRouteMesh(meshInfo: GuideRouteDynamicMesh, node: SceneNodeWithExtras): Promise<THREE.Object3D | null> {
    return buildGuideRouteDynamicMesh(
      {
        resolveNodeMaterials: (targetNode) => this.resolveNodeMaterials(targetNode),
        pickMaterialAssignment: (materials) => this.pickMaterialAssignment(materials),
        applyTransform: (object, targetNode) => this.applyTransform(object, targetNode),
        applyVisibility: (object, targetNode) => this.applyVisibility(object, targetNode),
      },
      meshInfo,
      node,
    );
  }

  private pickMaterialAssignment(materials: THREE.Material[]): THREE.Material | THREE.Material[] | null {
    if (!Array.isArray(materials) || materials.length === 0) {
      return null;
    }
    return materials.length > 1 ? materials : materials[0]!;
  }

  private assignTextureToMaterial(
    material: THREE.Material | THREE.Material[] | null,
    texture: THREE.Texture | null,
  ): void {
    if (!material) {
      return;
    }
    const targets = Array.isArray(material) ? material : [material];
    targets.forEach((entry) => {
      if (!entry) {
        return;
      }
      const typed = entry as THREE.Material & { map?: THREE.Texture | null };
      if ('map' in typed) {
        typed.map = texture;
      }
      typed.needsUpdate = true;
    });
  }

  private extractGroundTextureFromMaterial(
    material: THREE.Material | THREE.Material[] | null,
  ): THREE.Texture | null {
    if (!material || Array.isArray(material)) {
      return null;
    }
    const typed = material as THREE.MeshStandardMaterial & { map?: THREE.Texture | null };
    const candidate = typed.map ?? null;
    if (!candidate) {
      return null;
    }
    const userData = candidate.userData as { groundDynamic?: boolean } | undefined;
    return userData?.groundDynamic ? candidate : null;
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

export { createTerrainScatterLodRuntime } from './terrainScatterLodRuntime'
export type { TerrainScatterLodRuntime } from './terrainScatterLodRuntime'