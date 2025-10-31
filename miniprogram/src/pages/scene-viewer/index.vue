<template>
  <view class="viewer-page">
    <view class="viewer-header">
      <button class="back-button" @tap="handleBack">返回</button>
      <view class="header-info">
        <text class="scene-name">{{ sceneEntry?.scene.name || '场景预览' }}</text>
      </view>
    </view>
    <view class="viewer-canvas-wrapper">
      <PlatformCanvas
        v-if="!error"
        :canvas-id="canvasId"
        type="webgl"
        class="viewer-canvas"
        @useCanvas="handleUseCanvas"
      />
      <view v-if="loading" class="viewer-overlay">
        <text>正在加载场景…</text>
      </view>
      <view v-if="error" class="viewer-overlay error">
        <text>{{ error }}</text>
      </view>
    </view>
    <view class="viewer-footer" v-if="warnings.length">
      <text class="footer-title">警告</text>
      <view class="footer-warnings">
        <text v-for="item in warnings" :key="item" class="warning-item">{{ item }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { effectScope, watchEffect, ref, computed, onUnmounted, watch } from 'vue';
import { onLoad, onUnload, onReady } from '@dcloudio/uni-app';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';
import PlatformCanvas from '@/components/PlatformCanvas.vue';
import type { StoredSceneEntry } from '@/stores/sceneStore';
import { useSceneStore } from '@/stores/sceneStore';
import { buildSceneGraph } from '@schema/sceneGraph';


interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

const sceneStore = useSceneStore();
const canvasId = `scene-viewer-${Date.now()}`;
const currentSceneId = ref<string | null>(null);
const sceneEntry = computed<StoredSceneEntry | null>(() => {
  const sceneId = currentSceneId.value;
  if (!sceneId) {
    return null;
  }
  return sceneStore.getScene(sceneId) ?? null;
});
const loading = ref(true);
const error = ref<string | null>(null);
const warnings = ref<string[]>([]);
let renderContext: RenderContext | null = null;
type WindowResizeCallback = Parameters<typeof uni.onWindowResize>[0];
let resizeListener: WindowResizeCallback | null = null;
let canvasResult: UseCanvasResult | null = null;
let initializing = false;
const scope = effectScope();
const bootstrapFinished = ref(false);
function handleSceneEntry(entry: StoredSceneEntry | null) {
  const sceneId = currentSceneId.value;
  if (!sceneId) {
    return;
  }
  if (!entry) {
    error.value = '未找到对应的场景数据';
    loading.value = false;
    return;
  }
  error.value = null;
  uni.setNavigationBarTitle({ title: entry.scene.name || '场景预览' });
  startRenderIfReady();
}
watch(sceneEntry, (entry) => {
  if (!bootstrapFinished.value) {
    return;
  }
  handleSceneEntry(entry);
});



function handleBack() {
  uni.navigateBack({ delta: 1 });
}

async function startRenderIfReady() {
  if (!sceneEntry.value || !canvasResult || initializing) {
    return;
  }
  initializing = true;
  loading.value = true;
  error.value = null;
  warnings.value = [];
  try {
    await ensureRendererContext(canvasResult);
    await initializeRenderer(sceneEntry.value, canvasResult);
  } catch (initializationError) {
    console.error(initializationError);
    error.value = '初始化渲染器失败';
  } finally {
    loading.value = false;
    initializing = false;
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material?.dispose?.());
      } else if (mesh.material) {
        mesh.material.dispose?.();
      }
    }
    if ((child as THREE.Light).isLight) {
      const light = child as THREE.Light;
      (light.shadow as any)?.map?.dispose?.();
    }
  });
}

function teardownRenderer() {
  if (!renderContext) {
    return;
  }
  const { renderer, scene, controls } = renderContext;
  controls.dispose();
  disposeObject(scene);
  renderer.dispose();
  renderContext = null;
  canvasResult = null;
}

function handleUseCanvas(result: UseCanvasResult) {
  canvasResult = result;
  startRenderIfReady();
}

async function ensureRendererContext(canvasResult: UseCanvasResult) {
  if (renderContext) {
    teardownRenderer();
  }
  await canvasResult.recomputeSize?.();
  const { canvas } = canvasResult;
  const pixelRatio = canvasResult.canvas?.ownerDocument?.defaultView?.devicePixelRatio || uni.getSystemInfoSync().pixelRatio || 1;
  const width = canvas.width || canvas.clientWidth || 1;
  const height = canvas.height || canvas.clientHeight || 1;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
  camera.position.set(5, 5, 5);

  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f9f9f9');

  renderContext = {
    renderer,
    scene,
    camera,
    controls,
  };
}

function focusCameraOnScene(root: THREE.Object3D) {
  if (!renderContext) {
    return;
  }
  const { camera, controls } = renderContext;
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = maxSize / Math.tan((camera.fov * Math.PI) / 360);
    const offset = new THREE.Vector3(distance, distance, distance);
    camera.position.copy(center.clone().add(offset));
    camera.near = Math.max(0.1, distance / 100);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }
}

async function initializeRenderer(sceneEntry: StoredSceneEntry, canvasResult: UseCanvasResult) {
  if (!renderContext) {
    throw new Error('Render context missing');
  }
  const { scene, renderer, camera, controls } = renderContext;
  scene.children.forEach((child) => disposeObject(child));
  scene.clear();
  warnings.value = [];

  const ambientLight = new THREE.AmbientLight('#ffffff', 0.6);
  const directionalLight = new THREE.DirectionalLight('#ffffff', 0.6);
  directionalLight.position.set(8, 12, 6);
  directionalLight.castShadow = true;
  scene.add(ambientLight);
  scene.add(directionalLight);

  const hemisphericLight = new THREE.HemisphereLight('#d4d8ff', '#f5f2ef', 0.3);
  scene.add(hemisphericLight);

  const graph = await buildSceneGraph(sceneEntry.scene, { enableGround: true });
  if (graph.warnings.length) {
    warnings.value = graph.warnings;
  }
  scene.add(graph.root);

  focusCameraOnScene(graph.root);

  const { canvas } = canvasResult;
  const width = canvas.width || canvas.clientWidth || 1;
  const height = canvas.height || canvas.clientHeight || 1;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  scope.run(() => {
    watchEffect((onCleanup) => {
       const { cancel } = canvasResult.useFrame((delta) => {
          controls.update();
          renderer.render(scene, camera);
        });
        onCleanup(() => {
          cancel();
        });
    });
  });

}

const handleResize: WindowResizeCallback = (_result) => {
  if (!renderContext || !canvasResult) {
    return;
  }
  const resizePromise = canvasResult.recomputeSize?.();
  Promise.resolve(resizePromise).finally(() => {
    if (!canvasResult) {
      return;
    }
    const { canvas } = canvasResult;
    const width = canvas.width || canvas.clientWidth || 1;
    const height = canvas.height || canvas.clientHeight || 1;
    renderContext!.renderer.setSize(width, height, false);
    renderContext!.camera.aspect = width / height;
    renderContext!.camera.updateProjectionMatrix();
  });
};

onLoad((query) => {
  const sceneId = typeof query?.id === 'string' ? query.id : '';
  currentSceneId.value = sceneId;
  if (!sceneId) {
    error.value = '缺少场景标识';
    loading.value = false;
    return;
  }
  
  bootstrapFinished.value = true;
  handleSceneEntry(sceneEntry.value);
});

onReady(() => {
  if (!resizeListener) {
    resizeListener = handleResize;
    uni.onWindowResize(handleResize);
  }
});

onUnload(() => {
  teardownRenderer();
  if (resizeListener) {
    uni.offWindowResize(handleResize);
    resizeListener = null;
  }
});

onUnmounted(() => {
  teardownRenderer();
  if (resizeListener) {
    uni.offWindowResize(handleResize);
    resizeListener = null;
  }
});

</script>

<style lang="scss">
.viewer-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f5f5f5;
}

.viewer-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background-color: #ffffff;
  gap: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  z-index: 10;
}

.back-button,
.reload-button {
  padding: 6px 12px;
  border-radius: 16px;
  border: none;
  font-size: 14px;
  line-height: 1.4;
  background-color: #1f7aec;
  color: #ffffff;
}

.reload-button[disabled] {
  opacity: 0.5;
}

.header-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.scene-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a1a;
}

.scene-meta {
  margin-top: 2px;
  font-size: 12px;
  color: #8a8a8a;
}

.viewer-canvas-wrapper {
  position: relative;
  flex: 1;
  background-color: #e9eef5;
}

.viewer-canvas {
  width: 100%;
  height: 100%;
}

.viewer-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(29, 30, 34, 0.4);
  color: #ffffff;
  font-size: 14px;
  text-align: center;
  padding: 12px;
}

.viewer-overlay.error {
  background-color: rgba(208, 0, 0, 0.6);
}

.viewer-footer {
  padding: 12px 16px;
  background-color: #ffffff;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.footer-title {
  font-size: 14px;
  font-weight: 600;
  color: #cc8b00;
}

.footer-warnings {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warning-item {
  font-size: 12px;
  color: #cc8b00;
  line-height: 1.4;
}
</style>
