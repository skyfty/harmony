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
      <view
        v-if="lanternOverlayVisible"
        class="viewer-lantern-overlay"
        @tap="handleLanternOverlayTap"
      >
        <view
          ref="lanternDialogRef"
          class="viewer-lantern-dialog"
          @touchstart="handleLanternTouchStart"
          @touchmove="handleLanternTouchMove"
          @touchend="handleLanternTouchEnd"
          @touchcancel="handleLanternTouchCancel"
        >
          <button class="viewer-lantern-close" aria-label="关闭幻灯片" @tap="cancelLanternOverlay">
            <image :src="lanternCloseIcon" mode="aspectFit" class="viewer-lantern-close-icon" />
          </button>
          <!-- #ifdef H5 -->
          <view
            v-if="lanternCurrentSlideImage"
            class="viewer-lantern-image-wrapper"
            :style="lanternImageBoxStyle"
            v-viewer="lanternViewerOptions"
            ref="lanternViewerRoot"
          >
            <image
              :src="lanternCurrentSlideImage"
              mode="aspectFit"
              class="viewer-lantern-image"
              @load="handleLanternImageLoad"
              @tap="openLanternImageFullscreen"
            />
          </view>
          <!-- #endif -->
          <!-- #ifndef H5 -->
          <view
            v-if="lanternCurrentSlideImage"
            class="viewer-lantern-image-wrapper"
            :style="lanternImageBoxStyle"
            ref="lanternViewerRoot"
          >
            <image
              :src="lanternCurrentSlideImage"
              mode="aspectFit"
              class="viewer-lantern-image"
              @load="handleLanternImageLoad"
              @tap="openLanternImageFullscreen"
            />
          </view>
          <!-- #endif -->
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
          <view v-if="lanternHasMultipleSlides" class="viewer-lantern-indicator">
            <text class="viewer-lantern-counter">{{ lanternActiveSlideIndex + 1 }} / {{ lanternTotalSlides }}</text>
          </view>
        </view>
      </view>
      <view v-if="overlayActive" class="viewer-overlay">
        <view class="viewer-overlay__content viewer-overlay__card">
          <text v-if="overlayTitle" class="viewer-overlay__title">{{ overlayTitle }}</text>
          <view class="viewer-progress">
            <view class="viewer-progress__bar">
              <view
                class="viewer-progress__bar-fill"
                :style="{ width: overlayPercent + '%' }"
              />
            </view>
            <view class="viewer-progress__stats">
              <text class="viewer-progress__percent">{{ overlayPercent }}%</text>
              <text v-if="overlayBytesLabel" class="viewer-progress__bytes">{{ overlayBytesLabel }}</text>
            </view>
          </view>
          <text v-if="overlayLabel" class="viewer-overlay__caption">
            {{ overlayLabel }}
          </text>
        </view>
      </view>
      <view v-if="error" class="viewer-overlay error">
        <text>{{ error }}</text>
      </view>
      <view
        v-if="purposeControlsVisible"
        class="viewer-purpose-controls"
      >
        <button
          class="viewer-purpose-chip viewer-purpose-chip--watch"
          :class="{ 'is-active': purposeActiveMode === 'watch' }"
          aria-label="观察模式"
          @tap="handlePurposeWatchTap"
        >
          <view class="viewer-purpose-chip__halo"></view>
          <view class="viewer-purpose-chip__content">
            <view class="viewer-purpose-chip__icon-wrap">
              <view class="viewer-purpose-chip__icon-pulse"></view>
              <image :src="purposeWatchIcon" mode="aspectFit" class="viewer-purpose-chip__icon" />
            </view>
            <view class="viewer-purpose-chip__texts">
              <text class="viewer-purpose-chip__title">观察</text>
              <text class="viewer-purpose-chip__subtitle">锁定目标视角</text>
            </view>
          </view>
        </button>
        <button
          class="viewer-purpose-chip viewer-purpose-chip--level"
          :class="{ 'is-active': purposeActiveMode === 'level' }"
          aria-label="平视模式"
          @tap="handlePurposeResetTap"
        >
          <view class="viewer-purpose-chip__halo"></view>
          <view class="viewer-purpose-chip__content">
            <view class="viewer-purpose-chip__icon-wrap">
              <view class="viewer-purpose-chip__icon-pulse"></view>
              <image :src="purposeResetIcon" mode="aspectFit" class="viewer-purpose-chip__icon" />
            </view>
            <view class="viewer-purpose-chip__texts">
              <text class="viewer-purpose-chip__title">平视</text>
              <text class="viewer-purpose-chip__subtitle">回到人眼高度</text>
            </view>
          </view>
        </button>
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
import { effectScope, watchEffect, ref, computed, onUnmounted, watch, reactive, nextTick, type ComponentPublicInstance } from 'vue';
import { onLoad, onUnload, onReady } from '@dcloudio/uni-app';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';
import PlatformCanvas from '@/components/PlatformCanvas.vue';
import type { StoredSceneEntry } from '@/stores/sceneStore';
import { parseSceneDocument, useSceneStore } from '@/stores/sceneStore';
import { buildSceneGraph, type SceneGraphBuildOptions, type SceneGraphResourceProgress } from '@schema/sceneGraph';
import ResourceCache from '@schema/ResourceCache';
import { AssetCache, AssetLoader, type AssetCacheEntry } from '@schema/assetCache';
import { loadNodeObject } from '@schema/utils/modelAssetLoader';
import type Viewer from 'viewerjs';
import type { ViewerOptions } from 'viewerjs';
import type {
  EnvironmentSettings,
  SceneNode,
  SceneNodeComponentState,
  SceneSkyboxSettings,
  SceneJsonExportDocument,
  LanternSlideDefinition,
} from '@harmony/schema';
import { ComponentManager } from '@schema/components/componentManager';
import {
  behaviorComponentDefinition,
  guideboardComponentDefinition,
  displayBoardComponentDefinition,
  wallComponentDefinition,
  viewPointComponentDefinition,
  warpGateComponentDefinition,
  effectComponentDefinition,
  RUNTIME_REGISTRY_KEY,
  GUIDEBOARD_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
} from '@schema/components';
import type { EffectComponentProps, GuideboardComponentProps } from '@schema/components';
import {
  addBehaviorRuntimeListener,
  hasRegisteredBehaviors,
  listInteractableObjects,
  listRegisteredBehaviorActions,
  updateBehaviorVisibility,
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
type ResolvedAssetUrl = { url: string; mimeType?: string | null; dispose?: () => void }

interface ScenePreviewPayload {
  document: SceneJsonExportDocument;
  title: string;
  origin?: string;
  createdAt?: string;
  updatedAt?: string;
  assetOverrides?: Record<string, string | ArrayBuffer>;
  resolveAssetUrl?: (assetId: string) => string | Promise<string | null> | null;
  enableGround?: boolean;
}

type RequestedMode = 'store' | 'document' | 'model' | null;

interface SceneDownloadProgress extends UniApp.OnProgressUpdateResult {
  totalBytesWritten?: number;
  totalBytesExpectedToWrite?: number;
}

type SceneRequestTask = UniApp.RequestTask & {
  onProgressUpdate?: (callback: (res: SceneDownloadProgress) => void) => void;
};

interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

const DEFAULT_SCENE_URL = 'https://cdn.touchmagic.cn/uploads/a.json';
const SCENE_DOWNLOAD_TIMEOUT = 120000;

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
  loadedBytes: 0,
  totalBytes: 0,
  label: '',
});

const sceneDownload = reactive({
  active: false,
  loaded: 0,
  total: 0,
  percent: 0,
  label: '正在下载场景数据…',
});

const resourcePreloadPercent = computed(() => {
  if (resourcePreload.totalBytes > 0) {
    const ratio = resourcePreload.totalBytes > 0
      ? Math.min(1, Math.max(0, resourcePreload.loadedBytes / resourcePreload.totalBytes))
      : 0;
    const computedPercent = Math.round(ratio * 100);
    return resourcePreload.active ? computedPercent : 100;
  }
  if (resourcePreload.total > 0) {
    const ratio = Math.min(1, Math.max(0, resourcePreload.loaded / resourcePreload.total));
    const computedPercent = Math.round(ratio * 100);
    return resourcePreload.active ? computedPercent : 100;
  }
  return resourcePreload.active ? 0 : 100;
});

const resourcePreloadBytesLabel = computed(() => {
  if (resourcePreload.totalBytes > 0) {
    return `${formatByteSize(resourcePreload.loadedBytes)} / ${formatByteSize(resourcePreload.totalBytes)}`;
  }
  if (resourcePreload.total > 0) {
    return `已加载 ${resourcePreload.loaded} / ${resourcePreload.total}`;
  }
  return '';
});

const sceneAssetCache = new AssetCache();
const sceneAssetLoader = new AssetLoader(sceneAssetCache);
let sharedResourceCache: ResourceCache | null = null;
let viewerResourceCache: ResourceCache | null = null;
let sceneDownloadTask: SceneRequestTask | null = null;
const globalApp = globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } };
const isWeChatMiniProgram = Boolean(globalApp.wx && typeof globalApp.wx.getSystemInfoSync === 'function');
const DEFAULT_RGBE_DATA_TYPE = isWeChatMiniProgram ? THREE.UnsignedByteType : THREE.FloatType;

const rgbeLoader = new RGBELoader().setDataType(DEFAULT_RGBE_DATA_TYPE);
const textureLoader = new THREE.TextureLoader();

function ensureResourceCache(
  document: SceneJsonExportDocument,
  options: SceneGraphBuildOptions,
): ResourceCache {
  if (!sharedResourceCache) {
    sharedResourceCache = new ResourceCache(document, options, sceneAssetLoader);
  } else {
    sharedResourceCache.setContext(document, options);
  }
  return sharedResourceCache;
}

const overlayActive = computed(() => loading.value || sceneDownload.active || resourcePreload.active);

const overlayTitle = computed(() => {
  if (sceneDownload.active) {
    return '正在下载场景';
  }
  if (resourcePreload.active) {
    return '资源加载中';
  }
  if (loading.value) {
    return '正在初始化场景';
  }
  return '';
});

const overlayPercent = computed(() => {
  if (sceneDownload.active) {
    if (sceneDownload.total > 0) {
      const ratio = Math.min(1, Math.max(0, sceneDownload.loaded / sceneDownload.total));
      return Math.round(ratio * 100);
    }
    const normalized = Math.max(0, Math.min(100, Math.round(sceneDownload.percent)));
    return Number.isFinite(normalized) ? normalized : 0;
  }
  if (resourcePreload.active) {
    return resourcePreloadPercent.value;
  }
  if (loading.value) {
    return 0;
  }
  return resourcePreloadPercent.value;
});

const overlayBytesLabel = computed(() => {
  if (sceneDownload.active && sceneDownload.total > 0) {
    return `${formatByteSize(sceneDownload.loaded)} / ${formatByteSize(sceneDownload.total)}`;
  }
  if (resourcePreload.active && resourcePreloadBytesLabel.value) {
    return resourcePreloadBytesLabel.value;
  }
  return '';
});

const overlayLabel = computed(() => {
  if (sceneDownload.active) {
    return sceneDownload.label || '正在下载场景数据…';
  }
  if (resourcePreload.label) {
    return resourcePreload.label;
  }
  if (loading.value) {
    return '正在加载场景…';
  }
  return '';
});

const SKY_ENVIRONMENT_INTENSITY = 0.35;
const SKY_SCALE = 2500;
const HUMAN_EYE_HEIGHT = 1.7;
const CAMERA_FORWARD_OFFSET = 1.5;
const CAMERA_HORIZONTAL_POLAR_ANGLE = Math.PI / 2;
const CAMERA_WATCH_DURATION = 0.35;
const CAMERA_LEVEL_DURATION = 0.35;
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
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_ENVIRONMENT_BACKGROUND_COLOR = '#516175';
const DEFAULT_ENVIRONMENT_AMBIENT_COLOR = '#ffffff';
const DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY = 0.6;
const DEFAULT_ENVIRONMENT_FOG_COLOR = '#516175';
const DEFAULT_ENVIRONMENT_FOG_DENSITY = 0.02;
const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  background: {
    mode: 'skybox',
    solidColor: DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
    hdriAssetId: null,
  },
  ambientLightColor: DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
  ambientLightIntensity: DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
  fogMode: 'none',
  fogColor: DEFAULT_ENVIRONMENT_FOG_COLOR,
  fogDensity: DEFAULT_ENVIRONMENT_FOG_DENSITY,
  environmentMap: {
    mode: 'skybox',
    hdriAssetId: null,
  },
};
const ENVIRONMENT_NODE_ID = 'harmony:environment' as const;
const skySunPosition = new THREE.Vector3();
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(0.35, 1, -0.25).normalize();
const tempSunDirection = new THREE.Vector3();
const SKY_SUN_LIGHT_DISTANCE = 150;
const SKY_SUN_LIGHT_MIN_HEIGHT = 12;

const purposeWatchIcon =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12C3.5 7.2 7.5 4 12 4s8.5 3.2 11 8c-2.5 4.8-6.5 8-11 8S3.5 16.8 1 12z"/><circle cx="12" cy="12" r="3"/></svg>'
  );
const purposeResetIcon =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M9 7l3-3 3 3"/><path d="M9 17l3 3 3-3"/></svg>'
  );
const lanternCloseIcon =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
  );

let sky: Sky | null = null;
let sunDirectionalLight: THREE.DirectionalLight | null = null;
let pmremGenerator: THREE.PMREMGenerator | null = null;
let skyEnvironmentTarget: THREE.WebGLRenderTarget | null = null;
let pendingSkyboxSettings: SceneSkyboxSettings | null = null;
let shouldRenderSkyBackground = true;
let environmentAmbientLight: THREE.AmbientLight | null = null;
let backgroundTexture: THREE.Texture | null = null;
let backgroundTextureCleanup: (() => void) | null = null;
let backgroundAssetId: string | null = null;
let backgroundLoadToken = 0;
let environmentMapTarget: THREE.WebGLRenderTarget | null = null;
let environmentMapAssetId: string | null = null;
let environmentMapLoadToken = 0;
let pendingEnvironmentSettings: EnvironmentSettings | null = null;
let renderContext: RenderContext | null = null;
let currentDocument: SceneJsonExportDocument | null = null;
type WindowResizeCallback = Parameters<typeof uni.onWindowResize>[0];
let resizeListener: WindowResizeCallback | null = null;
let canvasResult: UseCanvasResult | null = null;
let initializing = false;
const scope = effectScope();
const bootstrapFinished = ref(false);

function supportsFloatTextureLinearFiltering(): boolean {
  const renderer = renderContext?.renderer ?? null;
  if (!renderer) {
    return !isWeChatMiniProgram;
  }
  if (renderer.capabilities.isWebGL2) {
    return true;
  }
  const extensions = renderer.extensions as { has?: (name: string) => boolean };
  const hasExtension = (name: string) => (typeof extensions?.has === 'function' ? extensions.has(name) : false);
  return hasExtension('OES_texture_float_linear') || hasExtension('OES_texture_half_float_linear');
}

function ensureFloatTextureFilterCompatibility(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return;
  }
  const type = texture.type;
  if (type !== THREE.FloatType && type !== THREE.HalfFloatType) {
    return;
  }
  if (supportsFloatTextureLinearFiltering()) {
    return;
  }
  let changed = false;
  if (texture.minFilter !== THREE.NearestFilter) {
    texture.minFilter = THREE.NearestFilter;
    changed = true;
  }
  if (texture.magFilter !== THREE.NearestFilter) {
    texture.magFilter = THREE.NearestFilter;
    changed = true;
  }
  if (texture.generateMipmaps) {
    texture.generateMipmaps = false;
    changed = true;
  }
  const anyTexture = texture as THREE.Texture & { anisotropy?: number };
  if (typeof anyTexture.anisotropy === 'number' && anyTexture.anisotropy > 1) {
    anyTexture.anisotropy = 1;
    changed = true;
  }
  if (changed) {
    texture.needsUpdate = true;
  }
}

const previewComponentManager = new ComponentManager();
previewComponentManager.registerDefinition(wallComponentDefinition);
previewComponentManager.registerDefinition(guideboardComponentDefinition);
previewComponentManager.registerDefinition(displayBoardComponentDefinition);
previewComponentManager.registerDefinition(viewPointComponentDefinition);
previewComponentManager.registerDefinition(warpGateComponentDefinition);
previewComponentManager.registerDefinition(effectComponentDefinition);
previewComponentManager.registerDefinition(behaviorComponentDefinition);

const previewNodeMap = new Map<string, SceneNode>();
const nodeObjectMap = new Map<string, THREE.Object3D>();

const behaviorRaycaster = new THREE.Raycaster();
const behaviorPointer = new THREE.Vector2();
let handleBehaviorClick: ((event: MouseEvent | TouchEvent) => void) | null = null;

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
const lanternDialogRef = ref<HTMLElement | ComponentPublicInstance | null>(null);
const initialSystemInfo = (() => {
  try {
    return uni.getSystemInfoSync();
  } catch (_error) {
    return null;
  }
})();
const lanternViewportSize = reactive({
  width: initialSystemInfo?.windowWidth || initialSystemInfo?.screenWidth || 375,
  height: initialSystemInfo?.windowHeight || initialSystemInfo?.screenHeight || 667,
});
const lanternImageNaturalSize = reactive({ width: 0, height: 0 });
const lanternViewerRoot = ref<HTMLElement | ComponentPublicInstance | null>(null);
let lanternViewerInstance: Viewer | null = null;
const lanternViewerOptions: ViewerOptions = {
  inline: false,
  toolbar: true,
  navbar: false,
  title: false,
  tooltip: false,
  movable: true,
  zoomable: true,
  rotatable: false,
  scalable: false,
  transition: false,
  fullscreen: true,
  zIndex: 3000,
};
const lanternImageBoxStyle = computed(() => {
  const viewportWidth = lanternViewportSize.width || 375;
  const viewportHeight = lanternViewportSize.height || 667;
  const dialogMaxWidth = Math.max(Math.min(viewportWidth * 0.92, 620), 260);
  const dialogHorizontalPadding = 36; // dialog padding (18 * 2)
  const imageAvailableWidth = Math.max(dialogMaxWidth - dialogHorizontalPadding, 200);
  const dialogMaxHeight = Math.max(Math.min(viewportHeight * 0.9, viewportHeight - 96), 240);
  const reservedForText = Math.max(viewportHeight * 0.22, 140);
  const imageAvailableHeight = Math.max(dialogMaxHeight - reservedForText, 180);
  const style: Record<string, string> = {
    maxWidth: `${Math.round(imageAvailableWidth)}px`,
    maxHeight: `${Math.round(imageAvailableHeight)}px`,
  };
  const naturalWidth = lanternImageNaturalSize.width;
  const naturalHeight = lanternImageNaturalSize.height;
  if (naturalWidth > 0 && naturalHeight > 0) {
    const widthScale = imageAvailableWidth / naturalWidth;
    const heightScale = imageAvailableHeight / naturalHeight;
    const scale = Math.min(widthScale, heightScale, 1);
    const targetWidth = Math.max(Math.round(naturalWidth * scale), 1);
    const targetHeight = Math.max(Math.round(naturalHeight * scale), 1);
    style.width = `${targetWidth}px`;
    style.height = `${targetHeight}px`;
  } else {
    style.width = '100%';
    style.height = 'auto';
    style.minHeight = `${Math.round(Math.min(imageAvailableHeight, 220))}px`;
  }
  return style;
});

const purposeControlsVisible = ref(false);
const purposeTargetNodeId = ref<string | null>(null);
const purposeSourceNodeId = ref<string | null>(null);
const purposeActiveMode = ref<'watch' | 'level'>('level');
type CameraViewMode = 'level' | 'watching';
const cameraViewState = reactive<{ mode: CameraViewMode; targetNodeId: string | null }>({
  mode: 'level',
  targetNodeId: null,
});
const isCameraCaged = ref(false);

type LanternTextState = { text: string; loading: boolean; error: string | null };
type LanternImageState = { url: string | null; loading: boolean; error: string | null };

const lanternTextState = reactive<Record<string, LanternTextState>>({});
const lanternTextPromises = new Map<string, Promise<void>>();
const lanternImageState = reactive<Record<string, LanternImageState>>({});
const lanternImagePromises = new Map<string, Promise<void>>();

const activeBehaviorDelayTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeBehaviorAnimations = new Map<string, () => void>();
const nodeAnimationControllers = new Map<string, {
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  defaultClip: THREE.AnimationClip | null;
}>();
let animationMixers: THREE.AnimationMixer[] = [];
let effectRuntimeTickers: Array<(delta: number) => void> = [];

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

const MAX_CONCURRENT_LAZY_LOADS = 2;

type LazyPlaceholderState = {
  nodeId: string;
  container: THREE.Object3D | null;
  placeholder: THREE.Object3D;
  assetId: string;
  objectPath: number[] | null;
  boundingSphere: THREE.Sphere | null;
  loading: boolean;
  loaded: boolean;
  pending: Promise<void> | null;
};

const lazyPlaceholderStates = new Map<string, LazyPlaceholderState>();
let activeLazyLoadCount = 0;
const tempOutlineSphere = new THREE.Sphere();
const tempOutlineScale = new THREE.Vector3();
const tempCameraMatrix = new THREE.Matrix4();
const cameraViewFrustum = new THREE.Frustum();

const tempBox = new THREE.Box3();
const tempSphere = new THREE.Sphere();
const tempVector = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempPitchVector = new THREE.Vector3();
const tempSpherical = new THREE.Spherical();
const LANTERN_SWIPE_DETECTION_THRESHOLD = 18;
const LANTERN_SWIPE_TRIGGER_THRESHOLD = 60;
let lanternSwipeStartX: number | null = null;
let lanternSwipeStartY: number | null = null;
let lanternSwipeActive = false;

type CameraWatchTween = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  startPosition: THREE.Vector3;
  duration: number;
  elapsed: number;
};

let activeCameraWatchTween: CameraWatchTween | null = null;
type FrameDeltaMode = 'seconds' | 'milliseconds';
let frameDeltaMode: FrameDeltaMode | null = null;

// Normalize per-frame delta to seconds; some runtimes emit milliseconds.
function normalizeFrameDelta(delta: number): number {
  if (!Number.isFinite(delta) || delta <= 0) {
    return 0;
  }
  if (frameDeltaMode === null) {
    frameDeltaMode = delta > 5 ? 'milliseconds' : 'seconds';
  } else if (frameDeltaMode === 'milliseconds' && delta <= 1) {
    frameDeltaMode = 'seconds';
  } else if (frameDeltaMode === 'seconds' && delta > 5) {
    frameDeltaMode = 'milliseconds';
  }
  return frameDeltaMode === 'milliseconds' ? delta / 1000 : delta;
}

const assetObjectUrlCache = new Map<string, string>();
const DISPLAY_BOARD_RESOLVER_KEY = '__harmonyResolveDisplayBoardMedia';

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

function getLanternImageState(assetId: string): LanternImageState {
  if (!lanternImageState[assetId]) {
    lanternImageState[assetId] = reactive({
      url: null,
      loading: false,
      error: null,
    }) as LanternImageState;
  }
  return lanternImageState[assetId];
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
  if (!slide?.imageAssetId) {
    return null;
  }
  const assetId = slide.imageAssetId.trim();
  if (!assetId.length) {
    return null;
  }
  return lanternImageState[assetId]?.url ?? null;
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


function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const sanitized = value.trim();
    if (HEX_COLOR_PATTERN.test(sanitized)) {
      return `#${sanitized.slice(1).toLowerCase()}`;
    }
  }
  return fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (numeric < min) {
    return min;
  }
  if (numeric > max) {
    return max;
  }
  return numeric;
}

function normalizeAssetId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractEnvironmentSettingsFromNodes(
  nodes: SceneNode[] | null | undefined,
): EnvironmentSettings | null {
  if (!Array.isArray(nodes) || !nodes.length) {
    return null;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.id === ENVIRONMENT_NODE_ID || node.nodeType === 'Environment') {
      const payload = isPlainRecord(node.userData)
        ? ((node.userData as Record<string, unknown>).environment as
            | EnvironmentSettings
            | Partial<EnvironmentSettings>
            | null
            | undefined)
        : null;
      return cloneEnvironmentSettingsLocal(payload ?? DEFAULT_ENVIRONMENT_SETTINGS);
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return null;
}

function cloneEnvironmentSettingsLocal(
  source?: Partial<EnvironmentSettings> | EnvironmentSettings | null,
): EnvironmentSettings {
  const backgroundSource = source?.background ?? null;
  const environmentMapSource = source?.environmentMap ?? null;

  let backgroundMode: EnvironmentSettings['background']['mode'] = 'skybox';
  if (backgroundSource?.mode === 'hdri') {
    backgroundMode = 'hdri';
  } else if (backgroundSource?.mode === 'solidColor') {
    backgroundMode = 'solidColor';
  }
  const environmentMapMode = environmentMapSource?.mode === 'custom' ? 'custom' : 'skybox';
  const fogMode = source?.fogMode === 'exp' ? 'exp' : 'none';

  return {
    background: {
      mode: backgroundMode,
      solidColor: normalizeHexColor(backgroundSource?.solidColor, DEFAULT_ENVIRONMENT_BACKGROUND_COLOR),
      hdriAssetId: normalizeAssetId(backgroundSource?.hdriAssetId ?? null),
    },
    ambientLightColor: normalizeHexColor(source?.ambientLightColor, DEFAULT_ENVIRONMENT_AMBIENT_COLOR),
    ambientLightIntensity: clampNumber(
      source?.ambientLightIntensity,
      0,
      10,
      DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
    ),
    fogMode,
    fogColor: normalizeHexColor(source?.fogColor, DEFAULT_ENVIRONMENT_FOG_COLOR),
    fogDensity: clampNumber(source?.fogDensity, 0, 5, DEFAULT_ENVIRONMENT_FOG_DENSITY),
    environmentMap: {
      mode: environmentMapMode,
      hdriAssetId: normalizeAssetId(environmentMapSource?.hdriAssetId ?? null),
    },
  };
}

function resolveDocumentEnvironment(document: SceneJsonExportDocument | null | undefined): EnvironmentSettings {
  if (!document) {
    return cloneEnvironmentSettingsLocal(DEFAULT_ENVIRONMENT_SETTINGS);
  }
  const payload = (document as SceneJsonExportDocument & {
    environment?: Partial<EnvironmentSettings> | EnvironmentSettings | null;
  }).environment;
  if (payload) {
    return cloneEnvironmentSettingsLocal(payload);
  }
  const derived = extractEnvironmentSettingsFromNodes(document.nodes);
  if (derived) {
    return derived;
  }
  return cloneEnvironmentSettingsLocal(DEFAULT_ENVIRONMENT_SETTINGS);
}

type UniImageLoadEvent = Event & {
  detail?: {
    width?: number;
    height?: number;
  };
};

function refreshLanternViewportSize(): void {
  try {
    const info = uni.getSystemInfoSync();
    if (info?.windowWidth) {
      lanternViewportSize.width = info.windowWidth;
    } else if (info?.screenWidth) {
      lanternViewportSize.width = info.screenWidth;
    }
    if (info?.windowHeight) {
      lanternViewportSize.height = info.windowHeight;
    } else if (info?.screenHeight) {
      lanternViewportSize.height = info.screenHeight;
    }
  } catch (_error) {
    // ignore errors when system info is unavailable
  }
}

function resetLanternImageMetrics(): void {
  lanternImageNaturalSize.width = 0;
  lanternImageNaturalSize.height = 0;
}

function getLanternViewerElement(): HTMLElement | null {
  const target = lanternViewerRoot.value;
  if (!target) {
    return null;
  }
  if (typeof (target as ComponentPublicInstance).$el !== 'undefined') {
    const element = (target as ComponentPublicInstance & { $el?: HTMLElement }).$el;
    if (element) {
      return element;
    }
  }
  if (target instanceof HTMLElement) {
    return target;
  }
  return null;
}

function resolveLanternViewer(): Viewer | null {
  if (lanternViewerInstance) {
    return lanternViewerInstance;
  }
  const element = getLanternViewerElement();
  if (!element) {
    return null;
  }
  const instance = (element as unknown as { $viewer?: Viewer }).$viewer;
  if (instance) {
    lanternViewerInstance = instance;
    return instance;
  }
  return null;
}

function isLanternViewerOpen(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const viewer = resolveLanternViewer();
  if (!viewer) {
    return false;
  }
  const state = viewer as unknown as { isShown?: boolean };
  return Boolean(state?.isShown);
}

function syncLanternViewer(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const viewer = resolveLanternViewer();
  viewer?.update?.();
}

function syncLanternViewerLater(): void {
  if (typeof window === 'undefined') {
    return;
  }
  nextTick(() => {
    syncLanternViewer();
  });
}

function handleLanternImageLoad(event: UniImageLoadEvent): void {
  const width = event?.detail?.width ?? 0;
  const height = event?.detail?.height ?? 0;
  if (width > 0 && height > 0) {
    lanternImageNaturalSize.width = width;
    lanternImageNaturalSize.height = height;
    syncLanternViewerLater();
    return;
  }
  const currentSrc = lanternCurrentSlideImage.value;
  if (!currentSrc) {
    return;
  }
  uni.getImageInfo?.({
    src: currentSrc,
    success: (info) => {
      if (info?.width && info?.height) {
        lanternImageNaturalSize.width = info.width;
        lanternImageNaturalSize.height = info.height;
        syncLanternViewerLater();
      }
    },
  });
}

function openLanternImageFullscreen(): void {
  const imageUrl = lanternCurrentSlideImage.value;
  if (!imageUrl) {
    return;
  }
  const fallbackPreview = () => {
    if (typeof uni !== 'undefined' && typeof uni.previewImage === 'function') {
      uni.previewImage({ urls: [imageUrl] });
    }
  };
  if (typeof window === 'undefined') {
    fallbackPreview();
    return;
  }
  syncLanternViewerLater();
  nextTick(() => {
    const viewer = resolveLanternViewer();
    if (viewer && typeof viewer.view === 'function') {
      viewer.update?.();
      viewer.view(0);
    } else {
      fallbackPreview();
    }
  });
}

function closeLanternImageFullscreen(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const viewer = resolveLanternViewer();
  viewer?.hide?.();
}

refreshLanternViewportSize();

watch(
  lanternSlides,
  (slidesList) => {
    const list = Array.isArray(slidesList) ? slidesList : [];
    const activeTextIds = new Set<string>();
    const activeImageIds = new Set<string>();
    for (const slide of list) {
      const textAssetId = slide?.descriptionAssetId?.trim();
      if (textAssetId) {
        activeTextIds.add(textAssetId);
        void ensureLanternText(textAssetId);
      }
      const imageAssetId = slide?.imageAssetId?.trim();
      if (imageAssetId) {
        activeImageIds.add(imageAssetId);
        void ensureLanternImage(imageAssetId);
      }
    }
    if (lanternActiveSlideIndex.value >= list.length) {
      lanternActiveSlideIndex.value = list.length ? list.length - 1 : 0;
    }
    Object.keys(lanternTextState).forEach((key) => {
      if (!activeTextIds.has(key)) {
        delete lanternTextState[key];
      }
    });
    Object.keys(lanternImageState).forEach((key) => {
      if (!activeImageIds.has(key)) {
        delete lanternImageState[key];
      }
    });
    Array.from(lanternTextPromises.keys()).forEach((key) => {
      if (!activeTextIds.has(key)) {
        lanternTextPromises.delete(key);
      }
    });
    Array.from(lanternImagePromises.keys()).forEach((key) => {
      if (!activeImageIds.has(key)) {
        lanternImagePromises.delete(key);
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
    const imageAssetId = slide?.imageAssetId?.trim();
    if (imageAssetId) {
      void ensureLanternImage(imageAssetId);
    }
    resetLanternImageMetrics();
  },
  { immediate: true },
);

watch(
  lanternCurrentSlideImage,
  () => {
    resetLanternImageMetrics();
    closeLanternImageFullscreen();
    syncLanternViewerLater();
  },
  { immediate: true },
);

watch(lanternOverlayVisible, (visible) => {
  if (visible) {
    refreshLanternViewportSize();
    syncLanternViewerLater();
  } else {
    resetLanternImageMetrics();
    closeLanternImageFullscreen();
  }
});

watch(
  () => [lanternImageNaturalSize.width, lanternImageNaturalSize.height],
  () => {
    syncLanternViewerLater();
  },
);

watch(
  () => [lanternViewportSize.width, lanternViewportSize.height],
  () => {
    syncLanternViewerLater();
  },
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

async function ensureLanternImage(assetId: string): Promise<void> {
  const trimmed = assetId.trim();
  if (!trimmed.length) {
    return;
  }
  if (lanternImagePromises.has(trimmed)) {
    await lanternImagePromises.get(trimmed);
    return;
  }
  const promise = (async () => {
    const state = getLanternImageState(trimmed);
    state.loading = true;
    state.error = null;
    try {
      const resolved = await resolveAssetUrlFromCache(trimmed);
      if (!resolved) {
        throw new Error('无法解析图片资源');
      }
      state.url = resolved.url;
    } catch (error) {
      state.error = (error as Error).message ?? '图片资源加载失败';
      state.url = null;
    } finally {
      state.loading = false;
      lanternImagePromises.delete(trimmed);
    }
  })();
  lanternImagePromises.set(trimmed, promise);
  await promise;
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

const EXTERNAL_ASSET_PATTERN = /^(https?:)?\/\//i;

function isExternalAssetReference(value: string): boolean {
  return EXTERNAL_ASSET_PATTERN.test(value);
}

async function acquireViewerAssetEntry(assetId: string): Promise<AssetCacheEntry | null> {
  const trimmed = assetId.trim();
  if (!trimmed.length) {
    return null;
  }
  const cache = viewerResourceCache ?? sharedResourceCache;
  if (!cache) {
    return null;
  }
  try {
    return await cache.acquireAssetEntry(trimmed);
  } catch (error) {
    console.warn('[SceneViewer] Failed to acquire asset entry', trimmed, error);
    return null;
  }
}

function inferMimeTypeFromAssetId(assetId: string): string | null {
	const lower = assetId.toLowerCase()
	if (lower.endsWith('.png')) {
		return 'image/png'
	}
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
		return 'image/jpeg'
	}
	if (lower.endsWith('.gif')) {
		return 'image/gif'
	}
	if (lower.endsWith('.webp')) {
		return 'image/webp'
	}
	if (lower.endsWith('.svg')) {
		return 'image/svg+xml'
	}
	if (lower.endsWith('.json')) {
		return 'application/json'
	}
	if (lower.endsWith('.txt')) {
		return 'text/plain'
	}
	return null
}
function getOrCreateObjectUrl(assetId: string, data: ArrayBuffer, mimeHint?: string): string {
	const cached = assetObjectUrlCache.get(assetId)
	if (cached) {
		return cached
	}
	const mimeType = mimeHint ?? inferMimeTypeFromAssetId(assetId) ?? 'application/octet-stream'
	const blob = new Blob([data], { type: mimeType })
	const url = URL.createObjectURL(blob)
	assetObjectUrlCache.set(assetId, url)
	return url
}
function buildResolvedAssetUrl(assetId: string, entry: AssetCacheEntry | null): ResolvedAssetUrl | null {
	if (!entry) {
		return null
	}
	const mimeType = entry.mimeType ?? inferMimeTypeFromAssetId(assetId)
	if (entry.downloadUrl) {
		return { url: entry.downloadUrl, mimeType }
	}
	if (entry.blobUrl) {
		return { url: entry.blobUrl, mimeType }
	}
	if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
		const url = getOrCreateObjectUrl(assetId, entry.arrayBuffer, mimeType ?? undefined)
		return { url, mimeType }
	}
	return null
}

async function resolveAssetUrlFromCache(assetId: string): Promise<ResolvedAssetUrl | null> {
  const entry = await acquireViewerAssetEntry(assetId);
  return buildResolvedAssetUrl(assetId, entry);
}

function inferMimeTypeFromUrl(url: string): string | null {
	const cleaned = url.split('?')[0]?.split('#')[0] ?? url
	return inferMimeTypeFromAssetId(cleaned)
}

async function resolveAssetUrlReference(candidate: string): Promise<ResolvedAssetUrl | null> {
	const trimmed = candidate.trim()
	if (!trimmed.length) {
		return null
	}
	if (trimmed.startsWith('data:') || isExternalAssetReference(trimmed)) {
		return { url: trimmed, mimeType: inferMimeTypeFromUrl(trimmed) }
	}
	const assetId = trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
	return await resolveAssetUrlFromCache(assetId)
}


async function resolveDisplayBoardMediaSource(candidate: string): Promise<ResolvedAssetUrl | null> {
	const trimmed = candidate.trim()
	if (!trimmed.length) {
		return null
	}
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
		return { url: trimmed, mimeType: inferMimeTypeFromUrl(trimmed) }
	}
	const assetId = trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
	if (!assetId.length) {
		return null
	}
	return await resolveAssetUrlFromCache(assetId)
}

(globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
  DISPLAY_BOARD_RESOLVER_KEY
] = resolveDisplayBoardMediaSource;

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
}

async function loadTextAssetContent(assetId: string): Promise<string | null> {
  const trimmed = assetId.trim();
  if (!trimmed.length) {
    return null;
  }
  if (isExternalAssetReference(trimmed)) {
    return await fetchTextFromUrl(trimmed);
  }
  const entry = await acquireViewerAssetEntry(trimmed);
  if (!entry) {
    return null;
  }
  if (entry.downloadUrl) {
    return await fetchTextFromUrl(entry.downloadUrl);
  }
  if (entry.arrayBuffer && entry.arrayBuffer.byteLength) {
    try {
      return new TextDecoder().decode(entry.arrayBuffer);
    } catch (error) {
      console.warn('解码文本 ArrayBuffer 失败', error);
      return null;
    }
  }
  if (entry.blob && typeof entry.blob.text === 'function') {
    try {
      return await entry.blob.text();
    } catch (error) {
      console.warn('读取文本 Blob 失败', error);
    }
  }
  if (entry.blobUrl && typeof fetch === 'function') {
    return await fetchTextFromUrl(entry.blobUrl);
  }
  return null;
}

function resetLanternOverlay(): void {
  lanternOverlayVisible.value = false;
  lanternSlides.value = [];
  lanternActiveSlideIndex.value = 0;
  lanternEventToken.value = null;
  resetLanternSwipeTracking();
  closeLanternImageFullscreen();
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

function cancelLanternOverlay(): void {
  closeLanternOverlay({ type: 'abort', message: '用户退出了幻灯片' });
}

function isDomNode(value: unknown): value is Node {
  return typeof Node !== 'undefined' && value instanceof Node;
}

function resolveLanternDialogNode(): Node | null {
  const value = lanternDialogRef.value;
  if (!value) {
    return null;
  }
  if (isDomNode(value)) {
    return value;
  }
  const maybeInstance = value as ComponentPublicInstance;
  const root = maybeInstance?.$el;
  return isDomNode(root) ? root : null;
}

function isTapInsideLanternDialog(event: Event): boolean {
  const dialogNode = resolveLanternDialogNode();
  if (!dialogNode) {
    return false;
  }
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (Array.isArray(path) && path.length) {
    return path.some((item) => item === dialogNode || (isDomNode(item) && dialogNode.contains(item)));
  }
  const target = event.target;
  if (!isDomNode(target)) {
    return false;
  }
  return dialogNode === target || dialogNode.contains(target);
}

function handleLanternOverlayTap(event: Event): void {
  if (isLanternViewerOpen()) {
    closeLanternImageFullscreen();
    return;
  }
  if (!isTapInsideLanternDialog(event)) {
    cancelLanternOverlay();
  }
}

function resetLanternSwipeTracking(): void {
  lanternSwipeStartX = null;
  lanternSwipeStartY = null;
  lanternSwipeActive = false;
}

function handleLanternTouchStart(event: TouchEvent): void {
  if (!lanternOverlayVisible.value || !lanternHasMultipleSlides.value) {
    resetLanternSwipeTracking();
    return;
  }
  const touch = event.touches?.[0];
  if (!touch) {
    resetLanternSwipeTracking();
    return;
  }
  lanternSwipeStartX = touch.clientX;
  lanternSwipeStartY = touch.clientY;
  lanternSwipeActive = false;
}

function handleLanternTouchMove(event: TouchEvent): void {
  if (lanternSwipeStartX == null || lanternSwipeStartY == null || !lanternHasMultipleSlides.value) {
    return;
  }
  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }
  const deltaX = touch.clientX - lanternSwipeStartX;
  const deltaY = touch.clientY - lanternSwipeStartY;
  if (!lanternSwipeActive) {
    if (Math.abs(deltaX) > LANTERN_SWIPE_DETECTION_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
      lanternSwipeActive = true;
      event.preventDefault?.();
      event.stopPropagation?.();
    } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > LANTERN_SWIPE_DETECTION_THRESHOLD) {
      resetLanternSwipeTracking();
    }
  } else {
    event.preventDefault?.();
    event.stopPropagation?.();
  }
}

function handleLanternTouchEnd(event: TouchEvent): void {
  if (lanternSwipeStartX == null || lanternSwipeStartY == null || !lanternHasMultipleSlides.value) {
    resetLanternSwipeTracking();
    return;
  }
  const touch = event.changedTouches?.[0];
  if (touch && lanternSwipeActive) {
    const deltaX = touch.clientX - lanternSwipeStartX;
    if (Math.abs(deltaX) >= LANTERN_SWIPE_TRIGGER_THRESHOLD) {
      if (deltaX < 0) {
        showNextLanternSlide();
      } else {
        showPreviousLanternSlide();
      }
    }
    event.preventDefault?.();
    event.stopPropagation?.();
  }
  resetLanternSwipeTracking();
}

function handleLanternTouchCancel(): void {
  resetLanternSwipeTracking();
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
  if (!token) {
    return;
  }
  resolveBehaviorToken(token, { type: 'continue' });
}

function cancelBehaviorAlert() {
  const token = behaviorAlertToken.value;
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

function resolveGuideboardComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<GuideboardComponentProps> | null {
  const component = node?.components?.[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined;
  if (!component || !component.enabled) {
    return null;
  }
  return component;
}

function isGuideboardSceneNode(node: SceneNode | null | undefined): boolean {
  return resolveGuideboardComponent(node) !== null;
}

function resolveGuideboardInitialVisibility(node: SceneNode | null | undefined): boolean | null {
  const component = resolveGuideboardComponent(node);
  if (!component) {
    return null;
  }
  const props = component.props as GuideboardComponentProps | undefined;
  return props?.initiallyVisible === true;
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
      const nodeState = resolveNodeById(nodeId);
      const guideboardVisibility = resolveGuideboardInitialVisibility(nodeState);
      if (guideboardVisibility !== null) {
        object.visible = guideboardVisibility;
        updateBehaviorVisibility(nodeId, object.visible);
      }
    }
  });
}

type LazyAssetMetadata = {
  placeholder?: boolean;
  assetId?: string | null;
  objectPath?: number[] | null;
  boundingSphere?: { center: { x: number; y: number; z: number }; radius: number } | null;
  ownerNodeId?: string | null;
} | undefined;

function findLazyPlaceholderForNode(root: THREE.Object3D | null | undefined, nodeId: string): THREE.Object3D | null {
  if (!root) {
    return null;
  }
  const stack: THREE.Object3D[] = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const lazyData = current.userData?.lazyAsset as LazyAssetMetadata;
    if (lazyData?.placeholder) {
      const ownerId = lazyData.ownerNodeId ?? (current.userData?.nodeId as string | undefined) ?? null;
      if (ownerId ? ownerId === nodeId : current === root) {
        return current;
      }
    }
    if (current.children.length) {
      stack.push(...current.children);
    }
  }
  return null;
}

function initializeLazyPlaceholders(document: SceneJsonExportDocument | null | undefined): void {
  lazyPlaceholderStates.clear();
  activeLazyLoadCount = 0;
  if (!document) {
    return;
  }
  nodeObjectMap.forEach((object, nodeId) => {
    const placeholderObject = findLazyPlaceholderForNode(object, nodeId);
    if (!placeholderObject) {
      return;
    }
    const lazyData = placeholderObject.userData?.lazyAsset as LazyAssetMetadata;
    if (!lazyData || !lazyData.placeholder || !lazyData.assetId) {
      return;
    }
    const sphere = lazyData.boundingSphere
      ? new THREE.Sphere(
          new THREE.Vector3(
            lazyData.boundingSphere.center.x,
            lazyData.boundingSphere.center.y,
            lazyData.boundingSphere.center.z,
          ),
          lazyData.boundingSphere.radius,
        )
      : null;
    lazyPlaceholderStates.set(nodeId, {
      nodeId,
      container: object,
      placeholder: placeholderObject,
      assetId: lazyData.assetId,
      objectPath: Array.isArray(lazyData.objectPath) ? [...lazyData.objectPath] : null,
      boundingSphere: sphere,
      loading: false,
      loaded: false,
      pending: null,
    });
  });
}

function updateLazyPlaceholders(_delta: number): void {
  const camera = renderContext?.camera;
  if (!camera || lazyPlaceholderStates.size === 0) {
    return;
  }
  camera.updateMatrixWorld(true);
  tempCameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  cameraViewFrustum.setFromProjectionMatrix(tempCameraMatrix);
  lazyPlaceholderStates.forEach((state, nodeId) => {
    const container = nodeObjectMap.get(nodeId) ?? null;
    if (!container) {
      lazyPlaceholderStates.delete(nodeId);
      return;
    }
    state.container = container;
    const placeholderObject = findLazyPlaceholderForNode(container, nodeId);
    if (!placeholderObject) {
      lazyPlaceholderStates.delete(nodeId);
      return;
    }
    state.placeholder = placeholderObject;
    const lazyData = placeholderObject.userData?.lazyAsset as LazyAssetMetadata;
    if (!lazyData || !lazyData.placeholder || !lazyData.assetId) {
      lazyPlaceholderStates.delete(nodeId);
      return;
    }
    state.assetId = lazyData.assetId;
    state.objectPath = Array.isArray(lazyData.objectPath) ? [...lazyData.objectPath] : null;
    if (lazyData.boundingSphere) {
      if (!state.boundingSphere) {
        state.boundingSphere = new THREE.Sphere();
      }
      state.boundingSphere.center.set(
        lazyData.boundingSphere.center.x,
        lazyData.boundingSphere.center.y,
        lazyData.boundingSphere.center.z,
      );
      state.boundingSphere.radius = lazyData.boundingSphere.radius;
    } else {
      state.boundingSphere = null;
    }
    if (state.loaded) {
      lazyPlaceholderStates.delete(nodeId);
      return;
    }
    if (state.loading || state.pending) {
      return;
    }
    if (activeLazyLoadCount >= MAX_CONCURRENT_LAZY_LOADS) {
      return;
    }
    if (!shouldLoadLazyPlaceholder(state, cameraViewFrustum)) {
      return;
    }
    state.loading = true;
    activeLazyLoadCount += 1;
    const pending = loadActualAssetForPlaceholder(state)
      .catch((error) => {
        console.warn('[SceneViewer] 详细模型加载失败', error);
      })
      .finally(() => {
        state.loading = false;
        activeLazyLoadCount = Math.max(0, activeLazyLoadCount - 1);
        state.pending = null;
      });
    state.pending = pending;
  });
}

function shouldLoadLazyPlaceholder(state: LazyPlaceholderState, frustum: THREE.Frustum): boolean {
  const camera = renderContext?.camera;
  if (!camera) {
    return false;
  }
  const object = state.placeholder;
  if (!object.visible) {
    return false;
  }
  const worldSphere = resolveWorldBoundingSphereForPlaceholder(state, object);
  if (!worldSphere) {
    return false;
  }
  return frustum.intersectsSphere(worldSphere);
}

function resolveWorldBoundingSphereForPlaceholder(state: LazyPlaceholderState, object: THREE.Object3D): THREE.Sphere | null {
  object.updateWorldMatrix(true, false);
  let baseSphere = state.boundingSphere ? state.boundingSphere.clone() : null;
  const mesh = object as THREE.Mesh & { geometry?: THREE.BufferGeometry };
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!baseSphere && geometry) {
    if (!geometry.boundingSphere) {
      geometry.computeBoundingSphere();
    }
    if (geometry.boundingSphere) {
      baseSphere = geometry.boundingSphere.clone();
    }
  }
  if (baseSphere) {
    tempOutlineSphere.center.copy(baseSphere.center).applyMatrix4(object.matrixWorld);
    object.getWorldScale(tempOutlineScale);
    const maxScale = Math.max(tempOutlineScale.x, tempOutlineScale.y, tempOutlineScale.z);
    tempOutlineSphere.radius = baseSphere.radius * maxScale;
    return tempOutlineSphere;
  }
  const worldBox = tempBox.setFromObject(object);
  if (worldBox.isEmpty()) {
    return null;
  }
  return worldBox.getBoundingSphere(tempOutlineSphere);
}

async function loadActualAssetForPlaceholder(state: LazyPlaceholderState): Promise<void> {
  const resourceCache = viewerResourceCache;
  const context = renderContext;
  if (!resourceCache || !context) {
    return;
  }
  const node = resolveNodeById(state.nodeId);
  if (!node) {
    lazyPlaceholderStates.delete(state.nodeId);
    return;
  }
  try {
    const detailed = await loadNodeObject(resourceCache, state.assetId, node.importMetadata ?? null);
    if (!detailed) {
      lazyPlaceholderStates.delete(state.nodeId);
      return;
    }
    prepareImportedObjectForPreview(detailed);
    const placeholder = state.placeholder;
    const container = state.container ?? nodeObjectMap.get(state.nodeId) ?? null;
    const metadata = { ...(placeholder.userData ?? {}), nodeId: state.nodeId } as Record<string, unknown>;
    const lazyMetadata = { ...((metadata.lazyAsset as Record<string, unknown> | undefined) ?? {}) };
    detailed.userData = {
      ...detailed.userData,
      ...metadata,
      lazyAsset: {
        ...lazyMetadata,
        placeholder: false,
        loaded: true,
      },
    };
    const parent = placeholder.parent
      ?? (container && container !== placeholder ? container : null)
      ?? context.scene;
    const insertIndex = parent ? parent.children.indexOf(placeholder) : -1;
    if (parent) {
      parent.add(detailed);
      if (insertIndex >= 0) {
        parent.children.splice(parent.children.indexOf(detailed), 1);
        parent.children.splice(insertIndex, 0, detailed);
      }
    }
    if (!container || container === placeholder) {
      updateNodeProperties(detailed, node);
    } else {
      updateNodeProperties(container, node);
    }
    detailed.updateMatrixWorld(true);
    placeholder.parent?.remove(placeholder);
    disposeObject(placeholder);
    nodeObjectMap.set(state.nodeId, detailed);
    attachRuntimeForNode(state.nodeId, detailed);
    lazyPlaceholderStates.delete(state.nodeId);
    refreshAnimationControllers(context.scene);
  } catch (error) {
    console.warn('[SceneViewer] 延迟资源加载失败', error);
    lazyPlaceholderStates.delete(state.nodeId);
  }
}

function prepareImportedObjectForPreview(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
    if (!(mesh as any).isMesh && !(mesh as any).isSkinnedMesh) {
      return;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material) {
        return;
      }
      const typed = material as THREE.Material & { side?: number };
      if (typeof typed.side !== 'undefined') {
        typed.side = THREE.DoubleSide;
      }
      typed.needsUpdate = true;
    });
  });
}

function updateNodeProperties(object: THREE.Object3D, node: SceneNode): void {
  if (node.name) {
    object.name = node.name;
  }
  if (node.position) {
    object.position.set(node.position.x, node.position.y, node.position.z);
  }
  if (node.rotation) {
    object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z);
  }
  if (node.scale) {
    object.scale.set(node.scale.x, node.scale.y, node.scale.z);
  }
  const guideboardVisibility = resolveGuideboardInitialVisibility(node);
  if (guideboardVisibility !== null) {
    object.visible = guideboardVisibility;
  } else if (node.editorFlags?.editorOnly) {
    object.visible = false;
  } else if (typeof node.visible === 'boolean') {
    object.visible = node.visible;
  } else {
    object.visible = true;
  }
  updateBehaviorVisibility(node.id, object.visible);
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

function withControlsVerticalFreedom<T>(controls: OrbitControls, callback: () => T): T {
  const { minPolarAngle, maxPolarAngle } = controls;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  try {
    return callback();
  } finally {
    controls.minPolarAngle = minPolarAngle;
    controls.maxPolarAngle = maxPolarAngle;
  }
}

function lockControlsPitchToCurrent(controls: OrbitControls, camera: THREE.PerspectiveCamera): void {
  tempPitchVector.copy(controls.target).sub(camera.position);
  if (tempPitchVector.lengthSq() < 1e-8) {
    return;
  }
  tempSpherical.setFromVector3(tempPitchVector);
  const phi = Math.min(Math.PI - 1e-4, Math.max(1e-4, tempSpherical.phi));
  controls.minPolarAngle = phi;
  controls.maxPolarAngle = phi;
}

function setCameraCaging(enabled: boolean): void {
  if (isCameraCaged.value === enabled) {
    return;
  }
  isCameraCaged.value = enabled;
  const controls = renderContext?.controls;
  if (controls) {
    controls.enabled = !enabled;
    controls.update();
  }
}

function easeInOutCubic(t: number): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function applyCameraWatchTween(deltaSeconds: number): void {
  if (!activeCameraWatchTween || !renderContext || deltaSeconds <= 0) {
    return;
  }
  const tween = activeCameraWatchTween;
  const { controls, camera } = renderContext;
  const duration = tween.duration > 0 ? tween.duration : 0.0001;
  tween.elapsed = Math.min(tween.elapsed + deltaSeconds, tween.duration);
  const eased = easeInOutCubic(Math.min(1, tween.elapsed / duration));
  tempMovementVec.copy(tween.from).lerp(tween.to, eased);
  withControlsVerticalFreedom(controls, () => {
    controls.target.copy(tempMovementVec);
    camera.position.copy(tween.startPosition);
    camera.position.y = HUMAN_EYE_HEIGHT;
    camera.lookAt(controls.target);
    controls.update();
  });
  lockControlsPitchToCurrent(controls, camera);
  if (tween.elapsed >= tween.duration) {
    controls.target.copy(tween.to);
    camera.lookAt(controls.target);
    controls.update();
    lockControlsPitchToCurrent(controls, camera);
    activeCameraWatchTween = null;
  }
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

function resetEffectRuntimeTickers(): void {
  effectRuntimeTickers = [];
  nodeObjectMap.forEach((object) => {
    const userData = object.userData;
    if (userData && Object.prototype.hasOwnProperty.call(userData, '__harmonyGroundLightActive')) {
      delete userData.__harmonyGroundLightActive;
    }
  });
}

function refreshEffectRuntimeTickers(): void {
  resetEffectRuntimeTickers();
  const uniqueTickers = new Set<(delta: number) => void>();
  nodeObjectMap.forEach((object) => {
    const registry = object.userData?.[RUNTIME_REGISTRY_KEY] as Record<string, { tick?: (delta: number) => void; props?: EffectComponentProps }> | undefined;
    if (!registry) {
      return;
    }
    const userData = object.userData ?? (object.userData = {});
    let groundLightSeen = false;
    let groundLightActive = false;
    Object.values(registry).forEach((entry) => {
      const typedEntry = entry as { tick?: (delta: number) => void; props?: EffectComponentProps };
      const props = typedEntry.props;
      if (props?.effectType === 'groundLight') {
        groundLightSeen = true;
        const { showParticles, showBeams, showRings, particleCount } = props.groundLight;
        const hasVisibleParticles = showParticles && particleCount > 0;
        groundLightActive = hasVisibleParticles || showBeams || showRings;
      }
      const tick = typedEntry.tick;
      if (typeof tick === 'function') {
        uniqueTickers.add(tick);
      }
    });
    if (groundLightSeen) {
      userData.__harmonyGroundLightActive = groundLightActive;
    } else if (Object.prototype.hasOwnProperty.call(userData, '__harmonyGroundLightActive')) {
      delete userData.__harmonyGroundLightActive;
    }
  });
  effectRuntimeTickers = uniqueTickers.size ? Array.from(uniqueTickers) : [];
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
  resetEffectRuntimeTickers();
}

function pickDefaultAnimationClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (!Array.isArray(clips) || !clips.length) {
    return null;
  }
  const finite = clips.find((clip) => Number.isFinite(clip.duration) && clip.duration > 0);
  return finite ?? clips[0] ?? null;
}

function playAnimationClip(
  mixer: THREE.AnimationMixer,
  clip: THREE.AnimationClip,
  options: { loop?: boolean } = {},
): THREE.AnimationAction {
  const { loop = false } = options;
  const action = mixer.clipAction(clip);
  action.reset();
  action.enabled = true;
  if (loop) {
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    action.clampWhenFinished = false;
  } else {
    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
  }
  action.play();
  return action;
}

function restartDefaultAnimation(nodeId: string): void {
  const controller = nodeAnimationControllers.get(nodeId);
  if (!controller) {
    return;
  }
  const clip = controller.defaultClip ?? pickDefaultAnimationClip(controller.clips);
  if (!clip) {
    return;
  }
  controller.defaultClip = clip;
  playAnimationClip(controller.mixer, clip, { loop: true });
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
    const defaultClip = pickDefaultAnimationClip(validClips);
    nodeAnimationControllers.set(nodeId, { mixer, clips: validClips, defaultClip });
    if (defaultClip) {
      playAnimationClip(mixer, defaultClip, { loop: true });
    }
  });
  animationMixers = mixers;
  refreshEffectRuntimeTickers();
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
  const desiredDistance = ownerObject
    ? Math.max(DEFAULT_OBJECT_RADIUS, computeObjectBoundingRadius(ownerObject))
    : DEFAULT_OBJECT_RADIUS;
  const destination = focusPoint.clone();
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
  tempVector.normalize().multiplyScalar(desiredDistance);
  destination.add(tempVector);
  destination.y = HUMAN_EYE_HEIGHT;
  const lookTarget = new THREE.Vector3(focusPoint.x, HUMAN_EYE_HEIGHT, focusPoint.z);

  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const durationSeconds = Math.max(0, event.duration ?? 0);
  
  const updateFrame = (alpha: number) => {
    withControlsVerticalFreedom(controls, () => {
      camera.position.lerpVectors(startPosition, destination, alpha);
      controls.target.lerpVectors(startTarget, lookTarget, alpha);
      camera.lookAt(controls.target);
      controls.update();
    });
    lockControlsPitchToCurrent(controls, camera);
  };
  const finalize = () => {
    withControlsVerticalFreedom(controls, () => {
      camera.position.copy(destination);
      controls.target.copy(lookTarget);
      camera.lookAt(controls.target);
      controls.update();
    });
    lockControlsPitchToCurrent(controls, camera);
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
  updateBehaviorVisibility(event.targetNodeId, event.visible);
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
  mixer.stopAllAction();
  const action = playAnimationClip(mixer, clip, { loop: Boolean(event.loop) });
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
    restartDefaultAnimation(targetNodeId);
    resolveBehaviorToken(token, { type: 'continue' });
  };
  const cancel = () => {
    mixer.removeEventListener('finished', onFinished);
    try {
      action.stop();
    } catch (error) {
      console.warn('停止动画失败', error);
    }
    restartDefaultAnimation(targetNodeId);
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

function setCameraViewState(mode: CameraViewMode, targetNodeId: string | null = null): void {
  cameraViewState.mode = mode;
  cameraViewState.targetNodeId = mode === 'watching' ? targetNodeId : null;
}

function isRedundantWatchRequest(targetNodeId: string | null): boolean {
  if (!targetNodeId) {
    return false;
  }
  return cameraViewState.mode === 'watching' && cameraViewState.targetNodeId === targetNodeId;
}

function performWatchFocus(targetNodeId: string | null, caging?: boolean): { success: boolean; message?: string } {
  const context = renderContext;
  if (!context) {
    return { success: false, message: '相机不可用' };
  }
  if (!targetNodeId) {
    return { success: false, message: '缺少观察目标' };
  }
  if (isRedundantWatchRequest(targetNodeId)) {
    setCameraCaging(Boolean(caging));
    purposeActiveMode.value = 'watch';
    setCameraViewState('watching', targetNodeId);
    return { success: true };
  }
  const { camera, controls } = context;
  const focus = resolveNodeFocusPoint(targetNodeId);
  if (!focus) {
    return { success: false, message: '未找到目标节点' };
  }
  const finishSuccess = () => {
    setCameraCaging(Boolean(caging));
    purposeActiveMode.value = 'watch';
    setCameraViewState('watching', targetNodeId);
    return { success: true };
  };
  activeCameraWatchTween = null;
  const startPosition = camera.position.clone();
  if (Math.abs(startPosition.y - HUMAN_EYE_HEIGHT) > 1e-6) {
    startPosition.y = HUMAN_EYE_HEIGHT;
  }
  camera.position.y = HUMAN_EYE_HEIGHT;

  tempMovementVec.copy(focus).sub(startPosition);
  if (tempMovementVec.lengthSq() < 1e-8) {
    withControlsVerticalFreedom(controls, () => {
      controls.target.copy(focus);
      camera.position.copy(startPosition);
      camera.lookAt(focus);
      controls.update();
    });
    lockControlsPitchToCurrent(controls, camera);
    return finishSuccess();
  }

  tempMovementVec.normalize();
  tempForwardVec.copy(tempMovementVec).multiplyScalar(CAMERA_FORWARD_OFFSET).add(startPosition);
  const startTarget = controls.target.clone();
  if (startTarget.distanceToSquared(tempForwardVec) < 1e-6) {
    withControlsVerticalFreedom(controls, () => {
      camera.position.copy(startPosition);
      controls.target.copy(tempForwardVec);
      camera.lookAt(tempForwardVec);
      controls.update();
    });
    lockControlsPitchToCurrent(controls, camera);
    return finishSuccess();
  }

  activeCameraWatchTween = {
    from: startTarget,
    to: tempForwardVec.clone(),
    startPosition,
    duration: CAMERA_WATCH_DURATION,
    elapsed: 0,
  };

  return finishSuccess();
}

function handleWatchNodeEvent(event: Extract<BehaviorRuntimeEvent, { type: 'watch-node' }>) {
  const result = performWatchFocus(event.targetNodeId ?? event.nodeId ?? null, event.caging);
  if (!result.success) {
    resolveBehaviorToken(event.token, { type: 'fail', message: result.message });
    return;
  }
  resolveBehaviorToken(event.token, { type: 'continue' });
}

function showPurposeControls(targetNodeId: string | null, sourceNodeId: string | null): void {
  purposeSourceNodeId.value = sourceNodeId ?? null;
  purposeTargetNodeId.value = targetNodeId ?? sourceNodeId ?? null;
  purposeControlsVisible.value = true;
}

function hidePurposeControls(): void {
  purposeControlsVisible.value = false;
}

function handleShowPurposeControlsEvent(
  event: Extract<BehaviorRuntimeEvent, { type: 'show-purpose-controls' }>,
): void {
  showPurposeControls(event.targetNodeId ?? null, event.nodeId ?? null);
}

function handleHidePurposeControlsEvent(): void {
  hidePurposeControls();
}

function handlePurposeWatchTap(): void {
  const targetNodeId = purposeTargetNodeId.value ?? purposeSourceNodeId.value;
  if (!targetNodeId) {
    uni.showToast({ title: '缺少观察目标', icon: 'none' });
    return;
  }
  const result = performWatchFocus(targetNodeId, true);
  if (!result.success) {
    uni.showToast({ title: result.message || '无法定位观察目标', icon: 'none' });
    return;
  }
}

function handlePurposeResetTap(): void {
  const result = resetCameraToLevelView();
  if (!result.success) {
    uni.showToast({ title: result.message || '相机不可用', icon: 'none' });
    return;
  }
}

function resetCameraToLevelView(): { success: boolean; message?: string } {
  const context = renderContext;
  if (!context) {
    return { success: false, message: '相机不可用' };
  }
  if (cameraViewState.mode === 'level') {
    setCameraCaging(false);
    purposeActiveMode.value = 'level';
    return { success: true };
  }
  const { camera, controls } = context;
  activeCameraWatchTween = null;
  setCameraCaging(false);
  camera.position.y = HUMAN_EYE_HEIGHT;
  const startTarget = controls.target.clone();
  const levelTarget = startTarget.clone();
  levelTarget.y = camera.position.y;
  const finishSuccess = () => {
    purposeActiveMode.value = 'level';
    setCameraViewState('level');
    return { success: true };
  };
  if (startTarget.distanceToSquared(levelTarget) < 1e-6) {
    withControlsVerticalFreedom(controls, () => {
      controls.target.copy(levelTarget);
      camera.lookAt(levelTarget);
      controls.update();
    });
    lockControlsPitchToCurrent(controls, camera);
    return finishSuccess();
  }
  const startPosition = camera.position.clone();
  startPosition.y = HUMAN_EYE_HEIGHT;
  activeCameraWatchTween = {
    from: startTarget,
    to: levelTarget.clone(),
    startPosition,
    duration: CAMERA_LEVEL_DURATION,
    elapsed: 0,
  };
  return finishSuccess();
}

function handleLookLevelEvent(event: Extract<BehaviorRuntimeEvent, { type: 'look-level' }>) {
  const result = resetCameraToLevelView();
  if (!result.success) {
    resolveBehaviorToken(event.token, { type: 'fail', message: result.message });
    return;
  }
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
    case 'show-purpose-controls':
      handleShowPurposeControlsEvent(event);
      break;
    case 'hide-purpose-controls':
      handleHidePurposeControlsEvent();
      break;
    case 'set-visibility':
      handleSetVisibilityEvent(event);
      break;
    case 'look-level':
      handleLookLevelEvent(event);
      break;
    case 'sequence-complete':
      resetLanternOverlay();
      if (event.status === 'failure' || event.status === 'aborted') {
        console.warn('行为序列结束', event);
      }
      break;
    case 'sequence-error':
      resetLanternOverlay();
      console.error('行为序列执行出错', event.message);
      break;
    default:
      break;
  }
}

function ensureBehaviorTapHandler(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera) {
  if (handleBehaviorClick) {
    canvas.removeEventListener('click', handleBehaviorClick);
        handleBehaviorClick = null;
  }
  handleBehaviorClick = (event: MouseEvent | TouchEvent) => {
    if (!renderContext?.scene) {
      return;
    }
    if (!hasRegisteredBehaviors()) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return;
    }
    const width = bounds.width;
    const height = bounds.height;
    let clientX: number;
    let clientY: number;
    if ('touches' in event && event.touches.length) {
      clientX = event.touches[0]!.clientX;
      clientY = event.touches[0]!.clientY;
    } else if ('changedTouches' in event && event.changedTouches.length) {
      clientX = event.changedTouches[0]!.clientX;
      clientY = event.changedTouches[0]!.clientY;
    } else {
      const pointer = event as MouseEvent;
      clientX = pointer.clientX;
      clientY = pointer.clientY;
    }
    behaviorPointer.x = ((clientX - bounds.left) / width) * 2 - 1;
    behaviorPointer.y = -((clientY - bounds.top) / height) * 2 + 1;

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
  canvas.addEventListener('click', handleBehaviorClick);
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

function syncSkyVisibility() {
  if (!sky) {
    return;
  }
  sky.visible = shouldRenderSkyBackground;
}

function setSkyBackgroundEnabled(enabled: boolean) {
  shouldRenderSkyBackground = enabled;
  syncSkyVisibility();
}

function ensureSkyExists() {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return;
  }
  if (sky) {
    if (sky.parent !== scene) {
      scene.add(sky);
    }
    syncSkyVisibility();
    return;
  }
  sky = new Sky();
  sky.name = 'HarmonySky';
  sky.scale.setScalar(SKY_SCALE);
  sky.frustumCulled = false;
  scene.add(sky);
  syncSkyVisibility();
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
  applySunDirectionToSunLight();
}

function ensureSunDirectionalLight(): THREE.DirectionalLight | null {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return null;
  }

  if (!sunDirectionalLight) {
    const light = new THREE.DirectionalLight('#ffffff', 1);
    light.name = 'SkySunLight';
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0001;
    light.shadow.normalBias = 0.02;
    light.shadow.camera.near = 1;
    light.shadow.camera.far = 400;
    light.shadow.camera.left = -200;
    light.shadow.camera.right = 200;
    light.shadow.camera.top = 200;
    light.shadow.camera.bottom = -200;
    sunDirectionalLight = light;
    scene.add(light);
    scene.add(light.target);
  } else {
    if (sunDirectionalLight.parent !== scene) {
      scene.add(sunDirectionalLight);
    }
    if (sunDirectionalLight.target.parent !== scene) {
      scene.add(sunDirectionalLight.target);
    }
  }

  return sunDirectionalLight;
}

function applySunDirectionToSunLight(): void {
  const light = ensureSunDirectionalLight();
  if (!light) {
    return;
  }

  if (skySunPosition.lengthSq() > 1e-6) {
    tempSunDirection.copy(skySunPosition);
  } else {
    tempSunDirection.copy(DEFAULT_SUN_DIRECTION);
  }

  light.position.copy(tempSunDirection).multiplyScalar(SKY_SUN_LIGHT_DISTANCE);
  if (light.position.y < SKY_SUN_LIGHT_MIN_HEIGHT) {
    light.position.y = SKY_SUN_LIGHT_MIN_HEIGHT;
  }
  light.target.position.set(0, 0, 0);
  light.target.updateMatrixWorld();
}

function ensureEnvironmentAmbientLight(): THREE.AmbientLight | null {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return null;
  }
  if (!environmentAmbientLight) {
    environmentAmbientLight = new THREE.AmbientLight(
      DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
      DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
    );
    scene.add(environmentAmbientLight);
  } else if (environmentAmbientLight.parent !== scene) {
    scene.add(environmentAmbientLight);
  }
  return environmentAmbientLight;
}

function applySkyEnvironmentToScene() {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return;
  }
  if (skyEnvironmentTarget) {
    scene.environment = skyEnvironmentTarget.texture;
    scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY;
  } else {
    scene.environment = null;
    scene.environmentIntensity = 1;
  }
}

function disposeBackgroundResources() {
  const scene = renderContext?.scene ?? null;
  const previousTexture = backgroundTexture;
  if (previousTexture) {
    if (scene && scene.background === previousTexture) {
      scene.background = null;
    }
    previousTexture.dispose();
  }
  backgroundTexture = null;
  backgroundTextureCleanup?.();
  backgroundTextureCleanup = null;
  backgroundAssetId = null;
}

function disposeEnvironmentTarget() {
  const scene = renderContext?.scene ?? null;
  if (environmentMapTarget) {
    if (scene && scene.environment === environmentMapTarget.texture) {
      scene.environment = null;
      scene.environmentIntensity = 1;
    }
    environmentMapTarget.dispose();
  }
  environmentMapTarget = null;
  environmentMapAssetId = null;
}

function inferEnvironmentAssetExtension(assetId: string, resolve: ResolvedAssetUrl | null): string {
  const target = (resolve?.url ?? assetId) ?? '';
  const sanitized = target.split('#')[0]?.split('?')[0] ?? '';
  const index = sanitized.lastIndexOf('.');
  if (index === -1) {
    return '';
  }
  return sanitized.slice(index + 1).toLowerCase();
}

async function loadEnvironmentTextureFromAsset(
  assetId: string,
): Promise<{ texture: THREE.Texture; dispose?: () => void } | null> {
  const resolve = await resolveAssetUrlReference(assetId);
  if (!resolve) {
    return null;
  }
  const extension = inferEnvironmentAssetExtension(assetId, resolve);
  try {
    if (extension === 'hdr' || extension === 'hdri') {
      const texture = await rgbeLoader.loadAsync(resolve.url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.flipY = false;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      ensureFloatTextureFilterCompatibility(texture);
      return { texture };
    }
    const texture = await textureLoader.loadAsync(resolve.url);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.flipY = false;
    texture.needsUpdate = true;
    ensureFloatTextureFilterCompatibility(texture);
    return { texture };
  } catch (error) {
    console.warn('[SceneViewer] Failed to load environment texture', assetId, error);
    return null;
  }
}

function applyAmbientLightSettings(settings: EnvironmentSettings) {
  const ambient = ensureEnvironmentAmbientLight();
  if (!ambient) {
    return;
  }
  ambient.color.set(settings.ambientLightColor);
  ambient.intensity = settings.ambientLightIntensity;
}

function applyFogSettings(settings: EnvironmentSettings) {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return;
  }
  if (settings.fogMode === 'none') {
    scene.fog = null;
    return;
  }
  const fogColor = new THREE.Color(settings.fogColor);
  const density = Math.max(0, settings.fogDensity);
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.copy(fogColor);
    scene.fog.density = density;
  } else {
    scene.fog = new THREE.FogExp2(fogColor, density);
  }
}

async function applyBackgroundSettings(
  background: EnvironmentSettings['background'],
): Promise<boolean> {
  const scene = renderContext?.scene ?? null;
  backgroundLoadToken += 1;
  const token = backgroundLoadToken;
  if (!scene) {
    return false;
  }
  if (background.mode === 'skybox') {
    disposeBackgroundResources();
    setSkyBackgroundEnabled(true);
    scene.background = null;
    return true;
  }
  setSkyBackgroundEnabled(false);
  if (background.mode !== 'hdri' || !background.hdriAssetId) {
    disposeBackgroundResources();
    scene.background = new THREE.Color(background.solidColor);
    return true;
  }
  if (backgroundTexture && backgroundAssetId === background.hdriAssetId) {
    scene.background = backgroundTexture;
    return true;
  }
  const loaded = await loadEnvironmentTextureFromAsset(background.hdriAssetId);
  if (!loaded || token !== backgroundLoadToken) {
    if (loaded) {
      loaded.texture.dispose();
      loaded.dispose?.();
    }
    return false;
  }
  disposeBackgroundResources();
  backgroundTexture = loaded.texture;
  backgroundAssetId = background.hdriAssetId;
  backgroundTextureCleanup = loaded.dispose ?? null;
  scene.background = backgroundTexture;
  return true;
}

async function applyEnvironmentMapSettings(
  mapSettings: EnvironmentSettings['environmentMap'],
): Promise<boolean> {
  const scene = renderContext?.scene ?? null;
  const renderer = renderContext?.renderer ?? null;
  environmentMapLoadToken += 1;
  const token = environmentMapLoadToken;
  if (!scene) {
    return false;
  }
  if (mapSettings.mode !== 'custom' || !mapSettings.hdriAssetId) {
    disposeEnvironmentTarget();
    if (mapSettings.mode === 'skybox') {
      applySkyEnvironmentToScene();
    } else {
      scene.environment = null;
      scene.environmentIntensity = 1;
    }
    return true;
  }
  if (!pmremGenerator || !renderer) {
    return false;
  }
  if (environmentMapTarget && environmentMapAssetId === mapSettings.hdriAssetId) {
    scene.environment = environmentMapTarget.texture;
    scene.environmentIntensity = 1;
    return true;
  }
  const loaded = await loadEnvironmentTextureFromAsset(mapSettings.hdriAssetId);
  if (!loaded || token !== environmentMapLoadToken) {
    if (loaded) {
      loaded.texture.dispose();
      loaded.dispose?.();
    }
    return false;
  }
  const target = pmremGenerator.fromEquirectangular(loaded.texture);
  loaded.dispose?.();
  loaded.texture.dispose();
  if (!target || token !== environmentMapLoadToken) {
    target?.dispose();
    return false;
  }
  disposeEnvironmentTarget();
  environmentMapTarget = target;
  environmentMapAssetId = mapSettings.hdriAssetId;
  ensureFloatTextureFilterCompatibility(target.texture);
  scene.environment = target.texture;
  scene.environmentIntensity = 1;
  return true;
}

async function applyEnvironmentSettingsToScene(settings: EnvironmentSettings) {
  const scene = renderContext?.scene ?? null;
  const snapshot = cloneEnvironmentSettingsLocal(settings);
  if (!scene) {
    pendingEnvironmentSettings = snapshot;
    return;
  }
  applyAmbientLightSettings(snapshot);
  applyFogSettings(snapshot);
  const backgroundApplied = await applyBackgroundSettings(snapshot.background);
  const environmentApplied = await applyEnvironmentMapSettings(snapshot.environmentMap);
  if (backgroundApplied && environmentApplied) {
    pendingEnvironmentSettings = null;
  } else {
    pendingEnvironmentSettings = snapshot;
  }
}

function disposeEnvironmentResources() {
  disposeBackgroundResources();
  disposeEnvironmentTarget();
  backgroundLoadToken += 1;
  environmentMapLoadToken += 1;
  pendingEnvironmentSettings = null;
  if (environmentAmbientLight) {
    environmentAmbientLight.parent?.remove(environmentAmbientLight);
    environmentAmbientLight.dispose?.();
    environmentAmbientLight = null;
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
    applySkyEnvironmentToScene();
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
    const previousVisibility = sky.visible;
    sky.visible = true;
    skyEnvironmentTarget = pmremGenerator.fromScene(sky as unknown as THREE.Scene);
    sky.visible = previousVisibility;
    syncSkyVisibility();
  }
  applySkyEnvironmentToScene();
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

function normalizeSceneUrl(raw: string): string {
  if (!raw) {
    return '';
  }
  const trimmed = raw.trim();
  if (!trimmed.length) {
    return '';
  }
  try {
    return decodeURIComponent(trimmed);
  } catch (_error) {
    return trimmed;
  }
}

async function loadSceneFromUrl(url: string): Promise<void> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    error.value = '场景地址不能为空';
    loading.value = false;
    return;
  }
  error.value = null;
  resetSceneDownloadState();
  sceneDownload.active = true;
  sceneDownload.label = '正在下载场景数据…';
  try {
    const document = await requestSceneDocument(normalizedUrl);
    previewPayload.value = {
      document,
      title: document.name || '场景预览',
      origin: normalizedUrl,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  } catch (downloadError) {
    console.error(downloadError);
    const message = downloadError instanceof Error ? downloadError.message : '场景下载失败';
    error.value = message;
    previewPayload.value = null;
    loading.value = false;
  } finally {
    resetSceneDownloadState();
  }
}

function requestSceneDocument(url: string): Promise<SceneJsonExportDocument> {
  return new Promise((resolve, reject) => {
    if (sceneDownloadTask) {
      sceneDownloadTask.abort();
      sceneDownloadTask = null;
    }
    const task = uni.request({
      url,
      method: 'GET',
      responseType: 'text',
      timeout: SCENE_DOWNLOAD_TIMEOUT,
      success: (res) => {
        const statusCode = typeof res.statusCode === 'number' ? res.statusCode : 200;
        if (statusCode >= 400) {
          reject(new Error(`场景下载失败（${statusCode}）`));
          return;
        }
        try {
          const payload = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {});
          const document = parseSceneDocument(payload);
          resolve(document);
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : '场景数据解析失败';
          reject(new Error(message));
        }
      },
      fail: (requestError) => {
        const message =
          requestError && typeof requestError === 'object' && 'errMsg' in requestError
            ? String((requestError as { errMsg: unknown }).errMsg)
            : '场景下载失败';
        reject(new Error(message));
      },
      complete: () => {
        sceneDownloadTask = null;
      },
    }) as SceneRequestTask;
    sceneDownloadTask = task;
    task?.onProgressUpdate?.((info: SceneDownloadProgress) => {
      if (typeof info.progress === 'number' && Number.isFinite(info.progress)) {
        sceneDownload.percent = info.progress;
        sceneDownload.label = `正在下载场景数据… ${Math.max(0, Math.min(100, Math.round(info.progress)))}%`;
      }
      if (typeof info.totalBytesWritten === 'number') {
        sceneDownload.loaded = info.totalBytesWritten;
      }
      if (typeof info.totalBytesExpectedToWrite === 'number') {
        sceneDownload.total = info.totalBytesExpectedToWrite;
      }
    });
  });
}

function resetSceneDownloadState(): void {
  sceneDownload.active = false;
  sceneDownload.loaded = 0;
  sceneDownload.total = 0;
  sceneDownload.percent = 0;
  sceneDownload.label = '正在下载场景数据…';
}

function formatByteSize(value: number): string {
  if (!value || value <= 0) {
    return '0B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)}${units[index]}`;
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
  pendingEnvironmentSettings = cloneEnvironmentSettingsLocal(resolveDocumentEnvironment(payload.document));
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

type MeshStandardTextureKey =
  | 'map'
  | 'normalMap'
  | 'metalnessMap'
  | 'roughnessMap'
  | 'aoMap'
  | 'emissiveMap'
  | 'displacementMap';

const STANDARD_TEXTURE_KEYS: MeshStandardTextureKey[] = [
  'map',
  'normalMap',
  'metalnessMap',
  'roughnessMap',
  'aoMap',
  'emissiveMap',
  'displacementMap',
];

function disposeMaterialTextures(material: THREE.Material | null | undefined): void {
  if (!material) {
    return;
  }
  const standard = material as THREE.MeshStandardMaterial &
    Partial<Record<MeshStandardTextureKey, THREE.Texture | null>>;
  const materialRecord = standard as unknown as Record<string, unknown>;
  STANDARD_TEXTURE_KEYS.forEach((key) => {
    const texture = standard[key];
    if (texture && typeof texture.dispose === 'function') {
      texture.dispose();
    }
    if (key in standard) {
      materialRecord[key] = null;
    }
  });
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => {
          if (!material) {
            return;
          }
          disposeMaterialTextures(material);
          material.dispose?.();
        });
      } else if (mesh.material) {
        disposeMaterialTextures(mesh.material);
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
  if (isCameraCaged.value) {
    return;
  }
  const { camera, controls } = renderContext;
  activeCameraWatchTween = null;
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
  if (isCameraCaged.value) {
    return;
  }
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
  if (canvasResult?.canvas && handleBehaviorClick) {
    canvasResult.canvas.removeEventListener('touchend', handleBehaviorClick);
        handleBehaviorClick = null;
  }
  if (behaviorAlertToken.value) {
    resolveBehaviorToken(behaviorAlertToken.value, {
      type: 'abort',
      message: '视图卸载',
    });
  }
  if (lanternEventToken.value) {
    closeLanternOverlay({ type: 'abort', message: '视图卸载' });
  } else {
    resetLanternOverlay();
  }
  hidePurposeControls();
  setCameraCaging(false);
  previewComponentManager.reset();
  resetBehaviorRuntime();
  resetBehaviorProximity();
  activeBehaviorDelayTimers.forEach((handle) => clearTimeout(handle));
  activeBehaviorDelayTimers.clear();
  resetAnimationControllers();
  previewNodeMap.clear();
  nodeObjectMap.clear();
  lazyPlaceholderStates.clear();
  activeLazyLoadCount = 0;
  activeCameraWatchTween = null;
  frameDeltaMode = null;
  controls.dispose();
  disposeEnvironmentResources();
  disposeSkyResources();
  pmremGenerator?.dispose();
  pmremGenerator = null;
  pendingSkyboxSettings = null;
  lanternTextPromises.clear();
  Object.keys(lanternTextState).forEach((key) => delete lanternTextState[key]);
  resetAssetResolutionCaches();
  disposeObject(scene);
  renderer.dispose();
  sunDirectionalLight = null;
  renderContext = null;
  canvasResult = null;
  currentDocument = null;
  viewerResourceCache = null;
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
  activeCameraWatchTween = null;
  frameDeltaMode = null;
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
  controls.dampingFactor = 0.1;
  controls.target.set(0, HUMAN_EYE_HEIGHT, -CAMERA_FORWARD_OFFSET);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.screenSpacePanning = false;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minPolarAngle = CAMERA_HORIZONTAL_POLAR_ANGLE;
  controls.maxPolarAngle = CAMERA_HORIZONTAL_POLAR_ANGLE;
  controls.minDistance = CAMERA_FORWARD_OFFSET;
  controls.maxDistance = CAMERA_FORWARD_OFFSET;
  controls.enabled = !isCameraCaged.value;

  controls.addEventListener('start', () => {
    activeCameraWatchTween = null;
  });

  controls.update();
  lockControlsPitchToCurrent(controls, camera);
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
  activeCameraWatchTween = null;
  const { canvas } = result;
  currentDocument = payload.document;
  resetAssetResolutionCaches();
  const environmentSettings = resolveDocumentEnvironment(payload.document);
  if (behaviorAlertToken.value) {
    resolveBehaviorToken(behaviorAlertToken.value, {
      type: 'abort',
      message: '场景重新初始化',
    });
  }
  if (lanternEventToken.value) {
    closeLanternOverlay({ type: 'abort', message: '场景重新初始化' });
  } else {
    resetLanternOverlay();
  }
  hidePurposeControls();
  disposeEnvironmentResources();
  pendingEnvironmentSettings = cloneEnvironmentSettingsLocal(environmentSettings);
  scene.children.forEach((child) => disposeObject(child));
  scene.clear();
  sunDirectionalLight = null;
  warnings.value = [];

  const ambientLight = ensureEnvironmentAmbientLight();
  if (ambientLight) {
    ambientLight.color.set(DEFAULT_ENVIRONMENT_AMBIENT_COLOR);
    ambientLight.intensity = DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY;
  }

  applySunDirectionToSunLight();

  const hemisphericLight = new THREE.HemisphereLight('#d4d8ff', '#f5f2ef', 0.3);
  scene.add(hemisphericLight);

  ensureSkyExists();

  resourcePreload.active = true;
  resourcePreload.loaded = 0;
  resourcePreload.total = 0;
  resourcePreload.loadedBytes = 0;
  resourcePreload.totalBytes = 0;
  resourcePreload.label = '准备加载资源...';
  const summary = payload.document.resourceSummary;
  if (summary) {
    const totalBytes = typeof summary.totalBytes === 'number' && Number.isFinite(summary.totalBytes) && summary.totalBytes > 0
      ? summary.totalBytes
      : 0;
    const embeddedBytes = typeof summary.embeddedBytes === 'number' && Number.isFinite(summary.embeddedBytes) && summary.embeddedBytes >= 0
      ? summary.embeddedBytes
      : 0;
    resourcePreload.totalBytes = totalBytes;
    resourcePreload.loadedBytes = totalBytes > 0 ? Math.min(embeddedBytes, totalBytes) : embeddedBytes;
    if (Array.isArray(summary.assets)) {
      resourcePreload.total = summary.assets.length;
    }
  }

  let graph: Awaited<ReturnType<typeof buildSceneGraph>> | null = null;
  try {
    const buildOptions: SceneGraphBuildOptions = {
      enableGround: payload.enableGround ?? true,
      lazyLoadMeshes: true,
      materialFactoryOptions: {
        hdrLoader: rgbeLoader,
      },
      onProgress: (info) => {
        console.log('[SceneViewer] Resource load progress', info);
        resourcePreload.total = info.total;
        resourcePreload.loaded = info.loaded;
        if (typeof info.bytesTotal === 'number' && Number.isFinite(info.bytesTotal) && info.bytesTotal > 0) {
          resourcePreload.totalBytes = info.bytesTotal;
        }
        if (typeof info.bytesLoaded === 'number' && Number.isFinite(info.bytesLoaded) && info.bytesLoaded >= 0) {
          resourcePreload.loadedBytes = info.bytesLoaded;
        }
        const fallbackLabel = info.assetId ? `加载 ${info.assetId}` : '正在加载资源';
        resourcePreload.label = info.message || fallbackLabel;
        const stillLoadingByCount = info.total > 0 && info.loaded < info.total;
        const stillLoadingByBytes = resourcePreload.totalBytes > 0 && resourcePreload.loadedBytes < resourcePreload.totalBytes;
        resourcePreload.active = stillLoadingByCount || stillLoadingByBytes;
      },
    };
    if (payload.assetOverrides) {
      buildOptions.assetOverrides = payload.assetOverrides;
    }
    if (payload.resolveAssetUrl) {
      buildOptions.resolveAssetUrl = payload.resolveAssetUrl;
    }
  const resourceCache = ensureResourceCache(payload.document, buildOptions);
  viewerResourceCache = resourceCache;
  graph = await buildSceneGraph(payload.document, resourceCache, buildOptions);
  } finally {
    const fullyLoadedByCount = resourcePreload.total > 0 && resourcePreload.loaded >= resourcePreload.total;
    const fullyLoadedByBytes = resourcePreload.totalBytes > 0 && resourcePreload.loadedBytes >= resourcePreload.totalBytes;
    if (!resourcePreload.active || fullyLoadedByCount || fullyLoadedByBytes) {
      if (resourcePreload.total > 0) {
        resourcePreload.loaded = resourcePreload.total;
      }
      if (resourcePreload.totalBytes > 0) {
        resourcePreload.loadedBytes = resourcePreload.totalBytes;
      }
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
  initializeLazyPlaceholders(payload.document);


  const skyboxSettings = resolveSceneSkybox(payload.document);
  applySkyboxSettings(skyboxSettings);
  if (pendingSkyboxSettings) {
    applySkyboxSettings(pendingSkyboxSettings);
  }

  void applyEnvironmentSettingsToScene(environmentSettings);

  const width = canvas.width || canvas.clientWidth || 1;
  const height = canvas.height || canvas.clientHeight || 1;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  scope.run(() => {
    watchEffect((onCleanup) => {
      const { cancel } = result.useFrame((delta) => {
        const deltaSeconds = normalizeFrameDelta(delta);
        if (activeCameraWatchTween && deltaSeconds > 0) {
          applyCameraWatchTween(deltaSeconds);
        } else {
          controls.update();
        }
        if (deltaSeconds > 0) {
          animationMixers.forEach((mixer) => mixer.update(deltaSeconds));
          effectRuntimeTickers.forEach((tick) => {
            try {
              tick(deltaSeconds);
            } catch (error) {
              console.warn('更新特效动画失败', error);
            }
          });
        }
        updateBehaviorProximity();
        updateLazyPlaceholders(deltaSeconds);
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
  refreshLanternViewportSize();
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
  (globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
    DISPLAY_BOARD_RESOLVER_KEY
  ] = resolveDisplayBoardMediaSource;
  addBehaviorRuntimeListener(behaviorRuntimeListener);
  const sceneIdParam = typeof query?.id === 'string' ? query.id : '';
  const documentParam = typeof query?.document === 'string' ? query.document : '';
  const modelParam =
    typeof query?.asset === 'string'
      ? query.asset
      : typeof query?.model === 'string'
        ? query.model
        : '';
  const sceneUrlParamRaw = typeof query?.sceneUrl === 'string' ? query.sceneUrl : '';
  const sceneUrlParam = normalizeSceneUrl(sceneUrlParamRaw);

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
    const targetUrl = sceneUrlParam || DEFAULT_SCENE_URL;
    if (targetUrl) {
      requestedMode.value = 'document';
      loading.value = true;
      void loadSceneFromUrl(targetUrl);
    } else {
      requestedMode.value = null;
      error.value = '缺少场景数据';
      loading.value = false;
    }
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
  if (sceneDownloadTask) {
    sceneDownloadTask.abort();
    sceneDownloadTask = null;
  }
  resetSceneDownloadState();
  sharedResourceCache = null;
  lanternViewerInstance = null;
  (globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
    DISPLAY_BOARD_RESOLVER_KEY
  ] = undefined;
});

onUnmounted(() => {
  removeBehaviorRuntimeListener(behaviorRuntimeListener);
  teardownRenderer();
  if (resizeListener) {
    uni.offWindowResize(handleResize);
    resizeListener = null;
  }
  if (sceneDownloadTask) {
    sceneDownloadTask.abort();
    sceneDownloadTask = null;
  }
  resetSceneDownloadState();
  sharedResourceCache = null;
  (globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
    DISPLAY_BOARD_RESOLVER_KEY
  ] = undefined;
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

.viewer-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 80%;
  max-width: 320px;
}
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

.viewer-overlay__card {
  width: 100%;
  background: rgba(20, 22, 34, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 24px 22px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(14px);
}

.viewer-overlay__title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.4px;
}

.viewer-progress {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.viewer-progress__bar {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.12);
}

.viewer-progress__bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: inherit;
  transition: width 0.35s ease;
  background-image: linear-gradient(90deg, rgba(94, 161, 255, 0.25) 0%, rgba(94, 161, 255, 0.75) 45%, rgba(188, 120, 255, 0.86) 100%);
  background-size: 200% 100%;
  animation: viewer-progress-fill 1.8s linear infinite;
}

@keyframes viewer-progress-fill {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: -200% 50%;
  }
}

.viewer-progress__stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.viewer-progress__percent {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.viewer-progress__bytes {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}

.viewer-overlay__caption {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
  text-align: center;
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
  position: relative;
  width: auto;
  max-width: min(620px, 92vw);
  max-height: 90vh;
  border-radius: 16px;
  background: rgba(12, 16, 28, 0.96);
  color: #f5f7ff;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  touch-action: pan-y;
}

.viewer-lantern-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background-color: rgba(15, 18, 30, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.viewer-lantern-close:active {
  opacity: 0.8;
}

.viewer-lantern-close-icon {
  width: 18px;
  height: 18px;
}

.viewer-lantern-image-wrapper {
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  flex-shrink: 0;
}

.viewer-lantern-image {
  width: 100%;
  height: 100%;
  display: block;
}

.viewer-lantern-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
}

.viewer-lantern-title {
  font-size: 18px;
  font-weight: 600;
}

.viewer-lantern-text {
  max-height: 32vh;
  padding-right: 4px;
  flex: 1 1 auto;
}

.viewer-lantern-text text {
  display: block;
  font-size: 14px;
  line-height: 1.5;
  opacity: 0.92;
}

.viewer-lantern-indicator {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.viewer-lantern-counter {
  font-size: 12px;
  opacity: 0.72;
  letter-spacing: 0.5px;
}

.viewer-purpose-controls {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-end;
  z-index: 1600;
}

.viewer-purpose-chip {
  position: relative;
  min-width: 160px;
  min-height: 64px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 18px;
  background-color: transparent;
  overflow: hidden;
  display: flex;
  align-items: stretch;
  justify-content: center;
  color: #ffffff;
  opacity: 0.92;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.38);
  transition: transform 0.28s ease, box-shadow 0.28s ease, opacity 0.28s ease;
  text-align: left;
  flex: 1 1 0;
}

.viewer-purpose-chip--watch {
  margin-right: auto;
}

.viewer-purpose-chip--level {
  margin-left: auto;
}

.viewer-purpose-chip__halo {
  position: absolute;
  inset: -24%;
  border-radius: 28px;
  opacity: 0.55;
  pointer-events: none;
  transition: opacity 0.28s ease;
}

.viewer-purpose-chip__content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  padding: 14px 20px;
  border-radius: 16px;
  background: rgba(10, 15, 32, 0.85);
}

.viewer-purpose-chip__icon-wrap {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 12, 26, 0.7);
  overflow: hidden;
}

.viewer-purpose-chip__icon-pulse {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  opacity: 0.35;
  animation: viewer-purpose-icon-pulse 3.2s ease-in-out infinite;
  pointer-events: none;
}

.viewer-purpose-chip__icon {
  width: 22px;
  height: 22px;
  z-index: 1;
}

.viewer-purpose-chip__texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.viewer-purpose-chip__title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 1px;
  line-height: 1.1;
}

.viewer-purpose-chip__subtitle {
  font-size: 12px;
  line-height: 1.3;
  opacity: 0.85;
  letter-spacing: 0.5px;
}

.viewer-purpose-chip--watch .viewer-purpose-chip__content {
  background: linear-gradient(135deg, rgba(34, 98, 255, 0.92), rgba(10, 196, 254, 0.66));
  box-shadow: inset 0 0 18px rgba(68, 183, 255, 0.55);
}

.viewer-purpose-chip--watch .viewer-purpose-chip__halo {
  background: linear-gradient(125deg, rgba(40, 110, 255, 0.55), rgba(13, 216, 255, 0.25), rgba(14, 35, 78, 0));
  animation: viewer-purpose-watch-halo 7s linear infinite;
}

.viewer-purpose-chip--watch .viewer-purpose-chip__icon-wrap {
  background: rgba(7, 33, 86, 0.72);
}

.viewer-purpose-chip--watch .viewer-purpose-chip__icon-pulse {
  border-color: rgba(173, 230, 255, 0.85);
  box-shadow: 0 0 16px rgba(76, 198, 255, 0.7);
}

.viewer-purpose-chip--watch .viewer-purpose-chip__title {
  text-shadow: 0 0 8px rgba(77, 197, 255, 0.8);
}

.viewer-purpose-chip--watch .viewer-purpose-chip__subtitle {
  color: rgba(224, 247, 255, 0.95);
}

.viewer-purpose-chip--level .viewer-purpose-chip__content {
  background: linear-gradient(135deg, rgba(45, 255, 190, 0.85), rgba(22, 89, 163, 0.75));
  box-shadow: inset 0 0 16px rgba(48, 255, 198, 0.5);
}

.viewer-purpose-chip--level .viewer-purpose-chip__halo {
  background: linear-gradient(140deg, rgba(38, 255, 197, 0.38), rgba(22, 125, 255, 0.18), rgba(5, 18, 36, 0));
  animation: viewer-purpose-level-halo 5s ease-in-out infinite;
}

.viewer-purpose-chip--level .viewer-purpose-chip__icon-wrap {
  background: rgba(3, 28, 35, 0.7);
}

.viewer-purpose-chip--level .viewer-purpose-chip__icon-pulse {
  border-color: rgba(168, 255, 226, 0.85);
  box-shadow: 0 0 14px rgba(64, 255, 200, 0.65);
}

.viewer-purpose-chip--level .viewer-purpose-chip__title {
  text-shadow: 0 0 8px rgba(94, 255, 211, 0.8);
}

.viewer-purpose-chip--level .viewer-purpose-chip__subtitle {
  color: rgba(219, 255, 243, 0.92);
}

.viewer-purpose-chip.is-active {
  transform: none;
  opacity: 1;
  box-shadow: none;
}

.viewer-purpose-chip.is-active::after {
  content: '';
  position: absolute;
  inset: -10px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  background: radial-gradient(circle, rgba(136, 222, 255, 0.45) 0%, rgba(136, 222, 255, 0.08) 60%, transparent 100%);
  box-shadow:
    0 0 32px rgba(118, 212, 255, 0.45),
    0 0 64px rgba(118, 212, 255, 0.28);
  opacity: 0.95;
  transform-origin: center;
  animation: viewer-purpose-active-glow 3.2s ease-in-out infinite;
  pointer-events: none;
}

.viewer-purpose-chip.is-active .viewer-purpose-chip__content {
  filter: brightness(1.15) saturate(1.08);
  box-shadow:
    inset 0 0 24px rgba(255, 255, 255, 0.18),
    0 0 22px rgba(120, 207, 255, 0.35);
}

.viewer-purpose-chip.is-active .viewer-purpose-chip__halo {
  opacity: 1;
  filter: saturate(1.15);
}

.viewer-purpose-chip.is-active .viewer-purpose-chip__subtitle {
  opacity: 0.98;
}

.viewer-purpose-chip.is-active .viewer-purpose-chip__icon-pulse {
  animation-duration: 1.8s;
}

.viewer-purpose-chip:active {
  transform: scale(0.97);
}

@keyframes viewer-purpose-icon-pulse {
  0%, 100% {
    opacity: 0.25;
    transform: scale(0.92);
  }
  45% {
    opacity: 0.85;
    transform: scale(1);
  }
  70% {
    opacity: 0.4;
    transform: scale(1.08);
  }
}

@keyframes viewer-purpose-watch-halo {
  0% {
    transform: rotate(0deg) scale(1);
  }
  50% {
    transform: rotate(180deg) scale(1.05);
  }
  100% {
    transform: rotate(360deg) scale(1);
  }
}

@keyframes viewer-purpose-level-halo {
  0%, 100% {
    opacity: 0.45;
    transform: scale(1);
  }
  50% {
    opacity: 0.9;
    transform: scale(1.08);
  }
}

@keyframes viewer-purpose-active-glow {
  0% {
    opacity: 0.65;
    transform: scale(0.94);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
  100% {
    opacity: 0.65;
    transform: scale(0.94);
  }
}
</style>
