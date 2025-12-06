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
      <view
        v-if="vehicleDrivePrompt.visible"
        class="viewer-drive-start"
      >
        <button
          class="viewer-drive-start__button"
          :class="{ 'is-busy': vehicleDrivePrompt.busy }"
          :disabled="vehicleDrivePrompt.busy"
          type="default"
          hover-class="none"
          @tap="handleVehicleDrivePromptTap"
        >
          <view class="viewer-drive-start__label">
            <text class="viewer-drive-start__title">驾驶车辆</text>
            <text class="viewer-drive-start__subtitle">{{ vehicleDrivePrompt.label }}</text>
          </view>
          <view class="viewer-drive-start__status">
            <text v-if="vehicleDrivePrompt.busy">准备中…</text>
            <text v-else>点击开始</text>
          </view>
        </button>
      </view>
      <view
        v-if="vehicleDriveUi.visible"
        class="viewer-drive-panel"
      >
        <view class="viewer-drive-header">
          <view class="viewer-drive-title">
            <text class="viewer-drive-title__text">驾驶车辆</text>
          </view>
          <text class="viewer-drive-node">{{ vehicleDriveUi.label }}</text>
        </view>
        <view class="viewer-drive-controls">
          <view class="viewer-drive-steering-column">
            <view
              id="viewer-steering-wheel"
              ref="steeringWheelRef"
              class="viewer-drive-steering-wheel"
              :style="vehicleSteeringWheelStyle"
              role="slider"
              aria-label="方向盘"
              aria-valuemin="-135"
              aria-valuemax="135"
              :aria-valuenow="Math.round(vehicleDriveInput.steering * 135)"
              @touchstart.stop.prevent="handleSteeringWheelTouchStart"
              @touchmove.stop.prevent="handleSteeringWheelTouchMove"
              @touchend.stop.prevent="handleSteeringWheelTouchEnd"
              @touchcancel.stop.prevent="handleSteeringWheelTouchEnd"
            >
              <view class="viewer-drive-steering-spokes"></view>
              <view class="viewer-drive-steering-hub">
                <text>{{ vehicleSteeringAngleLabel }}</text>
              </view>
            </view>
            <button
              class="viewer-drive-camera-toggle"
              type="default"
              hover-class="none"
              @tap="handleVehicleDriveCameraToggle"
            >
              <text>{{ vehicleDriveCameraToggleLabel }}</text>
            </button>
          </view>
          <view class="viewer-drive-grid-column">
            <view class="viewer-drive-grid">
              <view
                class="viewer-drive-button viewer-drive-button--wide"
                :class="{ 'is-active': vehicleDriveUi.forwardActive }"
                role="button"
                @touchstart.stop.prevent="handleVehicleDriveControlTouch('forward', true, $event)"
                @touchend.stop.prevent="handleVehicleDriveControlTouch('forward', false, $event)"
                @touchcancel.stop.prevent="handleVehicleDriveControlTouch('forward', false, $event)"
              >
                <text>前进</text>
              </view>
              <view
                class="viewer-drive-button viewer-drive-button--wide"
                :class="{ 'is-active': vehicleDriveUi.leftActive }"
                role="button"
                @touchstart.stop.prevent="handleVehicleDriveControlTouch('left', true, $event)"
                @touchend.stop.prevent="handleVehicleDriveControlTouch('left', false, $event)"
                @touchcancel.stop.prevent="handleVehicleDriveControlTouch('left', false, $event)"
              >
                <text>左转</text>
              </view>
              <view
                class="viewer-drive-button viewer-drive-button--brake"
                :class="{ 'is-active': vehicleDriveUi.brakeActive }"
                role="button"
                @touchstart.stop.prevent="handleVehicleDriveControlTouch('brake', true, $event)"
                @touchend.stop.prevent="handleVehicleDriveControlTouch('brake', false, $event)"
                @touchcancel.stop.prevent="handleVehicleDriveControlTouch('brake', false, $event)"
              >
                <text>刹车</text>
              </view>
              <view
                class="viewer-drive-button"
                :class="{ 'is-active': vehicleDriveUi.rightActive }"
                role="button"
                @touchstart.stop.prevent="handleVehicleDriveControlTouch('right', true, $event)"
                @touchend.stop.prevent="handleVehicleDriveControlTouch('right', false, $event)"
                @touchcancel.stop.prevent="handleVehicleDriveControlTouch('right', false, $event)"
              >
                <text>右转</text>
              </view>
              <view
                class="viewer-drive-button"
                :class="{ 'is-active': vehicleDriveUi.backwardActive }"
                role="button"
                @touchstart.stop.prevent="handleVehicleDriveControlTouch('backward', true, $event)"
                @touchend.stop.prevent="handleVehicleDriveControlTouch('backward', false, $event)"
                @touchcancel.stop.prevent="handleVehicleDriveControlTouch('backward', false, $event)"
              >
                <text>后退</text>
              </view>
            </view>
            <button
              class="viewer-drive-reset"
              :class="{ 'is-busy': vehicleDriveResetBusy }"
              type="default"
              hover-class="none"
              :disabled="vehicleDriveResetBusy"
              @tap="handleVehicleDriveResetTap"
            >
              <text>{{ vehicleDriveResetBusy ? '重置中…' : '重置车辆' }}</text>
            </button>
          </view>
        </view>
        <button
          class="viewer-drive-exit"
          :class="{ 'is-busy': vehicleDriveExitBusy }"
          :disabled="vehicleDriveExitBusy"
          type="default"
          hover-class="none"
          @tap="handleVehicleDriveExitTap"
        >
          <text class="viewer-drive-exit__text">{{ vehicleDriveExitBusy ? '请稍候…' : '下车' }}</text>
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
import { effectScope, watchEffect, ref, computed, onUnmounted, watch, reactive, nextTick, getCurrentInstance, type ComponentPublicInstance } from 'vue';
import { onLoad, onUnload, onReady } from '@dcloudio/uni-app';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';
import PlatformCanvas from '@/components/PlatformCanvas.vue';
import type { StoredSceneEntry } from '@/stores/sceneStore';
import { parseSceneDocument, useSceneStore } from '@/stores/sceneStore';
import { buildSceneGraph, type SceneGraphBuildOptions, type SceneGraphResourceProgress } from '@schema/sceneGraph';
import ResourceCache from '@schema/ResourceCache';
import { AssetCache, AssetLoader, type AssetCacheEntry } from '@schema/assetCache';
import { buildGroundHeightfieldData, isGroundDynamicMesh, type GroundHeightfieldData } from '@schema/groundHeightfield';
import { loadNodeObject } from '@schema/modelAssetLoader';
import {
  getCachedModelObject,
  getOrLoadModelObject,
  subscribeInstancedMeshes,
  ensureInstancedMeshesRegistered,
  allocateModelInstance,
  releaseModelInstance,
  updateModelInstanceMatrix,
  findNodeIdForInstance,
  type ModelInstanceGroup,
} from '@schema/modelObjectCache';
import type Viewer from 'viewerjs';
import type { ViewerOptions } from 'viewerjs';
import {
  ENVIRONMENT_NODE_ID,
  type EnvironmentSettings,
  type SceneNode,
  type SceneNodeComponentState,
  type SceneSkyboxSettings,
  type SceneJsonExportDocument,
  type LanternSlideDefinition,
  type SceneMaterialTextureRef,
  type GroundDynamicMesh,
  type Vector3Like,
} from '@harmony/schema';
import type { TerrainScatterStoreSnapshot, TerrainScatterInstance } from '@harmony/schema/terrain-scatter';
import { ComponentManager } from '@schema/components/componentManager';
import {
  behaviorComponentDefinition,
  guideboardComponentDefinition,
  displayBoardComponentDefinition,
  wallComponentDefinition,
  viewPointComponentDefinition,
  warpGateComponentDefinition,
  effectComponentDefinition,
  rigidbodyComponentDefinition,
  vehicleComponentDefinition,
  WARP_GATE_RUNTIME_REGISTRY_KEY,
  WARP_GATE_EFFECT_ACTIVE_FLAG,
  GUIDEBOARD_RUNTIME_REGISTRY_KEY,
  GUIDEBOARD_EFFECT_ACTIVE_FLAG,
  GUIDEBOARD_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  VEHICLE_COMPONENT_TYPE,
  clampGuideboardComponentProps,
  computeGuideboardEffectActive,
  clampVehicleComponentProps,
  DEFAULT_LINEAR_DAMPING,
  DEFAULT_ANGULAR_DAMPING,
  DEFAULT_RIGIDBODY_RESTITUTION,
  DEFAULT_RIGIDBODY_FRICTION,
  DEFAULT_DIRECTION,
  DEFAULT_AXLE,
} from '@schema/components';
import type {
  GuideboardComponentProps,
  WarpGateComponentProps,
  RigidbodyComponentProps,
  RigidbodyComponentMetadata,
  RigidbodyPhysicsShape,
  RigidbodyVector3Tuple,
  VehicleComponentProps,
  VehicleWheelProps,
} from '@schema/components';
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
import {
  applyMaterialOverrides,
  disposeMaterialOverrides,
  type MaterialTextureAssignmentOptions,
} from '@schema/material';
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
const exrLoader = new EXRLoader().setDataType(DEFAULT_RGBE_DATA_TYPE);
const textureLoader = new THREE.TextureLoader();
const materialTextureCache = new Map<string, THREE.Texture>();
const pendingMaterialTextureRequests = new Map<string, Promise<THREE.Texture | null>>();

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
const DEFAULT_ENVIRONMENT_GRAVITY = 9.81;
const DEFAULT_ENVIRONMENT_RESTITUTION = 0.2;
const DEFAULT_ENVIRONMENT_FRICTION = 0.3;
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
  gravityStrength: DEFAULT_ENVIRONMENT_GRAVITY,
  collisionRestitution: DEFAULT_ENVIRONMENT_RESTITUTION,
  collisionFriction: DEFAULT_ENVIRONMENT_FRICTION,
};
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
let sceneGraphRoot: THREE.Object3D | null = null;
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

function resolveTextureExtension(entry: AssetCacheEntry | null, ref: SceneMaterialTextureRef): string {
  const candidates = [entry?.filename, entry?.downloadUrl, entry?.blobUrl, ref.assetId, ref.name];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(candidate);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  return '';
}

async function resolveMaterialTexture(ref: SceneMaterialTextureRef): Promise<THREE.Texture | null> {
  const cacheKey = ref.assetId?.trim();
  if (!cacheKey) {
    return null;
  }
  if (materialTextureCache.has(cacheKey)) {
    return materialTextureCache.get(cacheKey) ?? null;
  }
  if (pendingMaterialTextureRequests.has(cacheKey)) {
    return pendingMaterialTextureRequests.get(cacheKey) ?? null;
  }

  const pending = (async (): Promise<THREE.Texture | null> => {
    const resourceCache = viewerResourceCache ?? sharedResourceCache;
    if (!resourceCache) {
      return null;
    }
    const entry = await resourceCache.acquireAssetEntry(cacheKey);
    if (!entry) {
      return null;
    }
    const source = entry.blobUrl ?? entry.downloadUrl ?? '';
    if (!source) {
      return null;
    }

    const extension = resolveTextureExtension(entry, ref);
    try {
      let texture: THREE.Texture;
      if (extension === 'exr') {
        texture = await exrLoader.loadAsync(source);
      } else if (extension === 'hdr' || extension === 'hdri' || extension === 'rgbe') {
        texture = await rgbeLoader.loadAsync(source);
      } else {
        texture = await textureLoader.loadAsync(source);
      }
      texture.name = ref.name ?? entry.filename ?? cacheKey;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      ensureFloatTextureFilterCompatibility(texture);
      texture.needsUpdate = true;
      materialTextureCache.set(cacheKey, texture);
      return texture;
    } catch (error) {
      console.warn('[SceneViewer] Failed to load material texture', cacheKey, error);
      return null;
    }
  })();

  pendingMaterialTextureRequests.set(cacheKey, pending);
  try {
    const texture = await pending;
    if (!texture) {
      materialTextureCache.delete(cacheKey);
    }
    return texture;
  } finally {
    pendingMaterialTextureRequests.delete(cacheKey);
  }
}

const materialOverrideOptions: MaterialTextureAssignmentOptions = {
  resolveTexture: resolveMaterialTexture,
  warn: (message) => {
    if (message) {
      console.warn('[SceneViewer]', message);
    }
  },
};

function disposeMaterialTextureCache(): void {
  materialTextureCache.forEach((texture) => texture.dispose?.());
  materialTextureCache.clear();
  pendingMaterialTextureRequests.clear();
}

const previewComponentManager = new ComponentManager();
previewComponentManager.registerDefinition(wallComponentDefinition);
previewComponentManager.registerDefinition(guideboardComponentDefinition);
previewComponentManager.registerDefinition(displayBoardComponentDefinition);
previewComponentManager.registerDefinition(viewPointComponentDefinition);
previewComponentManager.registerDefinition(warpGateComponentDefinition);
previewComponentManager.registerDefinition(effectComponentDefinition);
previewComponentManager.registerDefinition(behaviorComponentDefinition);
previewComponentManager.registerDefinition(rigidbodyComponentDefinition);
previewComponentManager.registerDefinition(vehicleComponentDefinition);

const previewNodeMap = new Map<string, SceneNode>();
const assetNodeIdMap = new Map<string, Set<string>>();
const instancedMeshGroup = new THREE.Group();
instancedMeshGroup.name = 'InstancedMeshes';
const instancedMeshes: THREE.InstancedMesh[] = [];
let stopInstancedMeshSubscription: (() => void) | null = null;
const instancedMatrixHelper = new THREE.Matrix4();
const instancedPositionHelper = new THREE.Vector3();
const instancedQuaternionHelper = new THREE.Quaternion();
const instancedScaleHelper = new THREE.Vector3();
const physicsPositionHelper = new THREE.Vector3();
const physicsQuaternionHelper = new THREE.Quaternion();
const physicsScaleHelper = new THREE.Vector3();
const syncBodyQuaternionHelper = new THREE.Quaternion();
const bodyQuaternionHelper = new THREE.Quaternion();
const instancedBoundsBox = new THREE.Box3();
const instancedBoundsMin = new THREE.Vector3();
const instancedBoundsMax = new THREE.Vector3();
const nodeObjectMap = new Map<string, THREE.Object3D>();
const scatterInstanceNodeIds = new Set<string>();
const scatterLocalPositionHelper = new THREE.Vector3();
const scatterLocalRotationHelper = new THREE.Euler();
const scatterLocalScaleHelper = new THREE.Vector3();
const scatterQuaternionHelper = new THREE.Quaternion();
const scatterInstanceMatrixHelper = new THREE.Matrix4();
const scatterMatrixHelper = new THREE.Matrix4();
type RigidbodyOrientationAdjustment = {
  cannon: CANNON.Quaternion;
  cannonInverse: CANNON.Quaternion;
  three: THREE.Quaternion;
  threeInverse: THREE.Quaternion;
};
type RigidbodyInstance = {
  nodeId: string;
  body: CANNON.Body;
  object: THREE.Object3D | null;
  orientationAdjustment: RigidbodyOrientationAdjustment | null;
};
let physicsWorld: CANNON.World | null = null;
const rigidbodyInstances = new Map<string, RigidbodyInstance>();
type RigidbodyMaterialEntry = { material: CANNON.Material; friction: number; restitution: number };
const rigidbodyMaterialCache = new Map<string, RigidbodyMaterialEntry>();
const rigidbodyContactMaterialKeys = new Set<string>();
type VehicleInstance = {
  nodeId: string;
  vehicle: CANNON.RaycastVehicle;
  wheelCount: number;
  steerableWheelIndices: number[];
  axisRightIndex: 0 | 1 | 2;
  axisUpIndex: 0 | 1 | 2;
  axisForwardIndex: 0 | 1 | 2;
  axisRight: THREE.Vector3;
  axisUp: THREE.Vector3;
  axisForward: THREE.Vector3;
};
const vehicleInstances = new Map<string, VehicleInstance>();
type GroundHeightfieldCacheEntry = { signature: string; shape: CANNON.Heightfield; offset: [number, number, number] };
const groundHeightfieldCache = new Map<string, GroundHeightfieldCacheEntry>();
const groundHeightfieldOrientation = new CANNON.Quaternion();
groundHeightfieldOrientation.setFromEuler(-Math.PI / 2, 0, 0);
const groundHeightfieldOrientationInverse = new CANNON.Quaternion(
  -groundHeightfieldOrientation.x,
  -groundHeightfieldOrientation.y,
  -groundHeightfieldOrientation.z,
  groundHeightfieldOrientation.w,
);
const groundHeightfieldOrientationThree = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const groundHeightfieldOrientationThreeInverse = groundHeightfieldOrientationThree.clone().invert();
const groundHeightfieldOrientationAdjustment: RigidbodyOrientationAdjustment = {
  cannon: groundHeightfieldOrientation,
  cannonInverse: groundHeightfieldOrientationInverse,
  three: groundHeightfieldOrientationThree,
  threeInverse: groundHeightfieldOrientationThreeInverse,
};
const heightfieldShapeOffsetHelper = new CANNON.Vec3();
const physicsGravity = new CANNON.Vec3(0, -DEFAULT_ENVIRONMENT_GRAVITY, 0);
let physicsContactRestitution = DEFAULT_ENVIRONMENT_RESTITUTION;
let physicsContactFriction = DEFAULT_ENVIRONMENT_FRICTION;
const PHYSICS_FIXED_TIMESTEP = 1 / 60;
const PHYSICS_MAX_SUB_STEPS = 5;

const behaviorRaycaster = new THREE.Raycaster();
const behaviorPointer = new THREE.Vector2();
let handleBehaviorClick: ((event: MouseEvent | TouchEvent) => void) | null = null;

const WHEEL_MOVE_STEP = 1.2;
const worldUp = new THREE.Vector3(0, 1, 0);
const tempForwardVec = new THREE.Vector3();
const tempRightVec = new THREE.Vector3();
const tempMovementVec = new THREE.Vector3();
const tempYawForwardVec = new THREE.Vector3();
const tempDriveSeatPosition = new THREE.Vector3();
const tempDriveLookTarget = new THREE.Vector3();
const tempDriveDirection = new THREE.Vector3();
const tempDriveSeatQuaternion = new THREE.Quaternion();
const tempDriveSeatUp = new THREE.Vector3();
const tempDriveForward = new THREE.Vector3();
const tempDriveRight = new THREE.Vector3();
const tempDriveCameraMatrix = new THREE.Matrix4();
const tempDriveCameraQuaternion = new THREE.Quaternion();
const tempVehicleFollowAnchor = new THREE.Vector3();
const tempVehicleFollowPosition = new THREE.Vector3();
const tempVehicleFollowTarget = new THREE.Vector3();
const tempVehicleFollowOffset = new THREE.Vector3();
const tempVehicleResetPosition = new THREE.Vector3();
const tempVehicleResetQuaternion = new THREE.Quaternion();
const tempVehicleResetMatrix = new THREE.Matrix4();
const tempVehicleAxisRight = new THREE.Vector3();
const tempVehicleAxisUp = new THREE.Vector3();
const tempVehicleAxisForward = new THREE.Vector3();
const VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE = 6;
const VEHICLE_CAMERA_FALLBACK_HEIGHT = 1.35;
const VEHICLE_CAMERA_FALLBACK_HEIGHT_RATIO = 0.45;
const VEHICLE_EXIT_LATERAL_RATIO = 0.6;
const VEHICLE_EXIT_FORWARD_RATIO = 0.35;
const VEHICLE_EXIT_VERTICAL_RATIO = 0.25;
const VEHICLE_EXIT_LATERAL_MIN = 1.25;
const VEHICLE_EXIT_FORWARD_MIN = 1.25;
const VEHICLE_EXIT_VERTICAL_MIN = 0.6;
const VEHICLE_SIZE_FALLBACK = { width: 2.4, height: 1.4, length: 4.2 };
const VEHICLE_ENGINE_FORCE = 500;
const VEHICLE_BRAKE_FORCE = 45;
const VEHICLE_STEER_ANGLE = THREE.MathUtils.degToRad(32);
const VEHICLE_FOLLOW_DISTANCE_MIN = 4;
const VEHICLE_FOLLOW_DISTANCE_MAX = 26;
const VEHICLE_FOLLOW_HEIGHT_RATIO = 0.4;
const VEHICLE_FOLLOW_HEIGHT_MIN = 1.5;
const VEHICLE_FOLLOW_DISTANCE_LENGTH_RATIO = 1.25;
const VEHICLE_FOLLOW_DISTANCE_WIDTH_RATIO = 0.35;
const VEHICLE_FOLLOW_DISTANCE_DIAGONAL_RATIO = 0.2;
const VEHICLE_FOLLOW_TARGET_LIFT_RATIO = 0.3;
const VEHICLE_FOLLOW_TARGET_LIFT_MIN = 0.6;
const VEHICLE_FOLLOW_TARGET_FORWARD_RATIO = 0.35;
const VEHICLE_FOLLOW_TARGET_FORWARD_MIN = 1.2;
const VEHICLE_FOLLOW_POSITION_LERP_SPEED = 8;
const VEHICLE_FOLLOW_TARGET_LERP_SPEED = 10;
const STEERING_WHEEL_MAX_DEGREES = 135;
const STEERING_WHEEL_RETURN_SPEED = 4;
const STEERING_KEYBOARD_RETURN_SPEED = 7;
const STEERING_KEYBOARD_CATCH_SPEED = 18;
const VEHICLE_RESET_LIFT = 0.75;
const cameraRotationAnchor = new THREE.Vector3();
let programmaticCameraMutationDepth = 0;
let suppressSelfYawRecenter = false;

function runWithProgrammaticCameraMutation<T>(callback: () => T): T {
  programmaticCameraMutationDepth += 1;
  try {
    return callback();
  } finally {
    programmaticCameraMutationDepth = Math.max(0, programmaticCameraMutationDepth - 1);
    if (programmaticCameraMutationDepth === 0 && renderContext) {
      cameraRotationAnchor.copy(renderContext.camera.position);
    }
  }
}

function isProgrammaticCameraMutationActive(): boolean {
  return programmaticCameraMutationDepth > 0;
}

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

type VehicleDriveControlFlags = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
};

type VehicleDriveInputState = {
  throttle: number;
  steering: number;
  brake: number;
};

type VehicleDriveCameraMode = 'first-person' | 'follow';
type VehicleDriveCameraFollowState = {
  desiredPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  desiredTarget: THREE.Vector3;
  currentTarget: THREE.Vector3;
  initialized: boolean;
};

const pageInstance = getCurrentInstance();

const vehicleDriveActive = ref(false);
const vehicleDriveNodeId = ref<string | null>(null);
const vehicleDriveToken = ref<string | null>(null);
const activeVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
const vehicleDriveSeatNodeId = ref<string | null>(null);
const vehicleDriveUiOverride = ref<'auto' | 'show' | 'hide'>('auto');
const vehicleDriveExitBusy = ref(false);
const vehicleDriveInputFlags = reactive<VehicleDriveControlFlags>({
  forward: false,
  backward: false,
  left: false,
  right: false,
  brake: false,
});
const vehicleDriveInput = reactive<VehicleDriveInputState>({
  throttle: 0,
  steering: 0,
  brake: 0,
});
const vehicleDriveCameraMode = ref<VehicleDriveCameraMode>('follow');
const vehicleDriveCameraFollowState = reactive<VehicleDriveCameraFollowState>({
  desiredPosition: new THREE.Vector3(),
  currentPosition: new THREE.Vector3(),
  desiredTarget: new THREE.Vector3(),
  currentTarget: new THREE.Vector3(),
  initialized: false,
});
const steeringWheelRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const steeringWheelValue = ref(0);
const steeringKeyboardValue = ref(0);
const steeringKeyboardTarget = ref(0);
const steeringWheelState = reactive({
  dragging: false,
  pointerId: -1,
  startPointerAngle: 0,
  startWheelAngle: 0,
});
const steeringWheelMetrics = reactive({
  ready: false,
  centerX: 0,
  centerY: 0,
});
const vehicleSteeringWheelStyle = computed(() => ({
  transform: `rotate(${vehicleDriveInput.steering * STEERING_WHEEL_MAX_DEGREES}deg)`,
}));
const vehicleSteeringAngleLabel = computed(() => `${Math.round(vehicleDriveInput.steering * STEERING_WHEEL_MAX_DEGREES)}°`);
const vehicleDriveCameraToggleLabel = computed(() =>
  vehicleDriveCameraMode.value === 'follow' ? '座舱视角' : '跟随视角',
);
const vehicleDriveResetBusy = ref(false);

type CameraViewMode = 'level' | 'watching';
const cameraViewState = reactive<{ mode: CameraViewMode; targetNodeId: string | null }>({
  mode: 'level',
  targetNodeId: null,
});

const vehicleDriveCameraRestoreState = {
  hasSnapshot: false,
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  up: new THREE.Vector3(),
  viewMode: cameraViewState.mode as CameraViewMode,
  viewTargetId: cameraViewState.targetNodeId as string | null,
  isCameraCaged: false,
  purposeMode: purposeActiveMode.value,
};

const vehicleDriveUi = computed(() => {
  const override = vehicleDriveUiOverride.value;
  const active = vehicleDriveActive.value;
  const visible = override === 'show' ? true : override === 'hide' ? false : active;
  if (!visible) {
    return {
      visible: false,
      label: '',
      cameraLocked: false,
      forwardActive: false,
      backwardActive: false,
      leftActive: false,
      rightActive: false,
      brakeActive: false,
    } as const;
  }
  const nodeId = vehicleDriveNodeId.value ?? '';
  const node = nodeId ? resolveNodeById(nodeId) : null;
  const label = node?.name?.trim() || nodeId || 'Vehicle';
  return {
    visible: true,
    label,
    cameraLocked: active,
    forwardActive: active && vehicleDriveInputFlags.forward,
    backwardActive: active && vehicleDriveInputFlags.backward,
    leftActive: active && vehicleDriveInputFlags.left,
    rightActive: active && vehicleDriveInputFlags.right,
    brakeActive: active && vehicleDriveInputFlags.brake,
  } as const;
});

const pendingVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
const vehicleDrivePromptBusy = ref(false);

const vehicleDrivePrompt = computed(() => {
  const event = pendingVehicleDriveEvent.value;
  if (!event) {
    return {
      visible: false,
      label: '',
      busy: false,
    } as const;
  }
  const targetNodeId = event.targetNodeId ?? event.nodeId;
  const node = targetNodeId ? resolveNodeById(targetNodeId) : null;
  const label = node?.name?.trim() || targetNodeId || 'Vehicle';
  return {
    visible: true,
    label,
    busy: vehicleDrivePromptBusy.value,
  } as const;
});

watch(
  () => vehicleDriveUi.value.visible,
  (visible) => {
    if (visible) {
      refreshSteeringWheelMetrics();
    } else {
      setSteeringWheelDragActive(false);
    }
  },
);

watch(vehicleDriveCameraMode, () => {
  vehicleDriveCameraFollowState.initialized = false;
});

watch(vehicleDriveActive, (active) => {
  if (!active) {
    vehicleDriveCameraMode.value = 'follow';
    vehicleDriveCameraFollowState.initialized = false;
  }
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

type WarpGateRuntimeRegistryEntry = {
  tick?: (delta: number) => void;
  props?: Partial<WarpGateComponentProps> | null;
  setPlaybackActive?: (active: boolean) => void
};

type GuideboardRuntimeRegistryEntry = {
  tick?: (delta: number) => void;
  props?: Partial<GuideboardComponentProps> | null;
  setPlaybackActive?: (active: boolean) => void
};

function isWarpGateEffectActive(props: Partial<WarpGateComponentProps> | null | undefined): boolean {
  if (!props) {
    return false;
  }
  const nested = (props as { groundLight?: Partial<WarpGateComponentProps> | null | undefined }).groundLight;
  if (nested && typeof nested === 'object') {
    return isWarpGateEffectActive(nested);
  }
  const showParticles = props.showParticles === true;
  const particleCount = typeof props.particleCount === 'number' ? props.particleCount : 0;
  const showBeams = props.showBeams === true;
  const showRings = props.showRings === true;
  return (showParticles && particleCount > 0) || showBeams || showRings;
}

function isGuideboardEffectActive(props: Partial<GuideboardComponentProps> | null | undefined): boolean {
  if (!props) {
    return false;
  }
  const normalized = clampGuideboardComponentProps(props);
  return computeGuideboardEffectActive(normalized);
}

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
const deferredInstancingNodeIds = new Set<string>();
let lazyLoadMeshesEnabled = true;
let activeLazyLoadCount = 0;
const tempOutlineSphere = new THREE.Sphere();
const tempOutlineScale = new THREE.Vector3();
const tempCameraMatrix = new THREE.Matrix4();
const cameraViewFrustum = new THREE.Frustum();

const tempBox = new THREE.Box3();
const tempSphere = new THREE.Sphere();
const tempVector = new THREE.Vector3();
const tempVehicleSize = new THREE.Vector3();
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
    gravityStrength: clampNumber(source?.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY),
    collisionRestitution: clampNumber(
      source?.collisionRestitution,
      0,
      1,
      DEFAULT_ENVIRONMENT_RESTITUTION,
    ),
    collisionFriction: clampNumber(
      source?.collisionFriction,
      0,
      1,
      DEFAULT_ENVIRONMENT_FRICTION,
    ),
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

function normalizeDisplayBoardAssetId(candidate: string): string {
  const trimmed = candidate.trim()
  if (!trimmed.length) {
    return ''
  }
  const withoutScheme = trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
  return withoutScheme.trim()
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
  const assetId = normalizeDisplayBoardAssetId(trimmed)
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
  assetNodeIdMap.clear();
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
    if (typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length) {
      const assetId = node.sourceAssetId.trim();
      let bucket = assetNodeIdMap.get(assetId);
      if (!bucket) {
        bucket = new Set<string>();
        assetNodeIdMap.set(assetId, bucket);
      }
      bucket.add(node.id);
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
}

function resolveNodeById(nodeId: string): SceneNode | null {
  return previewNodeMap.get(nodeId) ?? null;
}

function collectNodesByAssetId(nodes: SceneNode[] | undefined | null): Map<string, SceneNode[]> {
  const map = new Map<string, SceneNode[]>();
  if (!Array.isArray(nodes)) {
    return map;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.sourceAssetId) {
      if (!map.has(node.sourceAssetId)) {
        map.set(node.sourceAssetId, []);
      }
      map.get(node.sourceAssetId)!.push(node);
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return map;
}

function serializeBoundingBox(box: THREE.Box3): { min: [number, number, number]; max: [number, number, number] } {
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

async function ensureModelInstanceGroup(
  assetId: string,
  sampleNode: SceneNode | null,
  resourceCache: ResourceCache,
): Promise<ModelInstanceGroup | null> {
  if (!assetId) {
    return null;
  }
  const cached = getCachedModelObject(assetId);
  if (cached) {
    return cached;
  }
  try {
    const group = await getOrLoadModelObject(assetId, async () => {
      const object = await loadNodeObject(resourceCache, assetId, sampleNode?.importMetadata ?? null);
      if (!object) {
        throw new Error('Instanced asset loader returned empty object');
      }
      return object;
    });
    return group;
  } catch (error) {
    console.warn('[SceneViewer] Failed to prepare instanced model', assetId, error);
    return null;
  }
}

function createInstancedPreviewProxy(node: SceneNode, group: ModelInstanceGroup): THREE.Object3D | null {
  if (!node.sourceAssetId || node.sourceAssetId !== group.assetId) {
    return null;
  }
  releaseModelInstance(node.id);
  const binding = allocateModelInstance(group.assetId, node.id);
  if (!binding) {
    return null;
  }
  const proxy = new THREE.Object3D();
  proxy.name = node.name ?? group.object.name ?? 'Instanced Model';
  proxy.userData = {
    ...(proxy.userData ?? {}),
    nodeId: node.id,
    instanced: true,
    instancedAssetId: group.assetId,
    instancedBounds: serializeBoundingBox(group.boundingBox),
  };
  updateNodeTransfrom(proxy, node);
  return proxy;
}

async function prepareInstancedNodesForGraph(
  root: THREE.Object3D,
  document: SceneJsonExportDocument,
  resourceCache: ResourceCache,
  options: { includeNodeIds?: Set<string>; skipNodeIds?: Set<string> } = {},
): Promise<void> {
  const includeNodeIds = options.includeNodeIds ?? null;
  const skipNodeIds = options.skipNodeIds ?? null;
  const grouped = collectNodesByAssetId(document.nodes ?? []);
  if (!grouped.size) {
    return;
  }
  type GraphEntry = { object: THREE.Object3D; parent: THREE.Object3D | null; index: number };
  const sceneObjects = new Map<string, GraphEntry>();
  root.traverse((object) => {
    const nodeId = object.userData?.nodeId as string | undefined;
    if (!nodeId) {
      return;
    }
    const parent = object.parent ?? null;
    const index = parent ? parent.children.indexOf(object) : root.children.indexOf(object);
    sceneObjects.set(nodeId, { object, parent, index });
  });

  const tasks: Promise<void>[] = [];
  grouped.forEach((nodes, assetId) => {
    const filteredNodes = nodes.filter((node) => {
      if (includeNodeIds && !includeNodeIds.has(node.id)) {
        return false;
      }
      if (skipNodeIds && skipNodeIds.has(node.id)) {
        return false;
      }
      return true;
    });
    if (!filteredNodes.length) {
      return;
    }
    tasks.push((async () => {
      const group = await ensureModelInstanceGroup(assetId, filteredNodes[0] ?? null, resourceCache);
      if (!group || !group.meshes.length) {
        return;
      }
      ensureInstancedMeshesRegistered(assetId);
      filteredNodes.forEach((node) => {
        const entry = sceneObjects.get(node.id);
        if (!entry) {
          return;
        }
        const { object, parent, index } = entry;
        const targetParent = parent ?? root;
        const proxy = createInstancedPreviewProxy(node, group);
        if (!proxy) {
          return;
        }
        targetParent.remove(object);
        disposeObject(object);
        targetParent.add(proxy);
        if (index >= 0) {
          const proxyIndex = targetParent.children.indexOf(proxy);
          targetParent.children.splice(proxyIndex, 1);
          targetParent.children.splice(Math.min(index, targetParent.children.length), 0, proxy);
        }
        sceneObjects.set(node.id, { object: proxy, parent: targetParent, index });
      });
    })());
  });
  await Promise.all(tasks);
}

function attachInstancedMesh(mesh: THREE.InstancedMesh): void {
  if (instancedMeshes.includes(mesh)) {
    return;
  }
  instancedMeshes.push(mesh);
  instancedMeshGroup.add(mesh);
}

function clearInstancedMeshes(): void {
  instancedMeshes.splice(0, instancedMeshes.length).forEach((mesh) => {
    instancedMeshGroup.remove(mesh);
  });
}

function buildScatterNodeId(layerId: string | null | undefined, instanceId: string): string {
  const normalizedLayer = typeof layerId === 'string' && layerId.trim().length ? layerId.trim() : 'layer';
  return `scatter:${normalizedLayer}:${instanceId}`;
}

function composeScatterMatrix(
  instance: TerrainScatterInstance,
  groundMesh: THREE.Mesh,
  target?: THREE.Matrix4,
): THREE.Matrix4 {
  groundMesh.updateMatrixWorld(true);
  scatterLocalPositionHelper.set(
    instance.localPosition?.x ?? 0,
    instance.localPosition?.y ?? 0,
    instance.localPosition?.z ?? 0,
  );
  scatterLocalRotationHelper.set(
    instance.localRotation?.x ?? 0,
    instance.localRotation?.y ?? 0,
    instance.localRotation?.z ?? 0,
    'XYZ',
  );
  scatterQuaternionHelper.setFromEuler(scatterLocalRotationHelper);
  scatterLocalScaleHelper.set(
    instance.localScale?.x ?? 1,
    instance.localScale?.y ?? 1,
    instance.localScale?.z ?? 1,
  );
  scatterInstanceMatrixHelper.compose(scatterLocalPositionHelper, scatterQuaternionHelper, scatterLocalScaleHelper);
  const output = target ?? new THREE.Matrix4();
  return output.copy(groundMesh.matrixWorld).multiply(scatterInstanceMatrixHelper);
}

type GroundScatterEntry = {
  nodeId: string;
  snapshot: TerrainScatterStoreSnapshot;
};

function collectGroundScatterEntries(nodes: SceneNode[] | null | undefined): GroundScatterEntry[] {
  if (!Array.isArray(nodes) || !nodes.length) {
    return [];
  }
  const stack: SceneNode[] = [...nodes];
  const entries: GroundScatterEntry[] = [];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.dynamicMesh?.type === 'Ground') {
      const definition = node.dynamicMesh as GroundDynamicMesh & {
        terrainScatter?: TerrainScatterStoreSnapshot | null;
      };
      const snapshot = definition.terrainScatter;
      if (snapshot && Array.isArray(snapshot.layers) && snapshot.layers.length) {
        entries.push({ nodeId: node.id, snapshot });
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return entries;
}

function resolveGroundMeshObject(nodeId: string): THREE.Mesh | null {
  const container = nodeObjectMap.get(nodeId);
  if (!container) {
    return null;
  }
  const directMesh = container as THREE.Mesh;
  if (directMesh.isMesh) {
    return directMesh;
  }
  let found: THREE.Mesh | null = null;
  container.traverse((child) => {
    if (found) {
      return;
    }
    const mesh = child as THREE.Mesh;
    if (mesh?.isMesh) {
      found = mesh;
    }
  });
  return found;
}

function releaseTerrainScatterInstances(): void {
  if (!scatterInstanceNodeIds.size) {
    return;
  }
  scatterInstanceNodeIds.forEach((nodeId) => releaseModelInstance(nodeId));
  scatterInstanceNodeIds.clear();
}

async function syncTerrainScatterInstances(
  document: SceneJsonExportDocument,
  resourceCache: ResourceCache | null,
): Promise<void> {
  releaseTerrainScatterInstances();
  if (!resourceCache) {
    return;
  }
  const entries = collectGroundScatterEntries(document.nodes);
  if (!entries.length) {
    return;
  }
  for (const entry of entries) {
    const groundMesh = resolveGroundMeshObject(entry.nodeId);
    if (!groundMesh) {
      continue;
    }
    for (const layer of entry.snapshot.layers ?? []) {
      const layerAssetId = typeof layer?.assetId === 'string' ? layer.assetId.trim() : '';
      const profileAssetId = typeof layer?.profileId === 'string' ? layer.profileId.trim() : '';
      const assetId = layerAssetId || profileAssetId;
      if (!assetId) {
        continue;
      }
      const group = await ensureModelInstanceGroup(assetId, null, resourceCache);
      if (!group || !group.meshes.length) {
        continue;
      }
      ensureInstancedMeshesRegistered(assetId);
      const instances = Array.isArray(layer.instances) ? (layer.instances as TerrainScatterInstance[]) : [];
      for (const instance of instances) {
        const nodeId = buildScatterNodeId(layer?.id ?? null, instance.id);
        const binding = allocateModelInstance(assetId, nodeId);
        if (!binding) {
          continue;
        }
        const matrix = composeScatterMatrix(instance, groundMesh, scatterMatrixHelper);
        updateModelInstanceMatrix(nodeId, matrix);
        scatterInstanceNodeIds.add(nodeId);
      }
    }
  }
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

function resolveRigidbodyComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<RigidbodyComponentProps> | null {
  const component = node?.components?.[RIGIDBODY_COMPONENT_TYPE] as
    | SceneNodeComponentState<RigidbodyComponentProps>
    | undefined;
  if (!component || !component.enabled) {
    return null;
  }
  return component;
}

function resolveVehicleComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<VehicleComponentProps> | null {
  const component = node?.components?.[VEHICLE_COMPONENT_TYPE] as
    | SceneNodeComponentState<VehicleComponentProps>
    | undefined;
  if (!component || !component.enabled) {
    return null;
  }
  return component;
}

function extractRigidbodyShape(
  component: SceneNodeComponentState<RigidbodyComponentProps> | null,
): RigidbodyPhysicsShape | null {
  if (!component) {
    return null;
  }
  const payload = component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined;
  return payload?.shape ?? null;
}

function resolveNodeScaleVector(node: SceneNode | null | undefined): { x: number; y: number; z: number } {
  const scale = node?.scale;
  const normalize = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return 1;
  };
  return {
    x: normalize(scale?.x),
    y: normalize(scale?.y),
    z: normalize(scale?.z),
  };
}

function attachRuntimeForNode(nodeId: string, object: THREE.Object3D) {
  const nodeState = resolveNodeById(nodeId);
  if (!nodeState) {
    return;
  }
  previewComponentManager.attachRuntime(nodeState, object);
}

function indexSceneObjects(root: THREE.Object3D) {
  nodeObjectMap.forEach((_object, nodeId) => {
    releaseModelInstance(nodeId);
  });
  nodeObjectMap.clear();
  resetPhysicsWorld();
  root.traverse((object) => {
    const nodeId = object.userData?.nodeId as string | undefined;
    if (nodeId) {
      nodeObjectMap.set(nodeId, object);
      ensureRigidbodyBindingForObject(nodeId, object);
      attachRuntimeForNode(nodeId, object);
      const instancedAssetId = object.userData?.instancedAssetId as string | undefined;
      if (instancedAssetId) {
        ensureInstancedMeshesRegistered(instancedAssetId);
        syncInstancedTransform(object);
      }
      const nodeState = resolveNodeById(nodeId);
      const guideboardVisibility = resolveGuideboardInitialVisibility(nodeState);
      if (guideboardVisibility !== null) {
        object.visible = guideboardVisibility;
        updateBehaviorVisibility(nodeId, object.visible);
      }
      if (nodeState) {
        applyMaterialOverrides(object, nodeState.materials, materialOverrideOptions);
      }
      syncInstancedTransform(object);
    }
  });
}

function registerSceneSubtree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const nodeId = object.userData?.nodeId as string | undefined;
    if (!nodeId) {
      return;
    }
    const existing = nodeObjectMap.get(nodeId) ?? null;
    const lazyData = object.userData?.lazyAsset as LazyAssetMetadata;
    const existingLazyData = existing?.userData?.lazyAsset as LazyAssetMetadata;
    const objectIsPlaceholder = lazyData?.placeholder === true;
    const existingIsPreferred =
      existing && existing !== object && objectIsPlaceholder && existingLazyData?.placeholder !== true;
    if (existingIsPreferred) {
      return;
    }
    nodeObjectMap.set(nodeId, object);
    ensureRigidbodyBindingForObject(nodeId, object);
    attachRuntimeForNode(nodeId, object);
    const instancedAssetId = object.userData?.instancedAssetId as string | undefined;
    if (instancedAssetId) {
      ensureInstancedMeshesRegistered(instancedAssetId);
      syncInstancedTransform(object);
    }
    const nodeState = resolveNodeById(nodeId);
    const guideboardVisibility = resolveGuideboardInitialVisibility(nodeState);
    if (guideboardVisibility !== null) {
      object.visible = guideboardVisibility;
      updateBehaviorVisibility(nodeId, object.visible);
      syncInstancedTransform(object);
    }
    if (nodeState) {
      applyMaterialOverrides(object, nodeState.materials, materialOverrideOptions);
    }
    syncInstancedTransform(object);
  });
}

function ensurePhysicsWorld(): CANNON.World {
  if (physicsWorld) {
    return physicsWorld;
  }
  rigidbodyMaterialCache.clear();
  rigidbodyContactMaterialKeys.clear();
  const world = new CANNON.World();
  world.gravity.copy(physicsGravity);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = physicsContactFriction;
  world.defaultContactMaterial.restitution = physicsContactRestitution;
  physicsWorld = world;
  return world;
}

function resetPhysicsWorld(): void {
  const world = physicsWorld;
  if (world) {
    vehicleInstances.forEach(({ vehicle }) => {
      try {
        vehicle.removeFromWorld(world);
      } catch (error) {
        console.warn('[SceneViewer] Failed to remove vehicle', error);
      }
    });
    rigidbodyInstances.forEach(({ body }) => {
      try {
        world.removeBody(body);
      } catch (error) {
        console.warn('[SceneViewer] Failed to remove rigidbody', error);
      }
    });
  }
  vehicleInstances.clear();
  rigidbodyInstances.clear();
  physicsWorld = null;
  groundHeightfieldCache.clear();
  rigidbodyMaterialCache.clear();
  rigidbodyContactMaterialKeys.clear();
  vehicleDriveActive.value = false;
  vehicleDriveNodeId.value = null;
  vehicleDriveToken.value = null;
  activeVehicleDriveEvent.value = null;
  pendingVehicleDriveEvent.value = null;
  vehicleDrivePromptBusy.value = false;
  vehicleDriveExitBusy.value = false;
  vehicleDriveResetBusy.value = false;
  resetVehicleDriveInputs();
  vehicleDriveCameraMode.value = 'follow';
  vehicleDriveCameraFollowState.initialized = false;
  setSteeringWheelDragActive(false);
  setVehicleDriveUiOverride('hide');
}

function resolveGroundHeightfieldShape(
  node: SceneNode,
  definition: GroundDynamicMesh,
): GroundHeightfieldCacheEntry | null {
  const nodeId = node.id;
  const data: GroundHeightfieldData | null = buildGroundHeightfieldData(node, definition);
  if (!data) {
    groundHeightfieldCache.delete(nodeId);
    return null;
  }
  const cached = groundHeightfieldCache.get(nodeId);
  if (cached && cached.signature === data.signature) {
    return cached;
  }
  const shape = new CANNON.Heightfield(data.matrix, { elementSize: data.elementSize });
  const entry: GroundHeightfieldCacheEntry = {
    signature: data.signature,
    shape,
    offset: data.offset,
  };
  groundHeightfieldCache.set(nodeId, entry);
  return entry;
}

function normalizeHeightfieldMatrix(source: unknown): number[][] | null {
  if (!Array.isArray(source) || source.length < 2) {
    return null;
  }
  let maxRows = 0;
  const normalizedColumns = source.map((column) => {
    if (!Array.isArray(column)) {
      return [];
    }
    const normalized = column.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0));
    if (normalized.length > maxRows) {
      maxRows = normalized.length;
    }
    return normalized;
  });
  if (normalizedColumns.length < 2 || maxRows < 2) {
    return null;
  }
  const paddedColumns = normalizedColumns.map((column) => {
    if (column.length === maxRows) {
      return column;
    }
    const padValue = column.length ? column[column.length - 1]! : 0;
    while (column.length < maxRows) {
      column.push(padValue);
    }
    return column;
  });
  return paddedColumns as number[][];
}

function createCannonShape(definition: RigidbodyPhysicsShape): CANNON.Shape | null {
  if (definition.kind === 'box') {
    const [x, y, z] = definition.halfExtents;
    if (![x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return null;
    }
    return new CANNON.Box(new CANNON.Vec3(x, y, z));
  }
  if (definition.kind === 'convex') {
    const vertices = (definition.vertices ?? []).map(([vx, vy, vz]) => new CANNON.Vec3(vx, vy, vz));
    const faces = (definition.faces ?? []).map((face) => face.slice());
    if (!vertices.length || !faces.length) {
      return null;
    }
    return new CANNON.ConvexPolyhedron({ vertices, faces });
  }
  if (definition.kind === 'heightfield') {
    const matrix = normalizeHeightfieldMatrix(definition.matrix);
    const elementSize = typeof definition.elementSize === 'number' && Number.isFinite(definition.elementSize)
      ? definition.elementSize
      : null;
    if (!matrix || !elementSize || elementSize <= 0) {
      return null;
    }
    return new CANNON.Heightfield(matrix, { elementSize });
  }
  return null;
}

function formatRigidbodyMaterialKey(friction: number, restitution: number): string {
  return `${friction.toFixed(3)}:${restitution.toFixed(3)}`;
}

function formatRigidbodyContactKey(materialA: CANNON.Material, materialB: CANNON.Material): string {
  const idA = typeof materialA.id === 'number' ? materialA.id : -1;
  const idB = typeof materialB.id === 'number' ? materialB.id : -1;
  return idA <= idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

function ensureContactMaterial(
  world: CANNON.World,
  materialA: CANNON.Material,
  materialB: CANNON.Material,
  friction: number,
  restitution: number,
): void {
  const key = formatRigidbodyContactKey(materialA, materialB);
  if (rigidbodyContactMaterialKeys.has(key)) {
    return;
  }
  world.addContactMaterial(new CANNON.ContactMaterial(materialA, materialB, { friction, restitution }));
  rigidbodyContactMaterialKeys.add(key);
}

function registerRigidbodyMaterialContacts(world: CANNON.World, entry: RigidbodyMaterialEntry): void {
  ensureContactMaterial(world, entry.material, entry.material, entry.friction, entry.restitution);
  const defaultMaterial = world.defaultMaterial;
  if (defaultMaterial) {
    ensureContactMaterial(world, defaultMaterial, entry.material, entry.friction, entry.restitution);
  }
  rigidbodyMaterialCache.forEach((otherEntry) => {
    if (otherEntry.material === entry.material) {
      return;
    }
    const combinedFriction = Math.sqrt(entry.friction * otherEntry.friction);
    const combinedRestitution = Math.max(entry.restitution, otherEntry.restitution);
    ensureContactMaterial(world, entry.material, otherEntry.material, combinedFriction, combinedRestitution);
  });
}

function ensureRigidbodyMaterial(friction: number, restitution: number): CANNON.Material {
  const world = physicsWorld ?? ensurePhysicsWorld();
  const clampedFriction = clampNumber(friction, 0, 1, DEFAULT_RIGIDBODY_FRICTION);
  const clampedRestitution = clampNumber(restitution, 0, 1, DEFAULT_RIGIDBODY_RESTITUTION);
  const key = formatRigidbodyMaterialKey(clampedFriction, clampedRestitution);
  let entry = rigidbodyMaterialCache.get(key);
  if (!entry) {
    const material = new CANNON.Material(`rigidbody:${key}`);
    material.friction = clampedFriction;
    material.restitution = clampedRestitution;
    entry = { material, friction: clampedFriction, restitution: clampedRestitution };
    rigidbodyMaterialCache.set(key, entry);
    registerRigidbodyMaterialContacts(world, entry);
  }
  return entry.material;
}

function mapBodyType(type: RigidbodyComponentProps['bodyType']): CANNON.Body['type'] {
  switch (type) {
    case 'STATIC':
      return CANNON.Body.STATIC;
    case 'KINEMATIC':
      return CANNON.Body.KINEMATIC;
    case 'DYNAMIC':
    default:
      return CANNON.Body.DYNAMIC;
  }
}

function syncBodyFromObject(
  body: CANNON.Body,
  object: THREE.Object3D,
  orientationAdjustment: RigidbodyOrientationAdjustment | null = null,
): void {
  object.updateMatrixWorld(true);
  object.matrixWorld.decompose(physicsPositionHelper, physicsQuaternionHelper, physicsScaleHelper);
  syncBodyQuaternionHelper.copy(physicsQuaternionHelper);
  if (orientationAdjustment) {
    syncBodyQuaternionHelper.multiply(orientationAdjustment.three);
  }
  body.position.set(physicsPositionHelper.x, physicsPositionHelper.y, physicsPositionHelper.z);
  body.quaternion.set(
    syncBodyQuaternionHelper.x,
    syncBodyQuaternionHelper.y,
    syncBodyQuaternionHelper.z,
    syncBodyQuaternionHelper.w,
  );
  body.velocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
}

function syncObjectFromBody(entry: RigidbodyInstance): void {
  const { object, body, orientationAdjustment } = entry;
  if (!object) {
    return;
  }
  object.position.set(body.position.x, body.position.y, body.position.z);
  bodyQuaternionHelper.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  if (orientationAdjustment) {
    bodyQuaternionHelper.multiply(orientationAdjustment.threeInverse);
  }
  object.quaternion.copy(bodyQuaternionHelper);
  object.updateMatrixWorld();
  syncInstancedTransform(object);
}

function createRigidbodyBody(
  node: SceneNode,
  component: SceneNodeComponentState<RigidbodyComponentProps>,
  shapeDefinition: RigidbodyPhysicsShape | null,
  object: THREE.Object3D,
): { body: CANNON.Body; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null {
  let offsetTuple: RigidbodyVector3Tuple | null = null;
  let resolvedShape: CANNON.Shape | null = null;
  let needsHeightfieldOrientation = false;
  if (isGroundDynamicMesh(node.dynamicMesh)) {
    const groundEntry = resolveGroundHeightfieldShape(node, node.dynamicMesh);
    if (groundEntry) {
      resolvedShape = groundEntry.shape;
      offsetTuple = groundEntry.offset;
      needsHeightfieldOrientation = true;
    }
  }
  if (!resolvedShape && shapeDefinition) {
    resolvedShape = createCannonShape(shapeDefinition);
    offsetTuple = shapeDefinition.offset ?? null;
    if (shapeDefinition.kind === 'heightfield') {
      needsHeightfieldOrientation = true;
    }
  }
  if (!resolvedShape) {
    return null;
  }
  const props = component.props as RigidbodyComponentProps;
  const isDynamic = props.bodyType === 'DYNAMIC';
  const mass = isDynamic ? Math.max(0, props.mass ?? 0) : 0;
  const body = new CANNON.Body({ mass });
  body.type = mapBodyType(props.bodyType);
  body.material = ensureRigidbodyMaterial(props.friction ?? DEFAULT_RIGIDBODY_FRICTION, props.restitution ?? DEFAULT_RIGIDBODY_RESTITUTION);
  let shapeOffset: CANNON.Vec3 | undefined;
  if (offsetTuple) {
    const [ox, oy, oz] = offsetTuple;
    shapeOffset = heightfieldShapeOffsetHelper.set(ox ?? 0, oy ?? 0, oz ?? 0);
  }
  const orientationAdjustment = needsHeightfieldOrientation ? groundHeightfieldOrientationAdjustment : null;
  body.addShape(resolvedShape, shapeOffset);
  syncBodyFromObject(body, object, orientationAdjustment);
  body.updateMassProperties();
  body.linearDamping = props.linearDamping ?? DEFAULT_LINEAR_DAMPING;
  body.angularDamping = props.angularDamping ?? DEFAULT_ANGULAR_DAMPING;
  return { body, orientationAdjustment };
}

function removeRigidbodyInstance(nodeId: string): void {
  const entry = rigidbodyInstances.get(nodeId);
  if (!entry) {
    return;
  }
  try {
    physicsWorld?.removeBody(entry.body);
  } catch (error) {
    console.warn('[SceneViewer] Failed to remove rigidbody instance', error);
  }
  rigidbodyInstances.delete(nodeId);
  groundHeightfieldCache.delete(nodeId);
  removeVehicleInstance(nodeId);
}

function clampVehicleAxisIndex(value: number): 0 | 1 | 2 {
  if (value === 1) {
    return 1;
  }
  if (value === 2) {
    return 2;
  }
  return 0;
}

const VEHICLE_AXIS_VECTORS: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

function resolveVehicleAxisVector(index: 0 | 1 | 2): THREE.Vector3 {
  return VEHICLE_AXIS_VECTORS[index];
}

type VehicleVectorValue = Vector3Like | number[] | null | undefined;

function toFiniteVectorComponent(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeVehicleVector(value: VehicleVectorValue): [number, number, number] | null {
  if (Array.isArray(value) && value.length === 3) {
    const [xRaw, yRaw, zRaw] = value;
    const x = toFiniteVectorComponent(xRaw);
    const y = toFiniteVectorComponent(yRaw);
    const z = toFiniteVectorComponent(zRaw);
    if (x === null || y === null || z === null) {
      return null;
    }
    return [x, y, z];
  }
  if (value && typeof value === 'object') {
    const record = value as Partial<Vector3Like>;
    const x = toFiniteVectorComponent(record.x);
    const y = toFiniteVectorComponent(record.y);
    const z = toFiniteVectorComponent(record.z);
    if (x === null || y === null || z === null) {
      return null;
    }
    return [x, y, z];
  }
  return null;
}

function tupleToVec3(tuple: VehicleVectorValue, fallback?: Vector3Like): CANNON.Vec3 | null {
  const normalized = normalizeVehicleVector(tuple) ?? (fallback ? normalizeVehicleVector(fallback) : null);
  if (!normalized) {
    return null;
  }
  const [x, y, z] = normalized;
  return new CANNON.Vec3(x, y, z);
}

function createVehicleInstance(
  node: SceneNode,
  component: SceneNodeComponentState<VehicleComponentProps>,
  rigidbody: RigidbodyInstance,
): VehicleInstance | null {
  if (!physicsWorld || !rigidbody.object) {
    return null;
  }
  const props = clampVehicleComponentProps(component.props);
  const rightAxis = clampVehicleAxisIndex(props.indexRightAxis);
  const upAxis = clampVehicleAxisIndex(props.indexUpAxis);
  const forwardAxis = clampVehicleAxisIndex(props.indexForwardAxis);
  const axisRightVector = resolveVehicleAxisVector(rightAxis).clone();
  const axisUpVector = resolveVehicleAxisVector(upAxis).clone();
  const axisForwardVector = resolveVehicleAxisVector(forwardAxis).clone();
  const wheelEntries = (props.wheels ?? [])
    .map((wheel) => {
      const point = tupleToVec3(wheel.chassisConnectionPointLocal);
      const direction = tupleToVec3(wheel.directionLocal, DEFAULT_DIRECTION);
      const axle = tupleToVec3(wheel.axleLocal, DEFAULT_AXLE);
      if (!point || !direction || !axle) {
        return null;
      }
      return { config: wheel, point, direction, axle };
    })
    .filter((entry): entry is { config: VehicleWheelProps; point: CANNON.Vec3; direction: CANNON.Vec3; axle: CANNON.Vec3 } => Boolean(entry));
  if (!wheelEntries.length) {
    return null;
  }
  const wheelCount = wheelEntries.length;
  let steerableWheelIndices = wheelEntries.reduce<number[]>((indices, entry, index) => {
    if (entry.config.isFrontWheel) {
      indices.push(index);
    }
    return indices;
  }, []);
  if (!steerableWheelIndices.length) {
    steerableWheelIndices = wheelCount >= 2
      ? [0, 1].filter((index) => index < wheelCount)
      : Array.from({ length: wheelCount }, (_unused, index) => index);
  }
  const vehicle = new CANNON.RaycastVehicle({
    chassisBody: rigidbody.body,
    indexRightAxis: rightAxis,
    indexUpAxis: upAxis,
    indexForwardAxis: forwardAxis,
  });
  wheelEntries.forEach(({ config, point, direction, axle }) => {
    vehicle.addWheel({
      chassisConnectionPointLocal: point,
      directionLocal: direction,
      axleLocal: axle,
      suspensionRestLength: config.suspensionRestLength,
      suspensionStiffness: config.suspensionStiffness,
      dampingRelaxation: config.dampingRelaxation,
      dampingCompression: config.dampingCompression,
      frictionSlip: config.frictionSlip,
      maxSuspensionTravel: config.maxSuspensionTravel,
      maxSuspensionForce: config.maxSuspensionForce,
      useCustomSlidingRotationalSpeed: config.useCustomSlidingRotationalSpeed,
      customSlidingRotationalSpeed: config.customSlidingRotationalSpeed,
      isFrontWheel: config.isFrontWheel,
      rollInfluence: config.rollInfluence,
      radius: config.radius,
    });
  });
  vehicle.addToWorld(physicsWorld);
  return {
    nodeId: node.id,
    vehicle,
    wheelCount,
    steerableWheelIndices,
    axisRightIndex: rightAxis,
    axisUpIndex: upAxis,
    axisForwardIndex: forwardAxis,
    axisRight: axisRightVector,
    axisUp: axisUpVector,
    axisForward: axisForwardVector,
  };
}

function removeVehicleInstance(nodeId: string): void {
  const entry = vehicleInstances.get(nodeId);
  if (!entry) {
    return;
  }
  if (physicsWorld) {
    try {
      entry.vehicle.removeFromWorld(physicsWorld);
    } catch (error) {
      console.warn('[SceneViewer] Failed to remove vehicle instance', error);
    }
  }
  vehicleInstances.delete(nodeId);
}

function ensureVehicleBindingForNode(nodeId: string): void {
  if (!physicsWorld) {
    return;
  }
  const node = resolveNodeById(nodeId);
  const component = resolveVehicleComponent(node);
  if (!node || !component) {
    removeVehicleInstance(nodeId);
    return;
  }
  const rigidbody = rigidbodyInstances.get(nodeId);
  if (!rigidbody || !rigidbody.object) {
    return;
  }
  removeVehicleInstance(nodeId);
  const instance = createVehicleInstance(node, component, rigidbody);
  if (instance) {
    vehicleInstances.set(nodeId, instance);
  }
}

function ensureRigidbodyBindingForObject(nodeId: string, object: THREE.Object3D): void {
  if (!physicsWorld || !currentDocument) {
    return;
  }
  const node = resolveNodeById(nodeId);
  const component = resolveRigidbodyComponent(node);
  const shapeDefinition = extractRigidbodyShape(component);
  const requiresMetadata = !isGroundDynamicMesh(node?.dynamicMesh);
  if (!node || !component || !object) {
    return;
  }
  if (!shapeDefinition && requiresMetadata) {
    return;
  }
  const existing = rigidbodyInstances.get(nodeId);
  if (existing) {
    existing.object = object;
    syncBodyFromObject(existing.body, object, existing.orientationAdjustment);
    ensureVehicleBindingForNode(nodeId);
    return;
  }
  const bodyEntry = createRigidbodyBody(node, component, shapeDefinition, object);
  if (!bodyEntry) {
    return;
  }
  physicsWorld.addBody(bodyEntry.body);
  rigidbodyInstances.set(nodeId, {
    nodeId,
    body: bodyEntry.body,
    object,
    orientationAdjustment: bodyEntry.orientationAdjustment,
  });
  ensureVehicleBindingForNode(nodeId);
}

function collectRigidbodyNodes(nodes: SceneNode[] | undefined | null): SceneNode[] {
  const collected: SceneNode[] = [];
  if (!Array.isArray(nodes)) {
    return collected;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (resolveRigidbodyComponent(node)) {
      collected.push(node);
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return collected;
}

function collectVehicleNodes(nodes: SceneNode[] | undefined | null): SceneNode[] {
  const collected: SceneNode[] = [];
  if (!Array.isArray(nodes)) {
    return collected;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (resolveVehicleComponent(node)) {
      collected.push(node);
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return collected;
}

function syncVehicleInstancesForDocument(document: SceneJsonExportDocument | null): void {
  if (!document) {
    vehicleInstances.forEach((_entry, nodeId) => removeVehicleInstance(nodeId));
    vehicleInstances.clear();
    return;
  }
  const vehicleNodes = collectVehicleNodes(document.nodes);
  const desiredIds = new Set(vehicleNodes.map((node) => node.id));
  vehicleNodes.forEach((node) => ensureVehicleBindingForNode(node.id));
  vehicleInstances.forEach((_entry, nodeId) => {
    if (!desiredIds.has(nodeId)) {
      removeVehicleInstance(nodeId);
    }
  });
}

function syncPhysicsBodiesForDocument(document: SceneJsonExportDocument | null): void {
  if (!document) {
    resetPhysicsWorld();
    return;
  }
  const rigidbodyNodes = collectRigidbodyNodes(document.nodes);
  if (!rigidbodyNodes.length) {
    resetPhysicsWorld();
    return;
  }
  const world = ensurePhysicsWorld();
  const desiredIds = new Set<string>();
  rigidbodyNodes.forEach((node) => {
    desiredIds.add(node.id);
    const component = resolveRigidbodyComponent(node);
    const shapeDefinition = extractRigidbodyShape(component);
    const object = nodeObjectMap.get(node.id) ?? null;
    const requiresMetadata = !isGroundDynamicMesh(node.dynamicMesh);
    if (!component || !object) {
      return;
    }
    if (!shapeDefinition && requiresMetadata) {
      return;
    }
    const existing = rigidbodyInstances.get(node.id);
    if (existing) {
      world.removeBody(existing.body);
      rigidbodyInstances.delete(node.id);
    }
    const bodyEntry = createRigidbodyBody(node, component, shapeDefinition, object);
    if (!bodyEntry) {
      return;
    }
    world.addBody(bodyEntry.body);
    rigidbodyInstances.set(node.id, {
      nodeId: node.id,
      body: bodyEntry.body,
      object,
      orientationAdjustment: bodyEntry.orientationAdjustment,
    });
  });
  rigidbodyInstances.forEach((entry, nodeId) => {
    if (!desiredIds.has(nodeId)) {
      world.removeBody(entry.body);
      rigidbodyInstances.delete(nodeId);
    }
  });
  groundHeightfieldCache.forEach((_entry, nodeId) => {
    if (!desiredIds.has(nodeId)) {
      groundHeightfieldCache.delete(nodeId);
    }
  });
  syncVehicleInstancesForDocument(document);
}

function stepPhysicsWorld(delta: number): void {
  if (!physicsWorld || !rigidbodyInstances.size) {
    return;
  }
  physicsWorld.step(PHYSICS_FIXED_TIMESTEP, delta, PHYSICS_MAX_SUB_STEPS);
  rigidbodyInstances.forEach((entry) => syncObjectFromBody(entry));
}

async function applyDeferredInstancingForNode(nodeId: string): Promise<boolean> {
  if (!deferredInstancingNodeIds.has(nodeId)) {
    return false;
  }
  if (!currentDocument || !viewerResourceCache || !sceneGraphRoot) {
    return false;
  }
  const includeNodeIds = new Set<string>();
  const nodeState = resolveNodeById(nodeId);
  if (nodeState?.sourceAssetId) {
    const related = assetNodeIdMap.get(nodeState.sourceAssetId.trim());
    if (related && related.size) {
      related.forEach((candidateId) => {
        if (deferredInstancingNodeIds.has(candidateId)) {
          includeNodeIds.add(candidateId);
        }
      });
    }
  }
  if (!includeNodeIds.size) {
    includeNodeIds.add(nodeId);
  }
  try {
    await prepareInstancedNodesForGraph(sceneGraphRoot, currentDocument, viewerResourceCache, {
      includeNodeIds,
    });
  } catch (error) {
    console.warn('[SceneViewer] Instanced mesh prepare failed', error);
    return false;
  }
  const updatedTargets: THREE.Object3D[] = [];
  sceneGraphRoot.traverse((object: THREE.Object3D) => {
    const candidateId = object.userData?.nodeId as string | undefined;
    if (candidateId && includeNodeIds.has(candidateId)) {
      updatedTargets.push(object);
    }
  });
  if (!updatedTargets.length) {
    return false;
  }
  updatedTargets.forEach((target) => {
    const candidateId = target.userData?.nodeId as string | undefined;
    if (!candidateId) {
      return;
    }
    nodeObjectMap.delete(candidateId);
    removeRigidbodyInstance(candidateId);
    registerSceneSubtree(target);
  });
  includeNodeIds.forEach((candidateId) => {
    deferredInstancingNodeIds.delete(candidateId);
    const state = lazyPlaceholderStates.get(candidateId);
    if (state) {
      state.loaded = true;
      lazyPlaceholderStates.delete(candidateId);
    }
  });
  return includeNodeIds.has(nodeId);
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
  if (!document || !lazyLoadMeshesEnabled) {
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
  if (!lazyLoadMeshesEnabled || !camera || lazyPlaceholderStates.size === 0) {
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
    deferredInstancingNodeIds.delete(state.nodeId);
    return;
  }
  if (deferredInstancingNodeIds.has(state.nodeId)) {
    const instanced = await applyDeferredInstancingForNode(state.nodeId);
    if (instanced) {
      state.loaded = true;
      lazyPlaceholderStates.delete(state.nodeId);
      return;
    }
    deferredInstancingNodeIds.delete(state.nodeId);
  }
  try {
    const detailed = await loadNodeObject(resourceCache, state.assetId, node.importMetadata ?? null);
    if (!detailed) {
      lazyPlaceholderStates.delete(state.nodeId);
      deferredInstancingNodeIds.delete(state.nodeId);
      return;
    }
    detailed.position.set(0, 0, 0);
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
    nodeObjectMap.delete(state.nodeId);
    removeRigidbodyInstance(state.nodeId);
    registerSceneSubtree(detailed);
    state.loaded = true;
    deferredInstancingNodeIds.delete(state.nodeId);
    lazyPlaceholderStates.delete(state.nodeId);
    refreshAnimationControllers(context.scene);
  } catch (error) {
    console.warn('[SceneViewer] 延迟资源加载失败', error);
    lazyPlaceholderStates.delete(state.nodeId);
    deferredInstancingNodeIds.delete(state.nodeId);
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

function syncInstancedTransform(object: THREE.Object3D | null): void {
  if (!object?.userData?.instancedAssetId) {
    return;
  }
  const nodeId = object.userData.nodeId as string | undefined;
  if (!nodeId) {
    return;
  }
  object.updateMatrixWorld(true);
  object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper);
  if (object.visible === false) {
    instancedScaleHelper.setScalar(0);
  }
  instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper);
  updateModelInstanceMatrix(nodeId, instancedMatrixHelper);
}

function updateNodeTransfrom(object: THREE.Object3D, node: SceneNode) {
  if (node.position) {
    object.position.set(node.position.x, node.position.y, node.position.z);
  }
  if (node.rotation) {
    object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z);
  }
  if (node.scale) {
    object.scale.set(node.scale.x, node.scale.y, node.scale.z);
  }
  syncInstancedTransform(object);
}

function updateNodeProperties(object: THREE.Object3D, node: SceneNode): void {
  if (node.name) {
    object.name = node.name;
  }
  updateNodeTransfrom(object, node);
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
  applyMaterialOverrides(object, node.materials, materialOverrideOptions);
  updateBehaviorVisibility(node.id, object.visible);
  syncInstancedTransform(object);
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

function resolveNodeIdFromIntersection(intersection: THREE.Intersection): string | null {
  if (typeof intersection.instanceId === 'number' && intersection.instanceId >= 0) {
    const mesh = intersection.object as THREE.InstancedMesh;
    const instancedNodeId = findNodeIdForInstance(mesh, intersection.instanceId);
    if (instancedNodeId) {
      return instancedNodeId;
    }
  }
  return resolveNodeIdFromObject(intersection.object);
}

function processBehaviorEvents(events: BehaviorRuntimeEvent[] | BehaviorRuntimeEvent | null | undefined): void {
  if (!events) {
    return;
  }
  const list = Array.isArray(events) ? events : [events];
  list.forEach((entry) => handleBehaviorRuntimeEvent(entry));
}

const uiBehaviorTokenResolvers = new Map<string, (resolution: BehaviorEventResolution) => void>();
let uiBehaviorTokenCounter = 0;

function waitForBehaviorToken(token: string): Promise<BehaviorEventResolution> {
  return new Promise((resolve) => {
    uiBehaviorTokenResolvers.set(token, resolve);
  });
}

function createUiBehaviorToken(): string {
  uiBehaviorTokenCounter += 1;
  return `ui-token-${Date.now().toString(16)}-${uiBehaviorTokenCounter.toString(16)}`;
}

function resolveBehaviorToken(token: string, resolution: BehaviorEventResolution): void {
  clearDelayTimer(token);
  stopBehaviorAnimation(token);
  const followUps = resolveBehaviorEvent(token, resolution);
  processBehaviorEvents(followUps);
  const resolver = uiBehaviorTokenResolvers.get(token);
  if (resolver) {
    uiBehaviorTokenResolvers.delete(token);
    resolver(resolution);
  }
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

function normalizeNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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
    runWithProgrammaticCameraMutation(() => {
      controls.enabled = !enabled;
      controls.update();
    });
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
  runWithProgrammaticCameraMutation(() => {
    withControlsVerticalFreedom(controls, () => {
      controls.target.copy(tempMovementVec);
      camera.position.copy(tween.startPosition);
      camera.position.y = HUMAN_EYE_HEIGHT;
      camera.lookAt(controls.target);
      controls.update();
    });
  });
  lockControlsPitchToCurrent(controls, camera);
  if (tween.elapsed >= tween.duration) {
    runWithProgrammaticCameraMutation(() => {
      withControlsVerticalFreedom(controls, () => {
        controls.target.copy(tween.to);
        camera.lookAt(controls.target);
        controls.update();
      });
    });
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
    if (!userData) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(userData, WARP_GATE_EFFECT_ACTIVE_FLAG)) {
      delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG];
    }
    if (Object.prototype.hasOwnProperty.call(userData, GUIDEBOARD_EFFECT_ACTIVE_FLAG)) {
      delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG];
    }
  });
}

function refreshEffectRuntimeTickers(): void {
  resetEffectRuntimeTickers();
  const uniqueTickers = new Set<(delta: number) => void>();
  nodeObjectMap.forEach((object) => {
    const warpGateRegistry = object.userData?.[WARP_GATE_RUNTIME_REGISTRY_KEY] as Record<string, WarpGateRuntimeRegistryEntry> | undefined;
    const guideboardRegistry = object.userData?.[GUIDEBOARD_RUNTIME_REGISTRY_KEY] as Record<string, GuideboardRuntimeRegistryEntry> | undefined;
    if (!warpGateRegistry && !guideboardRegistry) {
      return;
    }
    const userData = object.userData ?? (object.userData = {});
    if (warpGateRegistry) {
      let warpGateSeen = false;
      let warpGateActive = false;
      Object.values(warpGateRegistry).forEach((entry) => {
        if (!entry) {
          return;
        }
        if (typeof entry.tick === 'function') {
          uniqueTickers.add(entry.tick);
        }
        if (entry.props) {
          warpGateSeen = true;
          if (isWarpGateEffectActive(entry.props)) {
            warpGateActive = true;
          }
        }
      });
      if (warpGateSeen) {
        userData[WARP_GATE_EFFECT_ACTIVE_FLAG] = warpGateActive;
      } else if (Object.prototype.hasOwnProperty.call(userData, WARP_GATE_EFFECT_ACTIVE_FLAG)) {
        delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG];
      }
    } else if (Object.prototype.hasOwnProperty.call(userData, WARP_GATE_EFFECT_ACTIVE_FLAG)) {
      delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG];
    }
    if (guideboardRegistry) {
      let guideboardSeen = false;
      let guideboardActive = false;
      Object.values(guideboardRegistry).forEach((entry) => {
        if (!entry) {
          return;
        }
        if (typeof entry.tick === 'function') {
          uniqueTickers.add(entry.tick);
        }
        if (entry.props) {
          guideboardSeen = true;
          if (isGuideboardEffectActive(entry.props)) {
            guideboardActive = true;
          }
        }
      });
      if (guideboardSeen) {
        userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG] = guideboardActive;
      } else if (Object.prototype.hasOwnProperty.call(userData, GUIDEBOARD_EFFECT_ACTIVE_FLAG)) {
        delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG];
      }
    } else if (Object.prototype.hasOwnProperty.call(userData, GUIDEBOARD_EFFECT_ACTIVE_FLAG)) {
      delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG];
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
  // const desiredDistance = ownerObject
  //   ? Math.max(DEFAULT_OBJECT_RADIUS, computeObjectBoundingRadius(ownerObject))
  //   : DEFAULT_OBJECT_RADIUS;
  const destination = focusPoint.clone();
  // let usedTargetOrientation = false;
  // if (ownerObject) {
  //   ownerObject.getWorldDirection(tempVector);
  //   tempVector.y = 0;
  //   if (tempVector.lengthSq() < 1e-6) {
  //     tempVector.set(0, 0, -1);
  //     tempVector.applyQuaternion(tempQuaternion);
  //     tempVector.y = 0;
  //   }
  //   if (tempVector.lengthSq() >= 1e-6) {
  //     tempVector.normalize().multiplyScalar(desiredDistance);
  //     destination.sub(tempVector);
  //     usedTargetOrientation = true;
  //   }
  // }
  // if (!usedTargetOrientation) {
  //   tempVector.copy(camera.position).sub(focusPoint);
  //   tempVector.y = 0;
  //   if (tempVector.lengthSq() < 1e-6 && ownerObject) {
  //     tempVector.set(0, 0, -1);
  //     tempVector.applyQuaternion(tempQuaternion);
  //     tempVector.y = 0;
  //   }
  //   if (tempVector.lengthSq() < 1e-6) {
  //     tempVector.set(0, 0, 1);
  //   }
  //   tempVector.normalize().multiplyScalar(desiredDistance);
  //   destination.add(tempVector);
  // }
  destination.y = HUMAN_EYE_HEIGHT;
  const lookTarget = new THREE.Vector3(focusPoint.x, HUMAN_EYE_HEIGHT, focusPoint.z);

  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const durationSeconds = Math.max(0, event.duration ?? 0);
  
  const updateFrame = (alpha: number) => {
    runWithProgrammaticCameraMutation(() => {
      withControlsVerticalFreedom(controls, () => {
        camera.position.lerpVectors(startPosition, destination, alpha);
        controls.target.lerpVectors(startTarget, lookTarget, alpha);
        camera.lookAt(controls.target);
        controls.update();
      });
    });
    lockControlsPitchToCurrent(controls, camera);
  };
  const finalize = () => {
    runWithProgrammaticCameraMutation(() => {
      withControlsVerticalFreedom(controls, () => {
        camera.position.copy(destination);
        controls.target.copy(lookTarget);
        camera.lookAt(controls.target);
        controls.update();
      });
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
    syncInstancedTransform(object);
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
    runWithProgrammaticCameraMutation(() => {
      withControlsVerticalFreedom(controls, () => {
        controls.target.copy(focus);
        camera.position.copy(startPosition);
        camera.lookAt(focus);
        controls.update();
      });
    });
    lockControlsPitchToCurrent(controls, camera);
    return finishSuccess();
  }

  tempMovementVec.normalize();
  tempForwardVec.copy(tempMovementVec).multiplyScalar(CAMERA_FORWARD_OFFSET).add(startPosition);
  const startTarget = controls.target.clone();
  if (startTarget.distanceToSquared(tempForwardVec) < 1e-6) {
    runWithProgrammaticCameraMutation(() => {
      withControlsVerticalFreedom(controls, () => {
        camera.position.copy(startPosition);
        controls.target.copy(tempForwardVec);
        camera.lookAt(tempForwardVec);
        controls.update();
      });
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
    runWithProgrammaticCameraMutation(() => {
      withControlsVerticalFreedom(controls, () => {
        controls.target.copy(levelTarget);
        camera.lookAt(levelTarget);
        controls.update();
      });
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

type VehicleDriveControlKey = keyof VehicleDriveControlFlags;

function setVehicleDriveUiOverride(mode: 'auto' | 'show' | 'hide'): void {
  vehicleDriveUiOverride.value = mode;
}

function clampSteeringScalar(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function syncVehicleSteeringValue(): void {
  if (steeringKeyboardValue.value !== 0) {
    vehicleDriveInput.steering = clampSteeringScalar(steeringKeyboardValue.value);
    return;
  }
  vehicleDriveInput.steering = clampSteeringScalar(steeringWheelValue.value);
}

function updateSteeringKeyboardValue(): void {
  let target = 0;
  if (vehicleDriveInputFlags.left !== vehicleDriveInputFlags.right) {
    target = vehicleDriveInputFlags.left ? 1 : -1;
  }
  steeringKeyboardTarget.value = target;
  if (target !== 0) {
    steeringKeyboardValue.value = target;
  }
}

function resetSteeringWheelValue(): void {
  steeringWheelValue.value = 0;
  if (!steeringWheelState.dragging) {
    syncVehicleSteeringValue();
  }
}

function setSteeringWheelDragActive(active: boolean): void {
  steeringWheelState.dragging = active;
  if (!active) {
    steeringWheelState.pointerId = -1;
  }
}

function refreshSteeringWheelMetrics(): void {
  nextTick(() => {
    const query = uni.createSelectorQuery();
    if (typeof query.in === 'function') {
      query.in((pageInstance?.proxy as unknown) ?? null);
    }
    query
      .select('#viewer-steering-wheel')
      .boundingClientRect((rect) => {
        if (!rect) {
          steeringWheelMetrics.ready = false;
          return;
        }
        steeringWheelMetrics.centerX = rect.left + rect.width / 2;
        steeringWheelMetrics.centerY = rect.top + rect.height / 2;
        steeringWheelMetrics.ready = true;
      })
      .exec();
  });
}

function computeSteeringWheelPointerAngle(touch: Touch | null): number | null {
  if (!touch || !steeringWheelMetrics.ready) {
    return null;
  }
  const clientX = 'clientX' in touch ? touch.clientX : (touch as unknown as { x?: number }).x || 0;
  const clientY = 'clientY' in touch ? touch.clientY : (touch as unknown as { y?: number }).y || 0;
  const dx = clientX - steeringWheelMetrics.centerX;
  const dy = clientY - steeringWheelMetrics.centerY;
  return Math.atan2(dy, dx);
}

function approachSteeringValue(current: number, target: number, rate: number, delta: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(delta) || rate <= 0 || delta <= 0) {
    return target;
  }
  const difference = target - current;
  if (Math.abs(difference) <= 1e-4) {
    return target;
  }
  const maxStep = rate * delta;
  if (Math.abs(difference) <= maxStep) {
    return target;
  }
  return current + Math.sign(difference) * maxStep;
}

function updateSteeringAutoCenter(delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) {
    return;
  }
  let dirty = false;
  if (!steeringWheelState.dragging) {
    const nextWheel = approachSteeringValue(steeringWheelValue.value, 0, STEERING_WHEEL_RETURN_SPEED, delta);
    if (nextWheel !== steeringWheelValue.value) {
      steeringWheelValue.value = nextWheel;
      dirty = true;
    }
  }
  const target = steeringKeyboardTarget.value;
  const keyboardRate = target === 0 ? STEERING_KEYBOARD_RETURN_SPEED : STEERING_KEYBOARD_CATCH_SPEED;
  const nextKeyboard = approachSteeringValue(steeringKeyboardValue.value, target, keyboardRate, delta);
  if (nextKeyboard !== steeringKeyboardValue.value) {
    steeringKeyboardValue.value = clampSteeringScalar(nextKeyboard);
    dirty = true;
  }
  if (dirty) {
    syncVehicleSteeringValue();
  }
}

function extractTouchById(event: TouchEvent, identifier: number): Touch | null {
  const touches: readonly Touch[] = [...Array.from(event.changedTouches || [])];
  for (const touch of touches) {
    if (touch.identifier === identifier) {
      return touch;
    }
  }
  const activeTouches: readonly Touch[] = [...Array.from(event.touches || [])];
  for (const touch of activeTouches) {
    if (touch.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

function handleSteeringWheelTouchStart(event: TouchEvent): void {
  if (!vehicleDriveActive.value) {
    return;
  }
  const touch = event.changedTouches?.[0] ?? null;
  if (!touch) {
    return;
  }
  if (!steeringWheelMetrics.ready) {
    refreshSteeringWheelMetrics();
  }
  const pointerAngle = computeSteeringWheelPointerAngle(touch);
  if (pointerAngle === null) {
    return;
  }
  steeringWheelState.startPointerAngle = pointerAngle;
  steeringWheelState.startWheelAngle = steeringWheelValue.value * THREE.MathUtils.degToRad(STEERING_WHEEL_MAX_DEGREES);
  steeringWheelState.pointerId = touch.identifier;
  setSteeringWheelDragActive(true);
}

function handleSteeringWheelTouchMove(event: TouchEvent): void {
  if (!steeringWheelState.dragging || steeringWheelState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, steeringWheelState.pointerId);
  if (!touch) {
    return;
  }
  const angle = computeSteeringWheelPointerAngle(touch);
  if (angle === null) {
    return;
  }
  const delta = angle - steeringWheelState.startPointerAngle;
  const nextAngle = steeringWheelState.startWheelAngle + delta;
  const clampedAngle = Math.max(
    THREE.MathUtils.degToRad(-STEERING_WHEEL_MAX_DEGREES),
    Math.min(THREE.MathUtils.degToRad(STEERING_WHEEL_MAX_DEGREES), nextAngle),
  );
  steeringWheelValue.value = clampSteeringScalar(clampedAngle / THREE.MathUtils.degToRad(STEERING_WHEEL_MAX_DEGREES));
  syncVehicleSteeringValue();
}

function handleSteeringWheelTouchEnd(event: TouchEvent): void {
  if (steeringWheelState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, steeringWheelState.pointerId);
  if (!touch) {
    return;
  }
  setSteeringWheelDragActive(false);
}

function updateVehicleDriveInputFromFlags(): void {
  vehicleDriveInput.throttle = vehicleDriveInputFlags.forward === vehicleDriveInputFlags.backward
    ? 0
    : vehicleDriveInputFlags.forward
      ? 1
      : -1;
  vehicleDriveInput.brake = vehicleDriveInputFlags.brake ? 1 : 0;
  updateSteeringKeyboardValue();
  syncVehicleSteeringValue();
}

function resetVehicleDriveInputs(): void {
  vehicleDriveInputFlags.forward = false;
  vehicleDriveInputFlags.backward = false;
  vehicleDriveInputFlags.left = false;
  vehicleDriveInputFlags.right = false;
  vehicleDriveInputFlags.brake = false;
  steeringKeyboardValue.value = 0;
  steeringKeyboardTarget.value = 0;
  resetSteeringWheelValue();
  vehicleDriveInput.throttle = 0;
  vehicleDriveInput.brake = 0;
  vehicleDriveInput.steering = 0;
  updateVehicleDriveInputFromFlags();
}

function handleVehicleDriveControlTouch(
  key: VehicleDriveControlKey,
  active: boolean,
  event?: Event,
): void {
  if (event) {
    if ('stopPropagation' in event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    if ('preventDefault' in event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  }
  vehicleDriveInputFlags[key] = active;
  updateVehicleDriveInputFromFlags();
}

type VehicleDrivePreparationResult =
  | { success: true; instance: VehicleInstance }
  | { success: false; message: string };

function prepareVehicleDriveTarget(nodeId: string): VehicleDrivePreparationResult {
  const node = resolveNodeById(nodeId);
  if (!node) {
    return { success: false, message: '车辆节点不存在' };
  }
  const hasRigidbody = Boolean(resolveRigidbodyComponent(node));
  const hasVehicle = Boolean(resolveVehicleComponent(node));
  if (!hasRigidbody || !hasVehicle) {
    return { success: false, message: '目标缺少车辆或刚体组件' };
  }
  if (!physicsWorld) {
    ensurePhysicsWorld();
  }
  ensureVehicleBindingForNode(nodeId);
  const instance = vehicleInstances.get(nodeId);
  if (!instance) {
    return { success: false, message: '车辆实例尚未准备好' };
  }
  if (!rigidbodyInstances.has(nodeId)) {
    return { success: false, message: '车辆缺少可驱动的刚体' };
  }
  return { success: true, instance };
}


function handleVehicleDriveCameraToggle(): void {
  if (!vehicleDriveActive.value) {
    return;
  }
  vehicleDriveCameraMode.value = vehicleDriveCameraMode.value === 'follow' ? 'first-person' : 'follow';
  vehicleDriveCameraFollowState.initialized = false;
  updateVehicleDriveCamera(0, { immediate: true });
}

function handleVehicleDriveResetTap(): void {
  if (!vehicleDriveActive.value || vehicleDriveResetBusy.value) {
    return;
  }
  vehicleDriveResetBusy.value = true;
  try {
    const success = resetActiveVehiclePose();
    if (!success) {
      uni.showToast({ title: '无法重置车辆', icon: 'none' });
      return;
    }
    updateVehicleDriveCamera(0, { immediate: true });
  } finally {
    vehicleDriveResetBusy.value = false;
  }
}

function resetActiveVehiclePose(): boolean {
  const nodeId = normalizeNodeId(vehicleDriveNodeId.value);
  if (!nodeId) {
    return false;
  }
  const rigidbody = rigidbodyInstances.get(nodeId);
  const instance = vehicleInstances.get(nodeId);
  if (!rigidbody || !instance || !rigidbody.body || !rigidbody.object) {
    return false;
  }
  rigidbody.object.updateMatrixWorld(true);
  rigidbody.object.getWorldPosition(tempVehicleResetPosition);
  rigidbody.object.getWorldQuaternion(tempVehicleResetQuaternion);
  const worldForward = tempVehicleAxisForward.copy(instance.axisForward).applyQuaternion(tempVehicleResetQuaternion);
  if (worldForward.lengthSq() < 1e-6) {
    worldForward.set(0, 0, 1);
  }
  worldForward.y = 0;
  if (worldForward.lengthSq() < 1e-6) {
    worldForward.set(0, 0, 1);
  } else {
    worldForward.normalize();
  }
  const worldUp = tempVehicleAxisUp.copy(instance.axisUp).applyQuaternion(tempVehicleResetQuaternion);
  if (worldUp.lengthSq() < 1e-6) {
    worldUp.set(0, 1, 0);
  } else {
    worldUp.normalize();
  }
  const worldRight = tempVehicleAxisRight.copy(worldUp).cross(worldForward);
  if (worldRight.lengthSq() < 1e-6) {
    worldRight.set(1, 0, 0);
  } else {
    worldRight.normalize();
  }
  const correctedForward = tempVehicleAxisForward.copy(worldRight).cross(worldUp);
  if (correctedForward.lengthSq() < 1e-6) {
    correctedForward.set(0, 0, 1);
  } else {
    correctedForward.normalize();
  }
  tempVehicleResetMatrix.makeBasis(worldRight, worldUp, correctedForward);
  tempVehicleResetQuaternion.setFromRotationMatrix(tempVehicleResetMatrix);
  const resetPosition = tempVehicleResetPosition;
  resetPosition.y += VEHICLE_RESET_LIFT;
  rigidbody.body.position.set(resetPosition.x, resetPosition.y, resetPosition.z);
  rigidbody.body.velocity.set(0, 0, 0);
  rigidbody.body.angularVelocity.set(0, 0, 0);
  rigidbody.body.quaternion.set(
    tempVehicleResetQuaternion.x,
    tempVehicleResetQuaternion.y,
    tempVehicleResetQuaternion.z,
    tempVehicleResetQuaternion.w,
  );
  rigidbody.object.position.copy(resetPosition);
  rigidbody.object.quaternion.copy(tempVehicleResetQuaternion);
  rigidbody.object.updateMatrixWorld(true);
  vehicleDriveCameraFollowState.initialized = false;
  return true;
}

function computeVehicleFallbackSeatPosition(object: THREE.Object3D | null, target: THREE.Vector3): void {
  if (!object) {
    target.set(0, VEHICLE_CAMERA_FALLBACK_HEIGHT, 0);
    return;
  }
  tempBox.makeEmpty();
  tempBox.setFromObject(object);
  if (tempBox.isEmpty()) {
    object.getWorldPosition(target);
    target.addScaledVector(worldUp, VEHICLE_CAMERA_FALLBACK_HEIGHT);
    return;
  }
  tempBox.getCenter(target);
  tempBox.getSize(tempVehicleSize);
  const upOffset = Math.max(tempVehicleSize.y * VEHICLE_CAMERA_FALLBACK_HEIGHT_RATIO, VEHICLE_CAMERA_FALLBACK_HEIGHT);
  target.addScaledVector(worldUp, upOffset);
}

function getVehicleApproxDimensions(object: THREE.Object3D | null): { width: number; height: number; length: number } {
  if (!object) {
    return { ...VEHICLE_SIZE_FALLBACK };
  }
  tempBox.makeEmpty();
  tempBox.setFromObject(object);
  if (tempBox.isEmpty()) {
    return { ...VEHICLE_SIZE_FALLBACK };
  }
  tempBox.getSize(tempVehicleSize);
  return {
    width: Math.max(tempVehicleSize.x, VEHICLE_SIZE_FALLBACK.width),
    height: Math.max(tempVehicleSize.y, VEHICLE_SIZE_FALLBACK.height),
    length: Math.max(tempVehicleSize.z, VEHICLE_SIZE_FALLBACK.length),
  };
}

function buildVehicleDriveCameraBasis(
  seatObject: THREE.Object3D | null,
  vehicleObject: THREE.Object3D | null,
): boolean {
  const referenceObject = seatObject ?? vehicleObject;
  if (!referenceObject) {
    return false;
  }
  referenceObject.updateMatrixWorld(true);
  referenceObject.getWorldQuaternion(tempDriveSeatQuaternion);
  if (seatObject) {
    seatObject.updateMatrixWorld(true);
    seatObject.getWorldPosition(tempDriveSeatPosition);
  } else {
    computeVehicleFallbackSeatPosition(vehicleObject ?? referenceObject, tempDriveSeatPosition);
  }
  tempDriveForward.set(0, 0, -1).applyQuaternion(tempDriveSeatQuaternion);
  if (tempDriveForward.lengthSq() < 1e-8) {
    tempDriveForward.set(0, 0, -1);
  } else {
    tempDriveForward.normalize();
  }
  tempDriveRight.copy(tempDriveForward).cross(worldUp);
  if (tempDriveRight.lengthSq() < 1e-8) {
    tempDriveRight.set(1, 0, 0).applyQuaternion(tempDriveSeatQuaternion);
    if (tempDriveRight.lengthSq() < 1e-8) {
      tempDriveRight.set(1, 0, 0);
    } else {
      tempDriveRight.normalize();
    }
  } else {
    tempDriveRight.normalize();
  }
  tempDriveSeatUp.crossVectors(tempDriveRight, tempDriveForward);
  if (tempDriveSeatUp.lengthSq() < 1e-8) {
    tempDriveSeatUp.copy(worldUp);
  } else {
    tempDriveSeatUp.normalize();
  }
  return true;
}

function computeVehicleDriveCameraTargets(
  seatNodeId: string | null,
  fallbackNodeId: string | null,
): boolean {
  const seatObject = seatNodeId ? nodeObjectMap.get(seatNodeId) ?? null : null;
  const vehicleObject = fallbackNodeId ? nodeObjectMap.get(fallbackNodeId) ?? null : null;
  if (!buildVehicleDriveCameraBasis(seatObject, vehicleObject)) {
    return false;
  }
  tempDriveLookTarget
    .copy(tempDriveSeatPosition)
    .addScaledVector(tempDriveForward, VEHICLE_CAMERA_DEFAULT_LOOK_DISTANCE);
  return true;
}

function alignVehicleDriveCameraImmediate(
  seatNodeId: string | null,
  fallbackNodeId: string | null,
): { success: boolean; message?: string } {
  const context = renderContext;
  if (!context) {
    return { success: false, message: '相机不可用' };
  }
  if (!computeVehicleDriveCameraTargets(seatNodeId, fallbackNodeId)) {
    return { success: false, message: '无法定位驾驶摄像机' };
  }
  const { camera, controls } = context;
  runWithProgrammaticCameraMutation(() => {
    camera.position.copy(tempDriveSeatPosition);
    camera.up.copy(tempDriveSeatUp);
    controls.target.copy(tempDriveLookTarget);
    controls.update();
    camera.position.copy(tempDriveSeatPosition);
    tempDriveCameraMatrix.lookAt(tempDriveSeatPosition, tempDriveLookTarget, tempDriveSeatUp);
    tempDriveCameraMatrix.invert();
    tempDriveCameraQuaternion.setFromRotationMatrix(tempDriveCameraMatrix);
    camera.quaternion.copy(tempDriveCameraQuaternion);
    camera.updateMatrixWorld(true);
  });
  return { success: true };
}

function updateVehicleDriveCamera(): void {
  if (!vehicleDriveActive.value || !renderContext) {
    return;
  }
  const seatNodeId = vehicleDriveSeatNodeId.value;
  const fallbackNodeId = normalizeNodeId(vehicleDriveNodeId.value);
  if (!computeVehicleDriveCameraTargets(seatNodeId, fallbackNodeId)) {
    return;
  }
  const { camera, controls } = renderContext;
  runWithProgrammaticCameraMutation(() => {
    camera.position.copy(tempDriveSeatPosition);
    camera.up.copy(tempDriveSeatUp);
    controls.target.copy(tempDriveLookTarget);
    controls.update();
    camera.position.copy(tempDriveSeatPosition);
    tempDriveCameraMatrix.lookAt(tempDriveSeatPosition, tempDriveLookTarget, tempDriveSeatUp);
    tempDriveCameraMatrix.invert();
    tempDriveCameraQuaternion.setFromRotationMatrix(tempDriveCameraMatrix);
    camera.quaternion.copy(tempDriveCameraQuaternion);
    camera.updateMatrixWorld(true);
  });
}

function snapshotVehicleDriveCameraState(): void {
  const context = renderContext;
  if (!context) {
    vehicleDriveCameraRestoreState.hasSnapshot = false;
    return;
  }
  vehicleDriveCameraRestoreState.position.copy(context.camera.position);
  vehicleDriveCameraRestoreState.quaternion.copy(context.camera.quaternion);
  vehicleDriveCameraRestoreState.up.copy(context.camera.up);
  vehicleDriveCameraRestoreState.target.copy(context.controls.target);
  vehicleDriveCameraRestoreState.viewMode = cameraViewState.mode;
  vehicleDriveCameraRestoreState.viewTargetId = cameraViewState.targetNodeId;
  vehicleDriveCameraRestoreState.isCameraCaged = isCameraCaged.value;
  vehicleDriveCameraRestoreState.purposeMode = purposeActiveMode.value;
  vehicleDriveCameraRestoreState.hasSnapshot = true;
}

function restoreVehicleDriveCameraState(): void {
  const context = renderContext;
  if (!context || !vehicleDriveCameraRestoreState.hasSnapshot) {
    setCameraCaging(false);
    purposeActiveMode.value = 'level';
    setCameraViewState('level');
    vehicleDriveCameraRestoreState.hasSnapshot = false;
    return;
  }
  runWithProgrammaticCameraMutation(() => {
    const { camera, controls } = context;
    camera.position.copy(vehicleDriveCameraRestoreState.position);
    camera.up.copy(vehicleDriveCameraRestoreState.up);
    camera.quaternion.copy(vehicleDriveCameraRestoreState.quaternion);
    camera.updateMatrixWorld(true);
    withControlsVerticalFreedom(controls, () => {
      controls.target.copy(vehicleDriveCameraRestoreState.target);
      camera.lookAt(vehicleDriveCameraRestoreState.target);
      controls.update();
    });
  });
  cameraRotationAnchor.copy(context.camera.position);
  lockControlsPitchToCurrent(context.controls, context.camera);
  setCameraCaging(vehicleDriveCameraRestoreState.isCameraCaged);
  purposeActiveMode.value = vehicleDriveCameraRestoreState.purposeMode;
  setCameraViewState(
    vehicleDriveCameraRestoreState.viewMode,
    vehicleDriveCameraRestoreState.viewMode === 'watching'
      ? vehicleDriveCameraRestoreState.viewTargetId ?? null
      : null,
  );
  vehicleDriveCameraRestoreState.hasSnapshot = false;
}

function alignVehicleDriveExitCamera(): boolean {
  const context = renderContext;
  if (!context) {
    return false;
  }
  const vehicleNodeId = normalizeNodeId(vehicleDriveNodeId.value);
  if (!vehicleNodeId) {
    return false;
  }
  const seatNodeId = vehicleDriveSeatNodeId.value;
  const seatObject = seatNodeId ? nodeObjectMap.get(seatNodeId) ?? null : null;
  const vehicleObject = nodeObjectMap.get(vehicleNodeId) ?? null;
  if (!buildVehicleDriveCameraBasis(seatObject, vehicleObject)) {
    return false;
  }
  const dimensions = getVehicleApproxDimensions(vehicleObject);
  const lateralOffset = Math.max(dimensions.width * VEHICLE_EXIT_LATERAL_RATIO, VEHICLE_EXIT_LATERAL_MIN);
  const verticalOffset = Math.max(dimensions.height * VEHICLE_EXIT_VERTICAL_RATIO, VEHICLE_EXIT_VERTICAL_MIN);
  const forwardOffset = Math.max(dimensions.length * VEHICLE_EXIT_FORWARD_RATIO, VEHICLE_EXIT_FORWARD_MIN);
  tempDriveSeatPosition.addScaledVector(tempDriveRight, -lateralOffset);
  tempDriveSeatPosition.addScaledVector(tempDriveSeatUp, verticalOffset);
  tempDriveLookTarget
    .copy(tempDriveSeatPosition)
    .addScaledVector(tempDriveForward, forwardOffset);
  runWithProgrammaticCameraMutation(() => {
    const { camera, controls } = context;
    camera.position.copy(tempDriveSeatPosition);
    withControlsVerticalFreedom(controls, () => {
      controls.target.copy(tempDriveLookTarget);
      camera.lookAt(tempDriveLookTarget);
      controls.update();
    });
  });
  cameraRotationAnchor.copy(context.camera.position);
  lockControlsPitchToCurrent(context.controls, context.camera);
  return true;
}

async function handleVehicleDrivePromptTap(): Promise<void> {
  const event = pendingVehicleDriveEvent.value;
  if (!event || vehicleDrivePromptBusy.value) {
    return;
  }
  vehicleDrivePromptBusy.value = true;
  try {
    vehicleDriveToken.value = event.token;
    activeVehicleDriveEvent.value = { ...event };
    vehicleDriveSeatNodeId.value = seatNodeId;
    vehicleDriveExitBusy.value = false;
    resetVehicleDriveInputs();
    setCameraCaging(true);
    purposeActiveMode.value = 'watch';
    setCameraViewState('watching', resolvedTargetNodeId);
    pendingVehicleDriveEvent.value = null;
  } finally {
    vehicleDrivePromptBusy.value = false;
  }
}

function handleVehicleDriveExitTap(): void {
  if (!vehicleDriveActive.value || vehicleDriveExitBusy.value) {
    return;
  }
  const event = activeVehicleDriveEvent.value;
  if (!event) {
    uni.showToast({ title: '缺少驾驶上下文', icon: 'none' });
    handleVehicleDebusEvent();
    return;
  }
  vehicleDriveExitBusy.value = true;
  try {
    const aligned = alignVehicleDriveExitCamera();
    if (!aligned) {
      uni.showToast({ title: '无法定位默认下车位置，已恢复默认视角', icon: 'none' });
    }
    handleHideVehicleCockpitEvent();
    handleVehicleDebusEvent();
  } finally {
    vehicleDriveExitBusy.value = false;
  }
}

function handleVehicleDriveEvent(event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>): void {
  const targetNodeId = event.targetNodeId || event.nodeId || null;
  if (!targetNodeId) {
    uni.showToast({ title: '缺少驾驶目标', icon: 'none' });
    resolveBehaviorToken(event.token, { type: 'fail', message: '缺少驾驶目标' });
    return;
  }
  if (vehicleDriveActive.value) {
    restoreVehicleDriveCameraState();
    vehicleDriveActive.value = false;
    vehicleDriveNodeId.value = null;
    vehicleDriveSeatNodeId.value = null;
    resetVehicleDriveInputs();
    setVehicleDriveUiOverride('hide');
    activeVehicleDriveEvent.value = null;
    vehicleDriveExitBusy.value = false;
    const activeToken = vehicleDriveToken.value;
    if (activeToken) {
      resolveBehaviorToken(activeToken, { type: 'abort', message: '驾驶状态被新的脚本替换。' });
      vehicleDriveToken.value = null;
    }
  }
  if (pendingVehicleDriveEvent.value) {
    resolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
      type: 'abort',
      message: '已有驾驶请求已取消。',
    });
  }
  pendingVehicleDriveEvent.value = event;
  vehicleDrivePromptBusy.value = false;
  setVehicleDriveUiOverride('hide');
  resetVehicleDriveInputs();
  vehicleDriveExitBusy.value = false;
}

function handleVehicleDebusEvent(): void {
  if (pendingVehicleDriveEvent.value) {
    resolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
      type: 'abort',
      message: '驾驶请求已被终止。',
    });
    pendingVehicleDriveEvent.value = null;
    vehicleDrivePromptBusy.value = false;
    setVehicleDriveUiOverride('hide');
  }
  if (!vehicleDriveActive.value) {
    restoreVehicleDriveCameraState();
    return;
  }
  restoreVehicleDriveCameraState();
  vehicleDriveActive.value = false;
  vehicleDriveNodeId.value = null;
  vehicleDriveSeatNodeId.value = null;
  resetVehicleDriveInputs();
  setVehicleDriveUiOverride('hide');
  activeVehicleDriveEvent.value = null;
  vehicleDriveExitBusy.value = false;
  const token = vehicleDriveToken.value;
  if (token) {
    resolveBehaviorToken(token, { type: 'continue' });
    vehicleDriveToken.value = null;
  }
}

function handleShowVehicleCockpitEvent(): void {
  setVehicleDriveUiOverride('show');
}

function handleHideVehicleCockpitEvent(): void {
  setVehicleDriveUiOverride('hide');
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
    case 'vehicle-drive':
      handleVehicleDriveEvent(event);
      break;
    case 'vehicle-debus':
      handleVehicleDebusEvent();
      break;
    case 'vehicle-show-cockpit':
      handleShowVehicleCockpitEvent();
      break;
    case 'vehicle-hide-cockpit':
      handleHideVehicleCockpitEvent();
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
      const nodeId = resolveNodeIdFromIntersection(intersection);
      if (!nodeId) {
        continue;
      }
      const hitObject = nodeObjectMap.get(nodeId) ?? intersection.object;
      const results = triggerBehaviorAction(nodeId, 'click', {
        intersection: {
          object: hitObject,
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

function applyPhysicsEnvironmentSettings(settings: EnvironmentSettings) {
  const gravity = clampNumber(settings.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY);
  physicsGravity.set(0, -gravity, 0);
  physicsContactRestitution = clampNumber(
    settings.collisionRestitution,
    0,
    1,
    DEFAULT_ENVIRONMENT_RESTITUTION,
  );
  physicsContactFriction = clampNumber(
    settings.collisionFriction,
    0,
    1,
    DEFAULT_ENVIRONMENT_FRICTION,
  );
  if (physicsWorld) {
    physicsWorld.gravity.set(physicsGravity.x, physicsGravity.y, physicsGravity.z);
    physicsWorld.defaultContactMaterial.friction = physicsContactFriction;
    physicsWorld.defaultContactMaterial.restitution = physicsContactRestitution;
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
  applyPhysicsEnvironmentSettings(snapshot);
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
  disposeMaterialOverrides(material);
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
  const context = renderContext;
  if (!context) {
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
  runWithProgrammaticCameraMutation(() => {
    translateCamera(direction * WHEEL_MOVE_STEP * magnitude, 0);
    context.controls.update();
  });
}

function teardownRenderer() {
  teardownWheelControls();
  if (!renderContext) {
    return;
  }
  const { renderer, scene, controls } = renderContext;
  releaseTerrainScatterInstances();
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
  nodeObjectMap.forEach((_object, nodeId) => {
    releaseModelInstance(nodeId);
  });
  nodeObjectMap.clear();
  resetPhysicsWorld();
  lazyPlaceholderStates.clear();
  deferredInstancingNodeIds.clear();
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
  stopInstancedMeshSubscription?.();
  stopInstancedMeshSubscription = null;
  clearInstancedMeshes();
  disposeObject(scene);
  disposeMaterialTextureCache();
  renderer.dispose();
  sunDirectionalLight = null;
  renderContext = null;
  canvasResult = null;
  currentDocument = null;
  sceneGraphRoot = null;
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
    cameraRotationAnchor.copy(camera.position);
  });

  const handleControlsChange = () => {
    if (!renderContext || isProgrammaticCameraMutationActive() || suppressSelfYawRecenter) {
      return;
    }
    const { camera: contextCamera, controls: contextControls } = renderContext;
    tempYawForwardVec.copy(contextControls.target).sub(contextCamera.position);
    if (tempYawForwardVec.lengthSq() < 1e-8) {
      return;
    }
    suppressSelfYawRecenter = true;
    tempYawForwardVec.normalize();
    contextCamera.position.copy(cameraRotationAnchor);
    contextControls.target.copy(contextCamera.position).addScaledVector(tempYawForwardVec, CAMERA_FORWARD_OFFSET);
    contextCamera.lookAt(contextControls.target);
    suppressSelfYawRecenter = false;
  };

  controls.addEventListener('change', handleControlsChange);
  controls.addEventListener('end', () => {
    cameraRotationAnchor.copy(camera.position);
  });

  runWithProgrammaticCameraMutation(() => {
    controls.update();
  });
  cameraRotationAnchor.copy(camera.position);
  lockControlsPitchToCurrent(controls, camera);
  setupWheelControls(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f9f9f9');
  scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY;

  scene.add(instancedMeshGroup);
  clearInstancedMeshes();
  stopInstancedMeshSubscription?.();
  stopInstancedMeshSubscription = subscribeInstancedMeshes((mesh) => {
    attachInstancedMesh(mesh);
  });

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
  releaseTerrainScatterInstances();
  nodeObjectMap.forEach((_object, nodeId) => {
    releaseModelInstance(nodeId);
  });
  nodeObjectMap.clear();
  resetPhysicsWorld();
  clearInstancedMeshes();
  scene.children.forEach((child) => disposeObject(child));
  disposeMaterialTextureCache();
  scene.clear();
  scene.add(instancedMeshGroup);
  clearInstancedMeshes();
  sceneGraphRoot = null;
  deferredInstancingNodeIds.clear();
  lazyPlaceholderStates.clear();
  activeLazyLoadCount = 0;
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

  let graph: Awaited<ReturnType<typeof buildSceneGraph>> | null = null;
  let resourceCache: ResourceCache | null = null;
  try {
    lazyLoadMeshesEnabled = payload.document.lazyLoadMeshes !== false;
    const buildOptions: SceneGraphBuildOptions = {
      enableGround: payload.enableGround ?? true,
      materialFactoryOptions: {
        hdrLoader: rgbeLoader,
      },
      onProgress: (info) => {
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
  resourceCache = ensureResourceCache(payload.document, buildOptions);
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
  let instancingSkipNodeIds: Set<string> | null = null;
  if (lazyLoadMeshesEnabled) {
    instancingSkipNodeIds = new Set<string>();
    graph.root.traverse((object: THREE.Object3D) => {
      const nodeId = object.userData?.nodeId as string | undefined;
      if (!nodeId) {
        return;
      }
      const lazyData = object.userData?.lazyAsset as LazyAssetMetadata;
      if (lazyData?.placeholder) {
        instancingSkipNodeIds!.add(nodeId);
      }
    });
  }
  if (instancingSkipNodeIds?.size) {
    instancingSkipNodeIds.forEach((nodeId) => deferredInstancingNodeIds.add(nodeId));
  }
  sceneGraphRoot = graph.root;
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
  syncPhysicsBodiesForDocument(payload.document);
  await syncTerrainScatterInstances(payload.document, resourceCache);


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
          cameraRotationAnchor.copy(camera.position);
          if (!vehicleDriveActive.value) {
            controls.update();
          }
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
          stepPhysicsWorld(deltaSeconds);
        }
        if (vehicleDriveActive.value) {
          updateVehicleDriveCamera();
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

.viewer-drive-start {
  position: absolute;
  right: 16px;
  bottom: 320px;
  z-index: 1540;
}

.viewer-drive-start__button {
  width: 220px;
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(14, 20, 42, 0.9);
  box-shadow: 0 16px 42px rgba(4, 10, 24, 0.38);
  color: #f4f6ff;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  border: none;
  outline: none;
  font-size: 14px;
  letter-spacing: 0.4px;
}

.viewer-drive-start__button:disabled {
  opacity: 0.78;
}

.viewer-drive-start__button.is-busy {
  background: rgba(20, 30, 58, 0.9);
}

.viewer-drive-start__label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.viewer-drive-start__title {
  font-size: 16px;
  font-weight: 600;
}

.viewer-drive-start__subtitle {
  font-size: 13px;
  color: rgba(214, 224, 255, 0.86);
}

.viewer-drive-start__status {
  font-size: 12px;
  color: rgba(188, 204, 255, 0.76);
}

.viewer-drive-panel {
  position: absolute;
  right: 16px;
  bottom: 148px;
  width: 220px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(10, 15, 32, 0.88);
  box-shadow: 0 18px 48px rgba(6, 12, 28, 0.4);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 14px;
  z-index: 1550;
  backdrop-filter: blur(10px);
}

.viewer-drive-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.viewer-drive-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.6px;
}

.viewer-drive-title__text {
  color: #f4f6ff;
}

.viewer-drive-node {
  font-size: 12px;
  color: rgba(220, 230, 255, 0.78);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.viewer-drive-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.viewer-drive-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.viewer-drive-steering-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.viewer-drive-steering-wheel {
  width: 110px;
  height: 110px;
  border-radius: 999px;
  border: 3px solid rgba(124, 156, 255, 0.4);
  background: rgba(16, 24, 52, 0.9);
  box-shadow: inset 0 0 12px rgba(4, 8, 20, 0.8);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s ease;
}

.viewer-drive-steering-spokes {
  position: absolute;
  width: 68px;
  height: 68px;
  background:
    linear-gradient(
      0deg,
      transparent 45%,
      rgba(180, 198, 255, 0.4) 45%,
      rgba(180, 198, 255, 0.4) 55%,
      transparent 55%
    ),
    linear-gradient(
      90deg,
      transparent 45%,
      rgba(180, 198, 255, 0.4) 45%,
      rgba(180, 198, 255, 0.4) 55%,
      transparent 55%
    );
  pointer-events: none;
}

.viewer-drive-steering-hub {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(40, 58, 108, 0.95);
  border: 2px solid rgba(142, 168, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewer-drive-steering-hub text {
  font-size: 12px;
  color: rgba(236, 242, 255, 0.9);
}

.viewer-drive-grid-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.viewer-drive-camera-toggle,
.viewer-drive-reset {
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: none;
  outline: none;
  background: rgba(26, 40, 82, 0.92);
  color: rgba(222, 232, 255, 0.94);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.4px;
  box-shadow: inset 0 0 0 1px rgba(120, 150, 255, 0.24);
}

.viewer-drive-reset.is-busy,
.viewer-drive-camera-toggle:disabled,
.viewer-drive-reset:disabled {
  opacity: 0.78;
}

.viewer-drive-exit {
  margin-top: 14px;
  width: 100%;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(20, 32, 68, 0.92);
  color: rgba(234, 240, 255, 0.92);
  border: none;
  outline: none;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.4px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(118, 146, 255, 0.24);
  transition: background 0.18s ease, box-shadow 0.18s ease;
}

.viewer-drive-exit.is-busy {
  background: rgba(28, 44, 80, 0.92);
  box-shadow: inset 0 0 0 1px rgba(118, 146, 255, 0.3);
}

.viewer-drive-exit:disabled {
  opacity: 0.78;
}

.viewer-drive-exit__text {
  color: inherit;
}

.viewer-drive-button {
  background: rgba(22, 32, 66, 0.9);
  border-radius: 12px;
  padding: 12px 10px;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: rgba(238, 244, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(124, 156, 255, 0.22);
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.viewer-drive-button--wide {
  grid-column: span 2;
}

.viewer-drive-button--brake {
  background: rgba(120, 32, 40, 0.92);
  box-shadow: inset 0 0 0 1px rgba(255, 132, 132, 0.38);
}

.viewer-drive-button.is-active {
  transform: translateY(1px);
  background: rgba(64, 110, 255, 0.95);
  box-shadow:
    inset 0 0 0 1px rgba(184, 214, 255, 0.65),
    0 8px 18px rgba(54, 102, 255, 0.45);
}

.viewer-drive-button--brake.is-active {
  background: rgba(210, 72, 70, 0.96);
  box-shadow:
    inset 0 0 0 1px rgba(255, 192, 192, 0.75),
    0 10px 18px rgba(210, 72, 70, 0.4);
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
