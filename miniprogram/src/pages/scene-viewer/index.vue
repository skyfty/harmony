<template>
  <view class="viewer-page">
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
  @tap.self="cancelBehaviorAlert"
      >
        <view class="viewer-behavior-dialog">
          <text class="viewer-behavior-title">{{ behaviorAlertTitle }}</text>
          <scroll-view v-if="behaviorAlertMessage" scroll-y class="viewer-behavior-message">
            <text>{{ behaviorAlertMessage }}</text>
          </scroll-view>
          <view class="viewer-behavior-actions">
            <button
              v-if="behaviorAlertShowCancel"
              class="viewer-behavior-button cancel"
              @tap="cancelBehaviorAlert"
            >
              {{ behaviorAlertCancelText }}
            </button>
            <button
              v-if="behaviorAlertShowConfirm"
              class="viewer-behavior-button"
              @tap="confirmBehaviorAlert"
            >
              {{ behaviorAlertConfirmText }}
            </button>
          </view>
        </view>
      </view>
      <view v-if="lanternOverlayVisible" class="viewer-lantern-overlay">
        <view class="viewer-lantern-dialog">
          <view v-if="lanternCurrentSlideImage" class="viewer-lantern-image-wrapper">
            <image :src="lanternCurrentSlideImage" mode="aspectFit" class="viewer-lantern-image" />
          </view>
          <view class="viewer-lantern-body">
            <text class="viewer-lantern-title">{{ lanternCurrentTitle }}</text>
            <scroll-view
              v-if="lanternCurrentSlideDescription"
              scroll-y
              class="viewer-lantern-text"
            >
              <text>{{ lanternCurrentSlideDescription }}</text>
            </scroll-view>
          </view>
          <view v-if="lanternHasMultipleSlides" class="viewer-lantern-pagination">
            <button
              class="viewer-lantern-nav"
              :disabled="lanternActiveSlideIndex === 0"
              @tap="showPreviousLanternSlide"
            >
              上一页
            </button>
            <text class="viewer-lantern-counter">{{ lanternActiveSlideIndex + 1 }} / {{ lanternTotalSlides }}</text>
            <button
              class="viewer-lantern-nav"
              :disabled="lanternActiveSlideIndex >= lanternTotalSlides - 1"
              @tap="showNextLanternSlide"
            >
              下一页
            </button>
          </view>
          <view class="viewer-lantern-actions">
            <button class="viewer-lantern-button cancel" @tap="cancelLanternOverlay">取消</button>
            <button class="viewer-lantern-button" @tap="confirmLanternOverlay">继续</button>
          </view>
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
import { parseSceneDocument, useSceneStore } from '@/stores/sceneStore';
import { buildSceneGraph, type SceneGraphBuildOptions } from '@schema/sceneGraph';
import type { SceneNode, SceneSkyboxSettings, SceneJsonExportDocument, LanternSlideDefinition } from '@harmony/schema';
import { ComponentManager } from '@schema/components/componentManager';
import { behaviorComponentDefinition, wallComponentDefinition } from '@schema/components';
import {
  addBehaviorRuntimeListener,
  hasRegisteredBehaviors,
  listInteractableObjects,
  listRegisteredBehaviorActions,
  removeBehaviorRuntimeListener,
  resetBehaviorRuntime,
  resolveBehaviorEvent,
  triggerBehaviorAction,
  type BehaviorRuntimeEvent,
  type BehaviorEventResolution,
  type BehaviorRuntimeListener,
  PROXIMITY_EXIT_PADDING,
  DEFAULT_OBJECT_RADIUS,
  PROXIMITY_MIN_DISTANCE,
  PROXIMITY_RADIUS_SCALE,
} from '@schema/behaviors/runtime';

interface ScenePreviewPayload {
  document: SceneJsonExportDocument;
  title: string;
  origin?: string;
  createdAt?: string;
  updatedAt?: string;
  assetOverrides?: Record<string, string | ArrayBuffer>;
  resolveAssetUrl?: (assetId: string) => string | Promise<string | null> | null;
  presetAssetBaseUrl?: string;
  enableGround?: boolean;
}

type RequestedMode = 'store' | 'document' | 'model' | null;

interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

const PRESET_ASSET_BASE_URL = '/package-scene/static/preset';

const sceneStore = useSceneStore();
const canvasId = `scene-viewer-${Date.now()}`;
const currentSceneId = ref<string | null>(null);
const requestedMode = ref<RequestedMode>(null);

const sceneEntry = computed<StoredSceneEntry | null>(() => {
  const sceneId = currentSceneId.value;
  if (!sceneId) {
    return null;
  }
  return sceneStore.getScene(sceneId) ?? null;
});

const previewPayload = ref<ScenePreviewPayload | null>(null);
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
const HUMAN_EYE_HEIGHT = 1.7;
const CAMERA_FORWARD_OFFSET = 1.5;
const CAMERA_MAX_LOOK_UP = THREE.MathUtils.degToRad(50);
const CAMERA_MAX_LOOK_DOWN = THREE.MathUtils.degToRad(30);
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
let currentDocument: SceneJsonExportDocument | null = null;
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

const WHEEL_MOVE_STEP = 1.2;
const worldUp = new THREE.Vector3(0, 1, 0);
const tempForwardVec = new THREE.Vector3();
const tempRightVec = new THREE.Vector3();
const tempMovementVec = new THREE.Vector3();

let wheelListenerCleanup: (() => void) | null = null;

const behaviorAlertVisible = ref(false);
const behaviorAlertTitle = ref('');
const behaviorAlertMessage = ref('');
const behaviorAlertToken = ref<string | null>(null);
const behaviorAlertShowConfirm = ref(true);
const behaviorAlertShowCancel = ref(false);
const behaviorAlertConfirmText = ref('确定');
const behaviorAlertCancelText = ref('取消');

const lanternOverlayVisible = ref(false);
const lanternSlides = ref<LanternSlideDefinition[]>([]);
const lanternActiveSlideIndex = ref(0);
const lanternEventToken = ref<string | null>(null);

type LanternTextState = { text: string; loading: boolean; error: string | null };

const lanternTextState = reactive<Record<string, LanternTextState>>({});
const lanternTextPromises = new Map<string, Promise<void>>();

const activeBehaviorDelayTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeBehaviorAnimations = new Map<string, () => void>();
const nodeAnimationControllers = new Map<string, { mixer: THREE.AnimationMixer; clips: THREE.AnimationClip[] }>();
let animationMixers: THREE.AnimationMixer[] = [];

type BehaviorProximityCandidate = { hasApproach: boolean; hasDepart: boolean };
type BehaviorProximityState = { inside: boolean; lastDistance: number | null };
type BehaviorProximityThreshold = { enter: number; exit: number; objectId: string };

type AssetSourceResolution =
  | { kind: 'data-url'; dataUrl: string }
  | { kind: 'remote-url'; url: string }
  | { kind: 'inline-text'; text: string }
  | { kind: 'raw'; data: ArrayBuffer };

const behaviorProximityCandidates = new Map<string, BehaviorProximityCandidate>();
const behaviorProximityState = new Map<string, BehaviorProximityState>();
const behaviorProximityThresholdCache = new Map<string, BehaviorProximityThreshold>();

const tempBox = new THREE.Box3();
const tempSphere = new THREE.Sphere();
const tempVector = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();

const assetObjectUrlCache = new Map<string, string>();
const packageEntryCache = new Map<string, { provider: string; value: string } | null>();

const previewTitle = computed(() => previewPayload.value?.title ?? '场景预览');
const headerCaption = computed(() => {
  const payload = previewPayload.value;
  if (!payload) {
    return '';
  }
  const parts: string[] = [];
  if (payload.origin) {
    parts.push(`来源：${payload.origin}`);
  }
  if (payload.updatedAt) {
    const formatted = formatTimestamp(payload.updatedAt);
    if (formatted) {
      parts.push(`更新：${formatted}`);
    }
  } else if (payload.createdAt) {
    const formatted = formatTimestamp(payload.createdAt);
    if (formatted) {
      parts.push(`创建：${formatted}`);
    }
  }
  return parts.join(' · ');
});

const lanternTotalSlides = computed(() => lanternSlides.value.length);
const lanternCurrentSlide = computed(() => {
  const index = lanternActiveSlideIndex.value;
  if (index < 0 || index >= lanternSlides.value.length) {
    return null;
  }
  return lanternSlides.value[index] ?? null;
});
const lanternHasMultipleSlides = computed(() => lanternTotalSlides.value > 1);
const lanternCurrentTitle = computed(() => {
  const slide = lanternCurrentSlide.value;
  const title = slide?.title?.trim();
  return title?.length ? title : '幻灯片';
});

function getLanternTextState(assetId: string): LanternTextState {
  if (!lanternTextState[assetId]) {
    lanternTextState[assetId] = reactive({
      text: '',
      loading: false,
      error: null,
    }) as LanternTextState;
  }
  return lanternTextState[assetId];
}

const lanternCurrentSlideTextState = computed(() => {
  const slide = lanternCurrentSlide.value;
  if (!slide || !slide.descriptionAssetId) {
    return null;
  }
  return getLanternTextState(slide.descriptionAssetId.trim());
});

const lanternCurrentSlideImage = computed(() => {
  const slide = lanternCurrentSlide.value;
  const assetId = slide?.imageAssetId ?? null;
  return resolveLanternImageSource(assetId);
});

const lanternCurrentSlideDescription = computed(() => {
  const slide = lanternCurrentSlide.value;
  if (!slide) {
    return '';
  }
  if (slide.descriptionAssetId) {
    const state = lanternCurrentSlideTextState.value;
    if (state && !state.loading && !state.error) {
      return state.text;
    }
    return '';
  }
  return slide.description ?? '';
});

watch(
  lanternSlides,
  (slidesList) => {
    const list = Array.isArray(slidesList) ? slidesList : [];
    const activeAssets = new Set<string>();
    list.forEach((slide) => {
      const assetId = slide?.descriptionAssetId?.trim();
      if (assetId) {
        activeAssets.add(assetId);
        void ensureLanternText(assetId);
      }
    });
    if (lanternActiveSlideIndex.value >= list.length) {
      lanternActiveSlideIndex.value = list.length ? list.length - 1 : 0;
    }
    Object.keys(lanternTextState).forEach((key) => {
      if (!activeAssets.has(key)) {
        delete lanternTextState[key];
      }
    });
    Array.from(lanternTextPromises.keys()).forEach((key) => {
      if (!activeAssets.has(key)) {
        lanternTextPromises.delete(key);
      }
    });
  },
  { deep: true },
);

watch(
  lanternCurrentSlide,
  (slide) => {
    const assetId = slide?.descriptionAssetId?.trim();
    if (assetId) {
      void ensureLanternText(assetId);
    }
  },
  { immediate: true },
);

async function ensureLanternText(assetId: string): Promise<void> {
  const trimmed = assetId.trim();
  if (!trimmed.length) {
    return;
  }
  if (lanternTextPromises.has(trimmed)) {
    await lanternTextPromises.get(trimmed);
    return;
  }
  const promise = (async () => {
    const state = getLanternTextState(trimmed);
    state.loading = true;
    state.error = null;
    try {
      const text = await loadTextAssetContent(trimmed);
      state.text = text ?? '';
      if (text == null) {
        state.error = '内容加载失败';
      }
    } catch (error) {
      console.warn('加载幻灯片文本失败', error);
      state.error = error instanceof Error ? error.message : '内容加载失败';
      state.text = '';
    } finally {
      state.loading = false;
      lanternTextPromises.delete(trimmed);
    }
  })();
  lanternTextPromises.set(trimmed, promise);
  await promise;
}

function base64ToArrayBuffer(value: string): ArrayBuffer | null {
  try {
    const clean = value.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
    if (typeof atob === 'function') {
      const binary = atob(clean);
      const length = binary.length;
      const buffer = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        buffer[index] = binary.charCodeAt(index);
      }
      return buffer.buffer;
    }
    const nodeBuffer = (globalThis as any)?.Buffer;
    if (nodeBuffer && typeof nodeBuffer.from === 'function') {
      return nodeBuffer.from(clean, 'base64').buffer;
    }
  } catch (error) {
    console.warn('base64 解析失败', error);
  }
  return null;
}

function decodeDataUrlText(dataUrl: string): string | null {
  try {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
      return null;
    }
    const payload = dataUrl.slice(commaIndex + 1);
    if (typeof atob === 'function') {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    }
    const nodeBuffer = (globalThis as any)?.Buffer;
    if (nodeBuffer && typeof nodeBuffer.from === 'function') {
      return nodeBuffer.from(payload, 'base64').toString('utf-8');
    }
  } catch (error) {
    console.warn('解码 dataUrl 失败', error);
  }
  return null;
}

async function fetchTextFromUrl(url: string): Promise<string> {
  if (typeof fetch === 'function') {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`请求失败 (${response.status})`);
    }
    return await response.text();
  }
  return await new Promise<string>((resolve, reject) => {
    uni.request({
      url,
      method: 'GET',
      success: (res) => {
        if (typeof res.data === 'string') {
          resolve(res.data);
        } else if (res.data != null) {
          resolve(JSON.stringify(res.data));
        } else {
          resolve('');
        }
      },
      fail: (err) => {
        reject(new Error(err?.errMsg || '网络请求失败'));
      },
    });
  });
}

function getPackageEntry(assetId: string, packageMap: Record<string, string>): { provider: string; value: string } | null {
  if (packageEntryCache.has(assetId)) {
    return packageEntryCache.get(assetId) ?? null;
  }
  let found: { provider: string; value: string } | null = null;
  for (const [key, rawValue] of Object.entries(packageMap)) {
    if (typeof rawValue !== 'string') {
      continue;
    }
    const separator = key.indexOf('::');
    if (separator === -1) {
      continue;
    }
    const provider = key.slice(0, separator);
    const id = key.slice(separator + 2);
    if (id === assetId) {
      found = { provider, value: rawValue };
      break;
    }
  }
  packageEntryCache.set(assetId, found);
  return found;
}

function resolvePackageEntryLike(assetId: string, provider: string, rawValue: string): AssetSourceResolution | null {
  const value = (rawValue ?? '').trim();
  if (!value.length) {
    return null;
  }
  if (value.startsWith('data:')) {
    return { kind: 'data-url', dataUrl: value };
  }
  if (/^(https?:)?\/\//i.test(value)) {
    return { kind: 'remote-url', url: value };
  }
  if (provider === 'preset') {
    const base = (previewPayload.value?.presetAssetBaseUrl || PRESET_ASSET_BASE_URL).replace(/\/$/, '');
    const normalized = value.replace(/^preset:/, '').replace(/^\/+/, '');
    return { kind: 'remote-url', url: `${base}/${normalized}` };
  }
  if (provider === 'local') {
    const buffer = base64ToArrayBuffer(value);
    if (buffer) {
      return { kind: 'raw', data: buffer };
    }
  }
  return { kind: 'inline-text', text: value };
}

function resolveAssetSourceFromIndex(assetId: string, packageMap: Record<string, string>): AssetSourceResolution | null {
  if (!currentDocument?.assetIndex) {
    return null;
  }
  const entry = (currentDocument.assetIndex as Record<string, any>)[assetId];
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const inline = typeof entry.inline === 'string' ? entry.inline.trim() : '';
  if (inline) {
    if (inline.startsWith('data:')) {
      return { kind: 'data-url', dataUrl: inline };
    }
    if (/^(https?:)?\/\//i.test(inline)) {
      return { kind: 'remote-url', url: inline };
    }
    return { kind: 'inline-text', text: inline };
  }
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (url) {
    return { kind: 'remote-url', url };
  }
  const source = entry.source;
  if (source && typeof source === 'object') {
    const sourceInline = typeof source.inline === 'string' ? source.inline.trim() : '';
    if (sourceInline) {
      if (sourceInline.startsWith('data:')) {
        return { kind: 'data-url', dataUrl: sourceInline };
      }
      if (/^(https?:)?\/\//i.test(sourceInline)) {
        return { kind: 'remote-url', url: sourceInline };
      }
      return { kind: 'inline-text', text: sourceInline };
    }
    const sourceUrl = typeof source.url === 'string' ? source.url.trim() : '';
    if (sourceUrl) {
      return { kind: 'remote-url', url: sourceUrl };
    }
    const providerId = typeof source.providerId === 'string' ? source.providerId.trim() : '';
    const originalAssetId = typeof source.originalAssetId === 'string' ? source.originalAssetId.trim() : assetId;
    const mapped = providerId ? packageMap[`${providerId}::${originalAssetId}`] : undefined;
    if (mapped && typeof mapped === 'string') {
      const resolved = resolvePackageEntryLike(originalAssetId, providerId, mapped);
      if (resolved) {
        return resolved;
      }
    }
  }
  return null;
}

function resolveAssetSource(assetId: string): AssetSourceResolution | null {
  const trimmed = assetId.trim();
  if (!trimmed.length) {
    return null;
  }
  if (/^(https?:)?\/\//i.test(trimmed)) {
    return { kind: 'remote-url', url: trimmed };
  }
  if (trimmed.startsWith('data:')) {
    return { kind: 'data-url', dataUrl: trimmed };
  }
  const overrides = previewPayload.value?.assetOverrides;
  const overrideValue = overrides?.[trimmed];
  if (overrideValue != null) {
    if (typeof overrideValue === 'string') {
      if (overrideValue.startsWith('data:')) {
        return { kind: 'data-url', dataUrl: overrideValue };
      }
      if (/^(https?:)?\/\//i.test(overrideValue)) {
        return { kind: 'remote-url', url: overrideValue };
      }
      const buffer = base64ToArrayBuffer(overrideValue);
      if (buffer) {
        return { kind: 'raw', data: buffer };
      }
      return { kind: 'inline-text', text: overrideValue };
    }
    if (overrideValue instanceof ArrayBuffer) {
      return { kind: 'raw', data: overrideValue };
    }
  }
  if (!currentDocument) {
    return null;
  }
  const packageMap = currentDocument.packageAssetMap ?? {};
  const direct = packageMap[trimmed];
  if (typeof direct === 'string' && direct.trim().length) {
    const resolved = resolvePackageEntryLike(trimmed, 'local', direct);
    if (resolved) {
      return resolved;
    }
  }
  const embedded = packageMap[`local::${trimmed}`];
  if (typeof embedded === 'string' && embedded.trim().length) {
    const resolved = resolvePackageEntryLike(trimmed, 'local', embedded);
    if (resolved) {
      return resolved;
    }
  }
  const packageEntry = getPackageEntry(trimmed, packageMap);
  if (packageEntry) {
    const resolved = resolvePackageEntryLike(trimmed, packageEntry.provider, packageEntry.value);
    if (resolved) {
      return resolved;
    }
  }
  const indexResolved = resolveAssetSourceFromIndex(trimmed, packageMap);
  if (indexResolved) {
    return indexResolved;
  }
  const resolveAssetUrl = previewPayload.value?.resolveAssetUrl;
  if (typeof resolveAssetUrl === 'function') {
    try {
      const maybe = resolveAssetUrl(trimmed);
      if (typeof maybe === 'string' && maybe.trim().length) {
        const normalized = maybe.trim();
        if (normalized.startsWith('data:')) {
          return { kind: 'data-url', dataUrl: normalized };
        }
        return { kind: 'remote-url', url: normalized };
      }
    } catch (error) {
      console.warn('resolveAssetUrl 调用失败', error);
    }
  }
  return null;
}

function inferMimeTypeFromAssetId(assetId: string): string | null {
  const lower = assetId.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  return null;
}

function getOrCreateObjectUrl(assetId: string, data: ArrayBuffer, mimeHint?: string): string {
  const cached = assetObjectUrlCache.get(assetId);
  if (cached) {
    return cached;
  }
  const mimeType = mimeHint ?? inferMimeTypeFromAssetId(assetId) ?? 'application/octet-stream';
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  assetObjectUrlCache.set(assetId, url);
  return url;
}

function clearAssetObjectUrlCache(): void {
  assetObjectUrlCache.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn('释放资源 URL 失败', error);
    }
  });
  assetObjectUrlCache.clear();
}

function resetAssetResolutionCaches(): void {
  clearAssetObjectUrlCache();
  packageEntryCache.clear();
}

async function loadTextAssetContent(assetId: string): Promise<string | null> {
  const trimmed = assetId.trim();
  if (!trimmed.length) {
    return null;
  }
  const source = resolveAssetSource(trimmed);
  if (!source) {
    return null;
  }
  switch (source.kind) {
    case 'inline-text':
      return source.text;
    case 'data-url':
      return decodeDataUrlText(source.dataUrl);
    case 'remote-url':
      return await fetchTextFromUrl(source.url);
    case 'raw':
      try {
        return new TextDecoder().decode(source.data);
      } catch (error) {
        console.warn('解码文本 ArrayBuffer 失败', error);
        return null;
      }
    default:
      return null;
  }
}

function resolveLanternImageSource(assetId: string | null | undefined): string | null {
  if (!assetId) {
    return null;
  }
  const source = resolveAssetSource(assetId);
  if (!source) {
    return null;
  }
  switch (source.kind) {
    case 'data-url':
      return source.dataUrl;
    case 'remote-url':
      return source.url;
    case 'raw':
      return getOrCreateObjectUrl(assetId, source.data, inferMimeTypeFromAssetId(assetId) ?? undefined);
    default:
      return null;
  }
}

function resetLanternOverlay(): void {
  lanternOverlayVisible.value = false;
  lanternSlides.value = [];
  lanternActiveSlideIndex.value = 0;
  lanternEventToken.value = null;
}

function closeLanternOverlay(resolution?: BehaviorEventResolution): void {
  const token = lanternEventToken.value;
  resetLanternOverlay();
  if (token && resolution) {
    resolveBehaviorToken(token, resolution);
  }
}

function presentLanternSlides(event: Extract<BehaviorRuntimeEvent, { type: 'lantern' }>): void {
  const slides = Array.isArray(event.params?.slides) ? event.params.slides : [];
  if (!slides.length) {
    resolveBehaviorToken(event.token, { type: 'continue' });
    return;
  }
  if (lanternEventToken.value && lanternEventToken.value !== event.token) {
    closeLanternOverlay({ type: 'abort', message: '新的幻灯片事件覆盖了当前事件' });
  }
  lanternSlides.value = slides;
  lanternActiveSlideIndex.value = 0;
  lanternEventToken.value = event.token;
  lanternOverlayVisible.value = true;
}

function showPreviousLanternSlide(): void {
  if (lanternActiveSlideIndex.value > 0) {
    lanternActiveSlideIndex.value -= 1;
  }
}

function showNextLanternSlide(): void {
  if (lanternActiveSlideIndex.value < lanternSlides.value.length - 1) {
    lanternActiveSlideIndex.value += 1;
  }
}

function confirmLanternOverlay(): void {
  closeLanternOverlay({ type: 'continue' });
}

function cancelLanternOverlay(): void {
  closeLanternOverlay({ type: 'abort', message: '用户退出了幻灯片' });
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}

function clearBehaviorAlert() {
  behaviorAlertVisible.value = false;
  behaviorAlertTitle.value = '';
  behaviorAlertMessage.value = '';
  behaviorAlertToken.value = null;
  behaviorAlertShowConfirm.value = true;
  behaviorAlertShowCancel.value = false;
  behaviorAlertConfirmText.value = '确定';
  behaviorAlertCancelText.value = '取消';
}

async function loadBehaviorAlertContent(assetId: string, token: string, fallback: string): Promise<void> {
  try {
    const content = await loadTextAssetContent(assetId);
    if (behaviorAlertToken.value !== token) {
      return;
    }
    behaviorAlertMessage.value = content ?? fallback;
  } catch (error) {
    console.warn('加载行为弹窗文本失败', error);
    if (behaviorAlertToken.value === token) {
      behaviorAlertMessage.value = fallback;
    }
  }
}

function presentBehaviorAlert(event: Extract<BehaviorRuntimeEvent, { type: 'show-alert' }>) {
  clearBehaviorAlert();
  behaviorAlertToken.value = event.token;
  const legacyParams = event.params as typeof event.params & { title?: string; message?: string };
  const anyParams = event.params as unknown as Record<string, unknown>;
  const rawTitle = typeof anyParams.title === 'string' ? anyParams.title : legacyParams.title;
  const title = typeof rawTitle === 'string' && rawTitle.trim().length ? rawTitle.trim() : '提示';
  const legacyMessage = typeof legacyParams.message === 'string' ? legacyParams.message : '';
  const contentParam = typeof anyParams.content === 'string' ? (anyParams.content as string) : undefined;
  const messageFallback = typeof contentParam === 'string' ? contentParam : legacyMessage;
  behaviorAlertTitle.value = title;
  behaviorAlertMessage.value = messageFallback;
  behaviorAlertShowConfirm.value = event.params.showConfirm ?? true;
  behaviorAlertShowCancel.value = event.params.showCancel ?? false;
  behaviorAlertConfirmText.value = (event.params.confirmText ?? '确定') || '确定';
  behaviorAlertCancelText.value = (event.params.cancelText ?? '取消') || '取消';
  const contentAssetId = (event.params as { contentAssetId?: string | null }).contentAssetId;
  if (typeof contentAssetId === 'string' && contentAssetId.trim().length) {
    void loadBehaviorAlertContent(contentAssetId.trim(), event.token, messageFallback);
  }
  if (!behaviorAlertShowConfirm.value && !behaviorAlertShowCancel.value) {
    resolveBehaviorToken(event.token, { type: 'continue' });
    return;
  }
  behaviorAlertVisible.value = true;
}

function confirmBehaviorAlert() {
  const token = behaviorAlertToken.value;
  clearBehaviorAlert();
  if (!token) {
    return;
  }
  resolveBehaviorToken(token, { type: 'continue' });
}

function cancelBehaviorAlert() {
  const token = behaviorAlertToken.value;
  clearBehaviorAlert();
  if (!token) {
    return;
  }
  resolveBehaviorToken(token, { type: 'abort', message: '用户取消了提示框' });
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

function resolveSceneSkybox(document: SceneJsonExportDocument | null | undefined): SceneSkyboxSettings | null {
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

function resolveNodeIdFromObject(object: THREE.Object3D | null | undefined): string | null {
  let current: THREE.Object3D | null | undefined = object ?? null;
  while (current) {
    const nodeId = current.userData?.nodeId as string | undefined;
    if (nodeId) {
      return nodeId;
    }
    current = current.parent;
  }
  return null;
}

function processBehaviorEvents(events: BehaviorRuntimeEvent[] | BehaviorRuntimeEvent | null | undefined): void {
  if (!events) {
    return;
  }
  const list = Array.isArray(events) ? events : [events];
  list.forEach((entry) => handleBehaviorRuntimeEvent(entry));
}

function resolveBehaviorToken(token: string, resolution: BehaviorEventResolution): void {
  clearDelayTimer(token);
  stopBehaviorAnimation(token);
  const followUps = resolveBehaviorEvent(token, resolution);
  processBehaviorEvents(followUps);
}

function clearDelayTimer(token: string): void {
  const handle = activeBehaviorDelayTimers.get(token);
  if (handle != null) {
    clearTimeout(handle);
    activeBehaviorDelayTimers.delete(token);
  }
}

function stopBehaviorAnimation(token: string): void {
  const cancel = activeBehaviorAnimations.get(token);
  if (!cancel) {
    return;
  }
  try {
    cancel();
  } finally {
    activeBehaviorAnimations.delete(token);
  }
}

function startTimedAnimation(
  token: string,
  durationSeconds: number,
  onUpdate: (alpha: number) => void,
  onComplete: () => void,
): void {
  stopBehaviorAnimation(token);
  const durationMs = Math.max(0, durationSeconds) * 1000;
  if (durationMs <= 0) {
    onUpdate(1);
    onComplete();
    return;
  }
  const startTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : ((callback: FrameRequestCallback) => {
        return setTimeout(() => callback(Date.now()), 16) as unknown as number;
      });
  const cancelRaf = typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : ((handle: number) => clearTimeout(handle));
  let frameHandle: number | null = null;
  const cancel = () => {
    if (frameHandle != null) {
      cancelRaf(frameHandle);
      frameHandle = null;
    }
    activeBehaviorAnimations.delete(token);
  };
  const step = (timestamp: number) => {
    const now = Number.isFinite(timestamp) ? timestamp : (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    const elapsed = Math.max(0, now - startTime);
    const alpha = Math.min(1, elapsed / durationMs);
    onUpdate(alpha);
    if (alpha >= 1) {
      cancel();
      onComplete();
      return;
    }
    frameHandle = raf(step);
  };
  frameHandle = raf(step);
  activeBehaviorAnimations.set(token, cancel);
}

function resolveNodeFocusPoint(nodeId: string | null | undefined): THREE.Vector3 | null {
  if (!nodeId) {
    return null;
  }
  const object = nodeObjectMap.get(nodeId);
  if (!object) {
    return null;
  }
  tempBox.setFromObject(object);
  const hasFiniteBounds = [tempBox.min.x, tempBox.min.y, tempBox.min.z, tempBox.max.x, tempBox.max.y, tempBox.max.z].every((value) => Number.isFinite(value));
  if (!hasFiniteBounds) {
    object.getWorldPosition(tempVector);
    return tempVector.clone();
  }
  tempBox.getBoundingSphere(tempSphere);
  if (!Number.isFinite(tempSphere.center.x) || !Number.isFinite(tempSphere.center.y) || !Number.isFinite(tempSphere.center.z)) {
    object.getWorldPosition(tempVector);
    return tempVector.clone();
  }
  return tempSphere.center.clone();
}

function resetBehaviorProximity(): void {
  behaviorProximityCandidates.clear();
  behaviorProximityState.clear();
  behaviorProximityThresholdCache.clear();
}

function removeBehaviorProximityCandidate(nodeId: string): void {
  behaviorProximityCandidates.delete(nodeId);
  behaviorProximityState.delete(nodeId);
  behaviorProximityThresholdCache.delete(nodeId);
}

function ensureBehaviorProximityState(nodeId: string): void {
  if (!behaviorProximityState.has(nodeId)) {
    behaviorProximityState.set(nodeId, { inside: false, lastDistance: null });
  }
}

function syncBehaviorProximityCandidate(nodeId: string): void {
  if (!previewNodeMap.has(nodeId)) {
    removeBehaviorProximityCandidate(nodeId);
    return;
  }
  const actions = listRegisteredBehaviorActions(nodeId);
  const hasApproach = actions.includes('approach');
  const hasDepart = actions.includes('depart');
  if (!hasApproach && !hasDepart) {
    removeBehaviorProximityCandidate(nodeId);
    return;
  }
  behaviorProximityCandidates.set(nodeId, { hasApproach, hasDepart });
  ensureBehaviorProximityState(nodeId);
}

function refreshBehaviorProximityCandidates(): void {
  resetBehaviorProximity();
  previewNodeMap.forEach((_node, nodeId) => {
    syncBehaviorProximityCandidate(nodeId);
  });
}

const behaviorRuntimeListener: BehaviorRuntimeListener = {
  onRegistryChanged(nodeId) {
    syncBehaviorProximityCandidate(nodeId);
  },
};

function computeObjectBoundingRadius(object: THREE.Object3D): number {
  tempBox.setFromObject(object);
  const hasFiniteBounds = [tempBox.min.x, tempBox.min.y, tempBox.min.z, tempBox.max.x, tempBox.max.y, tempBox.max.z].every((value) => Number.isFinite(value));
  if (!hasFiniteBounds) {
    return DEFAULT_OBJECT_RADIUS;
  }
  tempBox.getBoundingSphere(tempSphere);
  return Number.isFinite(tempSphere.radius) && tempSphere.radius > 0 ? tempSphere.radius : DEFAULT_OBJECT_RADIUS;
}

function resolveProximityThresholds(nodeId: string, object: THREE.Object3D): BehaviorProximityThreshold {
  const cached = behaviorProximityThresholdCache.get(nodeId);
  if (cached && cached.objectId === object.uuid) {
    return cached;
  }
  const radius = computeObjectBoundingRadius(object);
  const enter = Math.max(PROXIMITY_MIN_DISTANCE, radius * PROXIMITY_RADIUS_SCALE);
  const exit = enter + PROXIMITY_EXIT_PADDING;
  const nextThreshold: BehaviorProximityThreshold = {
    enter,
    exit,
    objectId: object.uuid,
  };
  behaviorProximityThresholdCache.set(nodeId, nextThreshold);
  return nextThreshold;
}

function updateBehaviorProximity(): void {
  const camera = renderContext?.camera;
  if (!camera || !behaviorProximityCandidates.size) {
    return;
  }
  const cameraPosition = camera.position;
  behaviorProximityCandidates.forEach((candidate, nodeId) => {
    const object = nodeObjectMap.get(nodeId);
    if (!object) {
      return;
    }
    const thresholds = resolveProximityThresholds(nodeId, object);
    const state = behaviorProximityState.get(nodeId);
    if (!state) {
      return;
    }
    const focusPoint = resolveNodeFocusPoint(nodeId) ?? object.getWorldPosition(tempVector);
    const distance = focusPoint.distanceTo(cameraPosition);
    if (!Number.isFinite(distance)) {
      return;
    }
    if (!state.inside && distance <= thresholds.enter) {
      state.inside = true;
      if (candidate.hasApproach) {
        const followUps = triggerBehaviorAction(nodeId, 'approach', {
          payload: {
            distance,
            threshold: thresholds.enter,
          },
        });
        processBehaviorEvents(followUps);
      }
    } else if (state.inside && distance >= thresholds.exit) {
      state.inside = false;
      if (candidate.hasDepart) {
        const followUps = triggerBehaviorAction(nodeId, 'depart', {
          payload: {
            distance,
            threshold: thresholds.exit,
          },
        });
        processBehaviorEvents(followUps);
      }
    }
    state.lastDistance = distance;
  });
}

function resetAnimationControllers(): void {
  activeBehaviorAnimations.forEach((cancel) => {
    try {
      cancel();
    } catch (error) {
      console.warn('取消行为动画失败', error);
    }
  });
  activeBehaviorAnimations.clear();
  animationMixers.forEach((mixer) => {
    try {
      mixer.stopAllAction();
      const root = mixer.getRoot();
      if (root) {
        mixer.uncacheRoot(root);
      }
    } catch (error) {
      console.warn('重置动画控制器失败', error);
    }
  });
  animationMixers = [];
  nodeAnimationControllers.clear();
}

function refreshAnimationControllers(root: THREE.Object3D): void {
  resetAnimationControllers();
  const mixers: THREE.AnimationMixer[] = [];
  root.traverse((object) => {
    const nodeId = object.userData?.nodeId as string | undefined;
    if (!nodeId) {
      return;
    }
    const clips = (object as unknown as { animations?: THREE.AnimationClip[] }).animations;
    if (!Array.isArray(clips) || !clips.length) {
      return;
    }
    const validClips = clips.filter((clip): clip is THREE.AnimationClip => Boolean(clip));
    if (!validClips.length) {
      return;
    }
    const mixer = new THREE.AnimationMixer(object);
    mixer.timeScale = 1;
    mixers.push(mixer);
    nodeAnimationControllers.set(nodeId, { mixer, clips: validClips });
  });
  animationMixers = mixers;
}

function handleDelayEvent(event: Extract<BehaviorRuntimeEvent, { type: 'delay' }>) {
  clearDelayTimer(event.token);
  const durationMs = Math.max(0, event.seconds) * 1000;
  const handle = setTimeout(() => {
    activeBehaviorDelayTimers.delete(event.token);
    resolveBehaviorToken(event.token, { type: 'continue' });
  }, durationMs);
  activeBehaviorDelayTimers.set(event.token, handle);
}

function handleMoveCameraEvent(event: Extract<BehaviorRuntimeEvent, { type: 'move-camera' }>) {
  const context = renderContext;
  if (!context) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '相机不可用' });
    return;
  }
  const { camera, controls } = context;
  const focus = resolveNodeFocusPoint(event.targetNodeId ?? event.nodeId);
  if (!focus) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '未找到目标节点' });
    return;
  }

  const focusPoint = focus.clone();
  const ownerObject = nodeObjectMap.get(event.targetNodeId ?? event.nodeId ?? '');
  if (ownerObject) {
    ownerObject.getWorldQuaternion(tempQuaternion);
  } else {
    tempQuaternion.identity();
  }
  const horizontalOffset = Math.max(event.offset ?? 0, 0);
  const destination = focusPoint.clone();
  if (horizontalOffset > 0) {
    tempVector.copy(camera.position).sub(focusPoint);
    tempVector.y = 0;
    if (tempVector.lengthSq() < 1e-6) {
      tempVector.set(0, 0, 1);
      tempVector.applyQuaternion(tempQuaternion);
      tempVector.y = 0;
    }
    if (tempVector.lengthSq() < 1e-6) {
      tempVector.set(0, 0, 1);
    }
    tempVector.normalize().multiplyScalar(horizontalOffset);
    destination.add(tempVector);
  }
  destination.y = HUMAN_EYE_HEIGHT;
  const lookTarget = new THREE.Vector3(focusPoint.x, HUMAN_EYE_HEIGHT, focusPoint.z);

  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const distance = startPosition.distanceTo(destination);
  const durationSeconds = event.speed > 0 ? Math.min(5, Math.max(0.2, distance / Math.max(event.speed, 0.01))) : 0;
  
  const updateFrame = (alpha: number) => {
    camera.position.lerpVectors(startPosition, destination, alpha);
    controls.target.lerpVectors(startTarget, lookTarget, alpha);
    controls.update();
  };
  const finalize = () => {
    camera.position.copy(destination);
    controls.target.copy(lookTarget);
    controls.update();
    resolveBehaviorToken(event.token, { type: 'continue' });
  };
  startTimedAnimation(event.token, durationSeconds, updateFrame, finalize);
}

function handleSetVisibilityEvent(event: Extract<BehaviorRuntimeEvent, { type: 'set-visibility' }>) {
  const object = nodeObjectMap.get(event.targetNodeId);
  if (object) {
    object.visible = event.visible;
  }
  const node = resolveNodeById(event.targetNodeId);
  if (node) {
    node.visible = event.visible;
  }
}

function handlePlayAnimationEvent(event: Extract<BehaviorRuntimeEvent, { type: 'play-animation' }>) {
  const targetNodeId = event.targetNodeId || event.nodeId;
  if (!targetNodeId) {
    if (event.token) {
      resolveBehaviorToken(event.token, { type: 'fail', message: '缺少动画目标' });
    }
    console.warn('播放动画失败：未提供节点 ID');
    return;
  }
  const controller = nodeAnimationControllers.get(targetNodeId);
  if (!controller) {
    if (event.token) {
      resolveBehaviorToken(event.token, { type: 'fail', message: '目标节点没有动画' });
    }
    console.warn('播放动画失败：目标节点未暴露动画', { targetNodeId });
    return;
  }
  const clips = controller.clips;
  const requestedName = event.clipName && event.clipName.trim().length ? event.clipName.trim() : null;
  const clip = requestedName ? clips.find((entry) => entry.name === requestedName) : clips[0] ?? null;
  if (!clip) {
    if (event.token) {
      resolveBehaviorToken(event.token, {
        type: 'fail',
        message: requestedName ? `未找到动画片段 ${requestedName}` : '没有可用的动画片段',
      });
    }
    console.warn('播放动画失败：未找到片段', { targetNodeId, requestedName });
    return;
  }
  const mixer = controller.mixer;
  const action = mixer.clipAction(clip);
  mixer.stopAllAction();
  action.reset();
  action.enabled = true;
  if (event.loop) {
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    action.clampWhenFinished = false;
  } else {
    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
  }
  action.play();
  const token = event.token;
  if (!token) {
    return;
  }
  stopBehaviorAnimation(token);
  if (event.loop) {
    resolveBehaviorToken(token, { type: 'continue' });
    return;
  }
  if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
    resolveBehaviorToken(token, { type: 'continue' });
    return;
  }
  const onFinished = (payload: THREE.Event & { action?: THREE.AnimationAction }) => {
    if (payload.action !== action) {
      return;
    }
    mixer.removeEventListener('finished', onFinished);
    activeBehaviorAnimations.delete(token);
    resolveBehaviorToken(token, { type: 'continue' });
  };
  const cancel = () => {
    mixer.removeEventListener('finished', onFinished);
    try {
      action.stop();
    } catch (error) {
      console.warn('停止动画失败', error);
    }
  };
  activeBehaviorAnimations.set(token, cancel);
  mixer.addEventListener('finished', onFinished);
}

function handleTriggerBehaviorEvent(event: Extract<BehaviorRuntimeEvent, { type: 'trigger-behavior' }>) {
  const targetNodeId = event.targetNodeId || event.nodeId;
  if (!targetNodeId) {
    console.warn('触发行为失败：未提供目标节点');
    return;
  }
  const sequenceId = event.targetSequenceId && event.targetSequenceId.trim().length ? event.targetSequenceId : undefined;
  const followUps = triggerBehaviorAction(
    targetNodeId,
    'perform',
    {
      payload: {
        sourceNodeId: event.nodeId,
      },
    },
    sequenceId ? { sequenceId } : {},
  );
  processBehaviorEvents(followUps);
}

function handleWatchNodeEvent(event: Extract<BehaviorRuntimeEvent, { type: 'watch-node' }>) {
  const context = renderContext;
  if (!context) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '相机不可用' });
    return;
  }
  const { camera, controls } = context;
  const focus = resolveNodeFocusPoint(event.targetNodeId);
  if (!focus) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '未找到目标节点' });
    return;
  }
  controls.target.copy(focus);
  camera.lookAt(focus);
  controls.update();
  resolveBehaviorToken(event.token, { type: 'continue' });
}

function handleLookLevelEvent(event: Extract<BehaviorRuntimeEvent, { type: 'look-level' }>) {
  const context = renderContext;
  if (!context) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '相机不可用' });
    return;
  }
  const { camera, controls } = context;
  const lookTarget = controls.target.clone();
  lookTarget.y = camera.position.y;
  controls.target.copy(lookTarget);
  camera.lookAt(lookTarget);
  controls.update();
  resolveBehaviorToken(event.token, { type: 'continue' });
}

function handleBehaviorRuntimeEvent(event: BehaviorRuntimeEvent) {
  switch (event.type) {
    case 'delay':
      handleDelayEvent(event);
      break;
    case 'move-camera':
      handleMoveCameraEvent(event);
      break;
    case 'show-alert':
      presentBehaviorAlert(event);
      break;
    case 'lantern':
      presentLanternSlides(event);
      break;
    case 'play-animation':
      handlePlayAnimationEvent(event);
      break;
    case 'trigger-behavior':
      handleTriggerBehaviorEvent(event);
      break;
    case 'watch-node':
      handleWatchNodeEvent(event);
      break;
    case 'set-visibility':
      handleSetVisibilityEvent(event);
      break;
    case 'look-level':
      handleLookLevelEvent(event);
      break;
    case 'sequence-complete':
      clearBehaviorAlert();
      resetLanternOverlay();
      if (event.status === 'failure' || event.status === 'aborted') {
        console.warn('行为序列结束', event);
      }
      break;
    case 'sequence-error':
      clearBehaviorAlert();
      resetLanternOverlay();
      console.error('行为序列执行出错', event.message);
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
    if (!hasRegisteredBehaviors()) {
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
      const nodeId = resolveNodeIdFromObject(intersection.object);
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
        pointerEvent: event,
      });
      processBehaviorEvents(results);
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

function decodeBase64(value: string): string | null {
  const normalized = value.replace(/^data:[^,]+,/, '');
  try {
    if (typeof atob === 'function') {
      return atob(normalized);
    }
    const globalBuffer = typeof globalThis !== 'undefined' ? (globalThis as any).Buffer : undefined;
    if (globalBuffer && typeof globalBuffer.from === 'function') {
      return globalBuffer.from(normalized, 'base64').toString('utf-8');
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function parseInlineSceneDocument(raw: string): SceneJsonExportDocument {
  const candidates = new Set<string>();
  const pushCandidate = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }
    const trimmed = candidate.trim();
    if (!trimmed.length) {
      return;
    }
    candidates.add(trimmed);
  };
  pushCandidate(raw);
  try {
    pushCandidate(decodeURIComponent(raw));
  } catch (_error) {
    // ignore
  }
  const base64 = decodeBase64(raw);
  pushCandidate(base64);
  if (base64) {
    try {
      pushCandidate(decodeURIComponent(base64));
    } catch (_error) {
      // ignore
    }
  }
  for (const candidate of candidates) {
    try {
      return parseSceneDocument(candidate);
    } catch (_error) {
      continue;
    }
  }
  throw new Error('无法解析场景数据');
}

function createModelPreviewPayload(args: { url: string; name?: string; assetId?: string }): ScenePreviewPayload {
  const assetUrl = args.url?.trim();
  if (!assetUrl) {
    throw new Error('模型地址不能为空');
  }
  const normalizedAssetId = args.assetId && args.assetId.trim().length ? args.assetId.trim() : assetUrl;
  const now = new Date().toISOString();
  const title = args.name && args.name.trim().length ? args.name.trim() : '模型预览';
  const nodeId = `model-${Math.random().toString(36).slice(2, 10)}`;
  const document: SceneJsonExportDocument = {
    id: `model-preview-${Date.now().toString(36)}`,
    name: title,
    createdAt: now,
    updatedAt: now,
    skybox: sanitizeSkyboxSettings(DEFAULT_SKYBOX_SETTINGS),
    nodes: [
      {
        id: nodeId,
        name: title,
        nodeType: 'Mesh',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        sourceAssetId: normalizedAssetId,
        visible: true,
        children: [],
      },
    ],
    materials: [],
    packageAssetMap: {},
  };
  return {
    document,
    title,
    assetOverrides: { [normalizedAssetId]: assetUrl },
    enableGround: false,
  };
}

function createPayloadFromEntry(entry: StoredSceneEntry): ScenePreviewPayload {
  const document = entry.scene;
  return {
    document,
    title: document.name || '场景预览',
    origin: entry.origin,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

watch(sceneEntry, (entry) => {
  if (requestedMode.value !== 'store') {
    return;
  }
  if (!entry) {
    previewPayload.value = null;
    if (bootstrapFinished.value) {
      error.value = '未找到对应的场景数据';
      loading.value = false;
    }
    return;
  }
  loading.value = true;
  previewPayload.value = createPayloadFromEntry(entry);
});

watch(
  previewPayload,
  (payload) => {
    if (!bootstrapFinished.value) {
      return;
    }
    if (!payload) {
      teardownRenderer();
      applySkyboxSettings(null);
      warnings.value = [];
      return;
    }
    handlePreviewPayload(payload);
  },
  { flush: 'post' },
);

function handlePreviewPayload(payload: ScenePreviewPayload | null) {
  if (!payload) {
    teardownRenderer();
    applySkyboxSettings(null);
    warnings.value = [];
    return;
  }
  error.value = null;
  warnings.value = [];
  const skyboxSettings = resolveSceneSkybox(payload.document);
  applySkyboxSettings(skyboxSettings);
  try {
    uni.setNavigationBarTitle({ title: payload.title || '场景预览' });
  } catch (_error) {
    // ignore
  }
  startRenderIfReady();
}

async function startRenderIfReady() {
  if (!previewPayload.value || !canvasResult || initializing) {
    return;
  }
  initializing = true;
  loading.value = true;
  error.value = null;
  warnings.value = [];
  try {
    await ensureRendererContext(canvasResult);
    await initializeRenderer(previewPayload.value, canvasResult);
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

function translateCamera(forwardDelta: number, rightDelta: number): void {
  if (!renderContext) {
    return;
  }
  const { camera, controls } = renderContext;
  tempForwardVec.copy(controls.target).sub(camera.position);
  tempForwardVec.y = 0;
  if (tempForwardVec.lengthSq() < 1e-6) {
    tempForwardVec.set(0, 0, -1);
  } else {
    tempForwardVec.normalize();
  }
  tempRightVec.copy(tempForwardVec).cross(worldUp);
  if (tempRightVec.lengthSq() < 1e-6) {
    tempRightVec.set(1, 0, 0);
  } else {
    tempRightVec.normalize();
  }
  tempMovementVec.set(0, 0, 0);
  if (forwardDelta) {
    tempMovementVec.addScaledVector(tempForwardVec, forwardDelta);
  }
  if (rightDelta) {
    tempMovementVec.addScaledVector(tempRightVec, rightDelta);
  }
  if (tempMovementVec.lengthSq() === 0) {
    return;
  }
  camera.position.add(tempMovementVec);
  controls.target.add(tempMovementVec);
}

function setupWheelControls(canvas: any): void {
  teardownWheelControls();
  if (!canvas || typeof canvas.addEventListener !== 'function') {
    return;
  }
  const listener = (event: WheelEvent) => handleWheelEvent(event);
  canvas.addEventListener('wheel', listener, { passive: false });
  wheelListenerCleanup = () => {
    canvas.removeEventListener('wheel', listener);
    wheelListenerCleanup = null;
  };
}

function teardownWheelControls(): void {
  if (wheelListenerCleanup) {
    wheelListenerCleanup();
    wheelListenerCleanup = null;
  }
}

function handleWheelEvent(event: WheelEvent): void {
  if (!renderContext) {
    return;
  }
  event.preventDefault?.();
  const deltaY = event.deltaY || 0;
  if (!deltaY) {
    return;
  }
  const direction = deltaY < 0 ? 1 : -1;
  const magnitude = Math.min(Math.abs(deltaY) / 120, 3) || 1;
  translateCamera(direction * WHEEL_MOVE_STEP * magnitude, 0);
  renderContext.controls.update();
}

function teardownRenderer() {
  teardownWheelControls();
  if (!renderContext) {
    return;
  }
  const { renderer, scene, controls } = renderContext;
  if (canvasResult?.canvas && behaviorTapListener) {
    canvasResult.canvas.removeEventListener('touchend', behaviorTapListener);
    behaviorTapListener = null;
  }
  if (behaviorAlertToken.value) {
    resolveBehaviorToken(behaviorAlertToken.value, {
      type: 'abort',
      message: '视图卸载',
    });
  }
  clearBehaviorAlert();
  if (lanternEventToken.value) {
    closeLanternOverlay({ type: 'abort', message: '视图卸载' });
  } else {
    resetLanternOverlay();
  }
  previewComponentManager.reset();
  resetBehaviorRuntime();
  resetBehaviorProximity();
  activeBehaviorDelayTimers.forEach((handle) => clearTimeout(handle));
  activeBehaviorDelayTimers.clear();
  resetAnimationControllers();
  previewNodeMap.clear();
  nodeObjectMap.clear();
  controls.dispose();
  disposeSkyResources();
  pmremGenerator?.dispose();
  pmremGenerator = null;
  pendingSkyboxSettings = null;
  lanternTextPromises.clear();
  Object.keys(lanternTextState).forEach((key) => delete lanternTextState[key]);
  resetAssetResolutionCaches();
  disposeObject(scene);
  renderer.dispose();
  renderContext = null;
  canvasResult = null;
  currentDocument = null;
}

function handleUseCanvas(result: UseCanvasResult) {
  canvasResult = result;
  startRenderIfReady();
}

async function ensureRendererContext(result: UseCanvasResult) {
  if (renderContext) {
    teardownRenderer();
  }
  await result.recomputeSize?.();
  const { canvas } = result;
  const pixelRatio =
    result.canvas?.ownerDocument?.defaultView?.devicePixelRatio || uni.getSystemInfoSync().pixelRatio || 1;
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
  camera.position.set(0, HUMAN_EYE_HEIGHT, 0);
  camera.lookAt(0, HUMAN_EYE_HEIGHT, -CAMERA_FORWARD_OFFSET);

  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, HUMAN_EYE_HEIGHT, -CAMERA_FORWARD_OFFSET);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.screenSpacePanning = false;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  const horizon = Math.PI / 2;
  controls.minPolarAngle = Math.max(0, horizon - CAMERA_MAX_LOOK_UP);
  controls.maxPolarAngle = Math.min(Math.PI, horizon + CAMERA_MAX_LOOK_DOWN);
  controls.minDistance = CAMERA_FORWARD_OFFSET;
  controls.maxDistance = CAMERA_FORWARD_OFFSET;

  controls.update();
  setupWheelControls(canvas);

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

async function initializeRenderer(payload: ScenePreviewPayload, result: UseCanvasResult) {
  if (!renderContext) {
    throw new Error('Render context missing');
  }
  const { scene, renderer, camera, controls } = renderContext;
  const { canvas } = result;
  currentDocument = payload.document;
  resetAssetResolutionCaches();
  if (behaviorAlertToken.value) {
    resolveBehaviorToken(behaviorAlertToken.value, {
      type: 'abort',
      message: '场景重新初始化',
    });
  }
  clearBehaviorAlert();
  if (lanternEventToken.value) {
    closeLanternOverlay({ type: 'abort', message: '场景重新初始化' });
  } else {
    resetLanternOverlay();
  }
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
    const buildOptions: SceneGraphBuildOptions = {
      enableGround: payload.enableGround ?? true,
      presetAssetBaseUrl: payload.presetAssetBaseUrl || PRESET_ASSET_BASE_URL,
      onProgress: (info) => {
        resourcePreload.total = info.total;
        resourcePreload.loaded = info.loaded;
        resourcePreload.label = info.message || (info.assetId ? `加载 ${info.assetId}` : '');
        resourcePreload.active = info.total > 0 && info.loaded < info.total;
      },
    };
    if (payload.assetOverrides) {
      buildOptions.assetOverrides = payload.assetOverrides;
    }
    if (payload.resolveAssetUrl) {
      buildOptions.resolveAssetUrl = payload.resolveAssetUrl;
    }
    graph = await buildSceneGraph(payload.document, buildOptions);
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
  rebuildPreviewNodeMap(payload.document.nodes);
  previewComponentManager.syncScene(payload.document.nodes ?? []);
  indexSceneObjects(graph.root);
  refreshBehaviorProximityCandidates();
  refreshAnimationControllers(graph.root);
  ensureBehaviorTapHandler(canvas as HTMLCanvasElement, camera);


  const skyboxSettings = resolveSceneSkybox(payload.document);
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
      const { cancel } = result.useFrame((delta) => {
        controls.update();
        animationMixers.forEach((mixer) => mixer.update(delta));
        updateBehaviorProximity();
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

function handleBack() {
  uni.navigateBack({ delta: 1 });
}

onLoad((query) => {
  addBehaviorRuntimeListener(behaviorRuntimeListener);
  const sceneIdParam = typeof query?.id === 'string' ? query.id : '';
  const documentParam = typeof query?.document === 'string' ? query.document : '';
  const modelParam =
    typeof query?.asset === 'string'
      ? query.asset
      : typeof query?.model === 'string'
        ? query.model
        : '';

  error.value = null;

  if (sceneIdParam) {
    requestedMode.value = 'store';
    currentSceneId.value = sceneIdParam;
    sceneStore.bootstrap();
    loading.value = true;
  } else if (documentParam) {
    requestedMode.value = 'document';
    try {
      const document = parseInlineSceneDocument(documentParam);
      const titleParam = typeof query?.title === 'string' ? query.title : '';
      const originParam = typeof query?.origin === 'string' ? query.origin : '';
      previewPayload.value = {
        document,
        title: titleParam && titleParam.trim().length ? titleParam.trim() : document.name || '场景预览',
        origin: originParam && originParam.trim().length ? originParam.trim() : undefined,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      };
      loading.value = true;
    } catch (parseError) {
      console.error(parseError);
      error.value = parseError instanceof Error ? parseError.message : '场景数据解析失败';
      loading.value = false;
    }
  } else if (modelParam) {
    requestedMode.value = 'model';
    try {
      const nameParam = typeof query?.name === 'string' ? query.name : '';
      const assetIdParam = typeof query?.assetId === 'string' ? query.assetId : '';
      previewPayload.value = createModelPreviewPayload({
        url: modelParam,
        name: nameParam,
        assetId: assetIdParam,
      });
      loading.value = true;
    } catch (modelError) {
      console.error(modelError);
      error.value = modelError instanceof Error ? modelError.message : '模型数据解析失败';
      loading.value = false;
    }
  } else {
    requestedMode.value = null;
    error.value = '缺少场景数据';
    loading.value = false;
  }

  bootstrapFinished.value = true;
  if (previewPayload.value) {
    handlePreviewPayload(previewPayload.value);
  } else if (requestedMode.value !== 'store') {
    teardownRenderer();
    applySkyboxSettings(null);
  }
});

onReady(() => {
  if (!resizeListener) {
    resizeListener = handleResize;
    uni.onWindowResize(handleResize);
  }
});

onUnload(() => {
  removeBehaviorRuntimeListener(behaviorRuntimeListener);
  teardownRenderer();
  if (resizeListener) {
    uni.offWindowResize(handleResize);
    resizeListener = null;
  }
});

onUnmounted(() => {
  removeBehaviorRuntimeListener(behaviorRuntimeListener);
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
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.viewer-behavior-title {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
  font-weight: 600;
}

.viewer-behavior-message {
  max-height: 180px;
  font-size: 14px;
  opacity: 0.9;
  text-align: left;
}

.viewer-behavior-message text {
  display: block;
  line-height: 1.5;
}

.viewer-behavior-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.viewer-behavior-button {
  padding: 8px 14px;
  border: none;
  border-radius: 18px;
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
  color: #ffffff;
  font-size: 14px;
  min-width: 96px;
}

.viewer-behavior-button.cancel {
  background-image: none;
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.viewer-lantern-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(6, 8, 12, 0.62);
  z-index: 2100;
  padding: 16px;
}

.viewer-lantern-dialog {
  width: 92%;
  max-width: 420px;
  max-height: 90vh;
  border-radius: 16px;
  background: rgba(12, 16, 28, 0.96);
  color: #f5f7ff;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
}

.viewer-lantern-image-wrapper {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}

.viewer-lantern-image {
  width: 100%;
  max-height: 220px;
  display: block;
}

.viewer-lantern-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.viewer-lantern-title {
  font-size: 18px;
  font-weight: 600;
}

.viewer-lantern-text {
  max-height: 220px;
  padding-right: 4px;
}

.viewer-lantern-text text {
  display: block;
  font-size: 14px;
  line-height: 1.5;
  opacity: 0.92;
}

.viewer-lantern-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.viewer-lantern-nav {
  padding: 6px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background-color: rgba(255, 255, 255, 0.08);
  color: #f5f7ff;
  font-size: 12px;
}

.viewer-lantern-nav[disabled] {
  opacity: 0.5;
}

.viewer-lantern-counter {
  font-size: 12px;
  opacity: 0.72;
}

.viewer-lantern-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
}

.viewer-lantern-button {
  padding: 8px 16px;
  border-radius: 18px;
  border: none;
  font-size: 14px;
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
  color: #ffffff;
}

.viewer-lantern-button.cancel {
  background-image: none;
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
</style>
