import * as THREE from 'three';
import Loader, { type LoaderLoadedPayload } from '@schema/loader';
import type { AssetCacheEntry } from './assetCache';
import { SceneMaterialFactory, textureSettingsSignature } from './material';
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
  SceneMaterialTextureSettings,
  SceneOutlineMesh,
  SceneOutlineMeshMap,
} from '@harmony/schema';
import type { GuideboardComponentProps } from './components/definitions/guideboardComponent';
import { GUIDEBOARD_COMPONENT_TYPE } from './components/definitions/guideboardComponent';
import type { ViewPointComponentProps } from './components/definitions/viewPointComponent';
import { VIEW_POINT_COMPONENT_TYPE } from './components/definitions/viewPointComponent';
import type { WarpGateComponentProps } from './components/definitions/warpGateComponent';
import { WARP_GATE_COMPONENT_TYPE } from './components/definitions/warpGateComponent';

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
}

export interface SceneGraphBuildOptions {
  enableGround?: boolean;
  presetAssetBaseUrl?: string;
  resolveAssetUrl?: (assetId: string) => string | Promise<string | null> | null | undefined;
  assetOverrides?: Record<string, string | ArrayBuffer>;
  onProgress?: (progress: SceneGraphResourceProgress) => void;
  lazyLoadMeshes?: boolean;
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
  private readonly buildOptions: SceneGraphBuildOptions;
  private progressTotal = 0;
  private progressLoaded = 0;
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

  private reportAssetDownloadProgress(assetId: string, progress: number): void {
    if (!this.onProgress) {
      return;
    }
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
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
    });
  }

  private async preloadAssets(
    materials: SceneMaterial[],
    nodes: SceneNodeWithExtras[],
  ): Promise<void> {
    const textureRequests = this.collectTexturePreloadRequests(materials, nodes);
    const meshAssetIds = this.buildOptions.lazyLoadMeshes ? [] : this.collectMeshAssetIds(nodes);
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
