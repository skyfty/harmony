<template>
  <view class="viewer-page">
    <view
      class="viewer-canvas-wrapper"
      @touchstart.capture="handleDrivePadTouchStart"
      @touchmove.capture="handleDrivePadTouchMove"
      @touchend.capture="handleDrivePadTouchEnd"
      @touchcancel.capture="handleDrivePadTouchEnd"
      @mousedown.capture="handleDrivePadMouseDown"
    >
      <PlatformCanvas
        v-if="!error"
        :canvas-id="canvasId"
        type="webgl"
        class="viewer-canvas"
        @useCanvas="handleUseCanvas"
      />
      <view
        v-if="punchTotalCount > 0"
        class="viewer-punch-summary"
        :style="punchSummaryStyle"
        aria-hidden="true"
      >
        <text class="viewer-punch-summary__label">打卡</text>
        <text class="viewer-punch-summary__value">{{ punchCheckedCount }}/{{ punchTotalCount }}</text>
      </view>
      <button
        v-if="floatingAutoTourButton.visible"
        class="viewer-auto-tour-trigger"
        :class="{
          'is-active': floatingAutoTourButton.active,
          'is-busy': floatingAutoTourButton.busy,
        }"
        :style="floatingAutoTourButtonStyle"
        :disabled="floatingAutoTourButton.disabled"
        type="button"
        hover-class="none"
        aria-label="自动导览"
        @tap="handleFloatingAutoTourTap"
      >
        <view class="viewer-auto-tour-trigger__content">
          <text class="viewer-auto-tour-trigger__label">{{ floatingAutoTourButton.label }}</text>
        </view>
      </button>
      <button
        v-if="floatingAutoTourPauseButton.visible"
        class="viewer-auto-tour-trigger viewer-auto-tour-trigger--secondary"
        :class="{
          'is-active': floatingAutoTourPauseButton.pressed,
          'is-busy': floatingAutoTourPauseButton.busy,
        }"
        :style="floatingAutoTourPauseButtonStyle"
        :disabled="floatingAutoTourPauseButton.disabled"
        type="button"
        hover-class="none"
        :aria-label="floatingAutoTourPauseButton.label"
        :aria-pressed="floatingAutoTourPauseButton.pressed"
        @tap="handleFloatingAutoTourPauseToggleTap"
      >
        <view class="viewer-auto-tour-trigger__content">
          <text class="viewer-auto-tour-trigger__label">{{ floatingAutoTourPauseButton.label }}</text>
        </view>
      </button>
      <view v-if="signboardOverlayEntries.length" class="viewer-signboard-layer" aria-hidden="true">
        <view
          v-for="entry in signboardOverlayEntries"
          :key="entry.id"
          class="viewer-signboard"
          :class="{ 'viewer-signboard--vehicle': entry.referenceKind === 'vehicle' }"
          :style="{
            left: `${entry.xPercent}%`,
            top: `${entry.yPercent}%`,
            transform: `translate(-50%, -100%) scale(${entry.scale})`,
            opacity: String(entry.opacity),
          }"
        >
          <view class="viewer-signboard__pill">
            <text class="viewer-signboard__name">{{ entry.label }}</text>
            <text class="viewer-signboard__distance">{{ entry.distanceLabel }}</text>
            <view v-if="entry.showPunchBadge" class="viewer-signboard__punch-badge" aria-hidden="true">
              <text class="viewer-signboard__punch-badge-icon">✓</text>
            </view>
          </view>
        </view>
      </view>
      <view v-if="punchBadgeOverlayEntries.length" class="viewer-punch-badge-layer" aria-hidden="true">
        <view
          v-for="entry in punchBadgeOverlayEntries"
          :key="entry.id"
          class="viewer-punch-badge"
          :class="{ 'viewer-punch-badge--vehicle': entry.referenceKind === 'vehicle' }"
          :style="{
            left: `${entry.xPercent}%`,
            top: `${entry.yPercent}%`,
            transform: `translate(-50%, -100%) scale(${entry.scale})`,
            opacity: String(entry.opacity),
          }"
        >
          <text class="viewer-punch-badge__icon">✓</text>
        </view>
      </view>
      <view v-if="behaviorBubbleVisible" class="viewer-bubble-layer" aria-live="polite">
        <view
          class="viewer-bubble"
          :class="[
            { 'viewer-bubble--node-anchored': behaviorBubbleAnchorMode === 'nodeAnchored' },
            `viewer-bubble--variant-${behaviorBubbleVariant}`,
            `viewer-bubble--anim-${behaviorBubbleAnimation}`,
          ]"
          :style="behaviorBubbleStyle"
        >
          <text class="viewer-bubble__message">{{ behaviorBubbleMessage }}</text>
        </view>
      </view>
      <view
        v-if="infoBoardOverlayVisible"
        class="viewer-info-board-overlay"
        aria-live="polite"
        :style="{
          left: `${infoBoardOverlayPlacement.xPercent}%`,
          top: `${infoBoardOverlayPlacement.yPercent}%`,
          transform: `translate(-50%, -100%) scale(${infoBoardOverlayPlacement.scale})`,
          opacity: String(infoBoardOverlayPlacement.opacity),
        }"
      >
        <view class="viewer-info-board" :style="infoBoardPanelStyle">
          <view class="viewer-info-board__header">
            <text class="viewer-info-board__title">展示板</text>
            <button class="viewer-info-board__close" type="button" hover-class="none" @tap="hideInfoBoard">
              <text class="viewer-info-board__close-icon">✕</text>
            </button>
          </view>
          <scroll-view scroll-y class="viewer-info-board__body">
            <text v-if="infoBoardOverlayLoading" class="viewer-info-board__loading">正在加载内容…</text>
            <text v-else class="viewer-info-board__content">{{ infoBoardOverlayContent || '暂无内容' }}</text>
          </scroll-view>
        </view>
      </view>
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
            <text class="viewer-lantern-close-icon">{{ lanternCloseIcon }}</text>
          </button>
          <LanternImageFrame
            ref="lanternViewerRoot"
            :image-url="lanternCurrentSlideImage"
            :box-style="lanternImageBoxStyle"
            :viewer-options="lanternViewerOptions"
            @load="handleLanternImageLoad"
            @tap="openLanternImageFullscreen"
          />
          <view class="viewer-lantern-body">
            <text class="viewer-lantern-title">{{ lanternCurrentTitle }}</text>
            <view
              class="viewer-drive-cluster viewer-drive-cluster--joystick">
              <view class="viewer-drive-joystick-layout">
                <view
                  ref="lanternJoystickRef"
                  class="viewer-drive-joystick"
                  :class="{ 'is-active': vehicleDriveUi.joystickActive }"
                  role="slider"
                  aria-label="驾驶摇杆"
                  aria-valuemin="-100"
                  aria-valuemax="100"
                  :aria-valuenow="Math.round(vehicleDriveInput.throttle * 100)"
                  @touchstart.stop.prevent="handleJoystickTouchStart"
                  @touchmove.stop.prevent="handleJoystickTouchMove"
                  @touchend.stop.prevent="handleJoystickTouchEnd"
                  @touchcancel.stop.prevent="handleJoystickTouchEnd"
                >
                  <DriveJoystick
                    :is-active="vehicleDriveUi.joystickActive"
                    :knob-style="joystickKnobStyle"
                  />
                </view>
                <view class="viewer-drive-hud" aria-hidden="true">
                  <SpeedReadout :speed="vehicleSpeedKmh" />
                  <DriveCompass
                    :compass-style="vehicleCompassStyle"
                    :ticks="vehicleCompassTicks"
                    :labels="vehicleCompassLabels"
                  />
                </view>
              </view>
            </view>
            <view class="viewer-progress__stats">
              <text class="viewer-progress__percent">{{ overlayPercent }}%</text>
              <text v-if="overlayBytesLabel" class="viewer-progress__bytes">{{ overlayBytesLabel }}</text>
            </view>
          </view>
        </view>
      </view>
      <view v-if="overlayActive" class="viewer-overlay">
        <view
          v-if="sceneSwitchOverlayVisible"
          class="viewer-overlay__flash"
          :class="{ 'is-active': sceneSwitchFlashActive }"
        ></view>
        <view v-if="overlayCardActive" class="viewer-overlay__backdrop" aria-hidden="true">
          <view class="viewer-overlay__aurora viewer-overlay__aurora--cyan"></view>
          <view class="viewer-overlay__aurora viewer-overlay__aurora--amber"></view>
          <view class="viewer-overlay__grid"></view>
          <view class="viewer-overlay__scanline"></view>
        </view>
        <view v-if="overlayCardActive" class="viewer-overlay__content viewer-overlay__card">
          <view class="viewer-loader" aria-hidden="true">
            <view class="viewer-loader__halo viewer-loader__halo--outer"></view>
            <view class="viewer-loader__halo viewer-loader__halo--mid"></view>
            <view class="viewer-loader__ring viewer-loader__ring--a"></view>
            <view class="viewer-loader__ring viewer-loader__ring--b"></view>
            <view class="viewer-loader__ring viewer-loader__ring--c"></view>
            <view class="viewer-loader__core">
              <view class="viewer-loader__core-pulse"></view>
              <view class="viewer-loader__core-dot"></view>
            </view>
            <view class="viewer-loader__particle viewer-loader__particle--1"></view>
            <view class="viewer-loader__particle viewer-loader__particle--2"></view>
            <view class="viewer-loader__particle viewer-loader__particle--3"></view>
            <view class="viewer-loader__particle viewer-loader__particle--4"></view>
          </view>
          <text v-if="overlayTitle" class="viewer-overlay__title">{{ overlayTitle }}</text>
          <view class="viewer-progress">
            <view
              class="viewer-progress__bar"
              :class="{ 'is-indeterminate': overlayIndeterminate }"
            >
              <view
                class="viewer-progress__bar-fill"
                :class="{ 'is-indeterminate': overlayIndeterminate }"
                :style="overlayProgressStyle"
              />
              <view v-if="overlayIndeterminate" class="viewer-progress__bar-glow" />
            </view>
            <view class="viewer-progress__stats">
              <text class="viewer-progress__percent">{{ overlayPercentText }}</text>
              <text v-if="overlayBytesLabel" class="viewer-progress__bytes">{{ overlayBytesLabel }}</text>
            </view>
          </view>
          <text v-if="overlayCaption" class="viewer-overlay__caption">{{ overlayCaption }}</text>
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
              <text class="viewer-purpose-chip__icon">{{ purposeWatchIcon }}</text>
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
              <text class="viewer-purpose-chip__icon">{{ purposeResetIcon }}</text>
            </view>
            <view class="viewer-purpose-chip__texts">
              <text class="viewer-purpose-chip__title">平视</text>
              <text class="viewer-purpose-chip__subtitle">回到人眼高度</text>
            </view>
          </view>
        </button>
      </view>
      <view
        v-if="vehicleDriveUi.visible"
        class="viewer-drive-console viewer-drive-console--mobile"
      >
        <view
          v-show="drivePadState.visible"
          class="viewer-drive-cluster viewer-drive-cluster--joystick viewer-drive-cluster--floating"
          :class="{ 'is-fading': drivePadState.fading }"
          :style="drivePadStyle"
        >
          <view
            ref="floatingJoystickRef"
            class="viewer-drive-joystick"
            :class="{ 'is-active': vehicleDriveUi.joystickActive }"
            role="slider"
            aria-label="驾驶摇杆"
            aria-valuemin="-100"
            aria-valuemax="100"
            :aria-valuenow="Math.round(vehicleDriveInput.throttle * 100)"
            @touchstart.stop.prevent="handleJoystickTouchStart"
            @touchmove.stop.prevent="handleJoystickTouchMove"
            @touchend.stop.prevent="handleJoystickTouchEnd"
            @touchcancel.stop.prevent="handleJoystickTouchEnd"
          >
            <DriveJoystick
              :is-active="vehicleDriveUi.joystickActive"
              :knob-style="joystickKnobStyle"
            />
          </view>
        </view>
      </view>
      <view v-if="vehicleDriveUi.visible" class="viewer-drive-speed-left-floating">
        <SpeedReadout :speed="vehicleSpeedKmh" :aria-hidden="true" />
        <button
          class="viewer-drive-icon-button"
          :class="{ 'is-busy': vehicleDriveResetBusy }"
          type="button"
          hover-class="none"
          :disabled="vehicleDriveResetBusy"
          aria-label="重置车辆"
          @tap="handleVehicleDriveResetTap"
        >
          <view class="viewer-drive-icon" aria-hidden="true">
            <text class="viewer-drive-icon-text">🔄</text>
          </view>
        </button>
      </view>

      <view v-if="vehicleDriveUi.visible" class="viewer-drive-compass-right-floating" aria-hidden="true">
        <DriveCompass
          :compass-style="vehicleCompassStyle"
          :ticks="vehicleCompassTicks"
          :labels="vehicleCompassLabels"
        />
      </view>

      <view
        v-if="debugOverlayVisible && debugMode !== 'off'"
        class="viewer-debug-overlay viewer-debug-overlay--interactive"
        :aria-label="debugOverlayAriaLabel"
        @tap.stop="handleDebugOverlayTap"
      >
        <text class="viewer-debug-line">FPS: {{ debugFps }}</text>
        <template v-if="debugMode === 'full'">
          <text class="viewer-debug-line">Renderer: {{ rendererDebug.width }}x{{ rendererDebug.height }} @PR {{ rendererDebug.pixelRatio }}, calls {{ rendererDebug.calls }}, tris {{ rendererDebug.triangles }}, r-tris {{ rendererDebug.renderTriangles }}</text>
          <text class="viewer-debug-line">Instancing: mesh {{ instancingDebug.instancedMeshActive }}/{{ instancingDebug.instancedMeshAssets }}, instances {{ instancingDebug.instancedInstanceCount }}, lod {{ instancingDebug.lodVisible }}/{{ instancingDebug.lodTotal }}, scatter {{ instancingDebug.scatterVisible }}/{{ instancingDebug.scatterTotal }}</text>
          <text class="viewer-debug-line">Ground: loaded {{ groundChunkDebug.loaded }}/{{ groundChunkDebug.target }}/{{ groundChunkDebug.total }}</text>
        </template>
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
import { effectScope, watchEffect, ref, computed, onMounted, onUnmounted, watch, reactive, nextTick, getCurrentInstance, type EffectScope, type ComponentPublicInstance } from 'vue';
// #ifdef MP-WEIXIN
import '@minisheep/three-platform-adapter/wechat';
// #endif
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';
import PlatformCanvas from './PlatformCanvas.vue';
import LanternImageFrame from './LanternImageFrame.vue';
import DriveJoystick from './DriveJoystick.vue';
import DriveCompass from './DriveCompass.vue';
import SpeedReadout from './SpeedReadout.vue';
import { useProjectStore } from '../common/stores/projectStore';
import { useDebugOverlay } from '../composables/useDebugOverlay';
import { useBehaviorAlert } from '../composables/useBehaviorAlert';
import { useBehaviorBubble } from '../composables/useBehaviorBubble';
import { useLanternAssets } from '../composables/useLanternAssets';
import {
  loadScenePackageZip,
  removeScenePackageZip,
  resolveScenePackageZipPointerByCacheKey,
  saveScenePackageZipByCacheKey,
  type ScenePackagePointer,
} from '@harmony/utils/scene-package-storage';

type SceneryProps = {
  projectId?: string;
  packageUrl?: string;
  packageCacheKey?: string;
  nominateStateMap?: NominateExternalStateMap;
  defaultSteerIdentifier?: string;
  physicsInterpolation?: boolean;
  serverAssetBaseUrl?: string;
  initialPunchedNodeIds?: string[];
};

const props = defineProps<SceneryProps>();
const emit = defineEmits<{
  loaded: [];
  error: [message: string];
  progress: [payload: {
    bytesLabel: string;
    loaded: number;
    total: number;
  }];
  punch: [payload: {
    eventName: 'punch';
    sceneId: string;
    sceneName: string;
    clientPunchTime: string;
    behaviorPunchTime: string;
    location: {
      nodeId: string;
      nodeName: string;
    };
  }];
}>();
import {
  buildSceneGraph,
  createTerrainScatterLodRuntime,
  type SceneGraphBuildOptions,
} from '@harmony/schema/sceneGraph';
import { createInstancedBvhFrustumCuller } from '@harmony/schema/instancedBvhFrustumCuller';
import ResourceCache from '@harmony/schema/ResourceCache';
import { AssetCache, AssetLoader, configureAssetDownloadHostMirrors, type AssetCacheEntry } from '@harmony/schema/assetCache';
import { ASSET_DOWNLOAD_HOST_MIRRORS } from '@harmony/schema/assetDownloadMirrors';
import { isGroundDynamicMesh } from '@harmony/schema/groundHeightfield';
import {
  areAllGroundChunksLoaded,
  ensureAllGroundChunks,
  isGroundChunkStreamingEnabled,
  updateGroundChunks,
} from '@harmony/schema/groundMesh';
import { buildGroundAirWallDefinitions } from '@harmony/schema/airWall';

import {
  ensurePhysicsWorld as ensureSharedPhysicsWorld,
  createRigidbodyBody as createSharedRigidbodyBody,
  syncBodyFromObject as syncSharedBodyFromObject,
  syncObjectFromBody as syncSharedObjectFromBody,
  removeRigidbodyInstanceBodies,
  ensureRoadHeightfieldRigidbodyInstance,
  isRoadDynamicMesh,
  COLLISION_GROUP_STATIC_ENV,
  COLLISION_MASK_STATIC_ENV,
  type GroundHeightfieldCacheEntry,
  type FloorShapeCacheEntry,
  type WallTrimeshCacheEntry,
  type PhysicsContactSettings,
  type RigidbodyInstance,
  type RigidbodyMaterialEntry,
  type RigidbodyOrientationAdjustment,
} from '@harmony/schema/physicsEngine';
import { loadNodeObject } from '@harmony/schema/modelAssetLoader';

import { inferAssetTypeOrNull, inferMimeTypeFromAssetId } from '@harmony/schema/assetTypeConversion'
import {
  getCachedModelObject,
  getOrLoadModelObject,
  subscribeInstancedMeshes,
  ensureInstancedMeshesRegistered,
  allocateModelInstance,
  allocateModelInstanceBinding,
  getModelInstanceBindingsForNode,
  getModelInstanceBinding,
  releaseModelInstance,
  updateModelInstanceBindingMatrix,
  updateModelInstanceMatrix,
  findNodeIdForInstance,
  type ModelInstanceGroup,
} from '@harmony/schema/modelObjectCache';
import {
  allocateBillboardInstance,
  allocateBillboardInstanceBinding,
  getBillboardInstanceBindingsForNode,
  releaseBillboardInstance,
  subscribeBillboardInstancedMeshes,
  updateBillboardInstanceBindingMatrix,
  updateBillboardInstanceCameraWorldPosition,
  updateBillboardInstanceMatrix,
} from '@harmony/schema/instancedBillboardCache';
import { addMesh as addInstancedBoundsMesh, flush as flushInstancedBounds, tick as tickInstancedBounds, clear as clearInstancedBounds, hasPending as instancedBoundsHasPending } from '@harmony/schema/instancedBoundsTracker';
import { syncContinuousInstancedModelCommitted } from '@harmony/schema/continuousInstancedModel';
import { hasWallInstancedBindings, syncWallInstancedBindingsForObject } from '@harmony/schema/wallInstancing';
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_ENVIRONMENT_NORTH_DIRECTION,
  DEFAULT_ENVIRONMENT_GRAVITY,
  DEFAULT_ENVIRONMENT_RESTITUTION,
  DEFAULT_ENVIRONMENT_FRICTION,
  cloneEnvironmentSettings,
  resolveAdaptiveLinearFogRange,
  resolveDocumentEnvironment,
  type EnvironmentNorthDirection,
  type EnvironmentSettings,
  type EnvironmentCsmSettings,
} from '@harmony/schema/environmentSettingsUtils';
import { deserializeGroundPaintSidecar } from '@harmony/schema/groundPaintSidecar';
import { deserializeGroundScatterSidecar } from '@harmony/schema/groundScatterSidecar';
import {
  clampSceneNodeInstanceLayout,
  computeInstanceLayoutLocalBoundingBox,
  forEachInstanceWorldMatrix,
  getInstanceLayoutBindingId,
  getInstanceLayoutCount,
  resolveInstanceLayoutTemplateAssetId,
} from '@harmony/schema/instanceLayout';
import { createAutoTourRuntime } from '@harmony/schema/autoTourRuntime';
import { createWaterRuntime } from '@harmony/schema/waterRuntime';
import { createScenePreviewPerfController } from '@harmony/schema/scenePreviewPerf';
import { rebuildSceneNodeIndex, resolveSceneNodeById, resolveSceneParentNodeId } from '@harmony/schema/nodeIndexUtils';
import { resolveEnabledComponentState } from '@harmony/schema/componentRuntimeUtils';
import { createGradientBackgroundDome, disposeGradientBackgroundDome, type GradientBackgroundDome } from '@harmony/schema/gradientBackground';
import { disposeSkyCubeTexture, loadSkyCubeTexture, extractSkycubeZipFaces } from '@harmony/schema/skyCubeTexture';
// LanternSlideDefinition is not exported from skyCubeTexture, so remove it from import and use 'any' or define locally if needed
import {
  decodeScenePackageSceneDocument,
} from '@harmony/schema/scenePackageSceneCodec';
import {
  unzipScenePackage,
  buildAssetOverridesFromScenePackage,
  readBinaryFileFromScenePackage,
  readTextFileFromScenePackage,
  type ScenePackageUnzipped,
} from '@harmony/schema/scenePackageZip';
import type {
  AutoTourRouteSnapResult,
  GroundTerrainPackageManifest,
  SceneNode,
  SceneNodeComponentState,
  SceneJsonExportDocument,
  SceneAssetRegistryEntry,
  SceneMaterialTextureRef,
  GroundDynamicMesh,
  GroundRuntimeDynamicMesh,
  LanternSlideDefinition,
  SceneResourceSummary,
  SceneResourceSummaryEntry,
  Vector3Like,
} from '@harmony/schema/index';
import {
  GROUND_TERRAIN_PACKAGE_FORMAT,
  GROUND_TERRAIN_PACKAGE_VERSION,
} from '@harmony/schema/index';
import { isPointInsideRegionXZ } from '@harmony/schema/index';
import { applyMirroredScaleToObject, syncMirroredMeshMaterials } from '@harmony/schema/mirror';
import {
  createSceneCsmShadowRuntime,
  DEFAULT_SCENE_CSM_CONFIG,
  DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
  DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
  resolveSceneCsmSunPositionFromAngles,
  type SceneCsmConfig,
  type SceneCsmShadowRuntime,
} from '@harmony/schema/sceneCsm';
import { ComponentManager } from '@harmony/schema/components/componentManager';
import { setActiveMultiuserSceneId } from '@harmony/schema/multiuserContext';
import {
  type WarpGateComponentProps,
} from '@harmony/schema/components/definitions/warpGateComponent';

type RigidbodyComponentProps = any;
type RigidbodyComponentMetadata = any;
type RigidbodyPhysicsShape = any;
import {
  behaviorComponentDefinition,
} from '@harmony/schema/components/definitions/behaviorComponent';
import {
  billboardComponentDefinition,
} from '@harmony/schema/components/definitions/billboardComponent';
import {
  guideboardComponentDefinition,
  GUIDEBOARD_RUNTIME_REGISTRY_KEY,
  GUIDEBOARD_EFFECT_ACTIVE_FLAG,
  GUIDEBOARD_COMPONENT_TYPE,
  clampGuideboardComponentProps,
  computeGuideboardEffectActive,
  type GuideboardComponentProps,
} from '@harmony/schema/components/definitions/guideboardComponent';
import {
  displayBoardComponentDefinition,
} from '@harmony/schema/components/definitions/displayBoardComponent';
import {
  floorComponentDefinition,
} from '@harmony/schema/components/definitions/floorComponent';
import {
  wallComponentDefinition,
  WALL_COMPONENT_TYPE,
} from '@harmony/schema/components/definitions/wallComponent';
import {
  boundaryWallComponentDefinition,
  BOUNDARY_WALL_COMPONENT_TYPE,
} from '@harmony/schema/components/definitions/boundaryWallComponent';
import {
  roadComponentDefinition,
} from '@harmony/schema/components/definitions/roadComponent';
import {
  landformComponentDefinition,
} from '@harmony/schema/components/definitions/landformComponent';
import {
  viewPointComponentDefinition,
} from '@harmony/schema/components/definitions/viewPointComponent';
import {
  warpGateComponentDefinition,
  WARP_GATE_RUNTIME_REGISTRY_KEY,
  WARP_GATE_EFFECT_ACTIVE_FLAG,
} from '@harmony/schema/components/definitions/warpGateComponent';
import {
  effectComponentDefinition,
} from '@harmony/schema/components/definitions/effectComponent';
import {
  rigidbodyComponentDefinition,
  clampRigidbodyComponentProps,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
} from '@harmony/schema/components/definitions/rigidbodyComponent';
import {
  resolveModelCollisionComponentPropsFromNode,
} from '@harmony/schema/components/definitions/modelCollisionComponent';
import {
  vehicleComponentDefinition,
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  DEFAULT_DIRECTION,
  DEFAULT_AXLE,
  type VehicleComponentProps,
  type VehicleWheelProps,
} from '@harmony/schema/components/definitions/vehicleComponent';
import {
  waterComponentDefinition,
} from '@harmony/schema/components/definitions/waterComponent';
import {
  protagonistComponentDefinition,
} from '@harmony/schema/components/definitions/protagonistComponent';
import {
  signboardComponentDefinition,
  SIGNBOARD_COMPONENT_TYPE,
  type SignboardComponentProps,
} from '@harmony/schema/components/definitions/signboardComponent';
import {
  lodComponentDefinition,
  LOD_COMPONENT_TYPE,
  clampLodComponentProps,
  type LodComponentProps,
} from '@harmony/schema/components/definitions/lodComponent';
import {
  onlineComponentDefinition,
  ONLINE_COMPONENT_TYPE,
} from '@harmony/schema/components/definitions/onlineComponent';
import {
  guideRouteComponentDefinition,
} from '@harmony/schema/components/definitions/guideRouteComponent';
import {
  autoTourComponentDefinition,
  AUTO_TOUR_COMPONENT_TYPE,
  type AutoTourComponentProps,
} from '@harmony/schema/components/definitions/autoTourComponent';
import {
  purePursuitComponentDefinition,
} from '@harmony/schema/components/definitions/purePursuitComponent';
import {
  sceneStateAnchorComponentDefinition,
  SCENE_STATE_ANCHOR_COMPONENT_TYPE,
} from '@harmony/schema/components/definitions/sceneStateAnchorComponent';
import {
  nominateComponentDefinition,
  applyNominateStateMapToRuntime,
  type NominateExternalStateMap,
} from '@harmony/schema/components/definitions/nominateComponent';
import {
  steerComponentDefinition,
  buildSteerResolvedEntryMap,
  findDefaultSteerResolvedEntry,
} from '@harmony/schema/components/definitions/steerComponent';
import {
  preloadableComponentDefinition,
} from '@harmony/schema/components/definitions/preloadableComponent';
import {
  VehicleDriveController,
  type VehicleDriveCameraFollowState,
  type VehicleDriveCameraMode,
  type VehicleDriveCameraRestoreState,
  type VehicleDriveControlFlags,
  type VehicleDriveInputState,
  type VehicleDriveOrbitMode,
  type VehicleInstance,
} from '@harmony/schema/VehicleDriveController';
import {
  FollowCameraController,
  type CameraFollowState,
  computeFollowLerpAlpha,
  computeFollowPlacement,
  createCameraFollowState,
  getApproxDimensions,
  resetCameraFollowState,
} from '@harmony/schema/followCameraController';
import {
  createPhysicsAwareAutoTourVehicleInstances,
  resolveVehicleOrObjectWorldPosition,
  stopTourAndUnfollow,
} from '@harmony/schema/autoTourHelpers';
import { syncAutoTourActiveNodesFromRuntime, resolveAutoTourFollowNodeId } from '@harmony/schema/autoTourSync';
import { holdVehicleBrakeSafe } from '@harmony/schema/purePursuitRuntime';
import {
  SIGNBOARD_CLOSE_FADE_DISTANCE,
  SIGNBOARD_MIN_SCREEN_Y_PERCENT,
  createSignboardPlacementSmoothingState,
  createSignboardReferenceSmoothingState,
  DEFAULT_SIGNBOARD_PLACEMENT_SMOOTH_SPEED,
  DEFAULT_SIGNBOARD_REFERENCE_SMOOTH_SPEED,
  computeSignboardPlacement,
  resetSignboardReferenceSmoothingState,
  resolveSignboardAnchorWorldPosition,
  resolveSignboardDisplayLabel,
  smoothSignboardPlacement,
  smoothSignboardReference,
  type SignboardPlacementSmoothingState,
} from '@harmony/schema/signboardOverlay';
import { runWithProgrammaticCameraMutation, isProgrammaticCameraMutationActive } from '@harmony/schema/cameraGuard';
import {
  addBehaviorRuntimeListener,
  getBehaviorNodeVisible,
  hasRegisteredBehaviors,
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
} from '@harmony/schema/behaviors/runtime';
import {
  loadStoredPunchedNodeIds,
  mergeStoredPunchedNodeId,
  pruneStoredPunchedNodeIds,
} from '@harmony/schema/browserPunchProgress';
import {
  applyMaterialOverrides,
  disposeMaterialTextures,
  type MaterialTextureAssignmentOptions,
} from '@harmony/schema/material';

type ResolvedAssetUrl = { url: string; mimeType?: string | null; dispose?: () => void }

interface ScenePreviewPayload {
  document: SceneJsonExportDocument;
  title: string;
  origin?: string;
  createdAt?: string;
  updatedAt?: string;
  assetOverrides?: SceneGraphBuildOptions['assetOverrides'];
  terrain?: SceneTerrainPackageBundle | null;
}

type SceneTerrainPackageBundle = {
  manifestPath: string;
  manifest: GroundTerrainPackageManifest;
};

type RequestedMode = 'project' | null;


declare namespace UniApp {
  interface OnProgressUpdateResult {
    totalBytesWritten?: number;
    totalBytesExpectedToWrite?: number;
  }
  interface RequestTask {
    abort: () => void;
    onProgressUpdate?: (callback: (res: OnProgressUpdateResult) => void) => void;
  }
  interface NodeInfo {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  }
}

interface SceneDownloadProgress extends UniApp.OnProgressUpdateResult {
  progress?: number;
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

const SCENE_DOWNLOAD_TIMEOUT = 120000;

const projectStore = useProjectStore();
const canvasId = `scene-viewer-${Date.now()}`;
const currentSceneId = ref<string | null>(null);
const currentProjectId = ref<string | null>(null);
const requestedMode = ref<RequestedMode>(null);

type SceneStackVec3Tuple = [number, number, number];
type SceneStackQuatTuple = [number, number, number, number];

type SceneNodeTransformSnapshot = {
  position: SceneStackVec3Tuple;
  quaternion: SceneStackQuatTuple;
  scale: SceneStackVec3Tuple;
};

type SceneViewControlSnapshot = {
  cameraViewState: { mode: CameraViewMode; targetNodeId: string | null };
  isCameraCaged: boolean;
  purposeMode: 'watch' | 'level';
  camera: { position: SceneStackVec3Tuple; quaternion: SceneStackQuatTuple; up: SceneStackVec3Tuple };
  orbitTarget: SceneStackVec3Tuple;
  nodeTransforms: Record<string, SceneNodeTransformSnapshot>;
};

const sceneStateById = new Map<string, SceneViewControlSnapshot>();
const previousSceneById = new Map<string, string>();

type ScenePackageProject = {
  id: string;
  name: string;
  defaultSceneId: string | null;
  lastEditedSceneId: string | null;
  sceneOrder: string[];
};

type ScenePackageSceneEntry =
  | {
      kind: 'embedded';
      id: string;
      name: string;
      createdAt: string | null;
      updatedAt: string | null;
      document: SceneJsonExportDocument;
      terrain?: SceneTerrainPackageBundle | null;
    }
  | {
      kind: 'external';
      id: string;
      name: string;
      createdAt: string | null;
      updatedAt: string | null;
      sceneJsonUrl: string;
      terrain?: SceneTerrainPackageBundle | null;
    };

type ScenePackageProjectData = {
  project: ScenePackageProject;
  scenes: ScenePackageSceneEntry[];
};

const projectBundle = ref<ScenePackageProjectData | null>(null);
const projectSceneIndex = new Map<string, ScenePackageSceneEntry>();

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
  phase: 'download' as 'download' | 'parse',
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
import {
  computePlaySoundDistanceGain,
  resolvePlaySoundSourcePoint,
  createIndexedDbPersistentAssetStorage,
  createNoopPersistentAssetStorage,
  createWeChatFileSystemPersistentAssetStorage,
  isIndexedDbPersistentAssetStorageSupported,
  isWeChatFileSystemPersistentAssetStorageSupported,
} from '@harmony/schema';

// Configure multi-source mirrors for asset downloads (优先切源).
// Note: asset identifiers / cache keys remain the original URLs/assetIds.
configureAssetDownloadHostMirrors(ASSET_DOWNLOAD_HOST_MIRRORS);
const globalApp = globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } };
const isWeChatMiniProgram = Boolean(globalApp.wx && typeof globalApp.wx.getSystemInfoSync === 'function');
const scenePersistentStorage = isWeChatMiniProgram && isWeChatFileSystemPersistentAssetStorageSupported()
  ? createWeChatFileSystemPersistentAssetStorage()
  : isIndexedDbPersistentAssetStorageSupported()
    ? createIndexedDbPersistentAssetStorage()
    : createNoopPersistentAssetStorage();
const sceneAssetCache = new AssetCache({ persistentStorage: scenePersistentStorage });
const sceneAssetLoader = new AssetLoader(sceneAssetCache);
let sharedResourceCache: ResourceCache | null = null;
let viewerResourceCache: ResourceCache | null = null;
let activeScenePackageAssetOverrides: SceneGraphBuildOptions['assetOverrides'] | null = null;
let activeScenePackagePkg: ScenePackageUnzipped | null = null;
let sceneDownloadTask: SceneRequestTask | null = null;
const DEFAULT_RGBE_DATA_TYPE = isWeChatMiniProgram ? THREE.UnsignedByteType : THREE.FloatType;
type RGBELoaderClass = new (manager?: THREE.LoadingManager) => RGBELoader;
let rgbeLoaderClassPromise: Promise<RGBELoaderClass> | null = null;

async function createRgbELoader(manager?: THREE.LoadingManager): Promise<RGBELoader> {
  if (!rgbeLoaderClassPromise) {
    rgbeLoaderClassPromise = import('three/examples/jsm/loaders/RGBELoader.js').then(
      (module) => module.RGBELoader as RGBELoaderClass,
    );
  }
  const LoaderClass = await rgbeLoaderClassPromise;
  return new LoaderClass(manager).setDataType(DEFAULT_RGBE_DATA_TYPE);
}

function getGroundVertexCount(rows: number, columns: number): number {
  return (Math.max(1, Math.trunc(rows)) + 1) * (Math.max(1, Math.trunc(columns)) + 1);
}

// Debug switch: when disabled, do not render the overlay and do not compute debug stats.
// Enable temporarily via query param `?debug=1`.
// debugMode: 'off' = hide overlay; 'fps' = show only FPS; 'full' = show compact summary
const {
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
} = useDebugOverlay();

const debugOverlayAriaLabel = computed(() => (debugMode.value === 'full' ? '调试信息，当前 full 模式，点击切换为 fps 模式' : '调试信息，当前 fps 模式，点击切换为 full 模式'));

type InstancedTransformCacheEntry = {
  assetId: string | null;
  visible: boolean;
  elements: number[];
};

const instancedTransformCache = new Map<string, InstancedTransformCacheEntry>();

function clearInstancedTransformCacheForNode(nodeId: string): void {
  instancedTransformCache.delete(nodeId);
  const prefix = `${nodeId}:instance:`;
  for (const key of instancedTransformCache.keys()) {
    if (key.startsWith(prefix)) {
      instancedTransformCache.delete(key);
    }
  }
}

function matricesAlmostEqual(a: ArrayLike<number>, b: ArrayLike<number>, epsilon = 1e-6): boolean {
  for (let i = 0; i < 16; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (Math.abs(av - bv) > epsilon) {
      return false;
    }
  }
  return true;
}

function handleDebugOverlayTap(): void {
  debugMode.value = debugMode.value === 'full' ? 'fps' : 'full';
}

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

const overlayCardActive = computed(() => loading.value || sceneDownload.active || resourcePreload.active);

const overlayActive = computed(() => overlayCardActive.value || sceneSwitchOverlayVisible.value);

// ---------------------------------
// Scene switch transition (flash UI)
// ---------------------------------

const sceneSwitching = ref(false);
const sceneSwitchOverlayVisible = ref(false);
const sceneSwitchFlashActive = ref(false);
let hasRenderedSceneOnce = false;

let initializeToken = 0;
let pendingRestartAfterCurrentInit = false;

let sceneSwitchShowTimer: ReturnType<typeof setTimeout> | null = null;
let sceneSwitchHideTimer: ReturnType<typeof setTimeout> | null = null;
let sceneSwitchMinVisibleUntil = 0;

const SCENE_SWITCH_OVERLAY_DELAY_MS = 110;
const SCENE_SWITCH_OVERLAY_MIN_VISIBLE_MS = 160;
const SCENE_SWITCH_OVERLAY_FADE_OUT_MS = 180;

function cancelSceneSwitchTimers(): void {
  if (sceneSwitchShowTimer) {
    clearTimeout(sceneSwitchShowTimer);
    sceneSwitchShowTimer = null;
  }
  if (sceneSwitchHideTimer) {
    clearTimeout(sceneSwitchHideTimer);
    sceneSwitchHideTimer = null;
  }
}

function beginSceneSwitchTransition(token: number): void {
  if (!hasRenderedSceneOnce) {
    return;
  }

  cancelSceneSwitchTimers();
  sceneSwitching.value = true;
  sceneSwitchFlashActive.value = false;
  sceneSwitchOverlayVisible.value = false;

  sceneSwitchShowTimer = setTimeout(() => {
    if (token !== initializeToken) {
      return;
    }

    sceneSwitchOverlayVisible.value = true;
    sceneSwitchMinVisibleUntil = Date.now() + SCENE_SWITCH_OVERLAY_MIN_VISIBLE_MS;

    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: () => void) => setTimeout(callback, 16);
    schedule(() => {
      if (token !== initializeToken) {
        return;
      }
      sceneSwitchFlashActive.value = true;

      sceneSwitchHideTimer = setTimeout(() => {
        if (token !== initializeToken) {
          return;
        }
        sceneSwitchOverlayVisible.value = false;
        sceneSwitching.value = false;

        setTimeout(() => {
          if (token !== initializeToken) {
            return;
          }
          sceneSwitchFlashActive.value = false;
        }, SCENE_SWITCH_OVERLAY_FADE_OUT_MS);
      }, SCENE_SWITCH_OVERLAY_MIN_VISIBLE_MS);
    });
  }, SCENE_SWITCH_OVERLAY_DELAY_MS);
}

function endSceneSwitchTransition(token: number): void {
  if (!hasRenderedSceneOnce) {
    return;
  }
  if (token !== initializeToken) {
    return;
  }

  cancelSceneSwitchTimers();

  // If overlay was never shown, just reset flags.
  if (!sceneSwitchOverlayVisible.value) {
    sceneSwitching.value = false;
    sceneSwitchFlashActive.value = false;
    return;
  }

  const delay = Math.max(0, sceneSwitchMinVisibleUntil - Date.now());
  sceneSwitchHideTimer = setTimeout(() => {
    if (token !== initializeToken) {
      return;
    }
    sceneSwitchOverlayVisible.value = false;
    sceneSwitching.value = false;

    setTimeout(() => {
      if (token !== initializeToken) {
        return;
      }
      sceneSwitchFlashActive.value = false;
    }, SCENE_SWITCH_OVERLAY_FADE_OUT_MS);
  }, delay);
}

const overlayTitle = computed(() => {
  if (sceneDownload.active) {
    return sceneDownload.phase === 'parse' ? '正在解析场景包' : '正在下载场景包';
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
  if (overlayIndeterminate.value) {
    return 0;
  }
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
    const hasPreloadHistory = resourcePreload.total > 0 || resourcePreload.totalBytes > 0;
    return hasPreloadHistory ? resourcePreloadPercent.value : 0;
  }
  return resourcePreloadPercent.value;
});

const overlayBytesLabel = computed(() => {
  if (overlayIndeterminate.value) {
    return '';
  }
  if (sceneDownload.active && sceneDownload.total > 0) {
    return `${formatByteSize(sceneDownload.loaded)} / ${formatByteSize(sceneDownload.total)}`;
  }
  if (resourcePreload.active && resourcePreloadBytesLabel.value) {
    return resourcePreloadBytesLabel.value;
  }
  return '';
});

const overlayIndeterminate = computed(() => sceneDownload.active && sceneDownload.phase === 'parse');

const overlayPercentText = computed(() => (overlayIndeterminate.value ? '解析中…' : `${overlayPercent.value}%`));

const overlayProgressStyle = computed(() => {
  if (overlayIndeterminate.value) {
    return {};
  }
  return { width: `${overlayPercent.value}%` };
});

const overlayCaption = computed(() => {
  if (sceneDownload.active) {
    return sceneDownload.label;
  }
  if (resourcePreload.active) {
    return resourcePreload.label;
  }
  if (loading.value) {
    return '正在准备渲染上下文…';
  }
  return '';
});

const SKY_ENVIRONMENT_INTENSITY = 0.6;
const HUMAN_EYE_HEIGHT = 1.7;
const CAMERA_FORWARD_OFFSET = 1.5;
const DEFAULT_SCENE_CAMERA_FAR = 1000;
const CAMERA_WATCH_DURATION = 0.35;
const CAMERA_LEVEL_DURATION = 0.35;
const DEFAULT_SCENE_EXPOSURE = 0.7;


const SCENE_VIEWER_EXPOSURE_BOOST = 1.65;

function resolveSceneExposure(exposure: unknown): number {
  const base = clampNumber(exposure, 0, 5, DEFAULT_SCENE_EXPOSURE);
  return clampNumber(
    base * SCENE_VIEWER_EXPOSURE_BOOST,
    0.05,
    5,
    DEFAULT_SCENE_EXPOSURE * SCENE_VIEWER_EXPOSURE_BOOST,
  );
}


const purposeWatchIcon = '👁️';
const purposeResetIcon = '↕️';
const lanternCloseIcon = '✖️';

let backgroundTexture: THREE.Texture | null = null;
let backgroundTextureCleanup: (() => void) | null = null;
let backgroundAssetId: string | null = null;
let skyCubeTexture: THREE.CubeTexture | null = null;
let skyCubeSourceFormat: 'faces' | 'zip' = 'faces';
let skyCubeFaceAssetIds: Array<string | null> | null = null;
let skyCubeFaceTextureCleanup: Array<(() => void) | null> | null = null;
let gradientBackgroundDome: GradientBackgroundDome | null = null;
let skyCubeZipAssetId: string | null = null;
let skyCubeZipFaceUrlCleanup: (() => void) | null = null;
let backgroundLoadToken = 0;
let pendingEnvironmentSettings: EnvironmentSettings | null = null;
let activeEnvironmentSettings = cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS);
let renderContext: RenderContext | null = null;
let currentDocument: SceneJsonExportDocument | null = null;
let groundSurfacePreviewLoadToken = 0;
let dynamicGroundCache: { nodeId: string; node: SceneNode; dynamicMesh: GroundRuntimeDynamicMesh } | null = null;
let sceneGraphRoot: THREE.Object3D | null = null;
type WindowResizeCallback = Parameters<typeof uni.onWindowResize>[0];
let resizeListener: WindowResizeCallback | null = null;
let canvasResult: UseCanvasResult | null = null;
let initializing = false;
let renderScope: EffectScope | null = null;
const bootstrapFinished = ref(false);

const SCENERY_SCENE_CSM_CONFIG = DEFAULT_SCENE_CSM_CONFIG;
let sceneCsmShadowRuntime: SceneCsmShadowRuntime | null = null;
let sceneCsmRuntimeConfigKey = '';

function isRuntimeObjectEffectivelyVisible(object: THREE.Object3D | null | undefined): boolean {
  let current = object;
  while (current) {
    if (current.visible === false) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

function syncInstancedProxyVisibilityAfterNominate(): void {
  nodeObjectMap.forEach((object) => {
    if (!object?.userData?.instancedAssetId) {
      return;
    }
    syncInstancedTransform(object, true);
  });
}

function applyNominateOverridesForCurrentScene(): void {
  if (!currentDocument?.nodes?.length) {
    return;
  }
  const externalStateMap =
    props.nominateStateMap && typeof props.nominateStateMap === 'object'
      ? props.nominateStateMap
      : null;
  applyNominateStateMapToRuntime(
    currentDocument.nodes,
    (nodeId) => nodeObjectMap.get(nodeId) ?? null,
    externalStateMap,
  );
  syncInstancedProxyVisibilityAfterNominate();
}

function resolveEnvironmentCsmSettings(settings: EnvironmentSettings): EnvironmentCsmSettings {
  const csm = settings.csm;
  return {
    enabled: csm?.enabled ?? SCENERY_SCENE_CSM_CONFIG.enabled,
    shadowEnabled: csm?.shadowEnabled ?? SCENERY_SCENE_CSM_CONFIG.shadowEnabled,
    lightColor: csm?.lightColor ?? '#ffffff',
    lightIntensity: csm?.lightIntensity ?? SCENERY_SCENE_CSM_CONFIG.lightIntensity,
    sunAzimuthDeg: csm?.sunAzimuthDeg ?? DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
    sunElevationDeg: csm?.sunElevationDeg ?? DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
    cascades: csm?.cascades ?? SCENERY_SCENE_CSM_CONFIG.cascades,
    maxFar: csm?.maxFar ?? SCENERY_SCENE_CSM_CONFIG.maxFar,
    shadowMapSize: csm?.shadowMapSize ?? SCENERY_SCENE_CSM_CONFIG.shadowMapSize,
    shadowBias: csm?.shadowBias ?? SCENERY_SCENE_CSM_CONFIG.shadowBias,
  };
}

function resolveScenerySceneCsmConfig(): SceneCsmConfig {
  const settings = currentDocument
    ? resolveDocumentEnvironment(currentDocument)
    : cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS);
  const csm = resolveEnvironmentCsmSettings(settings);
  return {
    ...SCENERY_SCENE_CSM_CONFIG,
    enabled: csm.enabled,
    shadowEnabled: csm.shadowEnabled,
    lightColor: csm.lightColor,
    lightIntensity: csm.lightIntensity,
    cascades: csm.cascades,
    maxFar: csm.maxFar,
    shadowMapSize: csm.shadowMapSize,
    shadowBias: csm.shadowBias,
  };
}

function buildSceneCsmConfigKey(config: SceneCsmConfig): string {
  return JSON.stringify({
    enabled: config.enabled ?? true,
    shadowEnabled: config.shadowEnabled ?? DEFAULT_SCENE_CSM_CONFIG.shadowEnabled,
    cascades: config.cascades ?? DEFAULT_SCENE_CSM_CONFIG.cascades,
    maxFar: config.maxFar ?? DEFAULT_SCENE_CSM_CONFIG.maxFar,
    shadowMapSize: config.shadowMapSize ?? DEFAULT_SCENE_CSM_CONFIG.shadowMapSize,
    shadowBias: config.shadowBias ?? DEFAULT_SCENE_CSM_CONFIG.shadowBias,
    lightMargin: config.lightMargin ?? DEFAULT_SCENE_CSM_CONFIG.lightMargin,
  });
}

function shouldUseSceneCsmShadows(): boolean {
  const config = resolveScenerySceneCsmConfig();
  return Boolean(renderContext?.scene && renderContext?.camera && config.enabled);
}

function ensureSceneCsmShadowRuntime(): SceneCsmShadowRuntime | null {
  const context = renderContext;
  if (!context || !shouldUseSceneCsmShadows()) {
    if (sceneCsmShadowRuntime) {
      disposeSceneCsmShadowRuntime();
    }
    return null;
  }
  const config = resolveScenerySceneCsmConfig();
  const configKey = buildSceneCsmConfigKey(config);
  if (sceneCsmShadowRuntime && sceneCsmRuntimeConfigKey !== configKey) {
    disposeSceneCsmShadowRuntime();
  }
  if (!sceneCsmShadowRuntime) {
    sceneCsmShadowRuntime = createSceneCsmShadowRuntime(context.scene, context.camera, config);
    sceneCsmRuntimeConfigKey = configKey;
    sceneCsmShadowRuntime.registerObject(context.scene);
  }
  syncSceneCsmSunFromEnvironment();
  return sceneCsmShadowRuntime;
}

function disposeSceneCsmShadowRuntime(): void {
  sceneCsmShadowRuntime?.dispose();
  sceneCsmShadowRuntime = null;
  sceneCsmRuntimeConfigKey = '';
}

function syncSceneCsmSunFromEnvironment(): void {
  if (!sceneCsmShadowRuntime || !currentDocument) {
    return;
  }
  const settings = resolveDocumentEnvironment(currentDocument);
  const csm = resolveEnvironmentCsmSettings(settings);
  const sunPosition = resolveSceneCsmSunPositionFromAngles(csm.sunAzimuthDeg, csm.sunElevationDeg, 1000);
  sceneCsmShadowRuntime.syncSun(sunPosition, csm.lightIntensity, csm.lightColor);
}

function applyRendererShadowSetting(): void {
  const context = renderContext;
  if (!context) {
    return;
  }
  const castShadows = Boolean(context.renderer.shadowMap.enabled);
  if (castShadows) {
    const runtime = ensureSceneCsmShadowRuntime();
    runtime?.setActive(true);
    return;
  }
  sceneCsmShadowRuntime?.setActive(false);
}

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
      if (extension === 'hdr' || extension === 'hdri' || extension === 'rgbe') {
        const hdrLoader = await createRgbELoader();
        texture = await hdrLoader.loadAsync(source);
      } else {
        // EXR is not available in all module environments; fall back to image loader.
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
previewComponentManager.registerDefinition(floorComponentDefinition);
previewComponentManager.registerDefinition(wallComponentDefinition);
previewComponentManager.registerDefinition(boundaryWallComponentDefinition);
previewComponentManager.registerDefinition(roadComponentDefinition);
previewComponentManager.registerDefinition(landformComponentDefinition);
previewComponentManager.registerDefinition(guideboardComponentDefinition);
previewComponentManager.registerDefinition(displayBoardComponentDefinition);
previewComponentManager.registerDefinition(billboardComponentDefinition);
previewComponentManager.registerDefinition(signboardComponentDefinition);
previewComponentManager.registerDefinition(viewPointComponentDefinition);
previewComponentManager.registerDefinition(warpGateComponentDefinition);
previewComponentManager.registerDefinition(effectComponentDefinition);
previewComponentManager.registerDefinition(behaviorComponentDefinition);
previewComponentManager.registerDefinition(rigidbodyComponentDefinition);
previewComponentManager.registerDefinition(vehicleComponentDefinition);
previewComponentManager.registerDefinition(waterComponentDefinition);
previewComponentManager.registerDefinition(protagonistComponentDefinition);
previewComponentManager.registerDefinition(lodComponentDefinition);
previewComponentManager.registerDefinition(onlineComponentDefinition);
previewComponentManager.registerDefinition(guideRouteComponentDefinition);
previewComponentManager.registerDefinition(autoTourComponentDefinition);
previewComponentManager.registerDefinition(purePursuitComponentDefinition);
previewComponentManager.registerDefinition(sceneStateAnchorComponentDefinition);
previewComponentManager.registerDefinition(nominateComponentDefinition);
previewComponentManager.registerDefinition(steerComponentDefinition);
previewComponentManager.registerDefinition(preloadableComponentDefinition);

const previewNodeMap = new Map<string, SceneNode>();
const previewParentMap = new Map<string, string | null>();
let appliedDefaultSteerDriveKey: string | null = null;
const assetNodeIdMap = new Map<string, Set<string>>();
const multiuserNodeIds = new Set<string>();
const multiuserNodeObjects = new Map<string, THREE.Object3D>();
const instancedMeshGroup = new THREE.Group();
instancedMeshGroup.name = 'InstancedMeshes';
const instancedMeshes: THREE.InstancedMesh[] = [];
let stopInstancedMeshSubscription: (() => void) | null = null;
let stopBillboardMeshSubscription: (() => void) | null = null;
const instancedMatrixHelper = new THREE.Matrix4();
const instancedPositionHelper = new THREE.Vector3();
const instancedQuaternionHelper = new THREE.Quaternion();
const instancedScaleHelper = new THREE.Vector3();
const instancedFacingDirectionHelper = new THREE.Vector3();
const instancedFacingQuaternionHelper = new THREE.Quaternion();
const instancedFacingAxisHelper = new THREE.Vector3(1, 0, 0);
const instancedCullingProjView = new THREE.Matrix4();
const instancedCullingFrustum = new THREE.Frustum();
const instancedCullingBox = new THREE.Box3();
const instancedCullingSphere = new THREE.Sphere();
const instancedCullingWorldPosition = new THREE.Vector3();
const instancedLodFrustumCuller = createInstancedBvhFrustumCuller();
const TERRAIN_SCATTER_LOD_UPDATE_INTERVAL_MS = isWeChatMiniProgram ? 320 : 200;
const TERRAIN_SCATTER_VISIBILITY_UPDATE_INTERVAL_MS = isWeChatMiniProgram ? 120 : 33;
const TERRAIN_SCATTER_MAX_BINDING_CHANGES_PER_UPDATE = isWeChatMiniProgram ? 120 : 200;
const terrainScatterRuntime = createTerrainScatterLodRuntime({
    lodUpdateIntervalMs: TERRAIN_SCATTER_LOD_UPDATE_INTERVAL_MS,
    visibilityUpdateIntervalMs: TERRAIN_SCATTER_VISIBILITY_UPDATE_INTERVAL_MS,
    cullGraceMs: 300,
    cullRadiusMultiplier: 1.2,
    maxBindingChangesPerUpdate: TERRAIN_SCATTER_MAX_BINDING_CHANGES_PER_UPDATE,
    chunkStreaming: {
    enabled: true,
    },
  });
const instancedCullingLastVisibleAt = new Map<string, number>();

const INSTANCED_CULL_GRACE_MS = 250;

const scenePreviewPerf = createScenePreviewPerfController({ isWeChatMiniProgram });
const TERRAIN_SCATTER_MOVE_THRESHOLD_M = isWeChatMiniProgram ? 0.12 : 0.06;
const TERRAIN_SCATTER_ROT_THRESHOLD_DEG = isWeChatMiniProgram ? 0.8 : 0.3;
const TERRAIN_SCATTER_MAX_STALE_MS = isWeChatMiniProgram ? 280 : 140;
const TERRAIN_SCATTER_ROT_THRESHOLD_RAD = (TERRAIN_SCATTER_ROT_THRESHOLD_DEG * Math.PI) / 180;
const terrainScatterLastCameraPos = new THREE.Vector3();
const terrainScatterLastCameraQuat = new THREE.Quaternion();
const terrainScatterCameraPosScratch = new THREE.Vector3();
const terrainScatterCameraQuatScratch = new THREE.Quaternion();
let terrainScatterLastUpdateAtMs = 0;
let terrainScatterForceNextUpdate = true;

function markTerrainScatterUpdateDirty(): void {
  terrainScatterForceNextUpdate = true;
}

function shouldRunTerrainScatterUpdate(camera: THREE.Camera, nowMs: number): boolean {
  if (!camera) {
    return true;
  }
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(terrainScatterCameraPosScratch);
  camera.getWorldQuaternion(terrainScatterCameraQuatScratch);

  if (terrainScatterForceNextUpdate) {
    terrainScatterForceNextUpdate = false;
    terrainScatterLastUpdateAtMs = nowMs;
    terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
    terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
    return true;
  }

  if (TERRAIN_SCATTER_MAX_STALE_MS > 0 && nowMs - terrainScatterLastUpdateAtMs >= TERRAIN_SCATTER_MAX_STALE_MS) {
    terrainScatterLastUpdateAtMs = nowMs;
    terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
    terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
    return true;
  }

  const moveThresholdSq = TERRAIN_SCATTER_MOVE_THRESHOLD_M * TERRAIN_SCATTER_MOVE_THRESHOLD_M;
  if (moveThresholdSq > 0 && terrainScatterCameraPosScratch.distanceToSquared(terrainScatterLastCameraPos) >= moveThresholdSq) {
    terrainScatterLastUpdateAtMs = nowMs;
    terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
    terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
    return true;
  }

  if (TERRAIN_SCATTER_ROT_THRESHOLD_RAD > 0) {
    const dot = Math.min(1, Math.abs(terrainScatterLastCameraQuat.dot(terrainScatterCameraQuatScratch)));
    const angle = 2 * Math.acos(dot);
    if (Number.isFinite(angle) && angle >= TERRAIN_SCATTER_ROT_THRESHOLD_RAD) {
      terrainScatterLastUpdateAtMs = nowMs;
      terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
      terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
      return true;
    }
  }

  return false;
}

function markInstancedCullingDirty(): void {
  scenePreviewPerf.markInstancedCullingDirty();
}

function shouldRunInstancedCulling(camera: THREE.Camera, nowMs: number): boolean {
  return scenePreviewPerf.shouldRunInstancedCulling(camera, nowMs);
}

const nodeObjectMap = new Map<string, THREE.Object3D>();
const signboardNodeIds = new Set<string>();
const punchNodeIds = new Set<string>();
const signboardOverlayEntries = ref<Array<{
  id: string;
  label: string;
  distanceLabel: string;
  xPercent: number;
  yPercent: number;
  scale: number;
  opacity: number;
  referenceKind: 'camera' | 'vehicle';
  showPunchBadge: boolean;
}>>([]);
const punchBadgeOverlayEntries = ref<Array<{
  id: string;
  xPercent: number;
  yPercent: number;
  scale: number;
  opacity: number;
  referenceKind: 'camera' | 'vehicle';
}>>([]);
const punchedNodeIds = ref<Set<string>>(new Set());
const punchTotalCount = ref(0);
const punchSceneRevision = ref(0);
const signboardReferenceSmoothingState = createSignboardReferenceSmoothingState();
const signboardPlacementSmoothingStates = new Map<string, SignboardPlacementSmoothingState>();
const punchBadgePlacementSmoothingStates = new Map<string, SignboardPlacementSmoothingState>();
const signboardReferenceScratch = new THREE.Vector3();
const signboardAnchorScratch = new THREE.Vector3();
const overlayDistanceReferenceScratch = new THREE.Vector3();
const overlayDistanceTargetAnchorScratch = new THREE.Vector3();
const overlayDistanceReferenceAnchorScratch = new THREE.Vector3();
const behaviorBubbleAnchorScratch = new THREE.Vector3();
const behaviorBubbleCameraScratch = new THREE.Vector3();
const OVERLAY_HORIZONTAL_DISTANCE_Y_EPSILON = 1.5;
const SIGNBOARD_REFERENCE_SMOOTH_SPEED = DEFAULT_SIGNBOARD_REFERENCE_SMOOTH_SPEED;
const SIGNBOARD_PLACEMENT_SMOOTH_SPEED = DEFAULT_SIGNBOARD_PLACEMENT_SMOOTH_SPEED;
const SIGNBOARD_NEAR_FADE_DISTANCE = SIGNBOARD_CLOSE_FADE_DISTANCE;
const SIGNBOARD_MIN_VISIBLE_Y_PERCENT = SIGNBOARD_MIN_SCREEN_Y_PERCENT;
const browserStoredPunchedNodeIds = ref<string[]>([]);

const normalizedInitialPunchedNodeIds = computed(() => {
  const next = new Set<string>();
  (props.initialPunchedNodeIds ?? []).forEach((nodeId: string) => {
    if (typeof nodeId !== 'string') {
      return;
    }
    const normalized = nodeId.trim();
    if (normalized) {
      next.add(normalized);
    }
  });
  return Array.from(next);
});

function resolveActivePunchSceneId(preferredSceneId?: string | null): string {
  if (typeof preferredSceneId === 'string' && preferredSceneId.trim()) {
    return preferredSceneId.trim();
  }
  return (currentSceneId.value ?? currentDocument?.id ?? '').trim();
}

function applyMergedPunchedNodeIds(): void {
  punchedNodeIds.value = new Set<string>([
    ...normalizedInitialPunchedNodeIds.value,
    ...browserStoredPunchedNodeIds.value,
  ]);
}

function syncStoredPunchedNodeIdsForScene(preferredSceneId?: string | null): void {
  const sceneId = resolveActivePunchSceneId(preferredSceneId);
  if (!sceneId) {
    browserStoredPunchedNodeIds.value = [];
    applyMergedPunchedNodeIds();
    return;
  }

  browserStoredPunchedNodeIds.value = punchNodeIds.size
    ? pruneStoredPunchedNodeIds(sceneId, punchNodeIds)
    : loadStoredPunchedNodeIds(sceneId);
  applyMergedPunchedNodeIds();
}

const punchCheckedCount = computed(() => {
  punchSceneRevision.value;
  if (!punchTotalCount.value || !punchedNodeIds.value.size) {
    return 0;
  }

  let count = 0;
  punchedNodeIds.value.forEach((nodeId: string) => {
    if (punchNodeIds.has(nodeId)) {
      count += 1;
    }
  });
  return count;
});

watch(normalizedInitialPunchedNodeIds, () => {
  applyMergedPunchedNodeIds();
}, { immediate: true });

function resetPunchOverlaySmoothing(): void {
  punchBadgePlacementSmoothingStates.clear();
  punchBadgeOverlayEntries.value = [];
}

function resetSignboardOverlaySmoothing(): void {
  resetSignboardReferenceSmoothingState(signboardReferenceSmoothingState);
  signboardPlacementSmoothingStates.clear();
}

let physicsWorld: CANNON.World | null = null;
const physicsEnvironmentEnabled = ref(true);
const rigidbodyInstances = new Map<string, RigidbodyInstance>();
let protagonistNodeId: string | null = null;

const airWallBodies = new Map<string, CANNON.Body>();
const rigidbodyMaterialCache = new Map<string, RigidbodyMaterialEntry>();
const rigidbodyContactMaterialKeys = new Set<string>();
const vehicleInstances = new Map<string, VehicleInstanceWithWheels>();
const vehicleRaycastInWorld = new Set<string>();
const groundHeightfieldCache = new Map<string, GroundHeightfieldCacheEntry>();
const floorShapeCache = new Map<string, FloorShapeCacheEntry>();
const wallTrimeshCache = new Map<string, WallTrimeshCacheEntry>();
const physicsGravity = new CANNON.Vec3(0, -DEFAULT_ENVIRONMENT_GRAVITY, 0);
let physicsContactRestitution = DEFAULT_ENVIRONMENT_RESTITUTION;
let physicsContactFriction = DEFAULT_ENVIRONMENT_FRICTION;
// On WeChat iOS, 30 Hz physics is sufficient for 1–2 dynamic bodies and halves step cost.
const PHYSICS_FIXED_TIMESTEP = isWeChatMiniProgram ? 1 / 30 : 1 / 60;
// Fewer substeps needed at 30 Hz; each covers more sim time.
const PHYSICS_MAX_SUB_STEPS = isWeChatMiniProgram ? 4 : 5;
// 8 solver iterations is enough for simple ground-contact on mobile; 18 for desktop accuracy.
const PHYSICS_SOLVER_ITERATIONS = isWeChatMiniProgram ? 8 : 18;
const PHYSICS_SOLVER_TOLERANCE = 5e-4
const vehicleIdleFreezeLastLogMs = new Map<string, number>();
// Lower stiffness on WeChat converges faster in GSSolver with fewer iterations.
const PHYSICS_CONTACT_STIFFNESS = isWeChatMiniProgram ? 1e7 : 1e9;
const PHYSICS_CONTACT_RELAXATION = 4
const PHYSICS_FRICTION_STIFFNESS = isWeChatMiniProgram ? 1e7 : 1e9;
const PHYSICS_FRICTION_RELAXATION = 4
const PHYSICS_MAX_ACCUMULATOR = PHYSICS_FIXED_TIMESTEP * PHYSICS_MAX_SUB_STEPS;


type PhysicsInterpolationState = {
  prevPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currPos: THREE.Vector3;
  currQuat: THREE.Quaternion;
  hasSample: boolean;
};

const physicsInterpolationStates = new WeakMap<CANNON.Body, PhysicsInterpolationState>();
const physicsInterpolationPos = new THREE.Vector3();
const physicsInterpolationQuat = new THREE.Quaternion();
let physicsInterpolationEnabled = false;
let physicsInterpolationAlpha = 0;
let physicsAccumulator = 0;

type CannonSleepExtensions = {
  sleep?: () => void;
  sleepState?: number;
};

function trySleepBody(body: CANNON.Body | null | undefined): void {
  if (!body) {
    return;
  }
  (body as CANNON.Body & CannonSleepExtensions).sleep?.();
}

function resetPhysicsInterpolationState(body: CANNON.Body | null | undefined): void {
  if (!body) {
    return;
  }
  const state = getPhysicsInterpolationState(body);
  state.prevPos.set(body.position.x, body.position.y, body.position.z);
  state.currPos.copy(state.prevPos);
  state.prevQuat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  state.currQuat.copy(state.prevQuat);
  state.hasSample = true;
}

function syncSceneNodeLocalTransformFromObject(node: SceneNode, object: THREE.Object3D): void {
  if (node.position) {
    node.position.x = object.position.x;
    node.position.y = object.position.y;
    node.position.z = object.position.z;
  }
  autoTourSnapEuler.setFromQuaternion(object.quaternion);
  if (node.rotation) {
    node.rotation.x = autoTourSnapEuler.x;
    node.rotation.y = autoTourSnapEuler.y;
    node.rotation.z = autoTourSnapEuler.z;
  }
}

function applyObjectWorldPose(object: THREE.Object3D, worldPosition: THREE.Vector3, worldQuaternion: THREE.Quaternion): void {
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    autoTourSnapLocalPosition.copy(worldPosition);
    object.parent.worldToLocal(autoTourSnapLocalPosition);
    object.position.copy(autoTourSnapLocalPosition);
    object.parent.getWorldQuaternion(autoTourSnapParentWorldQuaternion);
    autoTourSnapParentWorldQuaternion.invert();
    object.quaternion.copy(autoTourSnapParentWorldQuaternion.multiply(worldQuaternion));
  } else {
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);
  }
  object.updateMatrixWorld(true);
}

function getBodySleepState(body: CANNON.Body | null | undefined): number | undefined {
  if (!body) {
    return undefined;
  }
  return (body as CANNON.Body & CannonSleepExtensions).sleepState;
}

const wheelForwardHelper = new THREE.Vector3();
const wheelAxisHelper = new THREE.Vector3();
const wheelQuaternionHelper = new THREE.Quaternion();
const wheelVisualQuaternionHelper = new THREE.Quaternion();
const wheelParentWorldQuaternionHelper = new THREE.Quaternion();
const wheelParentWorldQuaternionInverseHelper = new THREE.Quaternion();
const wheelBaseQuaternionInverseHelper = new THREE.Quaternion();
const wheelSteeringQuaternionHelper = new THREE.Quaternion();
const wheelSpinQuaternionHelper = new THREE.Quaternion();
const wheelChassisPositionHelper = new THREE.Vector3();
const wheelChassisDisplacementHelper = new THREE.Vector3();
const defaultWheelAxisVector = new THREE.Vector3(DEFAULT_AXLE.x, DEFAULT_AXLE.y, DEFAULT_AXLE.z).normalize();
const VEHICLE_WHEEL_MIN_RADIUS = 0.01;
const VEHICLE_WHEEL_SPIN_EPSILON = 1e-4;
const VEHICLE_TRAVEL_EPSILON = 1e-5;
const VEHICLE_BRAKE_FORCE = 1e6;
const autoTourSnapLocalPosition = new THREE.Vector3();
const autoTourSnapWorldPosition = new THREE.Vector3();
const autoTourSnapWorldQuaternion = new THREE.Quaternion();
const autoTourSnapParentWorldQuaternion = new THREE.Quaternion();
const autoTourSnapEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const autoTourSnapCameraRight = new THREE.Vector3();
const autoTourSnapCameraOffset = new THREE.Vector3();
const autoTourSnapWorldUp = new THREE.Vector3(0, 1, 0);

const behaviorRaycaster = new THREE.Raycaster();
const behaviorPointer = new THREE.Vector2();
let handleBehaviorClick: ((event: MouseEvent | TouchEvent) => void) | null = null;
const LAYER_BEHAVIOR_INTERACTIVE = 1;

function applyInteractionLayers(target: THREE.Object3D, behaviorInteractive: boolean): void {
  if (behaviorInteractive) {
    target.layers.enable(LAYER_BEHAVIOR_INTERACTIVE);
  } else {
    target.layers.disable(LAYER_BEHAVIOR_INTERACTIVE);
  }
}

function syncInteractionLayersForNonNodeDescendants(root: THREE.Object3D, behaviorInteractive: boolean): void {
  const stack = [...root.children];
  while (stack.length > 0) {
    const child = stack.pop();
    if (!child) {
      continue;
    }

    const childNodeId = child.userData?.nodeId as string | undefined;
    if (childNodeId) {
      continue;
    }

    applyInteractionLayers(child, behaviorInteractive);
    stack.push(...child.children);
  }
}

function syncInteractionLayersForNode(nodeId: string, object?: THREE.Object3D): void {
  const target = object ?? nodeObjectMap.get(nodeId);
  if (!target) {
    return;
  }

  let behaviorInteractive = target.layers.isEnabled(LAYER_BEHAVIOR_INTERACTIVE);
  try {
    const actions = listRegisteredBehaviorActions(nodeId);
    const clickable = Array.isArray(actions) && actions.includes('click');
    const behaviorTargetId = clickable ? nodeId : resolveClickBehaviorAncestorNodeId(nodeId);
    behaviorInteractive = Boolean(behaviorTargetId);
  } catch (e) {
    // keep current behavior layer state when registry is unavailable
  }

  applyInteractionLayers(target, behaviorInteractive);
  // Runtime visuals (Warp Gate, Guideboard, etc.) are attached as non-node children.
  syncInteractionLayersForNonNodeDescendants(target, behaviorInteractive);
}

const WHEEL_MOVE_STEP = 1.2;
const worldUp = new THREE.Vector3(0, 1, 0);
const tempForwardVec = new THREE.Vector3();
const tempRightVec = new THREE.Vector3();
const tempMovementVec = new THREE.Vector3();
const tempYawForwardVec = new THREE.Vector3();
const protagonistPosePosition = new THREE.Vector3();
const protagonistPoseDirection = new THREE.Vector3();
const protagonistPoseQuaternion = new THREE.Quaternion();
const protagonistPoseTarget = new THREE.Vector3();
const vehicleCompassForward = new THREE.Vector3();
const vehicleCompassQuaternion = new THREE.Quaternion();
const STEERING_KEYBOARD_RETURN_SPEED = 7;
const STEERING_KEYBOARD_CATCH_SPEED = 18;
const cameraRotationAnchor = new THREE.Vector3();
let suppressSelfYawRecenter = false;
let protagonistPoseSynced = false;

const JOYSTICK_INPUT_RADIUS = 64;
const JOYSTICK_VISUAL_RANGE = 44;
const JOYSTICK_DEADZONE = 0.25;
const VEHICLE_SMOOTH_STOP_TRIGGER_SPEED = 0.6;
const VEHICLE_SMOOTH_STOP_MIN_THROTTLE = 0.05;

type VehicleWheelBinding = {
  nodeId: string | null;
  object: THREE.Object3D | null;
  radius: number;
  axleAxis: THREE.Vector3;
  isFrontWheel: boolean;
  wheelIndex: number;
  spinAngle: number;
  lastSteeringAngle: number;
  baseQuaternion: THREE.Quaternion;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
};

type VehicleInstanceWithWheels = VehicleInstance & {
  vehicle: CANNON.RaycastVehicle;
  wheelBindings: VehicleWheelBinding[];
  forwardAxis: THREE.Vector3;
  lastChassisPosition: THREE.Vector3;
  hasChassisPositionSample: boolean;
};

type Viewer = {
  isShown?: boolean;
  update?: () => void;
  view?: (index?: number) => void;
  hide?: () => void;
};

function runWithProgrammaticCameraMutationAndAnchor<T>(callback: () => T, onComplete?: () => void): T {
  return runWithProgrammaticCameraMutation(callback, () => {
    try {
      onComplete?.();
    } finally {
      if (renderContext) {
        cameraRotationAnchor.copy(renderContext.camera.position);
      }
    }
  });
}

// Placeholder to satisfy controller dependency; first-person state persistence is editor-only.
function syncLastFirstPersonStateFromCamera(): void {
  // no-op for miniprogram
}

let wheelListenerCleanup: (() => void) | null = null;

const behaviorAlert = useBehaviorAlert({
  resolveBehaviorToken: (token, resolution) => resolveBehaviorToken(token, resolution),
  loadTextAssetContent: (assetId) => loadTextAssetContent(assetId),
});
const behaviorAlertVisible = behaviorAlert.visible;
const behaviorAlertToken = behaviorAlert.token;
const behaviorAlertTitle = behaviorAlert.title;
const behaviorAlertMessage = behaviorAlert.message;
const behaviorAlertShowConfirm = behaviorAlert.showConfirm;
const behaviorAlertShowCancel = behaviorAlert.showCancel;
const behaviorAlertConfirmText = behaviorAlert.confirmText;
const behaviorAlertCancelText = behaviorAlert.cancelText;

const behaviorBubble = useBehaviorBubble({
  resolveBehaviorToken: (token, resolution) => resolveBehaviorToken(token, resolution),
  loadTextAssetContent: (assetId) => loadTextAssetContent(assetId),
  canPresent: (event) => canPresentBehaviorBubble(event),
});
const behaviorBubbleVisible = behaviorBubble.visible;
const behaviorBubbleMessage = behaviorBubble.message;
const behaviorBubbleVariant = behaviorBubble.variant;
const behaviorBubbleAnimation = behaviorBubble.animation;
const behaviorBubbleAnchorMode = behaviorBubble.anchorMode;
const behaviorBubbleAnchorXPercent = behaviorBubble.anchorXPercent;
const behaviorBubbleAnchorYPercent = behaviorBubble.anchorYPercent;
const behaviorBubbleStyle = behaviorBubble.style;

type InfoBoardOverlayPlacement = {
  xPercent: number;
  yPercent: number;
  scale: number;
  opacity: number;
};

const infoBoardOverlayVisible = ref(false);
const infoBoardOverlayLoading = ref(false);
const infoBoardOverlayNodeId = ref<string | null>(null);
const infoBoardOverlayContent = ref('');
const infoBoardOverlayPlacement = reactive<InfoBoardOverlayPlacement>({
  xPercent: 78,
  yPercent: 18,
  scale: 1,
  opacity: 1,
});
let infoBoardOverlayGeneration = 0;
let infoBoardAudioContext: ViewerInnerAudioContext | null = null;
let infoBoardAudioResolved: ResolvedAssetUrl | null = null;

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
let lanternViewerInstance: any = null;
const punchSummaryTopOffset = computed(() => {
  const safeAreaTop = Math.max(
    initialSystemInfo?.safeAreaInsets?.top ?? 0,
    initialSystemInfo?.statusBarHeight ?? 0,
  );
  let topOffset = safeAreaTop + 42;

  if (isWeChatMiniProgram) {
    try {
      const menuButtonRect = uni.getMenuButtonBoundingClientRect?.();
      if (menuButtonRect && Number.isFinite(menuButtonRect.bottom)) {
        topOffset = Math.max(topOffset, Math.ceil(menuButtonRect.bottom + 12));
      }
    } catch (_error) {
      // Keep the fallback offset when the capsule rect is unavailable.
    }
  }

  return topOffset;
});

const punchSummaryStyle = computed(() => ({
  top: `${punchSummaryTopOffset.value}px`,
}));

const floatingAutoTourButtonStyle = computed(() => ({
  top: `${punchSummaryTopOffset.value}px`,
}));

const floatingAutoTourPauseButtonStyle = computed(() => ({
  top: 'auto',
  bottom: 'calc(22px + var(--viewer-safe-area-bottom, 0px))',
}));

const lanternViewerOptions: Record<string, any> = {};
// #ifdef H5
Object.assign(lanternViewerOptions, {
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
});
// #endif
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

const infoBoardPanelStyle = computed(() => {
  const viewportWidth = lanternViewportSize.width || 375;
  const viewportHeight = lanternViewportSize.height || 667;
  return {
    maxWidth: `${Math.round(Math.min(viewportWidth * 0.84, 560))}px`,
    maxHeight: `${Math.round(Math.min(viewportHeight * 0.58, viewportHeight - 128))}px`,
  };
});

const lanternAssets = useLanternAssets({
  loadTextAssetContent: (assetId) => loadTextAssetContent(assetId),
  resolveAssetUrlFromCache: (assetId) => resolveAssetUrlFromCache(assetId),
});
const lanternImageState = lanternAssets.lanternImageState;
const ensureLanternText = lanternAssets.ensureLanternText;
const ensureLanternImage = lanternAssets.ensureLanternImage;
const pruneLanternAssets = lanternAssets.pruneActiveAssets;

const purposeControlsVisible = ref(false);
const purposeTargetNodeId = ref<string | null>(null);
const purposeSourceNodeId = ref<string | null>(null);
const purposeActiveMode = ref<'watch' | 'level'>('level');

const pageInstance = getCurrentInstance();

const vehicleDriveActive = ref(false);
const vehicleDriveNodeId = ref<string | null>(null);
const vehicleDriveToken = ref<string | null>(null);
const activeVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
const vehicleDriveSeatNodeId = ref<string | null>(null);
const vehicleDriveUiOverride = ref<'auto' | 'show' | 'hide'>('auto');
const vehicleDriveExitBusy = ref(false);
let vehicleDriveSteerable: number[] = [];
let vehicleDriveWheelCount = 0;
let vehicleDriveVehicle: CANNON.RaycastVehicle | null = null;
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
const vehicleDriveOrbitMode = ref<VehicleDriveOrbitMode>('follow');
const vehicleDriveCameraFollowState = reactive<VehicleDriveCameraFollowState>({
  desiredPosition: new THREE.Vector3(),
  currentPosition: new THREE.Vector3(),
  desiredTarget: new THREE.Vector3(),
  currentTarget: new THREE.Vector3(),
  desiredAnchor: new THREE.Vector3(),
  currentAnchor: new THREE.Vector3(),
  anchorHoldSeconds: 0,
  lastVelocityDirection: new THREE.Vector3(0, 0, 1),
  shouldHoldAnchorForReverse: false,
  heading: new THREE.Vector3(0, 0, 1),
  initialized: false,
  localOffset: new THREE.Vector3(),
  hasLocalOffset: false,
  motionDistanceBlend: 0,
  lookaheadOffset: new THREE.Vector3(),
});
const lanternJoystickRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const floatingJoystickRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const joystickVector = reactive({ x: 0, y: 0 });
const joystickOffset = reactive({ x: 0, y: 0 });
const joystickState = reactive({
  active: false,
  pointerId: -1,
  centerX: 0,
  centerY: 0,
  ready: false,
});
const DRIVE_PAD_MOUSE_POINTER_ID = -2;
const DRIVE_PAD_FADE_MS = 220;
const drivePadState = reactive({ visible: false, fading: false, x: 0, y: 0 });
const drivePadStyle = computed(() => ({
  left: `${drivePadState.x}px`,
  top: `${drivePadState.y}px`,
}));
let drivePadFadeTimer: ReturnType<typeof setTimeout> | null = null;
let drivePadMouseTracking = false;
const isBrowserEnvironment = typeof window !== 'undefined';
const drivePadViewportRect = { top: 0, left: 0, height: getViewportHeight() };
const steeringKeyboardValue = ref(0);
const steeringKeyboardTarget = ref(0);
const joystickKnobStyle = computed(() => {
  const scale = joystickState.active ? 0.88 : 1;
  return {
    transform: `translate(calc(-50% + ${joystickOffset.x}px), calc(-50% + ${joystickOffset.y}px)) scale(${scale})`,
  };
});
const vehicleDriveResetBusy = ref(false);

type CameraViewMode = 'level' | 'watching';
const cameraViewState = reactive<{ mode: CameraViewMode; targetNodeId: string | null }>({
  mode: 'level',
  targetNodeId: null,
});

const vehicleDriveCameraRestoreState: VehicleDriveCameraRestoreState = {
  hasSnapshot: false,
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  up: new THREE.Vector3(),
  controlMode: null,
  viewMode: cameraViewState.mode as CameraViewMode,
  viewTargetId: cameraViewState.targetNodeId as string | null,
  isCameraCaged: false,
  purposeMode: purposeActiveMode.value,
};

const vehicleSpeed = ref(0);
const vehicleSpeedKmh = computed(() => Math.round(vehicleSpeed.value * 3.6));
const vehicleHeadingDegrees = ref(0);
const vehicleCompassStyle = computed(() => ({
  '--vehicle-heading': `${vehicleHeadingDegrees.value}deg`,
}));
const vehicleCompassTicks = Array.from({ length: 24 }, (_, index) => index)
  .filter((index) => ![0, 6, 12, 18].includes(index))
  .map((index) => ({
    key: `vehicle-compass-tick-${index}`,
    major: index % 3 === 0,
    style: {
      transform: `translateX(-50%) rotate(${index * 15}deg)`,
    },
  }));
const vehicleCompassLabels = [
  { key: 'north', text: '北', angle: 0 },
  { key: 'east', text: '东', angle: 90 },
  { key: 'south', text: '南', angle: 180 },
  { key: 'west', text: '西', angle: 270 },
].map((label) => ({
  key: label.key,
  text: label.text,
  slotStyle: {
    transform: `rotate(${label.angle}deg)`,
  },
  textStyle: {
    transform: `translateX(-50%) rotate(${-label.angle}deg)`,
  },
}));

// Bridge object so the shared VehicleDriveController can mutate existing refs while keeping reactivity intact.
const vehicleDriveStateBridge: import('@harmony/schema/VehicleDriveController').VehicleDriveRuntimeState = {
  get active() {
    return vehicleDriveActive.value;
  },
  set active(value: boolean) {
    vehicleDriveActive.value = value;
  },
  get nodeId() {
    return vehicleDriveNodeId.value;
  },
  set nodeId(value: string | null) {
    vehicleDriveNodeId.value = value;
  },
  get token() {
    return vehicleDriveToken.value;
  },
  set token(value: string | null) {
    vehicleDriveToken.value = value;
  },
  get vehicle() {
    return vehicleDriveVehicle;
  },
  set vehicle(value: CANNON.RaycastVehicle | null) {
    vehicleDriveVehicle = value;
  },
  get steerableWheelIndices() {
    return vehicleDriveSteerable;
  },
  set steerableWheelIndices(value: number[]) {
    vehicleDriveSteerable = value;
  },
  get wheelCount() {
    return vehicleDriveWheelCount;
  },
  set wheelCount(value: number) {
    vehicleDriveWheelCount = value;
  },
  get seatNodeId() {
    return vehicleDriveSeatNodeId.value;
  },
  set seatNodeId(value: string | null) {
    vehicleDriveSeatNodeId.value = value;
  },
  get sourceEvent() {
    return activeVehicleDriveEvent.value;
  },
  set sourceEvent(value: unknown) {
    activeVehicleDriveEvent.value = value as Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null;
  },
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
      joystickActive: false,
      accelerating: false,
      braking: false,
    } as const;
  }
  const nodeId = vehicleDriveNodeId.value ?? '';
  const node = nodeId ? resolveNodeById(nodeId) : null;
  const label = node?.name?.trim() || nodeId || 'Vehicle';
  return {
    visible: true,
    label,
    cameraLocked: active,
    joystickActive: active && joystickState.active,
    accelerating: active && (vehicleDriveInputFlags.forward || vehicleDriveInput.throttle > 0.1),
    braking: active && vehicleDriveInputFlags.brake,
  } as const;
});

const pendingVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
const vehicleDrivePromptBusy = ref(false);
const activeAutoTourNodeIds = reactive(new Set<string>());

// Auto-tour pause only affects auto-tour playback and vehicles driven by auto-tour.
// It does NOT change manual driving (`vehicleDriveActive`) behavior or global playback.
const autoTourPaused = ref(false);
const autoTourPausedIsTerminal = ref(false);
const autoTourPausedNodeId = ref<string | null>(null);

const autoTourFollowNodeId = ref<string | null>(null);
const autoTourCameraFollowState = createCameraFollowState();
const autoTourCameraFollowController = new FollowCameraController();
const autoTourCameraFollowLastAnchor = new THREE.Vector3();
const autoTourCameraFollowVelocity = new THREE.Vector3();
const autoTourCameraFollowVelocityScratch = new THREE.Vector3();
const autoTourCameraFollowAnchorScratch = new THREE.Vector3();
const autoTourCameraFollowForwardScratch = new THREE.Vector3();
const autoTourCameraFollowBox = new THREE.Box3();
const AUTO_TOUR_RESUME_BLEND_SECONDS = 0.28;
const autoTourPausedCameraPosition = new THREE.Vector3();
const autoTourPausedCameraTarget = new THREE.Vector3();
let autoTourPausedCameraSnapshotValid = false;
const autoTourPausedCameraNodeId = ref<string | null>(null);
const autoTourResumeBlendState = createCameraFollowState();
const autoTourResumeBlendController = new FollowCameraController();
const autoTourResumeBlendStartPosition = new THREE.Vector3();
const autoTourResumeBlendStartTarget = new THREE.Vector3();
const autoTourResumeBlendTempCamera = new THREE.PerspectiveCamera();
const autoTourResumeBlendTempControlsTarget = new THREE.Vector3();
const autoTourResumeBlendTempControls = {
  target: autoTourResumeBlendTempControlsTarget,
  update: () => undefined,
  enabled: false,
};
let autoTourResumeBlendActive = false;
let autoTourResumeBlendElapsedSeconds = 0;
let autoTourResumeBlendNodeId: string | null = null;
let autoTourCameraFollowHasSample = false;
let autoTourActiveSyncAccumSeconds = 0;
const autoTourRotationOnlyHold = ref(false);
let autoTourLastAnyActive = false;

function applyAutoTourCameraInputPolicy(): void {
  if (vehicleDriveActive.value) {
    return;
  }
  const anyActive = activeAutoTourNodeIds.size > 0;
  const shouldLock = anyActive && !autoTourPaused.value;
  const shouldRotateOnly = (anyActive && autoTourPaused.value) || (!anyActive && autoTourRotationOnlyHold.value);

  if (shouldLock) {
    setCameraCaging(true);
    return;
  }

  setCameraCaging(false);
  const controls = renderContext?.controls;
  if (controls) {
    controls.enabled = true;
    controls.enableRotate = true;
    controls.enablePan = shouldRotateOnly ? false : true;
  }
}

function clearAutoTourPausedCameraSnapshot(): void {
  autoTourPausedCameraSnapshotValid = false;
  autoTourPausedCameraNodeId.value = null;
}

function captureAutoTourPausedCameraSnapshot(nodeId: string): void {
  const context = renderContext;
  if (!context) {
    return;
  }
  autoTourPausedCameraPosition.copy(context.camera.position);
  autoTourPausedCameraTarget.copy(context.controls.target);
  autoTourPausedCameraSnapshotValid = true;
  autoTourPausedCameraNodeId.value = nodeId;
}

function reapplyAutoTourPausedCameraSnapshot(nodeId: string): void {
  const context = renderContext;
  if (!context || !autoTourPausedCameraSnapshotValid || autoTourPausedCameraNodeId.value !== nodeId) {
    return;
  }
  runWithProgrammaticCameraMutationAndAnchor(() => {
    context.camera.position.copy(autoTourPausedCameraPosition);
    context.controls.target.copy(autoTourPausedCameraTarget);
    context.camera.lookAt(context.controls.target);
  });
}

function clearAutoTourResumeBlendState(): void {
  autoTourResumeBlendActive = false;
  autoTourResumeBlendElapsedSeconds = 0;
  autoTourResumeBlendNodeId = null;
}

function resolveAutoTourCameraFollowAnchor(object: THREE.Object3D): THREE.Vector3 {
  autoTourCameraFollowBox.makeEmpty();
  autoTourCameraFollowBox.setFromObject(object);
  if (!autoTourCameraFollowBox.isEmpty() && Number.isFinite(autoTourCameraFollowBox.min.x)) {
    autoTourCameraFollowBox.getCenter(autoTourCameraFollowAnchorScratch);
  } else {
    object.getWorldPosition(autoTourCameraFollowAnchorScratch);
  }
  return autoTourCameraFollowAnchorScratch;
}

function seedAutoTourCameraFollowStateFromView(
  followState: CameraFollowState,
  cameraPosition: THREE.Vector3,
  cameraTarget: THREE.Vector3,
  anchorWorld: THREE.Vector3,
  forwardWorld: THREE.Vector3,
): void {
  resetCameraFollowState(followState);

  autoTourCameraFollowForwardScratch.copy(forwardWorld);
  autoTourCameraFollowForwardScratch.y = 0;
  if (autoTourCameraFollowForwardScratch.lengthSq() < 1e-8) {
    autoTourCameraFollowForwardScratch.set(0, 0, 1);
  } else {
    autoTourCameraFollowForwardScratch.normalize();
  }

  followState.currentPosition.copy(cameraPosition);
  followState.desiredPosition.copy(cameraPosition);
  followState.currentTarget.copy(cameraTarget);
  followState.desiredTarget.copy(cameraTarget);
  followState.currentAnchor.copy(anchorWorld);
  followState.desiredAnchor.copy(anchorWorld);
  followState.heading.copy(autoTourCameraFollowForwardScratch);
  followState.lastVelocityDirection.set(0, 0, 0);
  followState.lookaheadOffset.set(0, 0, 0);
  followState.motionDistanceBlend = 0;
  followState.shouldHoldAnchorForReverse = false;

  autoTourSnapCameraRight.crossVectors(autoTourSnapWorldUp, autoTourCameraFollowForwardScratch);
  if (autoTourSnapCameraRight.lengthSq() < 1e-8) {
    autoTourSnapCameraRight.set(1, 0, 0);
  } else {
    autoTourSnapCameraRight.normalize();
  }

  autoTourSnapCameraOffset.copy(cameraPosition).sub(anchorWorld);
  followState.localOffset.set(
    autoTourSnapCameraOffset.dot(autoTourSnapCameraRight),
    autoTourSnapCameraOffset.dot(autoTourSnapWorldUp),
    autoTourSnapCameraOffset.dot(autoTourCameraFollowForwardScratch),
  );
  followState.hasLocalOffset = true;
  followState.initialized = true;
}

function resetAutoTourCameraFollowState(): void {
  resetCameraFollowState(autoTourCameraFollowState);
  clearAutoTourPausedCameraSnapshot();
  clearAutoTourResumeBlendState();
  autoTourCameraFollowHasSample = false;
  autoTourCameraFollowLastAnchor.set(0, 0, 0);
  autoTourCameraFollowVelocity.set(0, 0, 0);
}

function primeAutoTourCameraFollowTransition(object: THREE.Object3D, forwardWorld: THREE.Vector3): void {
  const context = renderContext;
  if (!context) {
    return;
  }

  const anchorWorld = resolveAutoTourCameraFollowAnchor(object);
  seedAutoTourCameraFollowStateFromView(
    autoTourCameraFollowState,
    context.camera.position,
    context.controls.target,
    anchorWorld,
    forwardWorld,
  );
  autoTourCameraFollowLastAnchor.copy(autoTourCameraFollowAnchorScratch);
  autoTourCameraFollowVelocity.set(0, 0, 0);
  autoTourCameraFollowHasSample = true;
}

const vehicleDriveController = new VehicleDriveController(
  {
    vehicleInstances,
    rigidbodyInstances,
    nodeObjectMap,
    resolveNodeById,
    resolveRigidbodyComponent,
    resolveVehicleComponent,
    ensurePhysicsWorld,
    isPhysicsEnabled: () => physicsEnvironmentEnabled.value,
    ensureVehicleBindingForNode,
    normalizeNodeId,
    setCameraViewState: (mode, targetId) => setCameraViewState(mode as CameraViewMode, targetId ?? null),
    setCameraCaging,
    withControlsVerticalFreedom,
    lockControlsPitchToCurrent,
    syncLastFirstPersonStateFromCamera,
    onToast: (message) => uni.showToast({ title: message, icon: 'none' }),
    onResolveBehaviorToken: (token, resolution) => resolveBehaviorToken(token, resolution),

    // Use one shared follow-camera tuning profile across platforms.
    followCameraVelocityLerpSpeed: () => 0,
    followCameraTuning: () => ({
      positionLerpSpeed: 0,
      targetLerpSpeed: 0,
      headingLerpSpeed: 0,
      anchorLerpSpeed: 0,
      lookaheadTime: 0,
      lookaheadDistanceMax: 0,
      lookaheadMinSpeedSq: 1,
      lookaheadBlendStart: 99,
      lookaheadBlendSpeed: 0,
      motionSpeedThreshold: 99,
      motionSpeedFull: 7,
      motionBlendSpeed: 0,
      motionDistanceBoost: 0,
      motionHeightBoost: 0,
    }),

    // Provide interpolated chassis position for camera anchor (when physics interpolation is enabled).
    resolveChassisWorldPosition: (nodeId, chassisBody, target) => {
      if (!physicsEnvironmentEnabled.value) {
        return false;
      }
      if (!physicsInterpolationEnabled) {
        return false;
      }
      // Only apply when resolving the currently driven vehicle.
      if (!vehicleDriveActive.value || vehicleDriveNodeId.value !== nodeId) {
        return false;
      }
      resolveInterpolatedBodyPosition(chassisBody as unknown as CANNON.Body, target);
      return true;
    },

    // Provide physics velocity directly (less sensitive to render-alpha changes than finite differencing).
    resolveChassisWorldVelocity: (nodeId, chassisBody, target) => {
      if (!vehicleDriveActive.value || vehicleDriveNodeId.value !== nodeId) {
        return false;
      }
      const v = chassisBody?.velocity as unknown as { x?: number; y?: number; z?: number } | null;
      if (!v) {
        return false;
      }
      target.set(Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0);
      return true;
    },
    onVehicleObjectTransformUpdated: (nodeId, object) => {
      const node = resolveNodeById(nodeId);
      if (node) {
        syncSceneNodeLocalTransformFromObject(node, object);
      }
      syncInstancedTransform(object);
    },
  },
  {
    state: vehicleDriveStateBridge,
    inputFlags: vehicleDriveInputFlags,
    input: vehicleDriveInput,
    cameraMode: vehicleDriveCameraMode,
    orbitMode: vehicleDriveOrbitMode,
    uiOverride: vehicleDriveUiOverride,
    promptBusy: vehicleDrivePromptBusy,
    exitBusy: vehicleDriveExitBusy,
    cameraRestoreState: vehicleDriveCameraRestoreState,
    cameraFollowState: vehicleDriveCameraFollowState,
    steeringKeyboardValue,
  },
);

watch(
  () => vehicleDriveUi.value.visible,
  (visible) => {
    if (visible) {
      refreshJoystickMetrics();
    } else {
      detachDrivePadMouseListeners();
      hideDrivePadImmediate();
      deactivateJoystick(true);
    }
  },
);

watch(vehicleDriveCameraMode, (mode) => {
  vehicleDriveCameraFollowState.initialized = false;
  if (!vehicleDriveActive.value) {
    return;
  }
  if (mode === 'follow') {
    const nodeId = normalizeNodeId(vehicleDriveNodeId.value);
    if (nodeId) {
      setCameraViewState('watching', nodeId);
      setCameraCaging(true);
    }
    setVehicleDriveUiOverride('show');
    updateVehicleDriveCamera(0, { immediate: true });
  } else {
    setVehicleDriveUiOverride('hide');
    updateVehicleDriveCamera(0, { immediate: true });
  }
});

watch(vehicleDriveActive, (active) => {
  if (!active) {
    vehicleDriveCameraMode.value = 'follow';
    vehicleDriveCameraFollowState.initialized = false;
    vehicleSpeed.value = 0;
  }
});
const isCameraCaged = ref(false);

const activeBehaviorDelayTimers = new Map<string, ReturnType<typeof setTimeout>>();
const activeBehaviorAnimations = new Map<string, () => void>();
type ViewerInnerAudioContext = ReturnType<typeof uni.createInnerAudioContext>;

type BehaviorSoundInstance = {
  key: string;
  params: Extract<BehaviorRuntimeEvent, { type: 'play-sound' }>['params'];
  targetNodeId: string | null;
  audio: ViewerInnerAudioContext | null;
  startTimer: ReturnType<typeof setTimeout> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  intervalTimer: ReturnType<typeof setTimeout> | null;
  fadeTimer: ReturnType<typeof setInterval> | null;
  fadeStartTimer: ReturnType<typeof setTimeout> | null;
  onFinish: ((resolution: BehaviorEventResolution) => void) | null;
  envelopeGain: number;
  stopped: boolean;
};

const activeBehaviorSounds = new Map<string, BehaviorSoundInstance>();
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
const groundFogScaleHelper = new THREE.Vector3();
const tempVector = new THREE.Vector3();
const tempObserverVector = new THREE.Vector3();
const tempRegionObserverVector = new THREE.Vector3();
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
  const exposedRootRef = (target as { rootRef?: unknown }).rootRef;
  if (exposedRootRef) {
    const exposedRootValue = (exposedRootRef as { value?: unknown }).value ?? exposedRootRef;
    if (typeof (exposedRootValue as HTMLElement).getBoundingClientRect === 'function') {
      return exposedRootValue as HTMLElement;
    }
    const exposedElement = (exposedRootValue as { $el?: unknown }).$el;
    if (exposedElement && typeof (exposedElement as HTMLElement).getBoundingClientRect === 'function') {
      return exposedElement as HTMLElement;
    }
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

  const viewer = resolveLanternViewer();
  if (!viewer) {
    return false;
  }
  const state = viewer as unknown as { isShown?: boolean };
  return Boolean(state?.isShown);
}

function syncLanternViewer(): void {

  const viewer = resolveLanternViewer();
  viewer?.update?.();
}

function syncLanternViewerLater(): void {
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
    success: (info: { width?: number; height?: number }) => {
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
  // #ifndef H5
  fallbackPreview();
  return;
  // #endif
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
  // #ifndef H5
  return;
  // #endif
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
    pruneLanternAssets(activeTextIds, activeImageIds);
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
      success: (res: { data: unknown }) => {
        if (typeof res.data === 'string') {
          resolve(res.data);
        } else if (res.data != null) {
          resolve(JSON.stringify(res.data));
        } else {
          resolve('');
        }
      },
      fail: (err: { errMsg?: unknown } | null) => {
        reject(new Error(String(err?.errMsg ?? '网络请求失败')));
      },
    });
  });
}

const EXTERNAL_ASSET_PATTERN = /^(https?:)?\/\//i;

function isExternalAssetReference(value: string): boolean {
  return EXTERNAL_ASSET_PATTERN.test(value);
}

function mergeSceneAssetOverrides(
  primary: SceneGraphBuildOptions['assetOverrides'] | undefined,
  secondary: SceneGraphBuildOptions['assetOverrides'] | undefined,
): SceneGraphBuildOptions['assetOverrides'] | undefined {
  if (!primary && !secondary) {
    return undefined;
  }
  return {
    ...(primary ?? {}),
    ...(secondary ?? {}),
  };
}

function getArrayBufferView(bytes: Uint8Array): ArrayBuffer {
  const safe = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(safe).set(bytes);
  return safe;
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

// use shared `inferMimeTypeFromAssetId` from schema
function getOrCreateObjectUrl(assetId: string, data: ArrayBuffer | Blob, mimeHint?: string): string {
	const cached = assetObjectUrlCache.get(assetId)
	if (cached) {
		return cached
	}
	const mimeType = mimeHint ?? inferMimeTypeFromAssetId(assetId) ?? 'application/octet-stream'
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType })
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
  if (entry.blob) {
    const url = getOrCreateObjectUrl(assetId, entry.blob, mimeType ?? undefined)
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

function readGroundTerrainManifestFromPackage(pkg: ScenePackageUnzipped, manifestPath: string | null | undefined): SceneTerrainPackageBundle | null {
  const trimmedPath = typeof manifestPath === 'string' ? manifestPath.trim() : ''
  if (!trimmedPath) {
    return null
  }
  const manifestText = readTextFileFromScenePackage(pkg, trimmedPath)
  const raw = JSON.parse(manifestText) as unknown
  if (!raw || typeof raw !== 'object') {
    throw new Error(`场景包内 ground terrain manifest 无效：${trimmedPath}`)
  }
  const candidate = raw as GroundTerrainPackageManifest
  if (candidate.format !== GROUND_TERRAIN_PACKAGE_FORMAT || candidate.version !== GROUND_TERRAIN_PACKAGE_VERSION) {
    throw new Error(`场景包内 ground terrain manifest 版本不匹配：${trimmedPath}`)
  }
  return {
    manifestPath: trimmedPath,
    manifest: candidate,
  }
}

async function resolveAssetUrlReference(candidate: string): Promise<ResolvedAssetUrl | null> {
	const trimmed = candidate.trim()
	if (!trimmed.length) {
		return null
	}
  if (trimmed.startsWith('data:') || isExternalAssetReference(trimmed) || trimmed.startsWith('/')) {
		return { url: trimmed, mimeType: inferMimeTypeFromUrl(trimmed) }
	}
  // scene-package internal path (e.g. scenes/<id>/resources/<assetId>.<ext>)
  if (activeScenePackagePkg && activeScenePackagePkg.files?.[trimmed]) {
    const bytes = activeScenePackagePkg.files[trimmed]!
    const mimeType = inferMimeTypeFromAssetId(trimmed) ?? 'application/octet-stream'
    const url = getOrCreateObjectUrl(trimmed, getArrayBufferView(bytes), mimeType)
    return { url, mimeType }
  }
	const assetId = trimmed.startsWith('asset://') ? trimmed.slice('asset://'.length) : trimmed
	return await resolveAssetUrlFromCache(assetId)
}

function requestBinaryFromUrl(url: string): Promise<ArrayBuffer> {
  if (typeof fetch === 'function') {
    return fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.arrayBuffer();
    });
  }
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: SCENE_DOWNLOAD_TIMEOUT,
      success: (res: { statusCode?: number; data: unknown }) => {
        const statusCode = typeof res.statusCode === 'number' ? res.statusCode : 200;
        if (statusCode >= 400) {
          reject(new Error(`下载失败（${statusCode}）`));
          return;
        }
        const buffer = res.data as ArrayBuffer;
        if (!buffer || typeof buffer.byteLength !== 'number') {
          reject(new Error('下载失败（响应不是二进制数据）'));
          return;
        }
        resolve(buffer);
      },
      fail: (requestError: { errMsg?: unknown } | null) => {
        const message =
          requestError && typeof requestError === 'object' && 'errMsg' in requestError
            ? String((requestError as { errMsg: unknown }).errMsg)
            : '下载失败';
        reject(new Error(message));
      },
    });
  });
}

function buildObjectUrlsFromSkycubeZipFaces(
  facesInOrder: ReadonlyArray<ReturnType<typeof extractSkycubeZipFaces>['facesInOrder'][number]>,
): { urls: Array<string | null>; dispose: () => void } {
  const urls: Array<string | null> = [];
  const created: string[] = [];
  for (const face of facesInOrder) {
    if (!face) {
      urls.push(null);
      continue;
    }
    const mimeType = face.mimeType ?? 'application/octet-stream';
    const bytes = face.bytes as unknown as Uint8Array;
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const blob = new Blob([blobBytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    created.push(url);
    urls.push(url);
  }
  return {
    urls,
    dispose: () => {
      for (const url of created) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
    },
  };
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

function resetInfoBoardAudio(): void {
  if (infoBoardAudioContext) {
    try {
      infoBoardAudioContext.stop();
    } catch (error) {
      console.warn('停止信息板音频失败', error);
    }
    try {
      infoBoardAudioContext.destroy();
    } catch (error) {
      console.warn('销毁信息板音频失败', error);
    }
    infoBoardAudioContext = null;
  }
  if (infoBoardAudioResolved) {
    infoBoardAudioResolved.dispose?.();
    infoBoardAudioResolved = null;
  }
}

function resetInfoBoardOverlay(): void {
  infoBoardOverlayGeneration += 1;
  infoBoardOverlayVisible.value = false;
  infoBoardOverlayLoading.value = false;
  infoBoardOverlayNodeId.value = null;
  infoBoardOverlayContent.value = '';
  infoBoardOverlayPlacement.xPercent = 78;
  infoBoardOverlayPlacement.yPercent = 18;
  infoBoardOverlayPlacement.scale = 1;
  infoBoardOverlayPlacement.opacity = 1;
  resetInfoBoardAudio();
}

function updateInfoBoardOverlayPlacement(activeCamera: THREE.Camera | null): void {
  if (!infoBoardOverlayVisible.value) {
    return;
  }
  const nodeId = infoBoardOverlayNodeId.value;
  const object = nodeId ? nodeObjectMap.get(nodeId) ?? null : null;
  if (!activeCamera || !object) {
    infoBoardOverlayPlacement.xPercent = 78;
    infoBoardOverlayPlacement.yPercent = 18;
    infoBoardOverlayPlacement.scale = 1;
    infoBoardOverlayPlacement.opacity = 1;
    return;
  }
  const anchorWorld = resolveSignboardAnchorWorldPosition(object, behaviorBubbleAnchorScratch);
  const referenceWorld = resolveOverlayDistanceReferenceWorld(nodeId, anchorWorld, {
    position: activeCamera.position,
    nodeId: resolveOverlayDistanceReferenceNodeId(),
  });
  const placement = computeSignboardPlacement({
    anchorWorld,
    referenceWorld,
    camera: activeCamera,
    closeFadeDistance: SIGNBOARD_CLOSE_FADE_DISTANCE,
    minScreenYPercent: SIGNBOARD_MIN_SCREEN_Y_PERCENT,
  });
  if (!placement) {
    infoBoardOverlayPlacement.xPercent = 78;
    infoBoardOverlayPlacement.yPercent = 18;
    infoBoardOverlayPlacement.scale = 1;
    infoBoardOverlayPlacement.opacity = 1;
    return;
  }
  infoBoardOverlayPlacement.xPercent = placement.xPercent;
  infoBoardOverlayPlacement.yPercent = placement.yPercent;
  infoBoardOverlayPlacement.scale = placement.scale;
  infoBoardOverlayPlacement.opacity = placement.opacity;
}

async function playInfoBoardAudio(assetId: string, generation: number): Promise<void> {
  const resolved = await resolveAssetUrlReference(assetId);
  if (!resolved?.url || generation !== infoBoardOverlayGeneration || !infoBoardOverlayVisible.value) {
    resolved?.dispose?.();
    return;
  }
  resetInfoBoardAudio();
  const audio = uni.createInnerAudioContext();
  audio.autoplay = false;
  audio.loop = false;
  audio.src = resolved.url;
  infoBoardAudioContext = audio;
  infoBoardAudioResolved = resolved;
  audio.onEnded(() => {
    if (generation === infoBoardOverlayGeneration) {
      resetInfoBoardAudio();
    }
  });
  try {
    audio.play();
  } catch (error) {
    console.warn('播放信息板音频失败', error);
    resetInfoBoardAudio();
  }
}

async function presentInfoBoard(event: Extract<BehaviorRuntimeEvent, { type: 'show-info-board' }>): Promise<void> {
  const generation = ++infoBoardOverlayGeneration;
  resetInfoBoardAudio();
  infoBoardOverlayVisible.value = true;
  infoBoardOverlayLoading.value = false;
  infoBoardOverlayNodeId.value = event.nodeId;
  infoBoardOverlayContent.value = typeof event.params.content === 'string' ? event.params.content : '';
  updateInfoBoardOverlayPlacement(renderContext?.camera ?? null);

  const contentAssetId = event.params.contentAssetId?.trim() ?? '';
  if (contentAssetId.length) {
    infoBoardOverlayLoading.value = true;
    try {
      const loadedText = await loadTextAssetContent(contentAssetId);
      if (generation === infoBoardOverlayGeneration && infoBoardOverlayVisible.value) {
        if (typeof loadedText === 'string' && loadedText.length) {
          infoBoardOverlayContent.value = loadedText;
        }
      }
    } catch (error) {
      console.warn('加载信息板文本失败', error);
    } finally {
      if (generation === infoBoardOverlayGeneration) {
        infoBoardOverlayLoading.value = false;
      }
    }
  }

  const audioAssetId = event.params.audioAssetId?.trim() ?? '';
  if (audioAssetId.length) {
    void playInfoBoardAudio(audioAssetId, generation);
  }
}

function hideInfoBoard(): void {
  resetInfoBoardOverlay();
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

const dismissBehaviorBubble = behaviorBubble.dismiss;
const presentBehaviorBubble = behaviorBubble.present;

function resolveBehaviorBubbleAnchorNodeId(event: Extract<BehaviorRuntimeEvent, { type: 'show-bubble' }>): string | null {
  const targetNodeId = event.params.targetNodeId?.trim();
  return targetNodeId || event.nodeId || null;
}

function resolveBehaviorBubbleAnchorObject(event: Extract<BehaviorRuntimeEvent, { type: 'show-bubble' }>): THREE.Object3D | null {
  const targetNodeId = resolveBehaviorBubbleAnchorNodeId(event);
  if (targetNodeId) {
    return nodeObjectMap.get(targetNodeId) ?? null;
  }
  return nodeObjectMap.get(event.nodeId) ?? null;
}

function canPresentBehaviorBubble(event: Extract<BehaviorRuntimeEvent, { type: 'show-bubble' }>): boolean {
  const activeCamera = renderContext?.camera;
  if (!activeCamera) {
    return false;
  }
  const object = resolveBehaviorBubbleAnchorObject(event);
  if (!object) {
    return event.params.anchorMode !== 'nodeAnchored'
      && event.params.requireVisibleInView === false
      && (event.params.maxDistanceMeters ?? 0) <= 0;
  }
  const anchor = resolveSignboardAnchorWorldPosition(
    object,
    behaviorBubbleAnchorScratch,
    event.params.worldOffsetY,
  );
  activeCamera.getWorldPosition(behaviorBubbleCameraScratch);
  const distanceReferenceWorld = resolveOverlayDistanceReferenceWorld(
    resolveBehaviorBubbleAnchorNodeId(event),
    anchor,
    {
      position: behaviorBubbleCameraScratch,
      nodeId: resolveOverlayDistanceReferenceNodeId(),
    },
  );
  const maxDistance = Math.max(0, event.params.maxDistanceMeters ?? 0);
  if (maxDistance > 0 && distanceReferenceWorld.distanceTo(anchor) > maxDistance) {
    return false;
  }
  if (event.params.requireVisibleInView === false) {
    return true;
  }
  if (!isRuntimeObjectEffectivelyVisible(object)) {
    return false;
  }
  const placement = computeSignboardPlacement({
    anchorWorld: anchor,
    referenceWorld: distanceReferenceWorld,
    camera: activeCamera,
    maxDistance: maxDistance > 0 ? maxDistance : undefined,
  });
  if (!placement) {
    return false;
  }
  if (event.params.anchorMode === 'nodeAnchored') {
    behaviorBubbleAnchorXPercent.value = placement.xPercent;
    behaviorBubbleAnchorYPercent.value = placement.yPercent;
  }
  return true;
}

const presentBehaviorAlert = behaviorAlert.present;
const confirmBehaviorAlert = behaviorAlert.confirm;
const cancelBehaviorAlert = behaviorAlert.cancel;

function rebuildPreviewNodeMap(document: SceneJsonExportDocument | null | undefined) {
  assetNodeIdMap.clear();
  rebuildSceneNodeIndex(document?.nodes ?? null, previewNodeMap, previewParentMap);
  signboardNodeIds.clear();
  punchNodeIds.clear();
  punchTotalCount.value = 0;
  resetSignboardOverlaySmoothing();
  resetPunchOverlaySmoothing();

  if (Array.isArray(document?.punchPoints)) {
    document.punchPoints.forEach((point) => {
      const nodeId = typeof point?.nodeId === 'string' ? point.nodeId.trim() : '';
      if (nodeId) {
        punchNodeIds.add(nodeId);
      }
    });
  }

  for (const [nodeId, node] of previewNodeMap.entries()) {
    const signboardState = node.components?.[SIGNBOARD_COMPONENT_TYPE] as SceneNodeComponentState<SignboardComponentProps> | undefined;
    if (signboardState?.enabled) {
      signboardNodeIds.add(nodeId);
    }

    try {
      const behaviorActions = listRegisteredBehaviorActions(nodeId) as string[];
      if (Array.isArray(behaviorActions) && behaviorActions.includes('punch')) {
        punchNodeIds.add(nodeId);
      }
    } catch {
      // keep scanning other nodes when the behavior registry is unavailable
    }

    if (isWeChatMiniProgram && node.nodeType === 'Light' && node.light) {
      if (node.light.type === 'Point') {
        node.light.castShadow = false;
      }
      if (node.light.shadow?.mapSize && node.light.shadow.mapSize > WECHAT_SHADOW_MAX_MAP_SIZE) {
        node.light.shadow.mapSize = WECHAT_SHADOW_MAX_MAP_SIZE;
      }
    }

    if (typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length) {
      const assetId = node.sourceAssetId.trim();
      let bucket = assetNodeIdMap.get(assetId);
      if (!bucket) {
        bucket = new Set<string>();
        assetNodeIdMap.set(assetId, bucket);
      }
      bucket.add(node.id);
    }
  }
  punchTotalCount.value = punchNodeIds.size;
  punchSceneRevision.value += 1;
  syncStoredPunchedNodeIdsForScene(currentSceneId.value ?? document?.id ?? null);
}

function resolveParentNodeId(nodeId: string): string | null {
  return resolveSceneParentNodeId(previewParentMap, nodeId);
}

function resolveCameraDistanceReferenceNodeId(): string | null {
  return protagonistNodeId ?? resolveNodeIdFromObject(findProtagonistObject());
}

function resolveNodePlaneAnchorPoint(nodeId: string | null): THREE.Vector3 | null {
  return resolveNodeAnchorPoint(nodeId) ?? resolveNodeFocusPoint(nodeId);
}

function resolveOverlayDistanceReferenceNodeId(): string | null {
  if (vehicleDriveActive.value && vehicleDriveNodeId.value) {
    return vehicleDriveNodeId.value;
  }
  if (autoTourFollowNodeId.value) {
    return autoTourFollowNodeId.value;
  }
  return resolveCameraDistanceReferenceNodeId();
}

function resolveOverlayDistanceReferenceWorld(
  targetNodeId: string | null,
  anchorWorld: THREE.Vector3,
  reference: { position: THREE.Vector3; nodeId: string | null },
): THREE.Vector3 {
  const targetPlaneAnchor = resolveNodePlaneAnchorPoint(targetNodeId);
  if (!targetPlaneAnchor) {
    return reference.position;
  }
  overlayDistanceTargetAnchorScratch.copy(targetPlaneAnchor);
  const referencePlaneAnchor = reference.nodeId ? resolveNodePlaneAnchorPoint(reference.nodeId) : null;
  const comparableReference = referencePlaneAnchor
    ? overlayDistanceReferenceAnchorScratch.copy(referencePlaneAnchor)
    : overlayDistanceReferenceAnchorScratch.copy(reference.position);
  if (Math.abs(overlayDistanceTargetAnchorScratch.y - comparableReference.y) > OVERLAY_HORIZONTAL_DISTANCE_Y_EPSILON) {
    return reference.position;
  }
  overlayDistanceReferenceScratch.copy(reference.position);
  overlayDistanceReferenceScratch.y = anchorWorld.y;
  return overlayDistanceReferenceScratch;
}

function resolveSignboardReference(activeCamera: THREE.Camera): { position: THREE.Vector3; kind: 'camera' | 'vehicle'; nodeId: string | null } | null {
  const manualDriveNode = vehicleDriveActive.value ? vehicleDriveNodeId.value : null;
  if (manualDriveNode) {
    if (resolveVehicleOrObjectWorldPosition({
      nodeId: manualDriveNode,
      vehicleInstances,
      nodeObjectMap,
      isPhysicsEnabled: () => physicsEnvironmentEnabled.value,
      target: signboardReferenceScratch,
    })) {
      return { position: signboardReferenceScratch, kind: 'vehicle', nodeId: manualDriveNode };
    }
  }

  const followNodeId = autoTourFollowNodeId.value;
  if (followNodeId) {
    if (resolveVehicleOrObjectWorldPosition({
      nodeId: followNodeId,
      vehicleInstances,
      nodeObjectMap,
      isPhysicsEnabled: () => physicsEnvironmentEnabled.value,
      target: signboardReferenceScratch,
    })) {
      return { position: signboardReferenceScratch, kind: 'vehicle', nodeId: followNodeId };
    }
  }

  activeCamera.getWorldPosition(signboardReferenceScratch);
  return { position: signboardReferenceScratch, kind: 'camera', nodeId: resolveCameraDistanceReferenceNodeId() };
}

function updateSignboardOverlayEntries(activeCamera: THREE.Camera, deltaSeconds: number): void {
  if (!signboardNodeIds.size && !punchNodeIds.size) {
    if (signboardOverlayEntries.value.length) {
      signboardOverlayEntries.value = [];
    }
    if (punchBadgeOverlayEntries.value.length) {
      punchBadgeOverlayEntries.value = [];
    }
    resetSignboardOverlaySmoothing();
    resetPunchOverlaySmoothing();
    return;
  }

  const reference = resolveSignboardReference(activeCamera);
  if (!reference) {
    signboardOverlayEntries.value = [];
    punchBadgeOverlayEntries.value = [];
    resetSignboardOverlaySmoothing();
    resetPunchOverlaySmoothing();
    return;
  }

  const smoothedReferencePosition = smoothSignboardReference(signboardReferenceSmoothingState, {
    targetWorld: reference.position,
    deltaSeconds,
    kind: reference.kind,
    nodeId: reference.nodeId,
    speed: SIGNBOARD_REFERENCE_SMOOTH_SPEED,
  });
  const smoothedReference = {
    position: smoothedReferencePosition,
    kind: reference.kind,
    nodeId: reference.nodeId,
  };

  const nextEntries: Array<{
    id: string;
    label: string;
    distanceLabel: string;
    xPercent: number;
    yPercent: number;
    scale: number;
    opacity: number;
    referenceKind: 'camera' | 'vehicle';
    showPunchBadge: boolean;
  }> = [];
  const nextPunchBadgeEntries: Array<{
    id: string;
    xPercent: number;
    yPercent: number;
    scale: number;
    opacity: number;
    referenceKind: 'camera' | 'vehicle';
  }> = [];
  const activePlacementNodeIds = new Set<string>();
  const activePunchBadgeNodeIds = new Set<string>();

  for (const nodeId of signboardNodeIds) {
    const node = resolveNodeById(nodeId);
    const object = nodeObjectMap.get(nodeId) ?? null;
    if (!node || !object || !isRuntimeObjectEffectivelyVisible(object)) {
      continue;
    }

    const signboardState = node.components?.[SIGNBOARD_COMPONENT_TYPE] as SceneNodeComponentState<SignboardComponentProps> | undefined;
    if (!signboardState?.enabled) {
      continue;
    }

    const label = resolveSignboardDisplayLabel(signboardState.props?.label, node.name, nodeId);
    if (!label) {
      continue;
    }

    const isPunched = punchedNodeIds.value.has(nodeId) && punchNodeIds.has(nodeId);

    resolveSignboardAnchorWorldPosition(object, signboardAnchorScratch);
    const distanceReferenceWorld = resolveOverlayDistanceReferenceWorld(nodeId, signboardAnchorScratch, smoothedReference);
    const placement = computeSignboardPlacement({
      anchorWorld: signboardAnchorScratch,
      referenceWorld: distanceReferenceWorld,
      camera: activeCamera,
      closeFadeDistance: SIGNBOARD_NEAR_FADE_DISTANCE,
      minScreenYPercent: SIGNBOARD_MIN_VISIBLE_Y_PERCENT,
    });
    if (!placement) {
      signboardPlacementSmoothingStates.delete(nodeId);
      continue;
    }

    const placementState = signboardPlacementSmoothingStates.get(nodeId) ?? createSignboardPlacementSmoothingState();
    signboardPlacementSmoothingStates.set(nodeId, placementState);
    const smoothedPlacement = smoothSignboardPlacement(placementState, {
      placement,
      deltaSeconds,
      speed: SIGNBOARD_PLACEMENT_SMOOTH_SPEED,
    });
    activePlacementNodeIds.add(nodeId);

    nextEntries.push({
      id: nodeId,
      label,
      distanceLabel: smoothedPlacement.distanceLabel,
      xPercent: smoothedPlacement.xPercent,
      yPercent: smoothedPlacement.yPercent,
      scale: smoothedPlacement.scale,
      opacity: smoothedPlacement.opacity,
      referenceKind: reference.kind,
      showPunchBadge: isPunched,
    });
  }

  for (const nodeId of punchNodeIds) {
    if (signboardNodeIds.has(nodeId) || !punchedNodeIds.value.has(nodeId)) {
      continue;
    }

    const node = resolveNodeById(nodeId);
    const object = nodeObjectMap.get(nodeId) ?? null;
    if (!node || !object || !isRuntimeObjectEffectivelyVisible(object)) {
      continue;
    }

    const signboardState = node.components?.[SIGNBOARD_COMPONENT_TYPE] as SceneNodeComponentState<SignboardComponentProps> | undefined;
    if (signboardState?.enabled) {
      continue;
    }

    resolveSignboardAnchorWorldPosition(object, signboardAnchorScratch);
    const distanceReferenceWorld = resolveOverlayDistanceReferenceWorld(nodeId, signboardAnchorScratch, smoothedReference);
    const placement = computeSignboardPlacement({
      anchorWorld: signboardAnchorScratch,
      referenceWorld: distanceReferenceWorld,
      camera: activeCamera,
      closeFadeDistance: SIGNBOARD_NEAR_FADE_DISTANCE,
      minScreenYPercent: SIGNBOARD_MIN_VISIBLE_Y_PERCENT,
    });
    if (!placement) {
      punchBadgePlacementSmoothingStates.delete(nodeId);
      continue;
    }

    const placementState = punchBadgePlacementSmoothingStates.get(nodeId) ?? createSignboardPlacementSmoothingState();
    punchBadgePlacementSmoothingStates.set(nodeId, placementState);
    const smoothedPlacement = smoothSignboardPlacement(placementState, {
      placement,
      deltaSeconds,
      speed: SIGNBOARD_PLACEMENT_SMOOTH_SPEED,
    });
    activePunchBadgeNodeIds.add(nodeId);
    nextPunchBadgeEntries.push({
      id: nodeId,
      xPercent: smoothedPlacement.xPercent,
      yPercent: smoothedPlacement.yPercent,
      scale: smoothedPlacement.scale,
      opacity: smoothedPlacement.opacity,
      referenceKind: reference.kind,
    });
  }

  for (const nodeId of signboardPlacementSmoothingStates.keys()) {
    if (!activePlacementNodeIds.has(nodeId)) {
      signboardPlacementSmoothingStates.delete(nodeId);
    }
  }

  for (const nodeId of punchBadgePlacementSmoothingStates.keys()) {
    if (!activePunchBadgeNodeIds.has(nodeId)) {
      punchBadgePlacementSmoothingStates.delete(nodeId);
    }
  }

  signboardOverlayEntries.value = nextEntries;
  punchBadgeOverlayEntries.value = nextPunchBadgeEntries;
}

function resolveClickBehaviorAncestorNodeId(nodeId: string | null): string | null {
  let currentId: string | null = nodeId;
  while (currentId) {
    try {
      const actions = listRegisteredBehaviorActions(currentId);
      if (actions.includes('click')) {
        return currentId;
      }
    } catch (e) {
      // ignore and continue searching
    }
    currentId = resolveParentNodeId(currentId);
  }
  return null;
}

function collectMultiuserNodeIds(nodes: SceneNode[] | undefined | null, collector: Set<string>): void {
  if (!Array.isArray(nodes)) {
    return;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.components?.[ONLINE_COMPONENT_TYPE]) {
      collector.add(node.id);
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
}

function refreshMultiuserNodeReferences(document: SceneJsonExportDocument | null): void {
  multiuserNodeIds.clear();
  multiuserNodeObjects.clear();
  if (!document) {
    return;
  }
  collectMultiuserNodeIds(document.nodes, multiuserNodeIds);
  multiuserNodeIds.forEach((nodeId) => {
    const object = nodeObjectMap.get(nodeId);
    if (object) {
      multiuserNodeObjects.set(nodeId, object);
    }
  });
}

function resolveNodeById(nodeId: string): SceneNode | null {
  return resolveSceneNodeById(previewNodeMap, nodeId);
}

function normalizeSteerIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resetAppliedDefaultSteerDriveKey(): void {
  appliedDefaultSteerDriveKey = null;
}

function applyDefaultSteerDriveForCurrentScene(): void {
  const document = currentDocument;
  const identifier = normalizeSteerIdentifier(props.defaultSteerIdentifier);
  const defaultEntry = !identifier && document
    ? findDefaultSteerResolvedEntry(document.nodes)
    : null;
  if (!document || (!identifier && !defaultEntry) || !renderContext) {
    if (!identifier) {
      resetAppliedDefaultSteerDriveKey();
    }
    return;
  }
  const entry = identifier
    ? (buildSteerResolvedEntryMap(document.nodes).get(identifier)?.[0] ?? null)
    : defaultEntry;
  const sourceKey = identifier || (defaultEntry ? `entry:${defaultEntry.id}` : '');
  const attemptKey = `${document.id ?? ''}:${sourceKey}:${entry?.targetNode.id ?? '__missing__'}`;
  if (appliedDefaultSteerDriveKey === attemptKey) {
    return;
  }
  appliedDefaultSteerDriveKey = attemptKey;
  if (!entry) {
    return;
  }
  const result = vehicleDriveController.startDrive(
    {
      nodeId: entry.targetNode.id,
      targetNodeId: entry.targetNode.id,
    },
    {
      camera: renderContext.camera,
      mapControls: renderContext.controls,
    },
  );
  if (!result.success) {
    return;
  }
  vehicleDriveCameraFollowState.initialized = false;
  purposeActiveMode.value = 'watch';
  updateVehicleDriveCamera(0, { immediate: true });
}

function findGroundNode(nodes: SceneNode[] | undefined | null): SceneNode | null {
  if (!Array.isArray(nodes)) {
    return null;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (isGroundDynamicMesh(node.dynamicMesh)) {
      return node;
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return null;
}

function refreshDynamicGroundCache(document: SceneJsonExportDocument | null): void {
  groundSurfacePreviewLoadToken += 1;
  if (!document) {
    dynamicGroundCache = null;
    return;
  }
  const groundNode = findGroundNode(document.nodes);
  if (groundNode && isGroundDynamicMesh(groundNode.dynamicMesh)) {
    dynamicGroundCache = {
      nodeId: groundNode.id,
      node: groundNode,
      dynamicMesh: groundNode.dynamicMesh as GroundRuntimeDynamicMesh,
    };
  } else {
    dynamicGroundCache = null;
  }
  if (currentDocument?.id === document?.id) {
    void applyEnvironmentSettingsToScene(resolveDocumentEnvironment(document));
  }
}

function resolveGroundViewportWorldSize(): { width: number; depth: number } | null {
  const document = currentDocument;
  if (!document) {
    return null;
  }
  const groundNode = dynamicGroundCache?.node ?? findGroundNode(document.nodes);
  const dynamicMesh = groundNode && isGroundDynamicMesh(groundNode.dynamicMesh)
    ? groundNode.dynamicMesh
    : null;
  const baseWidth = Number.isFinite(dynamicMesh?.width)
    ? Math.max(0, Number(dynamicMesh?.width))
    : Math.max(0, Number(document.groundSettings?.width ?? 0));
  const baseDepth = Number.isFinite(dynamicMesh?.depth)
    ? Math.max(0, Number(dynamicMesh?.depth))
    : Math.max(0, Number(document.groundSettings?.depth ?? 0));
  if (baseWidth <= 0 || baseDepth <= 0) {
    return null;
  }
  let scaleX = 1;
  let scaleZ = 1;
  const groundObject = groundNode ? nodeObjectMap.get(groundNode.id) ?? null : null;
  if (groundObject) {
    groundObject.updateMatrixWorld(true);
    groundObject.getWorldScale(groundFogScaleHelper);
    scaleX = Math.abs(groundFogScaleHelper.x) || 1;
    scaleZ = Math.abs(groundFogScaleHelper.z) || 1;
  } else if (groundNode?.scale) {
    scaleX = Math.abs(Number(groundNode.scale.x) || 1);
    scaleZ = Math.abs(Number(groundNode.scale.z) || 1);
  }
  return {
    width: baseWidth * scaleX,
    depth: baseDepth * scaleZ,
  };
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
    const rawLayout = (node as unknown as { instanceLayout?: unknown }).instanceLayout;
    const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : null;
    const resolvedAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId ?? null);
    if (resolvedAssetId) {
      if (!map.has(resolvedAssetId)) {
        map.set(resolvedAssetId, []);
      }
      map.get(resolvedAssetId)!.push(node);
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
  const rawLayout = (node as unknown as { instanceLayout?: unknown }).instanceLayout;
  const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : { mode: 'single' as const, templateAssetId: null };
  const resolvedAssetId = resolveInstanceLayoutTemplateAssetId(layout, node.sourceAssetId ?? null);
  if (!resolvedAssetId || resolvedAssetId !== group.assetId) {
    return null;
  }

  releaseModelInstance(node.id);
  clearInstancedTransformCacheForNode(node.id);
  const desiredCount = getInstanceLayoutCount(layout);
  const baseBinding = allocateModelInstance(group.assetId, node.id);
  if (!baseBinding) {
    return null;
  }
  for (let i = 1; i < desiredCount; i += 1) {
    const bindingId = getInstanceLayoutBindingId(node.id, i);
    const binding = allocateModelInstanceBinding(group.assetId, bindingId, node.id);
    if (!binding) {
      releaseModelInstance(node.id);
      return null;
    }
  }
  const proxy = new THREE.Object3D();
  proxy.name = node.name ?? group.object.name ?? 'Instanced Model';
  const layoutBounds = computeInstanceLayoutLocalBoundingBox(layout, group.boundingBox) ?? group.boundingBox;
  proxy.userData = {
    ...(proxy.userData ?? {}),
    nodeId: node.id,
    instanced: true,
    instancedAssetId: group.assetId,
    instancedBounds: serializeBoundingBox(layoutBounds),
    __harmonyInstancedRadius: group.radius,
    __harmonyInstanceLayoutSignature: null,
    __harmonyInstanceLayoutLocals: [] as THREE.Matrix4[],
  };
  updateNodeTransfrom(proxy, node);
  return proxy;
}

const pendingLodModelLoads = new Map<string, Promise<void>>();

async function ensureModelObjectCached(assetId: string, sampleNode: SceneNode | null): Promise<void> {
  if (!assetId) {
    return;
  }
  if (getCachedModelObject(assetId)) {
    ensureInstancedMeshesRegistered(assetId);
    return;
  }
  if (pendingLodModelLoads.has(assetId)) {
    await pendingLodModelLoads.get(assetId);
    return;
  }
  const task = (async () => {
    const cache = viewerResourceCache;
    if (!cache) {
      return;
    }
    await ensureModelInstanceGroup(assetId, sampleNode, cache);
    ensureInstancedMeshesRegistered(assetId);
  })()
    .catch((error) => {
      console.warn('[SceneViewer] Failed to preload LOD model asset', assetId, error);
    })
    .finally(() => {
      pendingLodModelLoads.delete(assetId);
    });

  pendingLodModelLoads.set(assetId, task);
  await task;
}


// Enhanced: support both model and billboard LOD targets
function resolveDesiredLodTarget(
  node: SceneNode,
  object: THREE.Object3D,
  camera: THREE.Camera
): { kind: 'model', assetId: string, faceCamera: boolean } | { kind: 'billboard', imageAssetId: string, width: number, height: number, faceCamera: boolean } | null {
  const baseAssetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId : null;
  const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined;
  if (!component || !component.enabled) {
    return baseAssetId ? { kind: 'model', assetId: baseAssetId, faceCamera: false } : null;
  }
  const props = clampLodComponentProps(component.props);
  const levels = props.levels;
  if (!levels.length) {
    return baseAssetId ? { kind: 'model', assetId: baseAssetId, faceCamera: false } : null;
  }
  object.getWorldPosition(instancedCullingWorldPosition);
  const distance = instancedCullingWorldPosition.distanceTo(camera.position);
  let chosen: (typeof levels)[number] | null = null;
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    const candidate = levels[i];
    if (candidate && distance >= candidate.distance) {
      chosen = candidate;
      break;
    }
  }
  if (!chosen) {
    return baseAssetId ? { kind: 'model', assetId: baseAssetId, faceCamera: false } : null;
  }
  if (chosen.kind === 'billboard' && chosen.billboardAssetId) {
    // Billboard: use node's bounding box for size if available, fallback to 1x1
    let width = 1, height = 1;
    const bounds = object.userData?.instancedBounds;
    if (bounds && bounds.min && bounds.max) {
      width = Math.abs(bounds.max[0] - bounds.min[0]);
      height = Math.abs(bounds.max[1] - bounds.min[1]);
    }
    return { kind: 'billboard', imageAssetId: chosen.billboardAssetId, width, height, faceCamera: chosen.faceCamera === true };
  }
  const id = chosen && typeof chosen.modelAssetId === 'string' ? chosen.modelAssetId.trim() : '';
  return id ? { kind: 'model', assetId: id, faceCamera: chosen.faceCamera === true } : (baseAssetId ? { kind: 'model', assetId: baseAssetId, faceCamera: false } : null);
}

function applyModelFaceCameraMatrix(camera: THREE.Camera | null | undefined, matrix: THREE.Matrix4): void {
  if (!camera) {
    return;
  }
  matrix.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper);
  instancedFacingDirectionHelper.copy(camera.position).sub(instancedPositionHelper);
  instancedFacingDirectionHelper.y = 0;
  if (instancedFacingDirectionHelper.lengthSq() <= 1e-6) {
    return;
  }
  instancedFacingDirectionHelper.normalize();
  instancedFacingQuaternionHelper.setFromUnitVectors(instancedFacingAxisHelper, instancedFacingDirectionHelper);
  matrix.compose(instancedPositionHelper, instancedFacingQuaternionHelper, instancedScaleHelper);
}


// Enhanced: support both model and billboard LOD targets
function applyInstancedLodSwitch(nodeId: string, object: THREE.Object3D, target: ReturnType<typeof resolveDesiredLodTarget>): void {
  if (!target) return;
  if (target.kind === 'model') {
    const assetId = target.assetId;
    const cached = getCachedModelObject(assetId);
    if (!cached) {
      const node = resolveNodeById(nodeId);
      void ensureModelObjectCached(assetId, node);
      return;
    }
    const node = resolveNodeById(nodeId);
    const rawLayout = (node as unknown as { instanceLayout?: unknown } | null)?.instanceLayout;
    const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : { mode: 'single' as const, templateAssetId: null };
    const desiredCount = getInstanceLayoutCount(layout);

    releaseModelInstance(nodeId);
    clearInstancedTransformCacheForNode(nodeId);
    const baseBinding = allocateModelInstance(assetId, nodeId);
    if (!baseBinding) {
      return;
    }
    for (let i = 1; i < desiredCount; i += 1) {
      const bindingId = getInstanceLayoutBindingId(nodeId, i);
      const binding = allocateModelInstanceBinding(assetId, bindingId, nodeId);
      if (!binding) {
        releaseModelInstance(nodeId);
        return;
      }
    }
    const layoutBounds = computeInstanceLayoutLocalBoundingBox(layout, cached.boundingBox) ?? cached.boundingBox;
    const sphere = new THREE.Sphere();
    layoutBounds.getBoundingSphere(sphere);
    object.userData = {
      ...(object.userData ?? {}),
      instancedAssetId: assetId,
      __harmonyLodFaceCamera: target.faceCamera === true,
      instancedBounds: serializeBoundingBox(layoutBounds),
      __harmonyInstancedRadius: sphere.radius,
    };
    syncInstancedTransform(object, true);
    return;
  } else if (target.kind === 'billboard') {
    // Billboard: use billboard instancing system
    releaseModelInstance(nodeId);
    clearInstancedTransformCacheForNode(nodeId);
    const node = resolveNodeById(nodeId);
    const rawLayout = (node as unknown as { instanceLayout?: unknown } | null)?.instanceLayout;
    const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : { mode: 'single' as const, templateAssetId: null };
    const desiredCount = getInstanceLayoutCount(layout);
    const baseBinding = allocateBillboardInstance(target.imageAssetId, nodeId);
    if (!baseBinding) {
      return;
    }
    for (let i = 1; i < desiredCount; i += 1) {
      const bindingId = getInstanceLayoutBindingId(nodeId, i);
      const binding = allocateBillboardInstanceBinding(target.imageAssetId, bindingId, nodeId);
      if (!binding) {
        releaseBillboardInstance(nodeId);
        return;
      }
    }
    object.userData = {
      ...(object.userData ?? {}),
      instancedAssetId: target.imageAssetId,
      billboardImageAssetId: target.imageAssetId,
      billboardWidth: target.width,
      billboardHeight: target.height,
      instancedRenderKind: 'billboard',
      __harmonyLodFaceCamera: target.faceCamera === true,
    };
    syncInstancedTransform(object, true);
    return;
  }
}

function resolveInstancedProxyRadius(object: THREE.Object3D): number {
  const cached = object.userData?.__harmonyInstancedRadius as number | undefined;
  if (Number.isFinite(cached) && (cached as number) > 0) {
    return cached as number;
  }
  const bounds = object.userData?.instancedBounds as { min?: [number, number, number]; max?: [number, number, number] } | undefined;
  if (bounds?.min && bounds?.max) {
    instancedCullingBox.min.set(bounds.min[0] ?? 0, bounds.min[1] ?? 0, bounds.min[2] ?? 0);
    instancedCullingBox.max.set(bounds.max[0] ?? 0, bounds.max[1] ?? 0, bounds.max[2] ?? 0);
    if (!instancedCullingBox.isEmpty()) {
      instancedCullingBox.getBoundingSphere(instancedCullingSphere);
      const radius = instancedCullingSphere.radius;
      if (Number.isFinite(radius) && radius > 0) {
        object.userData.__harmonyInstancedRadius = radius;
        return radius;
      }
    }
  }
  object.userData.__harmonyInstancedRadius = 0.5;
  return 0.5;
}


// Enhanced: support both model and billboard LOD targets
function updateInstancedCullingAndLod(): void {
  const context = renderContext;
  if (!context) {
    return;
  }
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  const camera = context.camera;
  camera.updateMatrixWorld(true);
  instancedCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  instancedCullingFrustum.setFromProjectionMatrix(instancedCullingProjView);

  const lodNodeIds: string[] = [];
  const lodObjects = new Map<string, THREE.Object3D>();
  const cullingCandidateIds: string[] = [];
  const cullingCandidateObjects = new Map<string, THREE.Object3D>();
  nodeObjectMap.forEach((object, nodeId) => {
    // Accept both instancedAssetId (model) and billboardImageAssetId (billboard)
    if (!object?.userData?.instancedAssetId && !object?.userData?.billboardImageAssetId) {
      return;
    }
    const node = resolveNodeById(nodeId);
    if (!node) {
      return;
    }
    const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined;
    if (!component || !component.enabled) {
      return;
    }
    lodNodeIds.push(nodeId);
    lodObjects.set(nodeId, object);
    const props = clampLodComponentProps(component.props);
    if (props.enableCulling === false) {
      return;
    }
    cullingCandidateIds.push(nodeId);
    cullingCandidateObjects.set(nodeId, object);
  });

  cullingCandidateIds.sort();
  instancedLodFrustumCuller.setIds(cullingCandidateIds);
  const visibleIds = instancedLodFrustumCuller.updateAndQueryVisible(instancedCullingFrustum, (id, centerTarget) => {
    const object = cullingCandidateObjects.get(id);
    if (!object) {
      return null;
    }
    object.updateMatrixWorld(true);
    resolveInstancedProxyWorldCenter(object, centerTarget);
    object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper);
    const scale = Math.max(instancedScaleHelper.x, instancedScaleHelper.y, instancedScaleHelper.z);
    const baseRadius = resolveInstancedProxyRadius(object);
    const radius = Number.isFinite(scale) && scale > 0 ? baseRadius * scale : baseRadius;
    return { radius };
  // 保守中心点推导，与 editor 端一致
  function resolveInstancedProxyWorldCenter(object: THREE.Object3D, target: THREE.Vector3) {
    const bounds = object.userData?.instancedBounds;
    if (bounds?.min && bounds?.max) {
      instancedCullingBox.min.set(bounds.min[0] ?? 0, bounds.min[1] ?? 0, bounds.min[2] ?? 0);
      instancedCullingBox.max.set(bounds.max[0] ?? 0, bounds.max[1] ?? 0, bounds.max[2] ?? 0);
      instancedCullingBox.getCenter(target);
      return target.applyMatrix4(object.matrixWorld);
    }
    object.getWorldPosition(target);
    return target;
  }
  });

  let lodVisibleCount = 0;
  lodNodeIds.forEach((nodeId) => {
    const object = lodObjects.get(nodeId);
    if (!object) {
      return;
    }
    const node = resolveNodeById(nodeId);
    if (!node) {
      return;
    }
    const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined;
    if (!component || !component.enabled) {
      return;
    }
    const props = clampLodComponentProps(component.props);
    const cullingEnabled = props.enableCulling !== false;
    const isVisible = !cullingEnabled || visibleIds.has(nodeId);
    if (cullingEnabled && !isVisible) {
      const lastSeen = instancedCullingLastVisibleAt.get(nodeId) ?? 0;
      if (INSTANCED_CULL_GRACE_MS > 0 && now - lastSeen < INSTANCED_CULL_GRACE_MS) {
        return;
      }
      releaseModelInstance(nodeId);
      // Also release billboard instance if present
      if (object.userData?.billboardImageAssetId) {
        releaseBillboardInstance(nodeId);
      }
      return;
    }

    lodVisibleCount += 1;
    if (cullingEnabled) {
      instancedCullingLastVisibleAt.set(nodeId, now);
    }
    const desiredTarget = resolveDesiredLodTarget(node, object, camera);
    if (!desiredTarget) {
      return;
    }
    // Switch logic: if current is model, check instancedAssetId; if billboard, check billboardImageAssetId
    if (desiredTarget.kind === 'model') {
      const currentAssetId = object.userData?.instancedAssetId as string | undefined;
      if (currentAssetId !== desiredTarget.assetId) {
        applyInstancedLodSwitch(nodeId, object, desiredTarget);
        return;
      }
      object.userData.__harmonyLodFaceCamera = desiredTarget.faceCamera === true;
      const existingBinding = getModelInstanceBinding(nodeId);
      const shouldForceUpload = !existingBinding || existingBinding.assetId !== desiredTarget.assetId;
      const binding = allocateModelInstance(desiredTarget.assetId, nodeId);
      if (!binding) {
        void ensureModelObjectCached(desiredTarget.assetId, node);
        return;
      }
      syncInstancedTransform(object, shouldForceUpload);
    } else if (desiredTarget.kind === 'billboard') {
      const currentImageAssetId = object.userData?.billboardImageAssetId as string | undefined;
      if (currentImageAssetId !== desiredTarget.imageAssetId) {
        applyInstancedLodSwitch(nodeId, object, desiredTarget);
        return;
      }
      object.userData.__harmonyLodFaceCamera = desiredTarget.faceCamera === true;
      // Billboard instance already allocated; update transform if needed
      syncInstancedTransform(object, true);
    }
  });

  if (debugEnabled.value && debugMode.value === 'full') {
    syncInstancingDebugCounters(lodNodeIds.length, lodVisibleCount, instancedMeshes, terrainScatterRuntime);
  }
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
    const lazyData = object.userData?.lazyAsset as LazyAssetMetadata;
    const objectIsPlaceholder = lazyData?.placeholder === true;
    const parent = object.parent ?? null;
    const index = parent ? parent.children.indexOf(object) : root.children.indexOf(object);

    const existing = sceneObjects.get(nodeId) ?? null;
    if (existing) {
      const existingLazyData = existing.object.userData?.lazyAsset as LazyAssetMetadata;
      const existingIsPlaceholder = existingLazyData?.placeholder === true;
      // 关键：lazyLoadMeshes=true 时，某些节点会同时在“容器(Group)”和“占位 Mesh”上携带相同 nodeId。
      // 若错误地把占位 Mesh 当成节点本体进行替换，会导致 proxy 的 transform 在父容器 transform 基础上再次应用（坐标被叠加）。
      // 因此这里优先保留非-placeholder 的对象。
      if (objectIsPlaceholder && !existingIsPlaceholder) {
        return;
      }
      if (!objectIsPlaceholder && existingIsPlaceholder) {
        sceneObjects.set(nodeId, { object, parent, index });
        return;
      }
      // 同类（都 placeholder 或都非 placeholder）时，保留先遍历到的（通常层级更靠上）。
      return;
    }

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
  mesh.frustumCulled = true;
  addInstancedBoundsMesh(mesh);
  instancedMeshes.push(mesh);
  instancedMeshGroup.add(mesh);
  sceneCsmShadowRuntime?.registerObject(mesh);
}

function clearInstancedMeshes(): void {
  instancedMeshes.splice(0, instancedMeshes.length).forEach((mesh) => {
    instancedMeshGroup.remove(mesh);
  });
  // Clear shared dirty tracking
  clearInstancedBounds();
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
  terrainScatterRuntime.dispose();
  markTerrainScatterUpdateDirty();
}

async function syncTerrainScatterInstances(
  document: SceneJsonExportDocument,
  resourceCache: ResourceCache | null,
): Promise<void> {
  terrainScatterRuntime.dispose();
  markTerrainScatterUpdateDirty();
  if (!resourceCache) {
    return;
  }
  await terrainScatterRuntime.sync(document, resourceCache, resolveGroundMeshObject);
  markTerrainScatterUpdateDirty();
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
  return resolveEnabledComponentState<RigidbodyComponentProps>(node, RIGIDBODY_COMPONENT_TYPE);
}

function resolveBoundaryWallComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<Record<string, unknown>> | null {
  return resolveEnabledComponentState<Record<string, unknown>>(node, BOUNDARY_WALL_COMPONENT_TYPE);
}

function resolveModelCollisionStaticRigidbodyComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<RigidbodyComponentProps> | null {
  const props = resolveModelCollisionComponentPropsFromNode(node);
  if (!node || !props?.faces?.length) {
    return null;
  }
  return {
    id: `__modelCollisionRigidbody:${node.id}`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({
      bodyType: 'STATIC',
      targetNodeId: node.id ?? null,
    }),
  };
}

function resolvePhysicsRigidbodyComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<RigidbodyComponentProps> | null {
  const rigidbodyComponent = resolveRigidbodyComponent(node);
  if (rigidbodyComponent) {
    return rigidbodyComponent;
  }
  const modelCollisionComponent = resolveModelCollisionStaticRigidbodyComponent(node);
  if (modelCollisionComponent) {
    return modelCollisionComponent;
  }
  if (!resolveBoundaryWallComponent(node) || !node) {
    return null;
  }
  return {
    id: `__boundaryWallRigidbody:${node.id}`,
    type: RIGIDBODY_COMPONENT_TYPE,
    enabled: true,
    props: clampRigidbodyComponentProps({
      bodyType: 'STATIC',
      targetNodeId: node.id ?? null,
    }),
  };
}

function resolveVehicleComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<VehicleComponentProps> | null {
  return resolveEnabledComponentState<VehicleComponentProps>(node, VEHICLE_COMPONENT_TYPE);
}

function resolveAutoTourComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<AutoTourComponentProps> | null {
  return resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE);
}

function resolveFloatingAutoTourContext(): {
  nodeId: string | null;
  event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null;
} {
  const activeFollowNodeId = autoTourFollowNodeId.value;
  if (activeFollowNodeId && activeAutoTourNodeIds.has(activeFollowNodeId)) {
    return { nodeId: activeFollowNodeId, event: activeVehicleDriveEvent.value };
  }

  const firstActiveNodeId = activeAutoTourNodeIds.values().next().value ?? null;
  if (firstActiveNodeId) {
    return { nodeId: firstActiveNodeId, event: activeVehicleDriveEvent.value };
  }

  const candidates = [pendingVehicleDriveEvent.value, activeVehicleDriveEvent.value];
  for (const event of candidates) {
    const nodeId = event?.targetNodeId ?? event?.nodeId ?? null;
    if (!nodeId) {
      continue;
    }
    const node = resolveNodeById(nodeId);
    const autoTour = resolveAutoTourComponent(node);
    if (!autoTour?.props?.routeNodeId || !nodeObjectMap.has(nodeId)) {
      continue;
    }
    return { nodeId, event };
  }

  const nodeId = vehicleDriveNodeId.value;
  if (nodeId) {
    const node = resolveNodeById(nodeId);
    const autoTour = resolveAutoTourComponent(node);
    if (autoTour?.props?.routeNodeId && nodeObjectMap.has(nodeId)) {
      return { nodeId, event: activeVehicleDriveEvent.value };
    }
  }

  return { nodeId: null, event: null };
}

const floatingAutoTourButton = computed(() => {
  const context = resolveFloatingAutoTourContext();
  const active = context.nodeId ? activeAutoTourNodeIds.has(context.nodeId) : false;
  const busy = vehicleDrivePromptBusy.value;
  return {
    visible: Boolean(context.nodeId),
    nodeId: context.nodeId,
    event: context.event,
    active,
    busy,
    disabled: busy,
    label: active ? '结束导览' : '自动导览',
  } as const;
});

const floatingAutoTourPauseButton = computed(() => {
  const context = resolveFloatingAutoTourContext();
  const active = context.nodeId ? activeAutoTourNodeIds.has(context.nodeId) : false;
  const busy = vehicleDrivePromptBusy.value;
  return {
    visible: active,
    nodeId: context.nodeId,
    busy,
    disabled: busy,
    pressed: autoTourPaused.value,
    label: autoTourPaused.value ? '继续导览' : '暂停导览',
  } as const;
});

const autoTourVehicleInstances = createPhysicsAwareAutoTourVehicleInstances(
  vehicleInstances,
  () => physicsEnvironmentEnabled.value,
);

const autoTourRuntime = createAutoTourRuntime({
  iterNodes: () => previewNodeMap.values(),
  resolveNodeById,
  nodeObjectMap,
  vehicleInstances: autoTourVehicleInstances,
  isManualDriveActive: () => vehicleDriveActive.value,
  onNodeObjectTransformUpdated: (_nodeId, object) => {
    syncInstancedTransform(object);
  },
  requiresExplicitStart: true,
  onTerminalStop: (nodeId) => {
    autoTourPausedIsTerminal.value = true;
    autoTourPausedNodeId.value = nodeId ?? null;
    if (nodeId) {
      captureAutoTourPausedCameraSnapshot(nodeId);
    }
    autoTourPaused.value = true;
    clearAutoTourResumeBlendState();
    applyAutoTourPauseForActiveNodes();
    applyAutoTourCameraInputPolicy();
    if (nodeId) {
      reapplyAutoTourPausedCameraSnapshot(nodeId);
    }
  },
  onDockRequestedPause: (nodeId, payload) => {
    autoTourPausedIsTerminal.value = payload.terminal === true;
    autoTourPausedNodeId.value = nodeId ?? null;
    if (autoTourPaused.value) {
      return
    }
    if (nodeId) {
      captureAutoTourPausedCameraSnapshot(nodeId);
    }
    autoTourPaused.value = true
    clearAutoTourResumeBlendState()
    applyAutoTourPauseForActiveNodes()
    applyAutoTourCameraInputPolicy()
    if (nodeId) {
      reapplyAutoTourPausedCameraSnapshot(nodeId)
    }
  },
  stopNodeMotion: (nodeId) => {
    const entry = rigidbodyInstances.get(nodeId) ?? null;
    if (!entry) {
      return;
    }
    if (entry.object) {
      syncSharedBodyFromObject(entry.body, entry.object, entry.orientationAdjustment);
    }
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    trySleepBody(entry.body);
  },
});

const waterRuntime = createWaterRuntime();

function extractRigidbodyShape(
  component: SceneNodeComponentState<RigidbodyComponentProps> | null,
): RigidbodyPhysicsShape | null {
  if (!component) {
    return null;
  }
  const payload = component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined;
  return payload?.shape ?? null;
}

function attachRuntimeForNode(nodeId: string, object: THREE.Object3D) {
  const nodeState = resolveNodeById(nodeId);
  if (!nodeState) {
    return;
  }
  previewComponentManager.attachRuntime(nodeState, object);
}

function indexSceneObjects(root: THREE.Object3D) {
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

      const wallState = nodeState?.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<unknown> | undefined;
      const wallProps = wallState?.props as { isAirWall?: unknown } | undefined;
      const isAirWall = Boolean(wallState?.enabled !== false && wallProps?.isAirWall === true);
      if (isAirWall) {
        object.visible = false;
        updateBehaviorVisibility(nodeId, false);
      }
    }
  });
  sceneCsmShadowRuntime?.registerObject(root);
}

function registerSceneSubtree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const nodeId = object.userData?.nodeId as string | undefined;
    if (!nodeId) {
      return;
    }
    const existing = nodeObjectMap.get(nodeId) ?? null;
    const objectLazyData = object.userData?.lazyAsset as LazyAssetMetadata;
    const existingLazyData = existing?.userData?.lazyAsset as LazyAssetMetadata;
    const objectIsPlaceholder = objectLazyData?.placeholder === true;
    const shouldKeepExisting =
      existing && existing !== object && objectIsPlaceholder && existingLazyData?.placeholder !== true;
    if (shouldKeepExisting) {
      return;
    }

    nodeObjectMap.set(nodeId, object);
    ensureRigidbodyBindingForObject(nodeId, object);
    attachRuntimeForNode(nodeId, object);

    syncInteractionLayersForNode(nodeId, object);

    const instancedAssetId = object.userData?.instancedAssetId as string | undefined;
    if (instancedAssetId) {
      ensureInstancedMeshesRegistered(instancedAssetId);
    }
    const nodeState = resolveNodeById(nodeId);
    const guideboardVisibility = resolveGuideboardInitialVisibility(nodeState);
    if (guideboardVisibility !== null) {
      object.visible = guideboardVisibility;
      updateBehaviorVisibility(nodeId, object.visible);
    }

    const wallState = nodeState?.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<unknown> | undefined;
    const wallProps = wallState?.props as { isAirWall?: unknown } | undefined;
    const isAirWall = Boolean(wallState?.enabled !== false && wallProps?.isAirWall === true);
    if (isAirWall) {
      object.visible = false;
      updateBehaviorVisibility(nodeId, false);
    }
    if (nodeState) {
      applyMaterialOverrides(object, nodeState.materials, materialOverrideOptions);
    }
    syncInstancedTransform(object);
    if (object.userData?.protagonist) {
      syncProtagonistCameraPose({
        force: true,
        object,
        applyToCamera: purposeActiveMode.value === 'level' && !vehicleDriveActive.value,
      });
    }
  });
  sceneCsmShadowRuntime?.registerObject(root);
}

const physicsContactSettings: PhysicsContactSettings = {
  contactEquationStiffness: PHYSICS_CONTACT_STIFFNESS,
  contactEquationRelaxation: PHYSICS_CONTACT_RELAXATION,
  frictionEquationStiffness: PHYSICS_FRICTION_STIFFNESS,
  frictionEquationRelaxation: PHYSICS_FRICTION_RELAXATION,
};

function ensurePhysicsWorld(): CANNON.World {
  return ensureSharedPhysicsWorld({
    world: physicsWorld,
    setWorld: (world) => {
      physicsWorld = world;
    },
    gravity: physicsGravity,
    solverIterations: PHYSICS_SOLVER_ITERATIONS,
    solverTolerance: PHYSICS_SOLVER_TOLERANCE,
    contactFriction: physicsContactFriction,
    contactRestitution: physicsContactRestitution,
    contactSettings: physicsContactSettings,
    rigidbodyMaterialCache,
    rigidbodyContactMaterialKeys,
    // Fast approximate quaternion normalization on WeChat to save per-body CPU cost.
    quatNormalizeFast: isWeChatMiniProgram,
    quatNormalizeSkip: isWeChatMiniProgram ? 4 : 0,
  });
}

function removeAirWalls(): void {
  const world = physicsWorld;
  if (!world) {
    airWallBodies.clear();
    return;
  }
  airWallBodies.forEach((body) => {
    try {
      world.removeBody(body);
    } catch (error) {
      console.warn('[SceneViewer] Failed to remove air wall body', error);
    }
  });
  airWallBodies.clear();
}

function syncAirWallsForDocument(sceneDocument: SceneJsonExportDocument | null): void {
  removeAirWalls();
  if (!sceneDocument) {
    return;
  }
  const airWallEnabled = sceneDocument.groundSettings?.enableAirWall !== false;
  const world = physicsWorld;
  if (!world || !airWallEnabled) {
    return;
  }
  const groundNode = findGroundNode(sceneDocument.nodes);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return;
  }
  const groundObject = nodeObjectMap.get(groundNode.id) ?? null;
  const definitions = buildGroundAirWallDefinitions({ groundNode, groundObject });
  if (!definitions.length) {
    return;
  }
  definitions.forEach((definition) => {
    const [hx, hy, hz] = definition.halfExtents;
    if (![hx, hy, hz].every((value) => Number.isFinite(value) && value > 0)) {
      return;
    }
    const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
    const body = new CANNON.Body({ mass: 0 });
    body.type = CANNON.Body.STATIC;
    body.collisionFilterGroup = COLLISION_GROUP_STATIC_ENV;
    body.collisionFilterMask = COLLISION_MASK_STATIC_ENV;
    if (world.defaultMaterial) {
      body.material = world.defaultMaterial;
    }
    body.addShape(shape);
    body.position.copy(definition.bodyPosition);
    body.quaternion.set(
      definition.bodyQuaternion.x,
      definition.bodyQuaternion.y,
      definition.bodyQuaternion.z,
      definition.bodyQuaternion.w,
    );
    body.updateMassProperties();
    body.aabbNeedsUpdate = true;
    world.addBody(body);
    airWallBodies.set(definition.key, body);
  });
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
    rigidbodyInstances.forEach((instance) => removeRigidbodyInstanceBodies(world, instance));
    airWallBodies.forEach((body) => {
      try {
        world.removeBody(body);
      } catch (error) {
        console.warn('[SceneViewer] Failed to remove air wall body', error);
      }
    });
  }
  vehicleInstances.clear();
  vehicleRaycastInWorld.clear();
  rigidbodyInstances.clear();
  protagonistNodeId = null;
  scenePreviewPerf.reset();
  airWallBodies.clear();
  physicsWorld = null;
  groundHeightfieldCache.clear();
  floorShapeCache.clear();
  wallTrimeshCache.clear();
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
  deactivateJoystick(true);
  setVehicleDriveUiOverride('hide');
}

function createRigidbodyBody(
  node: SceneNode,
  component: SceneNodeComponentState<RigidbodyComponentProps>,
  shapeDefinition: RigidbodyPhysicsShape | null,
  object: THREE.Object3D,
): { body: CANNON.Body; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null {
  const world = ensurePhysicsWorld();
  return createSharedRigidbodyBody(
    { node, component, shapeDefinition, object },
    {
      world,
      groundHeightfieldCache,
      floorShapeCache,
      wallTrimeshCache,
      rigidbodyMaterialCache,
      rigidbodyContactMaterialKeys,
      contactSettings: physicsContactSettings,
      loggerTag: '[SceneViewer]',
    },
  );
}

function removeRigidbodyInstance(nodeId: string): void {
  const entry = rigidbodyInstances.get(nodeId);
  if (!entry) {
    return;
  }
  removeRigidbodyInstanceBodies(physicsWorld, entry);
  rigidbodyInstances.delete(nodeId);
  scenePreviewPerf.notifyRemovedNode(nodeId);
  if (protagonistNodeId === nodeId) {
    protagonistNodeId = null;
  }
  groundHeightfieldCache.delete(nodeId);
  floorShapeCache.delete(nodeId);
  wallTrimeshCache.delete(nodeId);
  removeVehicleInstance(nodeId);
}

function isFloorDynamicMeshForPhysics(mesh: unknown): mesh is { type: 'Floor'; thickness?: unknown } {
  const typed = mesh as { type?: unknown } | null | undefined;
  return Boolean(typed && typed.type === 'Floor');
}

function hasAutoGeneratedDynamicShape(mesh: unknown): boolean {
  if (isGroundDynamicMesh(mesh as GroundDynamicMesh | null | undefined)) {
    return true;
  }
  if (!isFloorDynamicMeshForPhysics(mesh)) {
    return false;
  }
  const rawThickness = Number(mesh.thickness);
  if (!Number.isFinite(rawThickness)) {
    return false;
  }
  return rawThickness > 0;
}

function hasAutoGeneratedDynamicShapeForNode(mesh: unknown, node: SceneNode | null | undefined): boolean {
  if (hasAutoGeneratedDynamicShape(mesh)) {
    return true;
  }
  return Boolean(resolveModelCollisionComponentPropsFromNode(node)?.faces?.length);
}

function ensureRoadRigidbodyInstance(node: SceneNode, component: SceneNodeComponentState<RigidbodyComponentProps>, object: THREE.Object3D) {
  if (!physicsWorld || !currentDocument) {
    return;
  }
  if (!isRoadDynamicMesh(node.dynamicMesh)) {
    removeRigidbodyInstance(node.id);
    return;
  }
  if ((component.props as RigidbodyComponentProps | undefined)?.bodyType !== 'STATIC') {
    removeRigidbodyInstance(node.id);
    return;
  }
  const groundNode = findGroundNode(currentDocument.nodes);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    removeRigidbodyInstance(node.id);
    return;
  }
  const world = ensurePhysicsWorld();
  const existing = rigidbodyInstances.get(node.id) ?? null;
  const result = ensureRoadHeightfieldRigidbodyInstance({
    roadNode: node,
    rigidbodyComponent: component,
    roadObject: object,
    groundNode,
    world,
    existingInstance: existing,
    createBody: (n, c, s, o) => createRigidbodyBody(n, c, s, o),
    loggerTag: '[SceneViewer]',
  });
  if (!result.instance) {
    if (result.shouldRemoveExisting) {
      removeRigidbodyInstance(node.id);
    }
    return;
  }
  rigidbodyInstances.set(node.id, result.instance);
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
): VehicleInstanceWithWheels | null {
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
  const wheelBindings: VehicleWheelBinding[] = [];
  wheelEntries.forEach(({ config, point, direction, axle }, index) => {
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
    const axis = new THREE.Vector3(axle.x, axle.y, axle.z);
    if (axis.lengthSq() < 1e-6) {
      axis.copy(defaultWheelAxisVector);
    }
    axis.normalize();
    const wheelObject = config.nodeId ? nodeObjectMap.get(config.nodeId) ?? null : null;
    const basePosition = wheelObject ? wheelObject.position.clone() : new THREE.Vector3();
    const baseScale = wheelObject ? wheelObject.scale.clone() : new THREE.Vector3(1, 1, 1);
    wheelBindings.push({
      nodeId: config.nodeId ?? null,
      object: wheelObject,
      radius: Math.max(config.radius, VEHICLE_WHEEL_MIN_RADIUS),
      axleAxis: axis,
      isFrontWheel: config.isFrontWheel === true,
      wheelIndex: index,
      spinAngle: 0,
      lastSteeringAngle: 0,
      baseQuaternion: wheelObject ? wheelObject.quaternion.clone() : new THREE.Quaternion(),
      basePosition,
      baseScale,
    });
  });
  vehicle.addToWorld(physicsWorld);
  vehicleRaycastInWorld.add(node.id);
  const initialChassisPosition = new THREE.Vector3(
    rigidbody.body.position.x,
    rigidbody.body.position.y,
    rigidbody.body.position.z,
  );
  const initialChassisQuaternion = new THREE.Quaternion(
    rigidbody.body.quaternion.x,
    rigidbody.body.quaternion.y,
    rigidbody.body.quaternion.z,
    rigidbody.body.quaternion.w,
  ).normalize();
  return {
    nodeId: node.id,
    vehicle,
    wheelCount,
    steerableWheelIndices,
    wheelBindings,
    forwardAxis: axisForwardVector.clone(),
    axisRightIndex: rightAxis,
    axisUpIndex: upAxis,
    axisForwardIndex: forwardAxis,
    axisRight: axisRightVector,
    axisUp: axisUpVector,
    axisForward: axisForwardVector,
    lastChassisPosition: initialChassisPosition,
    hasChassisPositionSample: false,
    initialChassisQuaternion,
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
  vehicleRaycastInWorld.delete(nodeId);
  scenePreviewPerf.notifyRemovedNode(nodeId);
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

function getPhysicsInterpolationState(body: CANNON.Body): PhysicsInterpolationState {
  let state = physicsInterpolationStates.get(body);
  if (!state) {
    state = {
      prevPos: new THREE.Vector3(),
      prevQuat: new THREE.Quaternion(),
      currPos: new THREE.Vector3(),
      currQuat: new THREE.Quaternion(),
      hasSample: false,
    };
    physicsInterpolationStates.set(body, state);
  }
  return state;
}

function syncObjectFromInterpolated(
  entry: Pick<RigidbodyInstance, 'object' | 'orientationAdjustment'>,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  afterSync?: (object: THREE.Object3D) => void,
): void {
  const { object, orientationAdjustment } = entry;
  if (!object) {
    return;
  }
  object.position.copy(position);
  physicsInterpolationQuat.copy(quaternion);
  if (orientationAdjustment) {
    physicsInterpolationQuat.multiply(orientationAdjustment.threeInverse);
  }
  object.quaternion.copy(physicsInterpolationQuat);
  object.updateMatrixWorld(true);
  afterSync?.(object);
}

function resolveInterpolatedBodyPosition(body: CANNON.Body, target: THREE.Vector3): THREE.Vector3 {
  if (!physicsInterpolationEnabled) {
    return target.set(body.position.x, body.position.y, body.position.z);
  }
  const state = physicsInterpolationStates.get(body);
  if (!state || !state.hasSample) {
    return target.set(body.position.x, body.position.y, body.position.z);
  }
  return target.copy(state.prevPos).lerp(state.currPos, physicsInterpolationAlpha);
}

function ensureRigidbodyBindingForObject(nodeId: string, object: THREE.Object3D): void {
  if (!physicsWorld || !currentDocument) {
    return;
  }
  const node = resolveNodeById(nodeId);
  const component = resolvePhysicsRigidbodyComponent(node);
  const shapeDefinition = extractRigidbodyShape(component);
  const requiresMetadata = !hasAutoGeneratedDynamicShapeForNode(node?.dynamicMesh, node);
  const hasBoundaryWall = Boolean(resolveBoundaryWallComponent(node));
  if (!node || !component || !object) {
    return;
  }
  if (isRoadDynamicMesh(node.dynamicMesh) && (component.props as RigidbodyComponentProps | undefined)?.bodyType === 'STATIC') {
    ensureRoadRigidbodyInstance(node, component, object);
    return;
  }
  if (!shapeDefinition && requiresMetadata && !hasBoundaryWall) {
    return;
  }
  const existing = rigidbodyInstances.get(nodeId);
  if (existing) {
    existing.object = object;
    syncSharedBodyFromObject(existing.body, object, existing.orientationAdjustment);

    scenePreviewPerf.applyAggressiveSleepForNonInteractiveDynamic({
      nodeId,
      body: existing.body,
      isVehicle: Boolean(resolveVehicleComponent(node)),
      isProtagonist: Boolean(object.userData?.protagonist),
    });

    ensureVehicleBindingForNode(nodeId);
    return;
  }
  const bodyEntry = createRigidbodyBody(node, component, shapeDefinition, object);
  if (!bodyEntry) {
    return;
  }

  scenePreviewPerf.applyAggressiveSleepForNonInteractiveDynamic({
    nodeId,
    body: bodyEntry.body,
    isVehicle: Boolean(resolveVehicleComponent(node)),
    isProtagonist: Boolean(object.userData?.protagonist),
  });

  physicsWorld.addBody(bodyEntry.body);
  rigidbodyInstances.set(nodeId, {
    nodeId,
    body: bodyEntry.body,
    bodies: [bodyEntry.body],
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
    if (resolvePhysicsRigidbodyComponent(node)) {
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
    syncVehicleInstancesForDocument(null);
    syncAirWallsForDocument(null);
    return;
  }
  const world = ensurePhysicsWorld();
  const rigidbodyNodes = collectRigidbodyNodes(document.nodes);
  const desiredIds = new Set<string>();
  rigidbodyNodes.forEach((node) => {
    desiredIds.add(node.id);
    const component = resolvePhysicsRigidbodyComponent(node);
    const shapeDefinition = extractRigidbodyShape(component);
    const object = nodeObjectMap.get(node.id) ?? null;
    const requiresMetadata = !hasAutoGeneratedDynamicShapeForNode(node.dynamicMesh, node);
    const hasBoundaryWall = Boolean(resolveBoundaryWallComponent(node));
    if (!component || !object) {
      return;
    }
    if (isRoadDynamicMesh(node.dynamicMesh) && (component.props as RigidbodyComponentProps | undefined)?.bodyType === 'STATIC') {
      ensureRoadRigidbodyInstance(node, component, object);
      return;
    }
    if (!shapeDefinition && requiresMetadata && !hasBoundaryWall) {
      return;
    }
    const existing = rigidbodyInstances.get(node.id);
    if (existing) {
      removeRigidbodyInstanceBodies(world, existing);
      rigidbodyInstances.delete(node.id);
      scenePreviewPerf.notifyRemovedNode(node.id);
    }
    const bodyEntry = createRigidbodyBody(node, component, shapeDefinition, object);
    if (!bodyEntry) {
      return;
    }

    scenePreviewPerf.applyAggressiveSleepForNonInteractiveDynamic({
      nodeId: node.id,
      body: bodyEntry.body,
      isVehicle: Boolean(resolveVehicleComponent(node)),
      isProtagonist: Boolean(object.userData?.protagonist),
    });

    world.addBody(bodyEntry.body);
    rigidbodyInstances.set(node.id, {
      nodeId: node.id,
      body: bodyEntry.body,
      bodies: [bodyEntry.body],
      object,
      orientationAdjustment: bodyEntry.orientationAdjustment,
    });
  });
  rigidbodyInstances.forEach((entry, nodeId) => {
    if (!desiredIds.has(nodeId)) {
      removeRigidbodyInstanceBodies(world, entry);
      rigidbodyInstances.delete(nodeId);
      scenePreviewPerf.notifyRemovedNode(nodeId);
    }
  });
  groundHeightfieldCache.forEach((_entry, nodeId) => {
    if (!desiredIds.has(nodeId)) {
      groundHeightfieldCache.delete(nodeId);
    }
  });
  syncVehicleInstancesForDocument(document);
  syncAirWallsForDocument(document);
}

function stepPhysicsWorld(delta: number): number {
  if (!physicsEnvironmentEnabled.value) {
    physicsAccumulator = 0;
    physicsInterpolationAlpha = 0;
    return 0;
  }
  if (!physicsWorld || !rigidbodyInstances.size) {
    return 0;
  }

  // RaycastVehicle registers postStep callbacks that can introduce micro-jitter even when idle.
  // When not in manual drive nor auto-tour, remove the vehicle from the world to fully freeze it.
  const world = physicsWorld;
  vehicleInstances.forEach((instance) => {
    const nodeId = instance.nodeId;
    if (!nodeId) {
      return;
    }
    const manualActive = vehicleDriveActive.value && vehicleDriveNodeId.value === nodeId;
    const tourActive = activeAutoTourNodeIds.has(nodeId);
    const shouldBeInWorld = manualActive || tourActive;
    const isInWorld = vehicleRaycastInWorld.has(nodeId);

    if (shouldBeInWorld && !isInWorld) {
      try {
        instance.vehicle.addToWorld(world);
        vehicleRaycastInWorld.add(nodeId);
      } catch (error) {
        console.warn('[SceneViewer] Failed to add vehicle to world', error);
      }
      return;
    }
    if (!shouldBeInWorld && isInWorld) {
      try {
        instance.vehicle.removeFromWorld(world);
        vehicleRaycastInWorld.delete(nodeId);
      } catch (error) {
        console.warn('[SceneViewer] Failed to remove vehicle from world', error);
      }
      const chassisBody = instance.vehicle?.chassisBody;
      if (chassisBody) {
        try {
          chassisBody.allowSleep = true;
          chassisBody.sleepSpeedLimit = Math.max(0.05, chassisBody.sleepSpeedLimit ?? 0);
          chassisBody.sleepTimeLimit = Math.max(0.05, chassisBody.sleepTimeLimit ?? 0);
          chassisBody.velocity.set(0, 0, 0);
          chassisBody.angularVelocity.set(0, 0, 0);
          trySleepBody(chassisBody);
        } catch {
          // best-effort
        }
      }
    }
  });
  let subSteps = 0;
  // Skip world.step() entirely when no dynamic body is awake and no vehicle/tour is active.
  // This eliminates all broadphase + solver cost while the scene is at rest.
  const hasActiveController = vehicleDriveActive.value || activeAutoTourNodeIds.size > 0;
  let anyDynamicAwake = hasActiveController;
  if (!anyDynamicAwake) {
    const bodies = physicsWorld.bodies;
    for (let bi = 0, bLen = bodies.length; bi < bLen; bi += 1) {
      const b = bodies[bi];
      if (b.type === CANNON.Body.DYNAMIC && (b as any).sleepState === 0) {
        anyDynamicAwake = true;
        break;
      }
    }
  }
  if (physicsInterpolationEnabled) {
    const clampedDelta = Math.min(Math.max(0, delta), PHYSICS_MAX_ACCUMULATOR);
    physicsAccumulator = Math.min(PHYSICS_MAX_ACCUMULATOR, physicsAccumulator + clampedDelta);
    const world = physicsWorld;
    if (!anyDynamicAwake) {
      // All dynamics sleeping – drain accumulator without stepping.
      physicsAccumulator = 0;
    } else {
      // Prepare previous state before stepping.
      rigidbodyInstances.forEach((entry) => {
        const body = entry.body;
        const state = getPhysicsInterpolationState(body);
        if (!state.hasSample) {
          state.prevPos.set(body.position.x, body.position.y, body.position.z);
          state.currPos.copy(state.prevPos);
          state.prevQuat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
          state.currQuat.copy(state.prevQuat);
          state.hasSample = true;
        } else {
          state.prevPos.copy(state.currPos);
          state.prevQuat.copy(state.currQuat);
        }
      });
      try {
        while (physicsAccumulator >= PHYSICS_FIXED_TIMESTEP && subSteps < PHYSICS_MAX_SUB_STEPS) {
          if (vehicleDriveActive.value) {
            // Keep vehicle control smoothing stable by advancing it at the same fixed timestep as physics.
            applyVehicleDriveForces(PHYSICS_FIXED_TIMESTEP);
          }
          world.step(PHYSICS_FIXED_TIMESTEP);
          physicsAccumulator -= PHYSICS_FIXED_TIMESTEP;
          subSteps += 1;
        }
      } catch (error) {
        console.warn('[SceneViewer] Physics step failed', error);
      }
      if (physicsAccumulator > PHYSICS_FIXED_TIMESTEP) {
        physicsAccumulator = PHYSICS_FIXED_TIMESTEP;
      }
    }
    physicsInterpolationAlpha = PHYSICS_FIXED_TIMESTEP > 0
      ? Math.min(1, Math.max(0, physicsAccumulator / PHYSICS_FIXED_TIMESTEP))
      : 0;
    if (subSteps > 0) {
      rigidbodyInstances.forEach((entry) => {
        const body = entry.body;
        const state = getPhysicsInterpolationState(body);
        state.currPos.set(body.position.x, body.position.y, body.position.z);
        state.currQuat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      });
    }
  } else {
    const clampedDelta = Math.min(Math.max(0, delta), PHYSICS_MAX_ACCUMULATOR);
    physicsAccumulator = Math.min(PHYSICS_MAX_ACCUMULATOR, physicsAccumulator + clampedDelta);
    if (!anyDynamicAwake) {
      // All dynamics sleeping – drain accumulator without stepping.
      physicsAccumulator = 0;
    } else {
      try {
        while (physicsAccumulator >= PHYSICS_FIXED_TIMESTEP && subSteps < PHYSICS_MAX_SUB_STEPS) {
          if (vehicleDriveActive.value) {
            applyVehicleDriveForces(PHYSICS_FIXED_TIMESTEP);
          }
          physicsWorld.step(PHYSICS_FIXED_TIMESTEP);
          physicsAccumulator -= PHYSICS_FIXED_TIMESTEP;
          subSteps += 1;
        }
      } catch (error) {
        console.warn('[SceneViewer] Physics step failed', error);
      }
      if (physicsAccumulator > PHYSICS_FIXED_TIMESTEP) {
        physicsAccumulator = PHYSICS_FIXED_TIMESTEP;
      }
    }
  }
  // Ensure vehicles are truly static after exiting drive/auto-tour.
  // If a vehicle wakes up or drifts when no controller is active, hard-stop it and log for debugging.
  const nowMs = Date.now();
  vehicleInstances.forEach((instance) => {
    const nodeId = instance.nodeId;
    if (!nodeId) {
      return;
    }
    const manualActive = vehicleDriveActive.value && vehicleDriveNodeId.value === nodeId;
    const tourActive = activeAutoTourNodeIds.has(nodeId);
    if (manualActive || tourActive) {
      return;
    }
    const chassisBody = instance.vehicle?.chassisBody;
    if (!chassisBody) {
      return;
    }
    const vx = chassisBody.velocity?.x ?? 0;
    const vy = chassisBody.velocity?.y ?? 0;
    const vz = chassisBody.velocity?.z ?? 0;
    const wx = chassisBody.angularVelocity?.x ?? 0;
    const wy = chassisBody.angularVelocity?.y ?? 0;
    const wz = chassisBody.angularVelocity?.z ?? 0;
    const speedSq = vx * vx + vy * vy + vz * vz;
    const angSq = wx * wx + wy * wy + wz * wz;
    const sleepState = getBodySleepState(chassisBody);
    const drifting = speedSq > 1e-10 || angSq > 1e-10;
    const awake = sleepState === 0;
    if (!drifting && !awake) {
      return;
    }

    const lastLog = vehicleIdleFreezeLastLogMs.get(nodeId) ?? 0;
    if (nowMs - lastLog > 750) {
      vehicleIdleFreezeLastLogMs.set(nodeId, nowMs);
      // idle drift detected; forcing stop (no debug log)
    }
    try {
      chassisBody.allowSleep = true;
      chassisBody.sleepSpeedLimit = Math.max(0.05, chassisBody.sleepSpeedLimit ?? 0);
      chassisBody.sleepTimeLimit = Math.max(0.05, chassisBody.sleepTimeLimit ?? 0);
      const wheelCount = Math.max(0, instance.wheelCount || instance.vehicle.wheelInfos.length || 0);
      for (let index = 0; index < wheelCount; index += 1) {
        instance.vehicle.applyEngineForce(0, index);
        instance.vehicle.setSteeringValue(0, index);
        instance.vehicle.setBrake(VEHICLE_BRAKE_FORCE, index);
      }
      chassisBody.velocity.set(0, 0, 0);
      chassisBody.angularVelocity.set(0, 0, 0);
      trySleepBody(chassisBody);
    } catch {
      // best-effort
    }
  });
  rigidbodyInstances.forEach((entry) => {
    if (entry.syncObjectFromBody === false) {
      return;
    }

    if (!scenePreviewPerf.shouldSyncNonInteractiveSleepingBody({ nodeId: entry.nodeId, body: entry.body, nowMs })) {
      return;
    }

    // AutoTour non-vehicle branch moves the render object directly; do not overwrite it from physics
    // unless the tour is actually active for this node.
    const isAutoTourActive = activeAutoTourNodeIds.has(entry.nodeId);
    if (isAutoTourActive) {
      const nodeState = resolveNodeById(entry.nodeId);
      const vehicle = resolveEnabledComponentState<VehicleComponentProps>(nodeState, VEHICLE_COMPONENT_TYPE);
      if (!vehicle) {
        return;
      }
    }
    if (physicsInterpolationEnabled) {
      const body = entry.body;
      const state = physicsInterpolationStates.get(body);
      if (state && state.hasSample) {
        physicsInterpolationPos.copy(state.prevPos).lerp(state.currPos, physicsInterpolationAlpha);
        physicsInterpolationQuat.copy(state.prevQuat).slerp(state.currQuat, physicsInterpolationAlpha);
        syncObjectFromInterpolated(entry, physicsInterpolationPos, physicsInterpolationQuat, syncInstancedTransform);
        return;
      }
    }
    syncSharedObjectFromBody(entry, syncInstancedTransform);
  });

  return subSteps;
}

function updateVehicleWheelVisuals(delta: number): void {
  // Only update when time advances and vehicle instances exist.
  if (!Number.isFinite(delta) || delta <= 0 || !vehicleInstances.size) {
    return;
  }

  const nowMs = Date.now();

  vehicleInstances.forEach((instance) => {
    const wheelBindings = instance.wheelBindings as VehicleWheelBinding[];
    if (!wheelBindings.length) {
      return;
    }

    const chassisBody = instance.vehicle.chassisBody;
    if (!chassisBody) {
      return;
    }

    const nodeId = instance.nodeId ?? null;
    const manualActive = vehicleDriveActive.value && vehicleDriveVehicle === instance.vehicle;
    const tourActive = Boolean(nodeId) && activeAutoTourNodeIds.has(nodeId);
    if (!scenePreviewPerf.shouldUpdateWheelVisuals({ nodeId, body: chassisBody, manualActive, tourActive, nowMs })) {
      return;
    }

    resolveInterpolatedBodyPosition(chassisBody as CANNON.Body, wheelChassisPositionHelper);
    wheelQuaternionHelper
      .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
      .normalize();

    // Signed travel along the vehicle forward axis (supports reverse).
    let signedTravel = 0;
    if (instance.hasChassisPositionSample) {
      wheelChassisDisplacementHelper.copy(wheelChassisPositionHelper).sub(instance.lastChassisPosition);
      wheelForwardHelper.copy(instance.axisForward).applyQuaternion(wheelQuaternionHelper);
      if (wheelForwardHelper.lengthSq() < 1e-10) {
        wheelForwardHelper.set(0, 0, 1);
      } else {
        wheelForwardHelper.normalize();
      }
      signedTravel = wheelChassisDisplacementHelper.dot(wheelForwardHelper);
      if (!Number.isFinite(signedTravel) || Math.abs(signedTravel) < VEHICLE_TRAVEL_EPSILON) {
        signedTravel = 0;
      }
      // Avoid huge jumps on teleports/resets.
      if (Math.abs(signedTravel) > 50) {
        signedTravel = 0;
      }
    }
    instance.lastChassisPosition.copy(wheelChassisPositionHelper);
    instance.hasChassisPositionSample = true;

    const wheelInfos = instance.vehicle.wheelInfos as Array<{ steering?: number }>;

    wheelBindings.forEach((binding: VehicleWheelBinding) => {
      if (!binding.nodeId) {
        return;
      }
      const wheelObject = nodeObjectMap.get(binding.nodeId) ?? null;
      if (!wheelObject) {
        binding.object = null;
        return;
      }

      // Capture base transform if the wheel object becomes available after the vehicle instance was created
      // or if the object reference changed (e.g. asset reloaded).
      if (binding.object !== wheelObject) {
        binding.object = wheelObject;
        binding.basePosition.copy(wheelObject.position);
        binding.baseScale.copy(wheelObject.scale);
        binding.baseQuaternion.copy(wheelObject.quaternion);
        binding.spinAngle = 0;
        binding.lastSteeringAngle = 0;
      }

      // Keep wheel translation/scale stable; only rotate for steer + spin.
      wheelObject.position.copy(binding.basePosition);
      wheelObject.scale.copy(binding.baseScale);

      // Wheel roll based on chassis travel.
      if (signedTravel !== 0) {
        const radius = Math.max(binding.radius, VEHICLE_WHEEL_MIN_RADIUS);
        // Sign convention: forward travel should spin the wheel forward.
        const rollDelta = -signedTravel / radius;
        if (Number.isFinite(rollDelta) && Math.abs(rollDelta) > VEHICLE_WHEEL_SPIN_EPSILON) {
          binding.spinAngle += rollDelta;
          binding.spinAngle = THREE.MathUtils.euclideanModulo(binding.spinAngle + Math.PI, Math.PI * 2) - Math.PI;
        }
      }

      // Steering (front/steerable wheels).
      let steeringAngle = 0;
      if (binding.isFrontWheel) {
        const info = wheelInfos?.[binding.wheelIndex];
        const raw = info?.steering;
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          steeringAngle = raw;
        } else if (vehicleDriveActive.value && vehicleDriveVehicle === instance.vehicle) {
          steeringAngle = THREE.MathUtils.clamp(vehicleDriveInput.steering, -1, 1) * THREE.MathUtils.degToRad(26);
        }
      }
      binding.lastSteeringAngle = steeringAngle;

      // Prepare parent world quaternion inverse (for parent-space -> wheel-parent local axis conversion).
      wheelParentWorldQuaternionHelper.identity();
      wheelParentWorldQuaternionInverseHelper.identity();
      if (wheelObject.parent) {
        wheelObject.parent.getWorldQuaternion(wheelParentWorldQuaternionHelper);
        wheelParentWorldQuaternionInverseHelper.copy(wheelParentWorldQuaternionHelper).invert();
      }

      // Build parent-space steering quaternion (around vehicle up axis).
      wheelAxisHelper.copy(instance.axisUp).applyQuaternion(wheelQuaternionHelper);
      if (wheelObject.parent) {
        wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper);
      }
      if (wheelAxisHelper.lengthSq() < 1e-10) {
        wheelAxisHelper.set(0, 1, 0);
      } else {
        wheelAxisHelper.normalize();
      }
      wheelSteeringQuaternionHelper.setFromAxisAngle(wheelAxisHelper, steeringAngle);

      // Build local-space spin quaternion (around wheel axle).
      wheelAxisHelper.copy(binding.axleAxis).applyQuaternion(wheelQuaternionHelper);
      if (wheelObject.parent) {
        wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper);
      }
      if (wheelAxisHelper.lengthSq() < 1e-10) {
        wheelAxisHelper.copy(defaultWheelAxisVector);
        wheelAxisHelper.applyQuaternion(wheelQuaternionHelper);
        if (wheelObject.parent) {
          wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper);
        }
      }
      if (wheelAxisHelper.lengthSq() < 1e-10) {
        wheelAxisHelper.set(1, 0, 0);
      } else {
        wheelAxisHelper.normalize();
      }
      wheelBaseQuaternionInverseHelper.copy(binding.baseQuaternion).invert();
      wheelAxisHelper.applyQuaternion(wheelBaseQuaternionInverseHelper);
      if (wheelAxisHelper.lengthSq() < 1e-10) {
        wheelAxisHelper.set(1, 0, 0);
      } else {
        wheelAxisHelper.normalize();
      }
      wheelSpinQuaternionHelper.setFromAxisAngle(wheelAxisHelper, binding.spinAngle);

      // Compose: base -> (parent-space steer) -> (local-space spin).
      wheelVisualQuaternionHelper.copy(binding.baseQuaternion);
      if (steeringAngle !== 0) {
        wheelVisualQuaternionHelper.premultiply(wheelSteeringQuaternionHelper);
      }
      if (binding.spinAngle !== 0) {
        wheelVisualQuaternionHelper.multiply(wheelSpinQuaternionHelper);
      }
      wheelObject.quaternion.copy(wheelVisualQuaternionHelper);

      syncInstancedTransform(wheelObject);
    });
  });
}

/**
 * 将“延迟做 Instancing”的节点，真正转换为 InstancedMesh 相关结构。
 *
 * 背景（简化理解）：
 * - 场景里某些节点一开始可能以“普通对象/占位对象”的形式存在；
 * - 为了节省 draw call，同一模型（同一 assetId）出现多次时，最终希望用 InstancedMesh 承载；
 * - 但 Instancing 的准备（分组、替换节点、创建/更新 InstancedMesh）可能较重，因此选择“延迟”到合适时机再执行。
 *
 * 本函数做的事：
 * 1) 决定本次要处理哪些节点（includeNodeIds）：不仅是传入 nodeId，还会尽量把“同 assetId 且也标记了延迟 instancing”的兄弟节点一起处理。
 *    这样做可以一次性完成同资产的实例化合并，避免多次重复构建。
 * 2) 调用 prepareInstancedNodesForGraph：在 sceneGraphRoot 下生成/更新 instanced 结构，并把对应节点替换为 instanced proxy/目标对象。
 * 3) 重新注册这些节点的 runtime/物理绑定：更新 nodeObjectMap、并将现有物理/运行时绑定重定向到新对象（避免重建导致的坐标/物理状态重置），再 registerSceneSubtree 让新对象进入索引与绑定系统。
 * 4) 清理延迟状态与 lazy placeholder 状态，标记为已完成。
 *
 * @returns 是否成功处理了传入的 nodeId（通常等价于 includeNodeIds 里包含 nodeId 且替换生效）。
 */
async function applyDeferredInstancingForNode(nodeId: string): Promise<boolean> {
  // 只有被标记为“需要延迟 instancing”的节点才会进入处理流程。
  if (!deferredInstancingNodeIds.has(nodeId)) {
    return false;
  }

  // Instancing 的准备依赖当前场景文档、资源缓存、以及已构建的场景图根节点。
  // 任一缺失都无法进行。
  if (!currentDocument || !viewerResourceCache || !sceneGraphRoot) {
    return false;
  }

  // 本次准备要“纳入 instancing”的节点集合。
  // 关键点：Instancing 的收益通常来自“同一 sourceAssetId 的多个节点”合并。
  const includeNodeIds = new Set<string>();

  // 尝试把“同一个 assetId 的相关节点”一起做 instancing：
  // - assetNodeIdMap 维护了 assetId -> nodeId 的集合；
  // - 我们只挑选那些也在 deferredInstancingNodeIds 里的节点，避免无关节点被提前改写。
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

  // 若没有找到“同资产的兄弟节点”，至少保证处理当前 nodeId。
  if (!includeNodeIds.size) {
    includeNodeIds.add(nodeId);
  }

  // 关键：延时 instancing 发生时，节点可能已经被物理/运行时逻辑更新过 transform。
  // 如果直接用文档里的初始 transform 替换，会导致实例显示位置发生偏差。
  // 因此这里先缓存“当前对象的 local 变换”，在 proxy 创建后恢复。
  const transformSnapshots = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();

  // 同 nodeId 的对象可能同时出现在“容器节点”和“placeholder 子节点”上；
  // 这里优先选非-placeholder 的对象作为坐标系来源，避免取到子节点(局部原点)导致恢复错误。
  const preferredObjects = new Map<string, THREE.Object3D>();
  sceneGraphRoot.traverse((object) => {
    const id = object.userData?.nodeId as string | undefined;
    if (!id || !includeNodeIds.has(id)) {
      return;
    }
    const lazyData = object.userData?.lazyAsset as LazyAssetMetadata;
    const objectIsPlaceholder = lazyData?.placeholder === true;
    const existing = preferredObjects.get(id) ?? null;
    if (!existing) {
      preferredObjects.set(id, object);
      return;
    }
    const existingLazyData = existing.userData?.lazyAsset as LazyAssetMetadata;
    const existingIsPlaceholder = existingLazyData?.placeholder === true;
    if (existingIsPlaceholder && !objectIsPlaceholder) {
      preferredObjects.set(id, object);
    }
  });

  includeNodeIds.forEach((id) => {
    const object = preferredObjects.get(id) ?? nodeObjectMap.get(id) ?? null;
    if (!object) {
      return;
    }
    transformSnapshots.set(id, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  });

  try {
    await prepareInstancedNodesForGraph(sceneGraphRoot, currentDocument, viewerResourceCache, {
      includeNodeIds,
    });
  } catch (error) {
    console.warn('[SceneViewer] Failed to apply deferred instancing', error);
    return false;
  }

  // 识别哪些节点在 prepareInstancedNodesForGraph 后真正变成了 instanced proxy。
  const instancedObjectsByNodeId = new Map<string, THREE.Object3D>();
  sceneGraphRoot.traverse((object) => {
    const id = object.userData?.nodeId as string | undefined;
    if (!id || !includeNodeIds.has(id)) {
      return;
    }
    const instancedAssetId = object.userData?.instancedAssetId as string | undefined;
    if (instancedAssetId && instancedAssetId.trim().length) {
      instancedObjectsByNodeId.set(id, object);
    }
  });

  // 对“真正 instanced 成功”的节点：
  // - 恢复替换前的 transform（对齐物理/运行时更新后的坐标）
  // - 将现有物理绑定重定向到新对象（避免销毁刚体导致状态与坐标被重置）
  // - 重新注册到 nodeObjectMap / runtime / physics
  // - 清理 lazy placeholder 与 deferred 状态
  instancedObjectsByNodeId.forEach((object, id) => {
    const snapshot = transformSnapshots.get(id) ?? null;
    if (snapshot) {
      object.position.copy(snapshot.position);
      object.quaternion.copy(snapshot.quaternion);
      object.scale.copy(snapshot.scale);
      object.updateMatrixWorld(true);
    }

    const rigidbody = rigidbodyInstances.get(id);
    if (rigidbody) {
      rigidbody.object = object;
    }
    registerSceneSubtree(object);
    deferredInstancingNodeIds.delete(id);
    lazyPlaceholderStates.delete(id);
  });

  // 对“尝试 instancing 但仍未成功”的节点，清除 deferred 标记，允许后续走详细模型加载兜底。
  includeNodeIds.forEach((id) => {
    if (!instancedObjectsByNodeId.has(id)) {
      deferredInstancingNodeIds.delete(id);
    }
  });

  if (renderContext?.scene) {
    refreshAnimationControllers(renderContext.scene);
  }

  return instancedObjectsByNodeId.has(nodeId);
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
  const nodeId = state.nodeId;
  const cleanupState = () => {
    lazyPlaceholderStates.delete(nodeId);
    deferredInstancingNodeIds.delete(nodeId);
  };
  const markLoadedAndCleanup = () => {
    state.loaded = true;
    cleanupState();
  };

  const node = resolveNodeById(nodeId);
  if (!node) {
    cleanupState();
    return;
  }
  if (deferredInstancingNodeIds.has(nodeId)) {
    const instanced = await applyDeferredInstancingForNode(nodeId);
    if (instanced) {
      state.loaded = true;
      lazyPlaceholderStates.delete(nodeId);
      return;
    }
    deferredInstancingNodeIds.delete(nodeId);
  }
  try {
    const detailed = await loadNodeObject(resourceCache, state.assetId, node.importMetadata ?? null);
    if (!detailed) {
      cleanupState();
      return;
    }
    detailed.position.set(0, 0, 0);
    prepareImportedObjectForPreview(detailed);
    const placeholder = state.placeholder;
    const container = state.container ?? nodeObjectMap.get(nodeId) ?? null;
    const metadata = { ...(placeholder.userData ?? {}), nodeId } as Record<string, unknown>;
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
    nodeObjectMap.delete(nodeId);
    removeRigidbodyInstance(nodeId);
    registerSceneSubtree(detailed);
    markLoadedAndCleanup();
    refreshAnimationControllers(context.scene);
  } catch (error) {
    console.warn('[SceneViewer] 延迟资源加载失败', error);
    cleanupState();
  }
}

function prepareImportedObjectForPreview(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const mesh = child as THREE.Mesh & { material?: THREE.Material | THREE.Material[] };
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

function syncInstancedTransform(object: THREE.Object3D | null, force = false): void {
  if (!object) {
    return;
  }
  // 注意：父层级存在旋转 + 非等比缩放时会产生 shear。
  // InstancedMesh 支持完整矩阵，但 decompose/compose 会丢失 shear，导致实例位置/朝向偏差。
  // 因此这里优先直接写入 matrixWorld，仅在需要“隐藏”(scale=0) 时才做分解。
  object.updateMatrixWorld(true);

  const handleTarget = (target: THREE.Object3D) => {
    if (!target.userData?.instancedAssetId) {
      return;
    }

    if (hasWallInstancedBindings(target)) {
      const nodeId = target.userData?.nodeId as string | undefined;
      if (nodeId) {
        removeVehicleInstance(nodeId);
      }
      syncWallInstancedBindingsForObject(target);
      return;
    }

    const nodeId = target.userData?.nodeId as string | undefined;
    if (!nodeId) {
      return;
    }
    removeVehicleInstance(nodeId);

    const node = resolveNodeById(nodeId);
    if (!node) {
      return;
    }

    const layout = clampSceneNodeInstanceLayout(node.instanceLayout);

    const assetId = typeof target.userData?.instancedAssetId === 'string' ? (target.userData.instancedAssetId as string) : null;
    const visible = isRuntimeObjectEffectivelyVisible(target);
    const renderKind = target.userData?.instancedRenderKind === 'billboard' ? 'billboard' : 'model';

    const group = renderKind === 'model' && assetId ? getCachedModelObject(assetId) : null;
    if (renderKind === 'model' && !group) {
      return;
    }

    const desiredCount = getInstanceLayoutCount(layout);
    const existingBindings = renderKind === 'billboard'
      ? getBillboardInstanceBindingsForNode(nodeId)
      : getModelInstanceBindingsForNode(nodeId);
    if (existingBindings.length !== desiredCount) {
      if (!assetId) {
        return;
      }
      releaseBillboardInstance(nodeId);
      releaseModelInstance(nodeId);
      if (renderKind === 'billboard') {
        allocateBillboardInstance(assetId, nodeId);
      } else {
        allocateModelInstance(assetId, nodeId);
      }
      for (let i = 1; i < desiredCount; i++) {
        const bindingId = getInstanceLayoutBindingId(nodeId, i);
        if (renderKind === 'billboard') {
          allocateBillboardInstanceBinding(assetId, bindingId, nodeId);
        } else {
          allocateModelInstanceBinding(assetId, bindingId, nodeId);
        }
      }
      clearInstancedTransformCacheForNode(nodeId);
    }

    if (!visible) {
      target.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper);
      instancedScaleHelper.setScalar(0);
      instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper);
    } else {
      instancedMatrixHelper.copy(target.matrixWorld);
      if (renderKind === 'model' && target.userData?.__harmonyLodFaceCamera === true) {
        applyModelFaceCameraMatrix(renderContext?.camera ?? null, instancedMatrixHelper);
      }
    }

    // bounds should represent the whole layout
    target.userData.instancedBounds = computeInstanceLayoutLocalBoundingBox(
      layout,
      renderKind === 'billboard'
        ? new THREE.Box3(
          new THREE.Vector3(-(Number(target.userData?.billboardWidth) || 1) * 0.5, 0, -0.01),
          new THREE.Vector3((Number(target.userData?.billboardWidth) || 1) * 0.5, Number(target.userData?.billboardHeight) || 1, 0.01),
        )
        : group!.boundingBox,
    );

    const result = forEachInstanceWorldMatrix({
      nodeId,
      baseMatrixWorld: instancedMatrixHelper,
      layout,
      templateBoundingBox: renderKind === 'billboard'
        ? new THREE.Box3(
          new THREE.Vector3(-(Number(target.userData?.billboardWidth) || 1) * 0.5, 0, -0.01),
          new THREE.Vector3((Number(target.userData?.billboardWidth) || 1) * 0.5, Number(target.userData?.billboardHeight) || 1, 0.01),
        )
        : group!.boundingBox,
      cache: {
        signature: (target.userData.__harmonyInstanceLayoutSignature as string | null) ?? null,
        locals: (target.userData.__harmonyInstanceLayoutLocals as THREE.Matrix4[]) ?? [],
      },
      onMatrix: (bindingId, worldMatrix) => {
        const cached = instancedTransformCache.get(bindingId) ?? null;
        const shouldUpdate =
          force ||
          !cached ||
          cached.visible !== visible ||
          cached.assetId !== assetId ||
          !matricesAlmostEqual(cached.elements, worldMatrix.elements);

        if (!shouldUpdate) {
          return;
        }

        if (bindingId === nodeId) {
          if (renderKind === 'billboard') {
            updateBillboardInstanceMatrix(nodeId, worldMatrix);
          } else {
            updateModelInstanceMatrix(nodeId, worldMatrix);
          }
        } else {
          if (renderKind === 'billboard') {
            updateBillboardInstanceBindingMatrix(bindingId, worldMatrix);
          } else {
            updateModelInstanceBindingMatrix(bindingId, worldMatrix);
          }
        }

        // Mark any associated InstancedMesh objects as dirty so their bounding spheres
        // will be recomputed (Three.js doesn't auto-update mesh boundingSphere for instanceMatrix changes).
        try {
          const binding = renderKind === 'billboard' ? null : getModelInstanceBinding(bindingId);
          if (binding) {
            for (const slot of binding.slots) {
              addInstancedBoundsMesh(slot.mesh);
            }
          }
        } catch (_error) {
          // ignore binding lookup errors
        }

        instancedTransformCache.set(bindingId, {
          assetId,
          visible,
          elements: Array.from(worldMatrix.elements),
        });
      },
    });

    target.userData.__harmonyInstanceLayoutSignature = result.signature;
    target.userData.__harmonyInstanceLayoutLocals = result.locals;
  };

  // Fast path: instanced proxy itself.
  handleTarget(object);
  // Some objects (e.g. wheel visuals) may contain nested instanced proxies.
  object.traverse(handleTarget);
}

function updateNodeTransfrom(object: THREE.Object3D, node: SceneNode) {
  const autoTour = resolveEnabledComponentState<AutoTourComponentProps>(node, AUTO_TOUR_COMPONENT_TYPE);
  const skipTransformSync = Boolean(autoTour) && vehicleInstances.has(node.id);
  if (node.position) {
    if (!skipTransformSync) {
      object.position.set(node.position.x, node.position.y, node.position.z);
    }
  }
  if (node.rotation) {
    if (!skipTransformSync) {
      object.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z);
    }
  }
  applyMirroredScaleToObject(object, node.scale ?? null, node.mirror);
  // Mirror uses negative scale sign which flips triangle winding; ensure mirrored nodes
  // render correctly by flipping material.side (Front<->Back) on a cloned variant.
  syncMirroredMeshMaterials(object, node.mirror === 'horizontal' || node.mirror === 'vertical', node.mirror);
  if (object.userData?.instancedAssetId) {
    syncContinuousInstancedModelCommitted({
      node,
      object,
      assetId: object.userData.instancedAssetId as string,
    });
    return;
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
  } else if (node.editorFlags?.editorOnly || object.userData?.hidden === true) {
    object.visible = false;
  } else if (typeof node.visible === 'boolean') {
    object.visible = node.visible;
  } else {
    object.visible = true;
  }
  applyMaterialOverrides(object, node.materials, materialOverrideOptions);
  // Material overrides may replace materials; re-apply mirror fix after overrides.
  syncMirroredMeshMaterials(object, node.mirror === 'horizontal' || node.mirror === 'vertical', node.mirror);
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

function buildBehaviorSoundInstanceKey(event: Extract<BehaviorRuntimeEvent, { type: 'play-sound' }>): string {
  const explicitKey = event.params.instanceKey?.trim();
  if (explicitKey) {
    return `${event.nodeId}:${explicitKey}`;
  }
  return `${event.nodeId}:${event.behaviorSequenceId}:${event.behaviorId}`;
}

function clearBehaviorSoundTimers(instance: BehaviorSoundInstance): void {
  if (instance.startTimer) {
    clearTimeout(instance.startTimer);
    instance.startTimer = null;
  }
  if (instance.stopTimer) {
    clearTimeout(instance.stopTimer);
    instance.stopTimer = null;
  }
  if (instance.intervalTimer) {
    clearTimeout(instance.intervalTimer);
    instance.intervalTimer = null;
  }
  if (instance.fadeTimer) {
    clearInterval(instance.fadeTimer);
    instance.fadeTimer = null;
  }
  if (instance.fadeStartTimer) {
    clearTimeout(instance.fadeStartTimer);
    instance.fadeStartTimer = null;
  }
}

function disposeBehaviorSoundInstance(
  key: string,
  resolution: BehaviorEventResolution | null = null,
): void {
  const instance = activeBehaviorSounds.get(key);
  if (!instance) {
    return;
  }
  activeBehaviorSounds.delete(key);
  instance.stopped = true;
  clearBehaviorSoundTimers(instance);
  if (instance.audio) {
    try {
      instance.audio.stop();
    } catch {
      // ignore
    }
    try {
      instance.audio.destroy();
    } catch {
      // ignore
    }
    instance.audio = null;
  }
  const finish = instance.onFinish;
  instance.onFinish = null;
  if (finish && resolution) {
    finish(resolution);
  }
}

function clearBehaviorSounds(): void {
  Array.from(activeBehaviorSounds.keys()).forEach((key) => {
    disposeBehaviorSoundInstance(key, null);
  });
}

function randomBetween(min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return min + Math.random() * (max - min);
}

function computeViewerSoundDistanceMeters(instance: BehaviorSoundInstance): number | null {
  if (!instance.params.spatial) {
    return 0;
  }
  const camera = renderContext?.camera ?? null;
  if (!camera) {
    return null;
  }
  const targetObject = instance.targetNodeId ? nodeObjectMap.get(instance.targetNodeId) ?? null : null;
  if (!targetObject) {
    return null;
  }
  const targetPoint = resolvePlaySoundSourcePoint(targetObject, camera.position, tempVector);
  if (!targetPoint) {
    return null;
  }
  return camera.position.distanceTo(targetPoint);
}

function computeViewerSpatialGain(instance: BehaviorSoundInstance): number {
  return computePlaySoundDistanceGain(instance.params, computeViewerSoundDistanceMeters(instance));
}

function applyBehaviorSoundVolume(instance: BehaviorSoundInstance): void {
  if (!instance.audio) {
    return;
  }
  const volume = instance.params.volume * instance.envelopeGain * computeViewerSpatialGain(instance);
  instance.audio.volume = Math.max(0, Math.min(1, volume));
}

function scheduleBehaviorSoundFade(
  instance: BehaviorSoundInstance,
  fromGain: number,
  toGain: number,
  durationSeconds: number,
): void {
  if (!instance.audio) {
    return;
  }
  if (instance.fadeTimer) {
    clearInterval(instance.fadeTimer);
    instance.fadeTimer = null;
  }
  if (durationSeconds <= 0) {
    instance.envelopeGain = Math.max(0, Math.min(1, toGain));
    applyBehaviorSoundVolume(instance);
    return;
  }
  const startedAt = Date.now();
  const durationMs = durationSeconds * 1000;
  instance.envelopeGain = Math.max(0, Math.min(1, fromGain));
  applyBehaviorSoundVolume(instance);
  instance.fadeTimer = setInterval(() => {
    const current = activeBehaviorSounds.get(instance.key);
    if (!current || !current.audio) {
      if (instance.fadeTimer) {
        clearInterval(instance.fadeTimer);
        instance.fadeTimer = null;
      }
      return;
    }
    const elapsed = Date.now() - startedAt;
    const alpha = Math.min(1, Math.max(0, elapsed / durationMs));
    current.envelopeGain = Math.max(0, Math.min(1, fromGain + (toGain - fromGain) * alpha));
    applyBehaviorSoundVolume(current);
    if (alpha >= 1) {
      if (current.fadeTimer) {
        clearInterval(current.fadeTimer);
        current.fadeTimer = null;
      }
    }
  }, 80);
}

function scheduleBehaviorSoundStop(key: string, instance: BehaviorSoundInstance): void {
  if (instance.params.durationSeconds <= 0) {
    return;
  }
  const fadeStartMs = Math.max(0, (instance.params.durationSeconds - instance.params.fadeOutSeconds) * 1000);
  const stopDelayMs = Math.max(0, instance.params.durationSeconds * 1000);
  if (instance.params.fadeOutSeconds > 0) {
    instance.fadeStartTimer = setTimeout(() => {
      const current = activeBehaviorSounds.get(key);
      if (!current) {
        return;
      }
      scheduleBehaviorSoundFade(current, current.envelopeGain, 0, current.params.fadeOutSeconds);
    }, fadeStartMs);
  }
  instance.stopTimer = setTimeout(() => {
    disposeBehaviorSoundInstance(key, instance.onFinish ? { type: 'continue' } : null);
  }, stopDelayMs);
}

async function playBehaviorSoundEvent(event: Extract<BehaviorRuntimeEvent, { type: 'play-sound' }>): Promise<void> {
  const assetId = event.params.assetId?.trim() ?? '';
  if (!assetId.length) {
    if (event.token) {
      resolveBehaviorToken(event.token, { type: 'fail', message: '未配置音频资源' });
    }
    return;
  }
  const resolved = await resolveAssetUrlReference(assetId);
  if (!resolved?.url) {
    if (event.token) {
      resolveBehaviorToken(event.token, { type: 'fail', message: '音频资源加载失败' });
    }
    return;
  }
  const key = buildBehaviorSoundInstanceKey(event);
  disposeBehaviorSoundInstance(key, null);
  const audio = uni.createInnerAudioContext();
  audio.autoplay = false;
  audio.loop = event.params.playbackMode === 'loop';
  audio.src = resolved.url;
  audio.playbackRate = event.params.playbackRate;
  const instance: BehaviorSoundInstance = {
    key,
    params: event.params,
    targetNodeId: event.targetNodeId,
    audio,
    startTimer: null,
    stopTimer: null,
    intervalTimer: null,
    fadeTimer: null,
    fadeStartTimer: null,
    onFinish: event.token ? (resolution) => resolveBehaviorToken(event.token!, resolution) : null,
    envelopeGain: event.params.fadeInSeconds > 0 ? 0 : 1,
    stopped: false,
  };
  activeBehaviorSounds.set(key, instance);

  const beginPlayback = () => {
    const current = activeBehaviorSounds.get(key);
    if (!current || !current.audio || current.stopped) {
      return;
    }
    if (current.params.fadeInSeconds > 0) {
      scheduleBehaviorSoundFade(current, 0, 1, current.params.fadeInSeconds);
    } else {
      current.envelopeGain = 1;
      applyBehaviorSoundVolume(current);
    }
    current.audio.onEnded(() => {
      const latest = activeBehaviorSounds.get(key);
      if (!latest) {
        return;
      }
      if (latest.params.playbackMode === 'interval' && !latest.stopped) {
        const delaySeconds = randomBetween(latest.params.minIntervalSeconds, latest.params.maxIntervalSeconds);
        latest.intervalTimer = setTimeout(() => {
          const fresh = activeBehaviorSounds.get(key);
          if (!fresh || !fresh.audio || fresh.stopped) {
            return;
          }
          fresh.audio.seek?.(0);
          fresh.audio.play();
        }, delaySeconds * 1000);
        return;
      }
      disposeBehaviorSoundInstance(key, latest.onFinish ? { type: 'continue' } : null);
    });
    current.audio.play();
    scheduleBehaviorSoundStop(key, current);
    if (current.params.playbackMode !== 'once' && current.onFinish) {
      const finish = current.onFinish;
      current.onFinish = null;
      finish({ type: 'continue' });
    }
  };

  if (event.params.startDelaySeconds > 0) {
    instance.startTimer = setTimeout(beginPlayback, event.params.startDelaySeconds * 1000);
    if (instance.params.playbackMode !== 'once' && instance.onFinish) {
      const finish = instance.onFinish;
      instance.onFinish = null;
      finish({ type: 'continue' });
    }
    return;
  }
  beginPlayback();
}

function handlePlaySoundEvent(event: Extract<BehaviorRuntimeEvent, { type: 'play-sound' }>): void {
  const key = buildBehaviorSoundInstanceKey(event);
  if (event.params.command === 'stop') {
    disposeBehaviorSoundInstance(key, null);
    return;
  }
  void playBehaviorSoundEvent(event);
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

function resolveNodeAnchorPoint(nodeId: string | null | undefined): THREE.Vector3 | null {
  if (!nodeId) {
    return null;
  }
  const object = nodeObjectMap.get(nodeId);
  if (!object) {
    return null;
  }
  object.getWorldPosition(tempVector);
  return tempVector.clone();
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
    runWithProgrammaticCameraMutationAndAnchor(() => {
      controls.enabled = !enabled;
      controls.update();
    });
  }
}

function resetProtagonistPoseState(): void {
  protagonistPoseSynced = false;
  scenePreviewPerf.clearProtagonist();
  protagonistNodeId = null;
}

function registerProtagonistObject(object: THREE.Object3D): void {
  const id = object.userData?.nodeId as string | undefined;
  if (!id) {
    return;
  }
  protagonistNodeId = id;
  const rigidbody = rigidbodyInstances.get(id) ?? null;
  scenePreviewPerf.registerProtagonist(id, rigidbody?.body ?? null);
}

function findProtagonistObject(): THREE.Object3D | null {
  for (const object of nodeObjectMap.values()) {
    if (object.userData?.protagonist) {
      registerProtagonistObject(object);
      return object;
    }
  }
  return null;
}

type ProtagonistPoseOptions = {
  force?: boolean;
  applyToCamera?: boolean;
  object?: THREE.Object3D | null;
};

function syncProtagonistCameraPose(options: ProtagonistPoseOptions = {}): boolean {
  if (!options.force && protagonistPoseSynced) {
    return false;
  }
  const protagonistObject = options.object ?? findProtagonistObject();
  if (!protagonistObject) {
    return false;
  }
  registerProtagonistObject(protagonistObject);
  protagonistObject.getWorldPosition(protagonistPosePosition);
  protagonistObject.getWorldQuaternion(protagonistPoseQuaternion);
  protagonistPoseDirection.set(1, 0, 0).applyQuaternion(protagonistPoseQuaternion);
  if (protagonistPoseDirection.lengthSq() < 1e-8) {
    protagonistPoseDirection.set(1, 0, 0);
  } else {
    protagonistPoseDirection.normalize();
  }
  protagonistPosePosition.y = HUMAN_EYE_HEIGHT;
  protagonistPoseTarget.copy(protagonistPosePosition).addScaledVector(protagonistPoseDirection, CAMERA_FORWARD_OFFSET);
  protagonistPoseSynced = true;
  if (options.applyToCamera) {
    const context = renderContext;
    if (context) {
      runWithProgrammaticCameraMutationAndAnchor(() => {
        withControlsVerticalFreedom(context.controls, () => {
          context.camera.position.copy(protagonistPosePosition);
          context.controls.target.copy(protagonistPoseTarget);
          context.camera.lookAt(protagonistPoseTarget);
          context.controls.update();
        });
      });
      lockControlsPitchToCurrent(context.controls, context.camera);
    }
  }
  return true;
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
  runWithProgrammaticCameraMutationAndAnchor(() => {
    withControlsVerticalFreedom(controls, () => {
      controls.target.copy(tempMovementVec);
      camera.position.copy(tween.startPosition);
      camera.lookAt(controls.target);
      controls.update();
    });
  });
  lockControlsPitchToCurrent(controls, camera);
  if (tween.elapsed >= tween.duration) {
    runWithProgrammaticCameraMutationAndAnchor(() => {
      withControlsVerticalFreedom(controls, () => {
        controls.target.copy(tween.to);
        camera.lookAt(controls.target);
        controls.update();
      });
    });
    lockControlsPitchToCurrent(controls, camera);
    activeCameraWatchTween = null;
    markInstancedCullingDirty();
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
  previewNodeMap.forEach((_node, nodeId) => {
    syncBehaviorProximityCandidate(nodeId);
  });
}

const behaviorRuntimeListener: BehaviorRuntimeListener = {
  onRegistryChanged(nodeId) {
    syncBehaviorProximityCandidate(nodeId);
    syncInteractionLayersForNode(nodeId);
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

function resolveRegionBehaviorContainment(
  nodeId: string,
  object: THREE.Object3D,
  observerPosition: THREE.Vector3,
): { inside: boolean; distance: number } | null {
  const node = previewNodeMap.get(nodeId);
  if (!node || node.dynamicMesh?.type !== 'Region') {
    return null;
  }
  const vertices = (Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : [])
    .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
  if (vertices.length < 3) {
    return { inside: false, distance: Number.POSITIVE_INFINITY };
  }
  const localObserver = object.worldToLocal(tempRegionObserverVector.copy(observerPosition));
  const inside = isPointInsideRegionXZ({ x: localObserver.x, z: localObserver.z }, vertices);
  const focusPoint = resolveNodeFocusPoint(nodeId) ?? object.getWorldPosition(tempVector);
  return {
    inside,
    distance: focusPoint.distanceTo(observerPosition),
  };
}

function updateBehaviorProximity(): void {
  const camera = renderContext?.camera;
  if (!camera || !behaviorProximityCandidates.size) {
    return;
  }
  const cameraPosition = camera.position;
  let observerPosition = cameraPosition;
  let observerNodeId: string | null = null;
  if (vehicleDriveActive.value && vehicleDriveNodeId.value) {
    observerNodeId = vehicleDriveNodeId.value;
  } else if (activeAutoTourNodeIds.size > 0) {
    observerNodeId = resolveAutoTourFollowNodeId(
      autoTourFollowNodeId.value,
      cameraViewState.targetNodeId,
      activeAutoTourNodeIds,
      previewNodeMap.keys(),
      autoTourRuntime,
    );
  }
  if (observerNodeId) {
    const obs = resolveNodeFocusPoint(observerNodeId) ?? nodeObjectMap.get(observerNodeId)?.getWorldPosition(tempObserverVector) ?? null;
    if (obs) {
      observerPosition = obs instanceof THREE.Vector3 ? obs : tempObserverVector;
    }
  }
  behaviorProximityCandidates.forEach((candidate, nodeId) => {
    const object = nodeObjectMap.get(nodeId);
    if (!object) {
      return;
    }
    const state = behaviorProximityState.get(nodeId);
    if (!state) {
      return;
    }
    const regionContainment = resolveRegionBehaviorContainment(nodeId, object, observerPosition);
    if (regionContainment) {
      if (!state.inside && regionContainment.inside) {
        state.inside = true;
        if (candidate.hasApproach) {
          const followUps = triggerBehaviorAction(nodeId, 'approach', {
            payload: {
              distance: regionContainment.distance,
              threshold: 0,
            },
          });
          processBehaviorEvents(followUps);
        }
      } else if (state.inside && !regionContainment.inside) {
        state.inside = false;
        if (candidate.hasDepart) {
          const followUps = triggerBehaviorAction(nodeId, 'depart', {
            payload: {
              distance: regionContainment.distance,
              threshold: 0,
            },
          });
          processBehaviorEvents(followUps);
        }
      }
      state.lastDistance = regionContainment.distance;
      return;
    }
    const thresholds = resolveProximityThresholds(nodeId, object);
    const focusPoint = resolveNodeFocusPoint(nodeId) ?? object.getWorldPosition(tempVector);
    const distance = focusPoint.distanceTo(observerPosition);
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
  const targetNodeId = event.targetNodeId ?? event.nodeId;
  const anchorPoint = resolveNodeAnchorPoint(targetNodeId) ?? resolveNodeFocusPoint(targetNodeId);
  if (!anchorPoint) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '未找到目标节点' });
    return;
  }

  const focusPoint = anchorPoint.clone();
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const destination = new THREE.Vector3(focusPoint.x, focusPoint.y + HUMAN_EYE_HEIGHT, focusPoint.z);
  const translation = destination.clone().sub(startPosition);
  const targetDestination = startTarget.clone().add(translation);
  if (targetDestination.distanceToSquared(destination) < 1e-6) {
    targetDestination.copy(destination);
  }
  const durationSeconds = Math.max(0, event.duration ?? 0);
  
  const updateFrame = (alpha: number) => {
    runWithProgrammaticCameraMutationAndAnchor(() => {
      withControlsVerticalFreedom(controls, () => {
        camera.position.lerpVectors(startPosition, destination, alpha);
        controls.target.lerpVectors(startTarget, targetDestination, alpha);
        controls.update();
      });
    });
    lockControlsPitchToCurrent(controls, camera);
  };
  const finalize = () => {
    runWithProgrammaticCameraMutationAndAnchor(() => {
      withControlsVerticalFreedom(controls, () => {
        camera.position.copy(destination);
        controls.target.copy(targetDestination);
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
  const focus = resolveNodeAnchorPoint(targetNodeId) ?? resolveNodeFocusPoint(targetNodeId);
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

  tempMovementVec.copy(focus).sub(startPosition);
  if (tempMovementVec.lengthSq() < 1e-8) {
    runWithProgrammaticCameraMutationAndAnchor(() => {
      withControlsVerticalFreedom(controls, () => {
        controls.target.copy(focus);
        camera.position.copy(startPosition);
        camera.lookAt(focus);
        controls.update();
      });
    });
    lockControlsPitchToCurrent(controls, camera);
    markInstancedCullingDirty();
    return finishSuccess();
  }

  tempMovementVec.normalize();
  tempForwardVec.copy(tempMovementVec).multiplyScalar(CAMERA_FORWARD_OFFSET).add(startPosition);
  const startTarget = controls.target.clone();
  if (startTarget.distanceToSquared(tempForwardVec) < 1e-6) {
    runWithProgrammaticCameraMutationAndAnchor(() => {
      withControlsVerticalFreedom(controls, () => {
        camera.position.copy(startPosition);
        controls.target.copy(tempForwardVec);
        camera.lookAt(tempForwardVec);
        controls.update();
      });
    });
    lockControlsPitchToCurrent(controls, camera);
    markInstancedCullingDirty();
    return finishSuccess();
  }

  activeCameraWatchTween = {
    from: startTarget,
    to: tempForwardVec.clone(),
    startPosition,
    duration: CAMERA_WATCH_DURATION,
    elapsed: 0,
  };

  markInstancedCullingDirty();

  return finishSuccess();
}

function handleWatchNodeEvent(event: Extract<BehaviorRuntimeEvent, { type: 'watch-node' }>) {
  const result = performWatchFocus(event.targetNodeId ?? event.nodeId ?? null, event.caging);
  if (!result.success) {
    resolveBehaviorToken(event.token, result.message ? { type: 'fail', message: result.message } : { type: 'fail' });
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
  markInstancedCullingDirty();
  setCameraCaging(false);
  const startTarget = controls.target.clone();
  const levelTarget = startTarget.clone();
  levelTarget.y = camera.position.y;
  const finishSuccess = () => {
    purposeActiveMode.value = 'level';
    setCameraViewState('level');
    return { success: true };
  };
  if (startTarget.distanceToSquared(levelTarget) < 1e-6) {
    runWithProgrammaticCameraMutationAndAnchor(() => {
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
  activeCameraWatchTween = {
    from: startTarget,
    to: levelTarget.clone(),
    startPosition,
    duration: CAMERA_LEVEL_DURATION,
    elapsed: 0,
  };
  markInstancedCullingDirty();
  return finishSuccess();
}

function handleLookLevelEvent(event: Extract<BehaviorRuntimeEvent, { type: 'look-level' }>) {
  const result = resetCameraToLevelView();
  if (!result.success) {
    resolveBehaviorToken(event.token, result.message ? { type: 'fail', message: result.message } : { type: 'fail' });
    return;
  }
  resolveBehaviorToken(event.token, { type: 'continue' });
}


function setVehicleDriveUiOverride(mode: 'auto' | 'show' | 'hide'): void {
  vehicleDriveUiOverride.value = mode;
}

function clampAxisScalar(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function refreshJoystickMetrics(): void {
  nextTick(() => {
    const resolveElement = (
      value: ComponentPublicInstance | HTMLElement | { rootRef?: unknown } | null,
    ): HTMLElement | null => {
      if (!value) {
        return null;
      }
      const exposedRootRef = (value as { rootRef?: unknown }).rootRef;
      const resolvedValue = (exposedRootRef as { value?: unknown } | undefined)?.value
        ?? exposedRootRef
        ?? value;
      if (typeof (resolvedValue as HTMLElement).getBoundingClientRect === 'function') {
        return resolvedValue as HTMLElement;
      }
      const maybeEl = (resolvedValue as { $el?: unknown }).$el;
      if (maybeEl && typeof (maybeEl as HTMLElement).getBoundingClientRect === 'function') {
        return maybeEl as HTMLElement;
      }
      return null;
    };

    const preferredElement = drivePadState.visible
      ? resolveElement(floatingJoystickRef.value)
      : resolveElement(lanternJoystickRef.value) ?? resolveElement(floatingJoystickRef.value);

    if (preferredElement) {
      const rect = preferredElement.getBoundingClientRect();
      joystickState.centerX = rect.left + rect.width / 2;
      joystickState.centerY = rect.top + rect.height / 2;
      joystickState.ready = rect.width > 0 && rect.height > 0;
      return;
    }

    const query = uni.createSelectorQuery();
    if (typeof query.in === 'function') {
      query.in((pageInstance?.proxy as unknown) ?? null);
    }

    const expectedCenter = drivePadState.visible
      ? {
          x: drivePadViewportRect.left + drivePadState.x,
          y: drivePadViewportRect.top + drivePadState.y,
        }
      : null;

    query
      .selectAll('.viewer-drive-joystick')
      .boundingClientRect((rects: unknown) => {
        const items = (Array.isArray(rects) ? rects : []) as UniApp.NodeInfo[];
        if (items.length === 0) {
          joystickState.ready = false;
          return;
        }

        let best: UniApp.NodeInfo | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        let bestArea = -1;

        for (const rect of items) {
          const left = rect.left ?? 0;
          const top = rect.top ?? 0;
          const width = rect.width ?? 0;
          const height = rect.height ?? 0;
          if (!(width > 0 && height > 0)) {
            continue;
          }
          if (expectedCenter) {
            const centerX = left + width / 2;
            const centerY = top + height / 2;
            const dx = centerX - expectedCenter.x;
            const dy = centerY - expectedCenter.y;
            const score = dx * dx + dy * dy;
            if (score < bestScore) {
              bestScore = score;
              best = rect;
            }
          } else {
            const area = width * height;
            if (area > bestArea) {
              bestArea = area;
              best = rect;
            }
          }
        }

        if (!best) {
          joystickState.ready = false;
          return;
        }

        const left = best.left ?? 0;
        const top = best.top ?? 0;
        const width = best.width ?? 0;
        const height = best.height ?? 0;
        joystickState.centerX = left + width / 2;
        joystickState.centerY = top + height / 2;
        joystickState.ready = true;
      })
      .exec();
  });
}

function getTouchCoordinates(touch: Touch | null): { x: number; y: number } | null {
  if (!touch) {
    return null;
  }
  const clientX = 'clientX' in touch ? touch.clientX : (touch as unknown as { x?: number }).x ?? 0;
  const clientY = 'clientY' in touch ? touch.clientY : (touch as unknown as { y?: number }).y ?? 0;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }
  return { x: clientX, y: clientY };
}

function setJoystickVector(x: number, y: number): void {
  let nextX = clampAxisScalar(x);
  let nextY = clampAxisScalar(y);
  const length = Math.hypot(nextX, nextY);
  if (length > 1) {
    const scale = 1 / length;
    nextX *= scale;
    nextY *= scale;
  }
  joystickVector.x = nextX;
  joystickVector.y = nextY;
  joystickOffset.x = joystickVector.x * JOYSTICK_VISUAL_RANGE;
  joystickOffset.y = -joystickVector.y * JOYSTICK_VISUAL_RANGE;
  recomputeVehicleDriveInputs();
}

function deactivateJoystick(reset: boolean): void {
  joystickState.active = false;
  joystickState.pointerId = -1;
  joystickState.ready = false;
  if (reset) {
    setJoystickVector(0, 0);
  }
}

function resolveJoystickDriveInput(): { throttle: number; steering: number } {
  const x = joystickVector.x;
  const y = joystickVector.y;
  const length = Math.hypot(x, y);
  if (length <= JOYSTICK_DEADZONE) {
    return { throttle: 0, steering: 0 };
  }
  const effectiveLength = (length - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
  const scale = length > 0 ? effectiveLength / length : 0;
  return {
    throttle: y * scale,
    steering: x * scale,
  };
}

function applyJoystickFromPoint(x: number, y: number): void {
  if (!joystickState.ready) {
    joystickState.centerX = x;
    joystickState.centerY = y;
    joystickState.ready = true;
    refreshJoystickMetrics();
  }
  const dx = x - joystickState.centerX;
  const dy = y - joystickState.centerY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return;
  }
  const normalizedX = clampAxisScalar(dx / JOYSTICK_INPUT_RADIUS);
  const normalizedY = clampAxisScalar(-dy / JOYSTICK_INPUT_RADIUS);
  let length = Math.hypot(normalizedX, normalizedY);
  if (length > 1) {
    const inv = 1 / length;
    setJoystickVector(normalizedX * inv, normalizedY * inv);
    return;
  }
  setJoystickVector(normalizedX, normalizedY);
}

function approachAxisValue(current: number, target: number, rate: number, delta: number): number {
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

function updateDriveInputRelaxation(delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) {
    return;
  }
  const target = steeringKeyboardTarget.value;
  const keyboardRate = target === 0 ? STEERING_KEYBOARD_RETURN_SPEED : STEERING_KEYBOARD_CATCH_SPEED;
  const nextKeyboard = approachAxisValue(steeringKeyboardValue.value, target, keyboardRate, delta);
  if (nextKeyboard !== steeringKeyboardValue.value) {
    steeringKeyboardValue.value = clampAxisScalar(nextKeyboard);
    recomputeVehicleDriveInputs();
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

function getViewportHeight(): number {
  if (typeof window !== 'undefined' && Number.isFinite(window.innerHeight)) {
    return window.innerHeight;
  }
  return initialSystemInfo?.windowHeight ?? initialSystemInfo?.screenHeight ?? 0;
}

function shouldActivateDrivePad(clientY: number): boolean {
  const height = drivePadViewportRect.height > 0 ? drivePadViewportRect.height : getViewportHeight();
  if (height <= 0) {
    return true;
  }
  // Activate only when touching the bottom third of the viewport
  return clientY >= drivePadViewportRect.top + (height * 2) / 3;
}

function updateDrivePadViewportRect(target: EventTarget | null): void {
  const element = target as { getBoundingClientRect?: () => DOMRect | ClientRect } | null;
  if (element && typeof element.getBoundingClientRect === 'function') {
    const rect = element.getBoundingClientRect();
    if (rect) {
      drivePadViewportRect.top = rect.top ?? 0;
      drivePadViewportRect.left = rect.left ?? 0;
      drivePadViewportRect.height = rect.height ?? getViewportHeight();
      return;
    }
  }
  drivePadViewportRect.top = 0;
  drivePadViewportRect.left = 0;
  drivePadViewportRect.height = getViewportHeight();
}

function toDrivePadLocalCoords(x: number, y: number): { x: number; y: number } {
  return {
    x: x - drivePadViewportRect.left,
    y: y - drivePadViewportRect.top,
  };
}

function cancelDrivePadFade(): void {
  if (drivePadFadeTimer) {
    clearTimeout(drivePadFadeTimer);
    drivePadFadeTimer = null;
  }
}

function summonDrivePadAt(x: number, y: number): void {
  cancelDrivePadFade();
  drivePadState.x = x;
  drivePadState.y = y;
  drivePadState.visible = true;
  drivePadState.fading = false;
}

function scheduleDrivePadFade(): void {
  if (!drivePadState.visible) {
    return;
  }
  drivePadState.fading = true;
  cancelDrivePadFade();
  drivePadFadeTimer = setTimeout(() => {
    drivePadState.visible = false;
    drivePadState.fading = false;
    drivePadFadeTimer = null;
  }, DRIVE_PAD_FADE_MS);
}

function hideDrivePadImmediate(): void {
  if (!drivePadState.visible && !drivePadState.fading) {
    return;
  }
  cancelDrivePadFade();
  drivePadState.visible = false;
  drivePadState.fading = false;
}

function cancelVehicleSmoothStop(): void {
  vehicleDriveController.clearSmoothStop();
}

function requestVehicleSmoothStop(): void {
  if (!vehicleDriveActive.value) {
    return;
  }
  if (Math.abs(vehicleDriveInput.throttle) > VEHICLE_SMOOTH_STOP_MIN_THROTTLE) {
    return;
  }
  if (vehicleSpeed.value <= VEHICLE_SMOOTH_STOP_TRIGGER_SPEED) {
    return;
  }
  vehicleDriveController.requestSmoothStop({ initialSpeed: vehicleSpeed.value });
}

function handleDrivePadTouchStart(event: TouchEvent): void {
  if (!vehicleDriveUi.value.visible) {
    return;
  }
  updateDrivePadViewportRect(event.currentTarget);
  const touch = event.changedTouches?.[0] ?? null;
  const coords = getTouchCoordinates(touch);
  if (!coords) {
    return;
  }
  if (!shouldActivateDrivePad(coords.y)) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  const localCoords = toDrivePadLocalCoords(coords.x, coords.y);
  cancelVehicleSmoothStop();
  summonDrivePadAt(localCoords.x, localCoords.y);
  handleJoystickTouchStart(event);
}

function handleDrivePadTouchMove(event: TouchEvent): void {
  if (joystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, joystickState.pointerId);
  if (!touch) {
    return;
  }
  handleJoystickTouchMove(event);
}

function handleDrivePadTouchEnd(event: TouchEvent): void {
  if (joystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, joystickState.pointerId);
  if (!touch) {
    return;
  }
  handleJoystickTouchEnd(event);
  scheduleDrivePadFade();
}

function attachDrivePadMouseListeners(): void {
  if (!isBrowserEnvironment || drivePadMouseTracking) {
    return;
  }
  drivePadMouseTracking = true;
  window.addEventListener('mousemove', handleDrivePadMouseMove);
  window.addEventListener('mouseup', handleDrivePadMouseUp);
  window.addEventListener('blur', handleDrivePadMouseUp);
}

function detachDrivePadMouseListeners(): void {
  if (!isBrowserEnvironment || !drivePadMouseTracking) {
    return;
  }
  drivePadMouseTracking = false;
  window.removeEventListener('mousemove', handleDrivePadMouseMove);
  window.removeEventListener('mouseup', handleDrivePadMouseUp);
  window.removeEventListener('blur', handleDrivePadMouseUp);
}

function handleDrivePadMouseDown(event: MouseEvent): void {
  if (!vehicleDriveUi.value.visible || event.button !== 0) {
    return;
  }
  updateDrivePadViewportRect(event.currentTarget);
  const coords = { x: event.clientX, y: event.clientY };
  if (!shouldActivateDrivePad(coords.y)) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  const localCoords = toDrivePadLocalCoords(coords.x, coords.y);
  cancelVehicleSmoothStop();
  summonDrivePadAt(localCoords.x, localCoords.y);
  joystickState.pointerId = DRIVE_PAD_MOUSE_POINTER_ID;
  joystickState.active = true;
  joystickState.ready = false;
  setJoystickVector(0, 0);
  applyJoystickFromPoint(coords.x, coords.y);
  attachDrivePadMouseListeners();
}

function handleDrivePadMouseMove(event: MouseEvent): void {
  if (joystickState.pointerId !== DRIVE_PAD_MOUSE_POINTER_ID) {
    return;
  }
  event.preventDefault();
  applyJoystickFromPoint(event.clientX, event.clientY);
}

function handleDrivePadMouseUp(): void {
  if (joystickState.pointerId === DRIVE_PAD_MOUSE_POINTER_ID) {
    deactivateJoystick(true);
    requestVehicleSmoothStop();
    scheduleDrivePadFade();
  }
  detachDrivePadMouseListeners();
  hideDrivePadImmediate();
}

function handleJoystickTouchStart(event: TouchEvent): void {
  if (!vehicleDriveActive.value) {
    return;
  }
  const touch = event.changedTouches?.[0] ?? null;
  if (!touch) {
    return;
  }
  if (!joystickState.ready) {
    refreshJoystickMetrics();
  }
  const coords = getTouchCoordinates(touch);
  if (!coords) {
    return;
  }
  joystickState.pointerId = touch.identifier;
  joystickState.active = true;
  cancelVehicleSmoothStop();
  applyJoystickFromPoint(coords.x, coords.y);
}

function handleJoystickTouchMove(event: TouchEvent): void {
  if (!joystickState.active || joystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, joystickState.pointerId);
  if (!touch) {
    return;
  }
  const coords = getTouchCoordinates(touch);
  if (!coords) {
    return;
  }
  applyJoystickFromPoint(coords.x, coords.y);
}

function handleJoystickTouchEnd(event: TouchEvent): void {
  if (joystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, joystickState.pointerId);
  if (!touch) {
    return;
  }
  deactivateJoystick(true);
  requestVehicleSmoothStop();
}

function recomputeVehicleDriveInputs(): void {
  const joystickInput = resolveJoystickDriveInput();
  const throttleFromJoystick = clampAxisScalar(joystickInput.throttle);
  const steeringFromJoystick = clampAxisScalar(joystickInput.steering);
  // Keep joystick contribution, then let controller clamp and merge with flags/keyboard.
  vehicleDriveInput.throttle = throttleFromJoystick;
  vehicleDriveInput.steering = -steeringFromJoystick;
  vehicleDriveInput.brake = vehicleDriveInputFlags.brake ? 1 : 0;
  vehicleDriveController.recomputeInputs();
}

function resetVehicleDriveInputs(): void {
  steeringKeyboardTarget.value = 0;
  deactivateJoystick(true);
  vehicleDriveController.resetInputs();
}

type VehicleDriveStartResult =
  | { success: true }
  | { success: false; message: string };


function startVehicleDriveMode(
  event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>,
): VehicleDriveStartResult {
  const ctx = renderContext
    ? { camera: renderContext.camera, mapControls: renderContext.controls }
    : { camera: null as THREE.PerspectiveCamera | null };
  const result = vehicleDriveController.startDrive(event, ctx);
  if (result.success) {
    vehicleDriveCameraFollowState.initialized = false;
    purposeActiveMode.value = 'watch';
    updateVehicleDriveCamera(0, { immediate: true });
  }
  return result;
}

function applyVehicleDriveForces(deltaSeconds: number): void {
  vehicleDriveController.applyForces(deltaSeconds);
}

function resolveNorthDirectionAngleDegrees(direction: EnvironmentNorthDirection | null | undefined): number {
  switch (direction ?? DEFAULT_ENVIRONMENT_NORTH_DIRECTION) {
    case '-X':
      return 180;
    case '+Z':
      return 90;
    case '-Z':
      return 270;
    case '+X':
    default:
      return 0;
  }
}

function updateVehicleSpeedFromVehicle(): void {
  const vehicle = vehicleDriveVehicle;
  const chassisBody = vehicle?.chassisBody ?? null;
  const velocity = chassisBody?.velocity ?? null;
  if (chassisBody && velocity) {
    vehicleCompassQuaternion.set(
      chassisBody.quaternion.x,
      chassisBody.quaternion.y,
      chassisBody.quaternion.z,
      chassisBody.quaternion.w,
    );
    vehicleCompassForward.set(1, 0, 0).applyQuaternion(vehicleCompassQuaternion);
    vehicleCompassForward.y = 0;

    const horizontalLengthSq =
      vehicleCompassForward.x * vehicleCompassForward.x
      + vehicleCompassForward.z * vehicleCompassForward.z;
    if (horizontalLengthSq > 1e-8) {
      vehicleCompassForward.multiplyScalar(1 / Math.sqrt(horizontalLengthSq));
      const worldHeadingDegrees = THREE.MathUtils.radToDeg(
        Math.atan2(vehicleCompassForward.z, vehicleCompassForward.x),
      );
      const northDirectionAngleDegrees = resolveNorthDirectionAngleDegrees(activeEnvironmentSettings.northDirection);
      vehicleHeadingDegrees.value = (worldHeadingDegrees - northDirectionAngleDegrees + 360) % 360;
    }

    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
    vehicleSpeed.value = Number.isFinite(speed) ? speed : 0;
    return;
  }

  const transformSpeed = vehicleDriveController.getCurrentSpeed();
  vehicleSpeed.value = Number.isFinite(transformSpeed) ? transformSpeed : 0;

  const driveNodeId = vehicleDriveNodeId.value;
  const driveObject = driveNodeId ? nodeObjectMap.get(driveNodeId) ?? null : null;
  if (!driveObject) {
    vehicleHeadingDegrees.value = 0;
    return;
  }

  driveObject.updateMatrixWorld(true);
  driveObject.getWorldQuaternion(vehicleCompassQuaternion);
  vehicleCompassForward.set(1, 0, 0).applyQuaternion(vehicleCompassQuaternion);
  vehicleCompassForward.y = 0;
  const horizontalLengthSq =
    vehicleCompassForward.x * vehicleCompassForward.x
    + vehicleCompassForward.z * vehicleCompassForward.z;
  if (horizontalLengthSq > 1e-8) {
    vehicleCompassForward.multiplyScalar(1 / Math.sqrt(horizontalLengthSq));
    const worldHeadingDegrees = THREE.MathUtils.radToDeg(
      Math.atan2(vehicleCompassForward.z, vehicleCompassForward.x),
    );
    const northDirectionAngleDegrees = resolveNorthDirectionAngleDegrees(activeEnvironmentSettings.northDirection);
    vehicleHeadingDegrees.value = (worldHeadingDegrees - northDirectionAngleDegrees + 360) % 360;
  }
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
  return vehicleDriveController.resetPose();
}


type VehicleDriveCameraUpdateOptions = {
  immediate?: boolean;
};


function updateVehicleDriveCamera(
  deltaSeconds = 0,
  options: VehicleDriveCameraUpdateOptions = {},
): boolean {
  const disableOrbitControlsForDriveFollow = vehicleDriveCameraMode.value === 'follow';
  const ctx = renderContext
    ? {
      camera: renderContext.camera,
      mapControls: disableOrbitControlsForDriveFollow ? undefined : renderContext.controls,
    }
    : { camera: null as THREE.PerspectiveCamera | null };
  return runWithProgrammaticCameraMutationAndAnchor(() =>
    vehicleDriveController.updateCamera(deltaSeconds, ctx, options),
  );
}

function updateAutoTourFollowCamera(deltaSeconds: number, options: { immediate?: boolean } = {}): boolean {
  const context = renderContext;
  if (!context) {
    return false;
  }

  // Sync active tours from runtime (covers script-triggered startTour/stopTour).
  if (deltaSeconds > 0) {
    autoTourActiveSyncAccumSeconds += deltaSeconds;
  }
  if (autoTourActiveSyncAccumSeconds >= 0.2 || !autoTourFollowNodeId.value) {
    autoTourActiveSyncAccumSeconds = 0;
    syncAutoTourActiveNodesFromRuntime(activeAutoTourNodeIds, previewNodeMap.keys(), autoTourRuntime);
  }

  const anyActive = activeAutoTourNodeIds.size > 0;
  if (autoTourLastAnyActive && !anyActive) {
    autoTourRotationOnlyHold.value = true;
  }
  if (anyActive) {
    autoTourRotationOnlyHold.value = false;
  }
  autoTourLastAnyActive = anyActive;
  applyAutoTourCameraInputPolicy();

  if (vehicleDriveActive.value || activeCameraWatchTween) {
    return false;
  }

  const nodeId = resolveAutoTourFollowNodeId(
    autoTourFollowNodeId.value,
    cameraViewState.targetNodeId,
    activeAutoTourNodeIds,
    previewNodeMap.keys(),
    autoTourRuntime,
  );
  if (!nodeId) {
    if (autoTourFollowNodeId.value) {
      autoTourFollowNodeId.value = null;
      resetAutoTourCameraFollowState();
    }
    return false;
  }
  if (autoTourFollowNodeId.value !== nodeId) {
    autoTourFollowNodeId.value = nodeId;
    resetAutoTourCameraFollowState();
  }

  const object = nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return false;
  }

  resolveAutoTourCameraFollowAnchor(object);

  // If auto-tour is paused, freeze camera follow placement (do not update placement/velocity).
  if (autoTourPaused.value) {
    autoTourCameraFollowVelocity.set(0, 0, 0);
    autoTourCameraFollowLastAnchor.copy(autoTourCameraFollowAnchorScratch);
    autoTourCameraFollowHasSample = true;
    return false;
  }

  // Speed differencing lookahead: compute planar velocity from anchor delta, then smooth.
  if (deltaSeconds > 0 && autoTourCameraFollowHasSample) {
    autoTourCameraFollowVelocityScratch
      .copy(autoTourCameraFollowAnchorScratch)
      .sub(autoTourCameraFollowLastAnchor)
      .multiplyScalar(1 / Math.max(1e-6, deltaSeconds));

    const alpha = computeFollowLerpAlpha(deltaSeconds, 8);
    autoTourCameraFollowVelocity.lerp(autoTourCameraFollowVelocityScratch, alpha);
  } else if (options.immediate) {
    autoTourCameraFollowVelocity.set(0, 0, 0);
  }

  // Desired forward: prefer planar movement direction (asset-forward is unreliable across models).
  if (autoTourCameraFollowVelocity.lengthSq() > 1e-6) {
    autoTourCameraFollowForwardScratch.set(autoTourCameraFollowVelocity.x, 0, autoTourCameraFollowVelocity.z);
  } else {
    object.getWorldDirection(autoTourCameraFollowForwardScratch);
    autoTourCameraFollowForwardScratch.y = 0;
  }
  if (autoTourCameraFollowForwardScratch.lengthSq() < 1e-8) {
    autoTourCameraFollowForwardScratch.set(0, 0, 1);
  } else {
    autoTourCameraFollowForwardScratch.normalize();
  }

  const placement = computeFollowPlacement(getApproxDimensions(object));

  if (autoTourResumeBlendActive && autoTourResumeBlendNodeId === nodeId && !options.immediate) {
    seedAutoTourCameraFollowStateFromView(
      autoTourResumeBlendState,
      autoTourResumeBlendStartPosition,
      autoTourResumeBlendStartTarget,
      autoTourCameraFollowAnchorScratch,
      autoTourCameraFollowForwardScratch,
    );
    autoTourResumeBlendTempCamera.position.copy(autoTourResumeBlendStartPosition);
    autoTourResumeBlendTempCamera.up.copy(context.camera.up);
    autoTourResumeBlendTempControlsTarget.copy(autoTourResumeBlendStartTarget);
    autoTourResumeBlendController.update({
      follow: autoTourResumeBlendState,
      placement,
      anchorWorld: autoTourCameraFollowAnchorScratch,
      desiredForwardWorld: autoTourCameraFollowForwardScratch,
      velocityWorld: autoTourCameraFollowVelocity,
      deltaSeconds: 1 / 60,
      ctx: { camera: autoTourResumeBlendTempCamera, mapControls: autoTourResumeBlendTempControls },
      immediate: true,
    });

    autoTourResumeBlendElapsedSeconds += Math.max(0, deltaSeconds);
    const rawAlpha = AUTO_TOUR_RESUME_BLEND_SECONDS <= 1e-6
      ? 1
      : Math.min(1, autoTourResumeBlendElapsedSeconds / AUTO_TOUR_RESUME_BLEND_SECONDS);
    const alpha = 1 - Math.pow(1 - rawAlpha, 3);

    autoTourCameraFollowState.currentPosition.lerpVectors(
      autoTourResumeBlendStartPosition,
      autoTourResumeBlendState.currentPosition,
      alpha,
    );
    autoTourCameraFollowState.currentTarget.lerpVectors(
      autoTourResumeBlendStartTarget,
      autoTourResumeBlendState.currentTarget,
      alpha,
    );
    autoTourCameraFollowState.desiredPosition.copy(autoTourResumeBlendState.currentPosition);
    autoTourCameraFollowState.desiredTarget.copy(autoTourResumeBlendState.currentTarget);
    autoTourCameraFollowState.currentAnchor.copy(autoTourCameraFollowAnchorScratch);
    autoTourCameraFollowState.desiredAnchor.copy(autoTourCameraFollowAnchorScratch);
    autoTourCameraFollowState.heading.copy(autoTourResumeBlendState.heading);
    autoTourCameraFollowState.localOffset.copy(autoTourResumeBlendState.localOffset);
    autoTourCameraFollowState.hasLocalOffset = autoTourResumeBlendState.hasLocalOffset;
    autoTourCameraFollowState.initialized = true;
    autoTourCameraFollowLastAnchor.copy(autoTourCameraFollowAnchorScratch);
    autoTourCameraFollowHasSample = true;

    const updated = runWithProgrammaticCameraMutationAndAnchor(() => {
      context.camera.position.copy(autoTourCameraFollowState.currentPosition);
      context.controls.target.copy(autoTourCameraFollowState.currentTarget);
      context.controls.update();
      context.camera.lookAt(context.controls.target);
      return true;
    });

    if (rawAlpha >= 1) {
      clearAutoTourResumeBlendState();
    }

    return updated;
  }

  const updated = runWithProgrammaticCameraMutationAndAnchor(() =>
    autoTourCameraFollowController.update({
      follow: autoTourCameraFollowState,
      placement,
      anchorWorld: autoTourCameraFollowAnchorScratch,
      desiredForwardWorld: autoTourCameraFollowForwardScratch,
      velocityWorld: autoTourCameraFollowVelocity,
      deltaSeconds,
      ctx: { camera: context.camera, mapControls: context.controls },
      immediate: Boolean(options.immediate),
    }),
  );

  autoTourCameraFollowLastAnchor.copy(autoTourCameraFollowAnchorScratch);

  return updated;
}


function restoreVehicleDriveCameraState(): void {
  const ctx = renderContext
    ? { camera: renderContext.camera, mapControls: renderContext.controls }
    : { camera: null as THREE.PerspectiveCamera | null };
  vehicleDriveCameraRestoreState.viewMode = cameraViewState.mode;
  vehicleDriveCameraRestoreState.viewTargetId = cameraViewState.targetNodeId;
  vehicleDriveCameraRestoreState.isCameraCaged = isCameraCaged.value;
  vehicleDriveCameraRestoreState.purposeMode = purposeActiveMode.value;
  vehicleDriveController.restoreCamera(ctx);
}

function resolveAutoTourVehicleBrakeForce(nodeId: string): number {
  const node = resolveNodeById(nodeId);
  const vehicle = resolveEnabledComponentState<any>(node, VEHICLE_COMPONENT_TYPE);
  const brakeForceMax = vehicle
    ? clampVehicleComponentProps(vehicle.props).brakeForceMax
    : clampVehicleComponentProps(null).brakeForceMax;
  return brakeForceMax * 6;
}

function applyAutoTourVehicleHoldBrake(nodeId: string): void {
  const vehicleInstance = vehicleInstances.get(nodeId) ?? null;
  if (!vehicleInstance) {
    return;
  }
  const brakeForce = resolveAutoTourVehicleBrakeForce(nodeId);
  holdVehicleBrakeSafe({ vehicleInstance, brakeForce });
  try {
    const chassisBody = vehicleInstance.vehicle.chassisBody;
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    trySleepBody(chassisBody);
  } catch {
    // best-effort
  }
}

function applyAutoTourRigidBodyStop(nodeId: string): void {
  const entry = rigidbodyInstances.get(nodeId) ?? null;
  if (!entry) {
    return;
  }
  try {
    if (entry.object) {
      syncSharedBodyFromObject(entry.body, entry.object, entry.orientationAdjustment);
    }
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    entry.body.sleep?.();
  } catch {
    // best-effort
  }
}

function applyAutoTourPauseForActiveNodes(): void {
  const manualNodeId = vehicleDriveNodeId.value ?? null;
  activeAutoTourNodeIds.forEach((nodeId) => {
    if (manualNodeId && manualNodeId === nodeId) {
      return;
    }
    applyAutoTourVehicleHoldBrake(nodeId);
    applyAutoTourRigidBodyStop(nodeId);
  });
}

function applyAutoTourSnapToVehicle(nodeId: string, snap: AutoTourRouteSnapResult): THREE.Object3D | null {
  const node = resolveNodeById(nodeId);
  const object = nodeObjectMap.get(nodeId) ?? null;
  const rigidbodyEntry = rigidbodyInstances.get(nodeId) ?? null;
  const vehicleInstance = vehicleInstances.get(nodeId) ?? null;
  if (!node || !object) {
    return null;
  }

  autoTourSnapWorldQuaternion.setFromAxisAngle(autoTourSnapWorldUp, snap.yaw);
  autoTourSnapWorldPosition.copy(snap.worldPosition);
  const chassisBody = vehicleInstance?.vehicle?.chassisBody ?? null;
  const currentChassisY = chassisBody && Number.isFinite(chassisBody.position.y)
    ? chassisBody.position.y
    : object.getWorldPosition(autoTourSnapLocalPosition).y;
  if (Number.isFinite(currentChassisY)) {
    autoTourSnapWorldPosition.y = currentChassisY;
  }
  applyObjectWorldPose(object, autoTourSnapWorldPosition, autoTourSnapWorldQuaternion);
  syncSceneNodeLocalTransformFromObject(node, object);
  syncInstancedTransform(object, true);

  if (rigidbodyEntry) {
    syncSharedBodyFromObject(rigidbodyEntry.body, object, rigidbodyEntry.orientationAdjustment);
    rigidbodyEntry.body.velocity.set(0, 0, 0);
    rigidbodyEntry.body.angularVelocity.set(0, 0, 0);
    resetPhysicsInterpolationState(rigidbodyEntry.body);
    trySleepBody(rigidbodyEntry.body);
  }

  if (vehicleInstance && chassisBody) {
    const brakeForce = resolveAutoTourVehicleBrakeForce(nodeId);
    const wheelCount = Math.max(0, vehicleInstance.wheelCount || vehicleInstance.vehicle.wheelInfos.length || 0);
    for (let index = 0; index < wheelCount; index += 1) {
      vehicleInstance.vehicle.applyEngineForce(0, index);
      vehicleInstance.vehicle.setSteeringValue(0, index);
      vehicleInstance.vehicle.setBrake(brakeForce, index);
    }
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    resetPhysicsInterpolationState(chassisBody);
    holdVehicleBrakeSafe({ vehicleInstance, brakeForce });
    trySleepBody(chassisBody);
  }

  return object;
}

function buildFloatingAutoTourDriveEvent(
  nodeId: string,
  sourceEvent: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null,
): Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> {
  if (sourceEvent) {
    return {
      ...sourceEvent,
      targetNodeId: sourceEvent.targetNodeId ?? nodeId,
      nodeId: sourceEvent.nodeId ?? nodeId,
    };
  }
  return {
    type: 'vehicle-drive',
    nodeId,
    action: 'click',
    sequenceId: '__floating-auto-tour__',
    behaviorSequenceId: '__floating-auto-tour__',
    behaviorId: '__floating-auto-tour__',
    targetNodeId: nodeId,
    seatNodeId: null,
    token: `floating-auto-tour:${nodeId}`,
  };
}

function stopFloatingAutoTourAndResumeManualDrive(
  nodeId: string,
  sourceEvent: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null,
): boolean {
  autoTourPaused.value = false;
  autoTourPausedIsTerminal.value = false;
  autoTourPausedNodeId.value = null;
  autoTourRotationOnlyHold.value = false;
  clearAutoTourPausedCameraSnapshot();
  clearAutoTourResumeBlendState();
  stopTourAndUnfollow(autoTourRuntime, nodeId, (activeNodeId) => {
    activeAutoTourNodeIds.delete(activeNodeId);
    if (autoTourFollowNodeId.value === activeNodeId) {
      autoTourFollowNodeId.value = null;
    }
    resetAutoTourCameraFollowState();
  });

  const driveEvent = buildFloatingAutoTourDriveEvent(nodeId, sourceEvent);
  const result = startVehicleDriveMode(driveEvent);
  if (!result.success) {
    const message = result.message ?? '无法返回手动驾驶模式';
    uni.showToast({ title: message, icon: 'none' });
    applyAutoTourCameraInputPolicy();
    return false;
  }

  activeVehicleDriveEvent.value = driveEvent;
  vehicleDrivePromptBusy.value = false;
  handleShowVehicleCockpitEvent();
  applyAutoTourCameraInputPolicy();
  return true;
}

function handleFloatingAutoTourTap(): void {
  const button = floatingAutoTourButton.value;
  if (!button.visible || button.disabled || !button.nodeId) {
    return;
  }

  const targetNodeId = button.nodeId;
  if (button.active) {
    vehicleDrivePromptBusy.value = true;
    try {
      stopFloatingAutoTourAndResumeManualDrive(targetNodeId, button.event);
    } finally {
      vehicleDrivePromptBusy.value = false;
    }
    return;
  }

  const node = resolveNodeById(targetNodeId);
  if (!node || !resolveAutoTourComponent(node)) {
    uni.showToast({ title: '目标未启用自动巡游组件', icon: 'none' });
    return;
  }

  if (!nodeObjectMap.has(targetNodeId)) {
    uni.showToast({ title: '未找到车辆对象', icon: 'none' });
    return;
  }

  const snap = autoTourRuntime.resolveRouteSnap(targetNodeId);
  if (!snap) {
    uni.showToast({ title: '未找到绑定 Guide Route', icon: 'none' });
    return;
  }

  vehicleDrivePromptBusy.value = true;
  try {
    activeCameraWatchTween = null;
    autoTourPaused.value = false;
    autoTourPausedIsTerminal.value = false;
    autoTourPausedNodeId.value = null;
    clearAutoTourPausedCameraSnapshot();
    clearAutoTourResumeBlendState();

    if (vehicleDriveActive.value) {
      handleHideVehicleCockpitEvent();
      vehicleDriveController.stopDrive(
        { resolution: { type: 'continue' }, preserveCamera: true },
        renderContext ? { camera: renderContext.camera, mapControls: renderContext.controls } : { camera: null },
      );
    }

    resetVehicleDriveInputs();
    setVehicleDriveUiOverride('hide');

    const snappedObject = applyAutoTourSnapToVehicle(targetNodeId, snap);
    if (!snappedObject) {
      uni.showToast({ title: '无法同步车辆位置', icon: 'none' });
      return;
    }

    autoTourRuntime.startTour(targetNodeId);
    autoTourRuntime.seedTourPlaybackState(targetNodeId, snap);
    activeAutoTourNodeIds.add(targetNodeId);
    autoTourFollowNodeId.value = targetNodeId;
    primeAutoTourCameraFollowTransition(snappedObject, snap.forwardWorld);
    setCameraViewState('watching', targetNodeId);
    autoTourRotationOnlyHold.value = false;
    setCameraCaging(true);
    applyAutoTourCameraInputPolicy();
    updateAutoTourFollowCamera(1 / 60);

    const pendingEvent = pendingVehicleDriveEvent.value;
    if (pendingEvent && (pendingEvent.targetNodeId ?? pendingEvent.nodeId ?? null) === targetNodeId) {
      if (pendingEvent.token) {
        resolveBehaviorToken(pendingEvent.token, { type: 'continue' });
      }
      pendingVehicleDriveEvent.value = null;
    }
  } finally {
    vehicleDrivePromptBusy.value = false;
  }
}

function handleFloatingAutoTourPauseToggleTap(): void {
  const button = floatingAutoTourPauseButton.value;
  if (!button.visible || button.disabled || !button.nodeId) {
    return;
  }

  const targetNodeId = button.nodeId;
  if (!activeAutoTourNodeIds.has(targetNodeId)) {
    return;
  }

  const nextPaused = !autoTourPaused.value;
  if (!nextPaused) {
    prepareAutoTourResumeFromCurrentCamera(targetNodeId);
    if (autoTourPausedIsTerminal.value && autoTourPausedNodeId.value === targetNodeId) {
      autoTourRuntime.continueFromEnd(targetNodeId);
    }
    autoTourPausedIsTerminal.value = false;
    autoTourPausedNodeId.value = null;
    autoTourPaused.value = false;
    clearAutoTourPausedCameraSnapshot();
    applyAutoTourCameraInputPolicy();
    return;
  }

  captureAutoTourPausedCameraSnapshot(targetNodeId);
  autoTourPausedIsTerminal.value = false;
  autoTourPausedNodeId.value = null;
  autoTourPaused.value = true;
  clearAutoTourResumeBlendState();
  applyAutoTourPauseForActiveNodes();
  applyAutoTourCameraInputPolicy();
  reapplyAutoTourPausedCameraSnapshot(targetNodeId);
}

function pauseAutoTourForInspection(targetNodeId: string): void {
  if (!activeAutoTourNodeIds.has(targetNodeId)) {
    return;
  }
  captureAutoTourPausedCameraSnapshot(targetNodeId);
  autoTourPausedIsTerminal.value = false;
  autoTourPausedNodeId.value = null;
  autoTourPaused.value = true;
  clearAutoTourResumeBlendState();
  applyAutoTourPauseForActiveNodes();
  applyAutoTourCameraInputPolicy();
  reapplyAutoTourPausedCameraSnapshot(targetNodeId);
}

function prepareAutoTourResumeFromCurrentCamera(targetNodeId: string): void {
  const context = renderContext;
  const object = nodeObjectMap.get(targetNodeId) ?? null;
  if (!context || !object) {
    return;
  }

  autoTourCameraFollowForwardScratch.set(0, 0, 0);
  const chassisBody = vehicleInstances.get(targetNodeId)?.vehicle?.chassisBody ?? null;
  const velocity = chassisBody?.velocity ?? null;
  if (velocity) {
    autoTourCameraFollowForwardScratch.set(velocity.x, 0, velocity.z);
  }
  if (autoTourCameraFollowForwardScratch.lengthSq() < 1e-8) {
    object.getWorldDirection(autoTourCameraFollowForwardScratch);
    autoTourCameraFollowForwardScratch.y = 0;
  }
  if (autoTourCameraFollowForwardScratch.lengthSq() < 1e-8) {
    autoTourCameraFollowForwardScratch.set(0, 0, 1);
  } else {
    autoTourCameraFollowForwardScratch.normalize();
  }

  resolveAutoTourCameraFollowAnchor(object);
  autoTourResumeBlendStartPosition.copy(context.camera.position);
  autoTourResumeBlendStartTarget.copy(context.controls.target);
  seedAutoTourCameraFollowStateFromView(
    autoTourResumeBlendState,
    autoTourResumeBlendStartPosition,
    autoTourResumeBlendStartTarget,
    autoTourCameraFollowAnchorScratch,
    autoTourCameraFollowForwardScratch,
  );
  autoTourResumeBlendTempCamera.position.copy(autoTourResumeBlendStartPosition);
  autoTourResumeBlendTempCamera.up.copy(context.camera.up);
  autoTourResumeBlendTempControlsTarget.copy(autoTourResumeBlendStartTarget);
  const placement = computeFollowPlacement(getApproxDimensions(object));
  autoTourResumeBlendController.update({
    follow: autoTourResumeBlendState,
    placement,
    anchorWorld: autoTourCameraFollowAnchorScratch,
    desiredForwardWorld: autoTourCameraFollowForwardScratch,
    velocityWorld: autoTourCameraFollowVelocity,
    deltaSeconds: 1 / 60,
    ctx: { camera: autoTourResumeBlendTempCamera, mapControls: autoTourResumeBlendTempControls },
    immediate: true,
  });

  autoTourCameraFollowState.currentPosition.copy(autoTourResumeBlendStartPosition);
  autoTourCameraFollowState.currentTarget.copy(autoTourResumeBlendStartTarget);
  autoTourCameraFollowState.desiredPosition.copy(autoTourResumeBlendState.currentPosition);
  autoTourCameraFollowState.desiredTarget.copy(autoTourResumeBlendState.currentTarget);
  autoTourCameraFollowState.currentAnchor.copy(autoTourCameraFollowAnchorScratch);
  autoTourCameraFollowState.desiredAnchor.copy(autoTourCameraFollowAnchorScratch);
  autoTourCameraFollowState.heading.copy(autoTourResumeBlendState.heading);
  autoTourCameraFollowState.localOffset.copy(autoTourResumeBlendState.localOffset);
  autoTourCameraFollowState.hasLocalOffset = autoTourResumeBlendState.hasLocalOffset;
  autoTourCameraFollowState.initialized = true;
  autoTourCameraFollowVelocity.set(0, 0, 0);
  autoTourCameraFollowLastAnchor.copy(autoTourCameraFollowAnchorScratch);
  autoTourCameraFollowHasSample = true;
  autoTourResumeBlendActive = true;
  autoTourResumeBlendElapsedSeconds = 0;
  autoTourResumeBlendNodeId = targetNodeId;
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
    vehicleDriveController.stopDrive(
      { resolution: { type: 'abort', message: '驾驶状态被新的脚本替换。' }, preserveCamera: true },
      renderContext ? { camera: renderContext.camera, mapControls: renderContext.controls } : { camera: null },
    );
  }
  if (pendingVehicleDriveEvent.value) {
    resolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
      type: 'abort',
      message: '已有驾驶请求已取消。',
    });
  }
  if (activeAutoTourNodeIds.has(targetNodeId)) {
    pendingVehicleDriveEvent.value = null;
    vehicleDrivePromptBusy.value = false;
    setVehicleDriveUiOverride('hide');
    resetVehicleDriveInputs();
    vehicleDriveExitBusy.value = false;
    pauseAutoTourForInspection(targetNodeId);
    if (event.token) {
      resolveBehaviorToken(event.token, { type: 'continue' });
    }
    return;
  }
  pendingVehicleDriveEvent.value = null;
  vehicleDrivePromptBusy.value = true;
  setVehicleDriveUiOverride('hide');
  resetVehicleDriveInputs();
  vehicleDriveExitBusy.value = false;
  try {
    if (activeAutoTourNodeIds.has(targetNodeId)) {
      stopTourAndUnfollow(autoTourRuntime, targetNodeId, (n) => {
        activeAutoTourNodeIds.delete(n);
        if (autoTourFollowNodeId.value === n) {
          autoTourFollowNodeId.value = null;
          resetAutoTourCameraFollowState();
        }
      });
    }
    const result = startVehicleDriveMode(event);
    if (!result.success) {
      const message = result.message ?? '无法进入驾驶模式';
      uni.showToast({ title: message, icon: 'none' });
      resolveBehaviorToken(event.token, { type: 'fail', message });
      return;
    }
    handleShowVehicleCockpitEvent();
  } finally {
    vehicleDrivePromptBusy.value = false;
  }
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
  vehicleDriveController.stopDrive(
    { resolution: { type: 'continue' }, preserveCamera: false },
    renderContext ? { camera: renderContext.camera, mapControls: renderContext.controls } : { camera: null },
  );
  setVehicleDriveUiOverride('hide');
  activeVehicleDriveEvent.value = null;
}

function handleShowVehicleCockpitEvent(): void {
  setVehicleDriveUiOverride('show');
}

function handleHideVehicleCockpitEvent(): void {
  setVehicleDriveUiOverride('hide');
}

const sceneStackVec3ToTuple = (value: THREE.Vector3): SceneStackVec3Tuple => [value.x, value.y, value.z];

const sceneStackApplyVec3Tuple = (target: THREE.Vector3, value: SceneStackVec3Tuple): void => {
  target.set(value[0], value[1], value[2]);
};

const sceneStackQuatToTuple = (value: THREE.Quaternion): SceneStackQuatTuple => [value.x, value.y, value.z, value.w];

const sceneStackApplyQuatTuple = (target: THREE.Quaternion, value: SceneStackQuatTuple): void => {
  target.set(value[0], value[1], value[2], value[3]);
};

function captureSceneNodeTransformSnapshot(): Record<string, SceneNodeTransformSnapshot> {
  const snapshot: Record<string, SceneNodeTransformSnapshot> = {};
  for (const [nodeId, node] of previewNodeMap.entries()) {
    const component = resolveEnabledComponentState(node, SCENE_STATE_ANCHOR_COMPONENT_TYPE);
    if (!component) {
      continue;
    }
    const object = nodeObjectMap.get(nodeId);
    if (!object) {
      continue;
    }
    snapshot[nodeId] = {
      position: sceneStackVec3ToTuple(object.position),
      quaternion: sceneStackQuatToTuple(object.quaternion),
      scale: sceneStackVec3ToTuple(object.scale),
    };
  }
  return snapshot;
}

function applySceneNodeTransformSnapshot(snapshot: Record<string, SceneNodeTransformSnapshot>): void {
  Object.entries(snapshot).forEach(([nodeId, transform]) => {
    const object = nodeObjectMap.get(nodeId);
    if (!object) {
      return;
    }
    sceneStackApplyVec3Tuple(object.position, transform.position);
    sceneStackApplyQuatTuple(object.quaternion, transform.quaternion);
    sceneStackApplyVec3Tuple(object.scale, transform.scale);
    object.updateMatrixWorld(true);
  });
}

function captureViewControlSnapshot(): SceneViewControlSnapshot | null {
  const context = renderContext;
  if (!context) {
    return null;
  }
  const { camera, controls } = context;
  return {
    cameraViewState: {
      mode: cameraViewState.mode,
      targetNodeId: cameraViewState.targetNodeId,
    },
    isCameraCaged: isCameraCaged.value,
    purposeMode: purposeActiveMode.value,
    camera: {
      position: sceneStackVec3ToTuple(camera.position),
      quaternion: sceneStackQuatToTuple(camera.quaternion),
      up: sceneStackVec3ToTuple(camera.up),
    },
    orbitTarget: sceneStackVec3ToTuple(controls.target),
    nodeTransforms: captureSceneNodeTransformSnapshot(),
  };
}

function applyViewControlSnapshot(snapshot: SceneViewControlSnapshot): void {
  const context = renderContext;
  if (!context) {
    return;
  }
  const { camera, controls } = context;
  activeCameraWatchTween = null;

  runWithProgrammaticCameraMutationAndAnchor(() => {
    withControlsVerticalFreedom(controls, () => {
      sceneStackApplyVec3Tuple(camera.position, snapshot.camera.position);
      sceneStackApplyQuatTuple(camera.quaternion, snapshot.camera.quaternion);
      sceneStackApplyVec3Tuple(camera.up, snapshot.camera.up);
      sceneStackApplyVec3Tuple(controls.target, snapshot.orbitTarget);
      camera.lookAt(controls.target);
      controls.update();
    });
  });

  setCameraViewState(snapshot.cameraViewState.mode, snapshot.cameraViewState.targetNodeId);
  purposeActiveMode.value = snapshot.purposeMode;
  setCameraCaging(snapshot.isCameraCaged);
}

function saveCurrentSceneStateForMap(nextSceneId: string | null = null): void {
  const currentId = (currentSceneId.value ?? currentDocument?.id ?? '').trim();
  if (!currentId) {
    return;
  }
  const trimmedNextId = nextSceneId?.trim() ?? '';
  if (trimmedNextId && currentId === trimmedNextId) {
    return;
  }
  const view = captureViewControlSnapshot();
  if (!view) {
    return;
  }
  sceneStateById.set(currentId, view);
  if (trimmedNextId) {
    previousSceneById.set(trimmedNextId, currentId);
  }
}

async function waitForSceneReady(expectedSceneId: string, timeoutMs = 30000): Promise<void> {
  const expected = (expectedSceneId ?? '').trim();
  if (!expected) {
    return;
  }

  if (!loading.value && !sceneSwitching.value && currentSceneId.value === expected) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      stop();
      reject(new Error('等待场景初始化超时'));
    }, timeoutMs);

    const stop = watch(
      () => [loading.value, sceneSwitching.value, currentSceneId.value] as const,
      ([isLoading, isSwitching, sceneId]) => {
        if (!isLoading && !isSwitching && sceneId === expected) {
          clearTimeout(timeout);
          stop();
          resolve();
        }
      },
      { immediate: true },
    );
  });
}

async function handleLoadSceneEvent(event: Extract<BehaviorRuntimeEvent, { type: 'load-scene' }>): Promise<void> {
  const sceneId = (event.sceneId ?? '').trim();
  if (!sceneId) {
    console.warn('Load Scene behavior missing sceneId', event);
    return;
  }
  if (sceneSwitching.value) {
    return;
  }
  if (event.pushToStack === true) {
    saveCurrentSceneStateForMap(sceneId);
  }

  if (projectBundle.value) {
    await switchToProjectScene(sceneId);
    return;
  }

  // Non-project mode: do not depend on uni_modules routing.
  const message = '非 project 模式下不支持通过 Behavior 跳转场景（缺少 projectBundle）';
  console.warn(message, { sceneId, event });
  emit('error', message);
}

async function handleExitSceneEvent(): Promise<void> {
  if (sceneSwitching.value) {
    return;
  }
  const currentId = (currentSceneId.value ?? currentDocument?.id ?? '').trim();
  if (!currentId) {
    return;
  }
  const previousId = previousSceneById.get(currentId) ?? '';
  if (!previousId) {
    return;
  }
  const snapshot = sceneStateById.get(previousId);
  if (!snapshot) {
    return;
  }

  await switchToProjectScene(previousId);
  try {
    await waitForSceneReady(previousId);
  } catch (error) {
    console.warn('恢复场景失败：场景初始化未完成', error);
    return;
  }
  applyViewControlSnapshot(snapshot);
  applySceneNodeTransformSnapshot(snapshot.nodeTransforms);
}

function handlePunchEvent(event: Extract<BehaviorRuntimeEvent, { type: 'punch' }>): void {
  if (punchNodeIds.has(event.nodeId)) {
    const sceneId = resolveActivePunchSceneId();
    browserStoredPunchedNodeIds.value = sceneId
      ? mergeStoredPunchedNodeId(sceneId, event.nodeId)
      : Array.from(new Set([...browserStoredPunchedNodeIds.value, event.nodeId.trim()]));
    const next = new Set(punchedNodeIds.value);
    next.add(event.nodeId);
    punchedNodeIds.value = next;
  }
  const sceneId = (currentSceneId.value ?? currentDocument?.id ?? '').trim();
  const sceneName = (currentDocument?.name ?? '').trim();
  const node = previewNodeMap.get(event.nodeId);
  const nodeName = typeof node?.name === 'string' ? node.name : '';
  emit('punch', {
    eventName: 'punch',
    sceneId,
    sceneName,
    clientPunchTime: new Date().toISOString(),
    behaviorPunchTime: event.punchedAt,
    location: {
      nodeId: event.nodeId,
      nodeName,
    },
  });
}


function handleBehaviorRuntimeEvent(event: BehaviorRuntimeEvent) {
  switch (event.type) {
    case 'delay':
      handleDelayEvent(event);
      break;
    case 'move-camera':
      handleMoveCameraEvent(event);
      break;
    case 'show-bubble':
      presentBehaviorBubble(event);
      break;
    case 'play-sound':
      handlePlaySoundEvent(event);
      break;
    case 'show-alert':
      presentBehaviorAlert(event);
      break;
    case 'show-info-board':
      void presentInfoBoard(event);
      break;
    case 'hide-info-board':
      hideInfoBoard();
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
    case 'load-scene':
      void handleLoadSceneEvent(event);
      break;
    case 'exit-scene':
      void handleExitSceneEvent();
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
    case 'punch':
      handlePunchEvent(event);
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
    const raycastRoots: THREE.Object3D[] = [];
    if (sceneGraphRoot) {
      raycastRoots.push(sceneGraphRoot);
    }
    if (instancedMeshGroup) {
      raycastRoots.push(instancedMeshGroup);
    }
    if (!raycastRoots.length) {
      return;
    }
    raycastRoots.forEach((root) => root.updateMatrixWorld(true));
    // Ensure moved instanced meshes are pickable immediately by flushing any pending bounds updates.
    if (instancedBoundsHasPending()) {
      flushInstancedBounds();
    }
    const intersections = behaviorRaycaster.intersectObjects(raycastRoots, true);
    if (!intersections.length) {
      return;
    }
    for (const intersection of intersections) {
      const nodeId = resolveNodeIdFromIntersection(intersection);
      if (!nodeId) {
        continue;
      }
      if (!getBehaviorNodeVisible(nodeId)) {
        continue;
      }
      const directActions = listRegisteredBehaviorActions(nodeId);
      const behaviorTargetId = directActions.includes('click') ? nodeId : resolveClickBehaviorAncestorNodeId(nodeId);
      if (!behaviorTargetId) {
        continue;
      }
      const hitObject = nodeObjectMap.get(behaviorTargetId) ?? intersection.object;
      const results = triggerBehaviorAction(behaviorTargetId, 'click', {
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

function disposeHdriBackgroundResources() {
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

function disposeSkyCubeBackgroundResources() {
  const scene = renderContext?.scene ?? null;
  if (skyCubeTexture) {
    if (scene && scene.background === skyCubeTexture) {
      scene.background = null;
    }
    disposeSkyCubeTexture(skyCubeTexture);
  }
  skyCubeZipFaceUrlCleanup?.();
  skyCubeZipFaceUrlCleanup = null;
  skyCubeTexture = null;
  skyCubeSourceFormat = 'faces';
  skyCubeFaceAssetIds = null;
  skyCubeZipAssetId = null;
  if (skyCubeFaceTextureCleanup) {
    for (const dispose of skyCubeFaceTextureCleanup) {
      dispose?.();
    }
  }
  skyCubeFaceTextureCleanup = null;
}

function disposeBackgroundResources() {
  disposeHdriBackgroundResources();
  disposeSkyCubeBackgroundResources();
  disposeGradientBackgroundDome(gradientBackgroundDome);
  gradientBackgroundDome = null;
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
  const mimeType = resolve.mimeType ?? null;
  try {
    if (extension === 'exr' || (mimeType && mimeType.toLowerCase().includes('exr'))) {
      // EXR not supported in this environment; use texture loader fallback.
      const texture = await textureLoader.loadAsync(resolve.url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.flipY = false;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      ensureFloatTextureFilterCompatibility(texture);
      return { texture };
    }
    if (extension === 'hdr' || extension === 'hdri' || resolve.mimeType === 'image/vnd.radiance') {
      const hdrLoader = await createRgbELoader();
      const texture = await hdrLoader.loadAsync(resolve.url);
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

function applyFogSettings(settings: EnvironmentSettings) {
  const scene = renderContext?.scene ?? null;
  const camera = renderContext?.camera ?? null;
  if (!scene) {
    return;
  }
  const syncCameraFar = (nextFar: number) => {
    if (!camera || Math.abs(camera.far - nextFar) <= 1e-6) {
      return;
    }
    camera.far = nextFar;
    camera.updateProjectionMatrix();
    sceneCsmShadowRuntime?.updateFrustums();
    markInstancedCullingDirty();
  };
  if (settings.fogMode === 'none') {
    scene.fog = null;
    syncCameraFar(DEFAULT_SCENE_CAMERA_FAR);
    return;
  }
  const fogColor = new THREE.Color(settings.fogColor);
  if (settings.fogMode === 'linear') {
    const groundSize = resolveGroundViewportWorldSize();
    const adaptiveRange = resolveAdaptiveLinearFogRange({
      settings,
      groundWidth: groundSize?.width,
      groundDepth: groundSize?.depth,
      referenceFar: DEFAULT_SCENE_CAMERA_FAR,
    });
    const near = adaptiveRange ? adaptiveRange.fogNear : Math.max(0, settings.fogNear);
    const far = adaptiveRange ? adaptiveRange.fogFar : Math.max(near + 0.001, settings.fogFar);
    syncCameraFar(far);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(fogColor);
      scene.fog.near = near;
      scene.fog.far = far;
    } else {
      scene.fog = new THREE.Fog(fogColor, near, far);
    }
    return;
  }
  syncCameraFar(DEFAULT_SCENE_CAMERA_FAR);
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
  physicsEnvironmentEnabled.value = settings.physicsEnabled !== false;
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
  if (background.mode === 'solidColor') {
    const gradientTopColor = typeof background.gradientTopColor === 'string'
      ? background.gradientTopColor.trim()
      : '';

    disposeHdriBackgroundResources();
    disposeSkyCubeBackgroundResources();

    if (gradientTopColor) {
      if (!gradientBackgroundDome) {
        gradientBackgroundDome = createGradientBackgroundDome({
          topColor: gradientTopColor,
          bottomColor: background.solidColor,
          offset: background.gradientOffset ?? 33,
          exponent: background.gradientExponent ?? 0.6,
        });
        (gradientBackgroundDome.mesh as any).raycast = () => {};
        scene.add(gradientBackgroundDome.mesh);
      } else {
        gradientBackgroundDome.uniforms.topColor.value.set(gradientTopColor);
        gradientBackgroundDome.uniforms.bottomColor.value.set(background.solidColor);
        if (typeof background.gradientOffset === 'number' && Number.isFinite(background.gradientOffset)) {
          gradientBackgroundDome.uniforms.offset.value = background.gradientOffset;
        }
        if (typeof background.gradientExponent === 'number' && Number.isFinite(background.gradientExponent)) {
          gradientBackgroundDome.uniforms.exponent.value = background.gradientExponent;
        }
      }
      scene.background = null;
      return true;
    }

    disposeGradientBackgroundDome(gradientBackgroundDome);
    gradientBackgroundDome = null;
    scene.background = new THREE.Color(background.solidColor);
    return true;
  }
  if (background.mode === 'skycube') {
    disposeGradientBackgroundDome(gradientBackgroundDome);
    gradientBackgroundDome = null;
    const faceAssetIds: Array<string | null> = [
      background.positiveXAssetId ?? null,
      background.negativeXAssetId ?? null,
      background.positiveYAssetId ?? null,
      background.negativeYAssetId ?? null,
      background.positiveZAssetId ?? null,
      background.negativeZAssetId ?? null,
    ];
    const hasAnyFace = faceAssetIds.some((assetId) => typeof assetId === 'string' && assetId.trim().length > 0);
    const skycubeFormat =
      background.skycubeFormat === 'zip' || background.skycubeFormat === 'faces'
        ? background.skycubeFormat
        : (hasAnyFace ? 'faces' : 'zip');
    if (skycubeFormat === 'zip') {
      const zipAssetId = background.skycubeZipAssetId ?? null;
      if (!zipAssetId) {
        disposeBackgroundResources();
        scene.background = new THREE.Color(background.solidColor);
        return true;
      }
      if (skyCubeTexture && skyCubeSourceFormat === 'zip' && skyCubeZipAssetId === zipAssetId) {
        scene.background = skyCubeTexture;
        return true;
      }
      const resolvedZip = await resolveAssetUrlReference(zipAssetId);
      const zipUrl = resolvedZip?.url ?? null;
      const disposeZipRef = resolvedZip?.dispose ?? null;
      if (!zipUrl) {
        disposeZipRef?.();
        console.warn('[SceneViewer] SkyCube zip URL unavailable', zipAssetId);
        return false;
      }
      let buffer: ArrayBuffer | null = null;
      try {
        buffer = await requestBinaryFromUrl(zipUrl);
      } catch (error) {
        disposeZipRef?.();
        console.warn('[SceneViewer] Failed to download SkyCube zip', zipAssetId, error);
        return false;
      } finally {
        disposeZipRef?.();
      }
      if (token !== backgroundLoadToken) {
        return false;
      }
      let extracted: ReturnType<typeof extractSkycubeZipFaces>;
      try {
        extracted = extractSkycubeZipFaces(buffer);
      } catch (error) {
        console.warn('[SceneViewer] Failed to unzip SkyCube zip', zipAssetId, error);
        return false;
      }
      if (extracted.missingFaces.length) {
        console.warn('[SceneViewer] SkyCube zip missing faces:', extracted.missingFaces);
        try {
          uni.showToast({
            title: `SkyCube 缺失: ${extracted.missingFaces.join(', ')}`,
            icon: 'none',
            duration: 2200,
          });
        } catch {
          // ignore
        }
      }
      const { urls: faceUrls, dispose: disposeFaceUrls } = buildObjectUrlsFromSkycubeZipFaces(extracted.facesInOrder);
      const loaded = await loadSkyCubeTexture(faceUrls);
      if (token !== backgroundLoadToken) {
        if (loaded.texture) {
          disposeSkyCubeTexture(loaded.texture);
        }
        disposeFaceUrls();
        return false;
      }
      if (!loaded.texture) {
        disposeFaceUrls();
        disposeBackgroundResources();
        scene.background = new THREE.Color(background.solidColor);
        return true;
      }
      disposeBackgroundResources();
      skyCubeTexture = loaded.texture;
      skyCubeSourceFormat = 'zip';
      skyCubeZipAssetId = zipAssetId;
      skyCubeZipFaceUrlCleanup = disposeFaceUrls;
      skyCubeFaceAssetIds = null;
      skyCubeFaceTextureCleanup = null;
      scene.background = skyCubeTexture;
      return true;
    }

    if (!hasAnyFace) {
      disposeBackgroundResources();
      scene.background = new THREE.Color(background.solidColor);
      return true;
    }
    if (
      skyCubeTexture &&
      skyCubeFaceAssetIds &&
      faceAssetIds.length === skyCubeFaceAssetIds.length &&
      faceAssetIds.every((assetId, index) => assetId === skyCubeFaceAssetIds?.[index])
    ) {
      scene.background = skyCubeTexture;
      return true;
    }
    const resolvedFaces = await Promise.all(
      faceAssetIds.map(async (assetId) => {
        if (!assetId) {
          return null;
        }
        return await resolveAssetUrlReference(assetId);
      }),
    );
    const faceUrls = resolvedFaces.map((resolved) => resolved?.url ?? null);
    const cleanup = resolvedFaces.map((resolved) => resolved?.dispose ?? null);
    const loaded = await loadSkyCubeTexture(faceUrls);
    if (token !== backgroundLoadToken) {
      if (loaded.texture) {
        disposeSkyCubeTexture(loaded.texture);
      }
      for (const dispose of cleanup) {
        dispose?.();
      }
      return false;
    }
    if (!loaded.texture) {
      for (const dispose of cleanup) {
        dispose?.();
      }
      disposeBackgroundResources();
      scene.background = new THREE.Color(background.solidColor);
      return true;
    }
    if (loaded.missingFaces.length) {
      console.warn('[SceneViewer] SkyCube missing faces:', loaded.missingFaces);
      try {
        uni.showToast({
          title: `SkyCube 缺失: ${loaded.missingFaces.join(', ')}`,
          icon: 'none',
          duration: 2200,
        });
      } catch {
        // ignore
      }
    }
    disposeBackgroundResources();
    skyCubeTexture = loaded.texture;
    skyCubeSourceFormat = 'faces';
    skyCubeFaceAssetIds = faceAssetIds;
    skyCubeFaceTextureCleanup = cleanup;
    skyCubeZipAssetId = null;
    skyCubeZipFaceUrlCleanup = null;
    scene.background = skyCubeTexture;
    return true;
  }
  if (background.mode !== 'hdri' || !background.hdriAssetId) {
    disposeGradientBackgroundDome(gradientBackgroundDome);
    gradientBackgroundDome = null;
    disposeBackgroundResources();
    scene.background = new THREE.Color(background.solidColor);
    return true;
  }
  if (backgroundTexture && backgroundAssetId === background.hdriAssetId) {
    disposeGradientBackgroundDome(gradientBackgroundDome);
    gradientBackgroundDome = null;
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

let lastAppliedBackground: EnvironmentSettings['background'] | null = null;

function applyEnvironmentReflectionFromBackground(background: EnvironmentSettings['background']): boolean {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return false;
  }
  lastAppliedBackground = { ...background };
  void background;
  scene.environment = null;
  scene.environmentIntensity = 1;
  return true;
}

async function applyEnvironmentSettingsToScene(settings: EnvironmentSettings) {
  const scene = renderContext?.scene ?? null;
  const snapshot = cloneEnvironmentSettings(settings);
  activeEnvironmentSettings = snapshot;
  applyPhysicsEnvironmentSettings(snapshot);
  if (!scene) {
    pendingEnvironmentSettings = snapshot;
    return;
  }
  applyFogSettings(snapshot);
  const backgroundApplied = await applyBackgroundSettings(snapshot.background);
  const environmentApplied = applyEnvironmentReflectionFromBackground(snapshot.background);

  const rot = snapshot.environmentRotationDegrees ?? { x: 0, y: 0, z: 0 };
  const euler = new THREE.Euler(
    (rot.x * Math.PI) / 180,
    (rot.y * Math.PI) / 180,
    (rot.z * Math.PI) / 180,
    'XYZ',
  );
  scene.backgroundRotation.copy(euler);
  scene.environmentRotation.copy(euler);
  applyRendererShadowSetting();
  syncSceneCsmSunFromEnvironment();
  if (backgroundApplied && environmentApplied) {
    pendingEnvironmentSettings = null;
  } else {
    pendingEnvironmentSettings = snapshot;
  }
}

function disposeEnvironmentResources() {
  disposeBackgroundResources();
  backgroundLoadToken += 1;
  pendingEnvironmentSettings = null;
  activeEnvironmentSettings = cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS);
}

function resetRemovedSkyState() {
  applyEnvironmentReflectionFromBackground(lastAppliedBackground ?? DEFAULT_ENVIRONMENT_SETTINGS.background);
  const renderer = renderContext?.renderer ?? null;
  if (renderer) {
    renderer.toneMappingExposure = resolveSceneExposure(DEFAULT_SCENE_EXPOSURE);
  }
}

function isValidSceneDocument(document: unknown): document is SceneJsonExportDocument {
  if (!document || typeof document !== 'object') {
    return false;
  }
  const candidate = document as SceneJsonExportDocument;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return false;
  }
  if (!Array.isArray(candidate.nodes)) {
    return false;
  }
  return true;
}

function parseSceneDocument(payload: unknown): SceneJsonExportDocument {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (isValidSceneDocument(parsed)) {
        return parsed;
      }
    } catch (_error) {
      throw new Error('JSON 解析失败');
    }
    throw new Error('场景数据格式不正确');
  }

  if (isValidSceneDocument(payload)) {
    return payload;
  }

  throw new Error('场景数据格式不正确');
}

const GROUND_HEIGHTMAP_SIDECAR_MAGIC = 0x48474d32;
const GROUND_HEIGHTMAP_SIDECAR_VERSION = 2;
const GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES = 32;
const EMPTY_GROUND_BOUND = -1;

function findFirstGroundDynamicMesh(document: SceneJsonExportDocument): GroundDynamicMesh | null {
  const stack = [...document.nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.dynamicMesh?.type === 'Ground') {
      return node.dynamicMesh as GroundDynamicMesh;
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return null;
}

function hydrateGroundSidecarFromPackage(
  pkg: ScenePackageUnzipped,
  sceneEntry: { sceneId: string; path: string; groundHeightsPath?: string; groundScatterPath?: string; groundPaintPath?: string },
  document: SceneJsonExportDocument,
): SceneJsonExportDocument {
  const definition = findFirstGroundDynamicMesh(document) as GroundRuntimeDynamicMesh | null;
  if (!definition) {
    return document;
  }
  if (!sceneEntry.groundHeightsPath) {
    throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground 高度 sidecar 路径`);
  }
  const sidecarBytes = pkg.files[sceneEntry.groundHeightsPath];
  if (!sidecarBytes) {
    throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground 高度 sidecar 文件`);
  }

  const sidecarBuffer = sidecarBytes.buffer.slice(sidecarBytes.byteOffset, sidecarBytes.byteOffset + sidecarBytes.byteLength);
  const vertexCount = getGroundVertexCount(definition.rows, definition.columns);
  const expectedByteLength = GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + vertexCount * Float64Array.BYTES_PER_ELEMENT * 2;
  if (sidecarBuffer.byteLength !== expectedByteLength) {
    throw new Error(
      `场景 ${sceneEntry.sceneId} 的 ground sidecar 大小异常：期望 ${expectedByteLength}，实际 ${sidecarBuffer.byteLength}`,
    );
  }

  const headerView = new DataView(sidecarBuffer, 0, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES);
  const magic = headerView.getUint32(0, true);
  const version = headerView.getUint32(4, true);
  if (magic !== GROUND_HEIGHTMAP_SIDECAR_MAGIC || version !== GROUND_HEIGHTMAP_SIDECAR_VERSION) {
    throw new Error(`场景 ${sceneEntry.sceneId} 的 ground sidecar 头无效`);
  }

  const minRow = headerView.getInt32(8, true);
  const maxRow = headerView.getInt32(12, true);
  const minColumn = headerView.getInt32(16, true);
  const maxColumn = headerView.getInt32(20, true);
  const generatedAt = headerView.getFloat64(24, true);
  const hasBounds = minRow !== EMPTY_GROUND_BOUND && maxRow !== EMPTY_GROUND_BOUND && minColumn !== EMPTY_GROUND_BOUND && maxColumn !== EMPTY_GROUND_BOUND;
  const hasGeneratedAt = Number.isFinite(generatedAt);

  definition.manualHeightMap = new Float64Array(sidecarBuffer, GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES, vertexCount);
  definition.planningHeightMap = new Float64Array(
    sidecarBuffer,
    GROUND_HEIGHTMAP_SIDECAR_HEADER_BYTES + vertexCount * Float64Array.BYTES_PER_ELEMENT,
    vertexCount,
  );
  definition.planningMetadata = hasBounds || hasGeneratedAt
    ? {
        contourBounds: hasBounds ? { minRow, maxRow, minColumn, maxColumn } : null,
        generatedAt: hasGeneratedAt ? generatedAt : undefined,
      }
    : null;
  definition.surfaceRevision = Number.isFinite(definition.surfaceRevision)
    ? Math.max(0, Math.trunc(definition.surfaceRevision as number))
    : 0;
  (definition as GroundDynamicMesh & {
    runtimeHydratedHeightState?: 'pristine' | 'dirty';
    runtimeDisableOptimizedChunks?: boolean;
  }).runtimeHydratedHeightState = 'pristine';
  definition.runtimeDisableOptimizedChunks = false;

  const scatterSidecarPath = typeof sceneEntry.groundScatterPath === 'string' ? sceneEntry.groundScatterPath.trim() : '';
  if (!scatterSidecarPath) {
    definition.terrainScatter = null;
  } else {
    const scatterSidecarBytes = pkg.files[scatterSidecarPath];
    if (!scatterSidecarBytes) {
      throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground scatter sidecar 文件`);
    }
    const scatterSidecarBuffer = new ArrayBuffer(scatterSidecarBytes.byteLength);
    new Uint8Array(scatterSidecarBuffer).set(scatterSidecarBytes);
    const scatterPayload = deserializeGroundScatterSidecar(scatterSidecarBuffer);
    definition.terrainScatter = scatterPayload.terrainScatter;
  }

  const paintSidecarPath = typeof sceneEntry.groundPaintPath === 'string' ? sceneEntry.groundPaintPath.trim() : '';
  if (!paintSidecarPath) {
    definition.terrainPaint = null;
    definition.groundSurfaceChunks = null;
  } else {
    const paintSidecarBytes = pkg.files[paintSidecarPath];
    if (!paintSidecarBytes) {
      throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground paint sidecar 文件`);
    }
    const paintSidecarBuffer = new ArrayBuffer(paintSidecarBytes.byteLength);
    new Uint8Array(paintSidecarBuffer).set(paintSidecarBytes);
    const paintPayload = deserializeGroundPaintSidecar(paintSidecarBuffer);
    definition.terrainPaint = null;
    definition.groundSurfaceChunks = paintPayload.groundSurfaceChunks ?? null;
  }

  return document;
}

let projectSceneSwitchToken = 0;

async function switchToProjectScene(sceneId: string): Promise<void> {
  projectSceneSwitchToken += 1;
  const token = projectSceneSwitchToken;

  const trimmed = (sceneId ?? '').trim();
  if (!trimmed) {
    return;
  }
  const entry = projectSceneIndex.get(trimmed) ?? null;
  if (!entry) {
    warnings.value = [...warnings.value, `未找到场景：${trimmed}`];
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    if (entry.kind === 'embedded') {
      if (token !== projectSceneSwitchToken) {
        return;
      }

      const sceneOverrides = activeScenePackageAssetOverrides ?? undefined;
      const terrain = entry.terrain ?? null;

      previewPayload.value = {
        document: entry.document,
        title: entry.document.name || entry.name || '场景预览',
        origin: 'scene-package',
        assetOverrides: sceneOverrides,
        terrain,
        createdAt: entry.document.createdAt,
        updatedAt: entry.document.updatedAt,
      };
      currentSceneId.value = entry.id;
      return;
    }
    if (entry.kind === 'external') {
      const document = await requestSceneDocument(entry.sceneJsonUrl);
      if (token !== projectSceneSwitchToken) {
        return;
      }

      // External scene JSON: clear any active scene-package overrides.
      activeScenePackageAssetOverrides = null;

      previewPayload.value = {
        document,
        title: document.name || entry.name || '场景预览',
        origin: entry.sceneJsonUrl,
        assetOverrides: undefined,
        terrain: entry.terrain ?? null,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      };
      currentSceneId.value = entry.id;
      return;
    }
  } finally {
    if (token === projectSceneSwitchToken) {
      loading.value = false;
    }
  }
}

async function loadProjectFromBundle(bundle: ScenePackageProjectData): Promise<void> {
  error.value = null;
  projectBundle.value = bundle;
  projectSceneIndex.clear();
  bundle.scenes.forEach((scene: ScenePackageSceneEntry) => {
    if (scene && typeof scene.id === 'string') {
      projectSceneIndex.set(scene.id, scene);
    }
  });

  const initialId = bundle.project.defaultSceneId || bundle.project.sceneOrder?.[0] || null;
  if (!initialId) {
    error.value = '工程未设置默认场景';
    previewPayload.value = null;
    loading.value = false;
    return;
  }

  requestedMode.value = 'project';
  await switchToProjectScene(initialId);
}

function requestBinary(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (sceneDownloadTask) {
      sceneDownloadTask.abort();
      sceneDownloadTask = null;
    }
    const task = uni.request({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: SCENE_DOWNLOAD_TIMEOUT,
      success: (res: { statusCode?: number; data: unknown }) => {
        const statusCode = typeof res.statusCode === 'number' ? res.statusCode : 200;
        if (statusCode >= 400) {
          reject(new Error(`场景包下载失败（${statusCode}）`));
          return;
        }
        const buffer = res.data as ArrayBuffer;
        if (!buffer || typeof buffer.byteLength !== 'number') {
          reject(new Error('场景包下载失败（响应不是二进制数据）'));
          return;
        }
        resolve(buffer);
      },
      fail: (requestError: { errMsg?: unknown } | null) => {
        const message =
          requestError && typeof requestError === 'object' && 'errMsg' in requestError
            ? String((requestError as { errMsg: unknown }).errMsg)
            : '场景包下载失败';
        reject(new Error(message));
      },
      complete: () => {
        sceneDownloadTask = null;
      },
    }) as SceneRequestTask;
    sceneDownloadTask = task;
    task?.onProgressUpdate?.((info: SceneDownloadProgress) => {
      sceneDownload.phase = 'download';
      if (typeof info.progress === 'number' && Number.isFinite(info.progress)) {
        sceneDownload.percent = info.progress;
        sceneDownload.label = `正在下载场景包… ${Math.max(0, Math.min(100, Math.round(info.progress)))}%`;
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

async function loadProjectFromScenePackageUrl(url: string, cacheKey?: string): Promise<void> {
  error.value = null;
  activeScenePackageAssetOverrides = null;
  activeScenePackagePkg = null;
  loading.value = true;
  try {
    resetSceneDownloadState();
    sceneDownload.active = true;
    const cacheKeyParam = typeof cacheKey === 'string' && cacheKey.trim() ? cacheKey.trim() : '';
    if (cacheKeyParam) {
      const cachePointer = resolveScenePackageZipPointerByCacheKey(cacheKeyParam);
      try {
        sceneDownload.phase = 'parse';
        sceneDownload.label = '正在读取本地缓存场景包…';
        const cachedBuffer = await loadScenePackageZip(cachePointer);
        try {
          await loadProjectFromScenePackageBytes(cachedBuffer);
          return;
        } catch (parseError) {
          console.warn('Cached scene package failed to parse, removing cache entry', parseError);
          await removeScenePackageZip(cachePointer);
        }
      } catch (cacheError) {
        void cacheError;
      }
    }

    sceneDownload.phase = 'download';
    sceneDownload.label = '正在下载场景包…';
    const buffer = await requestBinary(url);
    sceneDownload.phase = 'parse';
    sceneDownload.label = '正在解析场景包…';
    await loadProjectFromScenePackageBytes(buffer);
    if (cacheKeyParam) {
      void saveScenePackageZipByCacheKey(buffer, cacheKeyParam).catch((saveError) => {
        console.warn('Failed to persist scene package cache', saveError);
      });
    }
  } catch (loadError) {
    console.error('Failed loading scene package from url', loadError);
    throw loadError;
  } finally {
    sceneDownload.active = false;
    loading.value = false;
  }
}

function parseScenePackageToProjectData(pkg: ScenePackageUnzipped): ScenePackageProjectData {
  const projectText = readTextFileFromScenePackage(pkg, pkg.manifest.project.path);
  type ScenePackageProjectConfig = {
    id?: unknown;
    name?: unknown;
    defaultSceneId?: unknown;
    lastEditedSceneId?: unknown;
    sceneOrder?: unknown;
  };

  const projectConfigRaw: unknown = JSON.parse(projectText);
  const projectConfig: ScenePackageProjectConfig =
    projectConfigRaw && typeof projectConfigRaw === 'object' ? (projectConfigRaw as ScenePackageProjectConfig) : {};

  const buildDocumentResourceSummary = (document: SceneJsonExportDocument): SceneResourceSummary | undefined => {
    const existingSummary = document.resourceSummary;
    const existingAssets = Array.isArray(existingSummary?.assets) ? existingSummary.assets : [];
    const sceneAssetIds = new Set<string>();

    Object.keys(document.assetRegistry ?? {}).forEach((assetId) => {
      const normalized = assetId.trim();
      if (normalized) {
        sceneAssetIds.add(normalized);
      }
    });
    Object.keys(document.sceneOverrideAssets ?? {}).forEach((assetId) => {
      const normalized = assetId.trim();
      if (normalized) {
        sceneAssetIds.add(normalized);
      }
    });
    Object.keys(document.projectOverrideAssets ?? {}).forEach((assetId) => {
      const normalized = assetId.trim();
      if (normalized) {
        sceneAssetIds.add(normalized);
      }
    });
    existingAssets.forEach((entry) => {
      const assetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : '';
      if (assetId) {
        sceneAssetIds.add(assetId);
      }
    });

    const mergedAssets = new Map<string, SceneResourceSummaryEntry>();
    existingAssets.forEach((entry) => {
      const assetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : '';
      if (!assetId) {
        return;
      }
      mergedAssets.set(assetId, { ...entry, assetId });
    });

    pkg.manifest.resources.forEach((resourceEntry) => {
      if (resourceEntry.resourceType === 'planningImage') {
        return;
      }
      const assetId = resourceEntry.logicalId?.trim();
      if (!assetId) {
        return;
      }
      if (sceneAssetIds.size > 0 && !sceneAssetIds.has(assetId)) {
        return;
      }
      const fileBytes = pkg.files[resourceEntry.path];
      const byteSize = typeof resourceEntry.size === 'number' && Number.isFinite(resourceEntry.size)
        ? resourceEntry.size
        : (fileBytes?.byteLength ?? 0);
      const filename = `${assetId}.${resourceEntry.ext}`;
      mergedAssets.set(assetId, {
        ...(mergedAssets.get(assetId) ?? {}),
        assetId,
        bytes: Math.max(0, byteSize),
        embedded: true,
        source: 'embedded',
        downloadUrl: null,
        type: inferAssetTypeOrNull({
          mimeType: resourceEntry.mimeType,
          nameOrUrl: filename,
        }) ?? undefined,
        name: filename,
      });
    });

    const assets = Array.from(mergedAssets.values());
    if (!assets.length) {
      return existingSummary;
    }

    let totalBytes = 0;
    let embeddedBytes = 0;
    let externalBytes = 0;
    assets.forEach((entry) => {
      const bytes = typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? Math.max(0, entry.bytes) : 0;
      totalBytes += bytes;
      if (entry.embedded || entry.source === 'embedded') {
        embeddedBytes += bytes;
      } else {
        externalBytes += bytes;
      }
    });

    return {
      totalBytes,
      embeddedBytes,
      externalBytes,
      computedAt: existingSummary?.computedAt ?? new Date().toISOString(),
      assets,
      unknownAssetIds: existingSummary?.unknownAssetIds,
      textureBytes: existingSummary?.textureBytes,
      meshTextureUsage: existingSummary?.meshTextureUsage,
    };
  };

  const scenes: ScenePackageSceneEntry[] = [];
  pkg.manifest.scenes.forEach((sceneEntry) => {
    const sceneRaw = decodeScenePackageSceneDocument(readBinaryFileFromScenePackage(pkg, sceneEntry.path)) as unknown;
    if (!sceneRaw || typeof sceneRaw !== 'object') {
      throw new Error(`场景包内场景数据无效：${sceneEntry.path}`);
    }
    const document = hydrateGroundSidecarFromPackage(pkg, sceneEntry, sceneRaw as SceneJsonExportDocument);
    const terrain = readGroundTerrainManifestFromPackage(pkg, sceneEntry.groundTerrainManifestPath);
    if (terrain) {
      const groundNode = Array.isArray(document.nodes)
        ? document.nodes.find((node) => node?.dynamicMesh?.type === 'Ground')
        : null;
      if (groundNode) {
        const userData = groundNode.userData && typeof groundNode.userData === 'object'
          ? (groundNode.userData as Record<string, unknown>)
          : {};
        groundNode.userData = {
          ...userData,
          groundTerrainPackageManifest: terrain.manifest,
          groundTerrainManifestPath: terrain.manifestPath,
          groundTerrainTilesRootPath: terrain.manifest.terrainTilesRootPath,
          groundCollisionPath: terrain.manifest.collisionManifestPath,
        };
      }
    }
    const assetRegistry: Record<string, SceneAssetRegistryEntry> = {
      ...(document.assetRegistry ?? {}),
    };
    pkg.manifest.resources.forEach((resourceEntry) => {
      if (resourceEntry.resourceType === 'planningImage') {
        return;
      }
      const assetId = resourceEntry.logicalId?.trim();
      if (!assetId) {
        return;
      }
      const fileBytes = pkg.files[resourceEntry.path];
      const byteSize = typeof resourceEntry.size === 'number' && Number.isFinite(resourceEntry.size)
        ? resourceEntry.size
        : (fileBytes?.byteLength ?? 0);
      const filename = `${assetId}.${resourceEntry.ext}`;
      assetRegistry[assetId] = {
        ...(assetRegistry[assetId] ?? {}),
        sourceType: 'package',
        zipPath: resourceEntry.path,
        bytes: Math.max(0, byteSize),
        assetType: inferAssetTypeOrNull({
          mimeType: resourceEntry.mimeType,
          nameOrUrl: filename,
        }) ?? undefined,
        name: filename,
      };
    });
    document.assetRegistry = assetRegistry;
    const documentMeta = document as SceneJsonExportDocument & { createdAt?: unknown; updatedAt?: unknown };
    document.resourceSummary = buildDocumentResourceSummary(document);
    const id = sceneEntry.sceneId;
    scenes.push({
      kind: 'embedded',
      id,
      name: document.name || id,
      createdAt: typeof documentMeta.createdAt === 'string' ? documentMeta.createdAt : null,
      updatedAt: typeof documentMeta.updatedAt === 'string' ? documentMeta.updatedAt : null,
      document,
      terrain,
    });
  });

  return {
    project: {
      id: String(projectConfig?.id ?? ''),
      name: String(projectConfig?.name ?? ''),
      defaultSceneId: (projectConfig?.defaultSceneId as string | null) ?? null,
      lastEditedSceneId: (projectConfig?.lastEditedSceneId as string | null) ?? null,
      sceneOrder: Array.isArray(projectConfig?.sceneOrder) ? projectConfig.sceneOrder : scenes.map((s) => s.id),
    },
    scenes,
  };
}

async function loadProjectFromScenePackageBytes(buffer: ArrayBuffer): Promise<void> {
  sceneDownload.active = true;
  sceneDownload.phase = 'parse';
  sceneDownload.label = '正在解压场景包资源…';
  const pkg = unzipScenePackage(buffer);
  sceneDownload.label = '正在解析资源映射…';
  activeScenePackagePkg = pkg;
  activeScenePackageAssetOverrides = buildAssetOverridesFromScenePackage(pkg);
  sceneDownload.label = '正在解析场景数据…';
  const projectData = parseScenePackageToProjectData(activeScenePackagePkg);
  sceneDownload.label = '正在组装场景索引…';
  await loadProjectFromBundle(projectData);
}

async function loadProjectFromScenePackagePointer(pointer: ScenePackagePointer): Promise<void> {
  error.value = null;
  activeScenePackageAssetOverrides = null;
  activeScenePackagePkg = null;
  loading.value = true;
  try {
    resetSceneDownloadState();
    sceneDownload.active = true;
    sceneDownload.phase = 'parse';
    sceneDownload.label = '正在读取本地场景包…';
    const buffer = await loadScenePackageZip(pointer);
    if (!buffer || buffer.byteLength <= 0) {
      throw new Error('项目数据为空，请重新导入');
    }
    await loadProjectFromScenePackageBytes(buffer);
  } catch (e) {
    console.error(e);
    error.value = '项目加载失败，请返回首页重新导入';
    previewPayload.value = null;
  } finally {
    sceneDownload.active = false;
    loading.value = false;
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
      success: (res: { statusCode?: number; data: unknown }) => {
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
      fail: (requestError: { errMsg?: unknown } | null) => {
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
  sceneDownload.phase = 'download';
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

watch(
  previewPayload,
  (payload) => {
    if (!bootstrapFinished.value) {
      return;
    }
    if (!payload) {
      teardownRenderer();
      resetRemovedSkyState();
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
    resetRemovedSkyState();
    warnings.value = [];
    return;
  }
  error.value = null;
  warnings.value = [];
  resetRemovedSkyState();
  pendingEnvironmentSettings = cloneEnvironmentSettings(resolveDocumentEnvironment(payload.document));
  try {
    uni.setNavigationBarTitle({ title: payload.title || '场景预览' });
  } catch (_error) {
    // ignore
  }
  startRenderIfReady();
}

async function startRenderIfReady() {
  if (!previewPayload.value || !canvasResult) {
    return;
  }

  if (initializing) {
    // A newer payload arrived while we're initializing. Cancel the current init and restart after it settles.
    pendingRestartAfterCurrentInit = true;
    initializeToken += 1;
    return;
  }

  initializing = true;
  loading.value = true;
  error.value = null;
  warnings.value = [];

  initializeToken += 1;
  const token = initializeToken;
  beginSceneSwitchTransition(token);

  try {
    await ensureRendererContext(canvasResult);
    await initializeRenderer(previewPayload.value, canvasResult, token);
    if (token === initializeToken && !error.value) {
      hasRenderedSceneOnce = true;
      emit('loaded');
    }
  } catch (initializationError) {
    console.error('Renderer initialization failed', initializationError);
    console.error(initializationError);
    if (token === initializeToken) {
      error.value = '初始化渲染器失败';
    }
  } finally {
    if (token === initializeToken) {
      loading.value = false;
    }
    initializing = false;
    endSceneSwitchTransition(token);

    if (pendingRestartAfterCurrentInit) {
      pendingRestartAfterCurrentInit = false;
      void startRenderIfReady();
    }
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
      const shadow = (light as THREE.DirectionalLight | THREE.SpotLight).shadow;
      shadow?.map?.dispose?.();
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

type WheelEventTarget = {
  addEventListener(type: 'wheel', listener: (event: WheelEvent) => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: 'wheel', listener: (event: WheelEvent) => void, options?: EventListenerOptions | boolean): void;
};

function setupWheelControls(canvas: WheelEventTarget | null | undefined): void {
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
  runWithProgrammaticCameraMutationAndAnchor(() => {
    translateCamera(direction * WHEEL_MOVE_STEP * magnitude, 0);
    context.controls.update();
  });
}

function teardownRenderer() {
  renderScope?.stop();
  renderScope = null;
  teardownWheelControls();
  if (!renderContext) {
    return;
  }
  resetProtagonistPoseState();
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
  resetInfoBoardOverlay();
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
  clearBehaviorSounds();
  resetAnimationControllers();
  previewNodeMap.clear();
  autoTourRuntime.reset();
  activeAutoTourNodeIds.clear();
  autoTourRotationOnlyHold.value = false;
  autoTourFollowNodeId.value = null;
  resetAutoTourCameraFollowState();
  nodeObjectMap.forEach((_object, nodeId) => {
    releaseModelInstance(nodeId);
  });
  nodeObjectMap.clear();
  multiuserNodeIds.clear();
  multiuserNodeObjects.clear();
  resetPhysicsWorld();
  lazyPlaceholderStates.clear();
  deferredInstancingNodeIds.clear();
  activeLazyLoadCount = 0;
  activeCameraWatchTween = null;
  frameDeltaMode = null;
  controls.dispose();
  disposeEnvironmentResources();
  disposeSceneCsmShadowRuntime();
  pruneLanternAssets(new Set<string>(), new Set<string>());
  resetAssetResolutionCaches();
  stopInstancedMeshSubscription?.();
  stopInstancedMeshSubscription = null;
  stopBillboardMeshSubscription?.();
  stopBillboardMeshSubscription = null;
  clearInstancedMeshes();
  disposeObject(scene);
  disposeMaterialTextureCache();
  renderer.dispose();
  renderContext = null;
  canvasResult = null;
  setActiveMultiuserSceneId(null);
  currentDocument = null;
  dynamicGroundCache = null;
  sceneGraphRoot = null;
  viewerResourceCache = null;
}

function handleUseCanvas(result: UseCanvasResult) {
  canvasResult = result;
  startRenderIfReady();
}

async function ensureRendererContext(result: UseCanvasResult) {
  await result.recomputeSize?.();

  if (renderContext) {
    return;
  }

  activeCameraWatchTween = null;
  frameDeltaMode = null;
  const { canvas } = result;
  const devicePixelRatio = result.canvas?.ownerDocument?.defaultView?.devicePixelRatio || uni.getSystemInfoSync().pixelRatio || 1;
  // WeChat mini-program adapter canvas is typically already in physical pixels.
  // Applying DPR again explodes the render target size and kills FPS.
  const pixelRatio = isWeChatMiniProgram ? 2 : Math.min(2, Math.max(1, devicePixelRatio));
  const width = canvas.width || canvas.clientWidth || 1;
  const height = canvas.height || canvas.clientHeight || 1;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, DEFAULT_SCENE_CAMERA_FAR);
  camera.position.set(0, HUMAN_EYE_HEIGHT, 0);
  camera.lookAt(0, HUMAN_EYE_HEIGHT, -CAMERA_FORWARD_OFFSET);

  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, HUMAN_EYE_HEIGHT, -CAMERA_FORWARD_OFFSET);
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
    if (
      autoTourPaused.value
      && autoTourPausedCameraSnapshotValid
      && autoTourPausedCameraNodeId.value
      && contextCamera.position.distanceToSquared(autoTourPausedCameraPosition) <= 1e-8
      && contextControls.target.distanceToSquared(autoTourPausedCameraTarget) <= 1e-8
    ) {
      return;
    }
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

  runWithProgrammaticCameraMutationAndAnchor(() => {
    controls.update();
  });
  cameraRotationAnchor.copy(camera.position);
  lockControlsPitchToCurrent(controls, camera);
  setupWheelControls(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f9f9f9');
  scene.environmentIntensity = SKY_ENVIRONMENT_INTENSITY;

  scene.add(instancedMeshGroup);
  stopInstancedMeshSubscription?.();
  stopBillboardMeshSubscription?.();
  stopInstancedMeshSubscription = subscribeInstancedMeshes((mesh) => {
    attachInstancedMesh(mesh);
  });
  stopBillboardMeshSubscription = subscribeBillboardInstancedMeshes((mesh) => {
    attachInstancedMesh(mesh);
  });

  renderContext = {
    renderer,
    scene,
    camera,
    controls,
  };

  ensureSceneCsmShadowRuntime();
  applyRendererShadowSetting();

  if (pendingEnvironmentSettings) {
    void applyEnvironmentSettingsToScene(pendingEnvironmentSettings);
  }

  renderScope?.stop();
  renderScope = effectScope();
}

// ------------------------------
// Renderer initialization helpers
// ------------------------------

/**
 * Reset the UI-facing preload state before starting to load/build the scene graph.
 */
function resetResourcePreloadState(): void {
  resourcePreload.active = true;
  resourcePreload.loaded = 0;
  resourcePreload.total = 0;
  resourcePreload.loadedBytes = 0;
  resourcePreload.totalBytes = 0;
  resourcePreload.label = '准备加载资源...';
}

/**
/**
 * Build the SceneGraph (three.js object tree) and keep `resourcePreload` in sync.
 * Returns null when build fails.
 */
async function buildSceneGraphWithProgress(
  payload: ScenePreviewPayload,
): Promise<{
  graph: Awaited<ReturnType<typeof buildSceneGraph>>;
  resourceCache: ResourceCache | null;
} | null> {
  let graph: Awaited<ReturnType<typeof buildSceneGraph>> | null = null;
  let resourceCache: ResourceCache | null = null;
  try {
    lazyLoadMeshesEnabled = payload.document.lazyLoadMeshes !== false;
    const buildOptions: SceneGraphBuildOptions = {
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
        const stillLoadingByBytes =
         resourcePreload.total > 0 && resourcePreload.totalBytes > 0 && resourcePreload.loadedBytes < resourcePreload.totalBytes;
        resourcePreload.active = stillLoadingByCount || stillLoadingByBytes;
      },
    };
    const mergedAssetOverrides = mergeSceneAssetOverrides(
      payload.assetOverrides,
      activeScenePackageAssetOverrides ?? undefined,
    );
    if (mergedAssetOverrides) {
      buildOptions.assetOverrides = mergedAssetOverrides;
    }
    if (typeof props.serverAssetBaseUrl === 'string' && props.serverAssetBaseUrl.trim().length) {
      buildOptions.serverAssetBaseUrl = props.serverAssetBaseUrl.trim();
    }

    resourceCache = ensureResourceCache(payload.document, buildOptions);
    viewerResourceCache = resourceCache;
    graph = await buildSceneGraph(payload.document, resourceCache, buildOptions);
  } finally {
    const fullyLoadedByCount = resourcePreload.total > 0 && resourcePreload.loaded >= resourcePreload.total;
    const fullyLoadedByBytes =
      resourcePreload.totalBytes > 0 && resourcePreload.loadedBytes >= resourcePreload.totalBytes;
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
    return null;
  }
  return { graph, resourceCache };
}

/**
 * When lazy-loading meshes, we skip instancing for placeholder nodes (they will be instanced later).
 */
function collectInstancingSkipNodeIdsForLazyPlaceholders(root: THREE.Object3D): Set<string> | null {
  if (!lazyLoadMeshesEnabled) {
    return null;
  }
  const skipNodeIds = new Set<string>();
  root.traverse((object: THREE.Object3D) => {
    const nodeId = object.userData?.nodeId as string | undefined;
    if (!nodeId) {
      return;
    }
    const lazyData = object.userData?.lazyAsset as LazyAssetMetadata;
    if (lazyData?.placeholder) {
      skipNodeIds.add(nodeId);
    }
  });
  return skipNodeIds.size ? skipNodeIds : null;
}

async function prepareInstancedNodesIfPossible(
  root: THREE.Object3D,
  payload: ScenePreviewPayload,
  resourceCache: ResourceCache | null,
  skipNodeIds: Set<string> | null,
): Promise<void> {
  if (skipNodeIds?.size) {
    skipNodeIds.forEach((nodeId) => deferredInstancingNodeIds.add(nodeId));
  }

  if (!resourceCache) {
    return;
  }

  try {
    await prepareInstancedNodesForGraph(root, payload.document, resourceCache, {
      ...(skipNodeIds?.size ? { skipNodeIds } : {}),
    });
  } catch (error) {
    console.warn('[SceneViewer] Failed to prepare instanced nodes', error);
  }
}

const WECHAT_SHADOW_MAX_MAP_SIZE = 1024;

function applyWeChatShadowPolicy(root: THREE.Object3D): void {
  if (!isWeChatMiniProgram) {
    return;
  }

  root.traverse((object) => {
    const anyObject = object as any;
    if (!anyObject?.isLight) {
      return;
    }

    // Default: disable PointLight shadows on mini-program for performance.
    if (anyObject.isPointLight) {
      anyObject.castShadow = false;
    }

    const shadow = anyObject.shadow as THREE.LightShadow | undefined;
    if (!shadow?.mapSize) {
      return;
    }

    const sizeX = Math.max(1, Math.round(Number(shadow.mapSize.x || 0)));
    const sizeY = Math.max(1, Math.round(Number(shadow.mapSize.y || 0)));
    const clamped = Math.min(WECHAT_SHADOW_MAX_MAP_SIZE, Math.max(sizeX, sizeY));
    if (shadow.mapSize.x !== clamped || shadow.mapSize.y !== clamped) {
      shadow.mapSize.set(clamped, clamped);
      (shadow as any).map?.dispose?.();
      (shadow as any).map = null;
    }
  });
}

/**
 * Mount the graph into the scene and synchronously initialize scene-dependent subsystems.
 */
async function mountGraphAndSyncSubsystems(
  payload: ScenePreviewPayload,
  root: THREE.Object3D,
  resourceCache: ResourceCache | null,
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
): Promise<void> {
  sceneGraphRoot = root;
  renderContext?.scene?.add(root);

  rebuildPreviewNodeMap(payload.document);
  previewComponentManager.syncScene(payload.document.nodes ?? []);
  indexSceneObjects(root);
  applyWeChatShadowPolicy(root);
  refreshMultiuserNodeReferences(payload.document);
  refreshBehaviorProximityCandidates();
  refreshAnimationControllers(root);
  ensureBehaviorTapHandler(canvas, camera);
  initializeLazyPlaceholders(payload.document);
  syncPhysicsBodiesForDocument(payload.document);
  await syncTerrainScatterInstances(payload.document, resourceCache);
  registerSceneSubtree(root);
  refreshAnimationControllers(root);
  markInstancedCullingDirty();
}

/** Apply camera alignment and environment settings for the current document. */
function applyDocumentViewSettings(document: SceneJsonExportDocument, camera: THREE.PerspectiveCamera): void {
  const shouldAlignToProtagonist = purposeActiveMode.value === 'level' && !vehicleDriveActive.value;
  syncProtagonistCameraPose({ force: true, applyToCamera: shouldAlignToProtagonist });

  resetRemovedSkyState();

  // Environment settings are applied asynchronously (e.g. texture loads) and will self-defer
  // into `pendingEnvironmentSettings` when the render context is not ready.
  void applyEnvironmentSettingsToScene(resolveDocumentEnvironment(document));

  // Ensure camera projection matches the current canvas size.
  const width = (canvasResult?.canvas?.width || canvasResult?.canvas?.clientWidth || 1) as number;
  const height = (canvasResult?.canvas?.height || canvasResult?.canvas?.clientHeight || 1) as number;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  sceneCsmShadowRuntime?.updateFrustums();
}

/**
 * Start the render loop (per-frame updates + rendering). Uses Vue effect scope so it can be stopped.
 */
function startRenderLoop(
  result: UseCanvasResult,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): void {
  if (!renderScope) {
    renderScope = effectScope();
  }

  let accumulatedDelta = 0;
  renderScope.run(() => {
    watchEffect((onCleanup) => {
      const { cancel } = result.useFrame((delta: number) => {
        const deltaSecondsRaw = normalizeFrameDelta(delta);
        accumulatedDelta += deltaSecondsRaw;
        // 只在渲染帧时传递累计deltaSeconds，避免FPS统计超过30
        const deltaSeconds = accumulatedDelta;
        accumulatedDelta = 0;

        if (debugEnabled.value) {
          updateDebugFps(deltaSeconds);
        }

        // Sync multiuser avatars to the camera pose.
        if (renderContext && multiuserNodeObjects.size) {
          const cameraObj = renderContext.camera;
          multiuserNodeObjects.forEach((object) => {
            object.position.copy(cameraObj.position);
            object.quaternion.copy(cameraObj.quaternion);
            object.updateMatrixWorld(true);
          });
        }

        if (deltaSeconds > 0) {
          updateDriveInputRelaxation(deltaSeconds);
        }

        // Camera tween has priority over user controls.
        if (activeCameraWatchTween && deltaSeconds > 0) {
          applyCameraWatchTween(deltaSeconds);
        } else {
          cameraRotationAnchor.copy(camera.position);
          if (!vehicleDriveActive.value) {
            controls.update();
          }
        }

        if (deltaSeconds > 0) {
          previewComponentManager.setFrameState({
            cameraWorldPosition: {
              x: camera.position.x,
              y: camera.position.y,
              z: camera.position.z,
            },
          });
          previewComponentManager.update(deltaSeconds);
          waterRuntime.update(deltaSeconds, { renderer, scene, camera });
          animationMixers.forEach((mixer) => mixer.update(deltaSeconds));
          activeBehaviorSounds.forEach((instance) => {
            if (!instance.audio || !instance.params.spatial || instance.stopped) {
              return;
            }
            applyBehaviorSoundVolume(instance);
          });

          effectRuntimeTickers.forEach((tick) => {
            try {
              tick(deltaSeconds);
            } catch (error) {
              console.warn('更新特效动画失败', error);
            }
          });

          if (autoTourPaused.value) {
            // Instead of advancing runtime, keep vehicles held still while paused.
            applyAutoTourPauseForActiveNodes();
          } else {
            autoTourRuntime.update(deltaSeconds);
          }
          if (vehicleDriveActive.value) {
            applyVehicleDriveForces(deltaSeconds);
            if (!physicsEnvironmentEnabled.value) {
              updateVehicleDriveCamera(deltaSeconds);
            }
          }
          stepPhysicsWorld(deltaSeconds);
          updateVehicleSpeedFromVehicle();
          updateVehicleWheelVisuals(deltaSeconds);
        }

        if (deltaSeconds >= 0) {
          updateAutoTourFollowCamera(deltaSeconds);
        }

          updateBillboardInstanceCameraWorldPosition(camera.position);

        if (vehicleDriveActive.value && physicsEnvironmentEnabled.value) {
          updateVehicleDriveCamera(deltaSeconds);
        }

          updateBehaviorProximity();
          updateSignboardOverlayEntries(camera, deltaSeconds);
          updateInfoBoardOverlayPlacement(camera);

        // Keep chunked ground meshes in sync with camera position.
        const cachedGround = dynamicGroundCache;
        if (cachedGround) {
          const groundObject = nodeObjectMap.get(cachedGround.nodeId) ?? null;
          if (groundObject) {
            if (isGroundChunkStreamingEnabled(cachedGround.dynamicMesh)) {
              updateGroundChunks(groundObject, cachedGround.dynamicMesh, camera);
            } else if (!areAllGroundChunksLoaded(groundObject, cachedGround.dynamicMesh)) {
              ensureAllGroundChunks(groundObject, cachedGround.dynamicMesh);
            }
            if (debugEnabled.value && debugMode.value === 'full') {
              syncGroundChunkDebugCounters(groundObject, cachedGround.dynamicMesh, camera);
            }
          }
        }

        const instancingNow = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
          updateLazyPlaceholders(deltaSeconds);
        if (shouldRunTerrainScatterUpdate(camera, instancingNow)) {
          terrainScatterRuntime.update(camera, resolveGroundMeshObject);
        }
        if (shouldRunInstancedCulling(camera, instancingNow)) {
          updateInstancedCullingAndLod();
        }
        // Throttled update of instanced mesh bounding spheres when instance matrices changed.
          tickInstancedBounds(deltaSeconds);
        if (gradientBackgroundDome) {
          gradientBackgroundDome.mesh.position.copy(camera.position);
        }
          sceneCsmShadowRuntime?.update();
        renderer.render(scene, camera);
        // Pull renderer.info after rendering so calls/triangles reflect the current frame.
        if (debugEnabled.value && debugMode.value === 'full') {
          syncRendererDebug(renderer, scene, canvasResult?.canvas ?? null);
        }
      });
      onCleanup(() => {
        cancel();
      });
    });
  });
}

function cleanupForUnrelatedSceneSwitch(): void {
  if (!renderContext) {
    return;
  }

  // Stop the old frame loop to avoid stacking multiple useFrame() tickers.
  renderScope?.stop();
  renderScope = null;

  resetProtagonistPoseState();
  releaseTerrainScatterInstances();

  if (behaviorAlertToken.value) {
    resolveBehaviorToken(behaviorAlertToken.value, {
      type: 'abort',
      message: '场景切换',
    });
  }
  if (lanternEventToken.value) {
    closeLanternOverlay({ type: 'abort', message: '场景切换' });
  } else {
    resetLanternOverlay();
  }
  resetInfoBoardOverlay();

  hidePurposeControls();
  setCameraCaging(false);
  previewComponentManager.reset();

  resetBehaviorRuntime();
  resetBehaviorProximity();
  activeBehaviorDelayTimers.forEach((handle) => clearTimeout(handle));
  activeBehaviorDelayTimers.clear();
  clearBehaviorSounds();
  resetAnimationControllers();

  previewNodeMap.clear();
  autoTourRuntime.reset();
  waterRuntime.reset();
  activeAutoTourNodeIds.clear();
  autoTourRotationOnlyHold.value = false;
  autoTourFollowNodeId.value = null;
  resetAutoTourCameraFollowState();

  nodeObjectMap.forEach((_object, nodeId) => {
    releaseModelInstance(nodeId);
  });
  nodeObjectMap.clear();
  multiuserNodeIds.clear();
  multiuserNodeObjects.clear();

  resetPhysicsWorld();
  lazyPlaceholderStates.clear();
  deferredInstancingNodeIds.clear();
  activeLazyLoadCount = 0;
  activeCameraWatchTween = null;
  frameDeltaMode = null;

  disposeEnvironmentResources();

  pruneLanternAssets(new Set<string>(), new Set<string>());

  stopInstancedMeshSubscription?.();
  stopInstancedMeshSubscription = null;
  stopBillboardMeshSubscription?.();
  stopBillboardMeshSubscription = null;
  clearInstancedMeshes();

  if (sceneGraphRoot) {
    renderContext.scene.remove(sceneGraphRoot);
    disposeObject(sceneGraphRoot);
  }
  sceneGraphRoot = null;
  dynamicGroundCache = null;
  setActiveMultiuserSceneId(null);
  viewerResourceCache = null;
}

async function initializeRenderer(payload: ScenePreviewPayload, result: UseCanvasResult, token: number) {
  if (!renderContext) {
    throw new Error('Render context missing');
  }
  const { scene, renderer, camera, controls } = renderContext;
  activeCameraWatchTween = null;
  const { canvas } = result;

  if (token !== initializeToken) {
    return;
  }

  // Always treat payload switches as unrelated: clear previous graph + behavior runtime.
  if (sceneGraphRoot || currentDocument) {
    cleanupForUnrelatedSceneSwitch();
  }

  if (token !== initializeToken) {
    return;
  }

  // Phase 1: bind state for the new payload.
  currentDocument = payload.document;
  resetAppliedDefaultSteerDriveKey();
  refreshDynamicGroundCache(currentDocument);
  setActiveMultiuserSceneId(payload.document.id ?? null);
  resetProtagonistPoseState();
  if (behaviorAlertToken.value) {
    resolveBehaviorToken(behaviorAlertToken.value, {
      type: 'abort',
      message: '场景重新初始化',
    });
  }

  // Phase 2: build the scene graph (loads assets) with UI progress updates.
  resetResourcePreloadState();
  const buildResult = await buildSceneGraphWithProgress(payload);
  if (token !== initializeToken) {
    if (buildResult?.graph?.root) {
      disposeObject(buildResult.graph.root);
    }
    return;
  }
  if (!buildResult) {
    return;
  }
  const { graph, resourceCache } = buildResult;
  if (graph.warnings.length) {
    warnings.value = graph.warnings;
  }

  const instancingSkipNodeIds = collectInstancingSkipNodeIdsForLazyPlaceholders(graph.root);
  await prepareInstancedNodesIfPossible(graph.root, payload, resourceCache, instancingSkipNodeIds);
  if (token !== initializeToken) {
    disposeObject(graph.root);
    return;
  }

  // Phase 4: mount the graph and synchronously initialize scene-dependent subsystems.
  await mountGraphAndSyncSubsystems(payload, graph.root, resourceCache, canvas, camera);
  applyNominateOverridesForCurrentScene();
  applyDefaultSteerDriveForCurrentScene();

  if (token !== initializeToken || sceneGraphRoot !== graph.root) {
    return;
  }

  // Phase 5: apply view settings (camera alignment, environment, projection).
  applyDocumentViewSettings(payload.document, camera);
  markInstancedCullingDirty();

  // Phase 6: start the render loop.
  startRenderLoop(result, renderer, scene, camera, controls);
}

const handleResize: WindowResizeCallback = (_result: unknown) => {
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
    sceneCsmShadowRuntime?.updateFrustums();
    markInstancedCullingDirty();
  });
};

watch(error, (value) => {
  if (value) {
    emit('error', value);
  }
});

watch(
  [overlayTitle, overlayPercent, overlayBytesLabel],
  ([title, _percent, bytesLabel]) => {
    if (!title) {
      return;
    }
    const loaded = sceneDownload.active ? sceneDownload.loaded : resourcePreload.loadedBytes;
    const total = sceneDownload.active ? sceneDownload.total : resourcePreload.totalBytes;
    emit('progress', {
      bytesLabel,
      loaded,
      total,
    });
  },
  { flush: 'post' },
);

let runtimeBootstrapped = false;
let lastAppliedInputKey = '';

function bootstrapRuntimeIfNeeded(): void {
  if (runtimeBootstrapped) {
    return;
  }
  runtimeBootstrapped = true;
  (globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
    DISPLAY_BOARD_RESOLVER_KEY
  ] = resolveDisplayBoardMediaSource;
  addBehaviorRuntimeListener(behaviorRuntimeListener);
  projectStore.bootstrap();
}

function configurePhysicsInterpolation(physinterpParam: string): void {
  if (typeof props.physicsInterpolation === 'boolean') {
    physicsInterpolationEnabled = isWeChatMiniProgram && props.physicsInterpolation;
  } else {
    physicsInterpolationEnabled = isWeChatMiniProgram
      && (physinterpParam === '' || (physinterpParam !== '0' && physinterpParam.toLowerCase() !== 'false'));
  }
  physicsAccumulator = 0;
  physicsInterpolationAlpha = 0;
}

function applyInput(params: {
  projectId?: string;
  packageUrl?: string;
  packageCacheKey?: string;
  physinterp?: string;
}): void {
  bootstrapRuntimeIfNeeded();
  const projectIdParam = typeof params.projectId === 'string' ? params.projectId.trim() : '';
  const packageUrlParamRaw = typeof params.packageUrl === 'string' ? params.packageUrl.trim() : '';
  const packageCacheKeyParam = typeof params.packageCacheKey === 'string' ? params.packageCacheKey.trim() : '';
  let packageUrlParam = packageUrlParamRaw;
  if (packageUrlParam.includes('%')) {
    try {
      packageUrlParam = decodeURIComponent(packageUrlParam);
    } catch {
      packageUrlParam = packageUrlParamRaw;
    }
  }
  const physinterpParam = typeof params.physinterp === 'string' ? params.physinterp.trim() : '';

  const inputKey = `${projectIdParam}::${packageUrlParam}::${packageCacheKeyParam}::${String(props.physicsInterpolation ?? '')}::${physinterpParam}`;
  if (inputKey === lastAppliedInputKey) {
    return;
  }
  lastAppliedInputKey = inputKey;

  configurePhysicsInterpolation(physinterpParam);
  error.value = null;

  if (packageUrlParam) {
    requestedMode.value = 'project';
    currentProjectId.value = null;
    loading.value = true;
    const effectiveCacheKey = packageCacheKeyParam || packageUrlParam;
    void loadProjectFromScenePackageUrl(packageUrlParam, effectiveCacheKey);
  } else if (projectIdParam) {
    requestedMode.value = 'project';
    currentProjectId.value = projectIdParam;
    const entry = projectStore.getProject();
    if (!entry || entry.id !== projectIdParam) {
      requestedMode.value = null;
      error.value = '未找到对应的项目，请返回首页重新导入';
      loading.value = false;
    } else {
      loading.value = true;
      void loadProjectFromScenePackagePointer(entry.scenePackage);
    }
  } else {
    console.error('Input missing projectId and packageUrl');
    requestedMode.value = null;
    error.value = '缺少工程数据';
    loading.value = false;
  }

  bootstrapFinished.value = true;
  if (previewPayload.value) {
    handlePreviewPayload(previewPayload.value);
  } else {
    teardownRenderer();
    resetRemovedSkyState();
  }
}

function hasAnyPropInput(): boolean {
  return Boolean(
    (typeof props.packageUrl === 'string' && props.packageUrl.trim())
    || (typeof props.projectId === 'string' && props.projectId.trim()),
  );
}

onMounted(() => {
  if (!resizeListener) {
    resizeListener = handleResize;
    uni.onWindowResize(handleResize);
  }

  if (hasAnyPropInput()) {
    applyInput({
      projectId: props.projectId,
      packageUrl: props.packageUrl,
      packageCacheKey: props.packageCacheKey,
      physinterp: '',
    });
  }
});

watch(
  () => [props.projectId, props.packageUrl, props.packageCacheKey, props.physicsInterpolation],
  () => {
    if (!hasAnyPropInput()) {
      return;
    }
    applyInput({
      projectId: props.projectId,
      packageUrl: props.packageUrl,
      packageCacheKey: props.packageCacheKey,
      physinterp: '',
    });
  },
);

watch(
  () => props.nominateStateMap,
  () => {
    applyNominateOverridesForCurrentScene();
  },
  { deep: true },
);

watch(
  () => props.defaultSteerIdentifier,
  () => {
    resetAppliedDefaultSteerDriveKey();
    applyDefaultSteerDriveForCurrentScene();
  },
);

function cleanupRuntime(): void {
  dismissBehaviorBubble({ type: 'continue' });
  resetAppliedDefaultSteerDriveKey();
  removeBehaviorRuntimeListener(behaviorRuntimeListener);
  teardownRenderer();
  if (resizeListener) {
    uni.offWindowResize(handleResize);
    resizeListener = null;
  }
  detachDrivePadMouseListeners();
  hideDrivePadImmediate();
  if (sceneDownloadTask) {
    sceneDownloadTask.abort();
    sceneDownloadTask = null;
  }
  clearBehaviorSounds();
  resetInfoBoardOverlay();
  resetSceneDownloadState();
  waterRuntime.reset();
  sharedResourceCache = null;
  lanternViewerInstance = null;
  delete (globalThis as typeof globalThis & Record<string, unknown>)[DISPLAY_BOARD_RESOLVER_KEY];
}

onUnmounted(() => {
  cleanupRuntime();
});

</script>

<style scoped>
.viewer-drive-start__group > .viewer-drive-start__btn { margin-right: 8px; }
.viewer-drive-start__btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(6,10,24,0.65);
  color: #fff;
  font-size: 15px;
  line-height: 48px;
}
.viewer-drive-start__btn__icon {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(255,255,255,0.04);
  font-size: 18px;
}
.viewer-drive-start__btn__label { display: inline-block; vertical-align: middle; font-size: 15px; color: inherit; transition: opacity .12s ease; }
.viewer-drive-start__btn--primary { background: linear-gradient(90deg,#28c3ff,#57a6ff); color: #012; border: none; }
.viewer-drive-start__btn--pause { background: linear-gradient(90deg,#ffd34d,#ff9a4d); color: #111; border: none; }
.viewer-drive-start__btn--close { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.08); }
.viewer-drive-start__btn.is-busy .viewer-drive-start__btn__label { opacity: 0.6; }

/* Small adjustments for very small screens */
@media (max-width: 320px) {
  .viewer-drive-start__btn { height: 44px; padding: 0 10px; border-radius: 12px; }
  .viewer-drive-start__btn__icon { width: 32px; height: 32px; }
}
</style>

<style lang="scss">
:root {
  --viewer-safe-area-top: 0px;
}

@supports (padding: env(safe-area-inset-top)) {
  :root {
    --viewer-safe-area-top: env(safe-area-inset-top);
  }
}

@supports (padding: constant(safe-area-inset-top)) {
  :root {
    --viewer-safe-area-top: constant(safe-area-inset-top);
  }
}

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
  font-size: 14px;
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
  isolation: isolate;
}

.viewer-signboard-layer {
  position: absolute;
  inset: 0;
  z-index: 1450;
  pointer-events: none;
  overflow: hidden;
}

.viewer-signboard {
  position: absolute;
  transform-origin: center bottom;
  transition: opacity 0.12s linear, transform 0.12s ease-out;
  will-change: transform, opacity;
}

.viewer-signboard__pill {
  display: inline-flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx 22rpx;
  border-radius: 999rpx;
  border: 1px solid rgba(149, 223, 255, 0.3);
  background: linear-gradient(135deg, rgba(8, 20, 34, 0.86), rgba(18, 44, 62, 0.8));
  box-shadow: 0 16rpx 36rpx rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(10px);
  color: #eff8ff;
  white-space: nowrap;
  flex-wrap: nowrap;
}

.viewer-signboard--vehicle .viewer-signboard__pill {
  border-color: rgba(255, 210, 127, 0.34);
  background: linear-gradient(135deg, rgba(36, 22, 8, 0.86), rgba(62, 44, 18, 0.8));
}

.viewer-punch-summary {
  position: absolute;
  left: 12px;
  z-index: 1460;
  display: inline-flex;
  align-items: center;
  gap: 14rpx;
  max-width: calc(100% - 24px);
  padding: 12rpx 14rpx 12rpx 18rpx;
  border-radius: 999rpx;
  border: 1px solid rgba(149, 223, 255, 0.24);
  background: linear-gradient(135deg, rgba(8, 20, 34, 0.84), rgba(18, 44, 62, 0.78));
  box-shadow:
    0 16rpx 36rpx rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  pointer-events: none;
  color: #edf5ff;
  overflow: hidden;
}

.viewer-punch-summary::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at left center, rgba(111, 214, 255, 0.16), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 45%);
  pointer-events: none;
}

.viewer-auto-tour-trigger {
  position: absolute;
  right: 12px;
  z-index: 1460;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 172rpx;
  min-height: 72rpx;
  padding: 0 24rpx;
  border: 1px solid rgba(149, 223, 255, 0.26);
  border-radius: 18px;
  background:
    radial-gradient(circle at 18% 22%, rgba(111, 214, 255, 0.18), transparent 36%),
    linear-gradient(135deg, rgba(8, 20, 34, 0.88), rgba(18, 44, 62, 0.82));
  box-shadow:
    0 16rpx 34rpx rgba(4, 6, 18, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  color: #eef9ff;
  overflow: hidden;
  transition:
    transform 0.18s cubic-bezier(0.2, 0.9, 0.2, 1),
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    opacity 0.18s ease;
}

.viewer-auto-tour-trigger::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 10rpx;
  border-radius: 18px 0 0 18px;
  background: linear-gradient(180deg, rgba(111, 214, 255, 0.94), rgba(126, 168, 255, 0.92));
}

.viewer-auto-tour-trigger::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 48%);
  pointer-events: none;
}

.viewer-auto-tour-trigger__content {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding-left: 6rpx;
}

.viewer-auto-tour-trigger__label {
  font-size: 24rpx;
  font-weight: 700;
  letter-spacing: 0.6rpx;
  white-space: nowrap;
  color: inherit;
}

.viewer-auto-tour-trigger.is-active {
  border-color: rgba(255, 143, 167, 0.38);
  background:
    radial-gradient(circle at 18% 22%, rgba(255, 120, 170, 0.18), transparent 36%),
    linear-gradient(135deg, rgba(42, 10, 22, 0.92), rgba(76, 22, 40, 0.86));
  color: #fff4f7;
}

.viewer-auto-tour-trigger.is-active::before {
  background: linear-gradient(180deg, rgba(255, 136, 166, 0.96), rgba(255, 86, 128, 0.92));
}

.viewer-auto-tour-trigger--secondary {
  left: 50%;
  right: auto;
  top: auto;
  transform: translateX(-50%);
  min-width: 156rpx;
  min-height: 64rpx;
  padding: 0 22rpx;
  border-color: rgba(141, 236, 217, 0.26);
  background:
    radial-gradient(circle at 18% 22%, rgba(90, 224, 205, 0.16), transparent 36%),
    linear-gradient(135deg, rgba(10, 24, 34, 0.82), rgba(16, 52, 56, 0.8));
  box-shadow:
    0 14rpx 28rpx rgba(4, 6, 18, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.viewer-auto-tour-trigger--secondary::before {
  background: linear-gradient(180deg, rgba(104, 232, 219, 0.92), rgba(51, 195, 182, 0.9));
}

.viewer-auto-tour-trigger--secondary .viewer-auto-tour-trigger__label {
  font-size: 22rpx;
  letter-spacing: 0.4rpx;
}

.viewer-auto-tour-trigger--secondary.is-active {
  border-color: rgba(255, 214, 120, 0.34);
  background:
    radial-gradient(circle at 18% 22%, rgba(255, 204, 102, 0.18), transparent 36%),
    linear-gradient(135deg, rgba(52, 28, 12, 0.9), rgba(86, 50, 18, 0.84));
  color: #fff7ea;
}

.viewer-auto-tour-trigger--secondary.is-active::before {
  background: linear-gradient(180deg, rgba(255, 216, 121, 0.96), rgba(255, 170, 72, 0.92));
}

.viewer-auto-tour-trigger--secondary:active {
  transform: translateX(-50%) translateY(1px) scale(0.985);
}

.viewer-auto-tour-trigger.is-busy,
.viewer-auto-tour-trigger[disabled] {
  opacity: 0.72;
}

.viewer-auto-tour-trigger:active {
  transform: translateY(1px) scale(0.985);
  box-shadow: 0 12rpx 24rpx rgba(4, 6, 18, 0.28);
}

.viewer-punch-summary__label {
  position: relative;
  z-index: 1;
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 0.5rpx;
  color: rgba(228, 242, 255, 0.78);
}

.viewer-punch-summary__value {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 74rpx;
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 0.3rpx;
  color: #ffffff;
  white-space: nowrap;
}

@media (max-width: 360px) {
  .viewer-punch-summary {
    left: 10px;
    max-width: calc(100% - 20px);
    gap: 10rpx;
    padding: 10rpx 12rpx 10rpx 14rpx;
  }

  .viewer-auto-tour-trigger {
    right: 10px;
    min-width: 152rpx;
    min-height: 68rpx;
    padding: 0 20rpx;
  }

  .viewer-punch-summary__value {
    min-width: 66rpx;
    padding: 5rpx 12rpx;
    font-size: 20rpx;
  }
}

.viewer-signboard__name {
  display: inline-block;
  max-width: 360rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 24rpx;
  font-weight: 700;
  letter-spacing: 0.4rpx;
  white-space: nowrap;
}

.viewer-signboard__distance {
  display: inline-block;
  padding-left: 14rpx;
  border-left: 1px solid rgba(255, 255, 255, 0.14);
  font-size: 21rpx;
  color: rgba(226, 242, 255, 0.82);
  white-space: nowrap;
}

.viewer-signboard__punch-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 8rpx;
  margin-left: 4rpx;
  border-radius: 999rpx;
  border: 1px solid rgba(115, 231, 170, 0.34);
  background: rgba(20, 48, 34, 0.82);
  color: #d8ffea;
}

.viewer-signboard__punch-badge-icon {
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1;
}

.viewer-punch-badge-layer {
  position: absolute;
  inset: 0;
  z-index: 1455;
  pointer-events: none;
  overflow: hidden;
}

.viewer-punch-badge {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34rpx;
  min-height: 34rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  border: 1px solid rgba(115, 231, 170, 0.34);
  background: rgba(13, 34, 24, 0.84);
  box-shadow: 0 12rpx 24rpx rgba(0, 0, 0, 0.2);
  color: #dfffea;
  transform-origin: center bottom;
  transition: opacity 0.12s linear, transform 0.12s ease-out;
  will-change: transform, opacity;
}

.viewer-punch-badge--vehicle {
  border-color: rgba(255, 210, 127, 0.34);
  background: rgba(42, 29, 10, 0.84);
  color: #fff0cc;
}

.viewer-punch-badge__icon {
  font-size: 20rpx;
  font-weight: 700;
  line-height: 1;
}

.viewer-bubble-layer {
  position: absolute;
  inset: 0;
  z-index: 1500;
  pointer-events: none;
  overflow: hidden;
}

.viewer-bubble {
  position: absolute;
  left: 50%;
  top: calc(132rpx + var(--viewer-safe-area-top, 0px));
  max-width: min(620rpx, calc(100% - 40rpx));
  padding: 20rpx 24rpx;
  border-radius: 28rpx;
  border: 1px solid rgba(159, 214, 255, 0.24);
  background: linear-gradient(180deg, rgba(10, 16, 28, 0.94), rgba(18, 28, 42, 0.88));
  box-shadow: 0 22rpx 48rpx rgba(0, 0, 0, 0.28);
  transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), var(--behavior-bubble-offset-y, 0px));
  color: #f7fbff;
  text-align: center;
}

.viewer-bubble--node-anchored {
  transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px)));
}

.viewer-bubble__message {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.45;
  letter-spacing: 0.4rpx;
  word-break: break-word;
}

.viewer-bubble--variant-info {
  border-color: rgba(122, 198, 255, 0.26);
  background: linear-gradient(180deg, rgba(8, 20, 36, 0.94), rgba(18, 42, 66, 0.88));
}

.viewer-bubble--variant-success {
  border-color: rgba(115, 231, 170, 0.32);
  background: linear-gradient(180deg, rgba(8, 32, 24, 0.94), rgba(18, 62, 42, 0.88));
}

.viewer-bubble--variant-warning {
  border-color: rgba(255, 198, 104, 0.34);
  background: linear-gradient(180deg, rgba(40, 24, 8, 0.94), rgba(74, 44, 16, 0.88));
}

.viewer-bubble--variant-danger {
  border-color: rgba(255, 132, 132, 0.34);
  background: linear-gradient(180deg, rgba(42, 10, 14, 0.94), rgba(78, 18, 26, 0.88));
}

.viewer-info-board-overlay {
  position: absolute;
  z-index: 2050;
  pointer-events: none;
  will-change: transform, opacity;
}

.viewer-info-board {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(84vw, 560px);
  padding: 16px 18px 18px;
  border-radius: 18px;
  border: 1px solid rgba(160, 205, 255, 0.18);
  background: linear-gradient(180deg, rgba(10, 18, 30, 0.96), rgba(16, 24, 38, 0.95));
  box-shadow: 0 20rpx 52rpx rgba(0, 0, 0, 0.34);
  color: #f7fbff;
  transform-origin: center bottom;
}

.viewer-info-board__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.viewer-info-board__title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  letter-spacing: 0.3rpx;
}

.viewer-info-board__close {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background-color: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.viewer-info-board__close-icon {
  font-size: 16px;
  line-height: 1;
  color: #fff;
}

.viewer-info-board__body {
  flex: 1 1 auto;
  max-height: 100%;
  min-height: 0;
}

.viewer-info-board__loading,
.viewer-info-board__content {
  display: block;
  font-size: 28rpx;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.viewer-info-board__loading {
  opacity: 0.72;
}

.viewer-bubble--anim-fade {
  animation: viewer-bubble-fade 220ms ease-out;
}

.viewer-bubble--anim-float {
  animation: viewer-bubble-float 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.viewer-bubble--anim-scale {
  animation: viewer-bubble-scale 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.viewer-bubble--anim-shake {
  animation: viewer-bubble-shake 360ms ease-out;
}

@keyframes viewer-bubble-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes viewer-bubble-float {
  from {
    opacity: 0;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(var(--behavior-bubble-offset-y, 0px) + 18rpx));
  }
  to {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), var(--behavior-bubble-offset-y, 0px));
  }
}

@keyframes viewer-bubble-scale {
  from {
    opacity: 0;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), var(--behavior-bubble-offset-y, 0px)) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), var(--behavior-bubble-offset-y, 0px)) scale(1);
  }
}

@keyframes viewer-bubble-shake {
  0% {
    opacity: 0;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(var(--behavior-bubble-offset-y, 0px) + 10rpx));
  }
  35% {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px) - 8rpx), var(--behavior-bubble-offset-y, 0px));
  }
  55% {
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px) + 8rpx), var(--behavior-bubble-offset-y, 0px));
  }
  75% {
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px) - 4rpx), var(--behavior-bubble-offset-y, 0px));
  }
  100% {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), var(--behavior-bubble-offset-y, 0px));
  }
}

.viewer-bubble--node-anchored.viewer-bubble--anim-float {
  animation: viewer-bubble-float-anchored 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.viewer-bubble--node-anchored.viewer-bubble--anim-scale {
  animation: viewer-bubble-scale-anchored 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.viewer-bubble--node-anchored.viewer-bubble--anim-shake {
  animation: viewer-bubble-shake-anchored 360ms ease-out;
}

@keyframes viewer-bubble-float-anchored {
  from {
    opacity: 0;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px) + 18rpx));
  }
  to {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px)));
  }
}

@keyframes viewer-bubble-scale-anchored {
  from {
    opacity: 0;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px))) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px))) scale(1);
  }
}

@keyframes viewer-bubble-shake-anchored {
  0% {
    opacity: 0;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px) + 10rpx));
  }
  35% {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px) - 8rpx), calc(-100% + var(--behavior-bubble-offset-y, 0px)));
  }
  55% {
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px) + 8rpx), calc(-100% + var(--behavior-bubble-offset-y, 0px)));
  }
  75% {
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px) - 4rpx), calc(-100% + var(--behavior-bubble-offset-y, 0px)));
  }
  100% {
    opacity: 1;
    transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px)));
  }
}

.viewer-debug-overlay {
  position: absolute;
  left: 12px;
  top: calc(84px + var(--viewer-safe-area-top, 0px));
  z-index: 1900;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(8, 12, 26, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(245, 250, 255, 0.92);
  font-size: 11px;
  line-height: 1.35;
  pointer-events: auto;
}

.viewer-debug-overlay--interactive {
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

.viewer-debug-line {
  display: block;
  white-space: nowrap;
}

.viewer-debug-shadow {
  margin-top: 8px;
}

.viewer-debug-input {
  display: inline-block;
  width: 74px;
  padding: 2px 6px;
  margin: 0 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.18);
  color: rgba(245, 250, 255, 0.92);
  font-size: 12px;
}

.viewer-log-overlay {
  position: relative;
  width: 100%;
  max-width: none;
  max-height: min(56vh, 960rpx);
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(8, 12, 26, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.viewer-log-floating {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + var(--viewer-safe-area-bottom, 0px));
  z-index: 2300;
  width: auto;
}

.viewer-log-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.viewer-log-overlay__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.viewer-log-overlay__action {
  color: rgba(189, 221, 255, 0.95);
  font-size: 11px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 8px;
  border: 1px solid rgba(144, 189, 255, 0.22);
  background: rgba(43, 85, 142, 0.24);
}

.viewer-log-fab {
  pointer-events: auto;
  margin-left: auto;
  min-width: 104rpx;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(134, 176, 255, 0.24);
  background: rgba(8, 12, 26, 0.82);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.26);
}

.viewer-log-fab__text {
  color: rgba(230, 240, 255, 0.96);
  font-size: 11px;
  font-weight: 600;
}

.viewer-log-overlay__title {
  display: block;
  color: rgba(230, 240, 255, 0.9);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.viewer-log-overlay__list {
  flex: 1;
  height: min(40vh, 680rpx);
  min-height: 220rpx;
  max-height: min(40vh, 680rpx);
  pointer-events: auto;
}

.viewer-log-overlay__empty {
  display: block;
  color: rgba(208, 216, 234, 0.72);
  font-size: 11px;
  line-height: 1.45;
}

.viewer-log-overlay__item {
  display: block;
  color: rgba(230, 238, 252, 0.9);
  font-size: 11px;
  line-height: 1.42;
  margin-bottom: 4px;
  word-break: break-all;
}

.viewer-log-overlay__item.is-info {
  color: rgba(209, 229, 255, 0.92);
}

.viewer-log-overlay__item.is-warn {
  color: rgba(255, 216, 141, 0.95);
}

.viewer-log-overlay__item.is-error {
  color: rgba(255, 166, 166, 0.96);
}

.viewer-canvas {
  position: relative;
  z-index: 0;
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
  overflow: hidden;
  background-color: rgba(29, 30, 34, 0.4);
  color: #ffffff;
  font-size: 14px;
  text-align: center;
  padding: 12px;
  z-index: 1600;
}

.viewer-overlay__backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.viewer-overlay__aurora {
  position: absolute;
  border-radius: 999px;
  filter: blur(16px);
  opacity: 0.72;
  mix-blend-mode: screen;
  animation: viewer-overlay-aurora 9s ease-in-out infinite;
}

.viewer-overlay__aurora--cyan {
  top: 8%;
  left: -12%;
  width: 56%;
  height: 34%;
  background: radial-gradient(circle at 30% 50%, rgba(96, 245, 255, 0.82) 0%, rgba(96, 245, 255, 0.18) 38%, rgba(96, 245, 255, 0) 78%);
}

.viewer-overlay__aurora--amber {
  right: -10%;
  bottom: 4%;
  width: 52%;
  height: 30%;
  background: radial-gradient(circle at 50% 50%, rgba(255, 181, 77, 0.78) 0%, rgba(255, 113, 77, 0.18) 40%, rgba(255, 181, 77, 0) 76%);
  animation-duration: 11s;
  animation-direction: reverse;
}

.viewer-overlay__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(circle at 50% 42%, rgba(0, 0, 0, 0.86) 0%, rgba(0, 0, 0, 0.66) 34%, transparent 82%);
  opacity: 0.34;
  transform: perspective(700px) rotateX(70deg) translateY(24%);
  transform-origin: center top;
}

.viewer-overlay__scanline {
  position: absolute;
  left: -10%;
  right: -10%;
  top: -16%;
  height: 28%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(112, 225, 255, 0.06) 42%, rgba(112, 225, 255, 0.24) 50%, rgba(112, 225, 255, 0.06) 58%, rgba(255, 255, 255, 0) 100%);
  filter: blur(2px);
  opacity: 0.82;
  animation: viewer-overlay-scanline 3.8s linear infinite;
}

.viewer-overlay__flash {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.28);
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
}

.viewer-overlay__flash.is-active {
  opacity: 1;
}

.viewer-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 80%;
  max-width: 320px;
  z-index: 1;
}

.viewer-overlay__card {
  position: relative;
  overflow: hidden;
  width: 100%;
  background:
    linear-gradient(180deg, rgba(15, 20, 36, 0.9) 0%, rgba(7, 11, 22, 0.9) 100%);
  border: 1px solid rgba(151, 216, 255, 0.18);
  border-radius: 24px;
  padding: 24px 22px;
  box-shadow: 0 26px 70px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
}

.viewer-overlay__card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(circle at top, rgba(98, 223, 255, 0.16), transparent 34%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 34%, transparent 66%, rgba(255, 196, 124, 0.08));
  pointer-events: none;
}

.viewer-loader {
  position: relative;
  width: 160px;
  height: 160px;
  margin-bottom: 8px;
}

.viewer-loader__halo,
.viewer-loader__ring,
.viewer-loader__core,
.viewer-loader__particle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.viewer-loader__halo {
  border-radius: 999px;
  background: radial-gradient(circle, rgba(111, 233, 255, 0.22) 0%, rgba(111, 233, 255, 0.08) 36%, rgba(111, 233, 255, 0) 72%);
  animation: viewer-loader-breathe 2.8s ease-in-out infinite;
}

.viewer-loader__halo--outer {
  width: 160px;
  height: 160px;
}

.viewer-loader__halo--mid {
  width: 118px;
  height: 118px;
  animation-duration: 2.2s;
  animation-direction: reverse;
}

.viewer-loader__ring {
  border-radius: 999px;
  border: 1px solid rgba(143, 224, 255, 0.28);
}

.viewer-loader__ring--a {
  width: 132px;
  height: 132px;
  border-top-color: rgba(255, 198, 109, 0.92);
  border-right-color: rgba(94, 214, 255, 0.12);
  border-bottom-color: rgba(94, 214, 255, 0.92);
  border-left-color: rgba(94, 214, 255, 0.12);
  animation: viewer-loader-spin 2.8s linear infinite;
}

.viewer-loader__ring--b {
  width: 102px;
  height: 102px;
  border-top-color: rgba(94, 214, 255, 0.14);
  border-right-color: rgba(255, 255, 255, 0.82);
  border-bottom-color: rgba(94, 214, 255, 0.14);
  border-left-color: rgba(255, 176, 96, 0.82);
  animation: viewer-loader-spin-reverse 2.1s linear infinite;
}

.viewer-loader__ring--c {
  width: 74px;
  height: 74px;
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 0 18px rgba(82, 215, 255, 0.16);
  animation: viewer-loader-tilt 2.6s ease-in-out infinite;
}

.viewer-loader__core {
  width: 44px;
  height: 44px;
}

.viewer-loader__core-pulse {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.96) 0%, rgba(103, 231, 255, 0.96) 26%, rgba(23, 151, 255, 0.92) 58%, rgba(9, 34, 92, 0.66) 100%);
  box-shadow: 0 0 24px rgba(82, 215, 255, 0.42), 0 0 50px rgba(43, 140, 255, 0.2);
  animation: viewer-loader-core 1.6s ease-in-out infinite;
}

.viewer-loader__core-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.75);
}

.viewer-loader__particle {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(90, 221, 255, 0.7));
  box-shadow: 0 0 12px rgba(93, 220, 255, 0.55);
}

.viewer-loader__particle--1 {
  animation: viewer-loader-orbit-a 2.4s linear infinite;
}

.viewer-loader__particle--2 {
  animation: viewer-loader-orbit-a 2.4s linear infinite;
  animation-delay: -0.6s;
}

.viewer-loader__particle--3 {
  animation: viewer-loader-orbit-b 3.1s linear infinite;
}

.viewer-loader__particle--4 {
  animation: viewer-loader-orbit-b 3.1s linear infinite;
  animation-delay: -1.2s;
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

.viewer-progress__bar-fill.is-indeterminate {
  width: 38%;
  min-width: 120px;
  transition: none;
  background-image: linear-gradient(90deg, rgba(78, 221, 255, 0.18) 0%, rgba(94, 161, 255, 0.9) 35%, rgba(188, 120, 255, 0.95) 70%, rgba(114, 247, 255, 0.2) 100%);
  background-size: 240% 100%;
  animation: viewer-progress-indeterminate 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  filter: saturate(1.15);
}

.viewer-progress__bar.is-indeterminate {
  background: rgba(255, 255, 255, 0.08);
}

.viewer-progress__bar-glow {
  position: absolute;
  inset: -6px;
  pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(circle at 50% 50%, rgba(124, 188, 255, 0.34) 0%, rgba(124, 188, 255, 0) 72%);
  animation: viewer-progress-glow 1.6s ease-in-out infinite;
}

@keyframes viewer-progress-fill {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: -200% 50%;
  }
}

@keyframes viewer-progress-indeterminate {
  0% {
    left: -40%;
    opacity: 0.82;
  }
  50% {
    opacity: 1;
  }
  100% {
    left: 100%;
    opacity: 0.82;
  }
}

@keyframes viewer-progress-glow {
  0%,
  100% {
    opacity: 0.34;
    transform: scale(1);
  }
  50% {
    opacity: 0.62;
    transform: scale(1.03);
  }
}

@keyframes viewer-overlay-aurora {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(4%, -3%, 0) scale(1.08);
  }
}

@keyframes viewer-overlay-scanline {
  0% {
    transform: translateY(-18%);
    opacity: 0;
  }
  15% {
    opacity: 0.82;
  }
  85% {
    opacity: 0.82;
  }
  100% {
    transform: translateY(420%);
    opacity: 0;
  }
}

@keyframes viewer-loader-breathe {
  0%,
  100% {
    opacity: 0.52;
    transform: translate(-50%, -50%) scale(0.94);
  }
  50% {
    opacity: 0.92;
    transform: translate(-50%, -50%) scale(1.04);
  }
}

@keyframes viewer-loader-spin {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes viewer-loader-spin-reverse {
  from {
    transform: translate(-50%, -50%) rotate(360deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(0deg);
  }
}

@keyframes viewer-loader-tilt {
  0%,
  100% {
    transform: translate(-50%, -50%) rotate(0deg) scale(1);
    opacity: 0.62;
  }
  50% {
    transform: translate(-50%, -50%) rotate(18deg) scale(1.06);
    opacity: 1;
  }
}

@keyframes viewer-loader-core {
  0%,
  100% {
    transform: scale(0.9);
    filter: saturate(0.92);
  }
  50% {
    transform: scale(1.08);
    filter: saturate(1.16);
  }
}

@keyframes viewer-loader-orbit-a {
  from {
    transform: translate(-50%, -50%) rotate(0deg) translateX(64px) scale(0.8);
  }
  50% {
    transform: translate(-50%, -50%) rotate(180deg) translateX(64px) scale(1.18);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg) translateX(64px) scale(0.8);
  }
}

@keyframes viewer-loader-orbit-b {
  from {
    transform: translate(-50%, -50%) rotate(360deg) translateX(48px) scale(0.72);
  }
  50% {
    transform: translate(-50%, -50%) rotate(180deg) translateX(48px) scale(1.08);
  }
  to {
    transform: translate(-50%, -50%) rotate(0deg) translateX(48px) scale(0.72);
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

@media (max-width: 480px) {
  .viewer-overlay {
    padding: 16px;
  }

  .viewer-overlay__card {
    padding: 22px 18px;
    border-radius: 22px;
  }

  .viewer-loader {
    width: 132px;
    height: 132px;
  }

  .viewer-loader__halo--outer {
    width: 132px;
    height: 132px;
  }

  .viewer-loader__halo--mid {
    width: 96px;
    height: 96px;
  }

  .viewer-loader__ring--a {
    width: 110px;
    height: 110px;
  }

  .viewer-loader__ring--b {
    width: 84px;
    height: 84px;
  }

  .viewer-loader__ring--c {
    width: 60px;
    height: 60px;
  }
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
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  color: #FFFFFF;
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
  /* place start controls at bottom center and horizontal */
  left: 50%;
  right: auto;
  bottom: calc(16px + var(--viewer-safe-area-bottom, 0px));
  transform: translateX(-50%);
  z-index: 1540;
  transition: transform 220ms cubic-bezier(.2,.9,.2,1), left 220ms ease;
}

.viewer-drive-start__button {
  width: 124px;
  height: 124px;
  border-radius: 50%;
  border: none;
  outline: none;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 12, 26, 0.85);
  box-shadow:
    0 24px 40px rgba(2, 8, 20, 0.65),
    inset 0 0 0 1px rgba(120, 160, 255, 0.4);
  position: relative;
  overflow: visible;
  backdrop-filter: blur(16px);
}

.viewer-drive-start__button:disabled {
  opacity: 0.92;
}

.viewer-drive-start__button.is-busy {
  box-shadow:
    0 18px 32px rgba(2, 8, 20, 0.55),
    inset 0 0 0 1px rgba(214, 195, 255, 0.55);
}

.viewer-drive-start__glow {
  position: absolute;
  inset: -40%;
  background:
    radial-gradient(circle at 40% 40%, rgba(120, 210, 255, 0.55), transparent 70%),
    radial-gradient(circle at 70% 70%, rgba(255, 120, 200, 0.4), transparent 80%);
  filter: blur(18px);
  animation: viewer-drive-icon-glow 3.2s ease-in-out infinite;
}

.viewer-drive-start__icon {
  width: 90px;
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(236, 244, 255, 0.96);
  filter:
    drop-shadow(0 0 12px rgba(120, 190, 255, 0.8))
    drop-shadow(0 8px 18px rgba(0, 6, 16, 0.6));
  animation: viewer-drive-icon-flicker 2.4s ease-in-out infinite;
  z-index: 1;
}

.viewer-drive-start__icon-text {
  font-size: 64px;
  line-height: 1;
}

.viewer-drive-start__sparkline {
  position: absolute;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.05));
  opacity: 0.6;
  animation: viewer-drive-icon-spark 2s linear infinite;
  filter: blur(1px);
  z-index: 0;
}

.viewer-drive-start__busy {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(6, 10, 24, 0.45);
}

.viewer-drive-start__busy-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 3px solid rgba(214, 228, 255, 0.85);
  border-top-color: transparent;
  animation: viewer-drive-busy-spin 0.9s linear infinite;
}


.viewer-drive-console {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1550;
}

.viewer-drive-cluster {
  position: absolute;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: auto;
}

.viewer-drive-console--mobile .viewer-drive-cluster {
  max-width: none;
}

.viewer-drive-cluster--joystick {
  right: 16px;
  left: auto;
  bottom: 16px;
  align-items: center;
}

.viewer-drive-cluster--floating {
  right: auto;
  left: auto;
  top: 0;
  bottom: auto;
  transform: translate(-50%, -50%);
  transition: opacity 0.24s ease;
}

.viewer-drive-cluster--floating.is-fading {
  opacity: 0;
}

.viewer-drive-joystick {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  position: relative;
  pointer-events: auto;
  transition: transform 0.18s ease;
}

.viewer-drive-joystick.is-active {
  transform: scale(0.97);
}

.viewer-drive-cluster--throttle {
  right: 16px;
  bottom: 16px;
  left: auto;
  align-items: flex-end;
  gap: 14px;
}

.viewer-drive-cluster--actions {
  right: 16px;
  left: auto;
  top: calc(30% + var(--viewer-safe-area-top, 0px));
  transform: translateY(-50%);
  align-items: flex-end;
  flex-direction: column;
  gap: 12px;
}

.viewer-drive-icon-button {
  min-width: 48px;
  min-height: 48px;
  padding: 6px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(8, 12, 28, 0.48);
  color: #f4f6ff;
  box-shadow: 0 10px 24px rgba(4, 6, 18, 0.45);
  backdrop-filter: blur(12px);
  transition: background-color 0.18s ease, transform 0.18s cubic-bezier(.2,.9,.2,1), opacity 0.18s ease;
  position: relative;
  overflow: hidden;
}

.viewer-drive-icon-button--danger {
  background-color: rgba(74, 6, 24, 0.6);
  border-color: rgba(255, 143, 167, 0.45);
  color: #ffe5ea;
}

.viewer-drive-icon-button.is-busy,
.viewer-drive-icon-button:disabled {
  opacity: 0.7;
}

.viewer-drive-icon-button:active {
  transform: scale(0.95);
}

/* Tooltip from aria-label on hover (desktop/H5) */
.viewer-drive-icon-button:hover::after {
  content: attr(aria-label);
  position: absolute;
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  bottom: 100%;
  margin-bottom: 8px;
  background: rgba(6,10,24,0.9);
  color: #f7fbff;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(0,0,0,0.45);
  opacity: 1;
  pointer-events: none;
}

/* small click ripple effect */
.viewer-drive-icon-button::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  background: rgba(255,255,255,0.12);
  border-radius: 50%;
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  transition: transform 420ms cubic-bezier(.2,.9,.2,1), opacity 420ms linear;
}
.viewer-drive-icon-button:active::before {
  transform: translate(-50%, -50%) scale(10);
  opacity: 1;
}

/* Text-style start buttons (drive / auto-tour) */
.viewer-drive-start__text-button {
  position: relative;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(8,12,28,0.6);
  color: #f7fbff;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 10px 22px rgba(3,6,18,0.30);
  backdrop-filter: blur(10px);
  transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease, background-color 160ms ease;
}
.viewer-drive-start__text-button:active {
  transform: translateY(1px) scale(0.985);
}
.viewer-drive-start__text-button:hover::after {
  content: attr(aria-label);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(100% + 8px);
  background: rgba(6,10,24,0.9);
  color: #f7fbff;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(0,0,0,0.45);
  pointer-events: none;
}

.viewer-drive-start__text-button--stop {
  background: rgba(74, 6, 24, 0.55);
  border-color: rgba(255, 143, 167, 0.35);
}

/* group layout: arrange start buttons horizontally and center */
.viewer-drive-start__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

/* Prompt panel wrapper */
.viewer-drive-start__panel {
  padding: 10px 12px;
  border-radius: 18px;
  backdrop-filter: blur(14px);
}

.viewer-drive-start__text-button--close {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.06);
  color: rgba(245,248,255,0.95);
  padding: 8px 12px;
  border-radius: 10px;
  box-shadow: none;
}

.viewer-drive-speed-floating {
  position: absolute;
  left: 24px;
  bottom: 190px;
  z-index: 1580;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.viewer-drive-speed-left-floating {
  position: absolute;
  left: 6px;
  bottom: 206px;
  z-index: 1580;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  pointer-events: auto;
}

.viewer-drive-compass-right-floating {
  position: absolute;
  right: 6px;
  bottom: 220px;
  z-index: 1580;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.viewer-drive-hud {
  display: flex;
  align-items: center;
  gap: 6px;
}

.viewer-drive-compass {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background:
    radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.2), transparent 34%),
    linear-gradient(145deg, rgba(13, 20, 42, 0.52), rgba(6, 10, 24, 0.22));
  box-shadow:
    inset 0 0 18px rgba(0, 0, 0, 0.26),
    0 16px 30px rgba(3, 6, 18, 0.3);
  backdrop-filter: blur(14px);
}

.viewer-drive-compass::before {
  content: '';
  position: absolute;
  inset: 9%;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: radial-gradient(circle at center, rgba(14, 22, 48, 0.24), rgba(4, 7, 18, 0.08));
}

.viewer-drive-compass__ticks {
  position: absolute;
  inset: 0;
}

.viewer-drive-compass__tick {
  position: absolute;
  top: 7px;
  left: 50%;
  width: 2px;
  height: 7px;
  border-radius: 999px;
  background: rgba(227, 242, 255, 0.34);
  transform-origin: center 34px;
  z-index: 1;
}

.viewer-drive-compass__tick.is-major {
  height: 10px;
  background: rgba(133, 221, 255, 0.68);
}

.viewer-drive-compass__label-slot {
  position: absolute;
  inset: 0;
  z-index: 3;
}

.viewer-drive-compass__label {
  position: absolute;
  top: 7px;
  left: 50%;
  font-size: 0.64rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.08em;
  color: rgba(240, 248, 255, 0.92);
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.45);
  transform-origin: center center;
  z-index: 3;
}

.viewer-drive-compass__pointer {
  position: absolute;
  inset: 0;
  transform: rotate(var(--vehicle-heading, 0deg));
  transform-origin: center center;
  z-index: 2;
}


.viewer-drive-compass__pointer::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 28px;
  width: 7px;
  height: 32px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(130, 231, 255, 0.94), rgba(56, 181, 255, 0.88));
  box-shadow: 0 0 16px rgba(84, 221, 255, 0.4);
  transform: translateX(-50%);
}


.viewer-drive-compass__pointer::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 21px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 13px solid rgba(150, 237, 255, 0.96);
  filter: drop-shadow(0 0 8px rgba(88, 225, 255, 0.32));
  transform: translateX(-50%);
}

.viewer-drive-brake {
  position: absolute;
  right: 16px;
  bottom: 18px;
  z-index: 1550;
  pointer-events: auto;
}

.viewer-drive-brake-button {
  width: 94px;
  height: 94px;
  border-radius: 999px;
  border: none;
  outline: none;
  background: linear-gradient(135deg, #ff6f7b, #c81e46);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.4px;
  box-shadow: 0 18px 36px rgba(200, 30, 70, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewer-drive-brake-button.is-active {
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.viewer-drive-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: currentColor;
}

.viewer-drive-icon-text {
  font-size: 20px;
  line-height: 1;
}

.viewer-drive-pedal-button {
  width: 68px;
  height: 68px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 22px;
  border: 2px solid rgba(164, 188, 255, 0.28);
  color: #f4f6ff;
  background-color: rgba(26, 38, 82, 0.38);
  box-shadow: 0 12px 22px rgba(6, 10, 28, 0.48);
  backdrop-filter: blur(12px);
  transition: transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease, border-color 0.16s ease;
}

.viewer-drive-pedal-button--forward {
  background-color: rgba(62, 174, 255, 0.26);
  border-color: rgba(118, 206, 255, 0.45);
}

.viewer-drive-pedal-button--brake {
  background-color: rgba(255, 112, 130, 0.24);
  border-color: rgba(255, 150, 160, 0.45);
}

.viewer-drive-pedal-button.is-active {
  transform: scale(0.92);
  box-shadow: 0 6px 16px rgba(4, 6, 18, 0.55);
}

.viewer-drive-pedal-button--forward.is-active {
  background-color: rgba(62, 174, 255, 0.42);
  border-color: rgba(138, 214, 255, 0.6);
}

.viewer-drive-pedal-button--brake.is-active {
  background-color: rgba(255, 112, 130, 0.4);
  border-color: rgba(255, 168, 178, 0.6);
}

.viewer-drive-pedal-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.92;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.viewer-drive-pedal-icon-text {
  font-size: 24px;
  line-height: 1;
  color: currentColor;
}

.viewer-drive-pedal-button.is-active .viewer-drive-pedal-icon {
  transform: scale(1.1);
  opacity: 1;
}

@keyframes viewer-drive-icon-glow {
  0% {
    opacity: 0.6;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
  100% {
    opacity: 0.6;
    transform: scale(0.92);
  }
}

@keyframes viewer-drive-icon-spark {
  0% {
    transform: rotate(0deg) scale(0.95);
  }
  50% {
    transform: rotate(180deg) scale(1.05);
  }
  100% {
    transform: rotate(360deg) scale(0.95);
  }
}

@keyframes viewer-drive-icon-flicker {
  0% {
    opacity: 0.85;
    filter:
      drop-shadow(0 0 10px rgba(120, 190, 255, 0.55))
      drop-shadow(0 8px 18px rgba(0, 6, 16, 0.45));
  }
  60% {
    opacity: 1;
    filter:
      drop-shadow(0 0 18px rgba(180, 220, 255, 0.95))
      drop-shadow(0 10px 22px rgba(0, 6, 16, 0.65));
  }
  100% {
    opacity: 0.9;
    filter:
      drop-shadow(0 0 12px rgba(140, 200, 255, 0.7))
      drop-shadow(0 8px 18px rgba(0, 6, 16, 0.5));
  }
}

@keyframes viewer-drive-busy-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
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
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
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

/* Drive start buttons: make widths consistent and mobile-friendly */
.viewer-drive-start__panel {
  padding: 10px 16px;
  /* Remove any background/frame coming from global styles */
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
  backdrop-filter: none !important;
}
.viewer-drive-start__group {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  flex-wrap: nowrap; /* keep buttons on one row */
  -webkit-overflow-scrolling: touch;
}
.viewer-drive-start__btn {
  /* auto-size to content with sensible limits; wrap when needed */
  flex: 0 1 auto;
  min-width: 84px;
  max-width: 320px;
  height: 52px;
  padding: 0 18px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.04);
  color: #ffffff;
  border: none;
  box-shadow: 0 8px 18px rgba(0,0,0,0.28);
}
.viewer-drive-start__btn__label {
  display: block;
  width: 100%;
  text-align: center;
}
.viewer-drive-start__btn--primary {
  background: linear-gradient(90deg, #2b6ef6, #18c6ff);
  color: #fff;
}
.viewer-drive-start__btn--close {
  background: rgba(80,80,80,0.9);
  color: #fff;
}
.viewer-drive-start__btn.is-busy .viewer-drive-start__btn__label,
.viewer-drive-start__btn.is-busy {
  opacity: 0.84;
}
</style>
