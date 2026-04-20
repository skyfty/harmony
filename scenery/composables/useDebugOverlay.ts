import { ref, reactive, computed } from 'vue';
import * as THREE from 'three';
import { resolveGroundRuntimeChunkCells, resolveGroundChunkRadiusMeters } from '@harmony/schema/groundMesh';
import type { GroundDynamicMesh } from '@harmony/schema/index';

export interface InstancedMeshLike {
  count: number;
}

export interface TerrainScatterStatsProvider {
  getInstanceStats(): { total: number; visible: number };
}

export interface CanvasInfo {
  width: number;
  height: number;
  clientWidth?: number;
  clientHeight?: number;
}

export function useDebugOverlay() {
  const debugEnabled = ref(true);
  const debugMode = ref<'off' | 'fps' | 'full'>('fps');
  const debugOverlayVisible = computed(() => debugEnabled.value);
  const debugFps = ref(0);

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
    width: 0,
    height: 0,
    pixelRatio: 1,
  });

  const groundChunkDebug = reactive({
    loaded: 0,
    target: 0,
    total: 0,
    pending: 0,
    unloaded: 0,
  });

  let debugFpsFrames = 0;
  let debugFpsAccumSeconds = 0;
  let debugFpsLastSyncAt = 0;
  let debugInstancingLastSyncAt = 0;
  let debugGroundChunksLastSyncAt = 0;
  let debugGroundUnloadedTotal = 0;
  let debugLastGroundChunkKeys: Set<string> | null = null;

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
    rendererDebug.pixelRatio = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
    rendererDebug.width = (canvas?.width || canvas?.clientWidth || 0) as number;
    rendererDebug.height = (canvas?.height || canvas?.clientHeight || 0) as number;
  }

  function clampInclusive(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  function computeTotalGroundChunkCount(definition: GroundDynamicMesh, chunkCells: number): number {
    const rows = Math.max(1, Math.trunc(definition.rows));
    const columns = Math.max(1, Math.trunc(definition.columns));
    const safeCells = Math.max(1, Math.trunc(chunkCells));
    const rowChunks = Math.ceil(rows / safeCells);
    const columnChunks = Math.ceil(columns / safeCells);
    return Math.max(1, rowChunks * columnChunks);
  }

  function computeTargetLoadChunkCount(groundObject: THREE.Object3D, definition: GroundDynamicMesh, camera: THREE.Camera | null): number {
    const chunkCells = resolveGroundRuntimeChunkCells(definition);
    const rows = Math.max(1, Math.trunc(definition.rows));
    const columns = Math.max(1, Math.trunc(definition.columns));
    const maxChunkRowIndex = Math.max(0, Math.floor((rows - 1) / chunkCells));
    const maxChunkColumnIndex = Math.max(0, Math.floor((columns - 1) / chunkCells));

    let localX = 0;
    let localZ = 0;
    if (camera) {
      groundObject.updateMatrixWorld(true);
      const cameraWorld = new THREE.Vector3();
      camera.getWorldPosition(cameraWorld);
      const cameraLocal = (groundObject as THREE.Group).worldToLocal(cameraWorld);
      localX = cameraLocal.x;
      localZ = cameraLocal.z;
    }

    const loadRadius = resolveGroundChunkRadiusMeters(definition);
    const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1;
    const halfWidth = definition.width * 0.5;
    const halfDepth = definition.depth * 0.5;

    const minLoadColumn = clampInclusive(Math.floor((localX - loadRadius + halfWidth) / cellSize), 0, columns);
    const maxLoadColumn = clampInclusive(Math.ceil((localX + loadRadius + halfWidth) / cellSize), 0, columns);
    const minLoadRow = clampInclusive(Math.floor((localZ - loadRadius + halfDepth) / cellSize), 0, rows);
    const maxLoadRow = clampInclusive(Math.ceil((localZ + loadRadius + halfDepth) / cellSize), 0, rows);

    const minLoadChunkColumn = clampInclusive(Math.floor(minLoadColumn / chunkCells), 0, maxChunkColumnIndex);
    const maxLoadChunkColumn = clampInclusive(Math.floor(maxLoadColumn / chunkCells), 0, maxChunkColumnIndex);
    const minLoadChunkRow = clampInclusive(Math.floor(minLoadRow / chunkCells), 0, maxChunkRowIndex);
    const maxLoadChunkRow = clampInclusive(Math.floor(maxLoadRow / chunkCells), 0, maxChunkRowIndex);

    const count = (maxLoadChunkRow - minLoadChunkRow + 1) * (maxLoadChunkColumn - minLoadChunkColumn + 1);
    return Math.max(1, count);
  }

  function syncGroundChunkDebugCounters(groundObject: THREE.Object3D, definition: GroundDynamicMesh, camera: THREE.Camera | null): void {
    if (!debugEnabled.value) {
      return;
    }
    const now = Date.now();
    if (now - debugGroundChunksLastSyncAt < 250) {
      return;
    }
    debugGroundChunksLastSyncAt = now;

    const loadedKeys = new Set<string>();
    groundObject.traverse((object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      const mesh = object;
      const chunk = (mesh.userData?.groundChunk ?? null) as { chunkRow?: number; chunkColumn?: number } | null;
      if (!chunk || typeof chunk.chunkRow !== 'number' || typeof chunk.chunkColumn !== 'number') {
        return;
      }
      loadedKeys.add(`${chunk.chunkRow}:${chunk.chunkColumn}`);
    });

    if (debugLastGroundChunkKeys) {
      let removed = 0;
      debugLastGroundChunkKeys.forEach((key) => {
        if (!loadedKeys.has(key)) {
          removed += 1;
        }
      });
      if (removed > 0) {
        debugGroundUnloadedTotal += removed;
      }
    }
    debugLastGroundChunkKeys = loadedKeys;

    const chunkCells = resolveGroundRuntimeChunkCells(definition);
    groundChunkDebug.loaded = loadedKeys.size;
    groundChunkDebug.total = computeTotalGroundChunkCount(definition, chunkCells);
    groundChunkDebug.target = computeTargetLoadChunkCount(groundObject, definition, camera);
    groundChunkDebug.pending = Math.max(0, groundChunkDebug.target - groundChunkDebug.loaded);
    groundChunkDebug.unloaded = debugGroundUnloadedTotal;
  }

  return {
    debugEnabled,
    debugMode,
    debugOverlayVisible,
    debugFps,
    instancingDebug,
    rendererDebug,
    groundChunkDebug,
    updateDebugFps,
    syncInstancingDebugCounters,
    syncRendererDebug,
    syncGroundChunkDebugCounters,
    estimateSceneTriangleCount,
  };
}
