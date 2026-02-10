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
                  <view class="viewer-drive-joystick__base"></view>
                  <view class="viewer-drive-joystick__stick" :style="joystickKnobStyle"></view>
                </view>
                <view class="viewer-drive-speed-gauge" aria-hidden="true">
                  <view class="viewer-drive-speed-gauge__dial" :style="vehicleSpeedGaugeStyle">
                    <view class="viewer-drive-speed-gauge__needle"></view>
                  </view>
                  <view class="viewer-drive-speed-gauge__values">
                    <text class="viewer-drive-speed-gauge__value">{{ vehicleSpeedKmh }}</text>
                    <text class="viewer-drive-speed-gauge__unit">km/h</text>
                  </view>
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
        <view v-if="overlayCardActive" class="viewer-overlay__content viewer-overlay__card">
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
        v-if="vehicleDrivePrompt.visible"
        class="viewer-drive-start"
      >
        <view class="viewer-drive-start__panel">
          <view class="viewer-drive-start__group">
            <button
              v-if="vehicleDrivePrompt.showDrive"
              class="viewer-drive-start__btn viewer-drive-start__btn--primary"
              :class="{ 'is-busy': vehicleDrivePrompt.busy }"
              :disabled="vehicleDrivePrompt.busy"
              type="button"
              hover-class="none"
              aria-label="进入驾驶模式"
              @tap="handleVehicleDrivePromptTap"
            >
              <text class="viewer-drive-start__btn__label">驾驶</text>
            </button>
            <button
              v-if="vehicleDrivePrompt.showAutoTour"
              class="viewer-drive-start__btn"
              :class="{ 'is-busy': vehicleDrivePrompt.busy }"
              :disabled="vehicleDrivePrompt.busy"
              type="button"
              hover-class="none"
              aria-label="自动巡游"
              @tap="handleVehicleAutoTourStartTap"
            >
              <text class="viewer-drive-start__btn__label">巡游</text>
            </button>

            <template v-if="vehicleDrivePrompt.showStopTour">
              <button
                class="viewer-drive-start__btn viewer-drive-start__btn--pause"
                :class="{ 'is-busy': vehicleDrivePrompt.busy }"
                :disabled="vehicleDrivePrompt.busy"
                type="button"
                hover-class="none"
                aria-label="暂停巡游"
                @tap="handleVehicleAutoTourPauseToggleTap"
                :aria-pressed="autoTourPaused"
              >
                  <text class="viewer-drive-start__btn__label">{{ autoTourPaused ? '继续' : '暂停' }}</text>
              </button>
              <button
                class="viewer-drive-start__btn viewer-drive-start__btn--stop"
                :class="{ 'is-busy': vehicleDrivePrompt.busy }"
                :disabled="vehicleDrivePrompt.busy"
                type="button"
                hover-class="none"
                aria-label="停止巡游"
                @tap="handleVehicleAutoTourStopTap"
              >
                  <text class="viewer-drive-start__btn__label">停止</text>
              </button>
            </template>

            <button
              v-if="!vehicleDrivePrompt.showStopTour"
              class="viewer-drive-start__btn viewer-drive-start__btn--close"
              type="button"
              hover-class="none"
              aria-label="关闭"
              @tap="handleVehicleDrivePromptClose"
            >
              <text class="viewer-drive-start__btn__label">关闭</text>
            </button>
          </view>
        </view>
      </view>
      <view
        v-if="vehicleDriveUi.visible"
        class="viewer-drive-console viewer-drive-console--mobile"
      >
        <view class="viewer-drive-cluster viewer-drive-cluster--actions">
   
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
          <button
            class="viewer-drive-icon-button viewer-drive-icon-button--danger"
            :class="{ 'is-busy': vehicleDriveExitBusy }"
            :disabled="vehicleDriveExitBusy"
            type="button"
            hover-class="none"
            aria-label="下车"
            @tap="handleVehicleDriveExitTap"
          >
            <view class="viewer-drive-icon" aria-hidden="true">
              <text class="viewer-drive-icon-text">🚪</text>
            </view>
          </button>
        </view>
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
            <view class="viewer-drive-joystick__base"></view>
            <view class="viewer-drive-joystick__stick" :style="joystickKnobStyle"></view>
          </view>
        </view>
      </view>
      <view
        v-if="vehicleDriveUi.visible"
        class="viewer-drive-speed-floating"
        aria-hidden="true"
      >
        <view class="viewer-drive-speed-gauge" :style="vehicleSpeedGaugeStyle">
          <view class="viewer-drive-speed-gauge__needle"></view>
        </view>
        <view class="viewer-drive-speed-gauge__values">
          <text class="viewer-drive-speed-gauge__value">{{ vehicleSpeedKmh }}</text>
          <text class="viewer-drive-speed-gauge__unit">km/h</text>
        </view>
      </view>

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
        <text class="viewer-debug-line">Ground size (W × D): {{ debugGroundDims.width }} m × {{ debugGroundDims.depth }} m</text>

        <view class="viewer-debug-shadow" v-if="debugShadowLightLabels.length">
          <text class="viewer-debug-line">[Light Shadow]</text>
          <picker :range="debugShadowLightLabels" :value="debugShadowSelectedLightIndex" @change="handleDebugShadowLightPick">
            <text class="viewer-debug-line">Light: {{ debugShadowSelectedLightLabel }}</text>
          </picker>
          <view class="viewer-debug-line">
            <text>Cast Shadow: </text>
            <switch
              :checked="debugShadowForm.castShadow"
              :disabled="debugShadowCastShadowDisabled"
              @change="handleDebugShadowCastShadowChange"
            />
            <text v-if="debugShadowPointShadowPolicyActive"> (Point shadow disabled)</text>
          </view>
          <view class="viewer-debug-line">
            <text>Map Size: </text>
            <picker :range="debugShadowMapSizeLabels" :value="debugShadowSelectedMapSizeIndex" @change="handleDebugShadowMapSizePick">
              <text>{{ debugShadowMapSizeLabels[debugShadowSelectedMapSizeIndex] }}</text>
            </picker>
          </view>
          <view class="viewer-debug-line">
            <text>Bias: {{ debugShadowForm.bias.toFixed(5) }}</text>
            <slider min="-0.005" max="0.005" step="0.00005" :value="debugShadowForm.bias" :disabled="debugShadowParamsDisabled" @change="handleDebugShadowBiasChange" />
          </view>
          <view class="viewer-debug-line">
            <text>NormalBias: {{ debugShadowForm.normalBias.toFixed(3) }}</text>
            <slider min="0" max="0.2" step="0.001" :value="debugShadowForm.normalBias" :disabled="debugShadowParamsDisabled" @change="handleDebugShadowNormalBiasChange" />
          </view>
          <view class="viewer-debug-line">
            <text>Radius: {{ debugShadowForm.radius.toFixed(1) }}</text>
            <slider min="0" max="10" step="0.1" :value="debugShadowForm.radius" :disabled="debugShadowParamsDisabled" @change="handleDebugShadowRadiusChange" />
          </view>
          <view class="viewer-debug-line">
            <text>Near: </text>
            <input class="viewer-debug-input" type="number" :value="debugShadowForm.cameraNear" :disabled="debugShadowParamsDisabled" @input="handleDebugShadowNearInput" />
            <text> Far: </text>
            <input class="viewer-debug-input" type="number" :value="debugShadowForm.cameraFar" :disabled="debugShadowParamsDisabled" @input="handleDebugShadowFarInput" />
          </view>
          <view class="viewer-debug-line" v-if="debugShadowSelectedLightType === 'Directional'">
            <text>Ortho Size: </text>
            <input class="viewer-debug-input" type="number" :value="debugShadowForm.orthoSize" :disabled="debugShadowParamsDisabled" @input="handleDebugShadowOrthoSizeInput" />
          </view>
        </view>
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
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SceneCloudRenderer, sanitizeCloudSettings } from '@harmony/schema/cloudRenderer';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';
import PlatformCanvas from '../PlatformCanvas.vue';
import { useProjectStore } from '../../common/stores/projectStore';
import { loadScenePackageZip, type ScenePackagePointer } from '../../common/utils/scenePackageStorage';

type SceneryProps = {
  projectId?: string;
  packageUrl?: string;
  sceneUrl?: string;
  physicsInterpolation?: boolean;
};

const props = defineProps<SceneryProps>();
const emit = defineEmits<{
  loaded: [];
  error: [message: string];
  progress: [payload: {
    title: string;
    percent: number;
    bytesLabel: string;
    loaded: number;
    total: number;
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
import { isGroundDynamicMesh, buildGroundHeightfieldData } from '@harmony/schema/groundHeightfield';
import { updateGroundChunks } from '@harmony/schema/groundMesh';
import { buildGroundAirWallDefinitions } from '@harmony/schema/airWall';
import {
  createDefaultTerrainPaintLoaders,
  syncTerrainPaintPreviewForGround as syncTerrainPaintPreviewForGroundShared,
} from '@harmony/schema/terrainPaintPreview';
import {
  ensurePhysicsWorld as ensureSharedPhysicsWorld,
  createRigidbodyBody as createSharedRigidbodyBody,
  syncBodyFromObject as syncSharedBodyFromObject,
  syncObjectFromBody as syncSharedObjectFromBody,
  removeRigidbodyInstanceBodies,
  ensureRoadHeightfieldRigidbodyInstance,
  isRoadDynamicMesh,
  type GroundHeightfieldCacheEntry,
  type WallTrimeshCacheEntry,
  type PhysicsContactSettings,
  type RigidbodyInstance,
  type RigidbodyMaterialEntry,
  type RigidbodyOrientationAdjustment,
} from '@harmony/schema/physicsEngine';
import { loadNodeObject } from '@harmony/schema/modelAssetLoader';

import { inferMimeTypeFromAssetId } from '@harmony/schema/assetTypeConversion'
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
import { addMesh as addInstancedBoundsMesh, flush as flushInstancedBounds, tick as tickInstancedBounds, clear as clearInstancedBounds, hasPending as instancedBoundsHasPending } from '@harmony/schema/instancedBoundsTracker';
import { syncContinuousInstancedModelCommitted } from '@harmony/schema/continuousInstancedModel';
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_ENVIRONMENT_GRAVITY,
  DEFAULT_ENVIRONMENT_RESTITUTION,
  DEFAULT_ENVIRONMENT_FRICTION,
  cloneEnvironmentSettings,
  resolveDocumentEnvironment,
  clampSceneNodeInstanceLayout,
  computeInstanceLayoutLocalBoundingBox,
  createAutoTourRuntime,
  createScenePreviewPerfController,

  forEachInstanceWorldMatrix,
  getInstanceLayoutBindingId,
  getInstanceLayoutCount,
  rebuildSceneNodeIndex,
  resolveInstanceLayoutTemplateAssetId,
  resolveSceneNodeById,
  resolveSceneParentNodeId,
  resolveEnabledComponentState,
  createGradientBackgroundDome,
  disposeSkyCubeTexture,
  disposeGradientBackgroundDome,
  loadSkyCubeTexture,
		extractSkycubeZipFaces,
  unzipScenePackage,
  buildAssetOverridesFromScenePackage,
  readTextFileFromScenePackage,
  type ScenePackageUnzipped,
  type EnvironmentSettings,
  type GradientBackgroundDome,
  type SceneNode,
  type SceneNodeComponentState,
  type SceneSkyboxSettings,
  type SceneJsonExportDocument,
  type LanternSlideDefinition,
  type SceneMaterialTextureRef,
  type GroundDynamicMesh,
  type Vector3Like,
} from '@harmony/schema/index';
import { applyMirroredScaleToObject, syncMirroredMeshMaterials } from '@harmony/schema/mirror';
import { ComponentManager } from '@harmony/schema/components/componentManager';
import { setActiveMultiuserSceneId } from '@harmony/schema/multiuserContext';
import {
  behaviorComponentDefinition,
  guideboardComponentDefinition,
  displayBoardComponentDefinition,
  floorComponentDefinition,
  wallComponentDefinition,
  roadComponentDefinition,
  viewPointComponentDefinition,
  warpGateComponentDefinition,
  effectComponentDefinition,
  rigidbodyComponentDefinition,
  vehicleComponentDefinition,
  waterComponentDefinition,
  protagonistComponentDefinition,
  lodComponentDefinition,
  onlineComponentDefinition,
  guideRouteComponentDefinition,
  autoTourComponentDefinition,
  purePursuitComponentDefinition,
  sceneStateAnchorComponentDefinition,
  preloadableComponentDefinition,
  WARP_GATE_RUNTIME_REGISTRY_KEY,
  WARP_GATE_EFFECT_ACTIVE_FLAG,
  GUIDEBOARD_RUNTIME_REGISTRY_KEY,
  GUIDEBOARD_EFFECT_ACTIVE_FLAG,
  GUIDEBOARD_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  VEHICLE_COMPONENT_TYPE,
  ONLINE_COMPONENT_TYPE,
  WALL_COMPONENT_TYPE,
  AUTO_TOUR_COMPONENT_TYPE,
  clampGuideboardComponentProps,
  computeGuideboardEffectActive,
  clampVehicleComponentProps,
  clampLodComponentProps,
  DEFAULT_DIRECTION,
  DEFAULT_AXLE,
  LOD_COMPONENT_TYPE,
  SCENE_STATE_ANCHOR_COMPONENT_TYPE,
} from '@harmony/schema/components';
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
  computeFollowLerpAlpha,
  computeFollowPlacement,
  createCameraFollowState,
  getApproxDimensions,
  resetCameraFollowState,
} from '@harmony/schema/followCameraController';
import { startTourAndFollow, stopTourAndUnfollow } from '@harmony/schema/autoTourHelpers';
import { syncAutoTourActiveNodesFromRuntime, resolveAutoTourFollowNodeId } from '@harmony/schema/autoTourSync';
import { holdVehicleBrakeSafe } from '@harmony/schema/purePursuitRuntime';
import { runWithProgrammaticCameraMutation, isProgrammaticCameraMutationActive } from '@harmony/schema/cameraGuard';
import type {
  GuideboardComponentProps,
  LodComponentProps,
  WarpGateComponentProps,
  RigidbodyComponentProps,
  RigidbodyComponentMetadata,
  RigidbodyPhysicsShape,
  AutoTourComponentProps,
  VehicleComponentProps,
  VehicleWheelProps,
} from '@harmony/schema/components';
import {
  addBehaviorRuntimeListener,
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
  applyMaterialOverrides,
  disposeMaterialTextures,
  type MaterialTextureAssignmentOptions,
} from '@harmony/schema/material';

// ... rest of the file unchanged (moved verbatim)
</script>
