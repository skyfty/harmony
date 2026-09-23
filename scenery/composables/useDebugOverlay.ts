import { ref, reactive, computed } from 'vue';
import * as THREE from 'three';

export interface InstancedMeshLike {
  count: number;
}

export interface TerrainScatterStatsProvider {
  getInstanceStats(): { total: number; visible: number };
}

export interface AssetCacheBytesProvider {
  getInMemoryBytes(): number;
}

export interface CanvasInfo {
  width: number;
  height: number;
  clientWidth?: number;
  clientHeight?: number;
}

/** Scene-relative memory estimate. Mini programs expose no heap API, so this is the only
 * "current usage" figure the overlay can show there. Values are megabytes. */
export interface SceneMemoryEstimate {
  texturesMb: number;
  geometriesMb: number;
  cacheMb: number;
  totalMb: number;
}

// `performance.memory` is a non-standard Chrome/Edge extension, so it is not part of the
// DOM typings.
type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

// Structural views over three.js objects (their typings are deliberately loose).
type AttributeLike = {
  array?: { byteLength?: number } | null;
  count?: number;
  itemSize?: number;
};

type TextureLike = {
  isTexture?: boolean;
  generateMipmaps?: boolean;
  mipmaps?: Array<{ data?: { byteLength?: number } | null } | null>;
  image?: {
    width?: number;
    height?: number;
    data?: { byteLength?: number } | null;
  } | null;
};

const BYTES_PER_MEBIBYTE = 1048576;
// Rough cost of the mip chain for a full pyramid (1 + 1/4 + 1/16 + ... = 4/3).
const MIPMAP_CHAIN_FACTOR = 4 / 3;

function toMegabytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 0;
  }
  return Math.round((bytes / BYTES_PER_MEBIBYTE) * 10) / 10;
}

function resolveAttributeBytes(attribute: AttributeLike | null | undefined): number {
  if (!attribute) {
    return 0;
  }
  const byteLength = attribute.array?.byteLength ?? 0;
  if (Number.isFinite(byteLength) && byteLength > 0) {
    return byteLength;
  }
  // Interleaved attributes have no backing array of their own; fall back to count * itemSize.
  const count = attribute.count ?? 0;
  const itemSize = attribute.itemSize ?? 0;
  if (Number.isFinite(count) && count > 0 && Number.isFinite(itemSize) && itemSize > 0) {
    return Math.round(count * itemSize * 4);
  }
  return 0;
}

function resolveGeometryBytes(geometry: THREE.BufferGeometry): number {
  let total = 0;
  const attributes = geometry.attributes as unknown as Record<string, AttributeLike | undefined>;
  Object.keys(attributes).forEach((name) => {
    total += resolveAttributeBytes(attributes[name]);
  });
  total += resolveAttributeBytes(geometry.getIndex() as unknown as AttributeLike | null);
  const morphAttributes = geometry.morphAttributes as unknown as Record<string, AttributeLike[] | undefined>;
  Object.keys(morphAttributes).forEach((name) => {
    (morphAttributes[name] ?? []).forEach((attribute) => {
      total += resolveAttributeBytes(attribute);
    });
  });
  return total;
}

function resolveTextureBytes(texture: THREE.Texture): number {
  const like = texture as unknown as TextureLike;
  let mipmapBytes = 0;
  const mipmaps = Array.isArray(like.mipmaps) ? like.mipmaps : [];
  mipmaps.forEach((mip) => {
    const byteLength = mip?.data?.byteLength ?? 0;
    if (Number.isFinite(byteLength) && byteLength > 0) {
      mipmapBytes += byteLength;
    }
  });
  // Compressed (e.g. KTX2) textures carry their uploaded payload in the mip chain.
  if (mipmapBytes > 0) {
    return mipmapBytes;
  }
  const image = like.image ?? null;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    const mipFactor = like.generateMipmaps === false ? 1 : MIPMAP_CHAIN_FACTOR;
    return Math.round(width * height * 4 * mipFactor);
  }
  const dataBytes = image?.data?.byteLength ?? 0;
  return Number.isFinite(dataBytes) && dataBytes > 0 ? dataBytes : 0;
}

function collectMaterialTextures(material: unknown, target: Set<THREE.Texture>): void {
  if (!material || typeof material !== 'object') {
    return;
  }
  const record = material as Record<string, unknown>;
  Object.keys(record).forEach((key) => {
    const value = record[key] as TextureLike | null;
    if (value?.isTexture) {
      target.add(value as unknown as THREE.Texture);
    }
  });
  const uniforms = (material as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
  if (!uniforms) {
    return;
  }
  Object.keys(uniforms).forEach((key) => {
    const value = uniforms[key]?.value as TextureLike | null;
    if (value?.isTexture) {
      target.add(value as unknown as THREE.Texture);
    }
  });
}

export function useDebugOverlay() {
  const debugEnabled = ref(true);
  const debugMode = ref<'off' | 'fps' | 'full'>('fps');
  const debugOverlayVisible = computed(() => debugEnabled.value);
  const debugFps = ref(0);
  const debugFrameMs = ref(0);

  // JS heap is only observable on Chromium-based H5 builds (Chrome/Edge). WeChat's
  // `performance` is an adapter stub exposing `now()` only, so the flag stays false there.
  const memoryDebug = reactive({
    heapSupported: false,
    heapUsedMb: 0,
    heapLimitMb: 0,
  });

  // App-side footprint estimate (decoded textures + geometry buffers + asset cache).
  // Unlike `memoryDebug`, this is computable on every platform, including mini programs.
  const sceneMemoryDebug = reactive<SceneMemoryEstimate>({
    texturesMb: 0,
    geometriesMb: 0,
    cacheMb: 0,
    totalMb: 0,
  });

  const instancingDebug = reactive({
    instancedMeshAssets: 0,
    instancedMeshActive: 0,
    instancedInstanceCount: 0,
    instanceMatrixUploadKb: 0,
    lodTotal: 0,
    lodVisible: 0,
    scatterTotal: 0,
    scatterVisible: 0,
  });

  const rendererDebug = reactive({
    calls: 0,
    triangles: 0,
    renderTriangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    width: 0,
    height: 0,
    pixelRatio: 1,
  });


  let debugFpsFrames = 0;
  let debugFpsAccumSeconds = 0;
  let debugFpsLastSyncAt = 0;
  let debugInstancingLastSyncAt = 0;
  let debugMemoryLastSyncAt = 0;

  function syncJsHeapDebug(): void {
    const heap = typeof performance === 'undefined'
      ? null
      : (performance as PerformanceWithMemory).memory ?? null;
    if (!heap) {
      memoryDebug.heapSupported = false;
      memoryDebug.heapUsedMb = 0;
      memoryDebug.heapLimitMb = 0;
      return;
    }
    const used = Number.isFinite(heap.usedJSHeapSize) ? heap.usedJSHeapSize : 0;
    const limit = Number.isFinite(heap.jsHeapSizeLimit) ? heap.jsHeapSizeLimit : 0;
    if (limit <= 0) {
      memoryDebug.heapSupported = false;
      memoryDebug.heapUsedMb = 0;
      memoryDebug.heapLimitMb = 0;
      return;
    }
    memoryDebug.heapSupported = true;
    memoryDebug.heapUsedMb = Math.max(0, Math.round((used / 1048576) * 10) / 10);
    memoryDebug.heapLimitMb = Math.max(0, Math.round((limit / 1048576) * 10) / 10);
  }

  function updateDebugFps(deltaSeconds: number): void {
    if (!debugEnabled.value) {
      return;
    }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }
    debugFpsFrames += 1;
    debugFpsAccumSeconds += deltaSeconds;
    const now = Date.now();
    if (now - debugFpsLastSyncAt < 500) {
      return;
    }
    debugFpsLastSyncAt = now;
    const fps = debugFpsFrames / Math.max(1e-6, debugFpsAccumSeconds);
    debugFps.value = Math.max(0, Math.round(fps));
    // Average frame interval over the same window, so `ms ≈ 1000 / fps`.
    const frameMs = (debugFpsAccumSeconds * 1000) / Math.max(1, debugFpsFrames);
    debugFrameMs.value = Math.max(0, Math.round(frameMs * 10) / 10);
    syncJsHeapDebug();
    debugFpsFrames = 0;
    debugFpsAccumSeconds = 0;
  }

  function syncInstancingDebugCounters(
    lodTotal: number,
    lodVisible: number,
    instancedMeshes: InstancedMeshLike[],
    terrainScatterRuntime: TerrainScatterStatsProvider,
  ): void {
    if (!debugEnabled.value) {
      return;
    }
    const now = Date.now();
    if (now - debugInstancingLastSyncAt < 250) {
      return;
    }
    debugInstancingLastSyncAt = now;
    instancingDebug.instancedMeshAssets = instancedMeshes.length;

    let activeMeshes = 0;
    let instanceCountSum = 0;
    instancedMeshes.forEach((mesh) => {
      const count = Number.isFinite(mesh.count) ? mesh.count : 0;
      if (count > 0) {
        activeMeshes += 1;
        instanceCountSum += count;
      }
    });
    instancingDebug.instancedMeshActive = activeMeshes;
    instancingDebug.instancedInstanceCount = instanceCountSum;
    const instanceMatrixBytesPerMesh = 2048 * 16 * 4;
    instancingDebug.instanceMatrixUploadKb = Math.round((activeMeshes * instanceMatrixBytesPerMesh) / 1024);

    instancingDebug.lodTotal = lodTotal;
    instancingDebug.lodVisible = lodVisible;
    const scatterStats = terrainScatterRuntime.getInstanceStats();
    instancingDebug.scatterTotal = scatterStats.total;
    instancingDebug.scatterVisible = scatterStats.visible;
  }

  function shouldIgnoreDebugTriangleObject(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      const currentName = typeof current.name === 'string' ? current.name : '';
      if (
        currentName === 'GroundChunkDebugHelpers'
        || currentName === 'RigidbodyDebugHelpers'
        || currentName === 'AirWallDebug'
        || currentName.startsWith('GroundChunkDebug')
        || currentName.startsWith('AirWallDebug')
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function resolveGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
    const positionAttribute = geometry.getAttribute('position');
    const positionCount = positionAttribute?.count ?? 0;
    if (positionCount <= 0) {
      return 0;
    }
    const availableElementCount = geometry.index?.count ?? positionCount;
    const drawRangeStart = Number.isFinite(geometry.drawRange.start)
      ? Math.max(0, Math.trunc(geometry.drawRange.start))
      : 0;
    const remainingElementCount = Math.max(0, availableElementCount - drawRangeStart);
    const drawRangeCount = Number.isFinite(geometry.drawRange.count)
      ? Math.max(0, Math.trunc(geometry.drawRange.count))
      : remainingElementCount;
    return Math.floor(Math.min(remainingElementCount, drawRangeCount) / 3);
  }

  function estimateSceneTriangleCount(root: THREE.Object3D): number {
    let total = 0;
    root.traverseVisible((object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh) || shouldIgnoreDebugTriangleObject(object)) {
        return;
      }
      const triangleCount = resolveGeometryTriangleCount(object.geometry);
      if (triangleCount <= 0) {
        return;
      }
      if (object instanceof THREE.InstancedMesh) {
        total += triangleCount * Math.max(0, Math.trunc(object.count));
        return;
      }
      total += triangleCount;
    });
    return total;
  }

  function syncRendererDebug(renderer: THREE.WebGLRenderer, scene: THREE.Scene, canvas: CanvasInfo | null): void {
    if (!debugEnabled.value) {
      return;
    }
    const info = renderer.info;
    rendererDebug.calls = info?.render?.calls ?? 0;
    rendererDebug.renderTriangles = info?.render?.triangles ?? 0;
    const sceneTriangles = estimateSceneTriangleCount(scene);
    rendererDebug.triangles = sceneTriangles > 0 ? sceneTriangles : rendererDebug.renderTriangles;
    rendererDebug.geometries = info?.memory?.geometries ?? 0;
    rendererDebug.textures = info?.memory?.textures ?? 0;
    rendererDebug.programs = info?.programs?.length ?? 0;
    rendererDebug.pixelRatio = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
    rendererDebug.width = (canvas?.width || canvas?.clientWidth || 0) as number;
    rendererDebug.height = (canvas?.height || canvas?.clientHeight || 0) as number;
  }

  /**
   * Walk the scene once (textures and geometries are deduplicated by reference) so the
   * overlay can report an app-side footprint on platforms without a heap API.
   */
  function estimateSceneMemory(root: THREE.Object3D, assetCacheBytes: number): SceneMemoryEstimate {
    const geometries = new Set<THREE.BufferGeometry>();
    const textures = new Set<THREE.Texture>();
    root.traverse((object: THREE.Object3D) => {
      if (shouldIgnoreDebugTriangleObject(object) || !(object instanceof THREE.Mesh)) {
        return;
      }
      geometries.add(object.geometry);
      const material = object.material;
      if (Array.isArray(material)) {
        material.forEach((item) => {
          collectMaterialTextures(item, textures);
        });
        return;
      }
      collectMaterialTextures(material, textures);
    });

    let geometryBytes = 0;
    geometries.forEach((geometry) => {
      geometryBytes += resolveGeometryBytes(geometry);
    });
    let textureBytes = 0;
    textures.forEach((texture) => {
      textureBytes += resolveTextureBytes(texture);
    });

    const texturesMb = toMegabytes(textureBytes);
    const geometriesMb = toMegabytes(geometryBytes);
    const cacheMb = toMegabytes(assetCacheBytes);
    return {
      texturesMb,
      geometriesMb,
      cacheMb,
      totalMb: Math.round((texturesMb + geometriesMb + cacheMb) * 10) / 10,
    };
  }

  function syncSceneMemoryDebug(root: THREE.Object3D, assetCache: AssetCacheBytesProvider | null): void {
    if (!debugEnabled.value) {
      return;
    }
    const now = Date.now();
    if (now - debugMemoryLastSyncAt < 500) {
      return;
    }
    debugMemoryLastSyncAt = now;
    const cacheBytes = typeof assetCache?.getInMemoryBytes === 'function'
      ? assetCache.getInMemoryBytes()
      : 0;
    const estimate = estimateSceneMemory(root, cacheBytes);
    sceneMemoryDebug.texturesMb = estimate.texturesMb;
    sceneMemoryDebug.geometriesMb = estimate.geometriesMb;
    sceneMemoryDebug.cacheMb = estimate.cacheMb;
    sceneMemoryDebug.totalMb = estimate.totalMb;
  }


  return {
    debugEnabled,
    debugMode,
    debugOverlayVisible,
    debugFps,
    debugFrameMs,
    memoryDebug,
    sceneMemoryDebug,
    instancingDebug,
    rendererDebug,
    updateDebugFps,
    syncInstancingDebugCounters,
    syncRendererDebug,
    syncSceneMemoryDebug,
    estimateSceneTriangleCount,
  };
}
