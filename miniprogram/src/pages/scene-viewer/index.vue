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
      <view
        v-if="behaviorAlertVisible"
        class="viewer-behavior-overlay"
        @tap.self="dismissBehaviorAlert"
      >
        <view class="viewer-behavior-dialog">
          <text class="viewer-behavior-title">{{ behaviorAlertTitle }}</text>
          <text v-if="behaviorAlertMessage" class="viewer-behavior-message">{{ behaviorAlertMessage }}</text>
          <button class="viewer-behavior-button" @tap="dismissBehaviorAlert">确定</button>
        </view>
      </view>
      <view
        v-if="loading || resourcePreload.active"
        class="viewer-overlay"
      >
        <view class="viewer-overlay__content">
          <text class="viewer-overlay__message">
            {{ resourcePreload.active ? '资源加载中…' : '正在加载场景…' }}
          </text>
          <progress
            v-if="resourcePreload.active"
            :percent="resourcePreloadPercent"
            show-info
            stroke-width="6"
            class="viewer-overlay__progress"
          />
          <text
            v-if="resourcePreload.active && resourcePreload.total"
            class="viewer-overlay__caption"
          >
            {{ resourcePreload.label || `已加载 ${resourcePreload.loaded} / ${resourcePreload.total}` }}
          </text>
        </view>
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
import { effectScope, watchEffect, ref, computed, onUnmounted, watch, reactive } from 'vue';
import { onLoad, onUnload, onReady } from '@dcloudio/uni-app';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';
import PlatformCanvas from '@/components/PlatformCanvas.vue';
import type { StoredSceneEntry } from '@/stores/sceneStore';
import { useSceneStore } from '@/stores/sceneStore';
import { buildSceneGraph } from '@schema/sceneGraph';
import type { SceneNode, SceneSkyboxSettings } from '@harmony/schema';
import { ComponentManager } from '@schema/components/componentManager';
import { behaviorComponentDefinition, wallComponentDefinition } from '@schema/components';
import {
  listInteractableObjects,
  resetBehaviorRuntime,
  triggerBehaviorAction,
  type BehaviorRuntimeEvent,
} from '@schema/behaviors/runtime';


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

const resourcePreload = reactive({
  active: false,
  loaded: 0,
  total: 0,
  label: '',
});

const resourcePreloadPercent = computed(() => {
  if (!resourcePreload.total) {
    return resourcePreload.active ? 0 : 100;
  }
  return Math.min(100, Math.round((resourcePreload.loaded / resourcePreload.total) * 100));
});
const SKY_ENVIRONMENT_INTENSITY = 0.35;
const SKY_SCALE = 2500;
const DEFAULT_SKYBOX_SETTINGS: SceneSkyboxSettings = {
  presetId: 'clear-day',
  exposure: 0.6,
  turbidity: 4,
  rayleigh: 1.25,
  mieCoefficient: 0.0025,
  mieDirectionalG: 0.75,
  elevation: 22,
  azimuth: 145,
};
const skySunPosition = new THREE.Vector3();
let sky: Sky | null = null;
let pmremGenerator: THREE.PMREMGenerator | null = null;
let skyEnvironmentTarget: THREE.WebGLRenderTarget | null = null;
let pendingSkyboxSettings: SceneSkyboxSettings | null = null;
let renderContext: RenderContext | null = null;
type WindowResizeCallback = Parameters<typeof uni.onWindowResize>[0];
let resizeListener: WindowResizeCallback | null = null;
let canvasResult: UseCanvasResult | null = null;
let initializing = false;
const scope = effectScope();
const bootstrapFinished = ref(false);

const previewComponentManager = new ComponentManager();
previewComponentManager.registerDefinition(wallComponentDefinition);
previewComponentManager.registerDefinition(behaviorComponentDefinition);

const previewNodeMap = new Map<string, SceneNode>();
const nodeObjectMap = new Map<string, THREE.Object3D>();

const behaviorRaycaster = new THREE.Raycaster();
const behaviorPointer = new THREE.Vector2();
let behaviorTapListener: ((event: TouchEvent) => void) | null = null;

// Behavior alert overlay state
const behaviorAlertVisible = ref(false);
const behaviorAlertTitle = ref('');
const behaviorAlertMessage = ref('');

function presentBehaviorAlert(title: string, message: string) {
  const normalizedTitle = (title || '').trim();
  behaviorAlertTitle.value = normalizedTitle || '提示';
  behaviorAlertMessage.value = message || '';
  behaviorAlertVisible.value = true;
}

function dismissBehaviorAlert() {
  behaviorAlertVisible.value = false;
}

function cloneSkyboxSettings(settings: SceneSkyboxSettings): SceneSkyboxSettings {
  return { ...settings };
}

function sanitizeSkyboxSettings(input: SceneSkyboxSettings): SceneSkyboxSettings {
  const ensureNumber = (candidate: unknown, fallback: number) => {
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
  };
  return {
    		presetId: input.presetId ?? DEFAULT_SKYBOX_SETTINGS.presetId,
    exposure: ensureNumber(input.exposure, DEFAULT_SKYBOX_SETTINGS.exposure),
    turbidity: ensureNumber(input.turbidity, DEFAULT_SKYBOX_SETTINGS.turbidity),
    rayleigh: ensureNumber(input.rayleigh, DEFAULT_SKYBOX_SETTINGS.rayleigh),
    mieCoefficient: ensureNumber(input.mieCoefficient, DEFAULT_SKYBOX_SETTINGS.mieCoefficient),
    mieDirectionalG: ensureNumber(input.mieDirectionalG, DEFAULT_SKYBOX_SETTINGS.mieDirectionalG),
    elevation: ensureNumber(input.elevation, DEFAULT_SKYBOX_SETTINGS.elevation),
    azimuth: ensureNumber(input.azimuth, DEFAULT_SKYBOX_SETTINGS.azimuth),
  };
}

function resolveSceneSkybox(document: StoredSceneEntry['scene'] | null | undefined): SceneSkyboxSettings | null {
  if (!document) {
    return null;
  }
  return sanitizeSkyboxSettings(document.skybox);
}

function rebuildPreviewNodeMap(nodes: SceneNode[] | undefined | null) {
  previewNodeMap.clear();
  if (!Array.isArray(nodes)) {
    return;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    previewNodeMap.set(node.id, node);
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
}

function resolveNodeById(nodeId: string): SceneNode | null {
  return previewNodeMap.get(nodeId) ?? null;
}

function attachRuntimeForNode(nodeId: string, object: THREE.Object3D) {
  const nodeState = resolveNodeById(nodeId);
  if (!nodeState) {
    return;
  }
  previewComponentManager.attachRuntime(nodeState, object);
}

function indexSceneObjects(root: THREE.Object3D) {
  nodeObjectMap.clear();
  root.traverse((object) => {
    const nodeId = object.userData?.nodeId as string | undefined;
    if (nodeId) {
      nodeObjectMap.set(nodeId, object);
      attachRuntimeForNode(nodeId, object);
    }
  });
}

function handleBehaviorRuntimeEvent(event: BehaviorRuntimeEvent) {
  switch (event.type) {
    case 'show-alert':
      const params = event.params;
      const alertTitle = (params as { title?: string }).title ?? '提示';
      const alertMessage = params.content ?? '';
      presentBehaviorAlert(alertTitle, alertMessage);
      break;
    default:
      break;
  }
}

function ensureBehaviorTapHandler(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
  if (behaviorTapListener) {
    canvas.removeEventListener('touchend', behaviorTapListener);
    behaviorTapListener = null;
  }
  behaviorTapListener = (event: TouchEvent) => {
    if (!renderContext?.scene) {
      return;
    }
    const touches = event.changedTouches ?? event.touches;
    const firstTouch = touches && touches[0];
    if (!firstTouch) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    behaviorPointer.x = ((firstTouch.clientX - rect.left) / rect.width) * 2 - 1;
    behaviorPointer.y = -((firstTouch.clientY - rect.top) / rect.height) * 2 + 1;
    behaviorRaycaster.setFromCamera(behaviorPointer, camera);
    const candidates = listInteractableObjects();
    if (!candidates.length) {
      return;
    }
    const intersections = behaviorRaycaster.intersectObjects(candidates, true);
    if (!intersections.length) {
      return;
    }
    for (const intersection of intersections) {
      let current: THREE.Object3D | null = intersection.object;
      let nodeId: string | null = null;
      while (current) {
        const id = current.userData?.nodeId as string | undefined;
        if (id) {
          nodeId = id;
          break;
        }
        current = current.parent;
      }
      if (!nodeId) {
        continue;
      }
      const results = triggerBehaviorAction(nodeId, 'click', {
        intersection: {
          object: intersection.object,
          point: {
            x: intersection.point.x,
            y: intersection.point.y,
            z: intersection.point.z,
          },
        },
      });
      results.forEach((output: BehaviorRuntimeEvent) => handleBehaviorRuntimeEvent(output));
      break;
    }
  };
  canvas.addEventListener('touchend', behaviorTapListener);
}

function disposeSkyEnvironment() {
  if (skyEnvironmentTarget) {
    skyEnvironmentTarget.dispose();
    skyEnvironmentTarget = null;
  }
}

function disposeSkyResources() {
  disposeSkyEnvironment();
  if (!sky) {
    return;
  }
  sky.parent?.remove(sky);
  const material = sky.material;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry?.dispose?.());
  } else {
    material?.dispose?.();
  }
  sky.geometry?.dispose?.();
  sky = null;
}

function ensureSkyExists() {
  if (!renderContext?.scene) {
    return;
  }
  if (sky) {
    if (sky.parent !== renderContext.scene) {
      renderContext.scene.add(sky);
    }
    return;
  }
  sky = new Sky();
  sky.name = 'HarmonySky';
  sky.scale.setScalar(SKY_SCALE);
  sky.frustumCulled = false;
  renderContext.scene.add(sky);
}

function updateSkyLighting(settings: SceneSkyboxSettings) {
  if (!sky) {
    return;
  }
  const skyMaterial = sky.material as THREE.ShaderMaterial;
  const uniforms = skyMaterial.uniforms;
  const phi = THREE.MathUtils.degToRad(90 - settings.elevation);
  const theta = THREE.MathUtils.degToRad(settings.azimuth);
  skySunPosition.setFromSphericalCoords(1, phi, theta);
  const sunUniform = uniforms?.sunPosition;
  if (sunUniform?.value instanceof THREE.Vector3) {
    sunUniform.value.copy(skySunPosition);
  } else if (sunUniform) {
    sunUniform.value = skySunPosition.clone();
  }
}

function applySkyboxSettings(settings: SceneSkyboxSettings | null) {
  const context = renderContext;
  if (!context) {
    pendingSkyboxSettings = settings ? cloneSkyboxSettings(settings) : null;
    return;
  }
  const { renderer, scene } = context;
  if (!renderer || !scene) {
    pendingSkyboxSettings = settings ? cloneSkyboxSettings(settings) : null;
    return;
  }
  if (!settings) {
    disposeSkyEnvironment();
    scene.environment = null;
    renderer.toneMappingExposure = DEFAULT_SKYBOX_SETTINGS.exposure;
    pendingSkyboxSettings = null;
    return;
  }
  ensureSkyExists();
  if (!sky) {
    pendingSkyboxSettings = cloneSkyboxSettings(settings);
    return;
  }
  const skyMaterial = sky.material as THREE.ShaderMaterial;
  const uniforms = skyMaterial.uniforms;
  const assignUniform = (key: string, value: number) => {
    const uniform = uniforms?.[key];
    if (!uniform) {
      return;
    }
    if (typeof uniform.value === 'number') {
      uniform.value = value;
      return;
    }
    if (uniform.value && typeof uniform.value === 'object' && 'setScalar' in uniform.value) {
      uniform.value.setScalar?.(value);
      return;
    }
    uniform.value = value;
  };
  assignUniform('turbidity', settings.turbidity);
  assignUniform('rayleigh', settings.rayleigh);
  assignUniform('mieCoefficient', settings.mieCoefficient);
  assignUniform('mieDirectionalG', settings.mieDirectionalG);
  updateSkyLighting(settings);
  renderer.toneMappingExposure = settings.exposure;
  if (!pmremGenerator && renderer) {
    pmremGenerator = new THREE.PMREMGenerator(renderer);
  }
  disposeSkyEnvironment();
  if (pmremGenerator && sky) {
    skyEnvironmentTarget = pmremGenerator.fromScene(sky as unknown as THREE.Scene);
    scene.environment = skyEnvironmentTarget.texture;
    scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY;
  }
  pendingSkyboxSettings = null;
}
function handleSceneEntry(entry: StoredSceneEntry | null) {
  const sceneId = currentSceneId.value;
  if (!sceneId) {
    return;
  }
  if (!entry) {
    applySkyboxSettings(null);
    error.value = '未找到对应的场景数据';
    loading.value = false;
    return;
  }
  error.value = null;
  const skyboxSettings = resolveSceneSkybox(entry.scene);
  applySkyboxSettings(skyboxSettings);
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
  if (canvasResult?.canvas && behaviorTapListener) {
    canvasResult.canvas.removeEventListener('touchend', behaviorTapListener);
    behaviorTapListener = null;
  }
  previewComponentManager.reset();
  resetBehaviorRuntime();
  behaviorAlertVisible.value = false;
  previewNodeMap.clear();
  nodeObjectMap.clear();
  controls.dispose();
  disposeSkyResources();
  pmremGenerator?.dispose();
  pmremGenerator = null;
  pendingSkyboxSettings = null;
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DEFAULT_SKYBOX_SETTINGS.exposure;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  pmremGenerator?.dispose();
  pmremGenerator = new THREE.PMREMGenerator(renderer);

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
  camera.position.set(5, 5, 5);

  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f9f9f9');
  scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY;

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
  const { canvas } = canvasResult;
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

  ensureSkyExists();

  resourcePreload.active = true;
  resourcePreload.loaded = 0;
  resourcePreload.total = 0;
  resourcePreload.label = '准备加载资源...';

  let graph: Awaited<ReturnType<typeof buildSceneGraph>> | null = null;
  try {
    graph = await buildSceneGraph(sceneEntry.scene, {
      enableGround: true,
      onProgress: (info) => {
        resourcePreload.total = info.total;
        resourcePreload.loaded = info.loaded;
        resourcePreload.label = info.message || (info.assetId ? `加载 ${info.assetId}` : '');
        resourcePreload.active = info.total > 0 && info.loaded < info.total;
      },
    });
  } finally {
    if (!resourcePreload.active || resourcePreload.loaded >= resourcePreload.total) {
      resourcePreload.active = false;
      resourcePreload.label = '';
    }
  }
  if (!graph) {
    return;
  }

  if (graph.warnings.length) {
    warnings.value = graph.warnings;
  }
  scene.add(graph.root);

  resetBehaviorRuntime();
  previewComponentManager.reset();
  rebuildPreviewNodeMap(sceneEntry.scene.nodes);
  previewComponentManager.syncScene(sceneEntry.scene.nodes ?? []);
  indexSceneObjects(graph.root);
  ensureBehaviorTapHandler(canvas as HTMLCanvasElement, camera);

  focusCameraOnScene(graph.root);

  const skyboxSettings = resolveSceneSkybox(sceneEntry.scene);
  applySkyboxSettings(skyboxSettings);
  if (pendingSkyboxSettings) {
    applySkyboxSettings(pendingSkyboxSettings);
  }

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

.viewer-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 80%;
  max-width: 320px;
}

.viewer-overlay__message {
  font-size: 14px;
  font-weight: 600;
}

.viewer-overlay__progress {
  width: 100%;
}

.viewer-overlay__caption {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
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

/* Behavior alert overlay (floats above canvas) */
.viewer-behavior-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.35);
  z-index: 2000; /* above loading/error overlays */
}

.viewer-behavior-dialog {
  min-width: 240px;
  max-width: 80vw;
  padding: 14px 16px;
  border-radius: 12px;
  background-color: rgba(18, 18, 32, 0.96);
  color: #f5f7ff;
  text-align: center;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
}

.viewer-behavior-title {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
  font-weight: 600;
}

.viewer-behavior-message {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
  opacity: 0.9;
}

.viewer-behavior-button {
  padding: 8px 14px;
  border: none;
  border-radius: 18px;
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
  color: #ffffff;
  font-size: 14px;
}
</style>
