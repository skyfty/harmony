import { ref, reactive, computed } from 'vue';
import * as THREE from 'three';

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


  let debugFpsFrames = 0;
  let debugFpsAccumSeconds = 0;
  let debugFpsLastSyncAt = 0;
  let debugInstancingLastSyncAt = 0;

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


  return {
    debugEnabled,
    debugMode,
    debugOverlayVisible,
    debugFps,
    instancingDebug,
    rendererDebug,
    updateDebugFps,
    syncInstancingDebugCounters,
    syncRendererDebug,
    estimateSceneTriangleCount,
  };
}
