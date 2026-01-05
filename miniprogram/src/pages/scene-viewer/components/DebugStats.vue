<template>
  <view v-if="debugOverlayVisible" class="viewer-debug-overlay">
    <text class="viewer-debug-line">FPS: {{ debugFps }}</text>
    <text class="viewer-debug-line">Viewport: {{ rendererDebug.width }}x{{ rendererDebug.height }} @PR {{ rendererDebug.pixelRatio }}</text>
    <text class="viewer-debug-line">Draw calls: {{ rendererDebug.calls }}, Tris: {{ rendererDebug.triangles }}</text>
    <text class="viewer-debug-line">GPU mem (geo/tex): {{ rendererDebug.geometries }} / {{ rendererDebug.textures }}</text>
    <text class="viewer-debug-line">InstancedMeshes: {{ instancingDebug.instancedMeshAssets }}</text>
    <text class="viewer-debug-line">Instanced active/total: {{ instancingDebug.instancedMeshActive }} / {{ instancingDebug.instancedMeshAssets }}</text>
    <text class="viewer-debug-line">Instanced instances (sum mesh.count): {{ instancingDebug.instancedInstanceCount }}</text>
    <text class="viewer-debug-line">Instanced matrix upload est: {{ instancingDebug.instanceMatrixUploadKb }} KB/frame</text>
    <text class="viewer-debug-line">LOD nodes (visible/total): {{ instancingDebug.lodVisible }} / {{ instancingDebug.lodTotal }}</text>
    <text class="viewer-debug-line">Terrain scatter (visible/total): {{ instancingDebug.scatterVisible }} / {{ instancingDebug.scatterTotal }}</text>
    <text class="viewer-debug-line">Ground chunks (loaded/target/total): {{ groundChunkDebug.loaded }} / {{ groundChunkDebug.target }} / {{ groundChunkDebug.total }}</text>
    <text class="viewer-debug-line">Ground chunks (pending/unloaded): {{ groundChunkDebug.pending }} / {{ groundChunkDebug.unloaded }}</text>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  debugOverlayVisible: boolean;
  debugFps: number;
  rendererDebug: {
    width: number;
    height: number;
    pixelRatio: number;
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  instancingDebug: {
    instancedMeshAssets: number;
    instancedMeshActive: number;
    instancedInstanceCount: number;
    instanceMatrixUploadKb: number;
    lodVisible: number;
    lodTotal: number;
    scatterVisible: number;
    scatterTotal: number;
  };
  groundChunkDebug: {
    loaded: number;
    target: number;
    total: number;
    pending: number;
    unloaded: number;
  };
}>();
</script>

<style lang="scss" scoped>
.viewer-debug-overlay {
  position: absolute;
  left: 12px;
  top: calc(12px + var(--viewer-safe-area-top, 0px));
  z-index: 1900;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(8, 12, 26, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(245, 250, 255, 0.92);
  font-size: 12px;
  line-height: 1.45;
  pointer-events: none;
}

.viewer-debug-line {
  display: block;
  white-space: nowrap;
}
</style>
