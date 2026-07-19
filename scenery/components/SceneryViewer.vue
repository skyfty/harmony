<template>
  <view class="viewer-page">
    <view
      class="viewer-canvas-wrapper"
      @touchstart.capture="handleControlPadTouchStart"
      @touchmove.capture="handleControlPadTouchMove"
      @touchend.capture="handleControlPadTouchEnd"
      @touchcancel.capture="handleControlPadTouchEnd"
      @mousedown.capture="handleControlPadMouseDown"
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
      <view
        v-if="vehicleDriveIntroVisible"
        class="viewer-vehicle-intro-banner"
        aria-hidden="true"
      >
        <text class="viewer-vehicle-intro-banner__text">出发！</text>
      </view>
      <button
        v-if="floatingAutoTourButton.visible && !watchExclusiveUiActive"
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
        v-if="floatingAutoTourPauseButton.visible && !watchExclusiveUiActive"
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
        :style="infoBoardOverlayStyle"
      >
        <view class="viewer-info-board" :class="{ 'is-expanded': infoBoardExpanded }" :style="infoBoardPanelStyle" @tap="handleInfoBoardTap">
          <view class="viewer-info-board__header" @tap.stop="toggleInfoBoardExpanded">
            <text v-if="!infoBoardExpanded" class="viewer-info-board__title">{{ infoBoardOverlayTitle }}</text>
          </view>
          <scroll-view
            v-if="infoBoardExpanded"
            scroll-y
            show-scrollbar="false"
            class="viewer-info-board__body"
            :style="infoBoardBodyStyle"
            @tap="handleInfoBoardTap"
          >
            <text v-if="infoBoardOverlayLoading" class="viewer-info-board__loading">正在加载内容…</text>
            <text v-else class="viewer-info-board__content">{{ infoBoardOverlayContent }}</text>
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
              <text class="viewer-progress__percent">{{ sceneLoadPercentText }}</text>
              <text v-if="sceneLoadBytesLabel" class="viewer-progress__bytes">{{ sceneLoadBytesLabel }}</text>
            </view>
          </view>
        </view>
      </view>
      <SceneLoadOverlay
        :loading="loading"
        :scene-switch-overlay-visible="sceneSwitchOverlayVisible"
        :scene-switch-flash-active="sceneSwitchFlashActive"
        :scene-init="sceneInit"
        :scene-download="sceneDownload"
        :resource-preload="resourcePreload"
      />
      <view v-if="controlNodeSwitchBusy" class="viewer-control-switch-overlay" role="status" aria-live="polite">
        <view class="viewer-control-switch-spinner" aria-hidden="true"></view>
        <text>正在初始化交换控制节点…</text>
      </view>
      <view v-if="error" class="viewer-overlay error">
        <text>{{ error }}</text>
      </view>
      <view
        v-for="entry in purposeControlEntries"
        :key="entry.nodeId"
        v-show="!watchExclusiveUiActive"
        class="viewer-purpose-controls"
        :style="resolvePurposeControlStyle(entry)"
        :data-purpose-node-id="entry.nodeId"
        data-control-skip="purpose-controls"
      >
        <button
          v-for="button in entry.buttons"
          :key="button.id"
          class="viewer-purpose-chip"
          :aria-label="resolvePurposeButtonLabel(button)"
          data-control-skip="purpose-controls"
          @tap.stop.prevent="handlePurposeButtonTap(entry, button)"
        >
          <view class="viewer-purpose-chip__halo"></view>
          <view class="viewer-purpose-chip__content">
            <view class="viewer-purpose-chip__texts">
              <text class="viewer-purpose-chip__title">{{ resolvePurposeButtonDisplayLabel(button) }}</text>
            </view>
          </view>
        </button>
      </view>
      <view v-if="watchLeaveVisible" class="viewer-watch-leave-bar" data-control-skip="watch-leave">
        <view class="viewer-watch-leave-actions">
          <button
            class="viewer-watch-leave-button viewer-watch-action-button"
            type="button"
            hover-class="none"
            data-control-skip="watch-leave"
            @tap.stop.prevent="leaveActiveWatchView"
          >
            <text>离开</text>
          </button>
          <button
            class="viewer-watch-photo-button viewer-watch-action-button"
            type="button"
            hover-class="none"
            :disabled="watchSnapshotBusy"
            :aria-label="watchSnapshotBusy ? '正在保存截图' : '拍照保存当前视野'"
            data-control-skip="watch-leave"
            @tap.stop.prevent="handleWatchSnapshotTap"
          >
            <text>{{ watchSnapshotBusy ? '保存中...' : '拍照' }}</text>
          </button>
        </view>
      </view>
      <view
        v-if="vehicleDriveUi.visible && !watchExclusiveUiActive"
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
      <view v-if="autoTourTelemetryUiVisible && !watchExclusiveUiActive" class="viewer-drive-speed-left-floating">
        <SpeedReadout :speed="vehicleSpeedKmh" :aria-hidden="true" />
        <button
          v-if="vehicleDriveUi.visible"
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

      <view
        v-if="(autoTourTelemetryUiVisible || (characterControlUi.visible && isWeChatMiniProgram)) && !watchExclusiveUiActive"
        class="viewer-drive-compass-right-floating"
        aria-hidden="true"
      >
        <DriveCompass
          :compass-style="vehicleCompassStyle"
          :ticks="vehicleCompassTicks"
          :labels="vehicleCompassLabels"
        />
      </view>

      <view
        v-if="characterControlUi.visible && isWeChatMiniProgram && !watchExclusiveUiActive"
        class="viewer-character-console viewer-character-console--mobile"
      >
        <view
          v-show="characterDrivePadState.visible || characterDrivePadState.fading"
          class="viewer-drive-cluster viewer-drive-cluster--joystick viewer-drive-cluster--floating viewer-character-drive-cluster"
          :class="{ 'is-fading': characterDrivePadState.fading }"
          :style="characterDrivePadStyle"
        >
          <view
            v-show="characterDrivePadState.visible"
            ref="characterFloatingJoystickRef"
            class="viewer-drive-joystick"
            :class="{ 'is-active': characterControlUi.joystickActive }"
            role="slider"
            :aria-label="`${characterControlUi.label}移动摇杆`"
            aria-valuemin="-100"
            aria-valuemax="100"
            :aria-valuenow="Math.round(characterAuthorityInput.moveZ * 100)"
            @touchstart.stop.prevent="handleCharacterJoystickTouchStart"
            @touchmove.stop.prevent="handleCharacterJoystickTouchMove"
            @touchend.stop.prevent="handleCharacterJoystickTouchEnd"
            @touchcancel.stop.prevent="handleCharacterJoystickTouchEnd"
          >
            <DriveJoystick
              :is-active="characterControlUi.joystickActive"
              :knob-style="characterJoystickKnobStyle"
            />
          </view>
        </view>
        <view
          v-if="characterActionButtons.length"
          ref="characterActionsBarRef"
          class="viewer-character-actions-bar"
          aria-label="角色动作按钮"
          data-control-skip="character-actions"
        >
          <view class="viewer-character-actions" data-control-skip="character-actions">
            <button
              v-for="button in characterActionButtons"
              :key="button.slot"
              class="viewer-character-action-button"
              :class="{
                'is-active': button.pressed,
                'viewer-character-action-button--danger': button.emphasis === 'danger',
              }"
              type="button"
              hover-class="none"
              :aria-label="button.label"
              :aria-pressed="button.pressed"
              data-control-skip="character-actions"
              @tap.stop.prevent="handleCharacterActionButtonTap(button.slot)"
              @touchstart.stop.prevent="handleCharacterActionButtonPressStart(button.slot)"
              @touchend.stop.prevent="handleCharacterActionButtonPressEnd(button.slot)"
              @touchcancel.stop.prevent="handleCharacterActionButtonPressEnd(button.slot)"
              @mousedown.stop.prevent="handleCharacterActionButtonPressStart(button.slot)"
              @mouseup.stop.prevent="handleCharacterActionButtonPressEnd(button.slot)"
              @mouseleave.stop.prevent="handleCharacterActionButtonPressEnd(button.slot)"
            >
              <text class="viewer-character-action-button__icon">{{ button.icon }}</text>
            </button>
          </view>
        </view>
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
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { UseCanvasResult } from '@minisheep/three-platform-adapter';
import { KTX2Loader as PlatformKTX2Loader } from '@minisheep/three-platform-adapter/override/jsm/loaders/KTX2Loader';

import PlatformCanvas from './PlatformCanvas.vue';
import LanternImageFrame from './LanternImageFrame.vue';
import DriveJoystick from './DriveJoystick.vue';
import DriveCompass from './DriveCompass.vue';
import SpeedReadout from './SpeedReadout.vue';
import SceneLoadOverlay from './SceneLoadOverlay.vue';
import { buildPhysicsSceneAsset } from '@harmony/schema/physicsSceneAsset';
import { loadTextureFromSourceUrl } from '@harmony/schema/textureSourceLoader';
import {
  applyMoveToObjectWorldPose,
  applyMoveToPhysicsBodyWorldPose,
  buildMoveToTargetPose,
  buildMoveToCameraPlacement,
  resolveBindingByNodeId as resolveMoveToBindingByNodeId,
  resolveMoveToSubjectType,
  createMoveToRuntimeSession,
  resetMoveToRuntimeSession,
  resolveMoveToTargetPoseFromObject,
  resolveMoveToAlignedQuaternionForLocalForwardAxis,
  MOVE_TO_SNAP_DISTANCE,
  MOVE_TO_CHARACTER_SLOW_DISTANCE,
  MOVE_TO_CHARACTER_STOP_DISTANCE,
  MOVE_TO_VEHICLE_SLOW_DISTANCE,
  MOVE_TO_VEHICLE_STOP_DISTANCE,
  MOVE_TO_CAMERA_LERP_SPEED,
  resolveMoveToYawDeltaRadians,
  resolveMoveToYawRadiansFromForward,
  resolveMoveToWorldForwardFromQuaternion,
} from '@harmony/schema/behaviors/moveToRuntime';
import {
  type PhysicsBackendPreference,
  type PhysicsBridge,
  type PhysicsContactEvent,
  type PhysicsSceneAsset,
  type PhysicsStepFrame,
  type PhysicsTransform,
  resolvePhysicsCharacterMotorYawFromWorldQuaternion,
} from '@harmony/physics-core';
import { createKtx2Loader, FAST_KTX2_TRANSCODER_PATH } from '@harmony/schema/ktx2Loader'

import { useProjectStore } from '../common/stores/projectStore';
import { useDebugOverlay } from '../composables/useDebugOverlay';
import { useBehaviorAlert } from '../composables/useBehaviorAlert';
import { useBehaviorBubble } from '../composables/useBehaviorBubble';
import { useLanternAssets } from '../composables/useLanternAssets';
import {
  loadScenePackageZipEntry,
  loadScenePackageZip,
  removeScenePackageZip,
  resolveScenePackageZipPointerByCacheKey,
  saveScenePackageZipByCacheKey,
  type ScenePackagePointer,
} from '@harmony/utils/scene-package-storage';
import { fetchAssetBlobWithResponse, type AssetBlobDownloadResult } from '@harmony/schema/assetDownload';
import { type ScenePackageCacheMetadata } from '@harmony/utils';
import { type EnvironmentBackgroundMode } from '@harmony/schema/core';

type SceneryProps = {
  projectId?: string;
  packageUrl?: string;
  packageCacheKey?: string;
  physicsEngine?: PhysicsBackendPreference;
  createPhysicsBridge?: (engine?: PhysicsBackendPreference) => Promise<PhysicsBridge> | PhysicsBridge;
  defaultSteerIdentifier?: string;
  defaultSteerTargetType?: SteerControllableTargetType;
  controllableAssets?: ExternalControllableAsset[];
  multiuserIdentity?: MultiuserIdentity | null;
  nominateStateMap?: NominateExternalStateMap;
  physicsInterpolation?: boolean;
  serverAssetBaseUrl?: string;
  initialPunchedNodeIds?: string[];
  runtimePrefabSpawns?: RuntimePrefabSpawnRequest[];
};

const props = defineProps<SceneryProps>();
const emit = defineEmits<{
  loaded: [];
  error: [message: string];
  progress: [payload: {
    bytesLabel: string;
    loaded: number;
    total: number;
    percent: number;
    phase: string;
    stageLabel: string;
    detail: string;
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
  coupon: [payload: {
    eventName: 'coupon';
    sceneId: string;
    sceneName: string;
    clientCouponTime: string;
    behaviorCouponTime: string;
    location: {
      nodeId: string;
      nodeName: string;
    };
    coupon: {
      id: string;
      rawJson: string;
      type: string | null;
      name: string | null;
      description: string | null;
      validUntil: string | null;
    };
  }];
}>();
import {
  buildSceneGraph,
  type SceneGraphBuildOptions,
} from '@harmony/schema/sceneGraph';
import {
  instantiateRuntimePrefabControlSwitchInstanceFromPrefab,
} from '@harmony/schema/runtimePrefabControlSwitch';
import {
  buildRuntimePrefabRequestKey,
  collectRuntimePrefabPreloadContext,
  normalizeAssetIdList,
  normalizeRuntimePrefabRequest,
  resolveRuntimePrefabSource,
  type RuntimePrefabPreloadContext,
  type RuntimePrefabSource,
} from '@harmony/schema/runtimePrefabLoading';
import {
  cloneRuntimePrefabNode,
  createRuntimePrefabDocument,
  createSteerBindingIndex,
  type RuntimePrefabInitializationMode,
  type RuntimePrefabPlacementOptions,
  type RuntimePrefabSpawnRequest,
  type ExternalControllableAsset,
} from '@harmony/schema/core';
import type { ResolvedSteerBinding } from '@harmony/schema/steerBindingIndex';
import { type NodePrefabData } from '@harmony/schema/runtimePrefab';
import ResourceCache from '@harmony/schema/ResourceCache';
import { AssetCache, AssetLoader, configureAssetDownloadHostMirrors, fetchAssetBlob, type AssetCacheEntry } from '@harmony/schema/assetCache';
import { ASSET_DOWNLOAD_HOST_MIRRORS } from '@harmony/schema/assetDownloadMirrors';
import { isGroundDynamicMesh } from '@harmony/schema/groundHeightfield';
import { resolveDocumentGroundNode as resolveSharedDocumentGroundNode } from '@harmony/schema/groundNode';
import { syncGroundCollisionRuntimeLoadedTileKeys } from '@harmony/schema/groundCollisionRuntimeState';
import { clearGroundCollisionRuntimeHost, syncGroundCollisionRuntimeHost } from '@harmony/schema/groundCollisionRuntimeHost';
import { createGroundCollisionRuntimeBridgeDeps } from '@harmony/schema/groundCollisionRuntimeBridge';
import { collectGroundAnchorWorldPositions } from '@harmony/schema/groundAnchorRuntime';
import { clearCompiledGroundRenderTiles, collectLoadedCompiledGroundChunkKeys, getCompiledGroundRenderWorkState, syncCompiledGroundRenderTiles } from '@harmony/schema/compiledGroundRuntime';
import { prepareRuntimeGroundSceneDocument } from '@harmony/schema/groundSplatRuntimeDocument';
import { onGroundChunkTextureReady, refreshGroundChunkMaterials, resolveInfiniteGroundVisibleChunkWindow, setInfiniteGroundHiddenChunkKeys } from '@harmony/schema/groundMesh';

import {
  type PhysicsBodyBindingEntry as RigidbodyInstance,
  type PhysicsOrientationAdjustment as RigidbodyOrientationAdjustment,
  syncBodyFromObject as syncSharedBodyFromObject,
} from '@harmony/schema/physicsBodySync';
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
import { listCouponCatalog, grantCouponById, type CouponSceneItem } from '@harmony/utils';
import { addMesh as addInstancedBoundsMesh, flush as flushInstancedBounds, tick as tickInstancedBounds, clear as clearInstancedBounds, hasPending as instancedBoundsHasPending } from '@harmony/schema/instancedBoundsTracker';
import { syncContinuousInstancedModelCommitted } from '@harmony/schema/continuousInstancedModel';
import { WALL_INSTANCED_BINDINGS_USERDATA_KEY, hasWallInstancedBindings, syncWallInstancedBindingsForObject } from '@harmony/schema/wallInstancing';
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  DEFAULT_ENVIRONMENT_NORTH_DIRECTION,
  DEFAULT_ENVIRONMENT_GRAVITY,
  cloneEnvironmentSettings,
  resolveDocumentEnvironment,
  type EnvironmentNorthDirection,
  type EnvironmentSettings,
  type EnvironmentCsmSettings,
} from '@harmony/schema/environmentSettingsUtils';
import { deserializeGroundScatterSidecar } from '@harmony/schema/groundScatterSidecar';
import { deserializeGroundSplatSidecar } from '@harmony/schema/groundSplatSidecar';
import {
  clampSceneNodeInstanceLayout,
  computeInstanceLayoutLocalBoundingBox,
  forEachInstanceWorldMatrix,
  getInstanceLayoutBindingId,
  getInstanceLayoutCount,
  resolveInstanceLayoutTemplateAssetId,
} from '@harmony/schema/instanceLayout';
import { createWaterRuntime } from '@harmony/schema/water';
import { rebuildSceneNodeIndex, resolveSceneNodeById, resolveSceneParentNodeId } from '@harmony/schema/nodeIndexUtils';
import { resolveEnabledComponentState } from '@harmony/schema/componentRuntimeUtils';
import { createGradientBackgroundDome, disposeGradientBackgroundDome, type GradientBackgroundDome } from '@harmony/schema/gradientBackground';
import { disposeSkyCubeTexture, loadSkyCubeTexture, extractSkycubeZipFacesAsync, type ExtractSkycubeZipFacesResult } from '@harmony/schema/skyCubeTexture';
import { isSkyCubeArchiveExtension } from '@harmony/schema/core';
import {
  canNodeUseRuntimeModelInstancing,
  collectRuntimeModelNodesByAssetId,
} from '@harmony/schema/runtimeModelInstancing';
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
import type { ScenePackageSceneEntry as ScenePackageManifestSceneEntry } from '@harmony/schema/scenePackage';
import {
  createTerrainDatasetHeightSamplerFromScenePackage,
  readTerrainDatasetManifestFromScenePackage,
} from '../common/utils/terrainDatasetPackage';
import {
  createGroundRuntimeMeshFromSidecar,
} from '@harmony/schema/groundHeightSidecar';
import type {
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
} from '@harmony/schema/core';
import {
  isRuntimeHiddenInPreview,
  deserializeCompiledGroundManifest,
} from '@harmony/schema/core';
import { applyMirroredScaleToObject, syncMirroredMeshMaterials } from '@harmony/schema/mirror';
import {
  DEFAULT_SCENE_CSM_CONFIG,
  DEFAULT_SCENE_CSM_SUN_AZIMUTH_DEG,
  DEFAULT_SCENE_CSM_SUN_ELEVATION_DEG,
  type SceneCsmConfig,
} from '@harmony/schema/sceneCsmDefaults';
import {
  createSceneCsmShadowRuntime,
  resolveSceneCsmSunPositionFromAngles,
  type SceneCsmShadowRuntime,
} from '@harmony/schema/sceneCsm';
import { ComponentManager } from '@harmony/schema/components/componentManager';
import { SceneAnimationRuntimeManager } from '@harmony/schema/sceneAnimationRuntime';
import {
  setActiveMultiuserRuntimeBridge,
  setActiveMultiuserSceneId,
  type MultiuserCharacterPresentation,
  type MultiuserCharacterAnimationPresentation,
  type MultiuserIdentity,
  type MultiuserPeerPresentationState,
  type MultiuserPeerSnapshot,
  type MultiuserPeerState,
  type MultiuserPresentationVector3Like,
  type MultiuserVehiclePresentation,
  type MultiuserVehicleWheelPresentation,
  type MultiuserNodeSyncSnapshot,
  type MultiuserNodeSyncState,
  type MultiuserNodeSyncPresentation,
  type MultiuserRuntimeBridge,
  type MultiuserSubjectType,
} from '@harmony/schema/multiuserContext';
type RigidbodyComponentProps = any;
import {
  animationComponentDefinition,
  ANIMATION_COMPONENT_TYPE,
  type AnimationComponentProps,
} from '@harmony/schema/components/definitions/animationComponent';
import { CharacterControllerAnimationRuntimeManager } from '@harmony/schema/characterControllerAnimationRuntime';
import {
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  CHARACTER_ANIMATION_EDITOR_SLOTS,
  clampCharacterControllerComponentProps,
  characterControllerComponentDefinition,
  writeCharacterLocalForward,
  type CharacterAnimationSlot,
  type CharacterControllerComponentProps,
} from '@harmony/schema/components/definitions/characterControllerComponent';
import {
  GROUND_ANCHOR_COMPONENT_TYPE,
  groundAnchorComponentDefinition,
} from '@harmony/schema/components/definitions/groundAnchorComponent';
import {
  behaviorComponentDefinition,
} from '@harmony/schema/components/definitions/behaviorComponent';
import {
  billboardComponentDefinition,
} from '@harmony/schema/components/definitions/billboardComponent';
import {
  guideboardComponentDefinition,
  GUIDEBOARD_COMPONENT_TYPE,
  type GuideboardComponentProps,
} from '@harmony/schema/components/definitions/guideboardComponent';
import {
  displayBoardComponentDefinition,
} from '@harmony/schema/components/definitions/displayBoardComponent';
import {
  floorComponentDefinition,
} from '@harmony/schema/components/definitions/floorComponent';
import {
  proceduralCityComponentDefinition,
  PROCEDURAL_CITY_HOST_USER_DATA_KEY,
  cloneProceduralCityHostSnapshot,
} from '@harmony/schema/components/definitions/proceduralCityComponent';
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
  VIEW_POINT_COMPONENT_TYPE,
  resolveViewPointComponentProps,
  resolveViewPointWorldCameraPose,
  type ViewPointComponentProps,
} from '@harmony/schema/components/definitions/viewPointComponent';
import {
  particleSystemComponentDefinition,
  PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY,
  applyParticleRuntimeCommand,
  setParticleTextureResolver,
} from '@harmony/schema/components/definitions/particleSystemComponent';
import { setGroundTextureSourceResolver } from '@harmony/schema/groundTextureSourceResolver';
import {
  couponComponentDefinition,
  COUPON_COMPONENT_TYPE,
  parseCouponComponentSpec,
  type CouponComponentSpec,
} from '@harmony/schema/components/definitions/couponComponent';
import {
  rigidbodyComponentDefinition,
  clampRigidbodyComponentProps,
  RIGIDBODY_COMPONENT_TYPE,
} from '@harmony/schema/components/definitions/rigidbodyComponent';
import {
  resolveModelCollisionComponentPropsFromNode,
} from '@harmony/schema/components/definitions/modelCollisionComponent';
import {
  resolveInstancedLodTargetFromSnapshot,
} from '@harmony/schema/core';
import {
  vehicleComponentDefinition,
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  projectVehicleComponentPropsToWorldScale,
  resolveVehicleScaleFactors,
  DEFAULT_AXLE,
  type VehicleComponentProps,
  type VehicleWheelProps,
} from '@harmony/schema/components/definitions/vehicleComponent';
import {
  steerComponentDefinition,
  STEER_COMPONENT_TYPE,
  clampSteerComponentProps,
  type SteerComponentProps,
  type SteerControllableTargetType,
} from '@harmony/schema/components/definitions/steerComponent';
import {
  waterComponentDefinition,
} from '@harmony/schema/components/definitions/waterComponent';
import {
  signboardComponentDefinition,
  SIGNBOARD_COMPONENT_TYPE,
  type SignboardComponentProps,
} from '@harmony/schema/components/definitions/signboardComponent';
import {
  lodComponentDefinition,
  LOD_COMPONENT_TYPE,
  LOD_FACE_CAMERA_FORWARD_AXIS_X,
  clampLodComponentProps,
  type LodComponentProps,
} from '@harmony/schema/components/definitions/lodComponent';
import {
  onlineComponentDefinition,
  ONLINE_COMPONENT_TYPE,
} from '@harmony/schema/components/definitions/onlineComponent';
import {
  DEFAULT_REMOTE_MULTIUSER_VISIBLE_PEERS,
  getRemoteMultiuserPeerSelectionRadius,
  createRemoteMultiuserPeerVisibilityState,
  markRemoteMultiuserPeerHidden,
  markRemoteMultiuserPeerVisible,
  REMOTE_MULTIUSER_MIN_RESIDENCY_FRAMES,
  resolveMultiuserVisiblePeerLimit,
  shouldKeepRemoteMultiuserPeerVisible,
  type RemoteMultiuserPeerVisibilityState,
} from '@harmony/schema/multiuserPeerVisibility';
import {
  networkSyncComponentDefinition,
  NETWORK_SYNC_COMPONENT_TYPE,
  clampNetworkSyncComponentProps,
  type NetworkSyncComponentProps,
} from '@harmony/schema/components/definitions/networkSyncComponent';
import {
  guideRouteComponentDefinition,
} from '@harmony/schema/components/definitions/guideRouteComponent';
import {
  autoTourComponentDefinition,
  AUTO_TOUR_COMPONENT_TYPE,
  cloneAutoTourComponentProps,
  type AutoTourComponentProps,
} from '@harmony/schema/components/definitions/autoTourComponent';
import {
  purePursuitComponentDefinition
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
  preloadableComponentDefinition,
} from '@harmony/schema/components/definitions/preloadableComponent';
import type {
  AutoTourRouteSnapResult,
  VehicleDriveCameraFollowState,
  VehicleDriveCameraRestoreState,
  VehicleDriveControlFlags,
  VehicleDriveInputState,
  VehicleDriveRuntimeState,
  VehicleInstance,
  VehicleDriveVehicle,
} from '@harmony/schema/motion';
import {
  FollowCameraController,
  DEFAULT_BACK_FOLLOW_CAMERA_DISTANCE_SCALE,
  createBackFollowCameraTuning,
  computeFollowLerpAlpha,
  computeFollowPlacement,
  createCameraFollowState,
  createFollowCameraMotionState,
  getApproxDimensions,
  resolveBackFollowCameraLocalOffset,
  resetCameraFollowState,
  resetFollowCameraMotionState,
  updateBackFollowCamera,
} from '@harmony/schema/motion';
import type { FollowCameraMotionState, CameraFollowPlacement, CameraFollowState } from '@harmony/schema/followCameraController';
import {
  VehicleDriveController,
  createAutoTourRuntime,
  createBridgeVehicleProxy,
  createPhysicsAwareAutoTourVehicleInstances,
  CharacterAutoTourRuntimeManager,
  createControlledNodeMotionRuntime,
  resolveVehicleOrObjectWorldPosition,
  stopTourAndUnfollow,
  syncAutoTourActiveNodesFromRuntime,
  resolveAutoTourFollowNodeId,
  holdVehicleBrakeSafe,
  updateVehicleSpeedAndApplyParkingHoldSafe,
  VEHICLE_PARKED_SPEED_EPSILON,
  VEHICLE_PARKING_HOLD_SPEED_EPSILON,
} from '@harmony/schema/motion';
import { createBridgePhysicsBodyProxy } from '@harmony/schema/bridgePhysicsBodyProxy';
import {
  createScenePreviewPerfController,
  disposeSignboardBillboards,
  syncSignboardBillboards,
  runWithProgrammaticCameraMutation,
  isProgrammaticCameraMutationActive,
  SIGNBOARD_CLOSE_FADE_DISTANCE,
  SIGNBOARD_MIN_SCREEN_Y_PERCENT,
  createSignboardPlacementSmoothingState,
  DEFAULT_SIGNBOARD_PLACEMENT_SMOOTH_SPEED,
  computeSignboardPlacement,
  resolveSignboardAnchorWorldPosition,
  computePurposeOverlayPlacement,
  resolvePurposeOverlayAnchorWorldPosition,
  resolvePurposeOverlayPlacements,
  type PurposeOverlayPlacement,
  smoothSignboardPlacement,
} from '@harmony/schema/overlay';
import { createCanvas, type HarmonyCanvas, type HarmonyCanvas2DContext } from '@harmony/schema/canvas';
import { createTerrainScatterLodRuntime } from '@harmony/schema/scatter';
import type { InstancedLodBoundsSnapshot } from '@harmony/schema/core';
import {
	buildInstancedLodCullingRequest,
	buildInstancedLodCullingCandidateSnapshot,
	buildInstancedLodTargetFromParallelSnapshot,
	dispatchInstancedLodCullingRequestWithCandidates,
	type InstancedLodCullingResponse,
	type InstancedLodCullingCandidateSnapshot,
	type InstancedLodCullingRequest,
} from '../common/utils/instancedLodCulling';
import type { InstancedLodTarget, ShowPurposeBehaviorButton } from '@harmony/schema/core';
import type {
  SignboardPlacementSmoothingState,
  SignboardBillboardStyle,
} from '@harmony/schema/overlay';
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
} from '@harmony/schema/behaviors/runtime';
import {
  createBehaviorProximityRuntime,
  resolveBehaviorObserverContext,
  type BehaviorObserverCandidate,
  type BehaviorObserverContext,
  type BehaviorProximityCandidate,
  type BehaviorProximityState,
} from '@harmony/schema/behaviors/proximity';
import {
  applyBehaviorVisibilityChange,
  handleBehaviorDelayEvent,
  handleBehaviorPlayAnimationEvent,
  handleBehaviorStopAnimationEvent,
  dispatchPerformBehaviorEvent,
} from '@harmony/schema/behaviors/eventHelpers';
import { resolvePerformSequenceLabel } from '@harmony/schema/behaviors/sequenceOptions';
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
  compiledGroundBuildKey?: string | null;
  assetOverrides?: SceneGraphBuildOptions['assetOverrides'];
}

type RequestedMode = 'project' | null;


declare namespace UniApp {
  interface NodeInfo {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  }
}

interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

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
  camera: {
    position: SceneStackVec3Tuple;
    quaternion: SceneStackQuatTuple;
    up: SceneStackVec3Tuple;
    fov: number;
    near: number;
    far: number;
    zoom: number;
  };
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
    }
  | {
      kind: 'external';
      id: string;
      name: string;
      createdAt: string | null;
      updatedAt: string | null;
      sceneJsonUrl: string;
    };

type ScenePackageProjectData = {
  project: ScenePackageProject;
  compiledGroundBuildKey: string;
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
  phase: 'download' as 'download' | 'parse' | 'read-cache' | 'unzip' | 'manifest' | 'resource-map' | 'project-meta' | 'scene-documents' | 'scene-runtime' | 'bundle' | 'render',
  loaded: 0,
  total: 0,
  percent: 0,
  label: '正在下载场景数据…',
  detail: '',
  currentIndex: 0,
  currentTotal: 0,
  currentLabel: '',
  indeterminate: false,
});

type SceneInitStage =
  | 'idle'
  | 'preparing'
  | 'building'
  | 'mounting'
  | 'syncingPreviewIndex'
  | 'syncingPhysics'
  | 'syncingScatter'
  | 'finalizing'
  | 'ready'
  | 'cancelled'
  | 'error';

const sceneInitStageWeights: Record<Exclude<SceneInitStage, 'idle' | 'ready' | 'cancelled' | 'error'>, { start: number; span: number }> = {
  preparing: { start: 0, span: 6 },
  building: { start: 6, span: 42 },
  mounting: { start: 48, span: 10 },
  syncingPreviewIndex: { start: 58, span: 12 },
  syncingPhysics: { start: 70, span: 13 },
  syncingScatter: { start: 83, span: 12 },
  finalizing: { start: 95, span: 5 },
};

const sceneInit = reactive({
  active: false,
  stage: 'idle' as SceneInitStage,
  label: '',
  percent: 0,
  stagePercent: 0,
  currentIndex: 0,
  currentTotal: 0,
  indeterminate: false,
});

function resolveSceneInitPercent(stage: SceneInitStage, stagePercent = 0): number {
  if (stage === 'ready') {
    return 100;
  }
  if (stage === 'cancelled' || stage === 'error' || stage === 'idle') {
    return clampPercent(sceneInit.percent);
  }
  const weight = sceneInitStageWeights[stage];
  if (!weight) {
    return clampPercent(stagePercent);
  }
  const normalizedStage = Math.max(0, Math.min(100, stagePercent));
  return clampPercent(weight.start + ((weight.span * normalizedStage) / 100));
}

function setSceneInitState(next: {
  stage: SceneInitStage;
  label?: string;
  detail?: string;
  stagePercent?: number;
  currentIndex?: number;
  currentTotal?: number;
  currentLabel?: string;
  indeterminate?: boolean;
  active?: boolean;
}): void {
  sceneInit.stage = next.stage;
  sceneInit.active = next.active ?? (next.stage !== 'ready' && next.stage !== 'cancelled' && next.stage !== 'error');
  sceneInit.label = typeof next.label === 'string' ? next.label : sceneInit.label;
  sceneInit.stagePercent = typeof next.stagePercent === 'number' && Number.isFinite(next.stagePercent) ? Math.max(0, Math.min(100, next.stagePercent)) : sceneInit.stagePercent;
  sceneInit.percent = resolveSceneInitPercent(next.stage, sceneInit.stagePercent);
  if (typeof next.currentIndex === 'number' && Number.isFinite(next.currentIndex)) {
    sceneInit.currentIndex = Math.max(0, Math.floor(next.currentIndex));
  }
  if (typeof next.currentTotal === 'number' && Number.isFinite(next.currentTotal)) {
    sceneInit.currentTotal = Math.max(0, Math.floor(next.currentTotal));
  }
  if (typeof next.indeterminate === 'boolean') {
    sceneInit.indeterminate = next.indeterminate;
  }
}

function clearSceneInitState(): void {
  sceneInit.active = false;
  sceneInit.stage = 'idle';
  sceneInit.label = '';
  sceneInit.percent = 0;
  sceneInit.stagePercent = 0;
  sceneInit.currentIndex = 0;
  sceneInit.currentTotal = 0;
  sceneInit.indeterminate = false;
}

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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasHydratedGroundHeight(document: SceneJsonExportDocument | null | undefined): boolean {
  const groundNode = resolveSharedDocumentGroundNode(document);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return false;
  }
  const runtimeGroundMesh = groundNode.dynamicMesh as GroundDynamicMesh & {
    runtimeHydratedHeightState?: 'pristine' | 'dirty' | 'none';
  };
  return runtimeGroundMesh.runtimeHydratedHeightState === 'pristine';
}

function requireGroundRuntimeAssets(
  document: SceneJsonExportDocument,
  compiledTileCount: number,
): void {
  const groundNode = resolveSharedDocumentGroundNode(document);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return;
  }
  if (compiledTileCount > 0 || hasHydratedGroundHeight(document)) {
    return;
  }
  throw new Error('场景缺少地形运行时数据，请重新导出场景包');
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: () => void) => setTimeout(callback, 16);
    schedule(() => resolve());
  });
}

function setSceneDownloadState(next: {
  phase: typeof sceneDownload.phase;
  label: string;
  percent?: number;
  detail?: string;
  loaded?: number;
  total?: number;
  currentIndex?: number;
  currentTotal?: number;
  currentLabel?: string;
  indeterminate?: boolean;
}): void {
  sceneDownload.active = true;
  sceneDownload.phase = next.phase;
  sceneDownload.label = next.label;
  if (typeof next.detail === 'string') {
    sceneDownload.detail = next.detail.trim();
  }
  if (typeof next.percent === 'number') {
    sceneDownload.percent = clampPercent(next.percent);
  }
  if (typeof next.loaded === 'number' && Number.isFinite(next.loaded)) {
    sceneDownload.loaded = Math.max(0, Math.floor(next.loaded));
  }
  if (typeof next.total === 'number' && Number.isFinite(next.total)) {
    sceneDownload.total = Math.max(0, Math.floor(next.total));
  }
  if (typeof next.currentIndex === 'number' && Number.isFinite(next.currentIndex)) {
    sceneDownload.currentIndex = Math.max(0, Math.floor(next.currentIndex));
  }
  if (typeof next.currentTotal === 'number' && Number.isFinite(next.currentTotal)) {
    sceneDownload.currentTotal = Math.max(0, Math.floor(next.currentTotal));
  }
  if (typeof next.currentLabel === 'string') {
    sceneDownload.currentLabel = next.currentLabel.trim();
  }
  if (typeof next.indeterminate === 'boolean') {
    sceneDownload.indeterminate = next.indeterminate;
  }
}

function clearSceneDownloadState(): void {
  sceneDownload.active = false;
  sceneDownload.phase = 'download';
  sceneDownload.loaded = 0;
  sceneDownload.total = 0;
  sceneDownload.percent = 0;
  sceneDownload.label = '正在准备场景包';
  sceneDownload.detail = '';
  sceneDownload.currentIndex = 0;
  sceneDownload.currentTotal = 0;
  sceneDownload.currentLabel = '';
  sceneDownload.indeterminate = false;
}
import {
  computePlaySoundDistanceGain,
  resolvePlaySoundSourcePoint,
  createIndexedDbPersistentAssetStorage,
  createNoopPersistentAssetStorage,
  createWeChatFileSystemPersistentAssetStorage,
  isIndexedDbPersistentAssetStorageSupported,
  isWeChatFileSystemPersistentAssetStorageSupported,
} from '@harmony/schema/core';
import {
  createPhysicsBridgeVehicleInputSyncState,
  resetPhysicsBridgeVehicleInputSyncState,
  syncPhysicsBridgeVehicleInput,
} from '@harmony/schema/vehicleInput';

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
let sceneDownloadController: AbortController | null = null;
type RGBELoaderClass = new (manager?: THREE.LoadingManager) => RGBELoader;
let rgbeLoaderClassPromise: Promise<RGBELoaderClass> | null = null;
async function createRgbELoader(manager?: THREE.LoadingManager): Promise<RGBELoader> {
  if (!rgbeLoaderClassPromise) {
    rgbeLoaderClassPromise = import('three/examples/jsm/loaders/RGBELoader.js').then(
      (module) => module.RGBELoader as RGBELoaderClass,
    );
  }
  const LoaderClass = await rgbeLoaderClassPromise;
  return new LoaderClass(manager);
}

async function loadRgbETextureFromUrl(url: string, manager?: THREE.LoadingManager): Promise<THREE.DataTexture> {
  const hdrLoader = await createRgbELoader(manager);
  const buffer = await requestBinaryFromUrl(url);
  const texData = hdrLoader.parse(buffer);
  const texture = new THREE.DataTexture(texData.data as any, texData.width, texData.height);
  texture.type = texData.type;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

async function loadKtx2TextureFromUrl(
  url: string,
  renderer: THREE.WebGLRenderer | null | undefined,
  manager?: THREE.LoadingManager,
): Promise<THREE.Texture> {
  if (!renderer) {
    throw new Error('KTX2 texture loading requires an active scene renderer')
  }
  const ktx2Loader = isWeChatMiniProgram
    ? new PlatformKTX2Loader(manager).detectSupport(renderer)
    : await createKtx2Loader(renderer, { manager, transcoderPath: FAST_KTX2_TRANSCODER_PATH })
  return await ktx2Loader.loadAsync(url)
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
  updateDebugFps,
  syncInstancingDebugCounters,
  syncRendererDebug,
} = useDebugOverlay();

const debugOverlayAriaLabel = computed(() => (debugMode.value === 'full' ? '调试信息，当前 full 模式，点击切换为 fps 模式' : '调试信息，当前 fps 模式，点击切换为 full 模式'));

type InstancedTransformCacheEntry = {
  assetId: string | null;
  visible: boolean;
  elements: number[];
};

const instancedTransformCache = new Map<string, InstancedTransformCacheEntry>();

type InstancedProxySyncSnapshot = {
  kind: 'wall' | 'layout';
  assetId: string | null;
  visible: boolean;
  renderKind?: 'billboard' | 'model';
  layoutSource?: unknown;
  wallBindingsSource?: unknown;
  faceCamera?: boolean;
  elements: number[];
};

const instancedProxySyncSnapshotCache = new WeakMap<THREE.Object3D, InstancedProxySyncSnapshot>();

type InstancedTransformTargetCacheEntry = {
  revision: number;
  targets: THREE.Object3D[];
};

const instancedTransformTargetCache = new WeakMap<THREE.Object3D, InstancedTransformTargetCacheEntry>();

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

const sceneLoadPercent = computed(() => {
  if (sceneInit.active) {
    return sceneInit.percent;
  }
  if (sceneDownload.active) {
    if (sceneDownload.phase === 'download' && sceneDownload.total > 0) {
      const ratio = Math.min(1, Math.max(0, sceneDownload.loaded / sceneDownload.total));
      return Math.round(ratio * 100);
    }
    if (sceneDownload.phase === 'render' && resourcePreload.active) {
      const base = Math.max(0, Math.min(100, Math.round(sceneDownload.percent)));
      const preloadPercent = Math.max(0, Math.min(100, resourcePreloadPercent.value));
      const blended = base + Math.round((100 - base) * (preloadPercent / 100));
      return Math.max(base, Math.min(100, blended));
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

const sceneLoadBytesLabel = computed(() => {
  if (sceneInit.active) {
    const countLabel = sceneInit.currentTotal > 0 ? `${Math.max(0, sceneInit.currentIndex + 1)} / ${sceneInit.currentTotal}` : '';
    return countLabel;
  }
  if (sceneDownload.active && sceneDownload.phase === 'download' && sceneDownload.total > 0) {
    return `${formatByteSize(sceneDownload.loaded)} / ${formatByteSize(sceneDownload.total)}`;
  }
  if (sceneDownload.active && sceneDownload.phase === 'render' && resourcePreload.active && resourcePreloadBytesLabel.value) {
    return resourcePreloadBytesLabel.value;
  }
  if (resourcePreload.active && resourcePreloadBytesLabel.value) {
    return resourcePreloadBytesLabel.value;
  }
  return '';
});

const sceneLoadPercentText = computed(() => `${sceneLoadPercent.value}%`);

const SKY_ENVIRONMENT_INTENSITY = 0.6;
const CAMERA_FORWARD_OFFSET = 1.5;
const DEFAULT_SCENE_CAMERA_FAR = 1000;
const SCENERY_FOG_HEADROOM_RATIO = 0.88;
const SCENERY_FOG_MIN_DISTANCE = 0.001;
const SCENERY_GROUND_FOG_UNLOAD_BUFFER_MIN_CHUNKS = 4;
const SCENERY_GROUND_FOG_UNLOAD_BUFFER_RATIO = 0.5;
const CAMERA_WATCH_DURATION = 2.0;
const CAMERA_LEVEL_DURATION = 2.5;
const VEHICLE_DRIVE_INTRO_HOLD_SECONDS = 2.0;
const VEHICLE_DRIVE_INTRO_BLEND_SECONDS = 1.2;
const VEHICLE_DRIVE_INTRO_READY_TIMEOUT_MS = 3200;
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
const lanternCloseIcon = '✖️';

let backgroundTexture: THREE.Texture | null = null;
let backgroundTextureCleanup: (() => void) | null = null;
let backgroundTextureSourceKind: 'texture' | null = null;
let backgroundAssetId: string | null = null;
let skyCubeTexture: THREE.CubeTexture | null = null;
let gradientBackgroundDome: GradientBackgroundDome | null = null;
let skyCubeZipAssetId: string | null = null;
let skyCubeZipFaceUrlCleanup: (() => void) | null = null;
let backgroundLoadToken = 0;
let pendingEnvironmentSettings: EnvironmentSettings | null = null;
let activeEnvironmentSettings = cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS);
type AppliedSceneryFogSnapshot = {
  mode: EnvironmentSettings['fogMode'];
  color: string;
  cameraFar: number;
  fogNear: number;
  fogFar: number;
  fogDensity: number;
};
let appliedSceneryFogSnapshot: AppliedSceneryFogSnapshot | null = null;
const sceneryFogColorScratch = new THREE.Color();
const sceneryFogCameraWorldScratch = new THREE.Vector3();
type CameraFrameSnapshot = {
  nowMs: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};
const cameraFrameSnapshotPosition = new THREE.Vector3();
const cameraFrameSnapshotQuaternion = new THREE.Quaternion();
let renderContext: RenderContext | null = null;
let currentDocument: SceneJsonExportDocument | null = null;
let remoteMultiuserVisiblePeerLimit = DEFAULT_REMOTE_MULTIUSER_VISIBLE_PEERS;
let remoteMultiuserVisibilityFrame = 0;
const pendingRuntimePrefabSpawnRequests: RuntimePrefabSpawnRequest[] = [];
const appliedRuntimePrefabSpawnKeys = new Set<string>();
const spawnedRuntimePrefabRoots = new Map<string, { root: THREE.Object3D; mode: RuntimePrefabInitializationMode; wheelNodeIds: string[]; nodeId?: string | null }>();
let runtimePrefabBehaviorCounter = 0;
let runtimePrefabFlushInFlight = false;
let dynamicGroundCache: { nodeId: string; node: SceneNode; dynamicMesh: GroundRuntimeDynamicMesh } | null = null;
let sceneGraphRoot: THREE.Object3D | null = null;
let activeScenePackageBuildKey: string | null = null;
let lastCompiledGroundLoadedChunkVersion = -1;
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
    const runtime = createSceneCsmShadowRuntime(context.scene, context.camera, config);
    sceneCsmShadowRuntime = runtime;
    sceneCsmRuntimeConfigKey = configKey;
    runtime.registerObject(context.scene);
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
  sceneCsmShadowRuntime?.setActive(castShadows);
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
        texture = await loadRgbETextureFromUrl(source);
      } else if (extension === 'ktx2') {
        texture = await loadKtx2TextureFromUrl(source, renderContext?.renderer ?? null);
      } else {
        // EXR is not available in all module environments; fall back to image loader.
        texture = await loadTextureFromSourceUrl(source);
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
previewComponentManager.registerDefinition(proceduralCityComponentDefinition);
previewComponentManager.registerDefinition(animationComponentDefinition);
previewComponentManager.registerDefinition(wallComponentDefinition);
previewComponentManager.registerDefinition(boundaryWallComponentDefinition);
previewComponentManager.registerDefinition(roadComponentDefinition);
previewComponentManager.registerDefinition(landformComponentDefinition);
previewComponentManager.registerDefinition(guideboardComponentDefinition);
previewComponentManager.registerDefinition(displayBoardComponentDefinition);
previewComponentManager.registerDefinition(billboardComponentDefinition);
previewComponentManager.registerDefinition(signboardComponentDefinition);
previewComponentManager.registerDefinition(viewPointComponentDefinition);
previewComponentManager.registerDefinition(particleSystemComponentDefinition);
previewComponentManager.registerDefinition(couponComponentDefinition);
previewComponentManager.registerDefinition(behaviorComponentDefinition);
previewComponentManager.registerDefinition(characterControllerComponentDefinition);
previewComponentManager.registerDefinition(rigidbodyComponentDefinition);
previewComponentManager.registerDefinition(vehicleComponentDefinition);
previewComponentManager.registerDefinition(steerComponentDefinition);
previewComponentManager.registerDefinition(waterComponentDefinition);
previewComponentManager.registerDefinition(lodComponentDefinition);
previewComponentManager.registerDefinition(onlineComponentDefinition);
previewComponentManager.registerDefinition(networkSyncComponentDefinition);
previewComponentManager.registerDefinition(guideRouteComponentDefinition);
previewComponentManager.registerDefinition(autoTourComponentDefinition);
previewComponentManager.registerDefinition(purePursuitComponentDefinition);
previewComponentManager.registerDefinition(sceneStateAnchorComponentDefinition);
previewComponentManager.registerDefinition(groundAnchorComponentDefinition);
previewComponentManager.registerDefinition(nominateComponentDefinition);
previewComponentManager.registerDefinition(preloadableComponentDefinition);

const previewNodeMap = new Map<string, SceneNode>();
const previewParentMap = new Map<string, string | null>();
const steerBindingIndex = createSteerBindingIndex();
const hiddenVehicleDriveNodeIds = new Set<string>();
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
const instancedCullingWorldPosition = new THREE.Vector3();
let instancedLodCullingRequestId = 0;
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

const COMPILED_GROUND_MOVE_THRESHOLD_M = isWeChatMiniProgram ? 0.16 : 0.1;
const COMPILED_GROUND_ROT_THRESHOLD_DEG = isWeChatMiniProgram ? 0.8 : 0.4;
const COMPILED_GROUND_MAX_STALE_MS = isWeChatMiniProgram ? 180 : 120;
const COMPILED_GROUND_MIN_INTERVAL_MS = isWeChatMiniProgram ? 48 : 33;
const COMPILED_GROUND_ROT_THRESHOLD_RAD = (COMPILED_GROUND_ROT_THRESHOLD_DEG * Math.PI) / 180;
const compiledGroundLastCameraPos = new THREE.Vector3();
const compiledGroundLastCameraQuat = new THREE.Quaternion();
const compiledGroundCameraPosScratch = new THREE.Vector3();
const compiledGroundCameraQuatScratch = new THREE.Quaternion();
let compiledGroundLastUpdateAtMs = 0;
let compiledGroundForceNextUpdate = true;

const SCENE_CSM_MOVE_THRESHOLD_M = isWeChatMiniProgram ? 0.06 : 0.04;
const SCENE_CSM_ROT_THRESHOLD_DEG = isWeChatMiniProgram ? 0.35 : 0.2;
const SCENE_CSM_MAX_STALE_MS = isWeChatMiniProgram ? 220 : 160;
const SCENE_CSM_MIN_INTERVAL_MS = isWeChatMiniProgram ? 40 : 33;
const SCENE_CSM_ROT_THRESHOLD_RAD = (SCENE_CSM_ROT_THRESHOLD_DEG * Math.PI) / 180;
const sceneCsmLastCameraPos = new THREE.Vector3();
const sceneCsmLastCameraQuat = new THREE.Quaternion();
const sceneCsmCameraPosScratch = new THREE.Vector3();
const sceneCsmCameraQuatScratch = new THREE.Quaternion();
let sceneCsmLastUpdateAtMs = 0;
let sceneCsmForceNextUpdate = true;
// Overlay signboards are relatively expensive because they drive canvas texture redraws.
// Keep them a bit less eager than the rest of the camera-dependent systems.
const OVERLAY_SYNC_MOVE_THRESHOLD_M = isWeChatMiniProgram ? 0.16 : 0.1;
const OVERLAY_SYNC_ROT_THRESHOLD_DEG = isWeChatMiniProgram ? 0.75 : 0.35;
const OVERLAY_SYNC_MAX_STALE_MS = isWeChatMiniProgram ? 200 : 140;
const OVERLAY_SYNC_MIN_INTERVAL_MS = isWeChatMiniProgram ? 66 : 48;
const OVERLAY_SYNC_ROT_THRESHOLD_RAD = (OVERLAY_SYNC_ROT_THRESHOLD_DEG * Math.PI) / 180;
const overlaySyncLastCameraPos = new THREE.Vector3();
const overlaySyncLastCameraQuat = new THREE.Quaternion();
const overlaySyncCameraPosScratch = new THREE.Vector3();
const overlaySyncCameraQuatScratch = new THREE.Quaternion();
let overlaySyncLastUpdateAtMs = 0;
let overlaySyncForceNextUpdate = true;

function markTerrainScatterUpdateDirty(): void {
  terrainScatterForceNextUpdate = true;
}

function markOverlayRuntimeDirty(): void {
  overlaySyncForceNextUpdate = true;
}

function refreshCameraFrameSnapshot(camera: THREE.Camera, nowMs: number): CameraFrameSnapshot {
  camera.updateWorldMatrix(true, false);
  camera.getWorldPosition(cameraFrameSnapshotPosition);
  camera.getWorldQuaternion(cameraFrameSnapshotQuaternion);
  return {
    nowMs,
    position: cameraFrameSnapshotPosition,
    quaternion: cameraFrameSnapshotQuaternion,
  };
}

function shouldRunTerrainScatterUpdate(snapshot: CameraFrameSnapshot | null): boolean {
  if (!snapshot) {
    return true;
  }
  terrainScatterCameraPosScratch.copy(snapshot.position);
  terrainScatterCameraQuatScratch.copy(snapshot.quaternion);

  if (terrainScatterForceNextUpdate) {
    terrainScatterForceNextUpdate = false;
    terrainScatterLastUpdateAtMs = snapshot.nowMs;
    terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
    terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
    return true;
  }

  if (
    TERRAIN_SCATTER_MAX_STALE_MS > 0
    && snapshot.nowMs - terrainScatterLastUpdateAtMs >= TERRAIN_SCATTER_MAX_STALE_MS
  ) {
    terrainScatterLastUpdateAtMs = snapshot.nowMs;
    terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
    terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
    return true;
  }

  const moveThresholdSq = TERRAIN_SCATTER_MOVE_THRESHOLD_M * TERRAIN_SCATTER_MOVE_THRESHOLD_M;
  if (moveThresholdSq > 0 && terrainScatterCameraPosScratch.distanceToSquared(terrainScatterLastCameraPos) >= moveThresholdSq) {
    terrainScatterLastUpdateAtMs = snapshot.nowMs;
    terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
    terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
    return true;
  }

  if (TERRAIN_SCATTER_ROT_THRESHOLD_RAD > 0) {
    const dot = Math.min(1, Math.abs(terrainScatterLastCameraQuat.dot(terrainScatterCameraQuatScratch)));
    const angle = 2 * Math.acos(dot);
    if (Number.isFinite(angle) && angle >= TERRAIN_SCATTER_ROT_THRESHOLD_RAD) {
      terrainScatterLastUpdateAtMs = snapshot.nowMs;
      terrainScatterLastCameraPos.copy(terrainScatterCameraPosScratch);
      terrainScatterLastCameraQuat.copy(terrainScatterCameraQuatScratch);
      return true;
    }
  }

  return false;
}

function shouldRunCompiledGroundTileSync(snapshot: CameraFrameSnapshot | null): boolean {
  if (!snapshot) {
    return true;
  }
  compiledGroundCameraPosScratch.copy(snapshot.position);
  compiledGroundCameraQuatScratch.copy(snapshot.quaternion);

  if (compiledGroundForceNextUpdate) {
    compiledGroundForceNextUpdate = false;
    compiledGroundLastUpdateAtMs = snapshot.nowMs;
    compiledGroundLastCameraPos.copy(compiledGroundCameraPosScratch);
    compiledGroundLastCameraQuat.copy(compiledGroundCameraQuatScratch);
    return true;
  }

  const moveThresholdSq = COMPILED_GROUND_MOVE_THRESHOLD_M * COMPILED_GROUND_MOVE_THRESHOLD_M;
  const movedEnough = moveThresholdSq > 0
    && compiledGroundCameraPosScratch.distanceToSquared(compiledGroundLastCameraPos) >= moveThresholdSq;
  const rotatedEnough = (() => {
    if (COMPILED_GROUND_ROT_THRESHOLD_RAD <= 0) {
      return false;
    }
    const dot = Math.min(1, Math.abs(compiledGroundLastCameraQuat.dot(compiledGroundCameraQuatScratch)));
    const angle = 2 * Math.acos(dot);
    return Number.isFinite(angle) && angle >= COMPILED_GROUND_ROT_THRESHOLD_RAD;
  })();
  const shouldUpdateForMotion = movedEnough || rotatedEnough;

  if (shouldUpdateForMotion && snapshot.nowMs - compiledGroundLastUpdateAtMs < COMPILED_GROUND_MIN_INTERVAL_MS) {
    return false;
  }

  if (
    !shouldUpdateForMotion
    && COMPILED_GROUND_MAX_STALE_MS > 0
    && snapshot.nowMs - compiledGroundLastUpdateAtMs < COMPILED_GROUND_MAX_STALE_MS
  ) {
    return false;
  }

  compiledGroundLastUpdateAtMs = snapshot.nowMs;
  compiledGroundLastCameraPos.copy(compiledGroundCameraPosScratch);
  compiledGroundLastCameraQuat.copy(compiledGroundCameraQuatScratch);
  return true;
}

function shouldRunSceneCsmShadowUpdate(snapshot: CameraFrameSnapshot | null): boolean {
  if (!snapshot) {
    return true;
  }
  sceneCsmCameraPosScratch.copy(snapshot.position);
  sceneCsmCameraQuatScratch.copy(snapshot.quaternion);

  if (sceneCsmForceNextUpdate) {
    sceneCsmForceNextUpdate = false;
    sceneCsmLastUpdateAtMs = snapshot.nowMs;
    sceneCsmLastCameraPos.copy(sceneCsmCameraPosScratch);
    sceneCsmLastCameraQuat.copy(sceneCsmCameraQuatScratch);
    return true;
  }

  const moveThresholdSq = SCENE_CSM_MOVE_THRESHOLD_M * SCENE_CSM_MOVE_THRESHOLD_M;
  const movedEnough = moveThresholdSq > 0
    && sceneCsmCameraPosScratch.distanceToSquared(sceneCsmLastCameraPos) >= moveThresholdSq;
  const rotatedEnough = (() => {
    if (SCENE_CSM_ROT_THRESHOLD_RAD <= 0) {
      return false;
    }
    const dot = Math.min(1, Math.abs(sceneCsmLastCameraQuat.dot(sceneCsmCameraQuatScratch)));
    const angle = 2 * Math.acos(dot);
    return Number.isFinite(angle) && angle >= SCENE_CSM_ROT_THRESHOLD_RAD;
  })();
  const shouldUpdateForMotion = movedEnough || rotatedEnough;

  if (shouldUpdateForMotion && snapshot.nowMs - sceneCsmLastUpdateAtMs < SCENE_CSM_MIN_INTERVAL_MS) {
    return false;
  }

  if (
    !shouldUpdateForMotion
    && SCENE_CSM_MAX_STALE_MS > 0
    && snapshot.nowMs - sceneCsmLastUpdateAtMs < SCENE_CSM_MAX_STALE_MS
  ) {
    return false;
  }

  sceneCsmLastUpdateAtMs = snapshot.nowMs;
  sceneCsmLastCameraPos.copy(sceneCsmCameraPosScratch);
  sceneCsmLastCameraQuat.copy(sceneCsmCameraQuatScratch);
  return true;
}

function shouldRunOverlaySync(snapshot: CameraFrameSnapshot | null): boolean {
  if (!snapshot) {
    return true;
  }
  overlaySyncCameraPosScratch.copy(snapshot.position);
  overlaySyncCameraQuatScratch.copy(snapshot.quaternion);

  if (overlaySyncForceNextUpdate) {
    overlaySyncForceNextUpdate = false;
    overlaySyncLastUpdateAtMs = snapshot.nowMs;
    overlaySyncLastCameraPos.copy(overlaySyncCameraPosScratch);
    overlaySyncLastCameraQuat.copy(overlaySyncCameraQuatScratch);
    return true;
  }

  const moveThresholdSq = OVERLAY_SYNC_MOVE_THRESHOLD_M * OVERLAY_SYNC_MOVE_THRESHOLD_M;
  const movedEnough = moveThresholdSq > 0
    && overlaySyncCameraPosScratch.distanceToSquared(overlaySyncLastCameraPos) >= moveThresholdSq;
  const rotatedEnough = (() => {
    if (OVERLAY_SYNC_ROT_THRESHOLD_RAD <= 0) {
      return false;
    }
    const dot = Math.min(1, Math.abs(overlaySyncLastCameraQuat.dot(overlaySyncCameraQuatScratch)));
    const angle = 2 * Math.acos(dot);
    return Number.isFinite(angle) && angle >= OVERLAY_SYNC_ROT_THRESHOLD_RAD;
  })();
  const shouldUpdateForMotion = movedEnough || rotatedEnough;

  if (shouldUpdateForMotion && snapshot.nowMs - overlaySyncLastUpdateAtMs < OVERLAY_SYNC_MIN_INTERVAL_MS) {
    return false;
  }

  if (
    !shouldUpdateForMotion
    && OVERLAY_SYNC_MAX_STALE_MS > 0
    && snapshot.nowMs - overlaySyncLastUpdateAtMs < OVERLAY_SYNC_MAX_STALE_MS
  ) {
    return false;
  }

  overlaySyncLastUpdateAtMs = snapshot.nowMs;
  overlaySyncLastCameraPos.copy(overlaySyncCameraPosScratch);
  overlaySyncLastCameraQuat.copy(overlaySyncCameraQuatScratch);
  return true;
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
const SCENERY_SIGNBOARD_BILLBOARD_STYLE: SignboardBillboardStyle = {
  backgroundTopColor: 'rgba(255, 255, 255, 0.88)',
  backgroundMiddleColor: 'rgba(244, 249, 255, 0.76)',
  backgroundBottomColor: 'rgba(232, 241, 249, 0.68)',
  borderColor: 'rgba(153, 193, 255, 0.22)',
  glowColor: 'rgba(122, 198, 255, 0.10)',
  sheenColor: 'rgba(255, 255, 255, 0.12)',
  labelColor: '#12314d',
  distanceColor: 'rgba(21, 50, 79, 0.68)',
  dividerColor: 'rgba(107, 152, 198, 0.16)',
  textShadowColor: 'rgba(255, 255, 255, 0.08)',
  shadowColor: 'rgba(52, 87, 128, 0.16)',
  shadowBlur: 5,
  shadowOffsetY: 1,
  punchBadgeBackgroundTopColor: 'rgba(255, 255, 255, 0.92)',
  punchBadgeBackgroundBottomColor: 'rgba(244, 249, 255, 0.82)',
  punchBadgeBorderColor: 'rgba(153, 193, 255, 0.24)',
  punchBadgeTextColor: '#28506f',
  punchBadgeShadowColor: 'rgba(83, 126, 173, 0.12)',
  distanceTextAccentColor: '#c88c12',
}
type PunchBadgeOverlayEntry = {
  id: string;
  xPercent: number;
  yPercent: number;
  scale: number;
  opacity: number;
  referenceKind: 'camera' | 'vehicle';
};
const punchBadgeOverlayEntries = ref<PunchBadgeOverlayEntry[]>([]);
const nextPunchBadgeEntriesScratch: PunchBadgeOverlayEntry[] = [];
const activePunchBadgeNodeIdsScratch = new Set<string>();
const punchedNodeIds = ref<Set<string>>(new Set());
const punchTotalCount = ref(0);
const punchSceneRevision = ref(0);
const punchBadgePlacementSmoothingStates = new Map<string, SignboardPlacementSmoothingState>();
const signboardReferenceScratch = new THREE.Vector3();
const signboardAnchorScratch = new THREE.Vector3();
const purposeAnchorScratch = new THREE.Vector3();
const overlayDistanceReferenceScratch = new THREE.Vector3();
const overlayDistanceTargetAnchorScratch = new THREE.Vector3();
const overlayDistanceReferenceAnchorScratch = new THREE.Vector3();
const behaviorBubbleAnchorScratch = new THREE.Vector3();
const behaviorBubbleCameraScratch = new THREE.Vector3();
const OVERLAY_HORIZONTAL_DISTANCE_Y_EPSILON = 1.5;
const browserStoredPunchedNodeIds = ref<string[]>([]);
const previewFrameCameraWorldPosition = { x: 0, y: 0, z: 0 };

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
  markOverlayRuntimeDirty();
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
  markOverlayRuntimeDirty();
}

function arePunchBadgeEntriesEqual(nextEntries: PunchBadgeOverlayEntry[], currentEntries: PunchBadgeOverlayEntry[]): boolean {
  if (nextEntries.length !== currentEntries.length) {
    return false;
  }
  for (let index = 0; index < nextEntries.length; index += 1) {
    const nextEntry = nextEntries[index];
    const currentEntry = currentEntries[index];
    if (
      nextEntry.id !== currentEntry.id
      || nextEntry.referenceKind !== currentEntry.referenceKind
      || Math.abs(nextEntry.xPercent - currentEntry.xPercent) > 1e-4
      || Math.abs(nextEntry.yPercent - currentEntry.yPercent) > 1e-4
      || Math.abs(nextEntry.scale - currentEntry.scale) > 1e-4
      || Math.abs(nextEntry.opacity - currentEntry.opacity) > 1e-4
    ) {
      return false;
    }
  }
  return true;
}

let physicsBridge: PhysicsBridge | null = null;
let physicsBridgeInitPromise: Promise<PhysicsBridge> | null = null;
let physicsBridgeStepPromise: Promise<void> | null = null;
let physicsBridgeBodySyncPromise: Promise<void> | null = null;
const physicsBridgeVehicleInputSyncState = createPhysicsBridgeVehicleInputSyncState();
let physicsBridgeSceneLoaded = false;
let physicsBridgeSceneReloading = false;
let physicsBridgeSceneRequestId = 0;
let currentPhysicsBridgePreference: PhysicsBackendPreference | undefined;
let sceneryGroundCollisionBridgeMutationChain: Promise<void> = Promise.resolve();
let sceneryGroundCollisionBridgeMutationEpoch = 0;
let sceneryGroundCollisionNextRuntimeId = 0x71000000;
const sceneryGroundCollisionRuntimeBodyIds = new Set<number>();
const sceneryGroundCollisionReferencePositions: THREE.Vector3[] = [];
const lastSceneryGroundCollisionReferencePositions: THREE.Vector3[] = [];
let sceneryGroundCollisionReferenceInitialized = false;
let sceneryGroundCollisionReferenceElapsed = 0;
const physicsBridgeBodyIdByNodeId = new Map<string, number>();
const physicsBridgeNodeIdByBodyId = new Map<number, string>();
const physicsBridgeVehicleIdByNodeId = new Map<string, number>();
const physicsBridgeCharacterIdByNodeId = new Map<string, number>();
const physicsBridgeCharacterBodyNodeIdByControllerNodeId = new Map<string, string>();
const physicsBridgeCharacterControllerNodeIdByBodyNodeId = new Map<string, string>();
function nextSceneryGroundCollisionRuntimeId(): number {
  sceneryGroundCollisionNextRuntimeId += 1;
  return sceneryGroundCollisionNextRuntimeId;
}
type PhysicsBridgeBodyFrameState = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  motionState: number;
  linearVelocity?: THREE.Vector3;
};
type ViewerRigidbodyInstance = RigidbodyInstance & {
  bridgeSyncDirty?: boolean;
};
const physicsBridgeFrameBodiesByNodeId = new Map<string, PhysicsBridgeBodyFrameState>();
const physicsBridgeSyncPositionHelper = new THREE.Vector3();
const physicsBridgeSyncQuaternionHelper = new THREE.Quaternion();
const physicsBridgeSyncParentQuaternionHelper = new THREE.Quaternion();
const physicsBridgeHeightfieldAdjustment = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const physicsBridgeHeightfieldAdjustmentInverse = physicsBridgeHeightfieldAdjustment.clone().invert();
let physicsBridgeFrameUpdatedParents = new WeakSet<THREE.Object3D>();
const physicsBridgeBodySyncPositionHelper = new THREE.Vector3();
const physicsBridgeBodySyncQuaternionHelper = new THREE.Quaternion();
const physicsEnvironmentEnabled = ref(true);

const rigidbodyInstances = new Map<string, ViewerRigidbodyInstance>();
const physicsBridgeDirtyBodyNodeIds = new Set<string>();
const physicsBridgeBodyDirtyRevisionByNodeId = new Map<string, number>();
const physicsBridgePendingBodySyncRevisionByNodeId = new Map<string, number>();
const PHYSICS_BRIDGE_FULL_BODY_SYNC_INTERVAL_MS = 250;
let physicsBridgeLastFullBodySyncAtMs = 0;

const vehicleInstances = new Map<string, VehicleInstanceWithWheels>();
type RemoteMultiuserWheelBinding = {
  nodeId: string | null;
  object: THREE.Object3D | null;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  baseScale: THREE.Vector3;
  instancedTargets: THREE.Object3D[];
};
type RemoteMultiuserAnimationController = {
  nodeId: string;
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  defaultClip: THREE.AnimationClip | null;
  activeAction: THREE.AnimationAction | null;
  activeClipName: string | null;
  activeLoop: boolean;
  activeTimeScale: number;
};
type RemoteMultiuserPeerEntry = RemoteMultiuserPeerVisibilityState & {
  root: THREE.Object3D | null;
  signature: string;
  displayName: string;
  targetState: MultiuserPeerState;
  displayState: MultiuserPeerState | null;
  ownsResources: boolean;
  nicknameRuntime: RemoteMultiuserNicknameRuntimeEntry | null;
  wheelNodeIds: string[];
  wheelBindings: RemoteMultiuserWheelBinding[];
  animationControllers: Map<string, RemoteMultiuserAnimationController>;
  rootSignature: string;
  loadToken: number;
};
type NetworkSyncNodeRuntimeEntry = {
  nodeId: string;
  props: NetworkSyncComponentProps;
  localRevision: number;
  lastLocalSignature: string;
  ownerUserId: string | null;
  updatedAt: string;
};
type RemoteSharedEntityEntry = {
  entityId: string;
  nodeId: string;
  props: NetworkSyncComponentProps;
  targetState: MultiuserNodeSyncState;
  displayState: MultiuserNodeSyncState | null;
  presentation: MultiuserNodeSyncPresentation | null;
};
type RemoteMultiuserCharacterState = {
  userId: string;
  nodeId: string;
  action: string | null;
  animation: MultiuserCharacterAnimationPresentation | null;
};
type RemoteMultiuserNicknameRuntimeEntry = {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  canvas: HarmonyCanvas;
  context: HarmonyCanvas2DContext;
  displayName: string;
  worldWidth: number;
  worldHeight: number;
};
const remoteMultiuserPeerEntries = new Map<string, RemoteMultiuserPeerEntry>();
const remoteMultiuserPeerLoadTokens = new Map<string, number>();
const remoteMultiuserPeerRoot = new THREE.Group();
remoteMultiuserPeerRoot.name = 'RemoteMultiuserPeers';
const networkSyncNodeEntries = new Map<string, NetworkSyncNodeRuntimeEntry>();
const characterControllerAnimationRuntime = new CharacterControllerAnimationRuntimeManager();
const characterAutoTourRuntime = new CharacterAutoTourRuntimeManager();
const controlledNodeMotionRuntime = createControlledNodeMotionRuntime();
const physicsBridgeContactsByNodeId = new Map<string, PhysicsContactEvent[]>();
const remoteSharedEntityEntries = new Map<string, RemoteSharedEntityEntry>();
const remoteMultiuserCharacterStatesByNodeId = new Map<string, RemoteMultiuserCharacterState>();
const remoteMultiuserCharacterNodeIdByUserId = new Map<string, string>();
const localMultiuserVehiclePresentationByNodeId = new Map<string, MultiuserVehiclePresentation>();
const localMultiuserCharacterPresentationByNodeId = new Map<string, MultiuserCharacterAnimationPresentation>();
const REMOTE_MULTIUSER_SMOOTHING_SECONDS = 0.16;
const remoteMultiuserDisplayPositionScratch = new THREE.Vector3();
const remoteMultiuserTargetPositionScratch = new THREE.Vector3();
const remoteMultiuserDisplayQuaternionScratch = new THREE.Quaternion();
const remoteMultiuserTargetQuaternionScratch = new THREE.Quaternion();
const remoteMultiuserCameraPositionScratch = new THREE.Vector3();
const remoteMultiuserWheelPositionScratch = new THREE.Vector3();
const remoteMultiuserWheelTargetPositionScratch = new THREE.Vector3();
const remoteMultiuserWheelScaleScratch = new THREE.Vector3();
const remoteMultiuserWheelQuaternionScratch = new THREE.Quaternion();
const remoteMultiuserWheelTargetQuaternionScratch = new THREE.Quaternion();
const remoteMultiuserWheelSteeringAxisScratch = new THREE.Vector3();
const remoteMultiuserWheelSpinAxisScratch = new THREE.Vector3();
const remoteMultiuserWheelCurrentPositionScratch = new THREE.Vector3();
const remoteMultiuserWheelCurrentQuaternionScratch = new THREE.Quaternion();
const remoteMultiuserWheelCurrentScaleScratch = new THREE.Vector3();
const remoteSharedEntityDisplayScaleScratch = new THREE.Vector3();
const remoteSharedEntityTargetScaleScratch = new THREE.Vector3();
const remoteMultiuserNicknameBoundsScratch = new THREE.Box3();
const remoteMultiuserNicknameCenterScratch = new THREE.Vector3();
const physicsGravity = createHostPhysicsVec3(0, -DEFAULT_ENVIRONMENT_GRAVITY, 0);
// On WeChat iOS, 30 Hz physics is sufficient for 1–2 dynamic bodies and halves step cost.
const PHYSICS_FIXED_TIMESTEP = isWeChatMiniProgram ? 1 / 30 : 1 / 60;
// Fewer substeps needed at 30 Hz; each covers more sim time.
const PHYSICS_MAX_SUB_STEPS = isWeChatMiniProgram ? 4 : 5;
const CAMERA_DEPENDENT_POSITION_EPSILON = 0.02;
const CAMERA_DEPENDENT_POSITION_EPSILON_SQ = CAMERA_DEPENDENT_POSITION_EPSILON * CAMERA_DEPENDENT_POSITION_EPSILON;
const CAMERA_DEPENDENT_UPDATE_INTERVAL_SECONDS = 0.12;
const REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR = 2;
const REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_X = 34;
const REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_Y = 20;
const REMOTE_MULTIUSER_NICKNAME_CARD_GAP = 28;
const REMOTE_MULTIUSER_NICKNAME_CARD_MIN_WIDTH = 320;
const REMOTE_MULTIUSER_NICKNAME_CARD_MAX_WIDTH = 760;
const REMOTE_MULTIUSER_NICKNAME_LABEL_FONT_MAX = 66;
const REMOTE_MULTIUSER_NICKNAME_LABEL_FONT_MIN = 44;
const REMOTE_MULTIUSER_NICKNAME_WORLD_HEIGHT = 0.94;
const REMOTE_MULTIUSER_NICKNAME_WORLD_Y_OFFSET = 0.58;
const REMOTE_MULTIUSER_NICKNAME_DEFAULT_LOCAL_Y = 1.58;
const REMOTE_MULTIUSER_NICKNAME_BG_TOP = 'rgba(255, 255, 255, 0.18)';
const REMOTE_MULTIUSER_NICKNAME_BG_MIDDLE = 'rgba(230, 240, 255, 0.10)';
const REMOTE_MULTIUSER_NICKNAME_BG_BOTTOM = 'rgba(210, 222, 242, 0.05)';
const REMOTE_MULTIUSER_NICKNAME_BORDER = 'rgba(255, 255, 255, 0.28)';
const REMOTE_MULTIUSER_NICKNAME_TEXT = '#ffffff';
const REMOTE_MULTIUSER_NICKNAME_GLOW = 'rgba(255, 255, 255, 0.12)';
const REMOTE_MULTIUSER_NICKNAME_MAX_CHARS = 6;
type PhysicsInterpolationState = {
  prevPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currPos: THREE.Vector3;
  currQuat: THREE.Quaternion;
  hasSample: boolean;
};

type PhysicsBodyVectorLike = {
  x: number;
  y: number;
  z: number;
  set: (x: number, y: number, z: number) => unknown;
};

type PhysicsBodyQuaternionLike = {
  x: number;
  y: number;
  z: number;
  w: number;
};

type PhysicsBodyLike = {
  position: PhysicsBodyVectorLike;
  velocity: PhysicsBodyVectorLike;
  angularVelocity: PhysicsBodyVectorLike;
  quaternion: PhysicsBodyQuaternionLike;
  allowSleep?: boolean;
  sleepSpeedLimit?: number;
  sleepTimeLimit?: number;
  sleep?: () => void;
  sleepState?: number;
};

const physicsInterpolationStates = new WeakMap<PhysicsBodyLike, PhysicsInterpolationState>();
let physicsInterpolationEnabled = false;
let physicsInterpolationAlpha = 0;

function trySleepBody(body: PhysicsBodyLike | null | undefined): void {
  if (!body) {
    return;
  }
  body.sleep?.();
}

function resetPhysicsInterpolationState(body: PhysicsBodyLike | null | undefined): void {
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
    object.parent.updateWorldMatrix(true, false);
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
  object.updateWorldMatrix(false, true);
}

const wheelForwardHelper = new THREE.Vector3();
const wheelAxisHelper = new THREE.Vector3();
const wheelQuaternionHelper = new THREE.Quaternion();
const wheelVisualQuaternionHelper = new THREE.Quaternion();
const wheelParentWorldQuaternionHelper = new THREE.Quaternion();
const wheelParentWorldQuaternionInverseHelper = new THREE.Quaternion();
const wheelSteeringQuaternionHelper = new THREE.Quaternion();
const wheelSpinQuaternionHelper = new THREE.Quaternion();
const wheelChassisPositionHelper = new THREE.Vector3();
const wheelChassisDisplacementHelper = new THREE.Vector3();
const defaultWheelAxisVector = new THREE.Vector3(DEFAULT_AXLE.x, DEFAULT_AXLE.y, DEFAULT_AXLE.z).normalize();
const VEHICLE_WHEEL_MIN_RADIUS = 0.01;
const VEHICLE_WHEEL_SPIN_EPSILON = 1e-4;
const VEHICLE_TRAVEL_EPSILON = 1e-5;
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
const tempQuaternionVec = new THREE.Quaternion();
const cameraWatchLookMatrixScratch = new THREE.Matrix4();
const tempYawForwardVec = new THREE.Vector3();
const protagonistPosePosition = new THREE.Vector3();
const protagonistPoseQuaternion = new THREE.Quaternion();
const characterCameraFollowAnchorScratch = new THREE.Vector3();
const characterCameraFollowForwardScratch = new THREE.Vector3();
const characterCameraFollowOffsetScratch = new THREE.Vector3();
const characterControlYawForwardScratch = new THREE.Vector3();
const vehicleCompassQuaternion = new THREE.Quaternion();
const STEERING_KEYBOARD_RETURN_SPEED = 7;
const STEERING_KEYBOARD_CATCH_SPEED = 18;
const cameraRotationAnchor = new THREE.Vector3();
let suppressSelfYawRecenter = false;
let characterCameraFollowNodeId: string | null = null;
let characterInputYaw = Math.PI;
let characterInputYawInitialized = false;
let characterInputYawNodeId: string | null = null;
const characterCameraFollowPlacementCache = {
  nodeId: null as string | null,
  objectUuid: null as string | null,
  placement: null as CameraFollowPlacement | null,
};
let characterControlDeltaSeconds = 1 / 60;
const characterCameraFollowMotionState: FollowCameraMotionState = createFollowCameraMotionState();
const JOYSTICK_INPUT_RADIUS = 64;
const JOYSTICK_VISUAL_RANGE = 44;
const JOYSTICK_DEADZONE = 0.25;
const CHARACTER_JOYSTICK_TURN_DEADZONE = 0.38;
const CHARACTER_EFFECTIVE_MOVEMENT_THRESHOLD = 0.05;

type VehicleWheelBinding = {
  nodeId: string | null;
  object: THREE.Object3D | null;
  instancedTargets: THREE.Object3D[];
  radius: number;
  axleAxis: THREE.Vector3;
  steeringAxis: THREE.Vector3;
  spinAxis: THREE.Vector3;
  isFrontWheel: boolean;
  wheelIndex: number;
  spinAngle: number;
  lastSteeringAngle: number;
  baseQuaternion: THREE.Quaternion;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
};

type VehicleInstanceWithWheels = VehicleInstance & {
  source: 'bridge';
  vehicle: VehicleDriveVehicle;
  wheelBindings: VehicleWheelBinding[];
  forwardAxis: THREE.Vector3;
  lastChassisPosition: THREE.Vector3;
  hasChassisPositionSample: boolean;
  bridgeBodyId?: number | null;
  vehicleId?: number | null;
  hasBridgeFrameSample?: boolean;
};

type HostPhysicsVec3 = VehicleDriveVehicle['chassisBody']['position'];
type PhysicsBridgeVehicleControlInput = {
  steering: number;
  throttle: number;
  brake: number;
};

function createHostPhysicsVec3(x = 0, y = 0, z = 0): HostPhysicsVec3 {
  return {
    x,
    y,
    z,
    set(nextX: number, nextY: number, nextZ: number) {
      this.x = nextX;
      this.y = nextY;
      this.z = nextZ;
      return this;
    },
    lengthSquared() {
      return this.x * this.x + this.y * this.y + this.z * this.z;
    },
  };
}

const LEGACY_STATIC_BODY_TYPE = 2;

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

const infoBoardOverlayVisible = ref(false);
const infoBoardOverlayLoading = ref(false);
const infoBoardOverlayNodeId = ref<string | null>(null);
const infoBoardOverlayTitle = ref('展示板');
const infoBoardOverlayContent = ref('');
const infoBoardExpanded = ref(false);
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
  const panelWidth = Math.round(Math.min(viewportWidth - 24, infoBoardExpanded.value ? 420 : 220));
  const panelHeight = Math.round(Math.min(viewportHeight * 0.36, infoBoardExpanded.value ? 220 : 72));
  return infoBoardExpanded.value
    ? {
        width: `${panelWidth}px`,
        height: `${panelHeight}px`,
        maxWidth: `${panelWidth}px`,
        maxHeight: `${panelHeight}px`,
      }
    : {
        width: `${panelWidth}px`,
        minHeight: '64px',
        maxWidth: `${panelWidth}px`,
      };
});

const infoBoardBodyStyle = computed(() => {
  // When expanded, let CSS flexing make the body fill the panel space.
  if (infoBoardExpanded.value) {
    return {
      height: '100%',
      maxHeight: '100%',
    };
  }
  const viewportHeight = lanternViewportSize.height || 667;
  const bodyHeight = Math.max(Math.round(Math.min(viewportHeight * 0.32, 160)) - 60, 80);
  return {
    height: `${bodyHeight}px`,
    maxHeight: `${bodyHeight}px`,
  };
});

const infoBoardOverlayStyle = computed(() => ({
  left: '12px',
  top: `${punchSummaryTopOffset.value + 58}px`,
  opacity: '1',
}));

function expandInfoBoard(): void {
  if (!infoBoardOverlayVisible.value) {
    return;
  }
  if (infoBoardExpanded.value) {
    return;
  }
  infoBoardExpanded.value = true;
}

function collapseInfoBoard(): void {
  if (!infoBoardExpanded.value) {
    return;
  }
  infoBoardExpanded.value = false;
}

function toggleInfoBoardExpanded(): void {
  if (infoBoardExpanded.value) {
    collapseInfoBoard();
    return;
  }
  expandInfoBoard();
}

function handleInfoBoardTap(): void {
  // When the info board is expanded, tapping the panel should collapse it
  if (infoBoardExpanded.value) {
    collapseInfoBoard();
  }
}

const lanternAssets = useLanternAssets({
  loadTextAssetContent: (assetId) => loadTextAssetContent(assetId),
  resolveAssetUrlFromCache: (assetId) => resolveAssetUrlFromCache(assetId),
});
const lanternImageState = lanternAssets.lanternImageState;
const ensureLanternText = lanternAssets.ensureLanternText;
const ensureLanternImage = lanternAssets.ensureLanternImage;
const pruneLanternAssets = lanternAssets.pruneActiveAssets;

type PurposeControlRecord = {
  nodeId: string;
  buttons: ShowPurposeBehaviorButton[];
  placement: PurposeOverlayPlacement;
};

const purposeControlEntries = ref<PurposeControlRecord[]>([]);
const purposeControlsVisible = computed(() => purposeControlEntries.value.length > 0);
const purposeActiveMode = ref<'watch' | 'level'>('level');
const activeWatchRestoreSnapshot = ref<SceneViewControlSnapshot | null>(null);
const activeWatchSource = ref<'viewPoint' | 'target-look' | null>(null);
type WatchUiRestoreState = {
  purposeControlsVisible: boolean;
};
const watchUiRestoreState = ref<WatchUiRestoreState | null>(null);

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
let vehicleDriveVehicle: VehicleDriveVehicle | null = null;
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
type VehicleDriveIntroPhase = 'idle' | 'hold' | 'blend';
const vehicleDriveIntroState = reactive({
  active: false,
  nodeId: null as string | null,
  phase: 'idle' as VehicleDriveIntroPhase,
  elapsedSeconds: 0,
  holdSeconds: VEHICLE_DRIVE_INTRO_HOLD_SECONDS,
  blendSeconds: VEHICLE_DRIVE_INTRO_BLEND_SECONDS,
  startPosition: new THREE.Vector3(),
  startTarget: new THREE.Vector3(),
  startUp: new THREE.Vector3(0, 1, 0),
});
const vehicleDriveIntroVisible = computed(() => (
  vehicleDriveIntroState.active
  && vehicleDriveIntroState.phase === 'hold'
  && vehicleDriveIntroState.elapsedSeconds < vehicleDriveIntroState.holdSeconds
));
const lanternJoystickRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const floatingJoystickRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const characterFloatingJoystickRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
const characterActionsBarRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
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
const characterJoystickVector = reactive({ x: 0, y: 0 });
const characterJoystickOffset = reactive({ x: 0, y: 0 });
const characterJoystickState = reactive({
  active: false,
  pointerId: -1,
  centerX: 0,
  centerY: 0,
  ready: false,
});
const characterDrivePadState = reactive({ visible: false, fading: false, x: 0, y: 0 });
const characterDrivePadStyle = computed(() => ({
  left: `${characterDrivePadState.x}px`,
  top: `${characterDrivePadState.y}px`,
}));
let characterDrivePadFadeTimer: ReturnType<typeof setTimeout> | null = null;
let characterDrivePadMouseTracking = false;
const characterDrivePadViewportRect = { top: 0, left: 0, height: getViewportHeight() };
const steeringKeyboardValue = ref(0);
const steeringKeyboardTarget = ref(0);
const joystickKnobStyle = computed(() => {
  const scale = joystickState.active ? 0.88 : 1;
  return {
    transform: `translate(calc(-50% + ${joystickOffset.x}px), calc(-50% + ${joystickOffset.y}px)) scale(${scale})`,
  };
});
const characterJoystickKnobStyle = computed(() => {
  const scale = characterJoystickState.active ? 0.88 : 1;
  return {
    transform: `translate(calc(-50% + ${characterJoystickOffset.x}px), calc(-50% + ${characterJoystickOffset.y}px)) scale(${scale})`,
  };
});
const vehicleDriveResetBusy = ref(false);

type CameraViewMode = 'level' | 'watching';
const cameraViewState = reactive<{ mode: CameraViewMode; targetNodeId: string | null }>({
  mode: 'level',
  targetNodeId: null,
});
const watchLeaveVisible = computed(() =>
  cameraViewState.mode === 'watching' && activeWatchRestoreSnapshot.value !== null,
);
const watchExclusiveUiActive = computed(() => watchLeaveVisible.value);
const watchSnapshotBusy = ref(false);

const vehicleDriveCameraRestoreState: VehicleDriveCameraRestoreState = {
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

const VEHICLE_SPEED_DISPLAY_UPDATE_INTERVAL_MS = 150;
const VEHICLE_SPEED_DISPLAY_ZERO_DELAY_MS = 250;

const vehicleSpeedDisplayMps = ref(0);
const vehicleSpeedKmh = computed(() => Math.round(vehicleSpeedDisplayMps.value * 3.6));
let vehicleSpeedDisplayLastCommitAtMs = 0;
let vehicleSpeedDisplayLowSpeedSinceAtMs: number | null = null;
const vehicleSpeedDisplayScratchPosition = new THREE.Vector3();
const vehicleSpeedDisplayScratchDelta = new THREE.Vector3();
const controlledNodeMotionForwardScratch = new THREE.Vector3();
const autoTourTelemetryLastWorldPosition = new THREE.Vector3();
let autoTourTelemetryHasWorldPositionSample = false;
let autoTourTelemetryLastSampleAtMs = 0;
let autoTourTelemetryLastNodeId: string | null = null;
const VEHICLE_HEADING_UPDATE_EPSILON_DEGREES = 0.25;
const CHARACTER_ACTION_AUTOMATED_SLOTS = new Set<CharacterAnimationSlot>(['idle', 'walk', 'run']);
const CHARACTER_ACTION_HOLD_SLOTS = new Set<CharacterAnimationSlot>(['sprint', 'crouch', 'interact']);
const CHARACTER_ACTION_BUTTON_SLOTS = CHARACTER_ANIMATION_EDITOR_SLOTS
  .map(({ value }) => value)
  .filter((slot): slot is CharacterAnimationSlot => !CHARACTER_ACTION_AUTOMATED_SLOTS.has(slot as CharacterAnimationSlot));
const CHARACTER_ACTION_BUTTON_META: Record<CharacterAnimationSlot, {
  shortLabel: string;
  label: string;
  icon: string;
  emphasis?: 'danger';
}> = {
  idle: { shortLabel: '待', label: '待机动作', icon: 'I' },
  walk: { shortLabel: '走', label: '行走动作', icon: 'W' },
  run: { shortLabel: '跑', label: '奔跑动作', icon: 'R' },
  sprint: { shortLabel: '冲', label: '冲刺动作', icon: 'S' },
  turn: { shortLabel: '转', label: '转身动作', icon: 'T' },
  jump: { shortLabel: '跳', label: '跳跃动作', icon: 'J' },
  fall: { shortLabel: '落', label: '下落动作', icon: 'F' },
  strafe: { shortLabel: '移', label: '横移动作', icon: 'L' },
  crouch: { shortLabel: '蹲', label: '下蹲动作', icon: 'C' },
  interact: { shortLabel: '互', label: '交互动作', icon: 'E' },
  death: { shortLabel: '终', label: '死亡动作', icon: 'X', emphasis: 'danger' },
};
type CharacterActionButtonMode = 'tap' | 'hold' | 'animation';
type CharacterActionButtonEntry = {
  slot: CharacterAnimationSlot;
  clipName: string;
  shortLabel: string;
  label: string;
  icon: string;
  emphasis?: 'danger';
  mode: CharacterActionButtonMode;
  pressed: boolean;
};

const characterAuthorityInput = reactive({
  moveX: 0,
  moveZ: 0,
  turn: 0,
  jump: false,
  sprint: false,
  crouch: false,
  interact: false,
});
const characterKeyState = reactive({
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  crouch: false,
  interact: false,
});
let characterInputJumpLatch = false;
const moveToRuntimeSession = createMoveToRuntimeSession();
let characterActionJumpReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let activeCharacterActionAnimationTimer: ReturnType<typeof setTimeout> | null = null;
let activeCharacterActionAnimationToken: string | null = null;
let activeCharacterActionAnimationNodeId: string | null = null;
const activeCharacterActionAnimationSlot = ref<CharacterAnimationSlot | null>(null);
function getVehicleSpeedDisplayNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function getCharacterAnimationNowMs(): number {
  return getVehicleSpeedDisplayNowMs();
}

function sampleControlledNodeMotionFromObject(
  nodeId: string,
  object: THREE.Object3D,
  deltaSeconds: number,
  nowMs: number,
  forwardAxis?: THREE.Vector3 | null,
  fallbackLinearVelocity?: { x: number; y: number; z: number } | null,
  fallbackAngularVelocity?: { x: number; y: number; z: number } | null,
): void {
  object.updateMatrixWorld(true);
  object.getWorldPosition(vehicleSpeedDisplayScratchPosition);
  object.getWorldQuaternion(vehicleCompassQuaternion);
  controlledNodeMotionRuntime.recordSample(nodeId, {
    position: vehicleSpeedDisplayScratchPosition,
    quaternion: vehicleCompassQuaternion,
    deltaSeconds,
    nowMs,
    forwardAxis,
    fallbackLinearVelocity,
    fallbackAngularVelocity,
  });
}

function resolveControlledCharacterMotionForwardAxis(target = controlledNodeMotionForwardScratch): THREE.Vector3 {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  const props = clampCharacterControllerComponentProps(
    resolveCharacterControllerComponent(resolveNodeById(controlledNodeId ?? ''))?.props ?? null,
  );
  return writeCharacterLocalForward(target, props.forwardAxis) as THREE.Vector3;
}

function sampleControlledCharacterMotionFromObject(
  nodeId: string,
  object: THREE.Object3D,
  deltaSeconds: number,
  nowMs: number,
  fallbackLinearVelocity?: { x: number; y: number; z: number } | null,
  fallbackAngularVelocity?: { x: number; y: number; z: number } | null,
): void {
  sampleControlledNodeMotionFromObject(
    nodeId,
    object,
    deltaSeconds,
    nowMs,
    resolveControlledCharacterMotionForwardAxis(),
    fallbackLinearVelocity,
    fallbackAngularVelocity,
  );
}

function commitVehicleSpeedDisplay(speedMps: number, nowMs: number): void {
  const clampedSpeedMps = Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 0;
  const hasCommittedOnce = vehicleSpeedDisplayLastCommitAtMs > 0;
  const isLeavingZero = clampedSpeedMps >= VEHICLE_PARKED_SPEED_EPSILON && vehicleSpeedDisplayMps.value === 0;
  const canCommit =
    !hasCommittedOnce ||
    isLeavingZero ||
    nowMs - vehicleSpeedDisplayLastCommitAtMs >= VEHICLE_SPEED_DISPLAY_UPDATE_INTERVAL_MS;

  if (clampedSpeedMps >= VEHICLE_PARKED_SPEED_EPSILON) {
    vehicleSpeedDisplayLowSpeedSinceAtMs = null;
    if (canCommit) {
      vehicleSpeedDisplayMps.value = clampedSpeedMps;
      vehicleSpeedDisplayLastCommitAtMs = nowMs;
    }
    return;
  }

  if (vehicleSpeedDisplayMps.value === 0) {
    vehicleSpeedDisplayLowSpeedSinceAtMs = null;
    return;
  }

  if (vehicleSpeedDisplayLowSpeedSinceAtMs === null) {
    vehicleSpeedDisplayLowSpeedSinceAtMs = nowMs;
  }

  if (canCommit && nowMs - vehicleSpeedDisplayLowSpeedSinceAtMs >= VEHICLE_SPEED_DISPLAY_ZERO_DELAY_MS) {
    vehicleSpeedDisplayMps.value = 0;
    vehicleSpeedDisplayLastCommitAtMs = nowMs;
    vehicleSpeedDisplayLowSpeedSinceAtMs = null;
  }
}

const vehicleHeadingDegrees = ref(0);

function normalizeHeadingDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return ((value % 360) + 360) % 360;
}

function isHeadingCloseDegrees(current: number, next: number, epsilon = VEHICLE_HEADING_UPDATE_EPSILON_DEGREES): boolean {
  const normalizedCurrent = normalizeHeadingDegrees(current);
  const normalizedNext = normalizeHeadingDegrees(next);
  const delta = Math.abs(normalizedCurrent - normalizedNext);
  return Math.min(delta, 360 - delta) <= epsilon;
}

function commitVehicleHeadingDegrees(nextHeading: number): void {
  const normalizedHeading = normalizeHeadingDegrees(nextHeading);
  if (isHeadingCloseDegrees(vehicleHeadingDegrees.value, normalizedHeading)) {
    return;
  }
  vehicleHeadingDegrees.value = normalizedHeading;
}
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
const vehicleDriveStateBridge: VehicleDriveRuntimeState = {
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
  set vehicle(value: VehicleDriveVehicle | null) {
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
    accelerating: active && vehicleDriveInput.throttle > 0.05,
    braking: active && vehicleDriveInputFlags.brake,
  } as const;
});

const autoTourTelemetryUiVisible = computed(() => vehicleDriveUi.value.visible || activeAutoTourNodeIds.size > 0);

const characterControlUi = computed(() => {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  const visible = !vehicleDriveUi.value.visible && Boolean(controlledNodeId);
  if (!visible) {
    return {
      visible: false,
      label: '',
      joystickActive: false,
    } as const;
  }
  const node = controlledNodeId ? resolveNodeById(controlledNodeId) : null;
  return {
    visible: true,
    label: node?.name?.trim() || controlledNodeId || 'Character',
    joystickActive: characterJoystickState.active,
  } as const;
});
const characterActionButtons = computed<CharacterActionButtonEntry[]>(() => {
  if (!characterControlUi.value.visible) {
    return [];
  }
  const props = resolveDefaultControlledCharacterComponentProps();
  if (!props) {
    return [];
  }
  const bindingMap = new Map(
    props.animationBindings.map((binding) => [binding.slot, binding.clipName] as const),
  );
  return CHARACTER_ACTION_BUTTON_SLOTS.flatMap((slot) => {
    const clipName = bindingMap.get(slot);
    if (!clipName) {
      return [];
    }
    const meta = CHARACTER_ACTION_BUTTON_META[slot];
    const mode: CharacterActionButtonMode = slot === 'jump'
      ? 'tap'
      : CHARACTER_ACTION_HOLD_SLOTS.has(slot)
        ? 'hold'
        : 'animation';
    const pressed = mode === 'hold'
      ? (slot === 'sprint'
        ? characterKeyState.sprint
        : slot === 'crouch'
          ? characterKeyState.crouch
          : characterKeyState.interact)
      : activeCharacterActionAnimationSlot.value === slot;
    return [{
      slot,
      clipName,
      shortLabel: meta.shortLabel,
      label: meta.label,
      icon: meta.icon,
      emphasis: meta.emphasis,
      mode,
      pressed,
    }];
  });
});

const pendingVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
const pendingVehicleDriveRetryRequested = ref(false);
const pendingDefaultSteerDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
const vehicleDriveIntroPendingState = reactive({
  active: false,
  nodeId: null as string | null,
  requestedAtMs: 0,
  timeoutMs: VEHICLE_DRIVE_INTRO_READY_TIMEOUT_MS,
});
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
const characterCameraFollowState = createCameraFollowState();
const characterCameraFollowController = new FollowCameraController();
const autoTourCameraFollowLastAnchor = new THREE.Vector3();
const autoTourCameraFollowVelocity = new THREE.Vector3();
const autoTourCameraFollowVelocityScratch = new THREE.Vector3();
const autoTourCameraFollowAnchorScratch = new THREE.Vector3();
const autoTourCameraFollowForwardScratch = new THREE.Vector3();
const autoTourCameraFollowOffsetScratch = new THREE.Vector3();
const autoTourCameraFollowQuaternionScratch = new THREE.Quaternion();
const autoTourCameraFollowBox = new THREE.Box3();
const AUTO_TOUR_RESUME_BLEND_SECONDS = 0.28;
const autoTourPausedCameraPosition = new THREE.Vector3();
const autoTourPausedCameraTarget = new THREE.Vector3();
let autoTourPausedCameraSnapshotValid = false;
const autoTourPausedCameraNodeId = ref<string | null>(null);
const autoTourResumeBlendState = createCameraFollowState();
const autoTourResumeBlendStartPosition = new THREE.Vector3();
const autoTourResumeBlendStartTarget = new THREE.Vector3();
const autoTourResumeBlendTempCamera = new THREE.PerspectiveCamera();
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

function resolveAutoTourVehicleForwardWorld(
  nodeId: string,
  object: THREE.Object3D,
  target: THREE.Vector3,
): boolean {
  const instance = vehicleInstances.get(nodeId) ?? null;
  const axisForward = instance?.axisForward ?? null;
  if (!axisForward || axisForward.lengthSq() < 1e-8) {
    return false;
  }

  const chassisQuaternion = physicsEnvironmentEnabled.value
    ? instance?.vehicle?.chassisBody?.quaternion ?? null
    : null;
  if (chassisQuaternion) {
    autoTourCameraFollowQuaternionScratch
      .set(chassisQuaternion.x, chassisQuaternion.y, chassisQuaternion.z, chassisQuaternion.w)
      .normalize();
  } else {
    object.getWorldQuaternion(autoTourCameraFollowQuaternionScratch).normalize();
  }

  target.copy(axisForward).applyQuaternion(autoTourCameraFollowQuaternionScratch);
  target.y = 0;
  if (target.lengthSq() < 1e-8) {
    return false;
  }
  target.normalize();
  return true;
}

function prepareAutoTourResumeBlendContext(
  targetNodeId: string,
  object: THREE.Object3D,
  context: RenderContext,
): CameraFollowPlacement {
  autoTourCameraFollowForwardScratch.set(0, 0, 0);
  if (!resolveAutoTourVehicleForwardWorld(targetNodeId, object, autoTourCameraFollowForwardScratch)) {
    const chassisBody = vehicleInstances.get(targetNodeId)?.vehicle?.chassisBody ?? null;
    const velocity = chassisBody?.velocity ?? null;
    if (velocity) {
      autoTourCameraFollowForwardScratch.set(velocity.x, 0, velocity.z);
    }
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

  resolveAutoTourCameraFollowAnchor(targetNodeId, object);
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
  return computeFollowPlacement(getApproxDimensions(object));
}

function resolveAutoTourCameraFollowAnchor(nodeId: string, object: THREE.Object3D): THREE.Vector3 {
  if (resolveVehicleOrObjectWorldPosition({
    nodeId,
    vehicleInstances,
    nodeObjectMap,
    isPhysicsEnabled: () => physicsEnvironmentEnabled.value,
    target: autoTourCameraFollowAnchorScratch,
  })) {
    return autoTourCameraFollowAnchorScratch;
  }
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

function clearVehicleDriveIntroState(): void {
  vehicleDriveIntroState.active = false;
  vehicleDriveIntroState.nodeId = null;
  vehicleDriveIntroState.phase = 'idle';
  vehicleDriveIntroState.elapsedSeconds = 0;
  vehicleDriveIntroState.startPosition.set(0, 0, 0);
  vehicleDriveIntroState.startTarget.set(0, 0, 0);
  vehicleDriveIntroState.startUp.set(0, 1, 0);
  vehicleDriveIntroPendingState.active = false;
  vehicleDriveIntroPendingState.nodeId = null;
  vehicleDriveIntroPendingState.requestedAtMs = 0;
  vehicleDriveIntroPendingState.timeoutMs = VEHICLE_DRIVE_INTRO_READY_TIMEOUT_MS;
}

function requestVehicleDriveIntroStart(nodeId: string | null): void {
  const normalizedNodeId = normalizeNodeId(nodeId);
  if (!normalizedNodeId) {
    clearVehicleDriveIntroState();
    return;
  }
  vehicleDriveIntroPendingState.active = true;
  vehicleDriveIntroPendingState.nodeId = normalizedNodeId;
  vehicleDriveIntroPendingState.requestedAtMs = getVehicleSpeedDisplayNowMs();
  vehicleDriveIntroPendingState.timeoutMs = VEHICLE_DRIVE_INTRO_READY_TIMEOUT_MS;
}

function resolveLazyPlaceholderForNode(nodeId: string): { placeholder: THREE.Object3D; lazyData: LazyAssetMetadata } | null {
  const object = nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return null;
  }
  const placeholder = findLazyPlaceholderForNode(object, nodeId);
  if (!placeholder) {
    return null;
  }
  const lazyData = placeholder.userData?.lazyAsset as LazyAssetMetadata;
  if (!lazyData?.placeholder) {
    return null;
  }
  return { placeholder, lazyData };
}

function syncLazyPlaceholderStateFromObject(state: LazyPlaceholderState, object: THREE.Object3D, nodeId: string): boolean {
  state.container = object;
  const placeholderObject = findLazyPlaceholderForNode(object, nodeId);
  if (!placeholderObject) {
    return false;
  }
  state.placeholder = placeholderObject;
  const lazyData = placeholderObject.userData?.lazyAsset as LazyAssetMetadata;
  if (!lazyData || !lazyData.placeholder || !lazyData.assetId) {
    return false;
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
  return true;
}

function scheduleLazyPlaceholderLoad(state: LazyPlaceholderState): void {
  if (state.loaded || state.loading || state.pending) {
    return;
  }
  if (activeLazyLoadCount >= MAX_CONCURRENT_LAZY_LOADS) {
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
}

function inspectVehicleDriveIntroReadiness(nodeId: string): boolean {
  const context = renderContext;
  if (!context || !nodeId) {
    return false;
  }
  const object = nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return false;
  }
  if (!resolveVehicleDriveIntroPose(nodeId)) {
    return false;
  }

  const vehiclePlaceholder = resolveLazyPlaceholderForNode(nodeId);
  if (vehiclePlaceholder && lazyLoadMeshesEnabled) {
    const vehicleLazyState = lazyPlaceholderStates.get(nodeId) ?? null;
    if (vehicleLazyState && !vehicleLazyState.loaded) {
      syncLazyPlaceholderStateFromObject(vehicleLazyState, object, nodeId);
      scheduleLazyPlaceholderLoad(vehicleLazyState);
    }
    return false;
  }

  if (!lazyLoadMeshesEnabled || lazyPlaceholderStates.size === 0) {
    return true;
  }

  vehicleDriveIntroReadinessCamera.copy(context.camera);
  vehicleDriveIntroReadinessCamera.position.copy(vehicleDriveIntroPositionScratch);
  vehicleDriveIntroReadinessCamera.up.copy(vehicleDriveIntroUpScratch);
  vehicleDriveIntroReadinessCamera.lookAt(vehicleDriveIntroTargetScratch);
  vehicleDriveIntroReadinessCamera.updateMatrixWorld(true);
  tempCameraMatrix.multiplyMatrices(
    vehicleDriveIntroReadinessCamera.projectionMatrix,
    vehicleDriveIntroReadinessCamera.matrixWorldInverse,
  );
  cameraViewFrustum.setFromProjectionMatrix(tempCameraMatrix);

  let blockedByNearbyPlaceholder = false;
  lazyPlaceholderStates.forEach((state, candidateNodeId) => {
    if (blockedByNearbyPlaceholder || candidateNodeId === nodeId) {
      return;
    }
    const container = nodeObjectMap.get(candidateNodeId) ?? null;
    if (!container) {
      return;
    }
    if (!syncLazyPlaceholderStateFromObject(state, container, candidateNodeId)) {
      return;
    }
    if (!state.placeholder || state.loaded) {
      return;
    }
    if (state.loading || state.pending) {
      if (shouldLoadLazyPlaceholder(state, cameraViewFrustum)) {
        blockedByNearbyPlaceholder = true;
      }
      return;
    }
    if (shouldLoadLazyPlaceholder(state, cameraViewFrustum)) {
      scheduleLazyPlaceholderLoad(state);
      blockedByNearbyPlaceholder = true;
    }
  });

  return !blockedByNearbyPlaceholder;
}

function tryStartPendingVehicleDriveIntro(): boolean {
  const nodeId = vehicleDriveIntroPendingState.nodeId;
  if (!vehicleDriveIntroPendingState.active || !nodeId) {
    return false;
  }

  const ready = inspectVehicleDriveIntroReadiness(nodeId);
  const timeoutReached = getVehicleSpeedDisplayNowMs() - vehicleDriveIntroPendingState.requestedAtMs >= vehicleDriveIntroPendingState.timeoutMs;
  if (!ready && !timeoutReached) {
    return false;
  }

  vehicleDriveIntroPendingState.active = false;
  vehicleDriveIntroPendingState.nodeId = null;
  vehicleDriveIntroPendingState.requestedAtMs = 0;

  return startVehicleDriveIntroSequence(nodeId);
}

function resolveVehicleDriveIntroAnchor(object: THREE.Object3D): THREE.Vector3 {
  tempBox.makeEmpty();
  tempBox.setFromObject(object);
  if (!tempBox.isEmpty() && Number.isFinite(tempBox.min.x)) {
    tempBox.getCenter(vehicleDriveIntroAnchorScratch);
  } else {
    object.getWorldPosition(vehicleDriveIntroAnchorScratch);
  }
  return vehicleDriveIntroAnchorScratch;
}

function resolveVehicleDriveIntroPose(nodeId: string): boolean {
  const object = nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return false;
  }

  object.updateWorldMatrix(true, false);
  const anchor = resolveVehicleDriveIntroAnchor(object);
  const instance = vehicleInstances.get(nodeId) ?? null;

  if (instance) {
    object.getWorldQuaternion(vehicleDriveIntroScratchCamera.quaternion);
    vehicleDriveIntroForwardScratch.copy(instance.axisForward).applyQuaternion(vehicleDriveIntroScratchCamera.quaternion);
    vehicleDriveIntroUpScratch.copy(instance.axisUp).applyQuaternion(vehicleDriveIntroScratchCamera.quaternion);
  } else {
    object.getWorldQuaternion(vehicleDriveIntroScratchCamera.quaternion);
    vehicleDriveIntroForwardScratch.set(0, 0, -1).applyQuaternion(vehicleDriveIntroScratchCamera.quaternion);
    vehicleDriveIntroUpScratch.set(0, 1, 0).applyQuaternion(vehicleDriveIntroScratchCamera.quaternion);
  }

  if (vehicleDriveIntroForwardScratch.lengthSq() < 1e-8) {
    vehicleDriveIntroForwardScratch.set(0, 0, 1);
  } else {
    vehicleDriveIntroForwardScratch.normalize();
  }
  if (vehicleDriveIntroUpScratch.lengthSq() < 1e-8) {
    vehicleDriveIntroUpScratch.set(0, 1, 0);
  } else {
    vehicleDriveIntroUpScratch.normalize();
  }

  vehicleDriveIntroRightScratch.crossVectors(vehicleDriveIntroForwardScratch, vehicleDriveIntroUpScratch);
  if (vehicleDriveIntroRightScratch.lengthSq() < 1e-8) {
    vehicleDriveIntroRightScratch.crossVectors(worldUp, vehicleDriveIntroForwardScratch);
  }
  if (vehicleDriveIntroRightScratch.lengthSq() < 1e-8) {
    vehicleDriveIntroRightScratch.set(1, 0, 0);
  } else {
    vehicleDriveIntroRightScratch.normalize();
  }

  vehicleDriveIntroUpScratch.crossVectors(vehicleDriveIntroRightScratch, vehicleDriveIntroForwardScratch);
  if (vehicleDriveIntroUpScratch.lengthSq() < 1e-8) {
    vehicleDriveIntroUpScratch.set(0, 1, 0);
  } else {
    vehicleDriveIntroUpScratch.normalize();
  }

  const dimensions = getApproxDimensions(object);
  const lateralOffset = Math.max(dimensions.width * 1.75, 4.8);
  const verticalOffset = Math.max(dimensions.height * 2.1, 4.8);
  const forwardOffset = Math.max(dimensions.length * 1.65, 5.8);
  const targetLift = Math.max(dimensions.height * 0.38, 0.7);

  vehicleDriveIntroPositionScratch
    .copy(anchor)
    .addScaledVector(vehicleDriveIntroRightScratch, lateralOffset)
    .addScaledVector(vehicleDriveIntroUpScratch, verticalOffset)
    .addScaledVector(vehicleDriveIntroForwardScratch, forwardOffset);
  vehicleDriveIntroTargetScratch
    .copy(anchor)
    .addScaledVector(vehicleDriveIntroUpScratch, targetLift);

  return true;
}

function startVehicleDriveIntroSequence(targetNodeId: string | null): boolean {
  const context = renderContext;
  const normalizedTargetNodeId = normalizeNodeId(targetNodeId);
  if (!context || !normalizedTargetNodeId || !vehicleDriveActive.value || vehicleDriveNodeId.value !== normalizedTargetNodeId) {
    clearVehicleDriveIntroState();
    return false;
  }

  if (!resolveVehicleDriveIntroPose(normalizedTargetNodeId)) {
    clearVehicleDriveIntroState();
    return false;
  }

  vehicleDriveIntroState.active = true;
  vehicleDriveIntroState.nodeId = normalizedTargetNodeId;
  vehicleDriveIntroState.phase = 'hold';
  vehicleDriveIntroState.elapsedSeconds = 0;
  vehicleDriveIntroState.startPosition.copy(vehicleDriveIntroPositionScratch);
  vehicleDriveIntroState.startTarget.copy(vehicleDriveIntroTargetScratch);
  vehicleDriveIntroState.startUp.copy(vehicleDriveIntroUpScratch);

  runWithProgrammaticCameraMutationAndAnchor(() => {
    withControlsVerticalFreedom(context.controls, () => {
      context.camera.position.copy(vehicleDriveIntroState.startPosition);
      context.controls.target.copy(vehicleDriveIntroState.startTarget);
      context.camera.up.copy(vehicleDriveIntroState.startUp);
      context.camera.lookAt(context.controls.target);
      context.controls.update();
    });
  });

  return true;
}

function updateVehicleDriveIntroCamera(deltaSeconds: number): boolean {
  const context = renderContext;
  const nodeId = vehicleDriveIntroState.nodeId;
  if (!context || !vehicleDriveIntroState.active || !nodeId || !vehicleDriveActive.value || vehicleDriveNodeId.value !== nodeId) {
    return false;
  }

  if (!resolveVehicleDriveIntroPose(nodeId)) {
    clearVehicleDriveIntroState();
    return false;
  }

  vehicleDriveIntroScratchCamera.position.copy(vehicleDriveIntroState.startPosition);
  vehicleDriveIntroScratchCamera.up.copy(vehicleDriveIntroState.startUp);
  vehicleDriveIntroScratchControls.target.copy(vehicleDriveIntroState.startTarget);
  vehicleDriveController.updateCamera(0, {
    camera: vehicleDriveIntroScratchCamera,
    mapControls: vehicleDriveIntroScratchControls,
  }, { immediate: true });

  const nowDelta = Math.max(0, deltaSeconds);
  vehicleDriveIntroState.elapsedSeconds += nowDelta;
  if (vehicleDriveIntroState.phase === 'hold' && vehicleDriveIntroState.elapsedSeconds >= vehicleDriveIntroState.holdSeconds) {
    vehicleDriveIntroState.phase = 'blend';
    vehicleDriveIntroState.startPosition.copy(context.camera.position);
    vehicleDriveIntroState.startTarget.copy(context.controls.target);
    vehicleDriveIntroState.startUp.copy(context.camera.up);
  }

  if (vehicleDriveIntroState.phase === 'hold') {
    runWithProgrammaticCameraMutationAndAnchor(() => {
      withControlsVerticalFreedom(context.controls, () => {
        context.camera.position.copy(vehicleDriveIntroState.startPosition);
        context.controls.target.copy(vehicleDriveIntroState.startTarget);
        context.camera.up.copy(vehicleDriveIntroState.startUp);
        context.camera.lookAt(context.controls.target);
        context.controls.update();
      });
    });
    return true;
  }

  const blendElapsedSeconds = Math.max(0, vehicleDriveIntroState.elapsedSeconds - vehicleDriveIntroState.holdSeconds);
  const blendProgress = vehicleDriveIntroState.blendSeconds <= 1e-6
    ? 1
    : Math.min(1, blendElapsedSeconds / vehicleDriveIntroState.blendSeconds);
  const easedBlend = easeInOutCubic(blendProgress);

  vehicleDriveIntroBlendTargetPositionScratch.copy(vehicleDriveCameraFollowState.currentPosition);
  vehicleDriveIntroBlendTargetTargetScratch.copy(vehicleDriveCameraFollowState.currentTarget);
  runWithProgrammaticCameraMutationAndAnchor(() => {
    withControlsVerticalFreedom(context.controls, () => {
      context.camera.position.lerpVectors(
        vehicleDriveIntroState.startPosition,
        vehicleDriveIntroBlendTargetPositionScratch,
        easedBlend,
      );
      context.controls.target.lerpVectors(
        vehicleDriveIntroState.startTarget,
        vehicleDriveIntroBlendTargetTargetScratch,
        easedBlend,
      );
      context.camera.up.copy(vehicleDriveIntroState.startUp);
      context.camera.lookAt(context.controls.target);
      context.controls.update();
    });
  });

  if (blendProgress >= 1) {
    clearVehicleDriveIntroState();
  }

  return true;
}

const vehicleDriveController = new VehicleDriveController(
  {
    vehicleInstances,
    rigidbodyInstances,
    nodeObjectMap,
    resolveNodeById,
    resolveRigidbodyComponent,
    resolveVehicleComponent,
    isPhysicsEnabled: () => physicsEnvironmentEnabled.value,
    ensureVehicleBindingForNode,
    normalizeNodeId,
    setCameraViewState: (mode, targetId) => setCameraViewState(mode as CameraViewMode, targetId ?? null),
    setCameraCaging,
    withControlsVerticalFreedom,
    lockControlsPitchToCurrent,
    onToast: (message) => uni.showToast({ title: message, icon: 'none' }),
    onResolveBehaviorToken: (token, resolution) => resolveBehaviorToken(token, resolution),

    // Use one shared follow-camera tuning profile across platforms.
    followCameraDistanceScale: () => DEFAULT_BACK_FOLLOW_CAMERA_DISTANCE_SCALE,
    followCameraVelocityLerpSpeed: () => 0,
    followCameraTuning: () => createBackFollowCameraTuning(),
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
      resolveInterpolatedBodyPosition(chassisBody as PhysicsBodyLike, target);
      return true;
    },
    resolveChassisWorldVelocity: (nodeId, chassisBody, target) => {
      if (!vehicleDriveActive.value || vehicleDriveNodeId.value !== nodeId) {
        return false;
      }
      const telemetry = controlledNodeMotionRuntime.get(nodeId);
      if (telemetry) {
        target.copy(telemetry.worldLinearVelocity);
        return true;
      }
      const v = chassisBody?.velocity as unknown as { x?: number; y?: number; z?: number } | null;
      if (!v) {
        return false;
      }
      target.set(Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0);
      return true;
    },
    resolveCurrentSpeedMps: (nodeId) => controlledNodeMotionRuntime.resolveLinearSpeedMps(nodeId, null),
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

watch(
  () => characterControlUi.value.visible,
  (visible) => {
    if (visible) {
      refreshCharacterJoystickMetrics();
      updateCharacterFollowCamera(0, { immediate: true });
    } else {
      resetCharacterActionButtonState();
      detachCharacterDrivePadMouseListeners();
      hideCharacterDrivePadImmediate();
      deactivateCharacterJoystick(true);
      resetProtagonistPoseState();
    }
  },
);

watch(
  () => resolveDefaultControlledCharacterNodeId(),
  (nodeId, previousNodeId) => {
    if (nodeId !== previousNodeId) {
      resetCharacterActionButtonState();
    }
  },
);

watch(vehicleDriveActive, (active) => {
  if (!active) {
    clearVehicleDriveIntroState();
    vehicleDriveCameraFollowState.initialized = false;
    vehicleSpeedDisplayMps.value = 0;
    vehicleSpeedDisplayLastCommitAtMs = 0;
    vehicleSpeedDisplayLowSpeedSinceAtMs = null;
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
const nodeAnimationRuntime = new SceneAnimationRuntimeManager();
const pendingParticleRuntimeCommands: Array<{ nodeId: string; command: { type: 'play' | 'stop' | 'burst'; componentId: string | null; emitterId?: string | null; count?: number; restart?: boolean; softStop?: boolean } }> = [];

const behaviorProximityCandidates = new Map<string, BehaviorProximityCandidate>();
const behaviorProximityState = new Map<string, BehaviorProximityState>();
const behaviorObserverContextScratch = new THREE.Vector3();
function resolveSceneryBehaviorObserverContext(): BehaviorObserverContext {
  const candidates: BehaviorObserverCandidate[] = [];
  if (vehicleDriveActive.value && vehicleDriveNodeId.value) {
    candidates.push({ nodeId: vehicleDriveNodeId.value, kind: 'vehicle' });
  }
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  if (controlledNodeId) {
    candidates.push({ nodeId: controlledNodeId, kind: 'character' });
  }
  if (activeAutoTourNodeIds.size > 0) {
    const autoTourNodeId = resolveAutoTourFollowNodeId(
      autoTourFollowNodeId.value,
      cameraViewState.targetNodeId,
      activeAutoTourNodeIds,
      previewNodeMap.keys(),
      autoTourRuntime,
    );
    if (autoTourNodeId) {
      candidates.push({ nodeId: autoTourNodeId, kind: 'other' });
    }
  }
  if (cameraViewState.mode === 'watching' && cameraViewState.targetNodeId) {
    candidates.push({ nodeId: cameraViewState.targetNodeId, kind: 'other' });
  }
  return resolveBehaviorObserverContext(
    {
      candidates,
      getCamera: () => renderContext?.camera ?? null,
      resolveNodePosition: (nodeId, scratch) =>
        resolveNodeFocusPoint(nodeId) ?? nodeObjectMap.get(nodeId)?.getWorldPosition(scratch) ?? null,
    },
    behaviorObserverContextScratch,
  );
}
const behaviorProximityRuntime = createBehaviorProximityRuntime({
  resolveObserverContext: () => resolveSceneryBehaviorObserverContext(),
  behaviorProximityCandidates,
  behaviorProximityState,
  nodeObjectMap,
  resolveRegionNode: (nodeId) => previewNodeMap.get(nodeId) ?? null,
  resolveNodeFocusPoint: (nodeId, fallback) => resolveNodeFocusPoint(nodeId) ?? fallback,
  triggerBehaviorAction,
  processBehaviorEvents,
});

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
const instanceLayoutWorldMatrixScratch = new THREE.Matrix4();
const cameraViewFrustum = new THREE.Frustum();

const tempBox = new THREE.Box3();
const tempSphere = new THREE.Sphere();
const tempVector = new THREE.Vector3();
const tempPitchVector = new THREE.Vector3();
const tempSpherical = new THREE.Spherical();
const vehicleDriveIntroScratchCamera = new THREE.PerspectiveCamera();
const vehicleDriveIntroReadinessCamera = new THREE.PerspectiveCamera();
const vehicleDriveIntroScratchControls = {
  target: new THREE.Vector3(),
  update: () => {},
  enabled: false,
  enablePan: true,
  minDistance: 0,
  maxDistance: Infinity,
};
const vehicleDriveIntroAnchorScratch = new THREE.Vector3();
const vehicleDriveIntroForwardScratch = new THREE.Vector3();
const vehicleDriveIntroRightScratch = new THREE.Vector3();
const vehicleDriveIntroUpScratch = new THREE.Vector3();
const vehicleDriveIntroBlendTargetPositionScratch = new THREE.Vector3();
const vehicleDriveIntroBlendTargetTargetScratch = new THREE.Vector3();
const vehicleDriveIntroPositionScratch = new THREE.Vector3();
const vehicleDriveIntroTargetScratch = new THREE.Vector3();
const LANTERN_SWIPE_DETECTION_THRESHOLD = 18;
const LANTERN_SWIPE_TRIGGER_THRESHOLD = 60;
let lanternSwipeStartX: number | null = null;
let lanternSwipeStartY: number | null = null;
let lanternSwipeActive = false;

type CameraWatchTween = {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromQuaternion: THREE.Quaternion;
  toQuaternion: THREE.Quaternion;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromTargetDistance: number;
  toTargetDistance: number;
  fromProjection: {
    fov: number;
    near: number;
    far: number;
    zoom: number;
  };
  toProjection: {
    fov: number;
    near: number;
    far: number;
    zoom: number;
  };
  duration: number;
  elapsed: number;
  lastLoggedBucket: number;
  onComplete?: (() => void) | null;
};

type CameraWatchTransitionPlan = {
  fromPosition: THREE.Vector3;
  fromQuaternion: THREE.Quaternion;
  fromTargetDistance: number;
  toPosition: THREE.Vector3;
  toQuaternion: THREE.Quaternion;
  toTargetDistance: number;
};

let activeCameraWatchTween: CameraWatchTween | null = null;
let activeWatchTransitionPlan: CameraWatchTransitionPlan | null = null;
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

function resolveWatchSnapshotBaseName(): string {
  const fallbackName = previewPayload.value?.title || currentDocument?.name || 'scene';
  return fallbackName
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 64) || 'scene';
}

function buildWatchSnapshotFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${resolveWatchSnapshotBaseName()}-${stamp}.png`;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  const mimeType = match[1] || 'image/png';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';

  try {
    const binary = isBase64
      ? (typeof atob === 'function' ? atob(payload) : '')
      : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  } catch (error) {
    console.warn('[SceneryViewer] Failed to convert data URL to blob', error);
    return null;
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, mimeType = 'image/png'): Promise<Blob | null> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((value) => resolve(value), mimeType);
      } catch (error) {
        console.warn('[SceneryViewer] canvas.toBlob failed', error);
        resolve(null);
      }
    });
    if (blob) {
      return blob;
    }
  }

  try {
    const dataUrl = canvas.toDataURL(mimeType);
    const dataUrlBlob = dataUrlToBlob(dataUrl);
    if (dataUrlBlob) {
      return dataUrlBlob;
    }
    if (typeof fetch === 'function') {
      const response = await fetch(dataUrl);
      if (response.ok) {
        return await response.blob();
      }
    }
  } catch (error) {
    console.warn('[SceneryViewer] Failed to convert canvas to blob', error);
  }

  return null;
}

type MiniProgramFsManager = {
  mkdirSync?: (dirPath: string, recursive?: boolean) => void;
  writeFile?: (options: {
    filePath: string;
    data: ArrayBuffer | Uint8Array;
    success?: () => void;
    fail?: (error: unknown) => void;
  }) => void;
};

type MiniProgramPlatform = {
  getFileSystemManager?: () => MiniProgramFsManager;
  env?: {
    USER_DATA_PATH?: string;
  };
};

async function captureWatchSnapshotBlob(): Promise<Blob | null> {
  const context = renderContext;
  const canvas = canvasResult?.canvas ?? null;
  if (!context || !canvas) {
    return null;
  }

  try {
    context.renderer.render(context.scene, context.camera);
  } catch (error) {
    console.warn('[SceneryViewer] Failed to render frame before capture', error);
  }

  return await canvasToBlob(canvas, 'image/png');
}

function triggerWatchSnapshotDownload(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持文件下载');
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.rel = 'noopener';
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function getMiniProgramFsManager(): MiniProgramFsManager | null {
  const uniAny = uni as typeof uni & { getFileSystemManager?: () => MiniProgramFsManager };
  if (typeof uniAny.getFileSystemManager === 'function') {
    return uniAny.getFileSystemManager();
  }

  const wxAny = typeof globalThis !== 'undefined' ? (globalThis as typeof globalThis & { wx?: MiniProgramPlatform }).wx : null;
  if (wxAny && typeof wxAny.getFileSystemManager === 'function') {
    return wxAny.getFileSystemManager();
  }

  return null;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const anyBlob = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof anyBlob.arrayBuffer === 'function') {
    return await anyBlob.arrayBuffer();
  }

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as ArrayBuffer) || new ArrayBuffer(0));
    reader.onerror = () => reject(reader.error ?? new Error('读取截图失败'));
    reader.readAsArrayBuffer(blob);
  });
}

function resolveMiniProgramSnapshotPath(fileName: string): string {
  const wxAny = typeof globalThis !== 'undefined' ? (globalThis as typeof globalThis & { wx?: MiniProgramPlatform }).wx : null;
  const basePath = wxAny?.env?.USER_DATA_PATH;
  if (typeof basePath !== 'string' || !basePath.trim()) {
    throw new Error('无法获取本地存储路径');
  }
  return `${basePath.replace(/\/$/, '')}/harmony/watch-snapshots/${fileName}`;
}

async function ensureWritePhotosAlbumPermission(): Promise<boolean> {
  if (typeof uni.getSetting !== 'function') {
    return true;
  }

  const hasPermission = await new Promise<boolean>((resolve) => {
    uni.getSetting({
      success: (result: { authSetting?: Record<string, boolean> }) => {
        resolve(result.authSetting?.['scope.writePhotosAlbum'] !== false);
      },
      fail: () => resolve(true),
    });
  });

  if (hasPermission) {
    return true;
  }

  if (typeof uni.authorize !== 'function') {
    return false;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      uni.authorize({
        scope: 'scope.writePhotosAlbum',
        success: () => resolve(),
        fail: reject,
      });
    });
    return true;
  } catch {
    uni.showToast({ title: '请先授权保存到相册', icon: 'none' });
    return false;
  }
}

async function saveWatchSnapshotToMiniProgram(blob: Blob, fileName: string): Promise<void> {
  const fs = getMiniProgramFsManager();
  if (!fs || typeof fs.writeFile !== 'function') {
    throw new Error('当前环境不支持文件写入');
  }

  const filePath = resolveMiniProgramSnapshotPath(fileName);
  const dir = filePath.slice(0, filePath.lastIndexOf('/'));
  try {
    if (typeof fs.mkdirSync === 'function') {
      fs.mkdirSync(dir, true);
    }
  } catch (error) {
    console.warn('[SceneryViewer] Failed to prepare snapshot directory', error);
  }

  const bytes = await blobToArrayBuffer(blob);
  const writeFile = fs.writeFile;
  if (typeof writeFile !== 'function') {
    throw new Error('当前环境不支持文件写入');
  }
  await new Promise<void>((resolve, reject) => {
    writeFile({
      filePath,
      data: bytes,
      success: () => resolve(),
      fail: reject,
    });
  });

  if (!(await ensureWritePhotosAlbumPermission())) {
    throw new Error('未获得保存到相册的权限');
  }

  await new Promise<void>((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: reject,
    });
  });
}

async function handleWatchSnapshotTap(): Promise<void> {
  if (watchSnapshotBusy.value) {
    return;
  }

  watchSnapshotBusy.value = true;
  try {
    const blob = await captureWatchSnapshotBlob();
    if (!blob) {
      uni.showToast({ title: '当前画面暂时无法保存', icon: 'none' });
      return;
    }

    const fileName = buildWatchSnapshotFileName();
    if (isWeChatMiniProgram) {
      await saveWatchSnapshotToMiniProgram(blob, fileName);
      uni.showToast({ title: '已保存到相册', icon: 'success' });
      return;
    }

    triggerWatchSnapshotDownload(blob, fileName);
    uni.showToast({ title: '截图已下载', icon: 'success' });
  } catch (error) {
    console.warn('[SceneryViewer] Failed to save watch snapshot', error);
    const message = error instanceof Error ? error.message : '截图保存失败';
    uni.showToast({ title: message || '截图保存失败', icon: 'none' });
  } finally {
    watchSnapshotBusy.value = false;
  }
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

function createDownloadAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError');
  }
  const error = new Error('Aborted');
  (error as { name?: string }).name = 'AbortError';
  return error;
}

async function downloadBlobFromUrl(
  url: string,
  options: {
    signal?: AbortSignal | null;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<Blob> {
  const controller = new AbortController();
  const { signal, onProgress } = options;
  const handleAbort = () => {
    controller.abort();
  };

  if (signal?.aborted) {
    throw createDownloadAbortError();
  }

  if (signal) {
    signal.addEventListener('abort', handleAbort, { once: true });
  }

  try {
    const { blob } = await fetchAssetBlob(url, controller, onProgress ?? (() => {}));
    return blob;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', handleAbort);
    }
  }
}

async function fetchTextFromUrl(url: string, signal?: AbortSignal | null): Promise<string> {
  const blob = await downloadBlobFromUrl(url, { signal });
  if (typeof blob.text === 'function') {
    return await blob.text();
  }
  const buffer = await blob.arrayBuffer();
  return new TextDecoder().decode(buffer);
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

function shouldSpawnRuntimePrefabRequest(request: RuntimePrefabSpawnRequest): boolean {
  if (!request.requestId?.startsWith('vehicle-prefab:')) {
    return true;
  }
  const defaultSteerIdentifier = typeof props.defaultSteerIdentifier === 'string'
    ? props.defaultSteerIdentifier.trim() || null
    : null;
  const binding = currentDocument
    ? resolveDefaultSteerBinding(currentDocument, defaultSteerIdentifier, resolveDefaultSteerTargetType())
    : null;
  return binding?.steerProps.targetType === 'vehicle';
}

function mergeAssetPreloadMeshInfo(
  assetPreload: SceneJsonExportDocument['assetPreload'] | undefined,
  assetIds: string[],
): SceneJsonExportDocument['assetPreload'] | undefined {
  const normalizedAssetIds = normalizeAssetIdList(assetIds);
  const existingMesh = assetPreload?.mesh;
  const mergedAll = new Set<string>(normalizeAssetIdList(existingMesh?.all ?? []));
  const mergedEssential = new Set<string>(normalizeAssetIdList(existingMesh?.essential ?? []));

  normalizedAssetIds.forEach((assetId) => {
    mergedAll.add(assetId);
    mergedEssential.add(assetId);
  });

  if (!mergedAll.size && !mergedEssential.size) {
    return assetPreload;
  }

  return {
    mesh: {
      all: Array.from(mergedAll).sort(),
      essential: Array.from(mergedEssential).sort(),
    },
  };
}

function createSceneGraphBuildOptions(payload: ScenePreviewPayload, onProgress?: SceneGraphBuildOptions['onProgress']): SceneGraphBuildOptions {
  const buildOptions: SceneGraphBuildOptions = {};
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
  if (onProgress) {
    buildOptions.onProgress = onProgress;
  }
  return buildOptions;
}

function normalizeScenePackageBuildKey(source: string | ScenePackagePointer | null | undefined): string {
  if (!source) {
    return '';
  }
  if (typeof source === 'string') {
    return source.trim();
  }
  const ref = typeof source.ref === 'string' ? source.ref.trim() : '';
  if (!ref) {
    return '';
  }
  return `${source.kind}:${ref}`;
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

function resolveGroundTextureSource(assetId: string): string | null {
  const trimmed = typeof assetId === 'string' ? assetId.trim() : ''
  if (!trimmed.length) {
    return null
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed
  }
  const cachedEntry = sceneAssetLoader.getCache().peekEntry(trimmed)
  if (cachedEntry?.blobUrl) {
    return cachedEntry.blobUrl
  }
  return cachedEntry?.downloadUrl ?? null
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

function readCompiledGroundManifestFromDocument(document: SceneJsonExportDocument | null | undefined): Parameters<
  typeof syncCompiledGroundRenderTiles
>[0]['manifest'] | null {
  const groundNode = resolveDocumentGroundNode(document);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return null;
  }
  const groundUserData = groundNode.userData && typeof groundNode.userData === 'object'
    ? (groundNode.userData as Record<string, unknown>)
    : {};
  const compiledManifest = groundUserData.compiledGroundManifest as Parameters<
    typeof syncCompiledGroundRenderTiles
  >[0]['manifest'] | null | undefined;
  return compiledManifest ?? null;
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

async function requestBinaryFromUrl(url: string, signal?: AbortSignal | null): Promise<ArrayBuffer> {
  const blob = await downloadBlobFromUrl(url, { signal });
  return await blob.arrayBuffer();
}

function buildObjectUrlsFromSkycubeZipFaces(
  facesInOrder: ReadonlyArray<ExtractSkycubeZipFacesResult['facesInOrder'][number]>,
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

async function resolveParticleTextureAssetSource(assetId: string): Promise<THREE.Texture | null> {
  const trimmed = assetId.trim();
  if (!trimmed.length) {
    return null;
  }
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
      const directTexture = await loadTextureFromSourceUrl(trimmed);
      directTexture.name = trimmed;
      directTexture.colorSpace = THREE.SRGBColorSpace;
      ensureFloatTextureFilterCompatibility(directTexture);
      directTexture.needsUpdate = true;
      return directTexture;
    }
    const cache = viewerResourceCache ?? sharedResourceCache;
    if (!cache) {
      return null;
    }
    const entry = await cache.acquireAssetEntry(trimmed);
    if (!entry) {
      return null;
    }
    const source = entry.blobUrl ?? entry.downloadUrl ?? '';
    if (!source) {
      return null;
    }
    const texture = await loadTextureFromSourceUrl(source);
    texture.name = entry.filename ?? trimmed;
    texture.colorSpace = THREE.SRGBColorSpace;
    ensureFloatTextureFilterCompatibility(texture);
    texture.needsUpdate = true;
    return texture;
  } catch (error) {
    console.warn('[SceneViewer] Failed to resolve particle texture', trimmed, error);
    return null;
  }
}

(globalThis as typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: typeof resolveDisplayBoardMediaSource })[
  DISPLAY_BOARD_RESOLVER_KEY
] = resolveDisplayBoardMediaSource;
setParticleTextureResolver(resolveParticleTextureAssetSource);

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

function normalizeRuntimePrefabMode(value: unknown): RuntimePrefabInitializationMode {
  return value === 'render-only' ? 'render-only' : 'full';
}

function normalizeRuntimePrefabPlacement(value: unknown): RuntimePrefabPlacementOptions {
  const candidate = value && typeof value === 'object'
    ? value as Partial<RuntimePrefabPlacementOptions>
    : null;
  const alignment = candidate?.alignment === 'bottom-to-anchor' || candidate?.alignment === 'center-to-anchor' || candidate?.alignment === 'place-on-surface' || candidate?.alignment === 'custom-offset'
    ? candidate.alignment
    : 'origin';
  return {
    alignment,
    offset: cloneVectorLikeValue(candidate?.offset),
  };
}

function findSceneNodeByName(nodes: SceneNode[] | undefined | null, name: string): SceneNode | null {
  if (!Array.isArray(nodes) || !name.trim().length) {
    return null;
  }
  const targetName = name.trim();
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if ((node.name ?? '').trim() === targetName) {
      return node;
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return null;
}

function resolveRuntimePrefabAnchorNodeId(request: RuntimePrefabSpawnRequest): string | null {
  const explicitNodeId = typeof request.targetNodeId === 'string' ? request.targetNodeId.trim() : '';
  if (explicitNodeId.length) {
    return explicitNodeId;
  }
  const targetNodeName = typeof request.targetNodeName === 'string' ? request.targetNodeName.trim() : '';
  if (targetNodeName.length) {
    const byName = findSceneNodeByName(currentDocument?.nodes ?? null, targetNodeName);
    if (byName?.id) {
      return byName.id;
    }
  }
  return resolveDefaultControlledCharacterNodeId();
}

function cloneVectorLikeValue(value: Vector3Like | null | undefined): Vector3Like | null {
  if (!value) {
    return null;
  }
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    z: Number.isFinite(value.z) ? value.z : 0,
  };
}

function resolveRuntimePrefabAnchorTransform(request: RuntimePrefabSpawnRequest): {
  position: Vector3Like | null;
  rotation: Vector3Like | null;
} {
  const explicitPosition = cloneVectorLikeValue(request.position);
  const explicitRotation = cloneVectorLikeValue(request.rotation);
  if (explicitPosition || explicitRotation) {
    return {
      position: explicitPosition,
      rotation: explicitRotation,
    };
  }

  const anchorNodeId = resolveRuntimePrefabAnchorNodeId(request);
  if (!anchorNodeId) {
    return { position: null, rotation: null };
  }
  const anchorObject = nodeObjectMap.get(anchorNodeId) ?? null;
  if (!anchorObject) {
    return { position: null, rotation: null };
  }

  const worldPosition = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  const worldEuler = new THREE.Euler();
  anchorObject.getWorldPosition(worldPosition);
  anchorObject.getWorldQuaternion(worldQuaternion);
  worldEuler.setFromQuaternion(worldQuaternion, 'XYZ');
  return {
    position: { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z },
    rotation: { x: worldEuler.x, y: worldEuler.y, z: worldEuler.z },
  };
}

function applyRuntimePrefabTransform(node: SceneNode, request: RuntimePrefabSpawnRequest): {
  position: Vector3Like | null;
  rotation: Vector3Like | null;
} {
  const anchor = resolveRuntimePrefabAnchorTransform(request);
  const position = cloneVectorLikeValue(request.position) ?? anchor.position;
  const rotation = cloneVectorLikeValue(request.rotation) ?? anchor.rotation;
  const scale = cloneVectorLikeValue(request.scale);
  if (position) {
    node.position = position;
  }
  if (rotation) {
    node.rotation = rotation;
  }
  if (scale) {
    node.scale = scale;
  }
  return { position, rotation };
}

function applyRuntimePrefabPlacement(
  root: THREE.Object3D,
  placementValue: RuntimePrefabPlacementOptions | null | undefined,
  anchorPosition: Vector3Like | null,
  supportRoot: THREE.Object3D | null,
): void {
  const placement = normalizeRuntimePrefabPlacement(placementValue);
  const offset = cloneVectorLikeValue(placement.offset);
  if (placement.alignment !== 'origin' && placement.alignment !== 'custom-offset') {
    root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(root);
    if (!bounds.isEmpty()) {
      if (placement.alignment === 'bottom-to-anchor') {
        const anchorY = anchorPosition?.y ?? root.position.y;
        root.position.y += anchorY - bounds.min.y;
      } else if (placement.alignment === 'place-on-surface' && supportRoot) {
        const surfaceY = resolveRuntimePrefabSurfaceY(anchorPosition, root, supportRoot);
        if (surfaceY !== null) {
          root.position.y += surfaceY - bounds.min.y;
        }
      } else if (placement.alignment === 'center-to-anchor' && anchorPosition) {
        const center = bounds.getCenter(new THREE.Vector3());
        root.position.x += anchorPosition.x - center.x;
        root.position.y += anchorPosition.y - center.y;
        root.position.z += anchorPosition.z - center.z;
      }
    }
  }
  if (offset) {
    root.position.x += offset.x;
    root.position.y += offset.y;
    root.position.z += offset.z;
  }
}

function resolveRuntimePrefabSurfaceY(
  anchorPosition: Vector3Like | null,
  root: THREE.Object3D,
  supportRoot: THREE.Object3D,
): number | null {
  const sampleX = anchorPosition?.x ?? root.position.x;
  const sampleZ = anchorPosition?.z ?? root.position.z;
  if (!Number.isFinite(sampleX) || !Number.isFinite(sampleZ)) {
    return null;
  }
  const raycaster = new THREE.Raycaster();
  raycaster.set(new THREE.Vector3(sampleX, 100000, sampleZ), new THREE.Vector3(0, -1, 0));
  raycaster.far = 200000;
  const intersections = raycaster.intersectObject(supportRoot, true);
  const hit = intersections.find((entry: THREE.Intersection) => entry.object.visible && Number.isFinite(entry.point.y));
  return hit?.point.y ?? null;
}

function mergeRuntimePrefabAssetRegistry(document: SceneJsonExportDocument, runtimeDocument: SceneJsonExportDocument): void {
  const incoming = runtimeDocument.assetRegistry;
  if (!incoming || !Object.keys(incoming).length) {
    return;
  }
  document.assetRegistry = {
    ...(document.assetRegistry ?? {}),
    ...incoming,
  };
}

const runtimePrefabSourceCache = new Map<string, Promise<RuntimePrefabSource | null>>();

const runtimePrefabSourceResolverOptions = {
  resolveText: async (request: RuntimePrefabSpawnRequest) => {
    if (request.assetId) {
      return await loadTextAssetContent(request.assetId);
    }
    if (request.assetUrl) {
      return await fetchTextFromUrl(request.assetUrl);
    }
    return null;
  },
  cache: runtimePrefabSourceCache,
  buildCacheKey: buildRuntimePrefabRequestKey,
  onError: (requestKey: string, error: unknown) => {
    console.warn('[SceneViewer] Failed to resolve runtime prefab source', requestKey, error);
  },
};

function isCurrentInitializationToken(token: number): boolean {
  return token === initializeToken;
}

function buildRenderPayloadWithRuntimePrefabContext(
  payload: ScenePreviewPayload,
  runtimePrefabPreloadContext: RuntimePrefabPreloadContext | null,
): ScenePreviewPayload {
  if (!runtimePrefabPreloadContext) {
    return payload;
  }

  const mergedDocument: SceneJsonExportDocument = {
    ...payload.document,
    assetRegistry: runtimePrefabPreloadContext.assetRegistry
      ? {
          ...(payload.document.assetRegistry ?? {}),
          ...runtimePrefabPreloadContext.assetRegistry,
        }
      : payload.document.assetRegistry,
    assetPreload: mergeAssetPreloadMeshInfo(
      payload.document.assetPreload,
      runtimePrefabPreloadContext.meshAssetIds,
    ),
  };

  return {
    ...payload,
    document: mergedDocument,
  };
}

async function prepareRenderPayloadForSceneEntry(
  payload: ScenePreviewPayload,
  runtimePrefabPreloadContext: RuntimePrefabPreloadContext | null,
): Promise<ScenePreviewPayload> {
  const renderPayload = buildRenderPayloadWithRuntimePrefabContext(payload, runtimePrefabPreloadContext);
  const steerPreparedPayload = await prepareRenderPayloadForDefaultSteer(renderPayload);
  const runtimeGroundPrepared = await prepareRuntimeGroundSceneDocument(steerPreparedPayload.document);
  const groundNode = resolveSharedDocumentGroundNode(runtimeGroundPrepared.document);
  const compiledGroundManifest = groundNode?.userData?.compiledGroundManifest as { renderTiles?: unknown[] } | null | undefined;
  const compiledTileCount = Array.isArray(compiledGroundManifest?.renderTiles) ? compiledGroundManifest.renderTiles.length : 0;
  requireGroundRuntimeAssets(runtimeGroundPrepared.document, compiledTileCount);

  return {
    ...steerPreparedPayload,
    document: runtimeGroundPrepared.document,
  };
}

async function warmRuntimePrefabAssetsForSceneEntry(
  preparedPayload: ScenePreviewPayload,
  runtimePrefabPreloadContext: RuntimePrefabPreloadContext | null,
  token: number,
): Promise<boolean> {
  if (!runtimePrefabPreloadContext) {
    return true;
  }

  const prewarmBuildOptions = createSceneGraphBuildOptions(preparedPayload);
  const resourceCache = ensureResourceCache(preparedPayload.document, prewarmBuildOptions);
  viewerResourceCache = resourceCache;
  await warmRuntimePrefabAssetsBeforeSceneEntry(resourceCache, runtimePrefabPreloadContext);
  return isCurrentInitializationToken(token);
}

async function commitSceneEntryRendering(
  preparedPayload: ScenePreviewPayload,
  canvas: UseCanvasResult,
  token: number,
): Promise<boolean> {
  await initializeRenderer(preparedPayload, canvas, token);
  return isCurrentInitializationToken(token) && !error.value;
}

function findFirstVehicleNodeId(node: SceneNode | null | undefined): string | null {
  if (!node) {
    return null;
  }
  const stack: SceneNode[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (resolveEnabledComponentState<VehicleComponentProps>(current, VEHICLE_COMPONENT_TYPE)) {
      return current.id ?? null;
    }
    if (Array.isArray(current.children) && current.children.length) {
      stack.push(...current.children);
    }
  }
  return null;
}

function findFirstSteerTargetNodeId(node: SceneNode | null | undefined, targetType: SteerControllableTargetType): string | null {
  if (!node) return null;
  const stack: SceneNode[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const hasTarget = targetType === 'character'
      ? resolveEnabledComponentState(current, CHARACTER_CONTROLLER_COMPONENT_TYPE)
      : resolveEnabledComponentState<VehicleComponentProps>(current, VEHICLE_COMPONENT_TYPE);
    if (hasTarget) return current.id ?? null;
    if (Array.isArray(current.children)) stack.push(...current.children);
  }
  return null;
}

function replaceSceneNodeById(nodes: SceneNode[] | undefined | null, nodeId: string, replacement: SceneNode): boolean {
  if (!Array.isArray(nodes) || !nodeId.trim().length) {
    return false;
  }
  const index = nodes.findIndex((node) => node?.id === nodeId);
  if (index >= 0) {
    nodes.splice(index, 1, replacement);
    return true;
  }
  for (const node of nodes) {
    if (replaceSceneNodeById(node.children, nodeId, replacement)) {
      return true;
    }
  }
  return false;
}

function applySteerTargetTransform(targetNode: SceneNode, replacementRoot: SceneNode): void {
  replacementRoot.position = cloneVectorLikeValue(targetNode.position) ?? cloneVectorLikeValue(replacementRoot.position) ?? { x: 0, y: 0, z: 0 };
  replacementRoot.rotation = cloneVectorLikeValue(targetNode.rotation) ?? cloneVectorLikeValue(replacementRoot.rotation) ?? { x: 0, y: 0, z: 0 };
  if (typeof targetNode.visible === 'boolean') {
    replacementRoot.visible = targetNode.visible;
  }
  if (typeof targetNode.name === 'string' && targetNode.name.trim().length) {
    replacementRoot.name = targetNode.name;
  }
}



function resolveDefaultSteerBinding(
  document: SceneJsonExportDocument,
  defaultSteerIdentifier: string | null,
  targetType: SteerControllableTargetType,
): ResolvedSteerBinding | null {
  const stack: SceneNode[] = Array.isArray(document.nodes) ? [...document.nodes] : [];
  let fallback: ResolvedSteerBinding | null = null;
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    const steerComponent = resolveEnabledComponentState<SteerComponentProps>(node, STEER_COMPONENT_TYPE);
    if (steerComponent) {
      const steerProps = clampSteerComponentProps(steerComponent.props ?? null);
      if (steerProps.targetType === targetType && steerProps.targetNodeId && steerProps.autoEnterOnSceneLoad) {
        const binding: ResolvedSteerBinding = {
          steerNodeId: node.id,
          steerNode: node,
          steerComponent,
          steerProps,
          targetNodeId: steerProps.targetNodeId,
        };
        if (defaultSteerIdentifier && steerProps.defaultIdentifier === defaultSteerIdentifier) {
          return binding;
        }
        fallback ??= binding;
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return fallback;
}

function resolveDefaultSteerTargetType(): SteerControllableTargetType {
  const requested = props.defaultSteerTargetType;
  if (requested === 'vehicle' || requested === 'character' || requested === 'ship' || requested === 'aircraft') {
    return requested;
  }
  return 'vehicle';
}

function resolveSceneAutoEnterSteerBinding(document: SceneJsonExportDocument): ResolvedSteerBinding | null {
  const stack: SceneNode[] = Array.isArray(document.nodes) ? [...document.nodes] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const component = resolveEnabledComponentState<SteerComponentProps>(node, STEER_COMPONENT_TYPE);
    if (component) {
      const steerProps = clampSteerComponentProps(component.props ?? null);
      if (steerProps.autoEnterOnSceneLoad && steerProps.targetNodeId) {
        return { steerNodeId: node.id, steerNode: node, steerComponent: component, steerProps, targetNodeId: steerProps.targetNodeId };
      }
    }
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
  return null;
}

function resolveSelectedControllableAsset(targetType: SteerControllableTargetType): ExternalControllableAsset | null {
  return (props.controllableAssets ?? [])
    .filter((asset) => asset?.type === targetType && asset.isSelected === true)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0] ?? null;
}

function buildControllableAssetSpawnRequest(asset: ExternalControllableAsset): RuntimePrefabSpawnRequest | null {
  const prefabUrl = typeof asset.prefabUrl === 'string' ? asset.prefabUrl.trim() : '';
  const assetId = typeof asset.assetId === 'string' ? asset.assetId.trim() : '';
  if (!prefabUrl && !assetId) return null;
  return {
    requestId: `controllable-asset:${asset.id}`,
    controllableIdentifier: asset.identifier?.trim() || asset.id,
    controllableType: asset.type,
    assetUrl: prefabUrl || null,
    assetId: assetId || null,
    preloadPolicy: 'before-entry',
    initializationMode: 'full',
    placement: { alignment: 'origin', offset: null },
  };
}

function resolveDefaultCharacterSteerNodeId(
  document: SceneJsonExportDocument | null,
  defaultSteerIdentifier: string | null,
): string | null {
  if (!document) {
    return null;
  }
  const stack: SceneNode[] = Array.isArray(document.nodes) ? [...document.nodes] : [];
  let fallback: string | null = null;
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    const steerComponent = resolveEnabledComponentState<SteerComponentProps>(node, STEER_COMPONENT_TYPE);
    if (steerComponent) {
      const steerProps = clampSteerComponentProps(steerComponent.props ?? null);
      if (steerProps.targetType === 'character' && steerProps.targetNodeId && steerProps.autoEnterOnSceneLoad) {
        if (defaultSteerIdentifier && steerProps.defaultIdentifier === defaultSteerIdentifier) {
          return steerProps.targetNodeId;
        }
        fallback ??= steerProps.targetNodeId;
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return fallback;
}

function clearSteerBindingIndex(): void {
  steerBindingIndex.clear();
}

function syncSteerBindingIndexForNode(node: SceneNode | null | undefined): void {
  steerBindingIndex.syncNode(node);
}

function resolveSteerBindingByTargetNodeId(
  _document: SceneJsonExportDocument | null,
  targetNodeId: string | null,
) {
  return steerBindingIndex.resolveByTargetNodeId(targetNodeId);
}

function findMatchingSteerRuntimePrefabRequest(
  requests: RuntimePrefabSpawnRequest[] | undefined,
  vehicleIdentifier: string | null,
): RuntimePrefabSpawnRequest | null {
  if (!Array.isArray(requests) || !requests.length) {
    return null;
  }
  const normalized = requests
    .map((request) => normalizeRuntimePrefabRequest(request))
    .filter((request): request is RuntimePrefabSpawnRequest => Boolean(request));
  if (!normalized.length) {
    return null;
  }
  if (vehicleIdentifier) {
    const matched = normalized.find((request) => request.vehicleIdentifier === vehicleIdentifier || request.controllableIdentifier === vehicleIdentifier);
    if (matched) {
      return matched;
    }
  }
  return normalized.length === 1 ? normalized[0] : null;
}

function findRuntimePrefabRequestByVehicleNode(
  requests: RuntimePrefabSpawnRequest[] | undefined,
  targetNodeId: string | null,
  targetNodeName: string | null,
): RuntimePrefabSpawnRequest | null {
  if (!Array.isArray(requests) || !requests.length) {
    return null;
  }
  const normalizedTargetNodeId = typeof targetNodeId === 'string' ? targetNodeId.trim() : '';
  const normalizedTargetNodeName = typeof targetNodeName === 'string' ? targetNodeName.trim() : '';
  if (!normalizedTargetNodeId && !normalizedTargetNodeName) {
    return null;
  }
  const normalized = requests
    .map((request) => normalizeRuntimePrefabRequest(request))
    .filter((request): request is RuntimePrefabSpawnRequest => Boolean(request));
  if (!normalized.length) {
    return null;
  }
  if (normalizedTargetNodeId) {
    const matchedByNodeId = normalized.find((request) => request.targetNodeId === normalizedTargetNodeId);
    if (matchedByNodeId) {
      return matchedByNodeId;
    }
  }
  if (normalizedTargetNodeName) {
    const matchedByNodeName = normalized.find((request) => request.targetNodeName === normalizedTargetNodeName);
    if (matchedByNodeName) {
      return matchedByNodeName;
    }
  }
  return null;
}

function transferAutoTourComponentProps(sourceNode: SceneNode, targetNode: SceneNode): void {
  const sourceAutoTourComponent = sourceNode.components?.[AUTO_TOUR_COMPONENT_TYPE] ?? null;
  const targetAutoTourComponent = targetNode.components?.[AUTO_TOUR_COMPONENT_TYPE] ?? null;
  if (!sourceAutoTourComponent || !targetAutoTourComponent) {
    return;
  }
  targetAutoTourComponent.props = cloneAutoTourComponentProps(sourceAutoTourComponent.props);
  targetAutoTourComponent.enabled = sourceAutoTourComponent.enabled ?? targetAutoTourComponent.enabled;
}

async function prepareRenderPayloadForDefaultSteer(payload: ScenePreviewPayload): Promise<ScenePreviewPayload> {
  pendingDefaultSteerDriveEvent.value = null;
  const defaultSteerIdentifier = typeof props.defaultSteerIdentifier === 'string'
    ? props.defaultSteerIdentifier.trim() || null
    : null;
  const binding = props.controllableAssets?.length
    ? resolveSceneAutoEnterSteerBinding(payload.document)
    : resolveDefaultSteerBinding(payload.document, defaultSteerIdentifier, resolveDefaultSteerTargetType());
  if (!binding) {
    return payload;
  }

  let finalTargetNodeId = binding.targetNodeId;
  let nextPayload = payload;
  const selectedAsset = resolveSelectedControllableAsset(binding.steerProps.targetType);
  const matchedRequest = selectedAsset
    ? buildControllableAssetSpawnRequest(selectedAsset)
    : findMatchingSteerRuntimePrefabRequest(props.runtimePrefabSpawns, defaultSteerIdentifier);
  if (matchedRequest) {
    const source = await resolveRuntimePrefabSource(matchedRequest, runtimePrefabSourceResolverOptions);
    if (source) {
      const nextDocument = JSON.parse(JSON.stringify(payload.document));
      const documentNodeMap = new Map<string, SceneNode>();
      const documentParentMap = new Map<string, string | null>();
      rebuildSceneNodeIndex(nextDocument.nodes ?? null, documentNodeMap, documentParentMap);
      const targetNode = resolveSceneNodeById(documentNodeMap, binding.targetNodeId);
      const steerHostNode = resolveSceneNodeById(documentNodeMap, binding.steerNodeId);
      const steerHostComponent = steerHostNode
        ? resolveEnabledComponentState<SteerComponentProps>(steerHostNode, STEER_COMPONENT_TYPE)
        : null;
      if (targetNode && steerHostNode && steerHostComponent) {
        const cloned = cloneRuntimePrefabNode(source.prefab);
        applySteerTargetTransform(targetNode, cloned.root);
        const replacementTargetNodeId = findFirstSteerTargetNodeId(cloned.root, binding.steerProps.targetType) ?? findFirstVehicleNodeId(cloned.root) ?? cloned.root.id ?? null;
        if (replacementTargetNodeId && replaceSceneNodeById(nextDocument.nodes, targetNode.id, cloned.root)) {
          transferAutoTourComponentProps(targetNode, cloned.root);
          steerHostComponent.props = clampSteerComponentProps({
            ...(steerHostComponent.props ?? {}),
            targetNodeId: replacementTargetNodeId,
            defaultIdentifier: defaultSteerIdentifier ?? binding.steerProps.defaultIdentifier ?? null,
          });
          nextDocument.updatedAt = new Date().toISOString();
          finalTargetNodeId = replacementTargetNodeId;
          nextPayload = {
            ...payload,
            document: nextDocument,
          };
          appliedRuntimePrefabSpawnKeys.add(buildRuntimePrefabRequestKey(matchedRequest));
        }
      }
    }
  }

  if (finalTargetNodeId) {
    pendingDefaultSteerDriveEvent.value = buildFloatingAutoTourDriveEvent(finalTargetNodeId, null);
  }
  return nextPayload;
}

function clearSpawnedRuntimePrefabRoots(): void {
  const scene = renderContext?.scene ?? null;
  spawnedRuntimePrefabRoots.forEach(({ root }) => {
    if (scene) {
      scene.remove(root);
    }
    disposeObject(root);
  });
  spawnedRuntimePrefabRoots.clear();
}

async function spawnRuntimePrefabRequest(request: RuntimePrefabSpawnRequest): Promise<boolean> {
  const scene = renderContext?.scene ?? null;
  const document = currentDocument;
  if (!scene || !document) {
    return false;
  }

  const requestKey = buildRuntimePrefabRequestKey(request);
  const source = await resolveRuntimePrefabSource(request, runtimePrefabSourceResolverOptions);
  if (!source) {
    return false;
  }

  const { prefab } = source;
  const cloned = cloneRuntimePrefabNode(prefab);
  const wheelNodeIds = collectPrefabVehicleWheelNodeIds(prefab, cloned.idMap);
  const anchorTransform = applyRuntimePrefabTransform(cloned.root, request);
  const runtimeDocument = createRuntimePrefabDocument(prefab, cloned.root);
  const buildOptions: SceneGraphBuildOptions = {};
  if (typeof props.serverAssetBaseUrl === 'string' && props.serverAssetBaseUrl.trim().length) {
    buildOptions.serverAssetBaseUrl = props.serverAssetBaseUrl.trim();
  }
  const resourceCache = ensureResourceCache(runtimeDocument, buildOptions);
  const graph = await buildSceneGraph(runtimeDocument, resourceCache, buildOptions);
  graph.root.userData = {
    ...(graph.root.userData ?? {}),
    nodeId: cloned.root.id ?? request.assetId ?? null,
  };
  applyWeChatShadowPolicy(graph.root);
  applyRuntimePrefabPlacement(graph.root, request.placement, anchorTransform.position, sceneGraphRoot ?? scene);
  cloned.root.position = {
    x: graph.root.position.x,
    y: graph.root.position.y,
    z: graph.root.position.z,
  };

  scene.add(graph.root);
  spawnedRuntimePrefabRoots.set(requestKey, {
    root: graph.root,
    mode: normalizeRuntimePrefabMode(request.initializationMode),
    wheelNodeIds,
    nodeId: cloned.root.id ?? null,
  });

  if (normalizeRuntimePrefabMode(request.initializationMode) === 'full') {
    mergeRuntimePrefabAssetRegistry(document, runtimeDocument);
    document.nodes = [...(document.nodes ?? []), cloned.root];
    document.updatedAt = new Date().toISOString();
    rebuildPreviewNodeMap(document);
    viewerResourceCache = ensureResourceCache(document, buildOptions);
    registerSceneSubtree(graph.root);
    refreshMultiuserNodeReferences(document);
    refreshBehaviorProximityCandidates();
    if (source.prefab.physicsRelevant) {
      await syncPhysicsBodiesForDocument(document);
    }
  }

  return true;
}

let runtimePrefabControlSwitchInFlight = false;
const controlNodeSwitchBusy = ref(false);
type ControlNodeRestoreSnapshot = {
  targetType: SteerControllableTargetType;
  mainNodeId?: string;
  temporaryNodeId?: string | null;
  mainVisible?: boolean;
  componentEnabled?: Record<string, boolean | undefined>;
};
let latestControlNodeRestoreSnapshot: ControlNodeRestoreSnapshot | null = null;

function attachControlNodePrefabMetadata(node: SceneNode, prefabAssetId: string): void {
  node.userData = {
    ...(node.userData && typeof node.userData === 'object' ? node.userData : {}),
    __prefabAssetId: prefabAssetId,
  };
}

function removeSceneNodeById(nodes: SceneNode[] | null | undefined, nodeId: string): boolean {
  if (!Array.isArray(nodes)) return false;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    if (node.id === nodeId) { nodes.splice(index, 1); return true; }
    if (removeSceneNodeById(node.children, nodeId)) return true;
  }
  return false;
}


function setControlNodeComponentEnabled(node: SceneNode, enabled: boolean): Record<string, boolean | undefined> {
  const states: Record<string, boolean | undefined> = {};
  for (const type of [VEHICLE_COMPONENT_TYPE, CHARACTER_CONTROLLER_COMPONENT_TYPE, RIGIDBODY_COMPONENT_TYPE]) {
    const component = node.components?.[type] as { enabled?: boolean } | undefined;
    if (!component) continue;
    states[type] = component.enabled;
    component.enabled = enabled;
  }
  return states;
}

function restoreControlNodeComponentEnabled(node: SceneNode, states?: Record<string, boolean | undefined>): void {
  if (!states) return;
  for (const [type, enabled] of Object.entries(states)) {
    const component = node.components?.[type] as { enabled?: boolean } | undefined;
    if (component) component.enabled = enabled ?? true;
  }
}

async function restoreControlNodeRuntime(): Promise<boolean> {
  const snapshot = latestControlNodeRestoreSnapshot;
  if (!snapshot?.mainNodeId || !snapshot.temporaryNodeId || !currentDocument) return false;
  const mainNode = resolveNodeById(snapshot.mainNodeId);
  const temporaryObject = nodeObjectMap.get(snapshot.temporaryNodeId) ?? null;
  const mainObject = nodeObjectMap.get(snapshot.mainNodeId) ?? null;
  const binding = resolveSteerBindingByTargetNodeId(currentDocument, snapshot.temporaryNodeId);
  if (!mainNode || !temporaryObject || !mainObject || !binding) return false;
  const worldPosition = new THREE.Vector3(); const worldQuaternion = new THREE.Quaternion();
  temporaryObject.getWorldPosition(worldPosition); temporaryObject.getWorldQuaternion(worldQuaternion);
  if (vehicleDriveActive.value) {
    vehicleDriveController.stopDrive({ resolution: { type: 'abort', message: 'Control node restored.' }, preserveCamera: true }, renderContext ? { camera: renderContext.camera, mapControls: renderContext.controls } : { camera: null });
  }
  applyObjectWorldPose(mainObject, worldPosition, worldQuaternion);
  syncSceneNodeLocalTransformFromObject(mainNode, mainObject);
  mainObject.visible = snapshot.mainVisible !== false;
  restoreControlNodeComponentEnabled(mainNode, snapshot.componentEnabled);
  binding.steerComponent.props = clampSteerComponentProps({ ...binding.steerComponent.props, targetNodeId: snapshot.mainNodeId });
  syncSteerBindingIndexForNode(binding.steerNode);
  removeSceneNodeById(currentDocument.nodes, snapshot.temporaryNodeId);
  const temporaryObjectToRemove = nodeObjectMap.get(snapshot.temporaryNodeId) ?? null;
  temporaryObjectToRemove?.parent?.remove(temporaryObjectToRemove);
  nodeObjectMap.delete(snapshot.temporaryNodeId);
  releaseModelInstance(snapshot.temporaryNodeId);
  if (temporaryObjectToRemove) disposeObject(temporaryObjectToRemove);
  rebuildPreviewNodeMap(currentDocument);
  await syncPhysicsBodiesForDocument(currentDocument);
  if (renderContext?.scene) refreshAnimationControllers(renderContext.scene);
  refreshMultiuserNodeReferences(currentDocument);
  if (snapshot.targetType === 'character') {
    if (!vehicleDriveActive.value && characterControlUi.value.visible) updateCharacterFollowCamera(0, { immediate: true });
    refreshCharacterControllerAnimationRuntimeEntries(); refreshCharacterPathFollowRuntimeEntries();
  } else {
    const result = startVehicleDriveMode(buildFloatingAutoTourDriveEvent(snapshot.mainNodeId, null));
    if (!result.success) return false;
    vehicleDriveNodeId.value = snapshot.mainNodeId;
    vehicleDriveActive.value = true;
  }
  latestControlNodeRestoreSnapshot = null;
  return true;
}

async function switchControlNodeToAsset(targetType: SteerControllableTargetType, prefabAssetId?: string | null): Promise<boolean> {
  if (runtimePrefabControlSwitchInFlight || !currentDocument || !renderContext?.scene) return false;
  const assetId = typeof prefabAssetId === 'string' ? prefabAssetId.trim() : '';
  if (!assetId) return false;
  runtimePrefabControlSwitchInFlight = true;
  controlNodeSwitchBusy.value = true;
  resetCharacterControlInputs();
  resetVehicleDriveInputs();
  if (vehicleDriveActive.value) {
    vehicleDriveController.stopDrive(
      { resolution: { type: 'abort', message: 'Control node is initializing.' }, preserveCamera: true },
      { camera: renderContext?.camera ?? null, mapControls: renderContext?.controls },
    );
  }
  try {
    const existing = latestControlNodeRestoreSnapshot;
    const mainNodeId = existing?.mainNodeId ?? (vehicleDriveNodeId.value ?? resolveDefaultControlledCharacterNodeId() ?? resolveSceneAutoEnterSteerBinding(currentDocument)?.targetNodeId ?? null);
    const currentNodeId = existing?.temporaryNodeId ?? mainNodeId;
    if (!mainNodeId || !currentNodeId) return false;
    const mainNode = mainNodeId ? resolveNodeById(mainNodeId) : null;
    const currentObject = currentNodeId ? nodeObjectMap.get(currentNodeId) ?? null : null;
    if (!mainNode || !currentNodeId || !currentObject) return false;
    const binding = resolveSteerBindingByTargetNodeId(currentDocument, currentNodeId) ?? resolveSceneAutoEnterSteerBinding(currentDocument);
    if (!binding) return false;
    const request: RuntimePrefabSpawnRequest = { requestId: `control-node-switch:${Date.now().toString(36)}`, controllableIdentifier: binding.steerProps.defaultIdentifier ?? null, controllableType: targetType, assetId, assetUrl: null, targetNodeId: currentNodeId, targetNodeName: null, position: null, rotation: null, scale: null, initializationMode: 'full', placement: { alignment: 'origin', offset: null } };
    const source = await resolveRuntimePrefabSource(request, runtimePrefabSourceResolverOptions);
    if (!source) return false;
    const instanced = await instantiateRuntimePrefabControlSwitchInstanceFromPrefab(source.prefab, { buildOptions: () => (typeof props.serverAssetBaseUrl === 'string' && props.serverAssetBaseUrl.trim() ? { serverAssetBaseUrl: props.serverAssetBaseUrl.trim() } : {}), createResourceCache: ensureResourceCache, buildSceneGraph, prepareClonedRoot: (root) => { applyRuntimePrefabTransform(root, request); } });
    if (!instanced?.cloned.root.id) return false;
    const effectiveNode = instanced.cloned.root; const effectiveNodeId = effectiveNode.id;
    const isCharacter = targetType === 'character';
    if (isCharacter ? !resolveCharacterControllerComponent(effectiveNode) : !resolveVehicleComponent(effectiveNode)) return false;
    if (!existing) {
      latestControlNodeRestoreSnapshot = { targetType: binding.steerProps.targetType, mainNodeId, temporaryNodeId: effectiveNodeId, mainVisible: nodeObjectMap.get(mainNodeId)?.visible !== false, componentEnabled: setControlNodeComponentEnabled(mainNode, false) };
    } else if (existing.temporaryNodeId) {
      removeSceneNodeById(currentDocument.nodes, existing.temporaryNodeId);
      const oldObject = nodeObjectMap.get(existing.temporaryNodeId) ?? null;
      oldObject?.parent?.remove(oldObject);
      nodeObjectMap.delete(existing.temporaryNodeId);
      releaseModelInstance(existing.temporaryNodeId);
      if (oldObject) disposeObject(oldObject);
    }
    const mainObject = nodeObjectMap.get(mainNodeId) ?? null;
    if (mainObject) mainObject.visible = false;
    currentDocument.nodes = [...(currentDocument.nodes ?? []), effectiveNode];
    renderContext.scene.add(instanced.sceneRootObject); registerSceneSubtree(instanced.sceneRootObject); rebuildPreviewNodeMap(currentDocument);
    binding.steerComponent.props = clampSteerComponentProps({ ...binding.steerComponent.props, targetType, targetNodeId: effectiveNodeId });
    syncSteerBindingIndexForNode(binding.steerNode); attachControlNodePrefabMetadata(effectiveNode, assetId); latestControlNodeRestoreSnapshot!.temporaryNodeId = effectiveNodeId;
    await syncPhysicsBodiesForDocument(currentDocument);
    if (isCharacter) {
      resetCharacterControlInputs(); resetProtagonistPoseState(); binding.steerComponent.props = clampSteerComponentProps({ ...binding.steerComponent.props, targetType, targetNodeId: effectiveNodeId });
      syncSteerBindingIndexForNode(binding.steerNode); refreshCharacterControllerAnimationRuntimeEntries(); refreshCharacterPathFollowRuntimeEntries();
    } else {
      const result = startVehicleDriveMode(buildFloatingAutoTourDriveEvent(effectiveNodeId, null));
      if (!result.success) return false;
      vehicleDriveNodeId.value = effectiveNodeId; vehicleDriveActive.value = true;
    }
    refreshAnimationControllers(renderContext.scene); refreshMultiuserNodeReferences(currentDocument);
    return true;
  } catch (error) {
    console.warn('[SceneryViewer][RuntimePrefabSwitch] failed', error); return false;
  } finally {
    controlNodeSwitchBusy.value = false;
    runtimePrefabControlSwitchInFlight = false;
  }
}

async function flushPendingRuntimePrefabSpawnRequests(): Promise<void> {
  if (runtimePrefabFlushInFlight || !renderContext || !currentDocument) {
    return;
  }
  runtimePrefabFlushInFlight = true;
  try {
    while (pendingRuntimePrefabSpawnRequests.length) {
      const request = pendingRuntimePrefabSpawnRequests.shift();
      if (!request) {
        continue;
      }
      if (!shouldSpawnRuntimePrefabRequest(request)) {
        continue;
      }
      const key = buildRuntimePrefabRequestKey(request);
      if (appliedRuntimePrefabSpawnKeys.has(key)) {
        continue;
      }
      const spawned = await spawnRuntimePrefabRequest(request);
      if (spawned) {
        appliedRuntimePrefabSpawnKeys.add(key);
      }
    }
  } finally {
    runtimePrefabFlushInFlight = false;
  }
}

function queueRuntimePrefabSpawnRequest(request: RuntimePrefabSpawnRequest, options: { dedupe?: boolean } = {}): void {
  const normalized = normalizeRuntimePrefabRequest(request);
  if (!normalized) {
    return;
  }
  const key = buildRuntimePrefabRequestKey(normalized);
  const shouldDedupe = options.dedupe !== false;
  if (shouldDedupe) {
    if (appliedRuntimePrefabSpawnKeys.has(key)) {
      return;
    }
    if (pendingRuntimePrefabSpawnRequests.some((entry) => buildRuntimePrefabRequestKey(entry) === key)) {
      return;
    }
  }
  pendingRuntimePrefabSpawnRequests.push(normalized);
  void flushPendingRuntimePrefabSpawnRequests();
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
  infoBoardOverlayTitle.value = '展示板';
  infoBoardOverlayContent.value = '';
  infoBoardExpanded.value = false;
  resetInfoBoardAudio();
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
  infoBoardExpanded.value = false;
  {
    const title = typeof event.params.title === 'string' ? event.params.title.trim() : '';
    infoBoardOverlayTitle.value = title.length ? title : '展示板';
  }
  infoBoardOverlayContent.value = typeof event.params.content === 'string' ? event.params.content : '';

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
  disposeSignboardBillboards(renderContext?.scene ?? null);
  clearSteerBindingIndex();
  rebuildSceneNodeIndex(document?.nodes ?? null, previewNodeMap, previewParentMap);
  signboardNodeIds.clear();
  punchNodeIds.clear();
  punchTotalCount.value = 0;
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
    syncSteerBindingIndexForNode(node);
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

function resolveDefaultControlledCharacterNodeId(): string | null {
  const defaultSteerIdentifier = typeof props.defaultSteerIdentifier === 'string'
    ? props.defaultSteerIdentifier.trim() || null
    : null;
  return resolveDefaultCharacterSteerNodeId(currentDocument, defaultSteerIdentifier);
}

function resolveControlledCharacterMotionNodeId(): string | null {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  if (!controlledNodeId) {
    return null;
  }
  return resolveCharacterControllerBindingNodeId(controlledNodeId) ?? controlledNodeId;
}

function resolveDefaultControlledCharacterComponentProps(): CharacterControllerComponentProps | null {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  if (!controlledNodeId) {
    return null;
  }
  return clampCharacterControllerComponentProps(resolveCharacterControllerComponent(resolveNodeById(controlledNodeId))?.props ?? null);
}

function resolveAutoTourFollowCameraOffset(nodeId: string): THREE.Vector3 | null {
  const node = resolveNodeById(nodeId);
  if (!node) {
    return null;
  }
  const vehicleComponent = resolveVehicleComponent(node);
  if (vehicleComponent) {
    const props = clampVehicleComponentProps(vehicleComponent.props ?? null);
    return resolveBackFollowCameraLocalOffset(
      autoTourCameraFollowOffsetScratch,
      props.cameraFollowDistance,
      props.cameraFollowHeight,
    );
  }
  const characterComponent = resolveCharacterControllerComponent(node);
  if (characterComponent) {
    const props = clampCharacterControllerComponentProps(characterComponent.props ?? null);
    return resolveBackFollowCameraLocalOffset(
      autoTourCameraFollowOffsetScratch,
      props.cameraFollowDistance,
      props.cameraFollowHeight,
    );
  }
  return null;
}

function resolveCharacterFollowCameraOffset(props: CharacterControllerComponentProps): THREE.Vector3 {
  return resolveBackFollowCameraLocalOffset(
    characterCameraFollowOffsetScratch,
    props.cameraFollowDistance,
    props.cameraFollowHeight,
  );
}

function resolveCameraDistanceReferenceNodeId(): string | null {
  return resolveDefaultControlledCharacterNodeId();
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

function resolvePunchBadgeReference(
  activeCamera: THREE.Camera,
  snapshot: CameraFrameSnapshot | null = null,
): { position: THREE.Vector3; kind: 'camera' | 'vehicle'; nodeId: string | null } {
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

  if (snapshot) {
    signboardReferenceScratch.copy(snapshot.position);
  } else {
    activeCamera.getWorldPosition(signboardReferenceScratch);
  }
  return { position: signboardReferenceScratch, kind: 'camera', nodeId: resolveCameraDistanceReferenceNodeId() };
}

function updatePunchBadgeOverlayEntries(
  activeCamera: THREE.Camera,
  deltaSeconds: number,
  reference: { position: THREE.Vector3; kind: 'camera' | 'vehicle'; nodeId: string | null },
): void {
  if (!punchNodeIds.size) {
    if (punchBadgeOverlayEntries.value.length) {
      punchBadgeOverlayEntries.value = [];
    }
    resetPunchOverlaySmoothing();
    return;
  }

  nextPunchBadgeEntriesScratch.length = 0;
  activePunchBadgeNodeIdsScratch.clear();

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
    const distanceReferenceWorld = resolveOverlayDistanceReferenceWorld(nodeId, signboardAnchorScratch, reference);
    const placement = computeSignboardPlacement({
      anchorWorld: signboardAnchorScratch,
      referenceWorld: distanceReferenceWorld,
      camera: activeCamera,
      closeFadeDistance: SIGNBOARD_CLOSE_FADE_DISTANCE,
      minScreenYPercent: SIGNBOARD_MIN_SCREEN_Y_PERCENT,
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
      speed: DEFAULT_SIGNBOARD_PLACEMENT_SMOOTH_SPEED,
    });
    activePunchBadgeNodeIdsScratch.add(nodeId);
    nextPunchBadgeEntriesScratch.push({
      id: nodeId,
      xPercent: smoothedPlacement.xPercent,
      yPercent: smoothedPlacement.yPercent,
      scale: smoothedPlacement.scale,
      opacity: smoothedPlacement.opacity,
      referenceKind: reference.kind,
    });
  }

  for (const nodeId of punchBadgePlacementSmoothingStates.keys()) {
    if (!activePunchBadgeNodeIdsScratch.has(nodeId)) {
      punchBadgePlacementSmoothingStates.delete(nodeId);
    }
  }

  if (!arePunchBadgeEntriesEqual(nextPunchBadgeEntriesScratch, punchBadgeOverlayEntries.value)) {
    punchBadgeOverlayEntries.value = nextPunchBadgeEntriesScratch.map((entry) => ({ ...entry }));
  }
}

function resolveSceneSignboardLabel(nodeId: string): string {
  const node = resolveNodeById(nodeId);
  if (!node) {
    return nodeId
  }

  const signboardState = node.components?.[SIGNBOARD_COMPONENT_TYPE] as SceneNodeComponentState<SignboardComponentProps> | undefined;
  const label = typeof signboardState?.props?.label === 'string' ? signboardState.props.label : '';
  const nodeName = typeof node.name === 'string' ? node.name : '';
  return label.trim() || nodeName.trim() || nodeId;
}

function syncSceneSignboardsWithReference(
  distanceReference: { position: THREE.Vector3; kind: 'camera' | 'vehicle'; nodeId: string | null } | null,
): void {
  const renderCamera = renderContext?.camera ?? null;
  syncSignboardBillboards({
    scene: renderContext?.scene ?? null,
    camera: renderCamera,
    nodeObjectMap,
    signboardNodeIds,
    resolveLabel: resolveSceneSignboardLabel,
    isPunched: (nodeId: string) => punchedNodeIds.value.has(nodeId),
    appearance: SCENERY_SIGNBOARD_BILLBOARD_STYLE,
    distanceReferenceWorld: distanceReference?.position ?? null,
  });
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
  remoteMultiuserVisiblePeerLimit = resolveMultiuserVisiblePeerLimit(document);
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

function collectNetworkSyncNodeEntries(document: SceneJsonExportDocument | null): void {
  networkSyncNodeEntries.clear();
  if (!document?.nodes?.length) {
    return;
  }
  const stack: SceneNode[] = [...document.nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    const component = node.components?.[NETWORK_SYNC_COMPONENT_TYPE] as SceneNodeComponentState<NetworkSyncComponentProps> | undefined;
    if (component && component.enabled !== false) {
      networkSyncNodeEntries.set(node.id, {
        nodeId: node.id,
        props: clampNetworkSyncComponentProps(component.props),
        localRevision: 0,
        lastLocalSignature: '',
        ownerUserId: null,
        updatedAt: new Date(0).toISOString(),
      });
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
}

function collectPhysicsAuthorityNodeEntries(_document: SceneJsonExportDocument | null): void {}

function resolveNodeById(nodeId: string): SceneNode | null {
  return resolveSceneNodeById(previewNodeMap, nodeId);
}

function resolveViewPointPropsForNodeId(nodeId: string | null): ViewPointComponentProps | null {
  if (!nodeId) {
    return null;
  }
  const node = resolveNodeById(nodeId);
  if (!node) {
    return null;
  }
  return resolveViewPointComponentProps(
    (node.components?.[VIEW_POINT_COMPONENT_TYPE] as SceneNodeComponentState<ViewPointComponentProps> | undefined) ?? null,
  );
}

function resolveCharacterControllerComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<CharacterControllerComponentProps> | null {
  return resolveEnabledComponentState<CharacterControllerComponentProps>(node, CHARACTER_CONTROLLER_COMPONENT_TYPE);
}

function resolveGroundAnchorComponent(
  node: SceneNode | null | undefined,
): SceneNodeComponentState<Record<string, unknown>> | null {
  return resolveEnabledComponentState<Record<string, unknown>>(node, GROUND_ANCHOR_COMPONENT_TYPE);
}

function resolveCharacterControllerBindingNodeId(nodeId: string | null): string | null {
  if (!nodeId) {
    return null;
  }
  const props = clampCharacterControllerComponentProps(resolveCharacterControllerComponent(resolveNodeById(nodeId))?.props ?? null);
  return props.targetNodeId ?? nodeId;
}

function cloneMultiuserCharacterAnimationPresentation(
  animation: MultiuserCharacterAnimationPresentation | null | undefined,
): MultiuserCharacterAnimationPresentation | null {
  if (!animation) {
    return null;
  }
  return {
    clipName: animation.clipName,
    time: animation.time,
    duration: animation.duration,
    loop: animation.loop,
    timeScale: animation.timeScale,
    normalizedTime: animation.normalizedTime ?? null,
  };
}

function normalizeRemoteCharacterAction(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

function inferCharacterActionFromAnimation(
  animation: MultiuserCharacterAnimationPresentation | null | undefined,
): string | null {
  const clipName = typeof animation?.clipName === 'string' ? animation.clipName.trim().toLowerCase() : '';
  if (!clipName) {
    return null;
  }
  if (clipName.includes('interact') || clipName.includes('action') || clipName.includes('use')) {
    return 'interact';
  }
  if (clipName.includes('crouch')) {
    return 'crouch';
  }
  if (clipName.includes('jump') || clipName.includes('fall') || clipName.includes('land')) {
    return 'jump';
  }
  if (clipName.includes('sprint') || clipName.includes('run')) {
    return 'sprint';
  }
  if (clipName.includes('walk') || clipName.includes('move')) {
    return 'move';
  }
  if (clipName.includes('idle')) {
    return 'idle';
  }
  return null;
}

function resolveLocalCharacterPeerAction(nodeId: string): string {
  const input = resolveSceneryCharacterAnimationInput(nodeId);
  const animationAction = inferCharacterActionFromAnimation(resolveLocalMultiuserCharacterPresentation(nodeId)?.animation ?? null);
  if (input.interact) {
    return 'interact';
  }
  if (animationAction === 'interact') {
    return 'interact';
  }
  if (input.jump) {
    return 'jump';
  }
  if (animationAction === 'jump') {
    return 'jump';
  }
  if (input.crouch) {
    return 'crouch';
  }
  if (animationAction === 'crouch') {
    return 'crouch';
  }
  const hasMove = Math.abs(input.moveX) > 0.001 || Math.abs(input.moveZ) > 0.001;
  if ((input.sprint && hasMove) || animationAction === 'sprint') {
    return 'sprint';
  }
  if (hasMove || animationAction === 'move') {
    return 'move';
  }
  return 'idle';
}

function clearRemoteMultiuserCharacterStateForUser(userId: string): void {
  const previousNodeId = remoteMultiuserCharacterNodeIdByUserId.get(userId) ?? null;
  if (!previousNodeId) {
    return;
  }
  remoteMultiuserCharacterNodeIdByUserId.delete(userId);
  const current = remoteMultiuserCharacterStatesByNodeId.get(previousNodeId) ?? null;
  if (current?.userId === userId) {
    remoteMultiuserCharacterStatesByNodeId.delete(previousNodeId);
  }
}

function syncRemoteMultiuserCharacterState(peer: MultiuserPeerSnapshot): void {
  clearRemoteMultiuserCharacterStateForUser(peer.userId);
  if (peer.state?.subjectType !== 'character') {
    return;
  }
  const nodeId = typeof peer.state.subjectNodeId === 'string' ? peer.state.subjectNodeId.trim() : '';
  if (!nodeId) {
    return;
  }
  remoteMultiuserCharacterNodeIdByUserId.set(peer.userId, nodeId);
  remoteMultiuserCharacterStatesByNodeId.set(nodeId, {
    userId: peer.userId,
    nodeId,
    action: normalizeRemoteCharacterAction(peer.state.action)
      ?? inferCharacterActionFromAnimation(peer.state.presentation?.character?.animation ?? null),
    animation: cloneMultiuserCharacterAnimationPresentation(peer.state.presentation?.character?.animation ?? null),
  });
}

function resolveRemoteMultiuserCharacterState(nodeId: string): RemoteMultiuserCharacterState | null {
  return remoteMultiuserCharacterStatesByNodeId.get(nodeId) ?? null;
}

function resolveSceneryCharacterAnimationInput(nodeId: string): {
  moveX: number;
  moveZ: number;
  turn: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  interact: boolean;
  locallyControlled: boolean;
} {
  const pathFollowInput = characterAutoTourRuntime.getInput(nodeId);
  if (
    pathFollowInput
    && (
      Math.abs(pathFollowInput.moveX) > 0.001
      || Math.abs(pathFollowInput.moveZ) > 0.001
      || Math.abs(pathFollowInput.turn) > 0.001
      || pathFollowInput.jump
      || pathFollowInput.sprint
      || pathFollowInput.crouch
      || pathFollowInput.interact
    )
  ) {
    return {
      ...pathFollowInput,
      locallyControlled: false,
    };
  }
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  if (controlledNodeId === nodeId) {
    return {
      moveX: characterAuthorityInput.moveX,
      moveZ: characterAuthorityInput.moveZ,
      turn: characterAuthorityInput.turn,
      jump: characterAuthorityInput.jump,
      sprint: characterAuthorityInput.sprint,
      crouch: characterAuthorityInput.crouch,
      interact: characterAuthorityInput.interact,
      locallyControlled: true,
    };
  }
  const remotePeerState = resolveRemoteMultiuserCharacterState(nodeId);
  if (remotePeerState) {
    return resolveRemoteCharacterAnimationInput(nodeId, remotePeerState);
  }
  return {
    moveX: 0,
    moveZ: 0,
    turn: 0,
    jump: false,
    sprint: false,
    crouch: false,
    interact: false,
    locallyControlled: false,
  };
}

function resolveRemoteCharacterAnimationInput(
  _nodeId: string,
  remoteState: RemoteMultiuserCharacterState,
): {
  moveX: number;
  moveZ: number;
  turn: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  interact: boolean;
  locallyControlled: boolean;
} {
  const action = remoteState.action ?? inferCharacterActionFromAnimation(remoteState.animation);
  if (!action) {
    return {
      moveX: 0,
      moveZ: 0,
      turn: 0,
      jump: false,
      sprint: false,
      crouch: false,
      interact: false,
      locallyControlled: false,
    };
  }
  if (action === 'idle') {
    return {
      moveX: 0,
      moveZ: 0,
      turn: 0,
      jump: false,
      sprint: false,
      crouch: false,
      interact: false,
      locallyControlled: false,
    };
  }
  if (action === 'move' || action === 'sprint') {
    return {
      moveX: 0,
      moveZ: 1,
      turn: 0,
      jump: false,
      sprint: action === 'sprint',
      crouch: false,
      interact: false,
      locallyControlled: false,
    };
  }
  if (action === 'jump') {
    return {
      moveX: 0,
      moveZ: 0,
      turn: 0,
      jump: true,
      sprint: false,
      crouch: false,
      interact: false,
      locallyControlled: false,
    };
  }
  if (action === 'crouch') {
    return {
      moveX: 0,
      moveZ: 0,
      turn: 0,
      jump: false,
      sprint: false,
      crouch: true,
      interact: false,
      locallyControlled: false,
    };
  }
  if (action === 'interact') {
    return {
      moveX: 0,
      moveZ: 0,
      turn: 0,
      jump: false,
      sprint: false,
      crouch: false,
      interact: true,
      locallyControlled: false,
    };
  }
  return {
    moveX: 0,
    moveZ: 0,
    turn: 0,
    jump: false,
    sprint: false,
    crouch: false,
    interact: false,
    locallyControlled: false,
  };
}

function isCharacterControllerAnimationNode(nodeId: string): boolean {
  return characterControllerAnimationRuntime.has(nodeId);
}

function scheduleCharacterControllerAnimationResync(nodeId: string): void {
  characterControllerAnimationRuntime.scheduleResync(nodeId);
}

function acquireCharacterControllerBehaviorOverride(nodeId: string, token: string | null | undefined): void {
  characterControllerAnimationRuntime.acquireBehaviorOverride(nodeId, token);
}

function releaseCharacterControllerBehaviorOverride(token: string | null | undefined): void {
  characterControllerAnimationRuntime.releaseBehaviorOverride(token);
}

function refreshCharacterControllerAnimationRuntimeEntries(): void {
  characterControllerAnimationRuntime.refresh({
    nodeAnimationRuntime,
    iterNodes: () => previewNodeMap.entries(),
    resolveNode: (nodeId) => resolveNodeById(nodeId),
    resolveInput: (nodeId) => resolveSceneryCharacterAnimationInput(nodeId),
    resolveGroundContacts: (nodeId) => physicsBridgeContactsByNodeId.get(nodeId) ?? null,
  });
}

function refreshCharacterPathFollowRuntimeEntries(): void {
  characterAutoTourRuntime.refresh({
    iterNodes: () => previewNodeMap.entries(),
    resolveNode: (nodeId) => resolveNodeById(nodeId),
    nodeObjectMap,
    shouldApplyWorldTransform: (nodeId) => !physicsBridgeCharacterIdByNodeId.has(nodeId),
    onNodeObjectTransformUpdated: (_nodeId, object) => {
      syncInstancedTransform(object);
    },
  });
}

function updateCharacterControllerAnimations(deltaSeconds: number): void {
  if (deltaSeconds < 0) {
    return;
  }
  characterControllerAnimationRuntime.update({
    nodeAnimationRuntime,
    iterNodes: () => previewNodeMap.entries(),
    resolveNode: (nodeId) => resolveNodeById(nodeId),
    resolveInput: (nodeId) => resolveSceneryCharacterAnimationInput(nodeId),
    resolveGroundContacts: (nodeId) => physicsBridgeContactsByNodeId.get(nodeId) ?? null,
  }, getCharacterAnimationNowMs());
}

function updateCharacterPathFollow(deltaSeconds: number): void {
  if (deltaSeconds <= 0) {
    return;
  }
  characterAutoTourRuntime.update({
    iterNodes: () => previewNodeMap.entries(),
    resolveNode: (nodeId) => resolveNodeById(nodeId),
    nodeObjectMap,
    shouldApplyWorldTransform: (nodeId) => !physicsBridgeCharacterIdByNodeId.has(nodeId),
    onNodeObjectTransformUpdated: (_nodeId, object) => {
      syncInstancedTransform(object);
    },
  }, deltaSeconds);
}

type CouponNodeVisibilityEntry = {
  couponId: string;
  hideExpired: boolean;
  hideOwned: boolean;
  rawJson: string;
  spec: CouponComponentSpec;
};

function resolveCouponNodeEntry(node: SceneNode | null | undefined): CouponNodeVisibilityEntry | null {
  if (!node) {
    return null;
  }
  const component = node.components?.[COUPON_COMPONENT_TYPE] as SceneNodeComponentState<{
    couponJson?: unknown;
    hideExpired?: unknown;
    hideOwned?: unknown;
  }> | undefined;
  const rawJson = typeof component?.props?.couponJson === 'string' ? component.props.couponJson : '';
  const spec = parseCouponComponentSpec(rawJson);
  if (!spec) {
    return null;
  }
  return {
    couponId: spec.id,
    hideExpired: component?.props?.hideExpired === true,
    hideOwned: component?.props?.hideOwned === true,
    rawJson,
    spec,
  };
}

function collectCouponIdsFromDocument(document: SceneJsonExportDocument | null | undefined): string[] {
  if (!document) {
    return [];
  }
  const couponIds = new Set<string>();
  if (Array.isArray(document.couponIds)) {
    document.couponIds.forEach((value) => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (trimmed) {
        couponIds.add(trimmed);
      }
    });
  }
  const stack: SceneNode[] = Array.isArray(document.nodes) ? [...document.nodes] : [];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entry = resolveCouponNodeEntry(current);
    if (entry?.couponId) {
      couponIds.add(entry.couponId);
    }
    if (Array.isArray(current.children) && current.children.length) {
      stack.push(...current.children);
    }
  }
  return Array.from(couponIds);
}

function pruneCouponNodes(
  nodes: SceneNode[] | null | undefined,
  couponMap: Map<string, CouponSceneItem>,
): SceneNode[] {
  if (!Array.isArray(nodes) || !nodes.length) {
    return [];
  }
  const nextNodes: SceneNode[] = [];
  nodes.forEach((node) => {
    const entry = resolveCouponNodeEntry(node);
    if (entry) {
      const coupon = couponMap.get(entry.couponId) ?? null;
      const validUntil = entry.spec.validUntil ? new Date(entry.spec.validUntil) : null;
      const expired = coupon?.status === 'expired' || Boolean(validUntil && Number.isFinite(validUntil.getTime()) && validUntil.getTime() <= Date.now());
      const owned = Boolean(coupon?.owned);
      if ((entry.hideExpired && expired) || (entry.hideOwned && owned)) {
        return;
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      node.children = pruneCouponNodes(node.children, couponMap);
    }
    nextNodes.push(node);
  });
  return nextNodes;
}

async function prepareCouponSceneDocument(document: SceneJsonExportDocument): Promise<SceneJsonExportDocument> {
  const couponIds = collectCouponIdsFromDocument(document);
  if (!couponIds.length) {
    return document;
  }

  let couponMap = new Map<string, CouponSceneItem>();
  try {
    const coupons = await listCouponCatalog({ couponIds });
    const couponList = Array.isArray(coupons) ? coupons : [];
    couponMap = new Map(couponList.map((item) => [item.id, item]));
  } catch (error) {
    console.warn('[SceneryViewer] Failed to load coupon catalog for scene visibility', error);
  }

  if (!couponMap.size) {
    return document;
  }

  const nextDocument = JSON.parse(JSON.stringify(document));
  nextDocument.nodes = pruneCouponNodes(nextDocument.nodes, couponMap);
  nextDocument.couponIds = couponIds;
  return nextDocument;
}

function setVehicleDriveNodeVisibility(nodeId: string, visible: boolean): void {
  const object = nodeObjectMap.get(nodeId);
  if (object) {
    object.visible = visible;
    syncInstancedTransform(object);
  }
  const node = resolveNodeById(nodeId);
  if (node) {
    node.visible = visible;
  }
  updateBehaviorVisibility(nodeId, visible);
}

function restoreHiddenVehicleDriveNodes(): void {
  if (!hiddenVehicleDriveNodeIds.size) {
    return;
  }
  hiddenVehicleDriveNodeIds.forEach((nodeId) => {
    setVehicleDriveNodeVisibility(nodeId, true);
  });
  hiddenVehicleDriveNodeIds.clear();
}

function resolveDocumentGroundNode(document: SceneJsonExportDocument | null | undefined): SceneNode | null {
  return resolveSharedDocumentGroundNode(document);
}

function resolveCurrentGroundNode(): SceneNode | null {
  return resolveSharedDocumentGroundNode(currentDocument);
}

function attachScenePackageTerrainRuntime(
  pkg: ScenePackageUnzipped,
  sceneEntry: ScenePackageManifestSceneEntry,
  document: SceneJsonExportDocument,
): void {
  const groundNode = resolveDocumentGroundNode(document);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return;
  }
  const terrainManifest = readTerrainDatasetManifestFromScenePackage(pkg, sceneEntry);
  const terrainSampler = createTerrainDatasetHeightSamplerFromScenePackage(pkg, sceneEntry);
  const runtimeGround = groundNode.dynamicMesh as GroundRuntimeDynamicMesh & {
    runtimeTerrainDatasetManifest?: unknown;
    runtimeTerrainDatasetEnabled?: boolean;
    runtimeTerrainHeightSampler?: unknown;
  };
  runtimeGround.runtimeTerrainDatasetManifest = terrainManifest;
  runtimeGround.runtimeTerrainDatasetEnabled = Boolean(terrainSampler);
  runtimeGround.runtimeTerrainHeightSampler = terrainSampler;
}

function readCompiledGroundManifestFromScenePackage(
  pkg: ScenePackageUnzipped,
  sceneEntry: Pick<ScenePackageManifestSceneEntry, 'compiledGround'>,
): Parameters<typeof syncCompiledGroundRenderTiles>[0]['manifest'] | null {
  const manifestPath = typeof sceneEntry.compiledGround?.manifestPath === 'string'
    ? sceneEntry.compiledGround.manifestPath.trim()
    : '';
  if (!manifestPath) {
    return null;
  }
  const manifestBytes = pkg.files[manifestPath];
  if (!manifestBytes) {
    return null;
  }
  return deserializeCompiledGroundManifest(manifestBytes) as Parameters<
    typeof syncCompiledGroundRenderTiles
  >[0]['manifest'] | null;
}

function attachScenePackageCompiledGroundRuntime(
  compiledManifest: Parameters<typeof syncCompiledGroundRenderTiles>[0]['manifest'] | null,
  document: SceneJsonExportDocument,
): Parameters<typeof syncCompiledGroundRenderTiles>[0]['manifest'] | null {
  const groundNode = resolveDocumentGroundNode(document);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return null;
  }
  if (!compiledManifest || !Array.isArray(compiledManifest.renderTiles) || compiledManifest.renderTiles.length === 0) {
    return null;
  }
  const groundUserData = groundNode.userData && typeof groundNode.userData === 'object'
    ? (groundNode.userData as Record<string, unknown>)
    : {};
  groundUserData.compiledGroundEnabled = true;
  groundUserData.compiledGroundManifest = compiledManifest;
  groundNode.userData = groundUserData;
  return compiledManifest;
}

function refreshDynamicGroundCache(document: SceneJsonExportDocument | null): void {
  if (!document) {
    dynamicGroundCache = null;
    return;
  }
  const groundNode = resolveDocumentGroundNode(document);
  if (groundNode && isGroundDynamicMesh(groundNode.dynamicMesh)) {
    (groundNode.dynamicMesh as GroundRuntimeDynamicMesh & {
      groundSplatRuntimeProfile?: { maxLayers: number; enableLayerNormalMap: boolean };
    }).groundSplatRuntimeProfile = {
      maxLayers: 4,
      enableLayerNormalMap: true,
    };
    dynamicGroundCache = {
      nodeId: groundNode.id,
      node: groundNode,
      dynamicMesh: groundNode.dynamicMesh as GroundRuntimeDynamicMesh,
    };
  } else {
    dynamicGroundCache = null;
  }
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
  if (!canNodeUseRuntimeModelInstancing(node)) {
    releaseModelInstance(node.id);
    return null;
  }
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
): SceneryInstancedLodTarget | null {
  object.getWorldPosition(instancedCullingWorldPosition);
  const target = resolveInstancedLodTargetFromSnapshot({
    sourceAssetId: typeof node.sourceAssetId === 'string' ? node.sourceAssetId : null,
    instanceLayout: (node as unknown as { instanceLayout?: unknown }).instanceLayout,
    lodProps: ((node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined)?.enabled
      ? clampLodComponentProps((node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps>).props)
      : null),
    worldPosition: instancedCullingWorldPosition,
    cameraPosition: camera.position,
  })
  if (!target.assetId) {
    return target.sourceModelAssetId
      ? {
        kind: 'model',
        assetId: target.sourceModelAssetId,
        sourceModelAssetId: target.sourceModelAssetId,
        faceCamera: false,
        forwardAxis: LOD_FACE_CAMERA_FORWARD_AXIS_X,
        key: `model:${target.sourceModelAssetId}`,
      }
      : null
  }
  if (target.kind === 'billboard') {
    // Billboard: use node's bounding box for size if available, fallback to 1x1
    let width = 1, height = 1;
    const bounds = object.userData?.instancedBounds;
    if (bounds && bounds.min && bounds.max) {
      width = Math.abs(bounds.max[0] - bounds.min[0]);
      height = Math.abs(bounds.max[1] - bounds.min[1]);
    }
    return {
      kind: 'billboard',
      assetId: target.assetId,
      sourceModelAssetId: target.sourceModelAssetId,
      imageAssetId: target.assetId,
      width,
      height,
      faceCamera: target.faceCamera === true,
      forwardAxis: target.forwardAxis,
      key: `billboard:${target.assetId}`,
    };
  }
  return {
    kind: 'model',
    assetId: target.assetId,
    sourceModelAssetId: target.sourceModelAssetId,
    faceCamera: target.faceCamera === true,
    forwardAxis: target.forwardAxis,
    key: `model:${target.assetId}`,
  };
}

type SceneryInstancedLodTarget =
  | {
    kind: 'model';
    assetId: string;
    sourceModelAssetId: string | null;
    faceCamera: boolean;
    forwardAxis: InstancedLodTarget['forwardAxis'];
    key: string | null;
  }
  | {
    kind: 'billboard';
    assetId: string;
    sourceModelAssetId: string | null;
    imageAssetId: string;
    width: number;
    height: number;
    faceCamera: boolean;
    forwardAxis: InstancedLodTarget['forwardAxis'];
    key: string | null;
  };

function resolveSceneryInstancedLodTargetFromWorkerTarget(
  object: THREE.Object3D,
  target: InstancedLodTarget,
): SceneryInstancedLodTarget | null {
  if (target.kind === 'billboard') {
    let width = 1;
    let height = 1;
    const bounds = object.userData?.instancedBounds;
    if (bounds && bounds.min && bounds.max) {
      width = Math.abs((bounds.max[0] ?? 0) - (bounds.min[0] ?? 0));
      height = Math.abs((bounds.max[1] ?? 0) - (bounds.min[1] ?? 0));
    }
    if (!target.assetId) {
      return null;
    }
    return {
      kind: 'billboard',
      assetId: target.assetId,
      sourceModelAssetId: target.sourceModelAssetId,
      imageAssetId: target.assetId,
      width,
      height,
      faceCamera: target.faceCamera === true,
      forwardAxis: target.forwardAxis,
      key: target.key ?? `billboard:${target.assetId}`,
    };
  }

  if (!target.assetId) {
    return target.sourceModelAssetId
      ? {
        kind: 'model',
        assetId: target.sourceModelAssetId,
        sourceModelAssetId: target.sourceModelAssetId,
        faceCamera: false,
        forwardAxis: target.forwardAxis,
        key: `model:${target.sourceModelAssetId}`,
      }
      : null;
  }

  return {
    kind: 'model',
    assetId: target.assetId,
    sourceModelAssetId: target.sourceModelAssetId,
    faceCamera: target.faceCamera === true,
    forwardAxis: target.forwardAxis,
    key: target.key ?? `model:${target.assetId}`,
  };
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
function applyInstancedLodSwitch(nodeId: string, object: THREE.Object3D, target: SceneryInstancedLodTarget): void {
  if (!target) return;
  const node = resolveNodeById(nodeId);
  if (!canNodeUseRuntimeModelInstancing(node)) {
    releaseBillboardInstance(nodeId);
    releaseModelInstance(nodeId);
    return;
  }
  if (target.kind === 'model') {
    const assetId = target.assetId;
    const cached = getCachedModelObject(assetId);
    if (!cached) {
      void ensureModelObjectCached(assetId, node);
      return;
    }
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

type InstancedLodRuntimeEntry = {
  nodeId: string;
  object: THREE.Object3D;
  node: SceneNode;
  transformRevision: number;
  componentProps: LodComponentProps;
  sourceAssetId: string | null;
  instanceLayout: unknown;
  instancedBounds: InstancedLodBoundsSnapshot;
  radiusHint: number | null;
  lastVisible: boolean | null;
  appliedTargetKey: string | null;
  appliedTransformRevision: number;
  snapshot: InstancedLodCullingCandidateSnapshot;
};

const instancedLodRuntimeEntryCache = new Map<string, InstancedLodRuntimeEntry>();
let instancedLodRuntimeRevision = 0;
let instancedLodLastProcessedRevision = -1;
const instancedLodLastCameraProjectionMatrix = new Float32Array(16);
const instancedLodLastCameraMatrixWorldInverse = new Float32Array(16);
let instancedLodLastCameraStateValid = false;

function clearInstancedLodRuntimeEntryCacheForNode(nodeId: string): void {
  if (instancedLodRuntimeEntryCache.delete(nodeId)) {
    instancedLodRuntimeRevision += 1;
  }
}

function getInstancedTransformRevision(object: THREE.Object3D): number {
  const rawRevision = Number(object.userData?.__harmonyInstancedTransformRevision ?? 0);
  return Number.isFinite(rawRevision) ? Math.max(0, Math.trunc(rawRevision)) : 0;
}

function updateInstancedLodRuntimeEntryCacheForObject(object: THREE.Object3D): void {
  const nodeId = object.userData?.nodeId as string | undefined;
  if (!nodeId) {
    return;
  }

  if (!object.userData?.instancedAssetId && !object.userData?.billboardImageAssetId) {
    if (instancedLodRuntimeEntryCache.delete(nodeId)) {
      instancedLodRuntimeRevision += 1;
    }
    return;
  }

  const node = resolveNodeById(nodeId);
  if (!node) {
    instancedLodRuntimeEntryCache.delete(nodeId);
    return;
  }

  const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined;
  if (!component || !component.enabled) {
    instancedLodRuntimeEntryCache.delete(nodeId);
    return;
  }

  const props = clampLodComponentProps(component.props);
  const sourceAssetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId : null;
  const instanceLayout = (node as unknown as { instanceLayout?: unknown }).instanceLayout;
  const instancedBounds = (object.userData?.instancedBounds as InstancedLodBoundsSnapshot | undefined) ?? null;
  const radiusHint = typeof object.userData?.__harmonyInstancedRadius === 'number'
    && Number.isFinite(object.userData.__harmonyInstancedRadius)
    && object.userData.__harmonyInstancedRadius > 0
    ? object.userData.__harmonyInstancedRadius
    : null;
  const transformRevision = getInstancedTransformRevision(object);
  const existingEntry = instancedLodRuntimeEntryCache.get(nodeId) ?? null;
  if (
    existingEntry
    && existingEntry.object === object
    && existingEntry.node === node
    && existingEntry.transformRevision === transformRevision
    && existingEntry.componentProps === component.props
    && existingEntry.sourceAssetId === sourceAssetId
    && existingEntry.instanceLayout === instanceLayout
    && existingEntry.instancedBounds === instancedBounds
    && existingEntry.radiusHint === radiusHint
  ) {
    return;
  }

  object.updateWorldMatrix(true, false);
  instancedLodRuntimeEntryCache.set(nodeId, {
    nodeId,
    object,
    node,
    transformRevision,
    componentProps: component.props,
    sourceAssetId,
    instanceLayout,
    instancedBounds,
    radiusHint,
    lastVisible: null,
    appliedTargetKey: null,
    appliedTransformRevision: -1,
    snapshot: buildInstancedLodCullingCandidateSnapshot({
      nodeId,
      enableCulling: props.enableCulling !== false,
      matrixWorld: object.matrixWorld.elements,
      bounds: instancedBounds,
      radiusHint,
      sourceAssetId,
      instanceLayout,
      lodProps: props,
    }),
  });
  instancedLodRuntimeRevision += 1;
}

function collectInstancedLodRuntimeEntries(): InstancedLodRuntimeEntry[] {
  if (instancedLodRuntimeEntryCache.size === 0 && nodeObjectMap.size > 0) {
    nodeObjectMap.forEach((object) => {
      if (!object?.userData?.instancedAssetId && !object?.userData?.billboardImageAssetId) {
        return;
      }
      updateInstancedLodRuntimeEntryCacheForObject(object);
    });
  }

  const entries: InstancedLodRuntimeEntry[] = [];
  const staleNodeIds: string[] = [];

  instancedLodRuntimeEntryCache.forEach((entry, nodeId) => {
    const currentObject = nodeObjectMap.get(nodeId) ?? null;
    if (currentObject !== entry.object) {
      staleNodeIds.push(nodeId);
      return;
    }

    if (!entry.object?.userData?.instancedAssetId && !entry.object?.userData?.billboardImageAssetId) {
      staleNodeIds.push(nodeId);
      return;
    }

    const node = resolveNodeById(nodeId);
    if (!node) {
      staleNodeIds.push(nodeId);
      return;
    }

    const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined;
    if (!component || !component.enabled) {
      staleNodeIds.push(nodeId);
      return;
    }

    updateInstancedLodRuntimeEntryCacheForObject(currentObject);
    const refreshedEntry = instancedLodRuntimeEntryCache.get(nodeId) ?? null;
    if (refreshedEntry) {
      entries.push(refreshedEntry);
    }
  });

  staleNodeIds.forEach((nodeId) => {
    if (instancedLodRuntimeEntryCache.delete(nodeId)) {
      instancedLodRuntimeRevision += 1;
    }
  });

  entries.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return entries;
}

function areInstancedLodCameraMatricesUnchanged(camera: THREE.Camera): boolean {
  if (!instancedLodLastCameraStateValid) {
    return false;
  }
  const projectionMatrix = camera.projectionMatrix.elements;
  const matrixWorldInverse = camera.matrixWorldInverse.elements;
  for (let i = 0; i < 16; i += 1) {
    if (projectionMatrix[i] !== instancedLodLastCameraProjectionMatrix[i]) {
      return false;
    }
    if (matrixWorldInverse[i] !== instancedLodLastCameraMatrixWorldInverse[i]) {
      return false;
    }
  }
  return true;
}

function rememberInstancedLodCameraMatrices(camera: THREE.Camera): void {
  instancedLodLastCameraProjectionMatrix.set(camera.projectionMatrix.elements);
  instancedLodLastCameraMatrixWorldInverse.set(camera.matrixWorldInverse.elements);
  instancedLodLastCameraStateValid = true;
}

function buildInstancedLodCullingRequestForFrame(
  activeCamera: THREE.Camera,
  entries: InstancedLodRuntimeEntry[],
): InstancedLodCullingRequest {
  instancedLodCullingRequestId += 1;
  return buildInstancedLodCullingRequest({
    requestId: instancedLodCullingRequestId,
    cameraProjectionMatrix: activeCamera.projectionMatrix.elements,
    cameraMatrixWorldInverse: activeCamera.matrixWorldInverse.elements,
    cameraPosition: {
      x: activeCamera.position.x,
      y: activeCamera.position.y,
      z: activeCamera.position.z,
    },
    candidates: entries.map((entry, index) => ({
      index,
      enableCulling: entry.snapshot.enableCulling,
      worldPosition: entry.snapshot.worldPosition,
      radius: entry.snapshot.radius,
    })),
  });
}


// Enhanced: support both model and billboard LOD targets
function updateInstancedCullingAndLod(): void {
  const context = renderContext;
  if (!context) {
    return;
  }
  const now = Date.now();
  const camera = context.camera;

  if (
    instancedLodLastProcessedRevision === instancedLodRuntimeRevision
    && areInstancedLodCameraMatricesUnchanged(camera)
  ) {
    return;
  }

  const lodEntries = collectInstancedLodRuntimeEntries();
  const cullingRequest = buildInstancedLodCullingRequestForFrame(camera, lodEntries);
  const cullingResult: InstancedLodCullingResponse = dispatchInstancedLodCullingRequestWithCandidates(
    cullingRequest,
    lodEntries,
    instancedLodRuntimeRevision,
  );
  const visibleIndices = cullingResult.visibleIndices;
  const visibleCount = visibleIndices.length;
  let visibleCursor = 0;
  let targetCursor = 0;

  let lodVisibleCount = 0;
  lodEntries.forEach((entry, index) => {
    const { nodeId, object, node, snapshot } = entry;
    const cullingEnabled = snapshot.enableCulling;
    let isVisible = !cullingEnabled;
    if (cullingEnabled) {
      if (visibleCursor < visibleCount && visibleIndices[visibleCursor] === index) {
        isVisible = true;
        visibleCursor += 1;
      } else {
        isVisible = false;
      }
    }
    if (!isVisible && entry.lastVisible === false) {
      return;
    }
    if (cullingEnabled && !isVisible) {
      const lastSeen = instancedCullingLastVisibleAt.get(nodeId) ?? 0;
      if (INSTANCED_CULL_GRACE_MS > 0 && now - lastSeen < INSTANCED_CULL_GRACE_MS) {
        entry.lastVisible = isVisible;
        return;
      }
      releaseModelInstance(nodeId);
      if (object.userData?.billboardImageAssetId) {
        releaseBillboardInstance(nodeId);
      }
      entry.lastVisible = false;
      entry.appliedTargetKey = null;
      entry.appliedTransformRevision = -1;
      return;
    }

    lodVisibleCount += 1;
    entry.lastVisible = true;
    if (cullingEnabled) {
      instancedCullingLastVisibleAt.set(nodeId, now);
    }
    const workerTarget = targetCursor < cullingResult.targetKeys.length
      ? buildInstancedLodTargetFromParallelSnapshot({
        kind: cullingResult.targetKinds[targetCursor] ?? 0,
        assetId: cullingResult.targetAssetIds[targetCursor] ?? null,
        sourceModelAssetId: cullingResult.targetSourceModelAssetIds[targetCursor] ?? null,
        faceCamera: (cullingResult.targetFaceCameras[targetCursor] ?? 0) === 1,
        forwardAxis: cullingResult.targetForwardAxes[targetCursor] ?? null,
        key: cullingResult.targetKeys[targetCursor] ?? null,
      })
      : null;
    targetCursor += 1;
    const desiredTarget = workerTarget
      ? resolveSceneryInstancedLodTargetFromWorkerTarget(object, workerTarget) ?? resolveDesiredLodTarget(node, object, camera)
      : resolveDesiredLodTarget(node, object, camera);
    if (!desiredTarget) {
      return;
    }
    if (entry.lastVisible === true && entry.appliedTargetKey === desiredTarget.key && entry.appliedTransformRevision === entry.transformRevision) {
      return;
    }
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
      entry.appliedTargetKey = desiredTarget.key;
      entry.appliedTransformRevision = entry.transformRevision;
    } else if (desiredTarget.kind === 'billboard') {
      const currentImageAssetId = object.userData?.billboardImageAssetId as string | undefined;
      if (currentImageAssetId !== desiredTarget.imageAssetId) {
        applyInstancedLodSwitch(nodeId, object, desiredTarget);
        return;
      }
      object.userData.__harmonyLodFaceCamera = desiredTarget.faceCamera === true;
      syncInstancedTransform(object, true);
      entry.appliedTargetKey = desiredTarget.key;
      entry.appliedTransformRevision = entry.transformRevision;
    }
  });

  instancedLodLastProcessedRevision = instancedLodRuntimeRevision;
  rememberInstancedLodCameraMatrices(camera);

  if (debugEnabled.value && debugMode.value === 'full') {
    syncInstancingDebugCounters(lodEntries.length, lodVisibleCount, instancedMeshes, terrainScatterRuntime);
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
  const grouped = collectRuntimeModelNodesByAssetId(document.nodes ?? []);
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
  onProgress?: SceneSubsystemProgressReporter,
): Promise<void> {
  terrainScatterRuntime.dispose();
  markTerrainScatterUpdateDirty();
  if (!resourceCache) {
    return;
  }
  await terrainScatterRuntime.sync(document, resourceCache, resolveGroundMeshObject, {
    onProgress: (progress) => {
      onProgress?.({
        phase: 'syncingScatter',
        percent: progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0,
        detail: progress.detail || progress.label,
        currentIndex: progress.loaded,
        currentTotal: progress.total,
        currentLabel: progress.label,
      });
    },
  });
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
  resolveVehicleMotionTelemetry: (nodeId) => controlledNodeMotionRuntime.get(nodeId),
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
    markPhysicsBridgeBodyDirty(nodeId);
  },
});

const waterRuntime = createWaterRuntime();

function attachRuntimeForNode(nodeId: string, object: THREE.Object3D) {
  const nodeState = resolveNodeById(nodeId);
  if (!nodeState) {
    return;
  }
  const userData = object.userData ?? (object.userData = {});
  const snapshot = cloneProceduralCityHostSnapshot(nodeState.dynamicMesh);
  if (snapshot) {
    userData[PROCEDURAL_CITY_HOST_USER_DATA_KEY] = snapshot;
  } else {
    delete userData[PROCEDURAL_CITY_HOST_USER_DATA_KEY];
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

function markNestedInstancedProxyHints(root: THREE.Object3D): boolean {
  let hasNestedInstancedProxy = Boolean(root.userData?.instancedAssetId);
  root.children.forEach((child) => {
    if (markNestedInstancedProxyHints(child)) {
      hasNestedInstancedProxy = true;
    }
  });
  root.userData.__harmonyHasNestedInstancedProxy = hasNestedInstancedProxy;
  return hasNestedInstancedProxy;
}

function getNestedInstancedProxyTargets(root: THREE.Object3D): THREE.Object3D[] {
  const cached = root.userData?.__harmonyNestedInstancedProxyTargets as THREE.Object3D[] | undefined;
  if (Array.isArray(cached)) {
    return cached;
  }
  const targets: THREE.Object3D[] = [];
  root.traverse((child) => {
    if (child !== root && child.userData?.instancedAssetId) {
      targets.push(child);
    }
  });
  root.userData.__harmonyNestedInstancedProxyTargets = targets;
  return targets;
}

function registerSceneSubtree(root: THREE.Object3D): void {
  markNestedInstancedProxyHints(root);
  if (root.userData) {
    delete root.userData.__harmonyNestedInstancedProxyTargets;
  }
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
    attachRuntimeForNode(nodeId, object);

    syncInteractionLayersForNode(nodeId, object);

    const instancedAssetId = object.userData?.instancedAssetId as string | undefined;
    if (instancedAssetId) {
      ensureInstancedMeshesRegistered(instancedAssetId);
    }
    const nodeState = resolveNodeById(nodeId);
    syncSteerBindingIndexForNode(nodeState);
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

  });
  sceneCsmShadowRuntime?.registerObject(root);
}

function removeAirWalls(): void {
  // Air walls are authored into the bridge scene asset and no longer need a
  // duplicated legacy world sync path here.
}

function syncAirWallsForDocument(sceneDocument: SceneJsonExportDocument | null): void {
  removeAirWalls();
  void sceneDocument;
}

function clearLegacyPhysicsWorld(): void {
  clearVehicleDriveIntroState();
  vehicleInstances.clear();
  rigidbodyInstances.clear();
  scenePreviewPerf.reset();
  vehicleDriveActive.value = false;
  vehicleDriveNodeId.value = null;
  vehicleDriveToken.value = null;
  activeVehicleDriveEvent.value = null;
  pendingVehicleDriveEvent.value = null;
  vehicleDrivePromptBusy.value = false;
  vehicleDriveExitBusy.value = false;
  vehicleDriveResetBusy.value = false;
  resetVehicleDriveInputs();
  vehicleDriveCameraFollowState.initialized = false;
  deactivateJoystick(true);
  setVehicleDriveUiOverride('hide');
  hiddenVehicleDriveNodeIds.clear();
}

function resetPhysicsWorld(): void {
  void disposeSceneryPhysicsBridgeScene();
  physicsBridgeDirtyBodyNodeIds.clear();
  physicsBridgeBodyDirtyRevisionByNodeId.clear();
  physicsBridgePendingBodySyncRevisionByNodeId.clear();
  physicsBridgeLastFullBodySyncAtMs = 0;
  clearLegacyPhysicsWorld();
  sceneryGroundCollisionReferenceInitialized = false;
  sceneryGroundCollisionReferenceElapsed = 0;
}

function resolveSceneryPhysicsBridgePreference(
  settings: Pick<EnvironmentSettings, 'physicsEngine'> | null | undefined,
): PhysicsBackendPreference | undefined {
  const environmentPreference = settings?.physicsEngine;
  if (environmentPreference === 'ammo' || environmentPreference === 'cannon') {
    return environmentPreference;
  }

  const propPreference = props.physicsEngine;
  if (propPreference === 'ammo' || propPreference === 'cannon') {
    return propPreference;
  }

  if (environmentPreference === 'auto') {
    return 'auto';
  }

  return propPreference === 'auto' ? 'auto' : undefined;
}

async function prepareSceneryPhysicsBridgeForDocument(document: SceneJsonExportDocument): Promise<void> {
  const environmentSettings = resolveDocumentEnvironment(document);
  applyPhysicsEnvironmentSettings(environmentSettings);
  currentPhysicsBridgePreference = resolveSceneryPhysicsBridgePreference(environmentSettings);
  // void syncCannonDebugger();
  await ensureSceneryPhysicsBridgeReady();
}

function resolveSceneryCompiledGroundTileLoader(): ((record: { path: string }) => Promise<ArrayBuffer | null>) | undefined {
  return async (record) => {
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    if (!path) {
      console.warn('[SceneryCompiledGround] Missing compiled tile path', JSON.stringify({ record: String(record ?? '') }));
      return null;
    }
    const bundled = activeScenePackagePkg?.files?.[path];
    if (bundled) {
      return bundled.buffer.slice(bundled.byteOffset, bundled.byteOffset + bundled.byteLength);
    }
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
      const loaded = await requestBinaryFromUrl(path).catch(() => null);
      if (!loaded) {
        console.warn('[SceneryCompiledGround] Failed loading compiled tile from URL', JSON.stringify({ path }));
      }
      return loaded;
    }
    console.warn('[SceneryCompiledGround] Missing compiled tile bytes in scene package', JSON.stringify({ path }));
    return null;
  };
}

function resolveSceneryGroundCollisionReferenceWorld(
  camera: THREE.Camera | null | undefined,
  targetPositions: THREE.Vector3[],
): boolean {
  void camera;
  targetPositions.length = 0;
  targetPositions.push(...collectGroundAnchorWorldPositions({
    document: currentDocument,
    resolveObjectByNodeId: (nodeId) => nodeObjectMap.get(nodeId) ?? null,
  }));
  return targetPositions.length > 0;
}

function syncSceneryGroundCollisionReferencePositions(source: readonly THREE.Vector3[], target: THREE.Vector3[]): void {
  target.length = 0;
  source.forEach((position) => {
    target.push(position.clone());
  });
}

function shouldUpdateSceneryGroundCollisionForFrame(delta: number, referenceWorldPositions: readonly THREE.Vector3[]): boolean {
  sceneryGroundCollisionReferenceElapsed += Math.max(0, delta);
  if (!sceneryGroundCollisionReferenceInitialized) {
    sceneryGroundCollisionReferenceInitialized = true;
    sceneryGroundCollisionReferenceElapsed = 0;
    syncSceneryGroundCollisionReferencePositions(referenceWorldPositions, lastSceneryGroundCollisionReferencePositions);
    return true;
  }
  const moved = referenceWorldPositions.length !== lastSceneryGroundCollisionReferencePositions.length
    || referenceWorldPositions.some((position, index) => {
      const previous = lastSceneryGroundCollisionReferencePositions[index];
      return !previous || position.distanceToSquared(previous) > CAMERA_DEPENDENT_POSITION_EPSILON_SQ;
    });
  const due = sceneryGroundCollisionReferenceElapsed >= CAMERA_DEPENDENT_UPDATE_INTERVAL_SECONDS;
  if (!moved && !due) {
    return false;
  }
  sceneryGroundCollisionReferenceElapsed = 0;
  syncSceneryGroundCollisionReferencePositions(referenceWorldPositions, lastSceneryGroundCollisionReferencePositions);
  return true;
}

function enqueueSceneryGroundCollisionBridgeMutation(task: () => Promise<void>): void {
  const taskEpoch = sceneryGroundCollisionBridgeMutationEpoch;
  sceneryGroundCollisionBridgeMutationChain = sceneryGroundCollisionBridgeMutationChain
    .then(async () => {
      if (taskEpoch !== sceneryGroundCollisionBridgeMutationEpoch) {
        return;
      }
      await task();
    })
    .catch((error) => {
      console.warn('[SceneViewer] Ground collision bridge mutation failed', error);
    });
}

function resolveSceneryGroundCollisionRuntimeDeps(): NonNullable<
  Parameters<typeof syncGroundCollisionRuntimeHost>[0]['runtimeDeps']
> | null {
  return createGroundCollisionRuntimeBridgeDeps({
    enabled: physicsEnvironmentEnabled.value,
    sceneLoaded: physicsBridgeSceneLoaded && !physicsBridgeSceneReloading,
    getPhysicsBridge: () => physicsBridge,
    runtimeBodyIds: sceneryGroundCollisionRuntimeBodyIds,
    nextRuntimeId: nextSceneryGroundCollisionRuntimeId,
    enqueueMutation: enqueueSceneryGroundCollisionBridgeMutation,
    loggerTag: 'SceneryGroundCollision',
  });
}

function syncSceneryGroundCollisionRuntimeLoadedTileKeys(document: SceneJsonExportDocument | null, camera: THREE.Camera | null | undefined): boolean {
  if (!document) {
    return false;
  }
  const groundNode = resolveDocumentGroundNode(document);
  const groundMesh = groundNode?.dynamicMesh as GroundRuntimeDynamicMesh | null | undefined;
  if (!groundNode || !isGroundDynamicMesh(groundMesh)) {
    return false;
  }
  const groundObject = nodeObjectMap.get(groundNode.id) ?? null;
  if (!groundObject) {
    return false;
  }
  if (!camera || !physicsEnvironmentEnabled.value) {
    clearGroundCollisionRuntimeHost(groundObject);
    return false;
  }

  const groundUserData = groundNode.userData && typeof groundNode.userData === 'object'
    ? (groundNode.userData as Record<string, unknown>)
    : {};
  const compiledManifest = groundUserData.compiledGroundManifest as Parameters<typeof syncGroundCollisionRuntimeHost>[0]['compiledManifest'];
  if (!resolveSceneryGroundCollisionReferenceWorld(camera, sceneryGroundCollisionReferencePositions)) {
    clearGroundCollisionRuntimeHost(groundObject);
    return false;
  }
  const snapshot = syncGroundCollisionRuntimeHost({
    enabled: true,
    sourceId: groundNode.id,
    groundObject,
    groundMesh,
    referenceWorldPositions: sceneryGroundCollisionReferencePositions,
    compiledManifest,
    loadCompiledTileData: resolveSceneryCompiledGroundTileLoader(),
    runtimeDeps: resolveSceneryGroundCollisionRuntimeDeps(),
  });
  return syncGroundCollisionRuntimeLoadedTileKeys(groundObject, groundMesh, {
    compiledKeys: snapshot.compiledTileKeys,
    infiniteKeys: snapshot.infiniteChunkKeys,
  });
}

function resolveSceneObjectByNodeId(nodeId: string): THREE.Object3D | null {
  const normalized = typeof nodeId === 'string' ? nodeId.trim() : '';
  if (!normalized) {
    return null;
  }
  const direct = nodeObjectMap.get(normalized) ?? null;
  if (direct) {
    return direct;
  }
  if (!sceneGraphRoot) {
    return null;
  }
  let found: THREE.Object3D | null = null;
  sceneGraphRoot.traverse((object) => {
    if (found) {
      return;
    }
    const objectNodeId = object.userData?.nodeId as string | undefined;
    if (objectNodeId === normalized) {
      found = object;
    }
  });
  return found;
}

function clearSceneryCompiledGroundRenderRuntime(): void {
  lastCompiledGroundLoadedChunkVersion = -1;
  const groundNode = resolveCurrentGroundNode();
  const groundObject = groundNode ? resolveSceneObjectByNodeId(groundNode.id) : null;
  if (!groundObject) {
    return;
  }
  clearCompiledGroundRenderTiles(groundObject);
  setInfiniteGroundHiddenChunkKeys(groundObject, []);
}

function primeSceneryGroundChunkTextureRefresh(root: THREE.Object3D, definition: GroundDynamicMesh): void {
  refreshGroundChunkMaterials(root, definition);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData?.groundChunk) {
      return;
    }
    onGroundChunkTextureReady(object, () => {
      refreshGroundChunkMaterials(root, definition);
    });
  });
}

function syncSceneryCompiledGroundRenderTiles(camera: THREE.Camera | null | undefined): boolean {
  if (!currentDocument || !camera) {
    clearSceneryCompiledGroundRenderRuntime();
    return false;
  }
  const groundNode = resolveCurrentGroundNode();
  const groundMesh = groundNode?.dynamicMesh as GroundRuntimeDynamicMesh | null | undefined;
  if (!groundNode || !isGroundDynamicMesh(groundMesh)) {
    clearSceneryCompiledGroundRenderRuntime();
    return false;
  }
  const groundObject = resolveSceneObjectByNodeId(groundNode.id);
  if (!groundObject) {
    throw new Error(`无法找到 ground 对象: ${groundNode.id}`)
  }
  const compiledManifest = readCompiledGroundManifestFromDocument(currentDocument);
  const buildKey = activeScenePackageBuildKey?.trim() || '';
  if (!compiledManifest) {
    clearSceneryCompiledGroundRenderRuntime();
    return false;
  }
  if (!Array.isArray(compiledManifest.renderTiles) || compiledManifest.renderTiles.length === 0) {
    clearSceneryCompiledGroundRenderRuntime();
    return false;
  }
  if (!buildKey) {
    clearSceneryCompiledGroundRenderRuntime();
    return false;
  }
  if (!activeScenePackagePkg) {
    clearSceneryCompiledGroundRenderRuntime();
    return false;
  }
  const revision = Number.isFinite(Number(compiledManifest.revision))
    ? Math.max(0, Math.trunc(Number(compiledManifest.revision)))
    : 0;
  const workState = getCompiledGroundRenderWorkState(groundObject);
  syncCompiledGroundRenderTiles({
    groundObject,
    groundDefinition: groundMesh,
    camera,
    sourceId: buildKey,
    revision,
    manifest: compiledManifest,
    loadTileData: async (record) => {
      const bytes = activeScenePackagePkg?.files?.[record.path];
      if (!bytes) {
        return null;
      }
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    streamingMode: 'runtime-camera',
    groundSplatRuntimeProfile: {
      maxLayers: 4,
      enableLayerNormalMap: true,
    },
  });
  const nextWorkState = getCompiledGroundRenderWorkState(groundObject);
  if (!nextWorkState || nextWorkState.loadedChunkKeysVersion !== lastCompiledGroundLoadedChunkVersion) {
    setInfiniteGroundHiddenChunkKeys(groundObject, collectLoadedCompiledGroundChunkKeys(groundObject, compiledManifest));
    lastCompiledGroundLoadedChunkVersion = nextWorkState?.loadedChunkKeysVersion ?? -1;
  } else if (workState?.pendingLoads !== nextWorkState.pendingLoads) {
    setInfiniteGroundHiddenChunkKeys(groundObject, collectLoadedCompiledGroundChunkKeys(groundObject, compiledManifest));
  }
  return true;
}

async function ensureSceneryPhysicsBridgeReady(): Promise<PhysicsBridge> {
  if (physicsBridgeInitPromise) {
    return physicsBridgeInitPromise;
  }
  if (!physicsBridge) {
    if (!props.createPhysicsBridge) {
      throw new Error('No physics bridge factory available for scenery viewer');
    }
    physicsBridge = await props.createPhysicsBridge(currentPhysicsBridgePreference);
  }
  physicsBridgeInitPromise = physicsBridge.init({
    world: {
      gravity: [physicsGravity.x, physicsGravity.y, physicsGravity.z],
      fixedTimeStepMs: PHYSICS_FIXED_TIMESTEP * 1000,
      maxSubSteps: PHYSICS_MAX_SUB_STEPS,
    },
  }).then(() => physicsBridge!)
    .catch((error) => {
      physicsBridgeInitPromise = null;
      console.warn('[SceneViewer] Failed to initialize physics bridge', error);
    throw error;
  });
  return physicsBridgeInitPromise;
}

function updateSceneryPhysicsBridgeIndex(document: SceneJsonExportDocument, asset: PhysicsSceneAsset): void {
  physicsBridgeBodyIdByNodeId.clear();
  physicsBridgeNodeIdByBodyId.clear();
  physicsBridgeVehicleIdByNodeId.clear();
  physicsBridgeCharacterIdByNodeId.clear();
  physicsBridgeCharacterBodyNodeIdByControllerNodeId.clear();
  physicsBridgeCharacterControllerNodeIdByBodyNodeId.clear();
  physicsBridgeFrameBodiesByNodeId.clear();
  physicsBridgeContactsByNodeId.clear();
  physicsBridgeDirtyBodyNodeIds.clear();
  physicsBridgeBodyDirtyRevisionByNodeId.clear();
  physicsBridgePendingBodySyncRevisionByNodeId.clear();
  physicsBridgeLastFullBodySyncAtMs = 0;
  asset.bodies.forEach((body) => {
    if (!body.userDataKey) {
      return;
    }
    physicsBridgeBodyIdByNodeId.set(body.userDataKey, body.id);
    physicsBridgeNodeIdByBodyId.set(body.id, body.userDataKey);
  });
  asset.vehicles.forEach((vehicle) => {
    const nodeId = physicsBridgeNodeIdByBodyId.get(vehicle.bodyId);
    if (!nodeId) {
      return;
    }
    physicsBridgeVehicleIdByNodeId.set(nodeId, vehicle.id);
  });
  asset.characters.forEach((character) => {
    const bodyNodeId = physicsBridgeNodeIdByBodyId.get(character.bodyId);
    if (!bodyNodeId) {
      return;
    }
    physicsBridgeCharacterControllerNodeIdByBodyNodeId.set(bodyNodeId, bodyNodeId);
    physicsBridgeCharacterBodyNodeIdByControllerNodeId.set(bodyNodeId, bodyNodeId);
    physicsBridgeCharacterIdByNodeId.set(bodyNodeId, character.characterId);
  });
  const stack: SceneNode[] = Array.isArray(document.nodes) ? [...document.nodes] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    const component = resolveCharacterControllerComponent(node);
    if (component) {
      const bodyNodeId = node.id;
      const characterId = physicsBridgeCharacterIdByNodeId.get(bodyNodeId);
      if (typeof characterId === 'number') {
        physicsBridgeCharacterIdByNodeId.set(node.id, characterId);
        physicsBridgeCharacterBodyNodeIdByControllerNodeId.set(node.id, bodyNodeId);
        physicsBridgeCharacterControllerNodeIdByBodyNodeId.set(bodyNodeId, node.id);
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  vehicleInstances.forEach((instance, nodeId) => {
    if (instance.source !== 'bridge') {
      return;
    }
    instance.bridgeBodyId = physicsBridgeBodyIdByNodeId.get(nodeId) ?? null;
    instance.vehicleId = physicsBridgeVehicleIdByNodeId.get(nodeId) ?? null;
  });
}

async function loadSceneryPhysicsBridgeScene(
  document: SceneJsonExportDocument | null,
  onProgress?: SceneSubsystemProgressReporter,
): Promise<void> {
  if (!document) {
    await disposeSceneryPhysicsBridgeScene();
    return;
  }
  if (!physicsEnvironmentEnabled.value || !resolveDocumentPhysicsRelevance(document)) {
    await disposeSceneryPhysicsBridgeScene();
    return;
  }
  try {
    currentPhysicsBridgePreference = resolveSceneryPhysicsBridgePreference(resolveDocumentEnvironment(document));
    // void syncCannonDebugger();
    const requestId = ++physicsBridgeSceneRequestId;
    physicsBridgeSceneReloading = true;
    const asset = await buildPhysicsSceneAsset(document, {
      onProgress: (progress) => {
        onProgress?.({
          phase: 'syncingPhysics',
          percent: progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0,
          detail: progress.detail || progress.label,
          currentIndex: progress.loaded,
          currentTotal: progress.total,
          currentLabel: progress.label,
        });
      },
    });
    if (
      asset.shapes.length === 0
      && asset.bodies.length === 0
      && asset.vehicles.length === 0
      && !hasGroundAnchorSceneNodes(document.nodes)
    ) {
      await disposeSceneryPhysicsBridgeScene();
      return;
    }
    const bridge = physicsBridge;
    if (!bridge) {
      throw new Error('Scenery physics bridge is not ready');
    }
    sceneryGroundCollisionRuntimeBodyIds.clear();
    await bridge.loadScene(asset);
    if (requestId !== physicsBridgeSceneRequestId) {
      return;
    }
    updateSceneryPhysicsBridgeIndex(document, asset);
    physicsBridgeSceneLoaded = true;
    physicsBridgeSceneReloading = false;
    const groundNode = resolveDocumentGroundNode(document);
    const groundObject = groundNode ? (nodeObjectMap.get(groundNode.id) ?? null) : null;
    if (groundObject && isGroundDynamicMesh(groundNode?.dynamicMesh)) {
      sceneryGroundCollisionBridgeMutationEpoch += 1;
      clearGroundCollisionRuntimeHost(groundObject);
      syncSceneryGroundCollisionRuntimeLoadedTileKeys(document, renderContext?.camera ?? null);
    }
  } catch (error) {
    console.warn('[SceneViewer] Failed to load physics bridge scene', error);
  } finally {
    physicsBridgeSceneReloading = false;
  }
}

function syncSceneryBridgeVehicleFromFrame(nodeId: string, state: PhysicsBridgeBodyFrameState): void {
  // 根据节点 ID 找到对应的车辆实例；如果不存在，或者该车辆不是由 physics bridge 驱动，则直接返回。
  const instance = vehicleInstances.get(nodeId);
  if (!instance || instance.source !== 'bridge') {
    return;
  }
  // 车辆底盘刚体，用于同步位置、旋转和速度等物理状态。
  const chassisBody = instance.vehicle.chassisBody;
  const bridgeVelocity = state.linearVelocity ?? null;
  // 记录上一次 bridge 帧中的位置；若还没有采样过，则先创建一个临时向量。
  if (bridgeVelocity) {
    // 优先使用 bridge 帧里携带的线速度，避免过密采样时把仍在运动的车误写成 0。
    if (!isPhysicsVectorClose(chassisBody.velocity, bridgeVelocity.x, bridgeVelocity.y, bridgeVelocity.z)) {
      chassisBody.velocity.set(bridgeVelocity.x, bridgeVelocity.y, bridgeVelocity.z);
    }
  }
  // bridge 驱动的车辆通常由外部状态直接控制，这里将角速度清零，避免物理引擎继续积累自旋。
  if (!isPhysicsVectorClose(chassisBody.angularVelocity, 0, 0, 0)) {
    chassisBody.angularVelocity.set(0, 0, 0);
  }
  // 如果当前刚体的位置或四元数与 bridge 帧不一致，则同步到最新的世界变换。
  if (!isPhysicsTransformClose(chassisBody.position, chassisBody.quaternion, state)) {
    chassisBody.position.set(state.position.x, state.position.y, state.position.z);
    chassisBody.quaternion.x = state.quaternion.x;
    chassisBody.quaternion.y = state.quaternion.y;
    chassisBody.quaternion.z = state.quaternion.z;
    chassisBody.quaternion.w = state.quaternion.w;
  }
  // 标记已经至少接收到一帧 bridge 数据，后续即可使用差分计算速度。
  instance.hasBridgeFrameSample = true;
}

function consumeSceneryPhysicsBridgeStepFrame(frame: PhysicsStepFrame): void {
  const nextContactsByNodeId = new Map<string, PhysicsContactEvent[]>();
  const addContact = (bodyId: number, contact: PhysicsContactEvent): void => {
    const nodeId = physicsBridgeNodeIdByBodyId.get(bodyId);
    if (!nodeId) {
      return;
    }
    const contacts = nextContactsByNodeId.get(nodeId) ?? [];
    contacts.push(contact);
    nextContactsByNodeId.set(nodeId, contacts);
  };

  if (frame.bodyCount > 0 && frame.bodyMeta?.length) {
    for (let index = 0; index < frame.bodyCount; index += 1) {
      const bodyId = frame.bodyMeta[index];
      const nodeId = typeof bodyId === 'number' ? physicsBridgeNodeIdByBodyId.get(bodyId) : null;
      if (nodeId) {
        nextContactsByNodeId.set(nodeId, []);
      }
    }
  }
  if (Array.isArray(frame.contacts) && frame.contacts.length) {
    frame.contacts.forEach((contact) => {
      addContact(contact.bodyIdA, contact);
      addContact(contact.bodyIdB, contact);
    });
  }
  physicsBridgeContactsByNodeId.clear();
  nextContactsByNodeId.forEach((contacts, nodeId) => {
    physicsBridgeContactsByNodeId.set(nodeId, contacts);
  });
  if (
    frame.bodyCount <= 0
    || frame.bodyTransforms.length === 0
    || frame.bodyTransforms.length < frame.bodyCount * 8
  ) {
    return;
  }
  for (let index = 0; index < frame.bodyCount; index += 1) {
    const bodyId = frame.bodyMeta?.[index];
    const nodeId = typeof bodyId === 'number' ? physicsBridgeNodeIdByBodyId.get(bodyId) : null;
    if (!nodeId) {
      continue;
    }

    const base = index * 8;
    const nextPosition = new THREE.Vector3(
      frame.bodyTransforms[base] ?? 0,
      frame.bodyTransforms[base + 1] ?? 0,
      frame.bodyTransforms[base + 2] ?? 0,
    );
    const nextQuaternion = new THREE.Quaternion(
      frame.bodyTransforms[base + 3] ?? 0,
      frame.bodyTransforms[base + 4] ?? 0,
      frame.bodyTransforms[base + 5] ?? 0,
      frame.bodyTransforms[base + 6] ?? 1,
    ).normalize();
    const nextMotionState = frame.bodyTransforms[base + 7] ?? 0;
    const nextLinearVelocity = frame.bodyLinearVelocities && frame.bodyLinearVelocities.length >= base + 3
      ? new THREE.Vector3(
        frame.bodyLinearVelocities[base] ?? 0,
        frame.bodyLinearVelocities[base + 1] ?? 0,
        frame.bodyLinearVelocities[base + 2] ?? 0,
      )
      : undefined;

    let existing = physicsBridgeFrameBodiesByNodeId.get(nodeId);
    if (existing) {
      existing.position.copy(nextPosition);
      existing.quaternion.copy(nextQuaternion);
      existing.motionState = nextMotionState;
      existing.linearVelocity = nextLinearVelocity;
    } else {
      existing  = {
        position: nextPosition,
        quaternion: nextQuaternion,
        motionState: nextMotionState,
      };
      if (nextLinearVelocity) {
        existing.linearVelocity = nextLinearVelocity;
      }
      physicsBridgeFrameBodiesByNodeId.set(nodeId, existing);
    }
    syncSceneryBridgeVehicleFromFrame(nodeId, existing);
  }

  applySceneryPhysicsBridgeFrameToObjects();
}

function applySceneryPhysicsBridgeFrameToObjects(): void {
  if (!physicsBridgeFrameBodiesByNodeId.size) {
    return;
  }
  physicsBridgeFrameUpdatedParents = new WeakSet<THREE.Object3D>();
  physicsBridgeFrameBodiesByNodeId.forEach((state, nodeId) => {
    const rigidbodyEntry = rigidbodyInstances.get(nodeId);
    if (rigidbodyEntry) {
      if (rigidbodyEntry.bindingKind === 'character') {
        if (rigidbodyEntry.syncObjectFromBody === false || !rigidbodyEntry.object) {
          return;
        }
        if (moveToRuntimeSession.active && moveToRuntimeSession.subjectNodeId === nodeId) {
        }
        applySceneryPhysicsBridgeTransformToObject(
          rigidbodyEntry.object,
          state.position,
          state.quaternion,
          rigidbodyEntry.orientationAdjustment,
        );
        return;
      }
      if (rigidbodyEntry.syncObjectFromBody === false || !rigidbodyEntry.object) {
        return;
      }
      if (moveToRuntimeSession.active && moveToRuntimeSession.subjectNodeId === nodeId) {
      }
      applySceneryPhysicsBridgeTransformToObject(
        rigidbodyEntry.object,
        state.position,
        state.quaternion,
        rigidbodyEntry.orientationAdjustment,
      );
      return;
    }
    const characterControllerNodeId = physicsBridgeCharacterControllerNodeIdByBodyNodeId.get(nodeId) ?? null;
    const node = resolveNodeById(nodeId);
    const rigidbodyComponent = resolvePhysicsRigidbodyComponent(node);
    const bindingObject = node && rigidbodyComponent
      ? resolveRigidbodyBindingObject(
        rigidbodyComponent,
        nodeObjectMap.get(nodeId) ?? null,
      )
      : (characterControllerNodeId ? (nodeObjectMap.get(characterControllerNodeId) ?? null) : (physicsBridgeCharacterIdByNodeId.has(nodeId) ? (nodeObjectMap.get(nodeId) ?? null) : null));
    if (!bindingObject) {
      return;
    }
    if (moveToRuntimeSession.active && moveToRuntimeSession.subjectNodeId === nodeId) {
    }
    const orientationAdjustment = node && isGroundDynamicMesh(node.dynamicMesh)
      ? {
        three: physicsBridgeHeightfieldAdjustment,
        threeInverse: physicsBridgeHeightfieldAdjustmentInverse,
      }
      : null;
    applySceneryPhysicsBridgeTransformToObject(bindingObject, state.position, state.quaternion, orientationAdjustment);
  });
}

function ensurePhysicsBridgeParentWorldMatrix(parent: THREE.Object3D | null): void {
  if (!parent || physicsBridgeFrameUpdatedParents.has(parent)) {
    return;
  }
  parent.updateWorldMatrix(true, false);
  physicsBridgeFrameUpdatedParents.add(parent);
}

function shouldSyncInstancedTransform(object: THREE.Object3D): boolean {
  return Boolean(object.userData?.instancedAssetId || object.userData?.__harmonyHasNestedInstancedProxy === true);
}

function applySceneryPhysicsBridgeTransformToObject(
  object: THREE.Object3D,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
  orientationAdjustment: RigidbodyOrientationAdjustment | null,
): void {
  physicsBridgeSyncPositionHelper.copy(worldPosition);
  physicsBridgeSyncQuaternionHelper.copy(worldQuaternion);
  if (orientationAdjustment) {
    physicsBridgeSyncQuaternionHelper.multiply(orientationAdjustment.threeInverse);
  }
  if (object.parent) {
    ensurePhysicsBridgeParentWorldMatrix(object.parent);
    object.position.copy(physicsBridgeSyncPositionHelper);
    object.parent.worldToLocal(object.position);
    object.parent.getWorldQuaternion(physicsBridgeSyncParentQuaternionHelper).invert();
    object.quaternion.copy(physicsBridgeSyncParentQuaternionHelper).multiply(physicsBridgeSyncQuaternionHelper);
  } else {
    object.position.copy(physicsBridgeSyncPositionHelper);
    object.quaternion.copy(physicsBridgeSyncQuaternionHelper);
  }
  object.updateWorldMatrix(false, true);
  if (shouldSyncInstancedTransform(object)) {
    syncInstancedTransform(object, false, true);
  }
}

const VEHICLE_BRIDGE_SYNC_POSITION_EPSILON_SQ = 1e-8;
const VEHICLE_BRIDGE_SYNC_QUATERNION_DOT_THRESHOLD = 1 - 1e-6;
const VEHICLE_BRIDGE_SYNC_VELOCITY_EPSILON_SQ = 1e-6;

function isPhysicsVectorClose(
  current: { x: number; y: number; z: number },
  nextX: number,
  nextY: number,
  nextZ: number,
  epsilonSq = VEHICLE_BRIDGE_SYNC_VELOCITY_EPSILON_SQ,
): boolean {
  const dx = current.x - nextX;
  const dy = current.y - nextY;
  const dz = current.z - nextZ;
  return ((dx * dx) + (dy * dy) + (dz * dz)) <= epsilonSq;
}

function isPhysicsTransformClose(
  currentPosition: { x: number; y: number; z: number },
  currentQuaternion: { x: number; y: number; z: number; w: number },
  frameState: PhysicsBridgeBodyFrameState | null | undefined,
): boolean {
  if (!frameState) {
    return false;
  }
  const dx = currentPosition.x - frameState.position.x;
  const dy = currentPosition.y - frameState.position.y;
  const dz = currentPosition.z - frameState.position.z;
  if ((dx * dx) + (dy * dy) + (dz * dz) > VEHICLE_BRIDGE_SYNC_POSITION_EPSILON_SQ) {
    return false;
  }

  const currentQuaternionLengthSq =
    (currentQuaternion.x * currentQuaternion.x)
    + (currentQuaternion.y * currentQuaternion.y)
    + (currentQuaternion.z * currentQuaternion.z)
    + (currentQuaternion.w * currentQuaternion.w);
  const frameQuaternionLengthSq =
    (frameState.quaternion.x * frameState.quaternion.x)
    + (frameState.quaternion.y * frameState.quaternion.y)
    + (frameState.quaternion.z * frameState.quaternion.z)
    + (frameState.quaternion.w * frameState.quaternion.w);
  if (currentQuaternionLengthSq <= 0 || frameQuaternionLengthSq <= 0) {
    return false;
  }

  const normalizedDot =
    Math.abs(
      (
        (currentQuaternion.x * frameState.quaternion.x)
        + (currentQuaternion.y * frameState.quaternion.y)
        + (currentQuaternion.z * frameState.quaternion.z)
        + (currentQuaternion.w * frameState.quaternion.w)
      ) / Math.sqrt(currentQuaternionLengthSq * frameQuaternionLengthSq),
    );
  return normalizedDot >= VEHICLE_BRIDGE_SYNC_QUATERNION_DOT_THRESHOLD;
}

function stepSceneryPhysicsBridge(delta: number): void {
  if (
    delta <= 0
    || !physicsEnvironmentEnabled.value
    || !physicsBridge
    || !physicsBridgeSceneLoaded
    || physicsBridgeStepPromise
  ) {
    return;
  }
  // Bridge worker requests are processed strictly in-order, but if a local body
  // mutation is still waiting on an earlier `setBodyTransform` flush, stepping
  // again here can advance the remote world before that mutation has landed.
  // Hold the step for one frame in that narrow case so teleports/stops snap in
  // before the next simulation advance.
  if (physicsBridgeBodySyncPromise && physicsBridgePendingBodySyncRevisionByNodeId.size > 0) {
    return;
  }
  const bridge = physicsBridge;
  physicsBridgeStepPromise = bridge.step(delta * 1000)
    .then((frame) => {
      if (bridge !== physicsBridge) {
        return;
      }
      consumeSceneryPhysicsBridgeStepFrame(frame);
    })
    .catch((error) => {
      console.warn('[SceneViewer] Failed to step physics bridge', error);
    })
    .finally(() => {
      physicsBridgeStepPromise = null;
    });
}

function syncSceneryPhysicsBridgeBodyTransforms(): void {
  if (
    !physicsBridge
    || !physicsBridgeSceneLoaded
    || physicsBridgeBodySyncPromise
    || !physicsBridgeBodyIdByNodeId.size
  ) {
    return;
  }
  const bridge = physicsBridge;
  const commands: Array<Promise<void>> = [];
  const syncedBodyRevisions = new Map<string, number>();
  const nowMs = Date.now();
  const shouldRunFullSync =
    physicsBridgeLastFullBodySyncAtMs <= 0
    || nowMs - physicsBridgeLastFullBodySyncAtMs >= PHYSICS_BRIDGE_FULL_BODY_SYNC_INTERVAL_MS;
  const candidateNodeIds = shouldRunFullSync
    ? Array.from(physicsBridgeBodyIdByNodeId.keys())
    : Array.from(physicsBridgeDirtyBodyNodeIds);
  if (shouldRunFullSync) {
    physicsBridgeLastFullBodySyncAtMs = nowMs;
  }
  candidateNodeIds.forEach((nodeId) => {
    const bodyId = physicsBridgeBodyIdByNodeId.get(nodeId);
    if (typeof bodyId !== 'number') {
      physicsBridgeDirtyBodyNodeIds.delete(nodeId);
      physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
      physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
      return;
    }
    const entry = rigidbodyInstances.get(nodeId) ?? null;
    if (entry) {
      if (entry.bindingKind === 'character') {
        const frameState = physicsBridgeFrameBodiesByNodeId.get(nodeId);
        if (!frameState || !entry.object) {
          physicsBridgeDirtyBodyNodeIds.delete(nodeId);
          physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
          physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
          return;
        }
        if (moveToRuntimeSession.active && moveToRuntimeSession.subjectNodeId === nodeId) {
        }
        applySceneryPhysicsBridgeTransformToObject(
          entry.object,
          frameState.position,
          frameState.quaternion,
          entry.orientationAdjustment,
        );
        physicsBridgeDirtyBodyNodeIds.delete(nodeId);
        physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
        physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
        return;
      }
      if (!entry.body) {
        physicsBridgeDirtyBodyNodeIds.delete(nodeId);
        physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
        physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
        return;
      }
      if (entry.body.type === LEGACY_STATIC_BODY_TYPE) {
        physicsBridgeDirtyBodyNodeIds.delete(nodeId);
        physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
        physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
        entry.bridgeSyncDirty = false;
        return;
      }
      const frameState = physicsBridgeFrameBodiesByNodeId.get(nodeId);
      if (moveToRuntimeSession.active && moveToRuntimeSession.subjectNodeId === nodeId) {
      }
      if (isPhysicsTransformClose(entry.body.position, entry.body.quaternion, frameState)) {
        physicsBridgeDirtyBodyNodeIds.delete(nodeId);
        physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
        physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
        entry.bridgeSyncDirty = false;
        return;
      }
      commands.push(
        bridge.setBodyTransform({
          bodyId,
          transform: {
            position: [entry.body.position.x, entry.body.position.y, entry.body.position.z],
            rotation: [entry.body.quaternion.x, entry.body.quaternion.y, entry.body.quaternion.z, entry.body.quaternion.w],
          },
        }),
      );
      const dirtyRevision = physicsBridgeBodyDirtyRevisionByNodeId.get(nodeId) ?? 0;
      physicsBridgePendingBodySyncRevisionByNodeId.set(nodeId, dirtyRevision);
      syncedBodyRevisions.set(nodeId, dirtyRevision);
      return;
    }
    const node = resolveNodeById(nodeId);
    const component = resolvePhysicsRigidbodyComponent(node);
    if (!node || !component || component.props.bodyType === 'STATIC') {
      physicsBridgeDirtyBodyNodeIds.delete(nodeId);
      physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
      physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
      return;
    }
    const object = resolveRigidbodyBindingObject(component, nodeObjectMap.get(nodeId) ?? null);
    if (!object) {
      return;
    }
    object.updateWorldMatrix(true, false);
    object.getWorldPosition(physicsBridgeBodySyncPositionHelper);
    object.getWorldQuaternion(physicsBridgeBodySyncQuaternionHelper).normalize();
    const frameState = physicsBridgeFrameBodiesByNodeId.get(nodeId);
    if (moveToRuntimeSession.active && moveToRuntimeSession.subjectNodeId === nodeId) {
    }
    if (isPhysicsTransformClose(physicsBridgeBodySyncPositionHelper, physicsBridgeBodySyncQuaternionHelper, frameState)) {
      physicsBridgeDirtyBodyNodeIds.delete(nodeId);
      physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
      physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
      return;
    }
    commands.push(
      bridge.setBodyTransform({
        bodyId,
        transform: {
          position: [
            physicsBridgeBodySyncPositionHelper.x,
            physicsBridgeBodySyncPositionHelper.y,
            physicsBridgeBodySyncPositionHelper.z,
          ],
          rotation: [
            physicsBridgeBodySyncQuaternionHelper.x,
            physicsBridgeBodySyncQuaternionHelper.y,
            physicsBridgeBodySyncQuaternionHelper.z,
            physicsBridgeBodySyncQuaternionHelper.w,
          ],
        },
      }),
    );
    const dirtyRevision = physicsBridgeBodyDirtyRevisionByNodeId.get(nodeId) ?? 0;
    physicsBridgePendingBodySyncRevisionByNodeId.set(nodeId, dirtyRevision);
    syncedBodyRevisions.set(nodeId, dirtyRevision);
  });
  if (!commands.length) {
    return;
  }
  physicsBridgeBodySyncPromise = Promise.allSettled(commands)
    .catch(() => {
      // Promise.allSettled should not reject, keep a guard anyway.
    })
    .then(() => undefined)
    .finally(() => {
      syncedBodyRevisions.forEach((queuedRevision, nodeId) => {
        physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
        if ((physicsBridgeBodyDirtyRevisionByNodeId.get(nodeId) ?? 0) !== queuedRevision) {
          return;
        }
        physicsBridgeDirtyBodyNodeIds.delete(nodeId);
        physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
        const entry = rigidbodyInstances.get(nodeId);
        if (entry) {
          entry.bridgeSyncDirty = false;
        }
      });
      physicsBridgeBodySyncPromise = null;
    });
}

function resolveSceneryPhysicsBridgeVehicleStopTransform(
  nodeId: string,
): PhysicsTransform | null {
  const frameState = physicsBridgeFrameBodiesByNodeId.get(nodeId);
  if (frameState) {
    return {
      position: [frameState.position.x, frameState.position.y, frameState.position.z],
      rotation: [frameState.quaternion.x, frameState.quaternion.y, frameState.quaternion.z, frameState.quaternion.w],
    };
  }
  const instance = vehicleInstances.get(nodeId);
  const chassisBody = instance?.vehicle.chassisBody ?? null;
  if (chassisBody) {
    return {
      position: [chassisBody.position.x, chassisBody.position.y, chassisBody.position.z],
      rotation: [
        chassisBody.quaternion.x,
        chassisBody.quaternion.y,
        chassisBody.quaternion.z,
        chassisBody.quaternion.w,
      ],
    };
  }
  const node = resolveNodeById(nodeId);
  const component = resolvePhysicsRigidbodyComponent(node);
  const object = node && component
    ? resolveRigidbodyBindingObject(component, nodeObjectMap.get(nodeId) ?? null)
    : nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return null;
  }
  object.updateWorldMatrix(true, false);
  object.getWorldPosition(physicsBridgeBodySyncPositionHelper);
  object.getWorldQuaternion(physicsBridgeBodySyncQuaternionHelper).normalize();
  return {
    position: [
      physicsBridgeBodySyncPositionHelper.x,
      physicsBridgeBodySyncPositionHelper.y,
      physicsBridgeBodySyncPositionHelper.z,
    ],
    rotation: [
      physicsBridgeBodySyncQuaternionHelper.x,
      physicsBridgeBodySyncQuaternionHelper.y,
      physicsBridgeBodySyncQuaternionHelper.z,
      physicsBridgeBodySyncQuaternionHelper.w,
    ],
  };
}

function resetSceneryPhysicsBridgeVehicleLocalState(nodeId: string, transform: PhysicsTransform): void {
  const instance = vehicleInstances.get(nodeId);
  if (!instance) {
    return;
  }
  const chassisBody = instance.vehicle.chassisBody ?? null;
  if (!chassisBody) {
    return;
  }
  chassisBody.velocity.set(0, 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  instance.hasBridgeFrameSample = false;
  instance.lastChassisPosition.set(...transform.position);
  instance.hasChassisPositionSample = false;
}

function resolveSceneryPhysicsBridgeVehicleControlInput(nodeId: string): PhysicsBridgeVehicleControlInput | null {
  // 根据节点ID从车辆实例映射表中获取对应的车辆实例
  const instance = vehicleInstances.get(nodeId) ?? null;
  if (!instance) {
    // 未找到实例，返回 null
    return null;
  }

  // 通过节点ID解析场景节点，并获取其车辆组件及属性
  const node = resolveNodeById(nodeId);
  const vehicleComponent = resolveVehicleComponent(node);
  // 对车辆属性进行范围限制，确保数值合法
  const vehicleProps = clampVehicleComponentProps(vehicleComponent?.props ?? null);

  // 获取车轮信息列表，若不是数组则回退为空数组
  const wheelInfos = Array.isArray(instance.vehicle.wheelInfos) ? instance.vehicle.wheelInfos : [];
  if (!wheelInfos.length) {
    // 没有车轮信息，无法计算控制输入，返回 null
    return null;
  }
  const targetSpeedMps = Number.isFinite(instance.vehicle.autoTourTargetSpeedMps)
    ? Math.max(0, instance.vehicle.autoTourTargetSpeedMps)
    : 0;
  const targetSteeringRad = Number.isFinite(instance.vehicle.autoTourTargetSteeringRad)
    ? instance.vehicle.autoTourTargetSteeringRad
    : 0;
  const chassisBody = instance.vehicle.chassisBody ?? null;
  const velocity = chassisBody?.velocity ?? null;
  const quaternion = chassisBody?.quaternion ?? null;
  const maxSpeedMps = Number.isFinite(vehicleProps.maxSpeedKmh) && vehicleProps.maxSpeedKmh > 0
    ? vehicleProps.maxSpeedKmh / 3.6
    : Number.POSITIVE_INFINITY;
  const maxSteerRad = THREE.MathUtils.degToRad(26);

  let forwardSpeed = 0;
  if (velocity && quaternion && instance.axisForward) {
    tempForwardVec.copy(instance.axisForward);
    if (tempForwardVec.lengthSq() > 1e-8) {
      tempForwardVec.normalize().applyQuaternion(quaternion);
      forwardSpeed = velocity.x * tempForwardVec.x + velocity.y * tempForwardVec.y + velocity.z * tempForwardVec.z;
    }
  }

  // 目标速度为零时直接进入制动保持，避免物理后端把极小油门误判成持续前进。
  if (targetSpeedMps <= 0.02) {
    return {
      steering: THREE.MathUtils.clamp(targetSteeringRad / maxSteerRad, -1, 1),
      throttle: 0,
      brake: 1,
    };
  }

  const speedError = targetSpeedMps - Math.max(0, forwardSpeed);
  const speedReference = Number.isFinite(maxSpeedMps) && maxSpeedMps > 0 ? maxSpeedMps : Math.max(1, targetSpeedMps);
  const speedDeadband = Math.max(0.05, targetSpeedMps * 0.12);
  const cruiseThrottle = THREE.MathUtils.clamp(targetSpeedMps / speedReference, 0.02, 1);
  const accelThrottle = speedError > speedDeadband
    ? THREE.MathUtils.clamp(speedError / speedReference, 0.02, 1)
    : 0;
  const brakeInput = speedError < -speedDeadband
    ? THREE.MathUtils.clamp((-speedError) / speedReference, 0.02, 0.5)
    : 0;
  const maintainThrottle = THREE.MathUtils.clamp(Math.max(cruiseThrottle, accelThrottle), 0.02, 0.35);
  return {
    steering: THREE.MathUtils.clamp(targetSteeringRad / maxSteerRad, -1, 1),
    throttle: brakeInput > 0 ? 0 : maintainThrottle,
    brake: brakeInput,
  };
}

function setSceneryAutoTourVehicleDesiredControl(
  vehicleInstance: VehicleDriveVehicle | null | undefined,
  control: { targetSpeedMps: number; steeringRad: number },
): void {
  const vehicle = vehicleInstance ?? null;
  if (!vehicle) {
    return;
  }
  vehicle.autoTourTargetSpeedMps = Number.isFinite(control.targetSpeedMps) ? Math.max(0, control.targetSpeedMps) : 0;
  vehicle.autoTourTargetSteeringRad = Number.isFinite(control.steeringRad) ? control.steeringRad : 0;
}

function resolveSceneryPhysicsBridgeAutoTourNodeId(): string | null {
  if (!activeAutoTourNodeIds.size) {
    return null;
  }
  const preferred = autoTourFollowNodeId.value ?? null;
  if (preferred && activeAutoTourNodeIds.has(preferred)) {
    return preferred;
  }
  return activeAutoTourNodeIds.values().next().value ?? null;
}

function syncSceneryPhysicsBridgeVehicleInput(): void {
  const manualDriveNodeId = vehicleDriveActive.value ? vehicleDriveNodeId.value : null;
  const autoTourNodeId = !manualDriveNodeId ? resolveSceneryPhysicsBridgeAutoTourNodeId() : null;
  const autoTourControlledNodeId = manualDriveNodeId && activeAutoTourNodeIds.has(manualDriveNodeId)
    ? manualDriveNodeId
    : autoTourNodeId;
  const bridgeActiveNodeId = autoTourControlledNodeId ?? manualDriveNodeId;
  const resolvedAutoTourInput = autoTourControlledNodeId
    ? resolveSceneryPhysicsBridgeVehicleControlInput(autoTourControlledNodeId)
    : null
  const bridgeInput: PhysicsBridgeVehicleControlInput = autoTourControlledNodeId
    ? resolvedAutoTourInput ?? {
        steering: 0,
        throttle: 0,
        brake: 1,
      }
    : manualDriveNodeId
      ? {
          steering: vehicleDriveInput.steering,
          throttle: vehicleDriveInput.throttle,
          brake: vehicleDriveInput.brake,
        }
      : {
          steering: 0,
          throttle: 0,
          brake: 0,
        };


  syncPhysicsBridgeVehicleInput({
    state: physicsBridgeVehicleInputSyncState,
    bridge: physicsBridge,
    sceneLoaded: physicsBridgeSceneLoaded,
    activeNodeId: bridgeActiveNodeId,
    vehicleIdByNodeId: physicsBridgeVehicleIdByNodeId,
    input: bridgeInput,
    resolveBodyId: (nodeId) => physicsBridgeBodyIdByNodeId.get(nodeId),
    resolveStopTransform: resolveSceneryPhysicsBridgeVehicleStopTransform,
    resetLocalVehicleState: resetSceneryPhysicsBridgeVehicleLocalState,
    warningPrefix: '[SceneViewer]',
  });
}

function resolveSceneryCharacterInputYaw(): number | null {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  const hasTurnInput = Math.abs(characterAuthorityInput.turn) > 0.001;
  resetSceneryCharacterInputYawStateIfNeeded(controlledNodeId);
  ensureSceneryCharacterInputYawInitialized();
  if (hasTurnInput) {
    const props = clampCharacterControllerComponentProps(
      resolveCharacterControllerComponent(resolveNodeById(controlledNodeId ?? ''))?.props ?? null,
    );
    const turnRateRadiansPerSecond = THREE.MathUtils.degToRad(props.turnRateDegreesPerSecond);
    characterInputYaw += turnRateRadiansPerSecond * characterAuthorityInput.turn * characterControlDeltaSeconds;
    characterInputYaw = normalizeSceneryCharacterInputYaw(characterInputYaw);
    return characterInputYaw;
  }

  if (Math.abs(characterAuthorityInput.moveZ) > CHARACTER_EFFECTIVE_MOVEMENT_THRESHOLD) {
    return characterInputYaw;
  }

  return null;
}

function resetSceneryCharacterInputYawStateIfNeeded(controlledNodeId: string | null): void {
  if (characterInputYawNodeId === controlledNodeId) {
    return;
  }
  characterInputYawNodeId = controlledNodeId;
  characterInputYawInitialized = false;
}

function ensureSceneryCharacterInputYawInitialized(): void {
  if (characterInputYawInitialized) {
    return;
  }
  characterInputYaw = resolveSceneryCharacterInputYawSeed();
  characterInputYawInitialized = true;
}

function normalizeSceneryCharacterInputYaw(value: number): number {
  return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI;
}

function resolveSceneryCharacterInputYawSeed(): number {
  const stableYaw = resolveSceneryControlledCharacterStableYaw();
  if (typeof stableYaw === 'number') {
    return stableYaw;
  }
  if (Number.isFinite(characterInputYaw)) {
    return characterInputYaw;
  }
  return Math.PI;
}

function resolveSceneryControlledCharacterStableYaw(): number | null {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  if (!controlledNodeId) {
    return null;
  }
  const forwardAxis = resolveControlledCharacterMotionForwardAxis(characterControlYawForwardScratch);
  const bodyNodeId = physicsBridgeCharacterBodyNodeIdByControllerNodeId.get(controlledNodeId) ?? controlledNodeId;
  const physicsFrameState = physicsBridgeFrameBodiesByNodeId.get(bodyNodeId) ?? null;
  const physicsYaw = resolveSceneryCharacterYawFromQuaternion(physicsFrameState?.quaternion ?? null, forwardAxis);
  if (typeof physicsYaw === 'number') {
    return physicsYaw;
  }
  const controlledObject = findDefaultControlledCharacterObject();
  if (!controlledObject) {
    return null;
  }
  controlledObject.getWorldQuaternion(protagonistPoseQuaternion);
  return resolveSceneryCharacterYawFromQuaternion(protagonistPoseQuaternion, forwardAxis);
}

function resolveSceneryCharacterYawFromQuaternion(
  quaternion: THREE.Quaternion | null | undefined,
  forwardAxis: THREE.Vector3,
): number | null {
  if (!quaternion) {
    return null;
  }
  tempYawForwardVec.copy(forwardAxis);
  tempYawForwardVec.applyQuaternion(quaternion);
  tempYawForwardVec.y = 0;
  if (tempYawForwardVec.lengthSq() <= 1e-8) {
    return null;
  }
  tempYawForwardVec.normalize();
  return Math.atan2(tempYawForwardVec.x, tempYawForwardVec.z);
}

function syncSceneryPhysicsBridgeCharacterInput(): void {
  if (!physicsBridge || !physicsBridgeSceneLoaded || !physicsBridgeCharacterIdByNodeId.size) {
    return;
  }
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  const localYaw = characterInputYaw;
  physicsBridgeCharacterIdByNodeId.forEach((characterId, nodeId) => {
    const isControlled = nodeId === controlledNodeId;
    const pathFollowInput = characterAutoTourRuntime.getInput(nodeId);
    const hasPathFollowInput =
      Boolean(pathFollowInput)
      && (
        Math.abs(pathFollowInput!.moveX) > 0.001
        || Math.abs(pathFollowInput!.moveZ) > 0.001
        || Math.abs(pathFollowInput!.turn) > 0.001
        || typeof pathFollowInput!.yaw === 'number'
        || pathFollowInput!.jump
        || pathFollowInput!.sprint
        || pathFollowInput!.crouch
        || pathFollowInput!.interact
      );
    const activeYaw = hasPathFollowInput && typeof pathFollowInput?.yaw === 'number'
      ? pathFollowInput.yaw
      : (isControlled ? localYaw : null);
    void physicsBridge?.setCharacterInput({
      characterId,
      moveX: hasPathFollowInput ? pathFollowInput!.moveX : (isControlled ? characterAuthorityInput.moveX : 0),
      moveZ: hasPathFollowInput ? pathFollowInput!.moveZ : (isControlled ? characterAuthorityInput.moveZ : 0),
      yaw: activeYaw,
      jump: hasPathFollowInput ? pathFollowInput!.jump : (isControlled ? characterAuthorityInput.jump : false),
      sprint: hasPathFollowInput ? pathFollowInput!.sprint : (isControlled ? characterAuthorityInput.sprint : false),
      crouch: hasPathFollowInput ? pathFollowInput!.crouch : (isControlled ? characterAuthorityInput.crouch : false),
      interact: hasPathFollowInput ? pathFollowInput!.interact : (isControlled ? characterAuthorityInput.interact : false),
    }).catch((error) => {
      console.warn('[SceneViewer] Failed to sync character input', error);
    });
  });
}

async function disposeSceneryPhysicsBridgeScene(): Promise<void> {
  physicsBridgeSceneRequestId += 1;
  sceneryGroundCollisionBridgeMutationEpoch += 1;
  sceneryGroundCollisionRuntimeBodyIds.clear();
  const groundNode = resolveCurrentGroundNode();
  clearGroundCollisionRuntimeHost(groundNode ? (nodeObjectMap.get(groundNode.id) ?? null) : null);
  physicsBridgeBodyIdByNodeId.clear();
  physicsBridgeNodeIdByBodyId.clear();
  physicsBridgeVehicleIdByNodeId.clear();
  physicsBridgeCharacterIdByNodeId.clear();
  physicsBridgeCharacterBodyNodeIdByControllerNodeId.clear();
  physicsBridgeCharacterControllerNodeIdByBodyNodeId.clear();
  physicsBridgeFrameBodiesByNodeId.clear();
  physicsBridgeDirtyBodyNodeIds.clear();
  physicsBridgeBodyDirtyRevisionByNodeId.clear();
  physicsBridgePendingBodySyncRevisionByNodeId.clear();
  physicsBridgeLastFullBodySyncAtMs = 0;
  resetPhysicsBridgeVehicleInputSyncState(physicsBridgeVehicleInputSyncState);
  if (!physicsBridge || !physicsBridgeSceneLoaded) {
    physicsBridgeStepPromise = null;
    physicsBridgeBodySyncPromise = null;
    resetPhysicsBridgeVehicleInputSyncState(physicsBridgeVehicleInputSyncState);
    physicsBridgeDirtyBodyNodeIds.clear();
    physicsBridgeBodyDirtyRevisionByNodeId.clear();
    physicsBridgePendingBodySyncRevisionByNodeId.clear();
    physicsBridgeLastFullBodySyncAtMs = 0;
    return;
  }
  try {
    await physicsBridge.disposeScene();
  } catch (error) {
    console.warn('[SceneViewer] Failed to dispose physics bridge scene', error);
  } finally {
    physicsBridgeSceneLoaded = false;
    physicsBridgeStepPromise = null;
    physicsBridgeBodySyncPromise = null;
    sceneryGroundCollisionRuntimeBodyIds.clear();
    sceneryGroundCollisionReferenceInitialized = false;
    sceneryGroundCollisionReferenceElapsed = 0;
    resetPhysicsBridgeVehicleInputSyncState(physicsBridgeVehicleInputSyncState);
    physicsBridgeFrameBodiesByNodeId.clear();
    physicsBridgeDirtyBodyNodeIds.clear();
    physicsBridgeBodyDirtyRevisionByNodeId.clear();
    physicsBridgePendingBodySyncRevisionByNodeId.clear();
    physicsBridgeLastFullBodySyncAtMs = 0;
  }
}

async function destroySceneryPhysicsBridge(): Promise<void> {
  if (!physicsBridge) {
    return;
  }
  const bridge = physicsBridge;
  sceneryGroundCollisionBridgeMutationEpoch += 1;
  physicsBridge = null;
  physicsBridgeInitPromise = null;
  physicsBridgeStepPromise = null;
  physicsBridgeBodySyncPromise = null;
  try {
    await bridge.destroy();
  } catch (error) {
    console.warn('[SceneViewer] Failed to destroy physics bridge', error);
  } finally {
    physicsBridgeSceneRequestId += 1;
    sceneryGroundCollisionRuntimeBodyIds.clear();
    const groundNode = resolveCurrentGroundNode();
    clearGroundCollisionRuntimeHost(groundNode ? (nodeObjectMap.get(groundNode.id) ?? null) : null);
    sceneryGroundCollisionReferenceInitialized = false;
    sceneryGroundCollisionReferenceElapsed = 0;
    physicsBridgeBodyIdByNodeId.clear();
    physicsBridgeNodeIdByBodyId.clear();
    physicsBridgeVehicleIdByNodeId.clear();
    physicsBridgeCharacterIdByNodeId.clear();
    physicsBridgeCharacterBodyNodeIdByControllerNodeId.clear();
    physicsBridgeCharacterControllerNodeIdByBodyNodeId.clear();
    physicsBridgeFrameBodiesByNodeId.clear();
    physicsBridgeDirtyBodyNodeIds.clear();
    physicsBridgeBodyDirtyRevisionByNodeId.clear();
    physicsBridgePendingBodySyncRevisionByNodeId.clear();
    resetPhysicsBridgeVehicleInputSyncState(physicsBridgeVehicleInputSyncState);
    physicsBridgeSceneLoaded = false;
  }
}

function removeRigidbodyInstance(nodeId: string): void {
  rigidbodyInstances.delete(nodeId);
  physicsBridgeDirtyBodyNodeIds.delete(nodeId);
  physicsBridgeBodyDirtyRevisionByNodeId.delete(nodeId);
  physicsBridgePendingBodySyncRevisionByNodeId.delete(nodeId);
  scenePreviewPerf.notifyRemovedNode(nodeId);
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

function tupleToVec3(tuple: VehicleVectorValue, fallback?: Vector3Like): HostPhysicsVec3 | null {
  const normalized = normalizeVehicleVector(tuple) ?? (fallback ? normalizeVehicleVector(fallback) : null);
  if (!normalized) {
    return null;
  }
  const [x, y, z] = normalized;
  return createHostPhysicsVec3(x, y, z);
}

function createBridgeVehicleInstance(
  node: SceneNode,
  component: SceneNodeComponentState<VehicleComponentProps>,
  object: THREE.Object3D,
): VehicleInstanceWithWheels | null {
  const props = clampVehicleComponentProps(component.props);
  const worldProps = projectVehicleComponentPropsToWorldScale(props, resolveVehicleScaleFactors(node));
  const rightAxis = clampVehicleAxisIndex(props.indexRightAxis);
  const upAxis = clampVehicleAxisIndex(props.indexUpAxis);
  const forwardAxis = clampVehicleAxisIndex(props.indexForwardAxis);
  const axisRightVector = resolveVehicleAxisVector(rightAxis).clone();
  const axisUpVector = resolveVehicleAxisVector(upAxis).clone();
  const axisForwardVector = resolveVehicleAxisVector(forwardAxis).clone();
  const wheelEntries = (worldProps.wheels ?? [])
    .map((wheel) => {
      const axle = tupleToVec3(wheel.axleLocal, DEFAULT_AXLE);
      if (!axle) {
        return null;
      }
      return { config: wheel, axle };
    })
    .filter((entry): entry is { config: VehicleWheelProps; axle: HostPhysicsVec3 } => Boolean(entry));
  if (!wheelEntries.length) {
    return null;
  }
  let steerableWheelIndices = wheelEntries.reduce<number[]>((indices, entry, index) => {
    if (entry.config.isFrontWheel) {
      indices.push(index);
    }
    return indices;
  }, []);
  if (!steerableWheelIndices.length) {
    steerableWheelIndices = wheelEntries.length >= 2
      ? [0, 1].filter((index) => index < wheelEntries.length)
      : Array.from({ length: wheelEntries.length }, (_unused, index) => index);
  }
  object.updateWorldMatrix(true, false);
  object.getWorldPosition(physicsBridgeSyncPositionHelper);
  object.getWorldQuaternion(physicsBridgeSyncQuaternionHelper).normalize();
  const vehicle = createBridgeVehicleProxy(
    physicsBridgeSyncPositionHelper,
    physicsBridgeSyncQuaternionHelper,
    wheelEntries.length,
  );
  const wheelBindings: VehicleWheelBinding[] = wheelEntries.map(({ config, axle }, index) => {
    const axis = new THREE.Vector3(axle.x, axle.y, axle.z);
    if (axis.lengthSq() < 1e-6) {
      axis.copy(defaultWheelAxisVector);
    }
    axis.normalize();
    const wheelObject = config.nodeId ? nodeObjectMap.get(config.nodeId) ?? null : null;
    return {
      nodeId: config.nodeId ?? null,
      object: wheelObject,
      instancedTargets: wheelObject ? collectInstancedTransformTargets(wheelObject) : [],
      radius: Math.max(config.radius, VEHICLE_WHEEL_MIN_RADIUS),
      axleAxis: axis,
      steeringAxis: axis.clone(),
      spinAxis: axis.clone(),
      isFrontWheel: config.isFrontWheel === true,
      wheelIndex: index,
      spinAngle: 0,
      lastSteeringAngle: 0,
      baseQuaternion: wheelObject ? wheelObject.quaternion.clone() : new THREE.Quaternion(),
      basePosition: wheelObject ? wheelObject.position.clone() : new THREE.Vector3(),
      baseScale: wheelObject ? wheelObject.scale.clone() : new THREE.Vector3(1, 1, 1),
    };
  });
  return {
    source: 'bridge',
    nodeId: node.id,
    vehicle,
    wheelCount: wheelEntries.length,
    steerableWheelIndices,
    wheelBindings,
    forwardAxis: axisForwardVector.clone(),
    axisRightIndex: rightAxis,
    axisUpIndex: upAxis,
    axisForwardIndex: forwardAxis,
    axisRight: axisRightVector,
    axisUp: axisUpVector,
    axisForward: axisForwardVector,
    lastChassisPosition: physicsBridgeSyncPositionHelper.clone(),
    hasChassisPositionSample: false,
    initialChassisQuaternion: physicsBridgeSyncQuaternionHelper.clone(),
    bridgeBodyId: physicsBridgeBodyIdByNodeId.get(node.id) ?? null,
    vehicleId: physicsBridgeVehicleIdByNodeId.get(node.id) ?? null,
    hasBridgeFrameSample: false,
  };
}

function syncVehicleRigidbodyInstance(
  nodeId: string,
  instance: VehicleInstanceWithWheels,
  object: THREE.Object3D,
): void {
  const chassisBody = instance.vehicle.chassisBody;
  if (!chassisBody) {
    rigidbodyInstances.delete(nodeId);
    return;
  }
  // Keep the vehicle chassis body available through the shared rigidbody map.
  // VehicleDriveController reads rigidbodyInstances by vehicle node id.
  rigidbodyInstances.set(nodeId, {
    nodeId,
    body: chassisBody,
    bodies: [chassisBody],
    object,
    orientationAdjustment: null,
    bindingKind: 'vehicle',
    bridgeSyncDirty: true,
  });
  markPhysicsBridgeBodyDirty(nodeId);
}

function removeVehicleInstance(nodeId: string): void {
  const entry = vehicleInstances.get(nodeId);
  if (!entry) {
    return;
  }
  vehicleInstances.delete(nodeId);
  rigidbodyInstances.delete(nodeId);
  scenePreviewPerf.notifyRemovedNode(nodeId);
}

function ensureVehicleBindingForNode(nodeId: string): void {
  const node = resolveNodeById(nodeId);
  const component = resolveVehicleComponent(node);
  if (!node || !component) {
    removeVehicleInstance(nodeId);
    return;
  }
  const object = nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return;
  }
  removeVehicleInstance(nodeId);
  const instance = createBridgeVehicleInstance(node, component, object);
  if (instance) {
    vehicleInstances.set(nodeId, instance);
    syncVehicleRigidbodyInstance(nodeId, instance, object);
  }
}

function removeCharacterBinding(nodeId: string): void {
  const entry = rigidbodyInstances.get(nodeId) ?? null;
  if (!entry || entry.bindingKind !== 'character') {
    return;
  }
  rigidbodyInstances.delete(nodeId);
}

function ensureCharacterBindingForNode(nodeId: string): void {
  const node = resolveNodeById(nodeId);
  const component = resolveCharacterControllerComponent(node);
  if (!node || !component) {
    removeCharacterBinding(nodeId);
    return;
  }
  const object = nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return;
  }
  object.updateWorldMatrix(true, false);
  const worldPosition = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  object.getWorldPosition(worldPosition);
  object.getWorldQuaternion(worldQuaternion).normalize();
  const body = createBridgePhysicsBodyProxy(worldPosition, worldQuaternion);
  rigidbodyInstances.set(nodeId, {
    nodeId,
    body,
    bodies: [body],
    object,
    orientationAdjustment: null,
    bindingKind: 'character',
  });
}

function getPhysicsInterpolationState(body: PhysicsBodyLike): PhysicsInterpolationState {
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

function resolveInterpolatedBodyPosition(body: PhysicsBodyLike, target: THREE.Vector3): THREE.Vector3 {
  if (!physicsInterpolationEnabled) {
    return target.set(body.position.x, body.position.y, body.position.z);
  }
  const state = physicsInterpolationStates.get(body);
  if (!state || !state.hasSample) {
    return target.set(body.position.x, body.position.y, body.position.z);
  }
  return target.copy(state.prevPos).lerp(state.currPos, physicsInterpolationAlpha);
}

function resolveRigidbodyBindingObject(
  component: SceneNodeComponentState<RigidbodyComponentProps>,
  fallbackObject: THREE.Object3D | null,
): THREE.Object3D | null {
  const targetNodeId = typeof component.props?.targetNodeId === 'string' ? component.props.targetNodeId.trim() : '';
  if (targetNodeId) {
    return nodeObjectMap.get(targetNodeId) ?? null;
  }
  return fallbackObject;
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

function collectCharacterNodes(nodes: SceneNode[] | undefined | null): SceneNode[] {
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
    if (resolveCharacterControllerComponent(node)) {
      collected.push(node);
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return collected;
}

function hasPhysicsRelevantSceneNodes(nodes: SceneNode[] | undefined | null): boolean {
  if (!Array.isArray(nodes)) {
    return false;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (resolvePhysicsRigidbodyComponent(node) || resolveVehicleComponent(node) || resolveGroundAnchorComponent(node)) {
      return true;
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return false;
}

function hasGroundAnchorSceneNodes(nodes: SceneNode[] | undefined | null): boolean {
  if (!Array.isArray(nodes)) {
    return false;
  }
  const stack: SceneNode[] = [...nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (resolveGroundAnchorComponent(node)) {
      return true;
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return false;
}

function resolveDocumentPhysicsRelevance(document: SceneJsonExportDocument | null | undefined): boolean {
  if (!document) {
    return false;
  }
  return hasPhysicsRelevantSceneNodes(document.nodes);
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

function syncCharacterBindingsForDocument(document: SceneJsonExportDocument | null): void {
  if (!document) {
    Array.from(rigidbodyInstances.entries()).forEach(([nodeId, entry]) => {
      if (entry.bindingKind === 'character') {
        rigidbodyInstances.delete(nodeId);
      }
    });
    return;
  }
  const characterNodes = collectCharacterNodes(document.nodes);
  const desiredIds = new Set(characterNodes.map((node) => node.id));
  characterNodes.forEach((node) => ensureCharacterBindingForNode(node.id));
  Array.from(rigidbodyInstances.entries()).forEach(([nodeId, entry]) => {
    if (entry.bindingKind === 'character' && !desiredIds.has(nodeId)) {
      rigidbodyInstances.delete(nodeId);
    }
  });
}

type SceneSubsystemProgressReporter = (progress: {
  phase: SceneInitStage;
  percent: number;
  detail: string;
  currentIndex?: number;
  currentTotal?: number;
  currentLabel?: string;
}) => void;

async function syncPhysicsBodiesForDocument(
  document: SceneJsonExportDocument | null,
  onProgress?: SceneSubsystemProgressReporter,
): Promise<void> {
  if (!document) {
    resetPhysicsWorld();
    syncVehicleInstancesForDocument(null);
    syncCharacterBindingsForDocument(null);
    syncAirWallsForDocument(null);
    return;
  }
  if (!physicsEnvironmentEnabled.value) {
    onProgress?.({
      phase: 'syncingPhysics',
      percent: 100,
      detail: '物理系统已禁用，跳过同步',
      currentIndex: 1,
      currentTotal: 1,
      currentLabel: 'disabled',
    });
    await disposeSceneryPhysicsBridgeScene();
    clearLegacyPhysicsWorld();
    syncVehicleInstancesForDocument(document);
    syncCharacterBindingsForDocument(document);
    syncAirWallsForDocument(document);
    return;
  }
  if (!resolveDocumentPhysicsRelevance(document)) {
    onProgress?.({
      phase: 'syncingPhysics',
      percent: 100,
      detail: '当前场景没有需要同步的物理对象',
      currentIndex: 1,
      currentTotal: 1,
      currentLabel: 'skipped',
    });
    await disposeSceneryPhysicsBridgeScene();
    clearLegacyPhysicsWorld();
    syncVehicleInstancesForDocument(document);
    syncCharacterBindingsForDocument(document);
    syncAirWallsForDocument(document);
    return;
  }
  onProgress?.({
    phase: 'syncingPhysics',
    percent: 10,
    detail: '正在准备物理桥接...',
    currentIndex: 0,
    currentTotal: 3,
    currentLabel: 'prepareSceneryPhysicsBridgeForDocument',
  });
  await loadSceneryPhysicsBridgeScene(document, onProgress);
  onProgress?.({
    phase: 'syncingPhysics',
    percent: 80,
    detail: '正在同步车辆与空气墙...',
    currentIndex: 2,
    currentTotal: 3,
    currentLabel: 'vehicleAndAirWallSync',
  });
  clearLegacyPhysicsWorld();
  syncVehicleInstancesForDocument(document);
  syncCharacterBindingsForDocument(document);
  syncAirWallsForDocument(document);
  onProgress?.({
    phase: 'syncingPhysics',
    percent: 100,
    detail: '物理系统同步完成',
    currentIndex: 3,
    currentTotal: 3,
    currentLabel: 'completed',
  });
}

function stepPhysicsWorld(delta: number): number {
  void delta;
  physicsInterpolationAlpha = 0;
  return 0;
}

function updateVehicleWheelVisuals(delta: number): void {
  // 只有在时间确实推进、并且场景里存在车辆实例时，才需要更新轮子视觉状态。
  if (!Number.isFinite(delta) || delta <= 0 || !vehicleInstances.size) {
    return;
  }

  const nowMs = Date.now();
  // 同一帧里可能会遇到多个轮子共享同一个父节点，使用 WeakSet 避免重复刷新父节点世界矩阵。
  const updatedWheelParents = new WeakSet<THREE.Object3D>();

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
    // 手动驾驶和自动导览都可能驱动车辆，但并不是每一帧都值得更新轮子外观。
    // 这里交给 perf 门禁做节流，减少无意义的轮子旋转和矩阵同步开销。
    const manualActive = vehicleDriveActive.value && vehicleDriveVehicle === instance.vehicle;
    const tourActive = Boolean(nodeId) && activeAutoTourNodeIds.has(nodeId);
    if (!scenePreviewPerf.shouldUpdateWheelVisuals({ nodeId, body: chassisBody, manualActive, tourActive, nowMs })) {
      return;
    }

    // 读取车身的插值后位姿，避免轮子视觉直接使用未平滑的物理状态。
    resolveInterpolatedBodyPosition(chassisBody as PhysicsBodyLike, wheelChassisPositionHelper);
    wheelQuaternionHelper
      .set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
      .normalize();

    // 计算车辆沿自身前进方向的有符号位移，用于驱动轮胎滚动角。
    // 这里保留正负号，因此倒车时轮子也会反向滚动。
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
        binding.instancedTargets = [];
        return;
      }

      // 如果轮子对象是在车辆实例创建之后才出现，或者资源重载导致对象引用变化，
      // 这里需要重新捕获基础变换，保证后续的转向和滚动都以当前模型原始姿态为准。
      if (binding.object !== wheelObject) {
        binding.object = wheelObject;
        binding.basePosition.copy(wheelObject.position);
        binding.baseScale.copy(wheelObject.scale);
        binding.baseQuaternion.copy(wheelObject.quaternion);
        binding.spinAngle = 0;
        binding.lastSteeringAngle = 0;
        binding.instancedTargets = collectInstancedTransformTargets(wheelObject);
      }

      // 轮子的位移和缩放保持为基础值，不在这里做动画，只处理转向和滚动旋转。
      wheelObject.position.copy(binding.basePosition);
      wheelObject.scale.copy(binding.baseScale);

      // 根据车身位移计算轮胎滚动角。
      if (signedTravel !== 0) {
        const radius = Math.max(binding.radius, VEHICLE_WHEEL_MIN_RADIUS);
        // 约定：车辆向前行驶时，轮子应当朝“前滚动”方向旋转，所以这里取负号。
        const rollDelta = -signedTravel / radius;
        if (Number.isFinite(rollDelta) && Math.abs(rollDelta) > VEHICLE_WHEEL_SPIN_EPSILON) {
          binding.spinAngle += rollDelta;
          binding.spinAngle = THREE.MathUtils.euclideanModulo(binding.spinAngle + Math.PI, Math.PI * 2) - Math.PI;
        }
      }

      // 计算前轮/可转向轮的转向角。
      let steeringAngle = 0;
      if (binding.isFrontWheel) {
        const info = wheelInfos?.[binding.wheelIndex];
        const raw = info?.steering;
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          steeringAngle = raw;
        // 如果物理引擎暂时没有提供单轮转向角，手动驾驶时退回使用当前方向盘输入做视觉兜底。
        } else if (vehicleDriveActive.value && vehicleDriveVehicle === instance.vehicle) {
          steeringAngle = THREE.MathUtils.clamp(vehicleDriveInput.steering, -1, 1) * THREE.MathUtils.degToRad(26);
        }
      }
      binding.lastSteeringAngle = steeringAngle;

      // 先拿到轮子父节点的世界旋转及其逆矩阵，用于把“世界/车身轴向”转换回轮子父节点局部空间。
      wheelParentWorldQuaternionHelper.identity();
      wheelParentWorldQuaternionInverseHelper.identity();
      if (wheelObject.parent) {
        wheelObject.parent.getWorldQuaternion(wheelParentWorldQuaternionHelper);
        wheelParentWorldQuaternionInverseHelper.copy(wheelParentWorldQuaternionHelper).invert();
      }

      // 构建转向四元数：围绕车辆的上方向旋转。
      // 由于轮子可能挂在有旋转的父节点下，这个轴需要先转换到父节点局部空间。
      wheelAxisHelper.copy(instance.axisUp).applyQuaternion(wheelQuaternionHelper);
      if (wheelObject.parent) {
        wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper);
      }
      if (wheelAxisHelper.lengthSq() < 1e-10) {
        wheelAxisHelper.set(0, 1, 0);
      } else {
        wheelAxisHelper.normalize();
      }
      binding.steeringAxis.copy(wheelAxisHelper);
      wheelSteeringQuaternionHelper.setFromAxisAngle(wheelAxisHelper, steeringAngle);

      // 构建滚动四元数：围绕轮轴旋转。
      // 轮轴优先使用绑定时识别到的 axleAxis；如果退化，再用默认轮轴兜底。
      // wheelAxisHelper.copy(binding.axleAxis).applyQuaternion(wheelQuaternionHelper);
      // if (wheelObject.parent) {
      //   wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper);
      // }
      // if (wheelAxisHelper.lengthSq() < 1e-10) {
      //   wheelAxisHelper.copy(defaultWheelAxisVector);
      //   wheelAxisHelper.applyQuaternion(wheelQuaternionHelper);
      //   if (wheelObject.parent) {
      //     wheelAxisHelper.applyQuaternion(wheelParentWorldQuaternionInverseHelper);
      //   }
      // }
      // if (wheelAxisHelper.lengthSq() < 1e-10) {
      //   wheelAxisHelper.set(1, 0, 0);
      // } else {
      //   wheelAxisHelper.normalize();
      // }
      // wheelBaseQuaternionInverseHelper.copy(binding.baseQuaternion).invert();
      // wheelAxisHelper.applyQuaternion(wheelBaseQuaternionInverseHelper);
      // if (wheelAxisHelper.lengthSq() < 1e-10) {
      //   wheelAxisHelper.set(1, 0, 0);
      // } else {
      //   wheelAxisHelper.normalize();
      // }
      // binding.spinAxis.copy(wheelAxisHelper);
      // wheelSpinQuaternionHelper.setFromAxisAngle(wheelAxisHelper, binding.spinAngle);

      // 合成最终轮子朝向：
      // 1. 先回到模型的基础姿态
      // 2. 再叠加转向
      // 3. 最后叠加轮胎滚动
      wheelVisualQuaternionHelper.copy(binding.baseQuaternion);
      if (steeringAngle !== 0) {
        wheelVisualQuaternionHelper.premultiply(wheelSteeringQuaternionHelper);
      }
      // if (binding.spinAngle !== 0) {
      //   wheelVisualQuaternionHelper.multiply(wheelSpinQuaternionHelper);
      // }
      wheelObject.quaternion.copy(wheelVisualQuaternionHelper);

      if (wheelObject.parent && !updatedWheelParents.has(wheelObject.parent)) {
        // 先刷新父节点世界矩阵，确保轮子的局部旋转在正确的父空间中生效。
        wheelObject.parent.updateWorldMatrix(true, false);
        updatedWheelParents.add(wheelObject.parent);
      }
      // 轮子本体重新计算世界矩阵，并同步给轮子内部可能存在的实例化子节点。
      wheelObject.updateWorldMatrix(false, true);

      if (binding.instancedTargets.length) {
        binding.instancedTargets.forEach((target) => {
          syncInstancedTransformTarget(target);
        });
      }
    });
  });
}

function collectInstancedTransformTargets(object: THREE.Object3D): THREE.Object3D[] {
  const revision = getInstancedTransformRevision(object);
  const cached = instancedTransformTargetCache.get(object);
  if (cached && cached.revision === revision) {
    return cached.targets;
  }
  const targets: THREE.Object3D[] = [];
  object.traverse((child) => {
    if (child.userData?.instancedAssetId) {
      targets.push(child);
    }
  });
  instancedTransformTargetCache.set(object, {
    revision,
    targets,
  });
  return targets;
}

function syncInstancedTransformTarget(target: THREE.Object3D): void {
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
    for (let i = 1; i < desiredCount; i += 1) {
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
    matrixScratch: instanceLayoutWorldMatrixScratch,
    onMatrix: (bindingId, worldMatrix) => {
      const cached = instancedTransformCache.get(bindingId) ?? null;
      const shouldUpdate =
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
      object.updateWorldMatrix(false, true);
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
  camera.updateWorldMatrix(true, false);
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
    syncLazyPlaceholderStateFromObject(state, container, nodeId);
    if (state.loaded) {
      lazyPlaceholderStates.delete(nodeId);
      return;
    }
    if (state.loading || state.pending) {
      return;
    }
    if (!shouldLoadLazyPlaceholder(state, cameraViewFrustum)) {
      return;
    }
    scheduleLazyPlaceholderLoad(state);
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
    detailed.updateWorldMatrix(false, true);
    placeholder.parent?.remove(placeholder);
    disposeObject(placeholder);
    nodeObjectMap.delete(nodeId);
    clearInstancedLodRuntimeEntryCacheForNode(nodeId);
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

function syncInstancedTransform(object: THREE.Object3D | null, force = false, skipWorldMatrixUpdate = false): void {
  if (!object) {
    return;
  }
  // 注意：父层级存在旋转 + 非等比缩放时会产生 shear。
  // InstancedMesh 支持完整矩阵，但 decompose/compose 会丢失 shear，导致实例位置/朝向偏差。
  // 因此这里优先直接写入 matrixWorld，仅在需要“隐藏”(scale=0) 时才做分解。
  if (!skipWorldMatrixUpdate) {
    object.updateWorldMatrix(true, false);
  }
  if (!shouldSyncInstancedTransform(object)) {
    return;
  }
  object.userData.__harmonyInstancedTransformRevision = getInstancedTransformRevision(object) + 1;

  const handleTarget = (target: THREE.Object3D) => {
    if (!target.userData?.instancedAssetId) {
      return;
    }

    if (hasWallInstancedBindings(target)) {
      const visible = isRuntimeObjectEffectivelyVisible(target);
      const cachedSnapshot = instancedProxySyncSnapshotCache.get(target);
      const wallBindingsSource = target.userData?.[WALL_INSTANCED_BINDINGS_USERDATA_KEY];
      const assetId = typeof target.userData?.instancedAssetId === 'string' ? target.userData.instancedAssetId as string : null;
      if (
        !force
        && cachedSnapshot
        && cachedSnapshot.kind === 'wall'
        && cachedSnapshot.assetId === assetId
        && cachedSnapshot.visible === visible
        && cachedSnapshot.wallBindingsSource === wallBindingsSource
        && matricesAlmostEqual(cachedSnapshot.elements, target.matrixWorld.elements)
      ) {
        return;
      }
      const nodeId = target.userData?.nodeId as string | undefined;
      if (nodeId) {
        removeVehicleInstance(nodeId);
      }
      const didSync = syncWallInstancedBindingsForObject(target);
      if (didSync) {
        instancedProxySyncSnapshotCache.set(target, {
          kind: 'wall',
          assetId,
          visible,
          wallBindingsSource,
          elements: Array.from(target.matrixWorld.elements),
        });
      }
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
    const layoutSource = (node as unknown as { instanceLayout?: unknown }).instanceLayout;

    const assetId = typeof target.userData?.instancedAssetId === 'string' ? (target.userData.instancedAssetId as string) : null;
    const visible = isRuntimeObjectEffectivelyVisible(target);
    const renderKind = target.userData?.instancedRenderKind === 'billboard' ? 'billboard' : 'model';
    const faceCamera = target.userData?.__harmonyLodFaceCamera === true;
    const cachedSnapshot = instancedProxySyncSnapshotCache.get(target);
    if (
      !force
      && cachedSnapshot
      && cachedSnapshot.kind === 'layout'
      && cachedSnapshot.assetId === assetId
      && cachedSnapshot.visible === visible
      && cachedSnapshot.renderKind === renderKind
      && cachedSnapshot.layoutSource === layoutSource
      && cachedSnapshot.faceCamera === faceCamera
      && matricesAlmostEqual(cachedSnapshot.elements, target.matrixWorld.elements)
    ) {
      return;
    }

    const group = renderKind === 'model' && assetId ? getCachedModelObject(assetId) : null;
    if (renderKind === 'model' && !group) {
      return;
    }

    const desiredCount = getInstanceLayoutCount(layout);
    const existingBindings = renderKind === 'billboard'
      ? getBillboardInstanceBindingsForNode(nodeId)
      : getModelInstanceBindingsForNode(nodeId);
    if (existingBindings.length !== desiredCount) {
      if (!canNodeUseRuntimeModelInstancing(node)) {
        releaseBillboardInstance(nodeId);
        releaseModelInstance(nodeId);
        return;
      }
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
      matrixScratch: instanceLayoutWorldMatrixScratch,
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
        return shouldUpdate;
      },
    });

    target.userData.__harmonyInstanceLayoutSignature = result.signature;
    target.userData.__harmonyInstanceLayoutLocals = result.locals;
    if (result.updatedCount > 0) {
      updateInstancedLodRuntimeEntryCacheForObject(target);
      markInstancedCullingDirty();
    }
    instancedProxySyncSnapshotCache.set(target, {
      kind: 'layout',
      assetId,
      visible,
      renderKind,
      layoutSource,
      faceCamera,
      elements: Array.from(target.matrixWorld.elements),
    });
  };

  // Fast path: instanced proxy itself.
  handleTarget(object);
  if (object.userData?.__harmonyHasNestedInstancedProxy === true) {
    // Some objects (e.g. wheel visuals) may contain nested instanced proxies.
    const nestedTargets = getNestedInstancedProxyTargets(object);
    for (const target of nestedTargets) {
      handleTarget(target);
    }
  }
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
      worldMatrix: object.matrixWorld,
    });
    updateInstancedLodRuntimeEntryCacheForObject(object);
    markInstancedCullingDirty();
    return;
  }
  syncInstancedTransform(object);
}

function updateNodeProperties(object: THREE.Object3D, node: SceneNode): void {
  if (node.name) {
    object.name = node.name;
  }
  updateNodeTransfrom(object, node);
  const isGuideRouteNode = node.dynamicMesh?.type === 'GuideRoute';
  const guideboardVisibility = resolveGuideboardInitialVisibility(node);
  if (guideboardVisibility !== null) {
    object.visible = guideboardVisibility;
  } else if (isRuntimeHiddenInPreview(node) || (node.editorFlags?.editorOnly && !isGuideRouteNode) || object.userData?.hidden === true) {
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
    releaseCharacterControllerBehaviorOverride(token);
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
  characterCameraFollowNodeId = null;
  characterCameraFollowPlacementCache.nodeId = null;
  characterCameraFollowPlacementCache.objectUuid = null;
  characterCameraFollowPlacementCache.placement = null;
  resetFollowCameraMotionState(characterCameraFollowMotionState);
  characterCameraFollowAnchorScratch.set(0, 0, 0);
  characterCameraFollowForwardScratch.set(0, 0, 0);
  resetCameraFollowState(characterCameraFollowState);
}

function findDefaultControlledCharacterObject(): THREE.Object3D | null {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  if (!controlledNodeId) {
    return null;
  }
  const bindingNodeId = resolveCharacterControllerBindingNodeId(controlledNodeId);
  return bindingNodeId ? (nodeObjectMap.get(bindingNodeId) ?? null) : null;
}

function resolveCharacterRootWorldPosition(
  nodeId: string,
  bindingNodeId: string | null,
  protagonistObject: THREE.Object3D,
  target: THREE.Vector3,
): THREE.Vector3 {
  const motionTelemetry = controlledNodeMotionRuntime.get(bindingNodeId ?? nodeId);
  if (motionTelemetry?.hasSample) {
    target.copy(motionTelemetry.worldPosition);
    return target;
  }
  const rigidbodyEntry = rigidbodyInstances.get(nodeId) ?? null;
  const rigidbodyBody = rigidbodyEntry?.body ?? null;
  if (rigidbodyBody) {
    target.set(rigidbodyBody.position.x, rigidbodyBody.position.y, rigidbodyBody.position.z);
  } else {
    protagonistObject.getWorldPosition(target);
  }
  return target;
}

function resolveCharacterFollowForwardWorld(
  object: THREE.Object3D,
  props: CharacterControllerComponentProps,
  target: THREE.Vector3,
): THREE.Vector3 {
  object.getWorldQuaternion(protagonistPoseQuaternion);
  writeCharacterLocalForward(target, props.forwardAxis);
  target.applyQuaternion(protagonistPoseQuaternion);
  target.y = 0;
  if (target.lengthSq() <= 1e-8) {
    target.set(0, 0, 1);
  } else {
    target.normalize();
  }
  return target;
}

function resolveCharacterFollowPlacement(
  nodeId: string,
  object: THREE.Object3D | null,
): CameraFollowPlacement {
  const objectUuid = object?.uuid ?? null;
  if (
    characterCameraFollowPlacementCache.placement
    && characterCameraFollowPlacementCache.nodeId === nodeId
    && characterCameraFollowPlacementCache.objectUuid === objectUuid
  ) {
    return {
      distance: characterCameraFollowPlacementCache.placement.distance,
      heightOffset: characterCameraFollowPlacementCache.placement.heightOffset,
      targetLift: characterCameraFollowPlacementCache.placement.targetLift,
      targetForward: characterCameraFollowPlacementCache.placement.targetForward,
    };
  }

  const placement = computeFollowPlacement(getApproxDimensions(object));
  
  characterCameraFollowPlacementCache.nodeId = nodeId;
  characterCameraFollowPlacementCache.objectUuid = objectUuid;
  characterCameraFollowPlacementCache.placement = {
    distance: placement.distance,
    heightOffset: placement.heightOffset,
    targetLift: placement.targetLift,
    targetForward: placement.targetForward,
  };
  return {
    distance: placement.distance,
    heightOffset: placement.heightOffset,
    targetLift: placement.targetLift,
    targetForward: placement.targetForward,
  };
}

function getNormalizedMultiuserIdentity(): MultiuserIdentity | null {
  const userId = typeof props.multiuserIdentity?.userId === 'string' ? props.multiuserIdentity.userId.trim() : '';
  if (!userId) {
    return null;
  }
  const displayName = typeof props.multiuserIdentity?.displayName === 'string'
    ? props.multiuserIdentity.displayName.trim()
    : '';
  return {
    userId,
    displayName: displayName || userId,
  };
}

function ensureRemoteMultiuserPeerRoot(): THREE.Group | null {
  const context = renderContext;
  if (!context) {
    return null;
  }
  if (remoteMultiuserPeerRoot.parent !== context.scene) {
    remoteMultiuserPeerRoot.parent?.remove(remoteMultiuserPeerRoot);
    context.scene.add(remoteMultiuserPeerRoot);
  }
  return remoteMultiuserPeerRoot;
}

function hideRemoteMultiuserPeer(entry: RemoteMultiuserPeerEntry): void {
  if (entry.root) {
    entry.root.parent?.remove(entry.root);
  }
  releaseRemoteMultiuserPeerRuntime(entry);
  markRemoteMultiuserPeerHidden(entry);
  entry.displayState = null;
  markInstancedCullingDirty();
}

function createRemoteMultiuserPeerPlaceholderEntry(peerState: MultiuserPeerState): RemoteMultiuserPeerEntry {
  return {
    ...createRemoteMultiuserPeerVisibilityState(),
    root: null,
    signature: getRemoteMultiuserPeerSignature(peerState),
    displayName: '',
    targetState: cloneRemoteMultiuserPeerState(peerState),
    displayState: null,
    ownsResources: true,
    nicknameRuntime: null,
    wheelNodeIds: [],
    wheelBindings: [],
    animationControllers: new Map(),
    rootSignature: '',
    loadToken: 0,
  };
}

function isVehicleLikeMultiuserSubjectType(subjectType: MultiuserSubjectType): boolean {
  return subjectType === 'vehicle' || subjectType === 'ship' || subjectType === 'aircraft';
}

function createRemoteMultiuserPlaceholder(subjectType: MultiuserSubjectType): THREE.Object3D {
  const color = isVehicleLikeMultiuserSubjectType(subjectType) ? 0xffb300 : 0x4d9bff;
  const geometry = new THREE.CapsuleGeometry(0.32, 0.9, 4, 8);
  const material = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = isVehicleLikeMultiuserSubjectType(subjectType) ? 'RemoteVehiclePlaceholder' : 'RemoteCharacterPlaceholder';
  mesh.userData.remoteMultiuserPlaceholder = true;
  return mesh;
}

function isRemoteMultiuserPlaceholderObject(object: THREE.Object3D | null | undefined): boolean {
  return Boolean(object?.userData?.remoteMultiuserPlaceholder);
}

function truncateRemoteMultiuserDisplayName(displayName: string, maxChars = REMOTE_MULTIUSER_NICKNAME_MAX_CHARS): string {
  if (maxChars <= 0) {
    return '';
  }
  const characters = Array.from(displayName);
  if (characters.length <= maxChars) {
    return displayName;
  }
  return characters.slice(0, maxChars).join('');
}

function normalizeRemoteMultiuserDisplayName(displayName: string | null | undefined, fallbackUserId: string): string {
  const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
  return truncateRemoteMultiuserDisplayName(trimmed.length ? trimmed : fallbackUserId);
}

function resolveRemoteMultiuserNicknameWorldWidth(fontSize: number, textWidth: number): number {
  const textAreaWidth = Math.min(Math.max(textWidth + 48, 180), REMOTE_MULTIUSER_NICKNAME_CARD_MAX_WIDTH - REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_X * 2);
  const cardWidth = Math.min(
    REMOTE_MULTIUSER_NICKNAME_CARD_MAX_WIDTH,
    Math.max(REMOTE_MULTIUSER_NICKNAME_CARD_MIN_WIDTH, Math.ceil(textAreaWidth + REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_X * 2)),
  );
  const cardHeight = Math.ceil(REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_Y * 2 + fontSize + 16);
  return Math.max(1.08, (cardWidth / cardHeight) * REMOTE_MULTIUSER_NICKNAME_WORLD_HEIGHT);
}

function drawRemoteMultiuserNicknameTexture(entry: RemoteMultiuserNicknameRuntimeEntry): void {
  const context = entry.context;
  const label = entry.displayName || '';

  context.resetTransform?.();
  context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
  context.scale(REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR, REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR);

  const maxTextWidth = REMOTE_MULTIUSER_NICKNAME_CARD_MAX_WIDTH - (REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_X * 2) - REMOTE_MULTIUSER_NICKNAME_CARD_GAP;
  let fontSize = REMOTE_MULTIUSER_NICKNAME_LABEL_FONT_MAX;
  while (fontSize > REMOTE_MULTIUSER_NICKNAME_LABEL_FONT_MIN) {
    context.font = `900 ${fontSize}px sans-serif`;
    if (context.measureText(label).width <= maxTextWidth) {
      break;
    }
    fontSize -= 1;
  }
  if (fontSize < REMOTE_MULTIUSER_NICKNAME_LABEL_FONT_MIN) {
    fontSize = REMOTE_MULTIUSER_NICKNAME_LABEL_FONT_MIN;
  }
  context.font = `900 ${fontSize}px sans-serif`;
  const labelWidth = context.measureText(label).width;
  const cardWidth = Math.min(
    REMOTE_MULTIUSER_NICKNAME_CARD_MAX_WIDTH,
    Math.max(
      REMOTE_MULTIUSER_NICKNAME_CARD_MIN_WIDTH,
      Math.ceil(labelWidth + (REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_X * 2) + REMOTE_MULTIUSER_NICKNAME_CARD_GAP),
    ),
  );
  const cardHeight = Math.ceil(REMOTE_MULTIUSER_NICKNAME_CARD_PADDING_Y * 2 + fontSize + 16);

  const canvasWidth = cardWidth * REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR;
  const canvasHeight = cardHeight * REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR;
  if (entry.canvas.width !== canvasWidth) {
    entry.canvas.width = canvasWidth;
  }
  if (entry.canvas.height !== canvasHeight) {
    entry.canvas.height = canvasHeight;
  }

  context.resetTransform?.();
  context.scale(REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR, REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR);
  const radius = Math.min(32, cardHeight / 2);
  context.beginPath();
  context.moveTo(radius, 0);
  context.arcTo(cardWidth, 0, cardWidth, cardHeight, radius);
  context.arcTo(cardWidth, cardHeight, 0, cardHeight, radius);
  context.arcTo(0, cardHeight, 0, 0, radius);
  context.arcTo(0, 0, cardWidth, 0, radius);
  context.closePath();
  const background = context.createLinearGradient(0, 0, 0, cardHeight);
  background.addColorStop(0, REMOTE_MULTIUSER_NICKNAME_BG_TOP);
  background.addColorStop(0.55, REMOTE_MULTIUSER_NICKNAME_BG_MIDDLE);
  background.addColorStop(1, REMOTE_MULTIUSER_NICKNAME_BG_BOTTOM);
  context.fillStyle = background;
  context.fill();
  context.lineWidth = 1.8;
  context.strokeStyle = REMOTE_MULTIUSER_NICKNAME_BORDER;
  context.stroke();
  const glow = context.createRadialGradient(cardWidth * 0.2, cardHeight * 0.24, 0, cardWidth * 0.2, cardHeight * 0.24, cardWidth * 0.9);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
  glow.addColorStop(0.42, REMOTE_MULTIUSER_NICKNAME_GLOW);
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, cardWidth, cardHeight);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = REMOTE_MULTIUSER_NICKNAME_TEXT;
  context.shadowColor = 'rgba(255, 255, 255, 0.08)';
  context.shadowBlur = 2;
  context.shadowOffsetY = 1;
  context.font = `900 ${fontSize}px sans-serif`;
  const textX = cardWidth / 2;
  context.fillText(label || ' ', textX, cardHeight / 2 + 0.5);

  entry.texture.needsUpdate = true;
  entry.worldHeight = REMOTE_MULTIUSER_NICKNAME_WORLD_HEIGHT;
  entry.worldWidth = resolveRemoteMultiuserNicknameWorldWidth(fontSize, labelWidth);
}

function createRemoteMultiuserNicknameRuntime(displayName: string): RemoteMultiuserNicknameRuntimeEntry {
  const canvas = createCanvas(REMOTE_MULTIUSER_NICKNAME_CARD_MAX_WIDTH * REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR, 64 * REMOTE_MULTIUSER_NICKNAME_TEXTURE_DPR);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to acquire a 2D context for remote multiuser nicknames');
  }

  const texture = new THREE.CanvasTexture(canvas as CanvasImageSource);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.name = 'RemotePeerNickname';
  sprite.renderOrder = 6000;
  sprite.visible = true;
  const entry: RemoteMultiuserNicknameRuntimeEntry = {
    sprite,
    material,
    texture,
    canvas,
    context,
    displayName,
    worldWidth: 1,
    worldHeight: REMOTE_MULTIUSER_NICKNAME_WORLD_HEIGHT,
  };
  drawRemoteMultiuserNicknameTexture(entry);
  sprite.scale.set(entry.worldWidth, entry.worldHeight, 1);
  return entry;
}

function disposeRemoteMultiuserNicknameRuntime(entry: RemoteMultiuserPeerEntry): void {
  const runtime = entry.nicknameRuntime;
  if (!runtime) {
    return;
  }
  runtime.sprite.parent?.remove(runtime.sprite);
  runtime.texture.dispose();
  runtime.material.dispose();
  entry.nicknameRuntime = null;
}

function syncRemoteMultiuserNicknameRuntime(entry: RemoteMultiuserPeerEntry): void {
  if (!entry.root) {
    return;
  }
  const runtime = entry.nicknameRuntime ?? (entry.nicknameRuntime = createRemoteMultiuserNicknameRuntime(entry.displayName));
  if (runtime.displayName !== entry.displayName) {
    runtime.displayName = entry.displayName;
    drawRemoteMultiuserNicknameTexture(runtime);
    runtime.sprite.scale.set(runtime.worldWidth, runtime.worldHeight, 1);
  }
  if (runtime.sprite.parent !== entry.root) {
    runtime.sprite.parent?.remove(runtime.sprite);
    entry.root.updateWorldMatrix(true, false);
    remoteMultiuserNicknameBoundsScratch.setFromObject(entry.root);
    if (remoteMultiuserNicknameBoundsScratch.isEmpty()) {
      runtime.sprite.position.set(0, REMOTE_MULTIUSER_NICKNAME_DEFAULT_LOCAL_Y, 0);
    } else {
      remoteMultiuserNicknameBoundsScratch.getCenter(remoteMultiuserNicknameCenterScratch);
      remoteMultiuserNicknameCenterScratch.y = remoteMultiuserNicknameBoundsScratch.max.y + REMOTE_MULTIUSER_NICKNAME_WORLD_Y_OFFSET;
      entry.root.worldToLocal(remoteMultiuserNicknameCenterScratch);
      runtime.sprite.position.copy(remoteMultiuserNicknameCenterScratch);
    }
    entry.root.add(runtime.sprite);
  }
  runtime.sprite.visible = true;
}

function updateRemoteMultiuserNicknameRuntime(entry: RemoteMultiuserPeerEntry): void {
  const runtime = entry.nicknameRuntime;
  if (!runtime) {
    return;
  }
  runtime.sprite.scale.set(runtime.worldWidth, runtime.worldHeight, 1);
  runtime.material.opacity = 1;
}

function cloneRemoteMultiuserPeerState(state: MultiuserPeerState): MultiuserPeerState {
  return {
    subjectType: state.subjectType,
    subjectNodeId: state.subjectNodeId,
    subjectIdentifier: state.subjectIdentifier,
    subjectAssetId: state.subjectAssetId,
    subjectAssetUrl: state.subjectAssetUrl,
    action: state.action,
    position: {
      x: state.position.x,
      y: state.position.y,
      z: state.position.z,
    },
    quaternion: {
      x: state.quaternion.x,
      y: state.quaternion.y,
      z: state.quaternion.z,
      w: state.quaternion.w,
    },
    scale: {
      x: state.scale.x,
      y: state.scale.y,
      z: state.scale.z,
    },
    presentation: cloneRemoteMultiuserPeerPresentation(state.presentation ?? null),
  };
}

function cloneRemoteMultiuserPeerPresentation(presentation: MultiuserPeerPresentationState | null | undefined): MultiuserPeerPresentationState | null {
  if (!presentation) {
    return null;
  }
  const vehicle = presentation.vehicle
    ? {
        wheels: Array.isArray(presentation.vehicle.wheels)
          ? presentation.vehicle.wheels.map((wheel) => ({
              nodeId: wheel.nodeId ?? null,
              wheelIndex: wheel.wheelIndex,
              position: {
                x: wheel.position.x,
                y: wheel.position.y,
                z: wheel.position.z,
              },
              quaternion: {
                x: wheel.quaternion.x,
                y: wheel.quaternion.y,
                z: wheel.quaternion.z,
                w: wheel.quaternion.w,
              },
              scale: wheel.scale
                ? {
                    x: wheel.scale.x,
                    y: wheel.scale.y,
                    z: wheel.scale.z,
                  }
                : null,
              steeringAxis: wheel.steeringAxis
                ? {
                    x: wheel.steeringAxis.x,
                    y: wheel.steeringAxis.y,
                    z: wheel.steeringAxis.z,
                  }
                : null,
              spinAxis: wheel.spinAxis
                ? {
                    x: wheel.spinAxis.x,
                    y: wheel.spinAxis.y,
                    z: wheel.spinAxis.z,
                  }
                : null,
              steeringAngle: wheel.steeringAngle ?? null,
              spinAngle: wheel.spinAngle ?? null,
            }))
          : [],
      }
    : null;
  const character = presentation.character
    ? {
        animation: presentation.character.animation
          ? {
              clipName: presentation.character.animation.clipName,
              time: presentation.character.animation.time,
              duration: presentation.character.animation.duration,
              loop: presentation.character.animation.loop,
              timeScale: presentation.character.animation.timeScale,
              normalizedTime: presentation.character.animation.normalizedTime ?? null,
            }
          : null,
      }
    : null;
  if (!vehicle && !character) {
    return null;
  }
  return {
    vehicle,
    character,
  };
}

function isFiniteVector3Like(value: MultiuserPresentationVector3Like | null | undefined): value is MultiuserPresentationVector3Like {
  if (!value) {
    return false;
  }
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z);
}

function normalizeRemotePresentationAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI;
}

function interpolateWrappedAngle(current: number, target: number, alpha: number): number {
  const normalizedCurrent = normalizeRemotePresentationAngle(current);
  const normalizedTarget = normalizeRemotePresentationAngle(target);
  let delta = normalizedTarget - normalizedCurrent;
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return normalizeRemotePresentationAngle(normalizedCurrent + (delta * alpha));
}

function collectPrefabVehicleWheelNodeIds(prefab: NodePrefabData, idMap?: Map<string, string> | null): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();
  const stack: SceneNode[] = [prefab.root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    const component = node.components?.[VEHICLE_COMPONENT_TYPE] as SceneNodeComponentState<VehicleComponentProps> | undefined;
    const wheelProps = component?.enabled !== false ? component?.props?.wheels : null;
    if (Array.isArray(wheelProps)) {
      wheelProps.forEach((wheel) => {
        const nodeId = typeof wheel.nodeId === 'string' ? wheel.nodeId.trim() : '';
        if (!nodeId) {
          return;
        }
        const remappedNodeId = idMap?.get(nodeId) ?? nodeId;
        if (!remappedNodeId || seen.has(remappedNodeId)) {
          return;
        }
        seen.add(remappedNodeId);
        collected.push(remappedNodeId);
      });
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return collected;
}

function sanitizeRemoteMultiuserObject(object: THREE.Object3D): THREE.Object3D {
  const scale = object.scale.clone();
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.rotation.set(0, 0, 0);
  object.scale.copy(scale);
  object.name = `RemotePeer:${object.name || 'Object'}`;
  object.traverse((child) => {
    const sourceUserData = (child.userData ?? {}) as Record<string, unknown>;
    const nextUserData: Record<string, unknown> = {
      remoteMultiuserPeer: true,
    };
    if (typeof sourceUserData.nodeId === 'string' && sourceUserData.nodeId.trim().length) {
      nextUserData.nodeId = sourceUserData.nodeId.trim();
    }
    if (typeof sourceUserData.nodeType === 'string' && sourceUserData.nodeType.trim().length) {
      nextUserData.nodeType = sourceUserData.nodeType.trim();
    }
    if (typeof sourceUserData.sourceAssetId === 'string' && sourceUserData.sourceAssetId.trim().length) {
      nextUserData.sourceAssetId = sourceUserData.sourceAssetId.trim();
    }
    if (typeof sourceUserData.sourceAssetUrl === 'string' && sourceUserData.sourceAssetUrl.trim().length) {
      nextUserData.sourceAssetUrl = sourceUserData.sourceAssetUrl.trim();
    }
    child.userData = nextUserData;
    child.frustumCulled = false;
    if (child instanceof THREE.Mesh) {
      const mesh = child;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return object;
}

function disposeRemoteMultiuserObject(object: THREE.Object3D, ownsResources: boolean): void {
  if (ownsResources) {
    disposeObject(object);
    return;
  }
  object.parent?.remove(object);
}

function collectRemoteMultiuserWheelBindings(
  root: THREE.Object3D,
  wheelNodeIds: string[] | null,
): RemoteMultiuserWheelBinding[] {
  const bindings: RemoteMultiuserWheelBinding[] = [];
  const allowedWheelNodeIds = wheelNodeIds && wheelNodeIds.length ? new Set(wheelNodeIds) : null;
  root.traverse((child) => {
    const nodeId = typeof child.userData?.nodeId === 'string' ? child.userData.nodeId.trim() : '';
    if (!nodeId || nodeId === root.userData?.nodeId) {
      return;
    }
    if (allowedWheelNodeIds && !allowedWheelNodeIds.has(nodeId)) {
      return;
    }
    bindings.push({
      nodeId,
      object: child,
      basePosition: child.position.clone(),
      baseQuaternion: child.quaternion.clone(),
      baseScale: child.scale.clone(),
      instancedTargets: collectInstancedTransformTargets(child),
    });
  });
  if (allowedWheelNodeIds) {
    return bindings.filter((binding) => binding.nodeId && allowedWheelNodeIds.has(binding.nodeId));
  }
  return bindings;
}

function collectRemoteMultiuserAnimationControllers(root: THREE.Object3D): Map<string, RemoteMultiuserAnimationController> {
  const controllers = new Map<string, RemoteMultiuserAnimationController>();
  root.traverse((object) => {
    const nodeId = typeof object.userData?.nodeId === 'string' ? object.userData.nodeId.trim() : '';
    if (!nodeId) {
      return;
    }
    const clips = (object as unknown as { animations?: THREE.AnimationClip[] })?.animations;
    if (!Array.isArray(clips) || !clips.length) {
      return;
    }
    const validClips = clips.filter((clip): clip is THREE.AnimationClip => Boolean(clip));
    if (!validClips.length) {
      return;
    }
    const mixer = new THREE.AnimationMixer(object);
    const defaultClip = pickDefaultAnimationClip(validClips);
    let activeAction: THREE.AnimationAction | null = null;
    if (defaultClip) {
      activeAction = playAnimationClip(mixer, defaultClip, { loop: true });
    }
    controllers.set(nodeId, {
      nodeId,
      object,
      mixer,
      clips: validClips,
      defaultClip,
      activeAction,
      activeClipName: defaultClip?.name ?? null,
      activeLoop: true,
      activeTimeScale: 1,
    });
  });
  return controllers;
}

function attachRemoteMultiuserPeerRuntime(entry: RemoteMultiuserPeerEntry): void {
  if (!entry.root) {
    entry.wheelBindings = [];
    entry.animationControllers = new Map();
    return;
  }
  const presentationWheels = entry.targetState.presentation?.vehicle?.wheels ?? [];
  const wheelNodeIds = entry.wheelNodeIds.length
    ? entry.wheelNodeIds
    : presentationWheels.map((wheel) => (typeof wheel.nodeId === 'string' ? wheel.nodeId.trim() : '')).filter((nodeId) => nodeId.length);
  entry.wheelBindings = collectRemoteMultiuserWheelBindings(
    entry.root,
    wheelNodeIds.length ? wheelNodeIds : null,
  );
  entry.animationControllers = collectRemoteMultiuserAnimationControllers(entry.root);
}

function releaseRemoteMultiuserPeerRuntime(entry: RemoteMultiuserPeerEntry): void {
  entry.animationControllers.forEach((controller) => {
    try {
      controller.mixer.stopAllAction();
      const root = controller.mixer.getRoot();
      if (root) {
        controller.mixer.uncacheRoot(root);
      }
    } catch (error) {
      console.warn('[SceneryViewer] Failed to release remote multiuser animation controller', error);
    }
  });
  entry.animationControllers.clear();
  entry.wheelBindings = [];
}

function cloneRemoteMultiuserObjectFromRuntime(nodeId: string | null): THREE.Object3D | null {
  if (!nodeId) {
    return null;
  }
  const source = nodeObjectMap.get(nodeId) ?? null;
  if (!source) {
    return null;
  }
  if (source.children.length === 0) {
    return null;
  }
  const sourceNodeId = source.children[0].userData.nodeId;
  if (lazyPlaceholderStates.has(sourceNodeId)){
    return null;
  }
  return sanitizeRemoteMultiuserObject(cloneSkinned(source));
}

function cloneRemoteMultiuserObjectFromLocalRuntimePrefab(state: MultiuserPeerState): { object: THREE.Object3D; wheelNodeIds: string[] } | null {
  if (!isVehicleLikeMultiuserSubjectType(state.subjectType)) {
    return null;
  }
  const matchedVehicleRequest = resolveRemoteMultiuserVehiclePrefabRequest(state);
  if (!matchedVehicleRequest) {
    return null;
  }
  const requestKey = buildRuntimePrefabRequestKey(matchedVehicleRequest);
  const spawnedEntry = spawnedRuntimePrefabRoots.get(requestKey) ?? null;
  const spawnedRoot = spawnedEntry?.root ?? null;
  if (!spawnedRoot) {
    return null;
  }
  return {
    object: sanitizeRemoteMultiuserObject(cloneSkinned(spawnedRoot)),
    wheelNodeIds: spawnedEntry?.wheelNodeIds ?? [],
  };
}

function stripRemoteMultiuserPrefabRuntimeComponents(node: SceneNode | null | undefined): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (node.components && typeof node.components === 'object') {
    delete node.components;
  }
  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => stripRemoteMultiuserPrefabRuntimeComponents(child));
  }
}

function resolveRemoteMultiuserPrefabSpawnRequest(state: MultiuserPeerState): RuntimePrefabSpawnRequest | null {
  const matchedVehicleRequest = resolveRemoteMultiuserVehiclePrefabRequest(state);
  const candidateAssetId = typeof state.subjectAssetId === 'string' && state.subjectAssetId.trim().length
    ? state.subjectAssetId.trim()
    : typeof matchedVehicleRequest?.assetId === 'string' && matchedVehicleRequest.assetId.trim().length
      ? matchedVehicleRequest.assetId.trim()
      : '';
  const candidateAssetUrl = typeof state.subjectAssetUrl === 'string' && state.subjectAssetUrl.trim().length
    ? state.subjectAssetUrl.trim()
    : typeof matchedVehicleRequest?.assetUrl === 'string' && matchedVehicleRequest.assetUrl.trim().length
      ? matchedVehicleRequest.assetUrl.trim()
      : '';
  const candidateAssetRef = candidateAssetId || candidateAssetUrl;
  if (!candidateAssetRef) {
    return null;
  }
  const assetType = inferAssetTypeOrNull({ nameOrUrl: candidateAssetRef });
  if (assetType !== 'prefab' && !candidateAssetRef.toLowerCase().endsWith('.prefab')) {
    return null;
  }
  return normalizeRuntimePrefabRequest({
    requestId: matchedVehicleRequest?.requestId ?? null,
    vehicleIdentifier: state.subjectIdentifier ?? matchedVehicleRequest?.vehicleIdentifier ?? null,
    assetId: candidateAssetId || candidateAssetRef,
    assetUrl: candidateAssetUrl || null,
    targetNodeId: matchedVehicleRequest?.targetNodeId ?? null,
    targetNodeName: matchedVehicleRequest?.targetNodeName ?? null,
    position: null,
    rotation: null,
    scale: null,
    initializationMode: 'render-only',
    placement: null,
  });
}

function resolveRemoteMultiuserVehiclePrefabRequest(state: MultiuserPeerState): RuntimePrefabSpawnRequest | null {
  if (!isVehicleLikeMultiuserSubjectType(state.subjectType)) {
    return null;
  }
  const subjectIdentifier = typeof state.subjectIdentifier === 'string' ? state.subjectIdentifier.trim() : '';
  const subjectNodeId = typeof state.subjectNodeId === 'string' ? state.subjectNodeId.trim() : '';
  const subjectNodeName = subjectNodeId
    ? resolveNodeById(subjectNodeId)?.name ?? null
    : null;
  return findMatchingSteerRuntimePrefabRequest(props.runtimePrefabSpawns, subjectIdentifier || null)
    ?? findRuntimePrefabRequestByVehicleNode(props.runtimePrefabSpawns, subjectNodeId || null, subjectNodeName)
    ?? null;
}

async function loadRemoteMultiuserPrefabObject(state: MultiuserPeerState): Promise<{ object: THREE.Object3D; wheelNodeIds: string[] } | null> {
  const sourceRequest = resolveRemoteMultiuserPrefabSpawnRequest(state);
  if (!sourceRequest) {
    return null;
  }
  try {
    const source = await resolveRuntimePrefabSource(sourceRequest, runtimePrefabSourceResolverOptions);
    if (!source) {
      return null;
    }
    const cloned = cloneRuntimePrefabNode(source.prefab);

    stripRemoteMultiuserPrefabRuntimeComponents(cloned.root);
    const runtimeDocument = createRuntimePrefabDocument(source.prefab, cloned.root);
    const buildOptions: SceneGraphBuildOptions = {};
    if (typeof props.serverAssetBaseUrl === 'string' && props.serverAssetBaseUrl.trim().length) {
      buildOptions.serverAssetBaseUrl = props.serverAssetBaseUrl.trim();
    }
    const resourceCache = ensureResourceCache(runtimeDocument, buildOptions);
    const graph = await buildSceneGraph(runtimeDocument, resourceCache, buildOptions);
    graph.root.userData = {
      ...(graph.root.userData ?? {}),
      nodeId: cloned.root.id ?? sourceRequest.assetId ?? null,
    };
    if (graph.root.children.length === 0) {
      return null;
    }
    const rootNode = graph.root.children[0];
    applyWeChatShadowPolicy(rootNode);
    return {
      object: sanitizeRemoteMultiuserObject(rootNode),
      wheelNodeIds: isVehicleLikeMultiuserSubjectType(state.subjectType) ? collectPrefabVehicleWheelNodeIds(source.prefab, cloned.idMap) : [],
    };
  } catch (error) {
    console.warn('[SceneryViewer] Failed to instantiate remote multiuser prefab', {
      assetId: sourceRequest.assetId ?? null,
      assetUrl: sourceRequest.assetUrl ?? null,
      subjectNodeId: state.subjectNodeId,
      error,
    });
    return null;
  }
}

async function loadRemoteMultiuserObjectFromAsset(state: MultiuserPeerState): Promise<THREE.Object3D | null> {
  const resourceCache = viewerResourceCache;
  const matchedVehicleRequest = resolveRemoteMultiuserVehiclePrefabRequest(state);
  const assetId = typeof state.subjectAssetId === 'string' && state.subjectAssetId.trim().length
    ? state.subjectAssetId.trim()
    : typeof matchedVehicleRequest?.assetId === 'string' && matchedVehicleRequest.assetId.trim().length
      ? matchedVehicleRequest.assetId.trim()
      : typeof state.subjectAssetUrl === 'string' && state.subjectAssetUrl.trim().length
        ? state.subjectAssetUrl.trim()
      : typeof matchedVehicleRequest?.assetUrl === 'string' && matchedVehicleRequest.assetUrl.trim().length
          ? matchedVehicleRequest.assetUrl.trim()
          : '';
  if (!resourceCache || !assetId) {
    return null;
  }
  if (inferAssetTypeOrNull({ nameOrUrl: assetId }) === 'prefab' || assetId.toLowerCase().endsWith('.prefab')) {
    return null;
  }
  const sampleNode = state.subjectNodeId ? resolveNodeById(state.subjectNodeId) : null;
  try {
    const object = await loadNodeObject(resourceCache, assetId, sampleNode?.importMetadata ?? null);
    if (!object) {
      return null;
    }
    prepareImportedObjectForPreview(object);
    return sanitizeRemoteMultiuserObject(object);
  } catch (error) {
    console.warn('[SceneryViewer] Failed to load remote multiuser asset', {
      assetId,
      subjectNodeId: state.subjectNodeId,
      error,
    });
    return null;
  }
}

async function createRemoteMultiuserPeerObject(state: MultiuserPeerState): Promise<{ object: THREE.Object3D; ownsResources: boolean; wheelNodeIds: string[] }> {
  const localRuntimePrefabClone = cloneRemoteMultiuserObjectFromLocalRuntimePrefab(state);
  if (localRuntimePrefabClone) {
    return { object: localRuntimePrefabClone.object, ownsResources: false, wheelNodeIds: localRuntimePrefabClone.wheelNodeIds };
  }
  const runtimeClone = cloneRemoteMultiuserObjectFromRuntime(state.subjectNodeId);
  if (runtimeClone) {
    return { object: runtimeClone, ownsResources: false, wheelNodeIds: [] };
  }
  const prefabObject = await loadRemoteMultiuserPrefabObject(state);
  if (prefabObject) {
    return { object: prefabObject.object, ownsResources: true, wheelNodeIds: prefabObject.wheelNodeIds };
  }
  const resourceObject = await loadRemoteMultiuserObjectFromAsset(state);
  if (resourceObject) {
    return { object: resourceObject, ownsResources: true, wheelNodeIds: [] };
  }
  return { object: createRemoteMultiuserPlaceholder(state.subjectType), ownsResources: true, wheelNodeIds: [] };
}

function applyRemoteMultiuserPeerTransform(object: THREE.Object3D, state: MultiuserPeerState): void {
  object.position.set(state.position.x, state.position.y, state.position.z);
  object.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w);
  object.scale.set(state.scale.x, state.scale.y, state.scale.z);
  object.visible = true;
  object.updateWorldMatrix(true, false);
}

function applyRemoteMultiuserVehicleWheelState(
  binding: RemoteMultiuserWheelBinding,
  wheelState: MultiuserVehicleWheelPresentation,
): void {
  const object = binding.object;
  if (!object) {
    return;
  }
  remoteMultiuserWheelPositionScratch.set(wheelState.position.x, wheelState.position.y, wheelState.position.z);
  object.position.copy(remoteMultiuserWheelPositionScratch);
  if (wheelState.scale) {
    remoteMultiuserWheelScaleScratch.set(wheelState.scale.x, wheelState.scale.y, wheelState.scale.z);
    object.scale.copy(remoteMultiuserWheelScaleScratch);
  } else {
    object.scale.copy(binding.baseScale);
  }
  const steeringAngle = typeof wheelState.steeringAngle === 'number' && Number.isFinite(wheelState.steeringAngle)
    ? wheelState.steeringAngle
    : null;
  const spinAngle = typeof wheelState.spinAngle === 'number' && Number.isFinite(wheelState.spinAngle)
    ? wheelState.spinAngle
    : null;
  const steeringAxis = wheelState.steeringAxis && isFiniteVector3Like(wheelState.steeringAxis)
    ? remoteMultiuserWheelSteeringAxisScratch.set(wheelState.steeringAxis.x, wheelState.steeringAxis.y, wheelState.steeringAxis.z).normalize()
    : null;
  const spinAxis = wheelState.spinAxis && isFiniteVector3Like(wheelState.spinAxis)
    ? remoteMultiuserWheelSpinAxisScratch.set(wheelState.spinAxis.x, wheelState.spinAxis.y, wheelState.spinAxis.z).normalize()
    : null;
  if (steeringAxis && spinAxis && steeringAngle !== null && spinAngle !== null) {
    wheelVisualQuaternionHelper.copy(binding.baseQuaternion);
    wheelSteeringQuaternionHelper.setFromAxisAngle(steeringAxis, steeringAngle);
    wheelSpinQuaternionHelper.setFromAxisAngle(spinAxis, spinAngle);
    wheelVisualQuaternionHelper.premultiply(wheelSteeringQuaternionHelper);
    wheelVisualQuaternionHelper.multiply(wheelSpinQuaternionHelper);
    object.quaternion.copy(wheelVisualQuaternionHelper);
  } else {
    remoteMultiuserWheelQuaternionScratch.set(
      wheelState.quaternion.x,
      wheelState.quaternion.y,
      wheelState.quaternion.z,
      wheelState.quaternion.w,
    );
    object.quaternion.copy(remoteMultiuserWheelQuaternionScratch);
  }
  object.updateWorldMatrix(false, true);
  if (binding.instancedTargets.length) {
    binding.instancedTargets.forEach((target) => {
      target.updateWorldMatrix(false, true);
    });
  }
}

function applyRemoteMultiuserVehiclePresentation(
  entry: RemoteMultiuserPeerEntry,
  presentation: MultiuserVehiclePresentation | null | undefined,
  alpha: number,
): void {
  if (!presentation || !Array.isArray(presentation.wheels) || !presentation.wheels.length) {
    return;
  }
  const wheelBindings = entry.wheelBindings;
  if (!Array.isArray(wheelBindings) || !wheelBindings.length) {
    return;
  }
  const wheelStateByNodeId = new Map<string, MultiuserVehicleWheelPresentation>();
  presentation.wheels.forEach((wheel) => {
    const nodeId = typeof wheel.nodeId === 'string' ? wheel.nodeId.trim() : '';
    if (nodeId) {
      wheelStateByNodeId.set(nodeId, wheel);
    }
  });
  wheelBindings.forEach((binding, index) => {
    const wheelState = (binding.nodeId ? wheelStateByNodeId.get(binding.nodeId) ?? null : null)
      ?? presentation.wheels[index]
      ?? null;
    if (!wheelState) {
      return;
    }
    if (alpha >= 1 || !binding.object) {
      applyRemoteMultiuserVehicleWheelState(binding, wheelState);
      return;
    }
    remoteMultiuserWheelCurrentPositionScratch.copy(binding.object.position);
    remoteMultiuserWheelCurrentPositionScratch.lerp(
      remoteMultiuserWheelTargetPositionScratch.set(wheelState.position.x, wheelState.position.y, wheelState.position.z),
      alpha,
    );
    remoteMultiuserWheelCurrentQuaternionScratch.copy(binding.object.quaternion);
    remoteMultiuserWheelCurrentQuaternionScratch.slerp(
      remoteMultiuserWheelTargetQuaternionScratch.set(
        wheelState.quaternion.x,
        wheelState.quaternion.y,
        wheelState.quaternion.z,
        wheelState.quaternion.w,
      ),
      alpha,
    );
    binding.object.position.copy(remoteMultiuserWheelCurrentPositionScratch);
    binding.object.quaternion.copy(remoteMultiuserWheelCurrentQuaternionScratch);
    if (wheelState.scale) {
      remoteMultiuserWheelCurrentScaleScratch.copy(binding.object.scale);
      remoteMultiuserWheelCurrentScaleScratch.lerp(
        remoteMultiuserWheelScaleScratch.set(wheelState.scale.x, wheelState.scale.y, wheelState.scale.z),
        alpha,
      );
      binding.object.scale.copy(remoteMultiuserWheelCurrentScaleScratch);
    }
    binding.object.updateWorldMatrix(false, true);
  });
}

function applyRemoteMultiuserAnimationControllerState(
  controller: RemoteMultiuserAnimationController,
  animation: MultiuserCharacterAnimationPresentation | null | undefined,
  deltaSeconds: number,
): void {
  const mixer = controller.mixer;
  if (!animation) {
    mixer.update(deltaSeconds);
    return;
  }
  const requestedClipName = typeof animation.clipName === 'string' && animation.clipName.trim().length
    ? animation.clipName.trim()
    : null;
  const clip = requestedClipName
    ? controller.clips.find((entry) => entry.name === requestedClipName) ?? controller.defaultClip
    : controller.defaultClip;
  if (!clip) {
    mixer.update(deltaSeconds);
    return;
  }
  if (controller.activeClipName !== clip.name) {
    mixer.stopAllAction();
    controller.activeAction = playAnimationClip(mixer, clip, { loop: Boolean(animation.loop) });
    controller.activeClipName = clip.name ?? null;
  }
  if (controller.activeAction) {
    controller.activeAction.timeScale = Number.isFinite(animation.timeScale) ? animation.timeScale : 1;
    controller.activeTimeScale = controller.activeAction.timeScale;
    controller.activeAction.clampWhenFinished = !animation.loop;
    controller.activeLoop = animation.loop;
    controller.activeAction.play();
  }
  mixer.update(deltaSeconds);
}

function interpolateRemoteMultiuserPeerPresentation(
  display: MultiuserPeerPresentationState | null,
  target: MultiuserPeerPresentationState | null,
  alpha: number,
): MultiuserPeerPresentationState | null {
  if (!target) {
    return null;
  }
  if (!display) {
    return cloneRemoteMultiuserPeerPresentation(target);
  }
  const next = cloneRemoteMultiuserPeerPresentation(display) ?? cloneRemoteMultiuserPeerPresentation(target);
  if (!next) {
    return null;
  }
  if (target.vehicle?.wheels?.length) {
    const targetWheels = target.vehicle.wheels;
    const displayWheels = display.vehicle?.wheels ?? [];
    next.vehicle = {
      wheels: targetWheels.map((wheel, index) => {
        const currentWheel = displayWheels[index] ?? wheel;
        remoteMultiuserWheelCurrentPositionScratch.set(currentWheel.position.x, currentWheel.position.y, currentWheel.position.z);
        remoteMultiuserWheelTargetPositionScratch.set(wheel.position.x, wheel.position.y, wheel.position.z);
        remoteMultiuserWheelCurrentPositionScratch.lerp(remoteMultiuserWheelTargetPositionScratch, alpha);
        remoteMultiuserWheelCurrentQuaternionScratch.set(
          currentWheel.quaternion.x,
          currentWheel.quaternion.y,
          currentWheel.quaternion.z,
          currentWheel.quaternion.w,
        );
        remoteMultiuserWheelTargetQuaternionScratch.set(
          wheel.quaternion.x,
          wheel.quaternion.y,
          wheel.quaternion.z,
          wheel.quaternion.w,
        );
        remoteMultiuserWheelCurrentQuaternionScratch.slerp(remoteMultiuserWheelTargetQuaternionScratch, alpha);
        let scale: MultiuserPresentationVector3Like | null = null;
        if (wheel.scale) {
          if (currentWheel.scale) {
            remoteMultiuserWheelCurrentScaleScratch.set(currentWheel.scale.x, currentWheel.scale.y, currentWheel.scale.z);
            remoteMultiuserWheelScaleScratch.set(wheel.scale.x, wheel.scale.y, wheel.scale.z);
            remoteMultiuserWheelCurrentScaleScratch.lerp(remoteMultiuserWheelScaleScratch, alpha);
            scale = {
              x: remoteMultiuserWheelCurrentScaleScratch.x,
              y: remoteMultiuserWheelCurrentScaleScratch.y,
              z: remoteMultiuserWheelCurrentScaleScratch.z,
            };
          } else {
            scale = {
              x: wheel.scale.x,
              y: wheel.scale.y,
              z: wheel.scale.z,
            };
          }
        } else if (currentWheel.scale) {
          scale = {
            x: currentWheel.scale.x,
            y: currentWheel.scale.y,
            z: currentWheel.scale.z,
          };
        }
        const steeringAxis = wheel.steeringAxis
          ? {
              x: wheel.steeringAxis.x,
              y: wheel.steeringAxis.y,
              z: wheel.steeringAxis.z,
            }
          : currentWheel.steeringAxis ?? null;
        const spinAxis = wheel.spinAxis
          ? {
              x: wheel.spinAxis.x,
              y: wheel.spinAxis.y,
              z: wheel.spinAxis.z,
            }
          : currentWheel.spinAxis ?? null;
        const steeringAngle = typeof wheel.steeringAngle === 'number'
          ? (typeof currentWheel.steeringAngle === 'number'
              ? currentWheel.steeringAngle + ((wheel.steeringAngle - currentWheel.steeringAngle) * alpha)
              : wheel.steeringAngle)
          : currentWheel.steeringAngle ?? null;
        const spinAngle = typeof wheel.spinAngle === 'number'
          ? interpolateWrappedAngle(
              typeof currentWheel.spinAngle === 'number' ? currentWheel.spinAngle : wheel.spinAngle,
              wheel.spinAngle,
              alpha,
            )
          : currentWheel.spinAngle ?? null;
        return {
          nodeId: wheel.nodeId ?? null,
          wheelIndex: wheel.wheelIndex,
          position: {
            x: remoteMultiuserWheelCurrentPositionScratch.x,
            y: remoteMultiuserWheelCurrentPositionScratch.y,
            z: remoteMultiuserWheelCurrentPositionScratch.z,
          },
          quaternion: {
            x: remoteMultiuserWheelCurrentQuaternionScratch.x,
            y: remoteMultiuserWheelCurrentQuaternionScratch.y,
            z: remoteMultiuserWheelCurrentQuaternionScratch.z,
            w: remoteMultiuserWheelCurrentQuaternionScratch.w,
          },
          scale: scale
            ? {
                x: scale.x,
                y: scale.y,
                z: scale.z,
              }
            : null,
          steeringAxis,
          spinAxis,
          steeringAngle,
          spinAngle,
        };
      }),
    };
  }
  if (target.character?.animation) {
    const targetAnimation = target.character.animation;
    const displayAnimation = display.character?.animation ?? targetAnimation;
    const clipName = targetAnimation.clipName ?? displayAnimation.clipName ?? null;
    const time = displayAnimation.clipName === targetAnimation.clipName
      ? displayAnimation.time + ((targetAnimation.time - displayAnimation.time) * alpha)
      : targetAnimation.time;
    const duration = targetAnimation.duration || displayAnimation.duration || 0;
    const timeScale = displayAnimation.timeScale + ((targetAnimation.timeScale - displayAnimation.timeScale) * alpha);
    next.character = {
      animation: {
        clipName,
        time,
        duration,
        loop: targetAnimation.loop,
        timeScale,
        normalizedTime: duration > 0 ? time / duration : null,
      },
    };
  }
  return next;
}

function updateRemoteMultiuserPeerTransform(entry: RemoteMultiuserPeerEntry, deltaSeconds: number): void {
  const smoothingSeconds = REMOTE_MULTIUSER_SMOOTHING_SECONDS;
  const alpha = 1 - Math.exp(-Math.max(0, deltaSeconds) / smoothingSeconds);
  const targetState = entry.targetState;
  const displayState = entry.displayState;

  if (!displayState) {
    entry.displayState = cloneRemoteMultiuserPeerState(targetState);
    if (entry.root) {
      applyRemoteMultiuserPeerTransform(entry.root, targetState);
    }
    applyRemoteMultiuserPeerRuntime(entry, targetState, 1, deltaSeconds);
    return;
  }

  remoteMultiuserDisplayPositionScratch.set(
    displayState.position.x,
    displayState.position.y,
    displayState.position.z,
  );
  remoteMultiuserTargetPositionScratch.set(
    targetState.position.x,
    targetState.position.y,
    targetState.position.z,
  );
  remoteMultiuserDisplayPositionScratch.lerp(remoteMultiuserTargetPositionScratch, alpha);
  displayState.position.x = remoteMultiuserDisplayPositionScratch.x;
  displayState.position.y = remoteMultiuserDisplayPositionScratch.y;
  displayState.position.z = remoteMultiuserDisplayPositionScratch.z;

  remoteMultiuserDisplayQuaternionScratch.set(
    displayState.quaternion.x,
    displayState.quaternion.y,
    displayState.quaternion.z,
    displayState.quaternion.w,
  );
  remoteMultiuserTargetQuaternionScratch.set(
    targetState.quaternion.x,
    targetState.quaternion.y,
    targetState.quaternion.z,
    targetState.quaternion.w,
  );
  remoteMultiuserDisplayQuaternionScratch.slerp(remoteMultiuserTargetQuaternionScratch, alpha);
  displayState.quaternion.x = remoteMultiuserDisplayQuaternionScratch.x;
  displayState.quaternion.y = remoteMultiuserDisplayQuaternionScratch.y;
  displayState.quaternion.z = remoteMultiuserDisplayQuaternionScratch.z;
  displayState.quaternion.w = remoteMultiuserDisplayQuaternionScratch.w;

  if (entry.root) {
    applyRemoteMultiuserPeerTransform(entry.root, displayState);
  }
  displayState.presentation = interpolateRemoteMultiuserPeerPresentation(displayState.presentation ?? null, targetState.presentation ?? null, alpha);
  applyRemoteMultiuserPeerRuntime(entry, displayState, alpha, deltaSeconds);
}

function applyRemoteMultiuserPeerRuntime(
  entry: RemoteMultiuserPeerEntry,
  state: MultiuserPeerState,
  alpha: number,
  deltaSeconds: number,
): void {
  if (!state.presentation) {
    entry.animationControllers.forEach((controller) => {
      controller.mixer.update(deltaSeconds);
    });
    return;
  }
  if (isVehicleLikeMultiuserSubjectType(state.subjectType)) {
    applyRemoteMultiuserVehiclePresentation(entry, state.presentation.vehicle ?? null, alpha);
  }
  const animation = state.presentation.character?.animation ?? null;
  if (animation) {
    entry.animationControllers.forEach((controller) => {
      applyRemoteMultiuserAnimationControllerState(controller, animation, deltaSeconds);
    });
    return;
  }
  entry.animationControllers.forEach((controller) => {
    controller.mixer.update(deltaSeconds);
  });
}

function disposeRemoteMultiuserPeerRender(entry: RemoteMultiuserPeerEntry): void {
  if (entry.root) {
    runtimeDetachRemoteMultiuserNickname(entry);
    entry.root.parent?.remove(entry.root);
    releaseRemoteMultiuserPeerRuntime(entry);
    disposeRemoteMultiuserObject(entry.root, entry.ownsResources);
  }
  entry.root = null;
  entry.visible = false;
  entry.displayState = null;
  entry.rootSignature = '';
}

function runtimeDetachRemoteMultiuserNickname(entry: RemoteMultiuserPeerEntry): void {
  const runtime = entry.nicknameRuntime;
  if (!runtime) {
    return;
  }
  runtime.sprite.parent?.remove(runtime.sprite);
}

function attachRemoteMultiuserPeerRender(entry: RemoteMultiuserPeerEntry, frameIndex: number): void {
  if (!entry.root) {
    return;
  }
  const root = ensureRemoteMultiuserPeerRoot();
  if (!root) {
    return;
  }
  if (entry.root.parent !== root) {
    entry.root.parent?.remove(entry.root);
    root.add(entry.root);
  }
  if (!entry.wheelBindings.length && !entry.animationControllers.size) {
    attachRemoteMultiuserPeerRuntime(entry);
  }
  const displayState = entry.displayState ?? cloneRemoteMultiuserPeerState(entry.targetState);
  entry.displayState = displayState;
  applyRemoteMultiuserPeerTransform(entry.root, displayState);
  applyRemoteMultiuserPeerRuntime(entry, displayState, 1, 0);
  syncRemoteMultiuserNicknameRuntime(entry);
  markRemoteMultiuserPeerVisible(entry, frameIndex);
  markInstancedCullingDirty();
}

function ensureRemoteMultiuserPeerVisible(userId: string, entry: RemoteMultiuserPeerEntry, frameIndex: number): void {
  const root = ensureRemoteMultiuserPeerRoot();
  if (entry.root && entry.rootSignature === entry.signature) {
    const subjectNodeId = typeof entry.targetState.subjectNodeId === 'string'
      ? entry.targetState.subjectNodeId.trim()
      : '';
    const shouldRetryWithRealObject = isRemoteMultiuserPlaceholderObject(entry.root)
      && Boolean(subjectNodeId)
      && Boolean(nodeObjectMap.get(subjectNodeId) ?? null);
    if (shouldRetryWithRealObject) {
      disposeRemoteMultiuserPeerRender(entry);
    } else {
      if (!entry.visible || (root && entry.root.parent !== root)) {
        attachRemoteMultiuserPeerRender(entry, frameIndex);
      }
      return;
    }
  }

  if (entry.root && entry.rootSignature !== entry.signature) {
    disposeRemoteMultiuserPeerRender(entry);
  } else if (entry.visible && entry.root) {
    disposeRemoteMultiuserPeerRender(entry);
  }

  if (!root) {
    return;
  }

  const currentLoadToken = (remoteMultiuserPeerLoadTokens.get(userId) ?? 0) + 1;
  remoteMultiuserPeerLoadTokens.set(userId, currentLoadToken);
  entry.loadToken = currentLoadToken;

  const placeholder = createRemoteMultiuserPlaceholder(entry.targetState.subjectType);
  placeholder.name = `RemotePeer:${userId}`;
  root.add(placeholder);
  applyRemoteMultiuserPeerTransform(placeholder, entry.displayState ?? entry.targetState);
  entry.root = placeholder;
  entry.rootSignature = entry.signature;
  entry.ownsResources = true;
  entry.wheelBindings = [];
  entry.animationControllers = new Map();
  entry.displayState = cloneRemoteMultiuserPeerState(entry.displayState ?? entry.targetState);
  syncRemoteMultiuserNicknameRuntime(entry);
  markRemoteMultiuserPeerVisible(entry, frameIndex);
  markInstancedCullingDirty();

  void createRemoteMultiuserPeerObject(entry.targetState).then(({ object, ownsResources }) => {
    if (remoteMultiuserPeerLoadTokens.get(userId) !== currentLoadToken) {
      disposeRemoteMultiuserObject(object, ownsResources);
      return;
    }
    const latestEntry = remoteMultiuserPeerEntries.get(userId) ?? null;
    if (!latestEntry || latestEntry.signature !== entry.signature || !latestEntry.visible) {
      disposeRemoteMultiuserObject(object, ownsResources);
      return;
    }
    const currentRoot = latestEntry.root;
    if (currentRoot) {
      runtimeDetachRemoteMultiuserNickname(latestEntry);
      currentRoot.parent?.remove(currentRoot);
      releaseRemoteMultiuserPeerRuntime(latestEntry);
      disposeRemoteMultiuserObject(currentRoot, latestEntry.ownsResources);
    }
    object.name = `RemotePeer:${userId}`;
    root.add(object);
    applyRemoteMultiuserPeerTransform(object, latestEntry.displayState ?? latestEntry.targetState);
    const runtimeEntry: RemoteMultiuserPeerEntry = {
      ...latestEntry,
      root: object,
      ownsResources,
      rootSignature: latestEntry.signature,
    };
    attachRemoteMultiuserPeerRuntime(runtimeEntry);
    applyRemoteMultiuserPeerRuntime(runtimeEntry, runtimeEntry.displayState ?? runtimeEntry.targetState, 1, 0);
    syncRemoteMultiuserNicknameRuntime(runtimeEntry);
    markRemoteMultiuserPeerVisible(runtimeEntry, frameIndex);
    remoteMultiuserPeerEntries.set(userId, runtimeEntry);
    markInstancedCullingDirty();
  }).catch((error) => {
    console.warn('[SceneryViewer] Failed to create remote multiuser peer object', error);
  });
}

function syncRemoteMultiuserPeerVisibility(camera?: THREE.Camera | null): void {
  const activeCamera = camera ?? renderContext?.camera ?? null;
  if (!activeCamera) {
    return;
  }
  remoteMultiuserVisibilityFrame += 1;
  const frameIndex = remoteMultiuserVisibilityFrame;
  const visibleCandidates: Array<{
    userId: string;
    entry: RemoteMultiuserPeerEntry;
    distanceSq: number;
    stayPriority: number;
    residencyPriority: number;
  }> = [];

  cameraViewFrustum.setFromProjectionMatrix(tempCameraMatrix.multiplyMatrices(activeCamera.projectionMatrix, activeCamera.matrixWorldInverse));
  activeCamera.getWorldPosition(remoteMultiuserCameraPositionScratch);
  remoteMultiuserPeerEntries.forEach((entry, userId) => {
    const state = entry.targetState;
    remoteMultiuserTargetPositionScratch.set(state.position.x, state.position.y, state.position.z);
    tempSphere.center.copy(remoteMultiuserTargetPositionScratch);
    tempSphere.radius = getRemoteMultiuserPeerSelectionRadius(state);
    const inFrustum = cameraViewFrustum.intersectsSphere(tempSphere);
    if (inFrustum) {
      entry.lastInFrustumFrame = frameIndex;
    } else {
      entry.lastOutFrustumFrame = frameIndex;
    }
    if (!shouldKeepRemoteMultiuserPeerVisible(entry, frameIndex)) {
      if (entry.visible) {
        disposeRemoteMultiuserPeerRender(entry);
      }
      return;
    }
    const dx = remoteMultiuserTargetPositionScratch.x - remoteMultiuserCameraPositionScratch.x;
    const dy = remoteMultiuserTargetPositionScratch.y - remoteMultiuserCameraPositionScratch.y;
    const dz = remoteMultiuserTargetPositionScratch.z - remoteMultiuserCameraPositionScratch.z;
    const distanceSq = (dx * dx) + (dy * dy) + (dz * dz);
    visibleCandidates.push({
      userId,
      entry,
      distanceSq,
      stayPriority: entry.visible ? 0 : 1,
      residencyPriority: entry.visible && frameIndex - entry.visibleSinceFrame <= REMOTE_MULTIUSER_MIN_RESIDENCY_FRAMES ? 0 : 1,
    });
  });

  visibleCandidates.sort((a, b) => a.residencyPriority - b.residencyPriority || a.stayPriority - b.stayPriority || a.distanceSq - b.distanceSq);
  const selected = new Set<string>();
  const visibleLimit = Math.max(0, Math.min(remoteMultiuserVisiblePeerLimit, visibleCandidates.length));
  for (let index = 0; index < visibleLimit; index += 1) {
    const candidate = visibleCandidates[index];
    if (!candidate) {
      continue;
    }
    selected.add(candidate.userId);
  }

  remoteMultiuserPeerEntries.forEach((entry, userId) => {
    if (!selected.has(userId)) {
      if (entry.visible) {
        hideRemoteMultiuserPeer(entry);
      }
      return;
    }
    ensureRemoteMultiuserPeerVisible(userId, entry, frameIndex);
  });
}

function updateRemoteMultiuserPeers(deltaSeconds: number): void {
  if (!remoteMultiuserPeerEntries.size || deltaSeconds <= 0) {
    return;
  }
  remoteMultiuserPeerEntries.forEach((entry) => {
    if (!entry.visible) {
      return;
    }
    updateRemoteMultiuserPeerTransform(entry, deltaSeconds);
    updateRemoteMultiuserNicknameRuntime(entry);
  });
}

function removeRemoteMultiuserPeer(userId: string): void {
  clearRemoteMultiuserCharacterStateForUser(userId);
  const entry = remoteMultiuserPeerEntries.get(userId);
  if (!entry) {
    return;
  }
  disposeRemoteMultiuserPeerRender(entry);
  disposeRemoteMultiuserNicknameRuntime(entry);
  remoteMultiuserPeerEntries.delete(userId);
  remoteMultiuserPeerLoadTokens.delete(userId);
  syncRemoteMultiuserPeerVisibility();
  markInstancedCullingDirty();
}

function clearRemoteMultiuserPeers(): void {
  remoteMultiuserPeerEntries.forEach((entry) => {
    disposeRemoteMultiuserPeerRender(entry);
    disposeRemoteMultiuserNicknameRuntime(entry);
  });
  remoteMultiuserPeerEntries.clear();
  remoteMultiuserPeerLoadTokens.clear();
  remoteMultiuserCharacterStatesByNodeId.clear();
  remoteMultiuserCharacterNodeIdByUserId.clear();
  remoteMultiuserPeerRoot.clear();
  remoteMultiuserPeerRoot.parent?.remove(remoteMultiuserPeerRoot);
  markInstancedCullingDirty();
}

function cloneSharedEntityState(state: MultiuserNodeSyncState): MultiuserNodeSyncState {
  return {
    entityId: state.entityId,
    nodeId: state.nodeId,
    ownerUserId: state.ownerUserId ?? null,
    mode: state.mode,
    transform: {
      position: { ...state.transform.position },
      quaternion: { ...state.transform.quaternion },
      scale: { ...state.transform.scale },
    },
    revision: state.revision,
    updatedAt: state.updatedAt,
    lease: state.lease ? { ...state.lease } : null,
    presentation: cloneMultiuserNodeSyncPresentation(state.presentation ?? null),
  };
}

function cloneMultiuserNodeSyncPresentation(
  presentation: MultiuserNodeSyncPresentation | null | undefined,
): MultiuserNodeSyncPresentation | null {
  if (!presentation) {
    return null;
  }
  return {
    vehicle: presentation.vehicle
      ? {
          speedMps: presentation.vehicle.speedMps ?? null,
          linearVelocity: presentation.vehicle.linearVelocity
            ? { ...presentation.vehicle.linearVelocity }
            : null,
          wheels: Array.isArray(presentation.vehicle.wheels)
            ? presentation.vehicle.wheels.map((wheel) => ({
                nodeId: wheel.nodeId ?? null,
                wheelIndex: wheel.wheelIndex,
                position: { ...wheel.position },
                quaternion: { ...wheel.quaternion },
                scale: wheel.scale ? { ...wheel.scale } : null,
                steeringAxis: wheel.steeringAxis ? { ...wheel.steeringAxis } : null,
                spinAxis: wheel.spinAxis ? { ...wheel.spinAxis } : null,
                steeringAngle: wheel.steeringAngle ?? null,
                spinAngle: wheel.spinAngle ?? null,
              }))
            : [],
        }
      : null,
    character: presentation.character
      ? {
          animation: presentation.character.animation
            ? {
                clipName: presentation.character.animation.clipName,
                time: presentation.character.animation.time,
                duration: presentation.character.animation.duration,
                loop: presentation.character.animation.loop,
                timeScale: presentation.character.animation.timeScale,
                normalizedTime: presentation.character.animation.normalizedTime ?? null,
              }
            : null,
        }
      : null,
  };
}

function buildLocalNetworkSyncSignature(
  props: NetworkSyncComponentProps,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
  worldScale: THREE.Vector3,
): string {
  return [
    props.syncPosition ? `${worldPosition.x}|${worldPosition.y}|${worldPosition.z}` : '',
    props.syncRotation ? `${worldQuaternion.x}|${worldQuaternion.y}|${worldQuaternion.z}|${worldQuaternion.w}` : '',
    props.syncScale ? `${worldScale.x}|${worldScale.y}|${worldScale.z}` : '',
  ].join('|');
}

function applyNetworkSyncTransformToObject(
  object: THREE.Object3D,
  state: MultiuserNodeSyncState,
): void {
  remoteMultiuserTargetPositionScratch.set(
    state.transform.position.x,
    state.transform.position.y,
    state.transform.position.z,
  );
  remoteMultiuserTargetQuaternionScratch.set(
    state.transform.quaternion.x,
    state.transform.quaternion.y,
    state.transform.quaternion.z,
    state.transform.quaternion.w,
  );
  applySceneryPhysicsBridgeTransformToObject(object, remoteMultiuserTargetPositionScratch, remoteMultiuserTargetQuaternionScratch, null);
  if (state.transform.scale) {
    remoteSharedEntityTargetScaleScratch.set(
      state.transform.scale.x,
      state.transform.scale.y,
      state.transform.scale.z,
    );
    if (object.parent) {
      object.parent.updateWorldMatrix(true, false);
      const parentScale = object.parent.getWorldScale(remoteSharedEntityDisplayScaleScratch);
      object.scale.set(
        parentScale.x !== 0 ? remoteSharedEntityTargetScaleScratch.x / parentScale.x : remoteSharedEntityTargetScaleScratch.x,
        parentScale.y !== 0 ? remoteSharedEntityTargetScaleScratch.y / parentScale.y : remoteSharedEntityTargetScaleScratch.y,
        parentScale.z !== 0 ? remoteSharedEntityTargetScaleScratch.z / parentScale.z : remoteSharedEntityTargetScaleScratch.z,
      );
    } else {
      object.scale.copy(remoteSharedEntityTargetScaleScratch);
    }
    object.updateWorldMatrix(false, true);
    syncInstancedTransform(object, false, true);
  }
}

function updateRemoteSharedEntityTransforms(deltaSeconds: number): void {
  if (!remoteSharedEntityEntries.size || deltaSeconds <= 0) {
    return;
  }
  const alpha = 1 - Math.exp(-Math.max(0, deltaSeconds) / REMOTE_MULTIUSER_SMOOTHING_SECONDS);
  remoteSharedEntityEntries.forEach((entry) => {
    const runtimeEntry = networkSyncNodeEntries.get(entry.nodeId) ?? null;
    const props = runtimeEntry?.props ?? entry.props;
    const object = nodeObjectMap.get(entry.nodeId) ?? null;
    if (!object) {
      return;
    }
    if (!entry.displayState) {
      entry.displayState = cloneSharedEntityState(entry.targetState);
      applyNetworkSyncTransformToObject(object, entry.targetState);
      return;
    }
    const display = entry.displayState;
    const target = entry.targetState;
    const dx = target.transform.position.x - display.transform.position.x;
    const dy = target.transform.position.y - display.transform.position.y;
    const dz = target.transform.position.z - display.transform.position.z;
    const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    if (distance >= props.teleportThreshold) {
      entry.displayState = cloneSharedEntityState(target);
      applyNetworkSyncTransformToObject(object, target);
      return;
    }
    remoteMultiuserDisplayPositionScratch.set(
      display.transform.position.x,
      display.transform.position.y,
      display.transform.position.z,
    );
    remoteMultiuserTargetPositionScratch.set(
      target.transform.position.x,
      target.transform.position.y,
      target.transform.position.z,
    );
    remoteMultiuserDisplayPositionScratch.lerp(remoteMultiuserTargetPositionScratch, alpha);
    display.transform.position.x = remoteMultiuserDisplayPositionScratch.x;
    display.transform.position.y = remoteMultiuserDisplayPositionScratch.y;
    display.transform.position.z = remoteMultiuserDisplayPositionScratch.z;
    remoteMultiuserDisplayQuaternionScratch.set(
      display.transform.quaternion.x,
      display.transform.quaternion.y,
      display.transform.quaternion.z,
      display.transform.quaternion.w,
    );
    remoteMultiuserTargetQuaternionScratch.set(
      target.transform.quaternion.x,
      target.transform.quaternion.y,
      target.transform.quaternion.z,
      target.transform.quaternion.w,
    );
    remoteMultiuserDisplayQuaternionScratch.slerp(remoteMultiuserTargetQuaternionScratch, alpha);
    display.transform.quaternion.x = remoteMultiuserDisplayQuaternionScratch.x;
    display.transform.quaternion.y = remoteMultiuserDisplayQuaternionScratch.y;
    display.transform.quaternion.z = remoteMultiuserDisplayQuaternionScratch.z;
    display.transform.quaternion.w = remoteMultiuserDisplayQuaternionScratch.w;
    if (display.transform.scale && target.transform.scale) {
      remoteSharedEntityDisplayScaleScratch.set(
        display.transform.scale.x,
        display.transform.scale.y,
        display.transform.scale.z,
      );
      remoteSharedEntityTargetScaleScratch.set(
        target.transform.scale.x,
        target.transform.scale.y,
        target.transform.scale.z,
      );
      remoteSharedEntityDisplayScaleScratch.lerp(remoteSharedEntityTargetScaleScratch, alpha);
      display.transform.scale.x = remoteSharedEntityDisplayScaleScratch.x;
      display.transform.scale.y = remoteSharedEntityDisplayScaleScratch.y;
      display.transform.scale.z = remoteSharedEntityDisplayScaleScratch.z;
    } else if (target.transform.scale) {
      display.transform.scale = {
        x: target.transform.scale.x,
        y: target.transform.scale.y,
        z: target.transform.scale.z,
      };
    }
    applyNetworkSyncTransformToObject(object, display);
    applyRemoteNodeSyncPresentation(entry, display, alpha, deltaSeconds);
  });
}

function processRemoteSharedEntitySnapshot(snapshot: MultiuserNodeSyncSnapshot): void {
  const localIdentity = getNormalizedMultiuserIdentity();
  const state = snapshot.state;
  if (!state) {
    remoteSharedEntityEntries.delete(snapshot.entityId);
    return;
  }
  const runtimeEntry = networkSyncNodeEntries.get(state.nodeId);
  if (!runtimeEntry) {
    return;
  }
  runtimeEntry.ownerUserId = state.ownerUserId ?? null;
  runtimeEntry.localRevision = Math.max(runtimeEntry.localRevision, state.revision);
  runtimeEntry.updatedAt = state.updatedAt;
  runtimeEntry.lastLocalSignature = buildLocalNetworkSyncSignature(
    runtimeEntry.props,
    new THREE.Vector3(state.transform.position.x, state.transform.position.y, state.transform.position.z),
    new THREE.Quaternion(
      state.transform.quaternion.x,
      state.transform.quaternion.y,
      state.transform.quaternion.z,
      state.transform.quaternion.w,
    ),
    new THREE.Vector3(
      state.transform.scale?.x ?? 1,
      state.transform.scale?.y ?? 1,
      state.transform.scale?.z ?? 1,
    ),
  );
  if (localIdentity?.userId && state.ownerUserId === localIdentity.userId) {
    remoteSharedEntityEntries.delete(state.entityId);
    return;
  }
  remoteSharedEntityEntries.set(state.entityId, {
    entityId: state.entityId,
    nodeId: state.nodeId,
    props: runtimeEntry.props,
    targetState: cloneSharedEntityState(state),
    displayState: remoteSharedEntityEntries.get(state.entityId)?.displayState ?? null,
    presentation: cloneMultiuserNodeSyncPresentation(state.presentation ?? null),
  });
}

function processRemoteSharedEntityRemoved(entityId: string): void {
  const existing = remoteSharedEntityEntries.get(entityId) ?? null;
  if (existing) {
    const runtimeEntry = networkSyncNodeEntries.get(existing.nodeId);
    if (runtimeEntry) {
      runtimeEntry.ownerUserId = null;
    }
  }
  remoteSharedEntityEntries.delete(entityId);
}

function resetRemoteSharedEntities(): void {
  remoteSharedEntityEntries.clear();
  networkSyncNodeEntries.forEach((entry) => {
    entry.ownerUserId = null;
  });
}

function applyRemoteNodeSyncPresentation(
  entry: RemoteSharedEntityEntry,
  state: MultiuserNodeSyncState,
  alpha: number,
  deltaSeconds: number,
): void {
  const presentation = state.presentation ?? null;
  if (!presentation) {
    return;
  }
  const nodeId = entry.nodeId;
  if (presentation.vehicle) {
    applyRemoteNodeVehiclePresentation(nodeId, presentation.vehicle, alpha);
  }
  if (presentation.character?.animation) {
    applyRemoteNodeCharacterAnimationPresentation(nodeId, presentation.character.animation, deltaSeconds);
  }
}

function applyRemoteNodeVehiclePresentation(
  nodeId: string,
  presentation: MultiuserVehiclePresentation,
  alpha: number,
): void {
  if (!presentation || !Array.isArray(presentation.wheels) || !presentation.wheels.length) {
    return;
  }
  const vehicleInstance = vehicleInstances.get(nodeId) ?? null;
  const wheelBindings = vehicleInstance?.wheelBindings as VehicleWheelBinding[] | undefined;
  if (!Array.isArray(wheelBindings) || !wheelBindings.length) {
    return;
  }
  const wheelStateByNodeId = new Map<string, MultiuserVehicleWheelPresentation>();
  presentation.wheels.forEach((wheel) => {
    const wheelNodeId = typeof wheel.nodeId === 'string' ? wheel.nodeId.trim() : '';
    if (wheelNodeId) {
      wheelStateByNodeId.set(wheelNodeId, wheel);
    }
  });
  wheelBindings.forEach((binding, index) => {
    const wheelState = (binding.nodeId ? wheelStateByNodeId.get(binding.nodeId) ?? null : null)
      ?? presentation.wheels[index]
      ?? null;
    if (!wheelState) {
      return;
    }
    if (alpha >= 1 || !binding.object) {
      applyRemoteMultiuserVehicleWheelState(binding as unknown as RemoteMultiuserWheelBinding, wheelState);
      return;
    }
    remoteMultiuserWheelCurrentPositionScratch.copy(binding.object.position);
    remoteMultiuserWheelCurrentPositionScratch.lerp(
      remoteMultiuserWheelTargetPositionScratch.set(wheelState.position.x, wheelState.position.y, wheelState.position.z),
      alpha,
    );
    remoteMultiuserWheelCurrentQuaternionScratch.copy(binding.object.quaternion);
    remoteMultiuserWheelCurrentQuaternionScratch.slerp(
      remoteMultiuserWheelTargetQuaternionScratch.set(
        wheelState.quaternion.x,
        wheelState.quaternion.y,
        wheelState.quaternion.z,
        wheelState.quaternion.w,
      ),
      alpha,
    );
    binding.object.position.copy(remoteMultiuserWheelCurrentPositionScratch);
    binding.object.quaternion.copy(remoteMultiuserWheelCurrentQuaternionScratch);
    if (wheelState.scale) {
      remoteMultiuserWheelCurrentScaleScratch.copy(binding.object.scale);
      remoteMultiuserWheelCurrentScaleScratch.lerp(
        remoteMultiuserWheelScaleScratch.set(wheelState.scale.x, wheelState.scale.y, wheelState.scale.z),
        alpha,
      );
      binding.object.scale.copy(remoteMultiuserWheelCurrentScaleScratch);
    }
    binding.object.updateWorldMatrix(false, true);
  });
}

function applyRemoteNodeCharacterAnimationPresentation(
  nodeId: string,
  animation: MultiuserCharacterAnimationPresentation,
  deltaSeconds: number,
): void {
  const controller = nodeAnimationRuntime.get(nodeId) as {
    activeClipName: string | null;
    activeAction: THREE.AnimationAction | null;
    activeLoop: boolean;
    activeTimeScale: number;
    mixer: THREE.AnimationMixer;
  } | null;
  if (!controller) {
    return;
  }
  const clipName = typeof animation.clipName === 'string' && animation.clipName.trim().length
    ? animation.clipName.trim()
    : null;
  if (!clipName) {
    if (controller.activeAction) {
      nodeAnimationRuntime.stopNodeAnimation(nodeId, { restoreDefault: true });
    } else {
      nodeAnimationRuntime.restoreDefaultNodeAnimation(nodeId);
    }
    return;
  }
  const clip = nodeAnimationRuntime.resolveClip(nodeId, clipName);
  if (!clip) {
    return;
  }
  if (controller.activeClipName !== clip.name) {
    nodeAnimationRuntime.playNodeAnimation(nodeId, clip.name, {
      loop: animation.loop,
      timeScale: animation.timeScale,
    });
  }
  if (controller.activeAction) {
    controller.activeAction.timeScale = Number.isFinite(animation.timeScale) ? animation.timeScale : 1;
    controller.activeAction.clampWhenFinished = !animation.loop;
    controller.activeLoop = animation.loop;
    controller.activeTimeScale = controller.activeAction.timeScale;
  }
  if (deltaSeconds > 0) {
    controller.mixer.update(deltaSeconds);
  }
}

function getRemoteMultiuserPeerSignature(state: MultiuserPeerState): string {
  return [
    state.subjectType,
    state.subjectNodeId ?? '',
    state.subjectIdentifier ?? '',
    state.subjectAssetId ?? '',
    state.subjectAssetUrl ?? '',
  ].join('|');
}

function handleRemoteMultiuserPeerSnapshot(peer: MultiuserPeerSnapshot): void {
  const localIdentity = getNormalizedMultiuserIdentity();
  if (localIdentity && peer.userId === localIdentity.userId) {
    return;
  }
  if (!peer.state) {
    clearRemoteMultiuserCharacterStateForUser(peer.userId);
    removeRemoteMultiuserPeer(peer.userId);
    return;
  }
  syncRemoteMultiuserCharacterState(peer);
  const displayName = normalizeRemoteMultiuserDisplayName(peer.displayName, peer.userId);
  const signature = getRemoteMultiuserPeerSignature(peer.state);
  const existing = remoteMultiuserPeerEntries.get(peer.userId) ?? null;
  if (existing && existing.signature === signature) {
    existing.targetState = cloneRemoteMultiuserPeerState(peer.state);
    existing.displayName = displayName;
    if (!existing.displayState) {
      existing.displayState = cloneRemoteMultiuserPeerState(peer.state);
    }
    syncRemoteMultiuserNicknameRuntime(existing);
    syncRemoteMultiuserPeerVisibility();
    return;
  }
  const nextEntry = existing ?? createRemoteMultiuserPeerPlaceholderEntry(peer.state);
  nextEntry.signature = signature;
  nextEntry.displayName = displayName;
  nextEntry.targetState = cloneRemoteMultiuserPeerState(peer.state);
  nextEntry.displayState = nextEntry.displayState ?? cloneRemoteMultiuserPeerState(peer.state);
  syncRemoteMultiuserNicknameRuntime(nextEntry);
  remoteMultiuserPeerEntries.set(peer.userId, nextEntry);
  syncRemoteMultiuserPeerVisibility();
}

function resolveLocalMultiuserVehiclePresentation(nodeId: string): MultiuserVehiclePresentation | null {
  const vehicleInstance = vehicleInstances.get(nodeId) ?? null;
  if (!vehicleInstance || !Array.isArray(vehicleInstance.wheelBindings) || !vehicleInstance.wheelBindings.length) {
    const cachedPresentation = localMultiuserVehiclePresentationByNodeId.get(nodeId) ?? null;
    return cachedPresentation;
  }
  const chassisVelocity = vehicleInstance.vehicle?.chassisBody?.velocity ?? null;
  const wheels: MultiuserVehicleWheelPresentation[] = [];
  const wheelBindings = vehicleInstance.wheelBindings as VehicleWheelBinding[];
  wheelBindings.forEach((binding: VehicleWheelBinding, wheelIndex: number) => {
    const object = binding.object ?? (binding.nodeId ? nodeObjectMap.get(binding.nodeId) ?? null : null);
    if (!object) {
      return;
    }
    object.updateWorldMatrix(true, false);
    wheels.push({
      nodeId: binding.nodeId ?? null,
      wheelIndex,
      position: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
      },
      quaternion: {
        x: object.quaternion.x,
        y: object.quaternion.y,
        z: object.quaternion.z,
        w: object.quaternion.w,
      },
      scale: {
        x: object.scale.x,
        y: object.scale.y,
        z: object.scale.z,
      },
      steeringAxis: {
        x: binding.steeringAxis.x,
        y: binding.steeringAxis.y,
        z: binding.steeringAxis.z,
      },
      spinAxis: {
        x: binding.spinAxis.x,
        y: binding.spinAxis.y,
        z: binding.spinAxis.z,
      },
      steeringAngle: binding.lastSteeringAngle,
      spinAngle: binding.spinAngle,
    });
  });
  if (!wheels.length) {
    const cachedPresentation = localMultiuserVehiclePresentationByNodeId.get(nodeId) ?? null;
    return cachedPresentation;
  }
  const presentation = {
    speedMps: chassisVelocity
      ? Math.hypot(chassisVelocity.x ?? 0, chassisVelocity.y ?? 0, chassisVelocity.z ?? 0)
      : null,
    linearVelocity: chassisVelocity
      ? {
          x: chassisVelocity.x ?? 0,
          y: chassisVelocity.y ?? 0,
          z: chassisVelocity.z ?? 0,
        }
      : null,
    wheels,
  };
  localMultiuserVehiclePresentationByNodeId.set(nodeId, presentation);
  return presentation;
}

function resolveLocalMultiuserCharacterPresentation(nodeId: string): MultiuserCharacterPresentation | null {
  const animation = nodeAnimationRuntime.getPresentation(nodeId);
  if (animation) {
    localMultiuserCharacterPresentationByNodeId.set(nodeId, animation);
    return {
      animation,
    };
  }
  const cachedAnimation = localMultiuserCharacterPresentationByNodeId.get(nodeId) ?? null;
  if (!cachedAnimation) {
    return null;
  }
  return {
    animation: cachedAnimation,
  };
}

function resolveLocalMultiuserPeerState(): MultiuserPeerState | null {
  if (vehicleDriveActive.value && vehicleDriveNodeId.value) {
    const nodeId = vehicleDriveNodeId.value;
    const node = resolveNodeById(nodeId);
    const object = nodeObjectMap.get(nodeId) ?? null;
    if (object) {
      const steerBinding = resolveSteerBindingByTargetNodeId(currentDocument, nodeId);
      const resolvedSubjectType: MultiuserSubjectType = steerBinding?.steerProps.targetType === 'ship'
        ? 'ship'
        : steerBinding?.steerProps.targetType === 'aircraft'
          ? 'aircraft'
          : 'vehicle';
      const resolvedVehicleIdentifier = steerBinding?.steerProps.defaultIdentifier?.trim()
        || findRuntimePrefabRequestByVehicleNode(props.runtimePrefabSpawns, nodeId, node?.name ?? null)?.vehicleIdentifier?.trim()
        || props.defaultSteerIdentifier?.trim()
        || nodeId;
      const matchedRequest = findMatchingSteerRuntimePrefabRequest(
        props.runtimePrefabSpawns,
        resolvedVehicleIdentifier || null,
      ) ?? findRuntimePrefabRequestByVehicleNode(props.runtimePrefabSpawns, nodeId, node?.name ?? null);
      object.getWorldPosition(protagonistPosePosition);
      object.getWorldQuaternion(protagonistPoseQuaternion);
      object.getWorldScale(remoteSharedEntityTargetScaleScratch);
      const vehiclePresentation = resolveLocalMultiuserVehiclePresentation(nodeId);
      return {
        subjectType: resolvedSubjectType,
        subjectNodeId: nodeId,
        subjectIdentifier: resolvedVehicleIdentifier,
        subjectAssetId: typeof node?.sourceAssetId === 'string' && node.sourceAssetId.trim().length
          ? node.sourceAssetId.trim()
          : matchedRequest?.assetId ?? null,
        subjectAssetUrl: matchedRequest?.assetUrl ?? null,
        position: {
          x: protagonistPosePosition.x,
          y: protagonistPosePosition.y,
          z: protagonistPosePosition.z,
        },
        quaternion: {
          x: protagonistPoseQuaternion.x,
          y: protagonistPoseQuaternion.y,
          z: protagonistPoseQuaternion.z,
          w: protagonistPoseQuaternion.w,
        },
        scale: {
          x: remoteSharedEntityTargetScaleScratch.x,
          y: remoteSharedEntityTargetScaleScratch.y,
          z: remoteSharedEntityTargetScaleScratch.z,
        },
        presentation: vehiclePresentation
          ? {
              vehicle: vehiclePresentation,
              character: null,
            }
          : null,
      };
    }
  }

  const protagonistObject = findDefaultControlledCharacterObject();
  if (!protagonistObject) {
    return null;
  }
  const resolvedNodeId = protagonistObject.userData.nodeId;
  const node = resolveNodeById(resolvedNodeId);
  protagonistObject.getWorldPosition(protagonistPosePosition);
  protagonistObject.getWorldQuaternion(protagonistPoseQuaternion);
  protagonistObject.getWorldScale(remoteSharedEntityTargetScaleScratch);
  const characterPresentation = resolveLocalMultiuserCharacterPresentation(resolvedNodeId);
  return {
    subjectType: 'character',
    subjectNodeId: resolvedNodeId,
    subjectIdentifier: node?.name ?? resolvedNodeId,
    subjectAssetId: typeof node?.sourceAssetId === 'string' ? node.sourceAssetId : null,
    subjectAssetUrl: null,
    action: resolveLocalCharacterPeerAction(resolvedNodeId),
    position: {
      x: protagonistPosePosition.x,
      y: protagonistPosePosition.y,
      z: protagonistPosePosition.z,
    },
    quaternion: {
      x: protagonistPoseQuaternion.x,
      y: protagonistPoseQuaternion.y,
      z: protagonistPoseQuaternion.z,
      w: protagonistPoseQuaternion.w,
    },
    scale: {
      x: remoteSharedEntityTargetScaleScratch.x,
      y: remoteSharedEntityTargetScaleScratch.y,
      z: remoteSharedEntityTargetScaleScratch.z,
    },
    presentation: characterPresentation
      ? {
          vehicle: null,
          character: characterPresentation,
        }
      : null,
  };
}

function resolveLocalNodeSyncStates(): MultiuserNodeSyncState[] {
  const identity = getNormalizedMultiuserIdentity();
  if (!identity) {
    return [];
  }
  const states: MultiuserNodeSyncState[] = [];
  networkSyncNodeEntries.forEach((entry, nodeId) => {
    const node = resolveNodeById(nodeId);
    const object = nodeObjectMap.get(nodeId) ?? null;
    if (!object) {
      return;
    }
    object.updateWorldMatrix(true, false);
    object.getWorldPosition(protagonistPosePosition);
    object.getWorldQuaternion(protagonistPoseQuaternion);

    const worldScale = object.getWorldScale(remoteSharedEntityTargetScaleScratch);
    const signature = buildLocalNetworkSyncSignature(entry.props, protagonistPosePosition, protagonistPoseQuaternion, worldScale);
    if (!entry.lastLocalSignature) {
      entry.lastLocalSignature = signature;
      if (entry.ownerUserId !== identity.userId) {
        return;
      }
    }
    const changed = signature !== entry.lastLocalSignature;
    if (changed) {
      entry.localRevision += 1;
      entry.lastLocalSignature = signature;
      entry.ownerUserId = identity.userId;
      entry.updatedAt = new Date().toISOString();
    }
    if (entry.ownerUserId !== identity.userId && !changed) {
      return;
    }
    const vehiclePresentation = resolveVehicleComponent(node) ? resolveLocalMultiuserVehiclePresentation(nodeId) : null;
    const characterPresentation = resolveCharacterControllerComponent(node) ? resolveLocalMultiuserCharacterPresentation(nodeId) : null;
    states.push({
      entityId: nodeId,
      nodeId,
      ownerUserId: entry.ownerUserId ?? identity.userId,
      mode: 'transform',
      transform: {
        position: {
          x: protagonistPosePosition.x,
          y: protagonistPosePosition.y,
          z: protagonistPosePosition.z,
        },
        quaternion: {
          x: protagonistPoseQuaternion.x,
          y: protagonistPoseQuaternion.y,
          z: protagonistPoseQuaternion.z,
          w: protagonistPoseQuaternion.w,
        },
        scale: {
          x: worldScale.x,
          y: worldScale.y,
          z: worldScale.z,
        },
      },
      revision: entry.localRevision,
      updatedAt: entry.updatedAt,
      lease: {
        mode: 'lease',
        leaseMs: entry.props.leaseMs,
      },
      presentation: vehiclePresentation || characterPresentation
        ? {
            vehicle: vehiclePresentation,
            character: characterPresentation,
          }
        : null,
    });
  });
  return states;
}

const multiuserRuntimeBridge: MultiuserRuntimeBridge = {
  getIdentity() {
    return getNormalizedMultiuserIdentity();
  },
  resolveLocalPeerState() {
    return resolveLocalMultiuserPeerState();
  },
  resolveLocalNodeSyncStates() {
    return resolveLocalNodeSyncStates();
  },
  handleRemotePeerSnapshot(peer) {
    handleRemoteMultiuserPeerSnapshot(peer);
  },
  handleRemotePeerLeft(userId) {
    removeRemoteMultiuserPeer(userId);
  },
  handleRemoteNodeSyncSnapshot(snapshot) {
    processRemoteSharedEntitySnapshot(snapshot);
  },
  handleRemoteNodeSyncRemoved(entityId) {
    processRemoteSharedEntityRemoved(entityId);
  },
  clearRemotePeers() {
    clearRemoteMultiuserPeers();
  },
  clearRemoteNodeSync() {
    resetRemoteSharedEntities();
  },
};

function easeInOutCubic(t: number): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}


function resolveWatchTargetQuaternion(
  position: THREE.Vector3,
  target: THREE.Vector3,
  fallbackQuaternion: THREE.Quaternion,
): THREE.Quaternion {
  if (position.distanceToSquared(target) < 1e-8) {
    return tempQuaternionVec.copy(fallbackQuaternion);
  }
  cameraWatchLookMatrixScratch.lookAt(position, target, worldUp);
  return tempQuaternionVec.setFromRotationMatrix(cameraWatchLookMatrixScratch);
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
  const progressBucket = Math.min(10, Math.floor((eased * 100) / 10));
  camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
  camera.quaternion.slerpQuaternions(tween.fromQuaternion, tween.toQuaternion, eased);
  const targetDistance = THREE.MathUtils.lerp(tween.fromTargetDistance, tween.toTargetDistance, eased);
  tempForwardVec.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  tempMovementVec.copy(camera.position).addScaledVector(tempForwardVec, targetDistance);
  if (progressBucket !== tween.lastLoggedBucket || tween.elapsed >= tween.duration) {
    tween.lastLoggedBucket = progressBucket;

  }
  runWithProgrammaticCameraMutationAndAnchor(() => {
    withControlsVerticalFreedom(controls, () => {
      controls.target.copy(tempMovementVec);
      camera.fov = THREE.MathUtils.lerp(tween.fromProjection.fov, tween.toProjection.fov, eased);
      camera.near = THREE.MathUtils.lerp(tween.fromProjection.near, tween.toProjection.near, eased);
      camera.far = Math.max(
        THREE.MathUtils.lerp(tween.fromProjection.near, tween.toProjection.near, eased) + 1e-3,
        THREE.MathUtils.lerp(tween.fromProjection.far, tween.toProjection.far, eased),
      );
      camera.zoom = THREE.MathUtils.lerp(tween.fromProjection.zoom, tween.toProjection.zoom, eased);
      camera.updateProjectionMatrix();
      controls.update();
    });
  });
  lockControlsPitchToCurrent(controls, camera);
  if (tween.elapsed >= tween.duration) {
    runWithProgrammaticCameraMutationAndAnchor(() => {
      withControlsVerticalFreedom(controls, () => {
        camera.position.copy(tween.toPosition);
        camera.quaternion.copy(tween.toQuaternion);
        controls.target.copy(tween.toTarget);
        camera.fov = tween.toProjection.fov;
        camera.near = tween.toProjection.near;
        camera.far = Math.max(tween.toProjection.near + 1e-3, tween.toProjection.far);
        camera.zoom = tween.toProjection.zoom;
        camera.updateProjectionMatrix();
        controls.update();
      });
    });
    lockControlsPitchToCurrent(controls, camera);
    const onComplete = tween.onComplete ?? null;
    activeCameraWatchTween = null;
    onComplete?.();
    markInstancedCullingDirty();
  }
}

function resetBehaviorProximity(): void {
  behaviorProximityCandidates.clear();
  behaviorProximityState.clear();
  behaviorProximityRuntime.reset();
}

function removeBehaviorProximityCandidate(nodeId: string): void {
  behaviorProximityCandidates.delete(nodeId);
  behaviorProximityState.delete(nodeId);
  behaviorProximityRuntime.removeNode(nodeId);
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

function updateBehaviorProximity(): void {
  behaviorProximityRuntime.updateBehaviorProximity();
}

function resetEffectRuntimeTickers(): void {
}

function refreshEffectRuntimeTickers(): void {
  resetEffectRuntimeTickers();
}

function flushParticleRuntimeCommands(): void {
  if (!pendingParticleRuntimeCommands.length) {
    return;
  }
  const pending = pendingParticleRuntimeCommands.splice(0, pendingParticleRuntimeCommands.length);
  pending.forEach(({ nodeId, command }) => {
    const object = nodeObjectMap.get(nodeId);
    if (!object) {
      return;
    }
    const registry = object.userData?.[PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY] as Record<string, unknown> | undefined;
    applyParticleRuntimeCommand(registry as any, {
      type: command.type,
      componentId: command.componentId ?? null,
      emitterId: command.emitterId ?? null,
      count: command.count,
      restart: command.restart,
      softStop: command.softStop,
    } as any);
  });
}

function resetAnimationControllers(): void {
  activeBehaviorAnimations.forEach((cancel) => {
    try {
      cancel();
    } catch (error) {
      console.warn('Failed to cancel behavior animation', error);
    }
  });
  activeBehaviorAnimations.clear();
  characterControllerAnimationRuntime.clear();
  characterAutoTourRuntime.clear();
  nodeAnimationRuntime.listMixers().forEach((mixer) => {
    try {
      mixer.stopAllAction();
      const root = mixer.getRoot();
      if (root) {
        mixer.uncacheRoot(root);
      }
    } catch (error) {
      console.warn('Failed to reset animation controllers', error);
    }
  });
  nodeAnimationRuntime.reset();
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
  nodeAnimationRuntime.restoreDefaultNodeAnimation(nodeId);
}

function refreshAnimationControllers(root: THREE.Object3D): void {
  void root;
  resetAnimationControllers();
  nodeObjectMap.forEach((_object, nodeId) => {
    const node = resolveNodeById(nodeId);
    const component = node?.components?.[ANIMATION_COMPONENT_TYPE] as SceneNodeComponentState<AnimationComponentProps> | undefined;
    if (!node || !component || component.enabled === false) {
      nodeAnimationRuntime.unregister(nodeId);
      return;
    }
    const sourceNodeId = nodeId;
    const runtimeObject = nodeObjectMap.get(sourceNodeId) ?? null;
    nodeAnimationRuntime.sync({
      nodeId,
      sourceNodeId,
      runtimeObject,
      defaultClipName: component.props.defaultClipName,
      autoplay: component.props.autoplay,
      loop: component.props.loop,
      timeScale: component.props.timeScale,
    });
  });
  refreshCharacterControllerAnimationRuntimeEntries();
  refreshCharacterPathFollowRuntimeEntries();
  refreshEffectRuntimeTickers();
}

function handleDelayEvent(event: Extract<BehaviorRuntimeEvent, { type: 'delay' }>) {
  handleBehaviorDelayEvent(event, {
    activeBehaviorDelayTimers,
    clearDelayTimer,
    resolveBehaviorToken,
    scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  });
}

const moveToTransitionStartPosition = new THREE.Vector3();
const moveToTransitionStartQuaternion = new THREE.Quaternion();
const moveToSubjectForwardAxisScratch = new THREE.Vector3();
const moveToTransitionCurrentForward = new THREE.Vector3();
let moveToTransitionFrameHandle: number | null = null;

function cancelMoveToTransition(): void {
  if (moveToTransitionFrameHandle !== null) {
    cancelAnimationFrame(moveToTransitionFrameHandle);
    moveToTransitionFrameHandle = null;
  }
}

function resolveMoveToSubjectNodeId(): string | null {
  if (vehicleDriveStateBridge.active && vehicleDriveStateBridge.nodeId) {
    return vehicleDriveStateBridge.nodeId;
  }
  return resolveDefaultControlledCharacterNodeId();
}

function resolveMoveToSubjectBinding(subjectNodeId: string) {
  return resolveMoveToBindingByNodeId(subjectNodeId, rigidbodyInstances);
}

function resolveMoveToSubjectObject(subjectNodeId: string): THREE.Object3D | null {
  const binding = resolveMoveToSubjectBinding(subjectNodeId);
  return binding?.object ?? nodeObjectMap.get(subjectNodeId) ?? null;
}

function resolveMoveToSubjectForwardAxis(subjectNodeId: string, bindingKind: string | null): THREE.Vector3 {
  if (bindingKind === 'vehicle') {
    const vehicle = resolveVehicleComponent(resolveNodeById(subjectNodeId));
    const props = clampVehicleComponentProps(vehicle?.props ?? null);
    return resolveVehicleAxisVector(clampVehicleAxisIndex(props.indexForwardAxis));
  }
  if (bindingKind === 'character') {
    const controller = resolveCharacterControllerComponent(resolveNodeById(subjectNodeId));
    const forwardAxis = clampCharacterControllerComponentProps(controller?.props ?? null).forwardAxis;
    return writeCharacterLocalForward(moveToSubjectForwardAxisScratch, forwardAxis) as THREE.Vector3;
  }
  return moveToSubjectForwardAxisScratch.set(1, 0, 0);
}

function resolveMoveToSubjectBridgeNodeId(subjectNodeId: string): string | null {
  if (physicsBridgeBodyIdByNodeId.has(subjectNodeId)) {
    return subjectNodeId;
  }
  const characterBodyNodeId = physicsBridgeCharacterBodyNodeIdByControllerNodeId.get(subjectNodeId) ?? null;
  if (characterBodyNodeId && physicsBridgeBodyIdByNodeId.has(characterBodyNodeId)) {
    return characterBodyNodeId;
  }
  return null;
}

function syncMoveToSubjectTargetToPhysicsBridge(
  subjectNodeId: string,
  targetPose: ReturnType<typeof buildMoveToTargetPose>,
): void {
  if (!physicsBridge || !physicsBridgeSceneLoaded) {
    return;
  }
  const bridgeNodeId = resolveMoveToSubjectBridgeNodeId(subjectNodeId);
  if (!bridgeNodeId) {
    return;
  }
  const bodyId = physicsBridgeBodyIdByNodeId.get(bridgeNodeId);
  if (typeof bodyId !== 'number') {
    return;
  }
  physicsBridgeFrameBodiesByNodeId.set(bridgeNodeId, {
    position: targetPose.position.clone(),
    quaternion: targetPose.quaternion.clone(),
    motionState: 0,
  });
  void physicsBridge.setBodyTransform({
    bodyId,
    transform: {
      position: [targetPose.position.x, targetPose.position.y, targetPose.position.z],
      rotation: [
        targetPose.quaternion.x,
        targetPose.quaternion.y,
        targetPose.quaternion.z,
        targetPose.quaternion.w,
      ],
    },
  });
}

function resolveMoveToCharacterTargetYaw(subjectNodeId: string, targetQuaternion: THREE.Quaternion): number {
  const controller = resolveCharacterControllerComponent(resolveNodeById(subjectNodeId));
  const forwardAxis = clampCharacterControllerComponentProps(controller?.props ?? null).forwardAxis;
  return resolvePhysicsCharacterMotorYawFromWorldQuaternion(targetQuaternion, forwardAxis);
}

function syncMoveToCharacterControllerYaw(subjectNodeId: string, targetQuaternion: THREE.Quaternion): void {
  const nextYaw = resolveMoveToCharacterTargetYaw(subjectNodeId, targetQuaternion);
  characterInputYaw = nextYaw;
  characterInputYawInitialized = true;
  resetSceneryCharacterInputYawStateIfNeeded(resolveDefaultControlledCharacterNodeId());
  characterAuthorityInput.turn = 0;
}

function getMoveToSubjectCurrentPose(subjectNodeId: string): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
  const object = resolveMoveToSubjectObject(subjectNodeId);
  if (!object) {
    return null;
  }
  object.updateWorldMatrix(true, false);
  object.getWorldPosition(moveToTransitionStartPosition);
  object.getWorldQuaternion(moveToTransitionStartQuaternion);
  return {
    position: moveToTransitionStartPosition.clone(),
    quaternion: moveToTransitionStartQuaternion.clone(),
  };
}

function applyMoveToSubjectTargetPose(
  subjectNodeId: string,
  targetPose: ReturnType<typeof buildMoveToTargetPose>,
): void {
  const binding = resolveMoveToSubjectBinding(subjectNodeId);
  const bindingKind = binding?.bindingKind ?? 'none';
  const subjectForwardAxis = resolveMoveToSubjectForwardAxis(subjectNodeId, bindingKind);
  const characterTargetQuaternion = resolveMoveToAlignedQuaternionForLocalForwardAxis(
    targetPose.quaternion,
    subjectForwardAxis,
  );
  if (binding?.body) {
    applyMoveToPhysicsBodyWorldPose({
      body: binding.body,
      worldPosition: targetPose.position,
      worldQuaternion: characterTargetQuaternion,
      orientationAdjustment: binding.orientationAdjustment,
    });
    if (binding.object) {
      applyMoveToObjectWorldPose(binding.object, targetPose.position, characterTargetQuaternion);
    }
    syncMoveToSubjectTargetToPhysicsBridge(subjectNodeId, {
      position: targetPose.position,
      forward: targetPose.forward,
      up: targetPose.up,
      quaternion: characterTargetQuaternion,
    });
    if (bindingKind === 'character') {
      syncMoveToCharacterControllerYaw(subjectNodeId, characterTargetQuaternion);
    }
    return;
  }
  const object = resolveMoveToSubjectObject(subjectNodeId);
  if (!object) {
    return;
  }
  applyMoveToObjectWorldPose(object, targetPose.position, characterTargetQuaternion);
  syncMoveToSubjectTargetToPhysicsBridge(subjectNodeId, {
    position: targetPose.position,
    forward: targetPose.forward,
    up: targetPose.up,
    quaternion: characterTargetQuaternion,
  });
  if (bindingKind === 'character') {
    syncMoveToCharacterControllerYaw(subjectNodeId, characterTargetQuaternion);
  }
}

function applyMoveToCameraTargetPose(targetPose: ReturnType<typeof buildMoveToTargetPose>): void {
  const context = renderContext;
  if (!context) {
    return;
  }
  const placement = buildMoveToCameraPlacement(targetPose);
  context.camera.position.copy(placement.position);
  context.controls.target.copy(placement.lookAt);
  context.controls.update();
}

function resetMoveToSubjectInputs(): void {
  vehicleDriveInput.throttle = 0;
  vehicleDriveInput.steering = 0;
  vehicleDriveInput.brake = 0;
  characterAuthorityInput.moveX = 0;
  characterAuthorityInput.moveZ = 0;
  characterAuthorityInput.turn = 0;
  characterAuthorityInput.jump = false;
  characterAuthorityInput.sprint = false;
  characterAuthorityInput.crouch = false;
  characterAuthorityInput.interact = false;
}

function finalizeMoveToSession(resolution: { type: 'continue' | 'fail'; message?: string } = { type: 'continue' }): void {
  const token = moveToRuntimeSession.token;
  resetMoveToRuntimeSession(moveToRuntimeSession);
  cancelMoveToTransition();
  resetMoveToSubjectInputs();
  if (token) {
    resolveBehaviorToken(token, resolution);
  }
}

function resolveMoveToFacingYaw(targetPose: ReturnType<typeof buildMoveToTargetPose>): number {
  return resolveMoveToYawRadiansFromForward(targetPose.forward);
}

function updateMoveToSessionForFrame(deltaSeconds: number): void {
  if (!moveToRuntimeSession.active || !moveToRuntimeSession.token || !moveToRuntimeSession.subjectNodeId || !moveToRuntimeSession.targetNodeId) {
    return;
  }
  const subjectNodeId = moveToRuntimeSession.subjectNodeId;
  const binding = resolveMoveToSubjectBinding(subjectNodeId);
  const currentPose = getMoveToSubjectCurrentPose(subjectNodeId);
  if (!currentPose) {
    finalizeMoveToSession({ type: 'fail', message: 'Move To subject pose unavailable.' });
    return;
  }
  const targetPose = {
    position: moveToRuntimeSession.targetPosition.clone(),
    forward: moveToRuntimeSession.targetForward.clone(),
    up: moveToRuntimeSession.targetUp.clone(),
    quaternion: moveToRuntimeSession.targetQuaternion.clone(),
  } satisfies ReturnType<typeof buildMoveToTargetPose>;
  const subjectForwardAxis = resolveMoveToSubjectForwardAxis(subjectNodeId, binding?.bindingKind ?? null);
  const currentForward = resolveMoveToWorldForwardFromQuaternion(
    currentPose.quaternion,
    subjectForwardAxis,
    moveToTransitionCurrentForward,
  );
  currentForward.y = 0;
  if (currentForward.lengthSq() <= 1e-8) {
    currentForward.set(1, 0, 0);
  } else {
    currentForward.normalize();
  }
  const currentYaw = Math.atan2(currentForward.x, currentForward.z);
  const targetYaw = resolveMoveToFacingYaw(targetPose);
  const positionDelta = targetPose.position.clone().sub(currentPose.position);
  positionDelta.y = 0;
  const planarDistance = positionDelta.length();

  if (moveToRuntimeSession.subjectType === 'camera') {
    const context = renderContext;
    if (!context) {
      finalizeMoveToSession({ type: 'fail', message: '相机不可用' });
      return;
    }
    const placement = buildMoveToCameraPlacement(targetPose);
    const cameraDistance = placement.position.distanceTo(context.camera.position);
    if (cameraDistance <= MOVE_TO_SNAP_DISTANCE) {
      applyMoveToCameraTargetPose(targetPose);
      finalizeMoveToSession({ type: 'continue' });
      return;
    }
    context.camera.position.lerp(placement.position, Math.min(1, deltaSeconds * MOVE_TO_CAMERA_LERP_SPEED));
    context.controls.target.lerp(placement.lookAt, Math.min(1, deltaSeconds * MOVE_TO_CAMERA_LERP_SPEED));
    context.controls.update();
    return;
  }

  if (moveToRuntimeSession.subjectType === 'vehicle') {
    const yawError = resolveMoveToYawDeltaRadians(currentYaw, targetYaw);
    const shouldSnap = planarDistance <= MOVE_TO_SNAP_DISTANCE && Math.abs(yawError) <= THREE.MathUtils.degToRad(12);
    if (shouldSnap) {
      applyMoveToSubjectTargetPose(subjectNodeId, targetPose);
      finalizeMoveToSession({ type: 'continue' });
      return;
    }
    const distanceBlend = THREE.MathUtils.clamp(
      (planarDistance - MOVE_TO_VEHICLE_STOP_DISTANCE) / Math.max(1e-6, MOVE_TO_VEHICLE_SLOW_DISTANCE - MOVE_TO_VEHICLE_STOP_DISTANCE),
      0,
      1,
    );
    vehicleDriveInput.throttle = distanceBlend;
    vehicleDriveInput.brake = planarDistance <= MOVE_TO_VEHICLE_STOP_DISTANCE ? 1 : 0;
    vehicleDriveInput.steering = THREE.MathUtils.clamp(yawError / (Math.PI * 0.65), -1, 1);
    return;
  }

  const yawError = resolveMoveToYawDeltaRadians(currentYaw, targetYaw);
  const shouldSnap = planarDistance <= MOVE_TO_SNAP_DISTANCE && Math.abs(yawError) <= THREE.MathUtils.degToRad(10);
  if (shouldSnap) {
    applyMoveToSubjectTargetPose(subjectNodeId, targetPose);
    finalizeMoveToSession({ type: 'continue' });
    return;
  }
  const distanceBlend = THREE.MathUtils.clamp(
    (planarDistance - MOVE_TO_CHARACTER_STOP_DISTANCE) / Math.max(1e-6, MOVE_TO_CHARACTER_SLOW_DISTANCE - MOVE_TO_CHARACTER_STOP_DISTANCE),
    0,
    1,
  );
  characterAuthorityInput.moveZ = planarDistance <= MOVE_TO_CHARACTER_STOP_DISTANCE ? 0 : distanceBlend;
  characterAuthorityInput.turn = THREE.MathUtils.clamp(yawError / (Math.PI * 0.55), -1, 1);
  characterAuthorityInput.sprint = distanceBlend > 0.75;
  characterAuthorityInput.jump = false;
  characterAuthorityInput.crouch = false;
  characterAuthorityInput.interact = false;
}

function handleMoveToEvent(event: Extract<BehaviorRuntimeEvent, { type: 'move-to' }>): void {
  const targetNodeId = event.targetNodeId || event.nodeId;
  const targetObject = targetNodeId ? nodeObjectMap.get(targetNodeId) ?? null : null;
  if (!targetObject) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '未找到目标节点' });
    return;
  }
  const targetPose = resolveMoveToTargetPoseFromObject(targetObject);
  const subjectType = resolveMoveToSubjectType({
    vehicleActive: vehicleDriveStateBridge.active,
    hasControlledCharacter: Boolean(resolveDefaultControlledCharacterNodeId()),
  });
  const subjectNodeId = subjectType === 'camera' ? null : resolveMoveToSubjectNodeId();
  if (subjectType !== 'camera' && !subjectNodeId) {
    resolveBehaviorToken(event.token, { type: 'fail', message: '没有可移动的主控对象' });
    return;
  }
  const resolvedSubjectNodeId = subjectNodeId ?? '';
  resetMoveToRuntimeSession(moveToRuntimeSession);
  moveToRuntimeSession.active = true;
  moveToRuntimeSession.token = event.token;
  moveToRuntimeSession.subjectType = subjectType;
  moveToRuntimeSession.subjectNodeId = subjectNodeId;
  moveToRuntimeSession.kinetics = Boolean(event.kinetics);
  moveToRuntimeSession.targetNodeId = targetNodeId;
  moveToRuntimeSession.targetPosition.copy(targetPose.position);
  moveToRuntimeSession.targetForward.copy(targetPose.forward);
  moveToRuntimeSession.targetUp.copy(targetPose.up);
  moveToRuntimeSession.targetQuaternion.copy(targetPose.quaternion);
  const cameraPlacement = buildMoveToCameraPlacement(targetPose);
  moveToRuntimeSession.cameraTargetPosition.copy(cameraPlacement.position);
  moveToRuntimeSession.cameraTargetLookAt.copy(cameraPlacement.lookAt);
  if (subjectType === 'camera') {
    if (!renderContext) {
      resolveBehaviorToken(event.token, { type: 'fail', message: '相机不可用' });
      return;
    }
    applyMoveToCameraTargetPose(targetPose);
    finalizeMoveToSession({ type: 'continue' });
    return;
  }
  if (!event.kinetics) {
    applyMoveToSubjectTargetPose(resolvedSubjectNodeId, targetPose);
    finalizeMoveToSession({ type: 'continue' });
  }
}

function handleSetVisibilityEvent(event: Extract<BehaviorRuntimeEvent, { type: 'set-visibility' }>) {
  applyBehaviorVisibilityChange(event.targetNodeId, event.visible, {
    getObject: (nodeId) => nodeObjectMap.get(nodeId) ?? null,
    getNode: (nodeId) => resolveNodeById(nodeId),
    syncObject: (object) => syncInstancedTransform(object),
    updateBehaviorVisibility,
  });
}

function handlePlayAnimationEvent(event: Extract<BehaviorRuntimeEvent, { type: 'play-animation' }>): void {
  handleBehaviorPlayAnimationEvent(event, {
    getController: (nodeId) => nodeAnimationRuntime.get(nodeId),
    resolveClip: (nodeId, clipName) => nodeAnimationRuntime.resolveClip(nodeId, clipName),
    playNodeAnimation: (nodeId, clipName, options) => nodeAnimationRuntime.playNodeAnimation(nodeId, clipName, options),
    stopBehaviorAnimation,
    isCharacterControllerAnimationNode,
    acquireCharacterControllerBehaviorOverride,
    releaseCharacterControllerBehaviorOverride,
    restartDefaultAnimation,
    resolveBehaviorToken,
    activeBehaviorAnimations,
    warnNoTarget: () => console.warn('Play animation skipped: no target node'),
    warnTargetUnavailable: (nodeId) => console.warn('Play animation skipped: animation target not available', { targetNodeId: nodeId }),
    warnClipNotFound: (nodeId, clipName) => console.warn('Play animation skipped: clip not found', { targetNodeId: nodeId, requestedName: clipName }),
    warnFailedToStart: () => console.warn('Play animation skipped: unable to start animation.'),
    warnFailedToStop: (error) => console.warn('Failed to stop animation', error),
  });
}

function handleStopAnimationEvent(event: Extract<BehaviorRuntimeEvent, { type: 'stop-animation' }>) {
  handleBehaviorStopAnimationEvent(event, {
    isCharacterControllerAnimationNode,
    getBehaviorOverrideTokens: (nodeId) => characterControllerAnimationRuntime.getBehaviorOverrideTokens(nodeId),
    stopBehaviorAnimation,
    scheduleCharacterControllerAnimationResync,
    stopNodeAnimation: (nodeId, options) => nodeAnimationRuntime.stopNodeAnimation(nodeId, options),
  });
}

function handleTriggerBehaviorEvent(event: Extract<BehaviorRuntimeEvent, { type: 'trigger-behavior' }>) {
  dispatchPerformBehaviorEvent(event, {
    warnMissingTarget: (message) => console.warn(`触发行为失败：${message}`),
    triggerBehaviorAction,
    processBehaviorEvents,
  });
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

function isWatchCameraLocked(): boolean {
  return cameraViewState.mode === 'watching' && activeWatchRestoreSnapshot.value !== null;
}

function captureWatchRestoreSnapshotIfNeeded(targetNodeId: string | null): void {
  if (activeWatchRestoreSnapshot.value && isRedundantWatchRequest(targetNodeId)) {
    return;
  }
  activeWatchRestoreSnapshot.value = captureViewControlSnapshot();
  watchUiRestoreState.value = {
    purposeControlsVisible: purposeControlsVisible.value,
  };
}

function clearActiveWatchState(): void {
  activeWatchRestoreSnapshot.value = null;
  activeWatchSource.value = null;
  watchUiRestoreState.value = null;
  activeWatchTransitionPlan = null;
}

function restoreWatchUiState(): void {
  const snapshot = watchUiRestoreState.value;
  if (!snapshot) {
    return;
  }
}

function captureCameraProjectionState(camera: THREE.PerspectiveCamera): {
  fov: number;
  near: number;
  far: number;
  zoom: number;
} {
  return {
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
  };
}

function startCameraWatchTween(params: {
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  toProjection?: { fov: number; near: number; far: number; zoom: number } | null;
  toQuaternion?: THREE.Quaternion | null;
  toTargetDistance?: number | null;
  duration: number;
  onComplete?: (() => void) | null;
}): void {
  const context = renderContext;
  if (!context) {
    params.onComplete?.();
    return;
  }
  const { camera, controls } = context;
  const toQuaternion = params.toQuaternion
    ? params.toQuaternion.clone()
    : resolveWatchTargetQuaternion(params.toPosition, params.toTarget, camera.quaternion);
  activeCameraWatchTween = {
    fromPosition: camera.position.clone(),
    toPosition: params.toPosition.clone(),
    fromQuaternion: camera.quaternion.clone(),
    toQuaternion: toQuaternion.clone(),
    fromTarget: controls.target.clone(),
    toTarget: params.toTarget.clone(),
    fromTargetDistance: camera.position.distanceTo(controls.target),
    toTargetDistance: params.toTargetDistance ?? params.toPosition.distanceTo(params.toTarget),
    fromProjection: captureCameraProjectionState(camera),
    toProjection: params.toProjection
      ? {
          fov: params.toProjection.fov,
          near: params.toProjection.near,
          far: Math.max(params.toProjection.near + 1e-3, params.toProjection.far),
          zoom: params.toProjection.zoom,
        }
      : captureCameraProjectionState(camera),
    duration: Math.max(0, params.duration),
    elapsed: 0,
    lastLoggedBucket: -1,
    onComplete: params.onComplete ?? null,
  };
  activeWatchTransitionPlan = {
    fromPosition: activeCameraWatchTween.fromPosition.clone(),
    fromQuaternion: activeCameraWatchTween.fromQuaternion.clone(),
    fromTargetDistance: activeCameraWatchTween.fromTargetDistance,
    toPosition: activeCameraWatchTween.toPosition.clone(),
    toQuaternion: activeCameraWatchTween.toQuaternion.clone(),
    toTargetDistance: activeCameraWatchTween.toTargetDistance,
  };
  markInstancedCullingDirty();
}

function leaveActiveWatchView(): void {
  const snapshot = activeWatchRestoreSnapshot.value;
  if (snapshot) {
    const transitionPlan = activeWatchTransitionPlan;
    const restorePosition = transitionPlan ? transitionPlan.fromPosition.clone() : new THREE.Vector3(...snapshot.camera.position);
    const restoreQuaternion = transitionPlan ? transitionPlan.fromQuaternion.clone() : null;
    const restoreTargetDistance = transitionPlan ? transitionPlan.fromTargetDistance : null;
    startCameraWatchTween({
      toPosition: restorePosition,
      toTarget: new THREE.Vector3(...snapshot.orbitTarget),
      toQuaternion: restoreQuaternion,
      toTargetDistance: restoreTargetDistance,
      toProjection: {
        fov: snapshot.camera.fov,
        near: snapshot.camera.near,
        far: snapshot.camera.far,
        zoom: snapshot.camera.zoom,
      },
      duration: CAMERA_WATCH_DURATION,
      onComplete: () => {
        applyViewControlSnapshot(snapshot);
        restoreWatchUiState();
        clearActiveWatchState();
        markInstancedCullingDirty();
      },
    });
    return;
  }
  clearActiveWatchState();
  setCameraViewState('level');
  purposeActiveMode.value = 'level';
  setCameraCaging(false);
  activeCameraWatchTween = null;
  markInstancedCullingDirty();
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
  const { camera } = context;
  const viewPointProps = resolveViewPointPropsForNodeId(targetNodeId);
  const targetObject = targetNodeId ? nodeObjectMap.get(targetNodeId) ?? null : null;
  captureWatchRestoreSnapshotIfNeeded(targetNodeId);

  if (viewPointProps && targetObject) {
    targetObject.updateWorldMatrix(true, false);
    const pose = resolveViewPointWorldCameraPose(targetObject.matrixWorld, viewPointProps);
    startCameraWatchTween({
      toPosition: pose.position.clone(),
      toTarget: pose.target.clone(),
      toProjection: {
        fov: pose.fov,
        near: pose.near,
        far: pose.far,
        zoom: pose.zoom,
      },
      duration: CAMERA_WATCH_DURATION,
    });
    setCameraCaging(Boolean(caging));
    purposeActiveMode.value = 'watch';
    setCameraViewState('watching', targetNodeId);
    activeWatchSource.value = 'viewPoint';
    markInstancedCullingDirty();
    return { success: true };
  }

  const focus = resolveNodeAnchorPoint(targetNodeId) ?? resolveNodeFocusPoint(targetNodeId);
  if (!focus) {
    clearActiveWatchState();
    return { success: false, message: '未找到目标节点' };
  }
  const finishSuccess = () => {
    setCameraCaging(Boolean(caging));
    purposeActiveMode.value = 'watch';
    setCameraViewState('watching', targetNodeId);
    activeWatchSource.value = 'target-look';
    return { success: true };
  };
  activeCameraWatchTween = null;
  const watchTarget = focus.clone();
  if (watchTarget.distanceToSquared(camera.position) < 1e-8) {
    tempForwardVec.copy(camera.getWorldDirection(tempForwardVec));
    watchTarget.copy(camera.position).addScaledVector(tempForwardVec, CAMERA_FORWARD_OFFSET);
  }
  startCameraWatchTween({
    toPosition: camera.position.clone(),
    toTarget: watchTarget,
    toProjection: captureCameraProjectionState(camera),
    duration: CAMERA_WATCH_DURATION,
  });

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

function truncatePurposeButtonLabel(label: string, maxVisibleChars = 6): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return '';
  }
  const chars = Array.from(trimmed);
  if (chars.length <= maxVisibleChars) {
    return trimmed;
  }
  return `${chars.slice(0, maxVisibleChars).join('')}…`;
}

function resolvePurposeButtonLabel(button: ShowPurposeBehaviorButton): string {
  const explicit = button.label?.trim();
  if (explicit) {
    return explicit;
  }
  const sequenceLabel = resolvePerformSequenceLabel(currentDocument?.nodes ?? [], button.targetNodeId, button.targetSequenceId);
  if (sequenceLabel) {
    return sequenceLabel;
  }
  return button.targetSequenceId ?? '未命名按钮';
}

function resolvePurposeButtonDisplayLabel(button: ShowPurposeBehaviorButton): string {
  return truncatePurposeButtonLabel(resolvePurposeButtonLabel(button), 6);
}

function estimatePurposeControlGroupSize(buttons: ShowPurposeBehaviorButton[]): { widthPx: number; heightPx: number } {
  const longestLabelLength = buttons.reduce((max, button) => {
    const length = Array.from(resolvePurposeButtonDisplayLabel(button)).length;
    return Math.max(max, length);
  }, 0);
  const buttonCount = Math.max(buttons.length, 1);
  return {
    widthPx: Math.min(180, Math.max(104, 58 + (longestLabelLength * 10))),
    heightPx: Math.min(180, Math.max(34, (buttonCount * 31) + ((buttonCount - 1) * 6) + 8)),
  };
}

function showPurposeControls(buttons: ShowPurposeBehaviorButton[], sourceNodeId: string | null): void {
  const nodeId = sourceNodeId?.trim() ?? '';
  if (!nodeId) {
    return;
  }
  const normalizedButtons = Array.isArray(buttons) ? buttons.slice() : [];
  if (!normalizedButtons.length) {
    hidePurposeControls(nodeId);
    return;
  }
  const existingIndex = purposeControlEntries.value.findIndex((entry) => entry.nodeId === nodeId);
  const existingPlacement = existingIndex >= 0 ? purposeControlEntries.value[existingIndex]?.placement : null;
  const nextEntry: PurposeControlRecord = {
    nodeId,
    buttons: normalizedButtons,
    placement: existingPlacement ?? {
      xPercent: 50,
      yPercent: 50,
      scale: 1,
      opacity: 1,
      distanceMeters: 0,
      distanceLabel: '--',
    },
  };
  if (existingIndex >= 0) {
    purposeControlEntries.value.splice(existingIndex, 1, nextEntry);
  } else {
    purposeControlEntries.value = [...purposeControlEntries.value, nextEntry];
  }
}

function hidePurposeControls(nodeId: string | null = null): void {
  if (!nodeId) {
    purposeControlEntries.value = [];
    return;
  }
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId) {
    return;
  }
  purposeControlEntries.value = purposeControlEntries.value.filter((entry) => entry.nodeId !== normalizedNodeId);
}

function handleShowPurposeControlsEvent(
  event: Extract<BehaviorRuntimeEvent, { type: 'show-purpose-controls' }>,
): void {
  showPurposeControls(event.buttons ?? [], event.nodeId ?? null);
}

function handleHidePurposeControlsEvent(event: Extract<BehaviorRuntimeEvent, { type: 'hide-purpose-controls' }>): void {
  hidePurposeControls(event.nodeId ?? null);
}

function handlePurposeButtonTap(entry: PurposeControlRecord, button: ShowPurposeBehaviorButton): void {
  const targetNodeId = button.targetNodeId?.trim() ?? '';
  const targetSequenceId = button.targetSequenceId?.trim() ?? '';
  if (!targetNodeId || !targetSequenceId) {
    uni.showToast({ title: '缺少可触发的目标脚本', icon: 'none' });
    return;
  }
  const results = triggerBehaviorAction(
    targetNodeId,
    'perform',
    {
      payload: {
        sourceNodeId: entry.nodeId,
      },
    },
    { sequenceId: targetSequenceId },
  );
  processBehaviorEvents(results);
}

function updatePurposeControlsPlacement(activeCamera: THREE.Camera | null): void {
  const entries = purposeControlEntries.value;
  if (!entries.length || !activeCamera) {
    return;
  }
  const viewportWidth = Math.max(1, lanternViewportSize.width || 375);
  const viewportHeight = Math.max(1, lanternViewportSize.height || 667);
  const candidates = entries.flatMap((entry) => {
    const object = nodeObjectMap.get(entry.nodeId) ?? null;
    if (!object) {
      return [];
    }
    object.updateWorldMatrix(true, false);
    resolvePurposeOverlayAnchorWorldPosition(object, purposeAnchorScratch);
    const size = estimatePurposeControlGroupSize(entry.buttons);
    const placement = computePurposeOverlayPlacement({
      anchorWorld: purposeAnchorScratch,
      referenceWorld: activeCamera.position,
      camera: activeCamera,
      viewportWidth,
      viewportHeight,
      closeFadeDistance: SIGNBOARD_CLOSE_FADE_DISTANCE,
      minScreenYPercent: SIGNBOARD_MIN_SCREEN_Y_PERCENT,
      estimatedWidthPx: size.widthPx,
      estimatedHeightPx: size.heightPx,
    });
    if (!placement) {
      return [];
    }
    return [{
      id: entry.nodeId,
      placement,
      estimatedWidthPx: size.widthPx,
      estimatedHeightPx: size.heightPx,
    }];
  });
  if (!candidates.length) {
    purposeControlEntries.value = [];
    return;
  }
  const resolvedPlacements = resolvePurposeOverlayPlacements({
    placements: candidates,
    viewportWidth,
    viewportHeight,
    screenMarginPx: 12,
  });
  const placementByNodeId = new Map(resolvedPlacements.map((entry) => [entry.id, entry.placement] as const));
  purposeControlEntries.value = entries
    .map((entry) => {
      const placement = placementByNodeId.get(entry.nodeId);
      if (!placement) {
        return null;
      }
      return {
        ...entry,
        placement,
      };
    })
    .filter((entry): entry is PurposeControlRecord => entry !== null);
}

function resolvePurposeControlStyle(entry: PurposeControlRecord): Record<string, string> {
  return {
    left: `${entry.placement.xPercent}%`,
    top: `${entry.placement.yPercent}%`,
    transform: `translate(-50%, -100%) scale(${Math.max(0.75, Math.min(1.1, entry.placement.scale))})`,
    opacity: `${Math.max(0.35, Math.min(1, entry.placement.opacity))}`,
  };
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
  const levelTarget = controls.target.clone();
  levelTarget.y = camera.position.y;
  const finishSuccess = () => {
    purposeActiveMode.value = 'level';
    setCameraViewState('level');
    return { success: true };
  };
  if (levelTarget.distanceToSquared(camera.position) < 1e-8) {
    tempForwardVec.copy(camera.getWorldDirection(tempForwardVec)).setY(0);
    if (tempForwardVec.lengthSq() < 1e-8) {
      tempForwardVec.set(0, 0, -1);
    } else {
      tempForwardVec.normalize();
    }
    levelTarget.copy(camera.position).addScaledVector(tempForwardVec, CAMERA_FORWARD_OFFSET);
  }
  startCameraWatchTween({
    toPosition: camera.position.clone(),
    toTarget: levelTarget,
    toProjection: captureCameraProjectionState(camera),
    duration: CAMERA_LEVEL_DURATION,
  });
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

function refreshCharacterJoystickMetrics(): void {
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

    const preferredElement = resolveElement(characterFloatingJoystickRef.value);
    if (preferredElement) {
      const rect = preferredElement.getBoundingClientRect();
      characterJoystickState.centerX = rect.left + rect.width / 2;
      characterJoystickState.centerY = rect.top + rect.height / 2;
      characterJoystickState.ready = rect.width > 0 && rect.height > 0;
      return;
    }

    const query = uni.createSelectorQuery();
    if (typeof query.in === 'function') {
      query.in((pageInstance?.proxy as unknown) ?? null);
    }

    const expectedCenter = characterDrivePadState.visible
      ? {
          x: characterDrivePadViewportRect.left + characterDrivePadState.x,
          y: characterDrivePadViewportRect.top + characterDrivePadState.y,
        }
      : null;

    query
      .selectAll('.viewer-character-console .viewer-drive-joystick')
      .boundingClientRect((rects: unknown) => {
        const items = (Array.isArray(rects) ? rects : []) as UniApp.NodeInfo[];
        if (items.length === 0) {
          characterJoystickState.ready = false;
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
            const score = Math.hypot(centerX - expectedCenter.x, centerY - expectedCenter.y);
            if (score < bestScore) {
              best = rect;
              bestScore = score;
            }
            continue;
          }
          const area = width * height;
          if (area > bestArea) {
            best = rect;
            bestArea = area;
          }
        }

        if (!best) {
          characterJoystickState.ready = false;
          return;
        }

        const left = best.left ?? 0;
        const top = best.top ?? 0;
        const width = best.width ?? 0;
        const height = best.height ?? 0;
        characterJoystickState.centerX = left + width / 2;
        characterJoystickState.centerY = top + height / 2;
        characterJoystickState.ready = true;
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

function resolveJoystickCharacterInput(): { turn: number; moveZ: number } {
  const x = characterJoystickVector.x;
  const y = characterJoystickVector.y;
  const length = Math.hypot(x, y);
  if (length <= JOYSTICK_DEADZONE) {
    return { turn: 0, moveZ: 0 };
  }
  const effectiveLength = (length - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
  const scale = length > 0 ? effectiveLength / length : 0;
  const turnAbs = Math.abs(x);
  const turnScale = turnAbs <= CHARACTER_JOYSTICK_TURN_DEADZONE
    ? 0
    : (turnAbs - CHARACTER_JOYSTICK_TURN_DEADZONE) / (1 - CHARACTER_JOYSTICK_TURN_DEADZONE);
  return {
    turn: -Math.sign(x) * turnScale,
    moveZ: y * scale,
  };
}

function updateCharacterAuthorityInputFromKeys(): void {
  const joystickInput = resolveJoystickCharacterInput();
  const keyboardMoveZ = (characterKeyState.forward ? 1 : 0) - (characterKeyState.backward ? 1 : 0);
  const keyboardTurn = (characterKeyState.left ? 1 : 0) - (characterKeyState.right ? 1 : 0);
  const moveZ = clampAxisScalar(joystickInput.moveZ + keyboardMoveZ);
  const turn = clampAxisScalar(joystickInput.turn + keyboardTurn);
  characterAuthorityInput.moveX = 0;
  characterAuthorityInput.moveZ = moveZ;
  characterAuthorityInput.turn = turn;
  characterAuthorityInput.sprint = characterKeyState.sprint;
  characterAuthorityInput.crouch = characterKeyState.crouch;
  characterAuthorityInput.interact = characterKeyState.interact;
  if (characterKeyState.jump) {
    if (!characterInputJumpLatch) {
      characterAuthorityInput.jump = true;
      characterInputJumpLatch = true;
      return;
    }
    characterAuthorityInput.jump = false;
    return;
  }
  characterInputJumpLatch = false;
  characterAuthorityInput.jump = false;
}

function clearCharacterActionJumpReleaseTimer(): void {
  if (characterActionJumpReleaseTimer != null) {
    clearTimeout(characterActionJumpReleaseTimer);
    characterActionJumpReleaseTimer = null;
  }
}

function releaseActiveCharacterActionAnimation(options: { scheduleResync?: boolean } = {}): void {
  const { scheduleResync = true } = options;
  if (activeCharacterActionAnimationTimer != null) {
    clearTimeout(activeCharacterActionAnimationTimer);
    activeCharacterActionAnimationTimer = null;
  }
  const nodeId = activeCharacterActionAnimationNodeId;
  const token = activeCharacterActionAnimationToken;
  activeCharacterActionAnimationSlot.value = null;
  activeCharacterActionAnimationNodeId = null;
  activeCharacterActionAnimationToken = null;
  if (!token || !nodeId) {
    return;
  }
  releaseCharacterControllerBehaviorOverride(token);
  if (scheduleResync) {
    scheduleCharacterControllerAnimationResync(nodeId);
  }
}

function applyCharacterHoldActionState(slot: CharacterAnimationSlot, pressed: boolean): void {
  let changed = false;
  if (slot === 'sprint' && characterKeyState.sprint !== pressed) {
    characterKeyState.sprint = pressed;
    changed = true;
  } else if (slot === 'crouch' && characterKeyState.crouch !== pressed) {
    characterKeyState.crouch = pressed;
    changed = true;
  } else if (slot === 'interact' && characterKeyState.interact !== pressed) {
    characterKeyState.interact = pressed;
    changed = true;
  }
  if (changed) {
    updateCharacterAuthorityInputFromKeys();
  }
}

function triggerCharacterJumpAction(): void {
  clearCharacterActionJumpReleaseTimer();
  characterKeyState.jump = true;
  updateCharacterAuthorityInputFromKeys();
  characterActionJumpReleaseTimer = setTimeout(() => {
    characterKeyState.jump = false;
    updateCharacterAuthorityInputFromKeys();
    characterActionJumpReleaseTimer = null;
  }, 80);
}

function triggerCharacterSlotAnimation(slot: CharacterAnimationSlot): void {
  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  const props = resolveDefaultControlledCharacterComponentProps();
  if (!controlledNodeId || !props) {
    return;
  }
  const clipName = props.animationBindings.find((binding) => binding.slot === slot)?.clipName ?? null;
  if (!clipName) {
    return;
  }
  const animationNodeId = props.targetNodeId ?? controlledNodeId;
  const controller = nodeAnimationRuntime.get(animationNodeId);
  const clip = controller?.clips.find((entry) => entry.name === clipName) ?? null;
  if (!clip) {
    return;
  }
  const defaultTimeScale = controller?.defaultTimeScale ?? 1;
  const timeScale = Number.isFinite(defaultTimeScale) && defaultTimeScale !== 0
    ? defaultTimeScale
    : 1;
  const playbackAction = nodeAnimationRuntime.playNodeAnimation(animationNodeId, clipName, {
    loop: false,
    timeScale,
  });
  if (!playbackAction) {
    return;
  }
  releaseActiveCharacterActionAnimation();
  const token = `ui-character-action-${controlledNodeId}-${slot}-${Date.now()}`;
  acquireCharacterControllerBehaviorOverride(controlledNodeId, token);
  activeCharacterActionAnimationToken = token;
  activeCharacterActionAnimationNodeId = controlledNodeId;
  activeCharacterActionAnimationSlot.value = slot;
  const durationSeconds = Number.isFinite(clip.duration) && clip.duration > 0
    ? clip.duration / Math.max(0.001, Math.abs(timeScale))
    : 0.35;
  activeCharacterActionAnimationTimer = setTimeout(() => {
    releaseActiveCharacterActionAnimation();
  }, Math.max(120, Math.round(durationSeconds * 1000 + 80)));
}

function resetCharacterActionButtonState(): void {
  clearCharacterActionJumpReleaseTimer();
  if (characterKeyState.jump) {
    characterKeyState.jump = false;
  }
  applyCharacterHoldActionState('sprint', false);
  applyCharacterHoldActionState('crouch', false);
  applyCharacterHoldActionState('interact', false);
  characterInputJumpLatch = false;
  characterAuthorityInput.jump = false;
  releaseActiveCharacterActionAnimation();
}

function handleCharacterActionButtonPressStart(slot: CharacterAnimationSlot): void {
  if (CHARACTER_ACTION_HOLD_SLOTS.has(slot)) {
    applyCharacterHoldActionState(slot, true);
  }
}

function handleCharacterActionButtonPressEnd(slot: CharacterAnimationSlot): void {
  if (CHARACTER_ACTION_HOLD_SLOTS.has(slot)) {
    applyCharacterHoldActionState(slot, false);
  }
}

function handleCharacterActionButtonTap(slot: CharacterAnimationSlot): void {
  if (slot === 'jump') {
    triggerCharacterJumpAction();
    return;
  }
  if (CHARACTER_ACTION_HOLD_SLOTS.has(slot)) {
    return;
  }
  triggerCharacterSlotAnimation(slot);
}

function setCharacterKeyState(key: string, pressed: boolean): void {
  const normalized = key.toLowerCase();
  if (normalized === 'w' || normalized === 'arrowup') {
    characterKeyState.forward = pressed;
  } else if (normalized === 's' || normalized === 'arrowdown') {
    characterKeyState.backward = pressed;
  } else if (normalized === 'a' || normalized === 'arrowleft') {
    characterKeyState.left = pressed;
  } else if (normalized === 'd' || normalized === 'arrowright') {
    characterKeyState.right = pressed;
  } else if (normalized === ' ' || normalized === 'space' || normalized === 'spacebar') {
    characterKeyState.jump = pressed;
  } else if (normalized === 'shift' || normalized === 'shiftleft' || normalized === 'shiftright') {
    characterKeyState.sprint = pressed;
  } else if (normalized === 'control' || normalized === 'ctrl' || normalized === 'controlleft' || normalized === 'controlright') {
    characterKeyState.crouch = pressed;
  } else if (normalized === 'e' || normalized === 'enter') {
    characterKeyState.interact = pressed;
  } else {
    return;
  }
  updateCharacterAuthorityInputFromKeys();
}

function resetCharacterControlInputs(): void {
  clearCharacterActionJumpReleaseTimer();
  releaseActiveCharacterActionAnimation();
  characterAuthorityInput.moveX = 0;
  characterAuthorityInput.moveZ = 0;
  characterAuthorityInput.turn = 0;
  characterAuthorityInput.jump = false;
  characterAuthorityInput.sprint = false;
  characterAuthorityInput.crouch = false;
  characterAuthorityInput.interact = false;
  characterKeyState.forward = false;
  characterKeyState.backward = false;
  characterKeyState.left = false;
  characterKeyState.right = false;
  characterKeyState.jump = false;
  characterKeyState.sprint = false;
  characterKeyState.crouch = false;
  characterKeyState.interact = false;
  characterInputJumpLatch = false;
  deactivateCharacterJoystick(true);
  hideCharacterDrivePadImmediate();
  detachCharacterDrivePadMouseListeners();
}

function handleWindowBlur(): void {
  resetCharacterControlInputs();
}

function handleWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || controlNodeSwitchBusy.value) {
    return;
  }
  setCharacterKeyState(event.key, true);
}

function handleWindowKeyUp(event: KeyboardEvent): void {
  if (event.defaultPrevented || controlNodeSwitchBusy.value) {
    return;
  }
  setCharacterKeyState(event.key, false);
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

function shouldActivateDrivePad(
  clientY: number,
  viewportRect: { top: number; left: number; height: number } = drivePadViewportRect,
): boolean {
  const height = viewportRect.height > 0 ? viewportRect.height : getViewportHeight();
  if (height <= 0) {
    return true;
  }
  // Activate only when touching the bottom third of the viewport
  return clientY >= viewportRect.top + (height * 2) / 3;
}

function updateDrivePadViewportRect(
  target: EventTarget | null,
  viewportRect: { top: number; left: number; height: number } = drivePadViewportRect,
): void {
  const element = target as { getBoundingClientRect?: () => DOMRect | ClientRect } | null;
  if (element && typeof element.getBoundingClientRect === 'function') {
    const rect = element.getBoundingClientRect();
    if (rect) {
      viewportRect.top = rect.top ?? 0;
      viewportRect.left = rect.left ?? 0;
      viewportRect.height = rect.height ?? getViewportHeight();
      return;
    }
  }
  viewportRect.top = 0;
  viewportRect.left = 0;
  viewportRect.height = getViewportHeight();
}

function toDrivePadLocalCoords(
  x: number,
  y: number,
  viewportRect: { top: number; left: number; height: number } = drivePadViewportRect,
): { x: number; y: number } {
  return {
    x: x - viewportRect.left,
    y: y - viewportRect.top,
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

function cancelCharacterDrivePadFade(): void {
  if (characterDrivePadFadeTimer) {
    clearTimeout(characterDrivePadFadeTimer);
    characterDrivePadFadeTimer = null;
  }
}

function summonCharacterDrivePadAt(x: number, y: number): void {
  cancelCharacterDrivePadFade();
  characterDrivePadState.x = x;
  characterDrivePadState.y = y;
  characterDrivePadState.visible = true;
  characterDrivePadState.fading = false;
}

function scheduleCharacterDrivePadFade(): void {
  if (!characterDrivePadState.visible) {
    return;
  }
  characterDrivePadState.fading = true;
  cancelCharacterDrivePadFade();
  characterDrivePadFadeTimer = setTimeout(() => {
    characterDrivePadState.visible = false;
    characterDrivePadState.fading = false;
    characterDrivePadFadeTimer = null;
  }, DRIVE_PAD_FADE_MS);
}

function hideCharacterDrivePadImmediate(): void {
  if (!characterDrivePadState.visible && !characterDrivePadState.fading) {
    return;
  }
  cancelCharacterDrivePadFade();
  characterDrivePadState.visible = false;
  characterDrivePadState.fading = false;
}

function cancelVehicleSmoothStop(): void {
  vehicleDriveController.clearSmoothStop();
}

function resolveInteractiveElementRect(
  value: ComponentPublicInstance | HTMLElement | { rootRef?: unknown } | null,
  selector: string,
): { left: number; top: number; right: number; bottom: number } | null {
  const exposedRootRef = (value as { rootRef?: unknown } | null)?.rootRef;
  const resolvedValue = (exposedRootRef as { value?: unknown } | undefined)?.value
    ?? exposedRootRef
    ?? value;
  if (resolvedValue && typeof (resolvedValue as HTMLElement).getBoundingClientRect === 'function') {
    const rect = (resolvedValue as HTMLElement).getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }
  const maybeEl = (resolvedValue as { $el?: unknown } | null)?.$el;
  if (maybeEl && typeof (maybeEl as HTMLElement).getBoundingClientRect === 'function') {
    const rect = (maybeEl as HTMLElement).getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  }
  try {
    const query = uni.createSelectorQuery();
    if (typeof query.in === 'function') {
      query.in((pageInstance?.proxy as unknown) ?? null);
    }
    let resolvedRect: { left: number; top: number; right: number; bottom: number } | null = null;
    query
      .select(selector)
      .boundingClientRect((rect: unknown) => {
        const item = rect as UniApp.NodeInfo | null;
        const left = item?.left ?? 0;
        const top = item?.top ?? 0;
        const width = item?.width ?? 0;
        const height = item?.height ?? 0;
        if (width > 0 && height > 0) {
          resolvedRect = {
            left,
            top,
            right: left + width,
            bottom: top + height,
          };
        }
      })
      .exec();
    return resolvedRect;
  } catch {
    return null;
  }
}

function isPointInsideCharacterActionsBar(x: number, y: number): boolean {
  if (!characterActionButtons.value.length) {
    return false;
  }
  const rect = resolveInteractiveElementRect(characterActionsBarRef.value, '.viewer-character-actions-bar');
  if (!rect) {
    return false;
  }
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isPointInsidePurposeControls(x: number, y: number): boolean {
  if (!purposeControlsVisible.value || !purposeControlEntries.value.length) {
    return false;
  }
  try {
    const query = uni.createSelectorQuery();
    if (typeof query.in === 'function') {
      query.in((pageInstance?.proxy as unknown) ?? null);
    }
    let hit = false;
    query
      .selectAll('.viewer-purpose-controls')
      .boundingClientRect((rects: unknown) => {
        const items = Array.isArray(rects) ? rects : [];
        hit = items.some((item) => {
          const rect = item as UniApp.NodeInfo | null;
          const left = rect?.left ?? 0;
          const top = rect?.top ?? 0;
          const width = rect?.width ?? 0;
          const height = rect?.height ?? 0;
          if (width <= 0 || height <= 0) {
            return false;
          }
          const right = left + width;
          const bottom = top + height;
          return x >= left && x <= right && y >= top && y <= bottom;
        });
      })
      .exec();
    return hit;
  } catch {
    return false;
  }
}

function shouldSkipCharacterDrivePadFromEventTarget(target: EventTarget | null): boolean {
  const candidate = target as { dataset?: Record<string, unknown>; parentElement?: Element | null } | null;
  const datasetValue = candidate?.dataset?.controlSkip;
  if (datasetValue === 'character-actions' || datasetValue === 'purpose-controls' || datasetValue === 'watch-leave') {
    return true;
  }
  if (typeof (target as Element | null)?.closest === 'function') {
    return Boolean((target as Element).closest('[data-control-skip="character-actions"], [data-control-skip="purpose-controls"], [data-control-skip="watch-leave"]'));
  }
  return false;
}

function handleControlPadTouchStart(event: TouchEvent): void {
  if (vehicleDriveUi.value.visible) {
    handleDrivePadTouchStart(event);
    return;
  }
  if (characterControlUi.value.visible && isWeChatMiniProgram) {
    if (shouldSkipCharacterDrivePadFromEventTarget(event.target)) {
      return;
    }
    const touch = event.changedTouches?.[0] ?? null;
    const coords = getTouchCoordinates(touch);
    if (coords && isPointInsideCharacterActionsBar(coords.x, coords.y)) {
      return;
    }
    if (coords && isPointInsidePurposeControls(coords.x, coords.y)) {
      return;
    }
    handleCharacterDrivePadTouchStart(event);
  }
}

function handleControlPadTouchMove(event: TouchEvent): void {
  if (vehicleDriveUi.value.visible) {
    handleDrivePadTouchMove(event);
    return;
  }
  if (characterControlUi.value.visible && isWeChatMiniProgram) {
    handleCharacterDrivePadTouchMove(event);
  }
}

function handleControlPadTouchEnd(event: TouchEvent): void {
  if (vehicleDriveUi.value.visible) {
    handleDrivePadTouchEnd(event);
    return;
  }
  if (characterControlUi.value.visible && isWeChatMiniProgram) {
    handleCharacterDrivePadTouchEnd(event);
  }
}

function handleControlPadMouseDown(event: MouseEvent): void {
  if (vehicleDriveUi.value.visible) {
    handleDrivePadMouseDown(event);
    return;
  }
  if (characterControlUi.value.visible) {
    if (shouldSkipCharacterDrivePadFromEventTarget(event.target)) {
      return;
    }
    if (isPointInsideCharacterActionsBar(event.clientX, event.clientY)) {
      return;
    }
    if (isPointInsidePurposeControls(event.clientX, event.clientY)) {
      return;
    }
    handleCharacterDrivePadMouseDown(event);
  }
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
    scheduleDrivePadFade();
  }
  detachDrivePadMouseListeners();
  hideDrivePadImmediate();
}

function setCharacterJoystickVector(x: number, y: number): void {
  let nextX = clampAxisScalar(x);
  let nextY = clampAxisScalar(y);
  const length = Math.hypot(nextX, nextY);
  if (length > 1) {
    const scale = 1 / length;
    nextX *= scale;
    nextY *= scale;
  }
  characterJoystickVector.x = nextX;
  characterJoystickVector.y = nextY;
  characterJoystickOffset.x = characterJoystickVector.x * JOYSTICK_VISUAL_RANGE;
  characterJoystickOffset.y = -characterJoystickVector.y * JOYSTICK_VISUAL_RANGE;
  updateCharacterAuthorityInputFromKeys();
}

function deactivateCharacterJoystick(reset: boolean): void {
  characterJoystickState.active = false;
  characterJoystickState.pointerId = -1;
  characterJoystickState.ready = false;
  if (reset) {
    setCharacterJoystickVector(0, 0);
  }
}

function applyCharacterJoystickFromPoint(x: number, y: number): void {
  if (!characterJoystickState.ready) {
    characterJoystickState.centerX = x;
    characterJoystickState.centerY = y;
    characterJoystickState.ready = true;
    refreshCharacterJoystickMetrics();
  }
  const dx = x - characterJoystickState.centerX;
  const dy = y - characterJoystickState.centerY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return;
  }
  const normalizedX = clampAxisScalar(dx / JOYSTICK_INPUT_RADIUS);
  const normalizedY = clampAxisScalar(-dy / JOYSTICK_INPUT_RADIUS);
  const length = Math.hypot(normalizedX, normalizedY);
  if (length > 1) {
    const inv = 1 / length;
    setCharacterJoystickVector(normalizedX * inv, normalizedY * inv);
    return;
  }
  setCharacterJoystickVector(normalizedX, normalizedY);
}

function handleCharacterDrivePadTouchStart(event: TouchEvent): void {
  if (!characterControlUi.value.visible || vehicleDriveUi.value.visible) {
    return;
  }
  const touch = event.changedTouches?.[0] ?? null;
  const coords = getTouchCoordinates(touch);
  if (!coords) {
    return;
  }
  if (shouldSkipCharacterDrivePadFromEventTarget(event.target)) {
    return;
  }
  if (isPointInsideCharacterActionsBar(coords.x, coords.y)) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  updateDrivePadViewportRect(event.currentTarget, characterDrivePadViewportRect);
  const localCoords = toDrivePadLocalCoords(coords.x, coords.y, characterDrivePadViewportRect);
  summonCharacterDrivePadAt(localCoords.x, localCoords.y);
  handleCharacterJoystickTouchStart(event);
}

function handleCharacterDrivePadTouchMove(event: TouchEvent): void {
  if (characterJoystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, characterJoystickState.pointerId);
  if (!touch) {
    return;
  }
  handleCharacterJoystickTouchMove(event);
}

function handleCharacterDrivePadTouchEnd(event: TouchEvent): void {
  if (characterJoystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, characterJoystickState.pointerId);
  if (!touch) {
    return;
  }
  handleCharacterJoystickTouchEnd(event);
  scheduleCharacterDrivePadFade();
}

function attachCharacterDrivePadMouseListeners(): void {
  if (!isBrowserEnvironment || characterDrivePadMouseTracking) {
    return;
  }
  characterDrivePadMouseTracking = true;
  window.addEventListener('mousemove', handleCharacterDrivePadMouseMove);
  window.addEventListener('mouseup', handleCharacterDrivePadMouseUp);
  window.addEventListener('blur', handleCharacterDrivePadMouseUp);
}

function detachCharacterDrivePadMouseListeners(): void {
  if (!isBrowserEnvironment || !characterDrivePadMouseTracking) {
    return;
  }
  characterDrivePadMouseTracking = false;
  window.removeEventListener('mousemove', handleCharacterDrivePadMouseMove);
  window.removeEventListener('mouseup', handleCharacterDrivePadMouseUp);
  window.removeEventListener('blur', handleCharacterDrivePadMouseUp);
}

function handleCharacterDrivePadMouseDown(event: MouseEvent): void {
  if (!characterControlUi.value.visible || event.button !== 0) {
    return;
  }
  const coords = { x: event.clientX, y: event.clientY };
  if (shouldSkipCharacterDrivePadFromEventTarget(event.target)) {
    return;
  }
  if (isPointInsideCharacterActionsBar(coords.x, coords.y)) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  updateDrivePadViewportRect(event.currentTarget, characterDrivePadViewportRect);
  const localCoords = toDrivePadLocalCoords(coords.x, coords.y, characterDrivePadViewportRect);
  summonCharacterDrivePadAt(localCoords.x, localCoords.y);
  characterJoystickState.pointerId = DRIVE_PAD_MOUSE_POINTER_ID;
  characterJoystickState.active = true;
  characterJoystickState.ready = false;
  setCharacterJoystickVector(0, 0);
  applyCharacterJoystickFromPoint(coords.x, coords.y);
  attachCharacterDrivePadMouseListeners();
}

function handleCharacterDrivePadMouseMove(event: MouseEvent): void {
  if (characterJoystickState.pointerId !== DRIVE_PAD_MOUSE_POINTER_ID) {
    return;
  }
  event.preventDefault();
  applyCharacterJoystickFromPoint(event.clientX, event.clientY);
}

function handleCharacterDrivePadMouseUp(): void {
  if (characterJoystickState.pointerId === DRIVE_PAD_MOUSE_POINTER_ID) {
    deactivateCharacterJoystick(true);
    scheduleCharacterDrivePadFade();
  }
  detachCharacterDrivePadMouseListeners();
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
}

function handleCharacterJoystickTouchStart(event: TouchEvent): void {
  if (!characterControlUi.value.visible || vehicleDriveUi.value.visible) {
    return;
  }
  const touch = event.changedTouches?.[0] ?? null;
  if (!touch) {
    return;
  }
  if (!characterJoystickState.ready) {
    refreshCharacterJoystickMetrics();
  }
  const coords = getTouchCoordinates(touch);
  if (!coords) {
    return;
  }
  characterJoystickState.pointerId = touch.identifier;
  characterJoystickState.active = true;
  applyCharacterJoystickFromPoint(coords.x, coords.y);
}

function handleCharacterJoystickTouchMove(event: TouchEvent): void {
  if (!characterJoystickState.active || characterJoystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, characterJoystickState.pointerId);
  if (!touch) {
    return;
  }
  const coords = getTouchCoordinates(touch);
  if (!coords) {
    return;
  }
  applyCharacterJoystickFromPoint(coords.x, coords.y);
}

function handleCharacterJoystickTouchEnd(event: TouchEvent): void {
  if (characterJoystickState.pointerId === -1) {
    return;
  }
  const touch = extractTouchById(event, characterJoystickState.pointerId);
  if (!touch) {
    return;
  }
  deactivateCharacterJoystick(true);
}

function recomputeVehicleDriveInputs(): void {
  const joystickInput = resolveJoystickDriveInput();
  const throttleFromJoystick = clampAxisScalar(joystickInput.throttle);
  const steeringFromJoystick = clampAxisScalar(joystickInput.steering);
  // Keep joystick contribution, then let controller clamp and merge with flags/keyboard.
  vehicleDriveInput.analogThrottle = throttleFromJoystick;
  vehicleDriveInput.analogSteering = -steeringFromJoystick;
  vehicleDriveInput.analogBrake = 0;
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
  options: { deferCameraUpdate?: boolean } = {},
): VehicleDriveStartResult {
  const ctx = renderContext
    ? { camera: renderContext.camera, mapControls: renderContext.controls }
    : { camera: null as THREE.PerspectiveCamera | null };
  const result = vehicleDriveController.startDrive(event, ctx);
  if (result.success) {
    resetCharacterControlInputs();
    resetProtagonistPoseState();
    vehicleDriveCameraFollowState.initialized = false;
    purposeActiveMode.value = 'watch';
    if (options.deferCameraUpdate) {
      updateVehicleDriveCamera(0, { immediate: true });
    }
    if (!options.deferCameraUpdate) {
      updateVehicleDriveCamera(0, { immediate: true });
    }
  }
  return result;
}

function isVehicleDrivePendingReadinessMessage(message?: string): boolean {
  return typeof message === 'string' && message.includes('车辆尚未准备就绪')
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
  const manualNodeId = vehicleDriveActive.value ? vehicleDriveNodeId.value : null;
  const autoTourNodeId = !manualNodeId ? resolveSceneryPhysicsBridgeAutoTourNodeId() : null;
  const telemetryNodeId = manualNodeId ?? autoTourNodeId;
  const manualVehicle = vehicleDriveVehicle;
  const manualChassisBody = manualVehicle?.chassisBody ?? null;
  const telemetryInstance = telemetryNodeId ? vehicleInstances.get(telemetryNodeId) ?? null : null;
  if (telemetryNodeId !== autoTourTelemetryLastNodeId) {
    autoTourTelemetryLastNodeId = telemetryNodeId;
    autoTourTelemetryHasWorldPositionSample = false;
    autoTourTelemetryLastSampleAtMs = 0;
  }
  const telemetryVehicle = telemetryInstance?.vehicle ?? manualVehicle;
  const chassisBody = telemetryVehicle?.chassisBody ?? manualChassisBody;
  const nowMs = getVehicleSpeedDisplayNowMs();
  let telemetry = telemetryNodeId ? controlledNodeMotionRuntime.get(telemetryNodeId) : null;
  const driveObject = telemetryNodeId ? nodeObjectMap.get(telemetryNodeId) ?? null : null;
  if (telemetryNodeId && driveObject) {
    const motionAxisForward = telemetryNodeId ? (vehicleInstances.get(telemetryNodeId)?.axisForward ?? null) : null;
    sampleControlledNodeMotionFromObject(
      telemetryNodeId,
      driveObject,
      0,
      nowMs,
      motionAxisForward,
      chassisBody?.velocity ?? null,
      chassisBody?.angularVelocity ?? null,
    );
    telemetry = controlledNodeMotionRuntime.get(telemetryNodeId);
  } else if (telemetryNodeId && chassisBody) {
    const motionAxisForward = telemetryNodeId ? (vehicleInstances.get(telemetryNodeId)?.axisForward ?? null) : null;
    sampleControlledNodeMotionFromObject(
      telemetryNodeId,
      {
        updateMatrixWorld: () => undefined,
        getWorldPosition(target: THREE.Vector3): THREE.Vector3 {
          return target.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z);
        },
        getWorldQuaternion(target: THREE.Quaternion): THREE.Quaternion {
          return target.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w);
        },
      } as unknown as THREE.Object3D,
      0,
      nowMs,
      motionAxisForward,
      chassisBody.velocity ?? null,
      chassisBody.angularVelocity ?? null,
    );
    telemetry = controlledNodeMotionRuntime.get(telemetryNodeId);
  }

  if (chassisBody && telemetry) {
    if (telemetryInstance) {
      updateVehicleSpeedAndApplyParkingHoldSafe({
        vehicleInstance: telemetryInstance,
        chassisBody,
        throttle: manualNodeId ? vehicleDriveInput.throttle : 0,
        brake: manualNodeId ? vehicleDriveInput.brake : 0,
        resolvedForwardSpeedMps: telemetry.forwardSpeedMps,
        parkedSpeedEpsilon: VEHICLE_PARKED_SPEED_EPSILON,
        parkingHoldSpeedEpsilon: VEHICLE_PARKING_HOLD_SPEED_EPSILON,
        engageParkingHold: false,
        resolveBrakeForce: () => resolveAutoTourVehicleBrakeForce(telemetryNodeId ?? ''),
      });
    }

    commitVehicleSpeedDisplay(telemetry.linearSpeedMps, nowMs);
    commitVehicleHeadingDegrees(telemetry.headingYawDeg - resolveNorthDirectionAngleDegrees(activeEnvironmentSettings.northDirection));
    return;
  }

  if (!driveObject) {
    const transformSpeed = vehicleDriveController.getCurrentSpeed();
    commitVehicleSpeedDisplay(transformSpeed, nowMs);
    commitVehicleHeadingDegrees(0);
    return;
  }

  driveObject.updateWorldMatrix(true, false);
  driveObject.getWorldPosition(vehicleSpeedDisplayScratchPosition);
  if (autoTourTelemetryHasWorldPositionSample) {
    const deltaSeconds = autoTourTelemetryLastSampleAtMs > 0
      ? Math.max(0.001, (nowMs - autoTourTelemetryLastSampleAtMs) / 1000)
      : 0;
    if (deltaSeconds > 0) {
      vehicleSpeedDisplayScratchDelta.copy(vehicleSpeedDisplayScratchPosition).sub(autoTourTelemetryLastWorldPosition);
      const sampledSpeed = vehicleSpeedDisplayScratchDelta.length() / deltaSeconds;
      commitVehicleSpeedDisplay(sampledSpeed, nowMs);
    }
  }
  autoTourTelemetryLastWorldPosition.copy(vehicleSpeedDisplayScratchPosition);
  autoTourTelemetryHasWorldPositionSample = true;
  autoTourTelemetryLastSampleAtMs = nowMs;

  driveObject.getWorldQuaternion(vehicleCompassQuaternion);
  const sampledTelemetry = telemetryNodeId ? controlledNodeMotionRuntime.get(telemetryNodeId) : null;
  if (sampledTelemetry) {
    commitVehicleHeadingDegrees(sampledTelemetry.headingYawDeg - resolveNorthDirectionAngleDegrees(activeEnvironmentSettings.northDirection));
  }
}

function updateControlledCharacterMotionTelemetry(nowMs: number): void {
  if (!characterControlUi.value.visible) {
    return;
  }
  const motionNodeId = resolveControlledCharacterMotionNodeId();
  if (!motionNodeId) {
    return;
  }
  const motionObject = nodeObjectMap.get(motionNodeId) ?? null;
  if (!motionObject) {
    return;
  }
  sampleControlledCharacterMotionFromObject(
    motionNodeId,
    motionObject,
    0,
    nowMs,
  );
}

function updateSceneCompassHeading(): void {
  if (vehicleDriveUi.value.visible || activeAutoTourNodeIds.size > 0) {
    return;
  }
  if (characterControlUi.value.visible) {
    const telemetryNodeId = resolveControlledCharacterMotionNodeId();
    const telemetry = telemetryNodeId ? controlledNodeMotionRuntime.get(telemetryNodeId) : null;
    const resolvedYaw = resolveSceneryCharacterInputYaw();
    const headingDegrees = telemetry
      ? telemetry.headingYawDeg
      : THREE.MathUtils.radToDeg(resolvedYaw ?? Math.PI);
    const northDirectionAngleDegrees = resolveNorthDirectionAngleDegrees(activeEnvironmentSettings.northDirection);
    commitVehicleHeadingDegrees(headingDegrees - northDirectionAngleDegrees);
    return;
  }
  commitVehicleHeadingDegrees(0);
}

function handleVehicleDriveResetTap(): void {
  if (!vehicleDriveActive.value || vehicleDriveResetBusy.value) {
    return;
  }
  vehicleDriveResetBusy.value = true;
  try {
    clearVehicleDriveIntroState();
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
  if (isWatchCameraLocked() || activeCameraWatchTween) {
    return false;
  }
  if (!renderContext?.camera) {
    return false;
  }
  const ctx = {
    camera: renderContext.camera,
    mapControls: undefined,
  };
  return runWithProgrammaticCameraMutationAndAnchor(() =>
    vehicleDriveController.updateCamera(deltaSeconds, ctx, options),
  );
}

function updateCharacterFollowCamera(
  deltaSeconds = 0,
  options: { immediate?: boolean } = {},
): boolean {
  const context = renderContext;
  if (!context || isWatchCameraLocked() || vehicleDriveActive.value || activeCameraWatchTween || activeAutoTourNodeIds.size > 0) {
    resetProtagonistPoseState();
    return false;
  }

  const controlledNodeId = resolveDefaultControlledCharacterNodeId();
  if (!controlledNodeId) {
    resetProtagonistPoseState();
    return false;
  }

  const node = resolveNodeById(controlledNodeId);
  const props = clampCharacterControllerComponentProps(resolveCharacterControllerComponent(node)?.props ?? null);
  const bindingNodeId = resolveCharacterControllerBindingNodeId(controlledNodeId);
  const object = bindingNodeId ? (nodeObjectMap.get(bindingNodeId) ?? null) : null;
  if (!object) {
    resetProtagonistPoseState();
    return false;
  }

  if (characterCameraFollowNodeId !== controlledNodeId) {
    resetProtagonistPoseState();
    characterCameraFollowNodeId = controlledNodeId;
  }

  const placement = resolveCharacterFollowPlacement(controlledNodeId, object);
  resolveCharacterRootWorldPosition(controlledNodeId, bindingNodeId, object, characterCameraFollowAnchorScratch);
  resolveCharacterFollowForwardWorld(object, props, characterCameraFollowForwardScratch);
  const localOffsetOverride = resolveCharacterFollowCameraOffset(props);

  const motionTelemetry = controlledNodeMotionRuntime.get(bindingNodeId ?? controlledNodeId);
  const rawVelocity = motionTelemetry?.hasSample
    ? motionTelemetry.worldLinearVelocity
    : null;

  return runWithProgrammaticCameraMutationAndAnchor(() => updateBackFollowCamera({
    controller: characterCameraFollowController,
    motion: characterCameraFollowMotionState,
    follow: characterCameraFollowState,
    placement,
    anchorWorld: characterCameraFollowAnchorScratch,
    desiredForwardWorld: characterCameraFollowForwardScratch,
    deltaSeconds,
    ctx: {
      camera: context.camera,
      mapControls: undefined,
    },
    velocityWorld: rawVelocity,
    worldUp,
    tuning: createBackFollowCameraTuning(),
    distanceScale: DEFAULT_BACK_FOLLOW_CAMERA_DISTANCE_SCALE,
    localOffsetOverride,
    followControlsDirty: false,
    immediate: Boolean(options.immediate),
    lockLocalOffset: true,
    smoothTargetForProgrammaticFollow: false,
  }));
}

function updateAutoTourFollowCamera(deltaSeconds: number, options: { immediate?: boolean } = {}): void {
  const context = renderContext;
  if (!context) {
    return;
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

  if (isWatchCameraLocked() || vehicleDriveActive.value || activeCameraWatchTween) {
    return;
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
    return;
  }
  if (autoTourFollowNodeId.value !== nodeId) {
    autoTourFollowNodeId.value = nodeId;
    resetAutoTourCameraFollowState();
  }

  const object = nodeObjectMap.get(nodeId) ?? null;
  if (!object) {
    return;
  }

  resolveAutoTourCameraFollowAnchor(nodeId, object);

  if (autoTourPaused.value) {
    autoTourCameraFollowVelocity.set(0, 0, 0);
    autoTourCameraFollowLastAnchor.copy(autoTourCameraFollowAnchorScratch);
    autoTourCameraFollowHasSample = true;
    return;
  }

  if (autoTourResumeBlendActive && autoTourResumeBlendNodeId === nodeId && !options.immediate) {
    const localOffsetOverride = resolveAutoTourFollowCameraOffset(nodeId);
    const placement = prepareAutoTourResumeBlendContext(nodeId, object, context);
    autoTourCameraFollowController.update({
      follow: autoTourResumeBlendState,
      placement,
      anchorWorld: autoTourCameraFollowAnchorScratch,
      desiredForwardWorld: autoTourCameraFollowForwardScratch,
      velocityWorld: autoTourCameraFollowVelocity,
      deltaSeconds: 1 / 60,
      ctx: { camera: autoTourResumeBlendTempCamera, mapControls: undefined },
      immediate: true,
      ...(localOffsetOverride ? { localOffsetOverride } : {}),
      tuning: createBackFollowCameraTuning(),
      distanceScale: DEFAULT_BACK_FOLLOW_CAMERA_DISTANCE_SCALE,
      lockLocalOffset: true,
    });

    autoTourResumeBlendElapsedSeconds += Math.max(0, deltaSeconds);
    const rawAlpha = AUTO_TOUR_RESUME_BLEND_SECONDS <= 1e-6
      ? 1
      : Math.min(1, autoTourResumeBlendElapsedSeconds / AUTO_TOUR_RESUME_BLEND_SECONDS);
    const alpha = 1 - Math.pow(1 - rawAlpha, 3);

    autoTourResumeBlendState.currentPosition.lerpVectors(
      autoTourResumeBlendStartPosition,
      autoTourResumeBlendState.currentPosition,
      alpha,
    );
    autoTourResumeBlendState.currentTarget.lerpVectors(
      autoTourResumeBlendStartTarget,
      autoTourResumeBlendState.currentTarget,
      alpha,
    );

    if (rawAlpha >= 1) {
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
      clearAutoTourResumeBlendState();
    }

    return;
  }

  if (!resolveAutoTourVehicleForwardWorld(nodeId, object, autoTourCameraFollowForwardScratch)) {
    object.getWorldDirection(autoTourCameraFollowForwardScratch);
    autoTourCameraFollowForwardScratch.y = 0;
  }
  if (autoTourCameraFollowForwardScratch.lengthSq() < 1e-8) {
    autoTourCameraFollowForwardScratch.set(0, 0, 1);
  } else {
    autoTourCameraFollowForwardScratch.normalize();
  }

  const placement = computeFollowPlacement(getApproxDimensions(object));
  const localOffsetOverride = resolveAutoTourFollowCameraOffset(nodeId);
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

  const hasVehicleForward = resolveAutoTourVehicleForwardWorld(nodeId, object, autoTourCameraFollowForwardScratch);
  if (!hasVehicleForward && autoTourCameraFollowVelocity.lengthSq() > 1e-6) {
    autoTourCameraFollowForwardScratch.set(autoTourCameraFollowVelocity.x, 0, autoTourCameraFollowVelocity.z);
  } else if (!hasVehicleForward) {
    object.getWorldDirection(autoTourCameraFollowForwardScratch);
    autoTourCameraFollowForwardScratch.y = 0;
  }
  if (autoTourCameraFollowForwardScratch.lengthSq() < 1e-8) {
    autoTourCameraFollowForwardScratch.set(0, 0, 1);
  } else {
    autoTourCameraFollowForwardScratch.normalize();
  }

  autoTourCameraFollowController.update({
    follow: autoTourCameraFollowState,
    placement,
    anchorWorld: autoTourCameraFollowAnchorScratch,
    desiredForwardWorld: autoTourCameraFollowForwardScratch,
    velocityWorld: autoTourCameraFollowVelocity,
    deltaSeconds,
    ctx: { camera: context.camera, mapControls: undefined },
    immediate: Boolean(options.immediate),
    smoothTargetForProgrammaticFollow: false,
    ...(localOffsetOverride ? { localOffsetOverride } : {}),
    tuning: createBackFollowCameraTuning(),
    distanceScale: DEFAULT_BACK_FOLLOW_CAMERA_DISTANCE_SCALE,
    lockLocalOffset: true,
  })


  autoTourCameraFollowLastAnchor.copy(autoTourCameraFollowAnchorScratch);
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
    trySleepBody(chassisBody as PhysicsBodyLike);
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
    markPhysicsBridgeBodyDirty(nodeId);
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
    markPhysicsBridgeBodyDirty(nodeId);
  }

  if (vehicleInstance && chassisBody) {
    const wheelCount = Math.max(0, vehicleInstance.wheelCount || vehicleInstance.vehicle.wheelInfos.length || 0);
    for (let index = 0; index < wheelCount; index += 1) {
      vehicleInstance.vehicle.applyEngineForce(0, index);
      vehicleInstance.vehicle.setSteeringValue(0, index);
      vehicleInstance.vehicle.setBrake(0, index);
    }
    chassisBody.velocity.set(0, 0, 0);
    chassisBody.angularVelocity.set(0, 0, 0);
    resetPhysicsInterpolationState(chassisBody as PhysicsBodyLike);
    trySleepBody(chassisBody as PhysicsBodyLike);
    markPhysicsBridgeBodyDirty(nodeId);
    setSceneryAutoTourVehicleDesiredControl(vehicleInstance.vehicle, {
      targetSpeedMps: 0,
      steeringRad: 0,
    });
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

function activatePendingDefaultSteerDriveIfNeeded(): void {
  const event = pendingDefaultSteerDriveEvent.value;
  if (!event || vehicleDriveActive.value || vehicleDrivePromptBusy.value) {
    return;
  }
  pendingDefaultSteerDriveEvent.value = null;
  handleVehicleDriveEvent(event, { intro: true });
}

function retryPendingVehicleDriveIfNeeded(): void {
  if (!pendingVehicleDriveRetryRequested.value || vehicleDriveActive.value || vehicleDrivePromptBusy.value) {
    return;
  }
  const event = pendingVehicleDriveEvent.value;
  if (!event) {
    pendingVehicleDriveRetryRequested.value = false;
    return;
  }
  const result = startVehicleDriveMode(event);
  if (!result.success) {
    if (isVehicleDrivePendingReadinessMessage(result.message)) {
      return;
    }
    const message = result.message ?? '无法进入驾驶模式';
    uni.showToast({ title: message, icon: 'none' });
    resolveBehaviorToken(event.token, { type: 'fail', message });
    pendingVehicleDriveEvent.value = null;
    pendingVehicleDriveRetryRequested.value = false;
    return;
  }
  handleShowVehicleCockpitEvent();
  pendingVehicleDriveEvent.value = null;
  pendingVehicleDriveRetryRequested.value = false;
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
  const autoTourComponent = resolveAutoTourComponent(node);
  if (!node || !autoTourComponent) {
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
    resetAutoTourCameraFollowState();
    autoTourRotationOnlyHold.value = false;

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
  const placement = prepareAutoTourResumeBlendContext(targetNodeId, object, context);
  autoTourCameraFollowController.update({
    follow: autoTourResumeBlendState,
    placement,
    anchorWorld: autoTourCameraFollowAnchorScratch,
    desiredForwardWorld: autoTourCameraFollowForwardScratch,
    velocityWorld: autoTourCameraFollowVelocity,
    deltaSeconds: 1 / 60,
    ctx: { camera: autoTourResumeBlendTempCamera, mapControls: undefined },
    immediate: true,
    tuning: createBackFollowCameraTuning(),
    distanceScale: DEFAULT_BACK_FOLLOW_CAMERA_DISTANCE_SCALE,
    lockLocalOffset: true,
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

function handleVehicleDriveEvent(
  event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>,
  options: { intro?: boolean } = {},
): void {
  const targetNodeId = event.targetNodeId || event.nodeId || null;
  if (!targetNodeId) {
    uni.showToast({ title: '缺少驾驶目标', icon: 'none' });
    resolveBehaviorToken(event.token, { type: 'fail', message: '缺少驾驶目标' });
    return;
  }
  clearVehicleDriveIntroState();
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
  resetCharacterControlInputs();
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
  pendingVehicleDriveEvent.value = event;
  pendingVehicleDriveRetryRequested.value = false;
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
    const result = startVehicleDriveMode(event, { deferCameraUpdate: options.intro === true });
    if (!result.success) {
      if (isVehicleDrivePendingReadinessMessage(result.message)) {
        pendingVehicleDriveRetryRequested.value = true;
        return;
      }
      const message = result.message ?? '鏃犳硶杩涘叆椹鹃┒妯″紡';
      uni.showToast({ title: message, icon: 'none' });
      resolveBehaviorToken(event.token, { type: 'fail', message });
      pendingVehicleDriveEvent.value = null;
      pendingVehicleDriveRetryRequested.value = false;
      return;
    }
    handleShowVehicleCockpitEvent();
    if (options.intro) {
      requestVehicleDriveIntroStart(targetNodeId);
    }
    pendingVehicleDriveEvent.value = null;
    pendingVehicleDriveRetryRequested.value = false;
  } finally {
    vehicleDrivePromptBusy.value = false;
  }
}

function handleVehicleDebusEvent(): void {
  clearVehicleDriveIntroState();
  if (pendingVehicleDriveEvent.value) {
    resolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
      type: 'abort',
      message: '驾驶请求已被终止。',
    });
    pendingVehicleDriveEvent.value = null;
    pendingVehicleDriveRetryRequested.value = false;
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
  restoreHiddenVehicleDriveNodes();
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
    object.updateWorldMatrix(false, true);
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
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
      zoom: camera.zoom,
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
      camera.fov = snapshot.camera.fov;
      camera.near = snapshot.camera.near;
      camera.far = snapshot.camera.far;
      camera.zoom = snapshot.camera.zoom;
      camera.updateProjectionMatrix();
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
    markOverlayRuntimeDirty();
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

async function handleCouponEvent(event: Extract<BehaviorRuntimeEvent, { type: 'coupon' }>): Promise<void> {
  const targetNodeId = (event.targetNodeId ?? event.nodeId).trim();
  if (!targetNodeId) {
    return;
  }
  const targetNode = resolveNodeById(targetNodeId);
  const entry = resolveCouponNodeEntry(targetNode);
  if (!entry) {
    return;
  }
  const sceneId = (currentSceneId.value ?? currentDocument?.id ?? '').trim();
  const sceneName = (currentDocument?.name ?? '').trim();
  const nodeName = typeof targetNode?.name === 'string' ? targetNode.name : '';

  try {
    await grantCouponById(entry.couponId, {
      sceneId: sceneId || undefined,
      sceneName: sceneName || undefined,
      nodeId: targetNodeId,
      couponJson: entry.rawJson,
      triggeredAt: event.triggeredAt,
      source: 'scenery-viewer',
      metadata: {
        behaviorId: event.behaviorId,
        behaviorSequenceId: event.behaviorSequenceId,
        sequenceId: event.sequenceId,
        action: event.action,
      },
    });
  } catch (error) {
    console.warn('[SceneryViewer] Failed to grant coupon', error);
  }

  emit('coupon', {
    eventName: 'coupon',
    sceneId,
    sceneName,
    clientCouponTime: new Date().toISOString(),
    behaviorCouponTime: event.triggeredAt,
    location: {
      nodeId: targetNodeId,
      nodeName,
    },
    coupon: {
      id: entry.couponId,
      rawJson: entry.rawJson,
      type: entry.spec.type,
      name: entry.spec.name,
      description: entry.spec.description,
      validUntil: entry.spec.validUntil,
    },
  });
}


async function handleSwitchControlNodeEvent(
  event: Extract<BehaviorRuntimeEvent, { type: 'control-node-switch' }>,
): Promise<void> {
  const success = await switchControlNodeToAsset(event.targetType, event.prefabAssetId);
  resolveBehaviorToken(event.token, success
    ? { type: 'continue' }
    : { type: 'fail', message: '未找到可用的控制资产或实例化失败' });
}

async function handleRestoreControlNodeEvent(
  event: Extract<BehaviorRuntimeEvent, { type: 'control-node-restore' }>,
): Promise<void> {
  const success = await restoreControlNodeRuntime();
  resolveBehaviorToken(event.token, success
    ? { type: 'continue' }
    : { type: 'fail', message: '未找到可恢复的控制资产或实例化失败' });
}

function handleBehaviorRuntimeEvent(event: BehaviorRuntimeEvent) {
  switch (event.type) {
    case 'delay':
      handleDelayEvent(event);
      break;
    case 'move-to':
      handleMoveToEvent(event);
      break;
    case 'spawn-prefab':
      runtimePrefabBehaviorCounter += 1;
      queueRuntimePrefabSpawnRequest({
        requestId: `behavior:${event.sequenceId}:${event.behaviorId}:${runtimePrefabBehaviorCounter}`,
        assetId: event.assetId,
        targetNodeId: event.targetNodeId,
        initializationMode: event.initializationMode,
        placement: event.placement,
      }, { dedupe: false });
      break;
    case 'play-particle-effect':
      pendingParticleRuntimeCommands.push({
        nodeId: event.targetNodeId,
        command: {
          type: 'play',
          componentId: event.componentId,
          restart: event.restart,
        },
      });
      break;
    case 'stop-particle-effect':
      pendingParticleRuntimeCommands.push({
        nodeId: event.targetNodeId,
        command: {
          type: 'stop',
          componentId: event.componentId,
          softStop: event.softStop,
        },
      });
      break;
    case 'burst-particle-effect':
      pendingParticleRuntimeCommands.push({
        nodeId: event.targetNodeId,
        command: {
          type: 'burst',
          componentId: event.componentId,
          emitterId: event.emitterId,
          count: event.count ?? undefined,
        },
      });
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
    case 'stop-animation':
      handleStopAnimationEvent(event);
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
      handleHidePurposeControlsEvent(event);
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
    case 'control-node-switch':
      void handleSwitchControlNodeEvent(event);
      break;
    case 'control-node-restore':
      void handleRestoreControlNodeEvent(event);
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
    case 'coupon':
      void handleCouponEvent(event);
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
    raycastRoots.forEach((root) => root.updateWorldMatrix(true, true));
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
  backgroundTextureSourceKind = null;
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
  skyCubeZipAssetId = null;
  backgroundTextureSourceKind = null;
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
  mode: EnvironmentBackgroundMode,
): Promise<{ texture: THREE.Texture; dispose?: () => void } | null> {
  const resolve = await resolveAssetUrlReference(assetId);
  if (!resolve) {
    return null;
  }
  const dispose = resolve.dispose;
  try {
    if (mode === 'fastHdri') {
      const texture = await loadKtx2TextureFromUrl(resolve.url, renderContext?.renderer ?? null);
      texture.mapping = THREE.CubeUVReflectionMapping;
      texture.needsUpdate = true;
      return { texture, dispose };
    }
    if (mode === 'hdri') {
      const texture = await loadRgbETextureFromUrl(resolve.url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.needsUpdate = true;
      return { texture, dispose };
    }
    const texture = await loadTextureFromSourceUrl(resolve.url);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.flipY = false;
    texture.needsUpdate = true;
    ensureFloatTextureFilterCompatibility(texture);
    return { texture, dispose };
  } catch (error) {
    console.warn('[SceneViewer] Failed to load environment texture', assetId, error);
    return null;
  }
}

type SceneryFogState =
  | {
      cameraFar: number;
      fogNear: number;
      fogFar: number;
      fogDensity: number;
    }
  | null;

function resolveSceneryGroundFogCoverageDistance(
  activeCamera: THREE.PerspectiveCamera | null,
  snapshot: CameraFrameSnapshot | null = null,
): number | null {
  if (!activeCamera || !dynamicGroundCache) {
    return null;
  }
  const groundObject = resolveSceneObjectByNodeId(dynamicGroundCache.nodeId);
  if (!groundObject) {
    return null;
  }
  const groundMesh = dynamicGroundCache.dynamicMesh;
  const chunkSizeMeters = Number.isFinite(groundMesh.chunkSizeMeters) && Number(groundMesh.chunkSizeMeters) > 0
    ? Number(groundMesh.chunkSizeMeters)
    : 100;
  const renderRadiusChunks = Number.isFinite(groundMesh.renderRadiusChunks) && Number(groundMesh.renderRadiusChunks) > 0
    ? Math.max(1, Math.trunc(Number(groundMesh.renderRadiusChunks)))
    : 4;
  const unloadBufferChunks = Math.max(
    SCENERY_GROUND_FOG_UNLOAD_BUFFER_MIN_CHUNKS,
    Math.ceil(renderRadiusChunks * SCENERY_GROUND_FOG_UNLOAD_BUFFER_RATIO),
  );
  const visibleWindow = resolveInfiniteGroundVisibleChunkWindow(groundObject, groundMesh, activeCamera);
  const { minX, maxX, minZ, maxZ } = visibleWindow.localBounds;
  if (snapshot) {
    sceneryFogCameraWorldScratch.copy(snapshot.position);
  } else {
        activeCamera.updateWorldMatrix(true, false);
    activeCamera.getWorldPosition(sceneryFogCameraWorldScratch);
  }
  const cameraLocal = groundObject.worldToLocal(sceneryFogCameraWorldScratch);
  const farCornerDistance = Math.max(
    Math.hypot(cameraLocal.x - minX, cameraLocal.z - minZ),
    Math.hypot(cameraLocal.x - minX, cameraLocal.z - maxZ),
    Math.hypot(cameraLocal.x - maxX, cameraLocal.z - minZ),
    Math.hypot(cameraLocal.x - maxX, cameraLocal.z - maxZ),
  );
  let coverageDistance = farCornerDistance + unloadBufferChunks * chunkSizeMeters;
  if (groundMesh.farHorizonEnabled) {
    const farHorizonDistance = Number(groundMesh.farHorizonDistanceMeters);
    if (Number.isFinite(farHorizonDistance) && farHorizonDistance > 0) {
      coverageDistance = Math.min(coverageDistance, farHorizonDistance);
    }
  }
  return Math.max(SCENERY_FOG_MIN_DISTANCE, coverageDistance);
}

function resolveSceneryFogState(
  settings: EnvironmentSettings,
  activeCamera: THREE.PerspectiveCamera | null = renderContext?.camera ?? null,
  snapshot: CameraFrameSnapshot | null = null,
): SceneryFogState {
  if (settings.fogMode === 'none') {
    return null;
  }
  const groundCoverageDistance = resolveSceneryGroundFogCoverageDistance(activeCamera, snapshot);
  if (settings.fogMode === 'linear') {
    const sourceNear = Math.max(0, settings.fogNear);
    const sourceFar = Math.max(sourceNear + SCENERY_FOG_MIN_DISTANCE, settings.fogFar);
    const cameraFar = Math.max(
      sourceNear + SCENERY_FOG_MIN_DISTANCE,
      Math.min(sourceFar, groundCoverageDistance ?? sourceFar),
    );
    const fogFar = Math.max(
      sourceNear + SCENERY_FOG_MIN_DISTANCE,
      cameraFar * SCENERY_FOG_HEADROOM_RATIO,
    );
    const fogNear = Math.min(
      fogFar - SCENERY_FOG_MIN_DISTANCE,
      Math.max(0, sourceNear * (fogFar / cameraFar)),
    );
    return {
      cameraFar,
      fogNear,
      fogFar,
      fogDensity: 0,
    };
  }
  const density = Math.max(0, settings.fogDensity);
  const baseCameraFar = DEFAULT_SCENE_CAMERA_FAR;
  const cameraFar = Math.max(
    SCENERY_FOG_MIN_DISTANCE,
    Math.min(baseCameraFar, groundCoverageDistance ?? baseCameraFar),
  );
  const coverageScale = THREE.MathUtils.clamp(baseCameraFar / cameraFar, 0.5, 4);
  return {
    cameraFar,
    fogNear: 0,
    fogFar: 0,
    fogDensity: density <= 0 ? 0 : (density * coverageScale) / SCENERY_FOG_HEADROOM_RATIO,
  };
}

function applyFogSettings(
  settings: EnvironmentSettings,
  activeCamera: THREE.PerspectiveCamera | null = renderContext?.camera ?? null,
  snapshot: CameraFrameSnapshot | null = null,
) {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return;
  }
  const fogState = resolveSceneryFogState(settings, activeCamera, snapshot);
  const syncCameraFar = (nextFar: number) => {
    if (!activeCamera || Math.abs(activeCamera.far - nextFar) <= 1e-6) {
      return;
    }
    activeCamera.far = nextFar;
    activeCamera.updateProjectionMatrix();
    sceneCsmShadowRuntime?.updateFrustums();
    markInstancedCullingDirty();
  };
  if (!fogState) {
    if (scene.fog) {
      scene.fog = null;
    }
    syncCameraFar(DEFAULT_SCENE_CAMERA_FAR);
    appliedSceneryFogSnapshot = {
      mode: 'none',
      color: '',
      cameraFar: DEFAULT_SCENE_CAMERA_FAR,
      fogNear: 0,
      fogFar: 0,
      fogDensity: 0,
    };
    return;
  }
  const nextSnapshot: AppliedSceneryFogSnapshot = {
    mode: settings.fogMode,
    color: settings.fogColor,
    cameraFar: fogState.cameraFar,
    fogNear: fogState.fogNear,
    fogFar: fogState.fogFar,
    fogDensity: fogState.fogDensity,
  };
  const previousSnapshot = appliedSceneryFogSnapshot;
  syncCameraFar(fogState.cameraFar);
  if (
    previousSnapshot
    && previousSnapshot.mode === nextSnapshot.mode
    && previousSnapshot.color === nextSnapshot.color
    && Math.abs(previousSnapshot.cameraFar - nextSnapshot.cameraFar) <= 1e-6
    && Math.abs(previousSnapshot.fogNear - nextSnapshot.fogNear) <= 1e-6
    && Math.abs(previousSnapshot.fogFar - nextSnapshot.fogFar) <= 1e-6
    && Math.abs(previousSnapshot.fogDensity - nextSnapshot.fogDensity) <= 1e-6
  ) {
    return;
  }
  sceneryFogColorScratch.set(settings.fogColor);
  if (settings.fogMode === 'linear') {
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(sceneryFogColorScratch);
      scene.fog.near = fogState.fogNear;
      scene.fog.far = fogState.fogFar;
    } else {
      scene.fog = new THREE.Fog(sceneryFogColorScratch.clone(), fogState.fogNear, fogState.fogFar);
    }
    appliedSceneryFogSnapshot = nextSnapshot;
    return;
  }
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.copy(sceneryFogColorScratch);
    scene.fog.density = fogState.fogDensity;
  } else {
    scene.fog = new THREE.FogExp2(sceneryFogColorScratch.clone(), fogState.fogDensity);
  }
  appliedSceneryFogSnapshot = nextSnapshot;
}

function applyPhysicsEnvironmentSettings(settings: EnvironmentSettings) {
  const gravity = clampNumber(settings.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY);
  physicsEnvironmentEnabled.value = settings.physicsEnabled !== false;
  physicsGravity.set(0, -gravity, 0);
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
    const assetId = background.backgroundAssetId ?? null;
    if (assetId) {
      const resolvedAsset = await resolveAssetUrlReference(assetId);
      const assetExtension = inferEnvironmentAssetExtension(assetId, resolvedAsset);
      if (!isSkyCubeArchiveExtension(assetExtension)) {
        if (backgroundTexture && backgroundAssetId === assetId && backgroundTextureSourceKind === 'texture') {
          scene.background = backgroundTexture;
          return true;
        }
        const loadedTexture = await loadEnvironmentTextureFromAsset(assetId, background.mode);
        if (!loadedTexture || token !== backgroundLoadToken) {
          if (loadedTexture) {
            loadedTexture.texture.dispose();
            loadedTexture.dispose?.();
          }
          return false;
        }
        disposeBackgroundResources();
        backgroundTexture = loadedTexture.texture;
        backgroundTextureSourceKind = 'texture';
        backgroundAssetId = assetId;
        backgroundTextureCleanup = loadedTexture.dispose ?? null;
        scene.background = backgroundTexture;
        return true;
      }

      if (skyCubeTexture  && skyCubeZipAssetId === assetId) {
        scene.background = skyCubeTexture;
        return true;
      }
      const zipUrl = resolvedAsset?.url ?? null;
      const disposeZipRef = resolvedAsset?.dispose ?? null;
      if (!zipUrl) {
        disposeZipRef?.();
        console.warn('[SceneViewer] SkyCube zip URL unavailable', assetId);
        return false;
      }
      let buffer: ArrayBuffer | null = null;
      try {
        buffer = await requestBinaryFromUrl(zipUrl);
      } catch (error) {
        disposeZipRef?.();
        console.warn('[SceneViewer] Failed to download SkyCube zip', assetId, error);
        return false;
      } finally {
        disposeZipRef?.();
      }
      if (token !== backgroundLoadToken) {
        return false;
      }
      let extracted: Awaited<ReturnType<typeof extractSkycubeZipFacesAsync>>;
      try {
        extracted = await extractSkycubeZipFacesAsync(buffer);
      } catch (error) {
        console.warn('[SceneViewer] Failed to unzip SkyCube zip', assetId, error);
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
      skyCubeZipAssetId = assetId;
      skyCubeZipFaceUrlCleanup = disposeFaceUrls;
      scene.background = skyCubeTexture;
      return true;
    }
    return true;
  }
  if ((background.mode !== 'hdri' && background.mode !== 'fastHdri') || !background.backgroundAssetId) {
    disposeGradientBackgroundDome(gradientBackgroundDome);
    gradientBackgroundDome = null;
    disposeBackgroundResources();
    scene.background = new THREE.Color(background.solidColor);
    return true;
  }
  if (backgroundTexture && backgroundAssetId === background.backgroundAssetId) {
    disposeGradientBackgroundDome(gradientBackgroundDome);
    gradientBackgroundDome = null;
    scene.background = backgroundTexture;
    return true;
  }
  const loaded = await loadEnvironmentTextureFromAsset(background.backgroundAssetId,background.mode);
  if (!loaded || token !== backgroundLoadToken) {
    if (loaded) {
      loaded.texture.dispose();
      loaded.dispose?.();
    }
    return false;
  }
  disposeBackgroundResources();
  backgroundTexture = loaded.texture;
  backgroundTextureSourceKind = 'texture';
  backgroundAssetId = background.backgroundAssetId;
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
  if (
    backgroundTexture &&
    (background.mode === 'hdri' || background.mode === 'fastHdri' || (background.mode === 'skycube' && backgroundTextureSourceKind === 'texture'))
  ) {
    scene.environment = backgroundTexture;
  } else {
    scene.environment = null;
  }
  scene.environmentIntensity = 1;
  return true;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function applyEnvironmentTextureRotation(settings: EnvironmentSettings): void {
  const scene = renderContext?.scene ?? null;
  if (!scene) {
    return;
  }
  const rot = settings.environmentRotationDegrees ?? { x: 0, y: 0, z: 0 };
  const euler = new THREE.Euler(
    degreesToRadians(rot.x ?? 0),
    degreesToRadians(rot.y ?? 0),
    degreesToRadians(rot.z ?? 0),
    'XYZ',
  );
  scene.backgroundRotation.copy(euler);
  scene.environmentRotation.copy(euler);
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
  ensureSceneCsmShadowRuntime();
  applyFogSettings(snapshot, renderContext?.camera ?? null);
  const backgroundApplied = await applyBackgroundSettings(snapshot.background);
  const environmentApplied = applyEnvironmentReflectionFromBackground(snapshot.background);

  applyEnvironmentTextureRotation(snapshot);
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
  appliedSceneryFogSnapshot = null;
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

function findFirstGroundNode(document: SceneJsonExportDocument): SceneNode | null {
  const stack = [...document.nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.dynamicMesh?.type === 'Ground') {
      return node;
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return null;
}

function countLandformNodes(document: SceneJsonExportDocument): number {
  const stack = [...document.nodes];
  let count = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.dynamicMesh?.type === 'Landform') {
      count += 1;
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children);
    }
  }
  return count;
}

function hydrateGroundSidecarFromPackage(
  pkg: ScenePackageUnzipped,
  sceneEntry: {
    sceneId: string;
    path: string;
    groundHeightPath?: string;
    groundSplatPath?: string;
    groundScatterPath?: string;
  },
  document: SceneJsonExportDocument,
): SceneJsonExportDocument {
  const groundNode = findFirstGroundNode(document);
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return document;
  }
  const hasLandformNodes = countLandformNodes(document) > 0;
  const sidecarPath = typeof sceneEntry.groundHeightPath === 'string' ? sceneEntry.groundHeightPath.trim() : '';
  if (sidecarPath) {
    const sidecarBytes = pkg.files[sidecarPath];
    if (!sidecarBytes) {
      throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground height sidecar 文件内容`);
    }
    const sidecarBuffer = sidecarBytes.buffer.slice(
      sidecarBytes.byteOffset,
      sidecarBytes.byteOffset + sidecarBytes.byteLength,
    );
    try {
      groundNode.dynamicMesh = createGroundRuntimeMeshFromSidecar(groundNode.dynamicMesh, sidecarBuffer);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : `场景 ${sceneEntry.sceneId} 的 ground height sidecar 无效`);
    }
  }
  const runtimeGroundMesh = groundNode.dynamicMesh as GroundDynamicMesh & {
    runtimeHydratedHeightState?: 'pristine' | 'dirty' | 'none';
    runtimeDisableOptimizedChunks?: boolean;
  };
  runtimeGroundMesh.runtimeHydratedHeightState = sidecarPath ? (runtimeGroundMesh.runtimeHydratedHeightState ?? 'none') : 'none';
  runtimeGroundMesh.runtimeDisableOptimizedChunks = false;

  const splatSidecarPath = typeof sceneEntry.groundSplatPath === 'string' ? sceneEntry.groundSplatPath.trim() : '';
  if (splatSidecarPath) {
    const splatSidecarBytes = pkg.files[splatSidecarPath];
    if (!splatSidecarBytes) {
      if (hasLandformNodes) {
        throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground splat sidecar 文件内容`);
      }
      (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSurfaceChunks = null;
      (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSplatBake = null;
    } else {
      const splatSidecarBuffer = new ArrayBuffer(splatSidecarBytes.byteLength);
      new Uint8Array(splatSidecarBuffer).set(splatSidecarBytes);
      const splatPayload = deserializeGroundSplatSidecar(splatSidecarBuffer);
      const bakedChunks = splatPayload.groundSurfaceChunks && Object.keys(splatPayload.groundSurfaceChunks).length > 0
        ? splatPayload.groundSurfaceChunks
        : null;
      if (!bakedChunks) {
        if (hasLandformNodes) {
          throw new Error(`场景 ${sceneEntry.sceneId} 的 ground splat sidecar 缺少 baked chunk 数据`);
        }
        (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSurfaceChunks = null;
        (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSplatBake = null;
      } else {
        (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSurfaceChunks = JSON.parse(JSON.stringify(bakedChunks));
        (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSplatBake = {
          revision: Number.isFinite(splatPayload.revision) ? Math.max(0, Math.trunc(splatPayload.revision)) : 0,
          chunkTextureMap: JSON.parse(JSON.stringify(bakedChunks)),
          surfaceLayerTextureAssetIds: Array.isArray(splatPayload.surfaceLayerTextureAssetIds)
            ? [...splatPayload.surfaceLayerTextureAssetIds]
            : null,
        };
      }
    }
  } else {
    (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSurfaceChunks = null;
    (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).groundSplatBake = null;
    if (hasLandformNodes) {
      throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground splat sidecar 文件`);
    }
  }

  const scatterSidecarPath = typeof sceneEntry.groundScatterPath === 'string' ? sceneEntry.groundScatterPath.trim() : '';
  if (!scatterSidecarPath) {
    (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).terrainScatter = null;
  } else {
    const scatterSidecarBytes = pkg.files[scatterSidecarPath];
    if (!scatterSidecarBytes) {
      throw new Error(`场景 ${sceneEntry.sceneId} 缺少 ground scatter sidecar 文件`);
    }
    const scatterSidecarBuffer = new ArrayBuffer(scatterSidecarBytes.byteLength);
    new Uint8Array(scatterSidecarBuffer).set(scatterSidecarBytes);
    const scatterPayload = deserializeGroundScatterSidecar(scatterSidecarBuffer);
    (groundNode.dynamicMesh as GroundRuntimeDynamicMesh).terrainScatter = scatterPayload.terrainScatter;
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

      previewPayload.value = {
        document: entry.document,
        title: entry.document.name || entry.name || '场景预览',
        origin: 'scene-package',
        compiledGroundBuildKey: projectBundle.value?.compiledGroundBuildKey ?? activeScenePackageBuildKey ?? null,
        assetOverrides: sceneOverrides,
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
        compiledGroundBuildKey: null,
        assetOverrides: undefined,
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

async function loadProjectFromScenePackageUrl(url: string, cacheKey?: string): Promise<void> {
  error.value = null;
  activeScenePackageAssetOverrides = null;
  activeScenePackagePkg = null;
  activeScenePackageBuildKey = null;
  lastCompiledGroundLoadedChunkVersion = -1;
  loading.value = true;
  try {
    resetSceneDownloadState();
    const cacheKeyParam = typeof cacheKey === 'string' && cacheKey.trim() ? cacheKey.trim() : '';
    const cachePointer = cacheKeyParam ? resolveScenePackageZipPointerByCacheKey(cacheKeyParam) : null;
    const cachedEntry = cachePointer ? await loadScenePackageZipEntry(cachePointer).catch(() => null) : null;
    const cachedBuffer = cachedEntry?.bytes ?? null;
    const cachedMetadata = cachedEntry?.metadata ?? null;

    const loadCachedScenePackage = async (): Promise<boolean> => {
      if (!cachedBuffer || !cachedBuffer.byteLength) {
        return false;
      }
      try {
        await loadProjectFromScenePackageBytes(cachedBuffer, cacheKeyParam || url);
        return true;
      } catch (parseError) {
        console.warn('Cached scene package failed to parse, removing cache entry', parseError);
        if (cachePointer) {
          await removeScenePackageZip(cachePointer);
        }
        return false;
      }
    };

    const requestHeaders: Record<string, string> = {
      Accept: 'application/zip',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    if (cachedMetadata?.etag) {
      requestHeaders['If-None-Match'] = cachedMetadata.etag;
    } else if (cachedMetadata?.lastModified) {
      requestHeaders['If-Modified-Since'] = cachedMetadata.lastModified;
    }

    setSceneDownloadState({
      phase: 'download',
      label: cachedMetadata ? '正在校验场景包更新' : '正在下载场景包',
      detail: cachedMetadata
        ? '优先读取本地缓存，并向远端校验是否有新版本。'
        : '正在从远端获取场景包二进制数据。',
      percent: cachedMetadata ? 8 : 0,
      loaded: 0,
      total: 0,
      currentIndex: 0,
      currentTotal: 0,
      currentLabel: '',
      indeterminate: true,
    });
    await yieldToMainThread();

    if (sceneDownloadController) {
      sceneDownloadController.abort();
    }
    const controller = new AbortController();
    sceneDownloadController = controller;

    let downloadResult: AssetBlobDownloadResult | null = null;
    try {
      downloadResult = await fetchAssetBlobWithResponse(url, controller, (progress) => {
        sceneDownload.phase = 'download';
        sceneDownload.percent = clampPercent(progress);
        sceneDownload.indeterminate = false;
        sceneDownload.label = `正在下载场景包… ${sceneDownload.percent}%`;
      }, requestHeaders).then((result) => result, async (requestError) => {
        if (cachedBuffer && await loadCachedScenePackage()) {
          return null;
        }
        throw requestError;
      });
    } finally {
      if (sceneDownloadController === controller) {
        sceneDownloadController = null;
      }
    }

    if (!downloadResult) {
      return;
    }

    if (downloadResult.kind === 'not-modified') {
      if (await loadCachedScenePackage()) {
        return;
      }
      throw new Error('远端场景包未变化，但本地缓存不存在或已损坏');
    }

    const buffer = await downloadResult.blob.arrayBuffer();
    await loadProjectFromScenePackageBytes(buffer, cacheKeyParam || url);
    if (cacheKeyParam) {
      const metadata: ScenePackageCacheMetadata = {
        sourceUrl: downloadResult.url || url,
        etag: downloadResult.headers.etag ?? null,
        lastModified: downloadResult.headers['last-modified'] ?? null,
        contentLength: Number.isFinite(Number(downloadResult.headers['content-length']))
          ? Math.max(0, Math.trunc(Number(downloadResult.headers['content-length'])))
          : buffer.byteLength,
        fetchedAt: Date.now(),
      };
      void saveScenePackageZipByCacheKey(buffer, cacheKeyParam, metadata).catch((saveError) => {
        console.warn('Failed to persist scene package cache', saveError);
      });
    }
  } catch (loadError) {
    console.error('Failed loading scene package from url', loadError);
    throw loadError;
  } finally {
    clearSceneDownloadState();
    loading.value = false;
  }
}
async function parseScenePackageToProjectData(pkg: ScenePackageUnzipped, compiledGroundBuildKey: string): Promise<ScenePackageProjectData> {
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
  for (let sceneIndex = 0; sceneIndex < pkg.manifest.scenes.length; sceneIndex += 1) {
    const sceneEntry = pkg.manifest.scenes[sceneIndex];
    const sceneRaw = decodeScenePackageSceneDocument(readBinaryFileFromScenePackage(pkg, sceneEntry.path)) as unknown;
    if (!sceneRaw || typeof sceneRaw !== 'object') {
      throw new Error(`场景包内场景数据无效：${sceneEntry.path}`);
    }
    const document = hydrateGroundSidecarFromPackage(pkg, sceneEntry, sceneRaw as SceneJsonExportDocument);
    attachScenePackageTerrainRuntime(pkg, sceneEntry, document);
    const compiledGroundManifest = readCompiledGroundManifestFromScenePackage(pkg, sceneEntry);
    const attachedCompiledGroundManifest = attachScenePackageCompiledGroundRuntime(compiledGroundManifest, document);
    const compiledTileCount = Array.isArray(attachedCompiledGroundManifest?.renderTiles)
      ? attachedCompiledGroundManifest.renderTiles.length
      : 0;
    requireGroundRuntimeAssets(document, compiledTileCount);
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
    });
    await yieldToMainThread();
  }

    return {
      project: {
        id: String(projectConfig?.id ?? ''),
        name: String(projectConfig?.name ?? ''),
        defaultSceneId: (projectConfig?.defaultSceneId as string | null) ?? null,
        lastEditedSceneId: (projectConfig?.lastEditedSceneId as string | null) ?? null,
        sceneOrder: Array.isArray(projectConfig?.sceneOrder) ? projectConfig.sceneOrder : scenes.map((s) => s.id),
      },
      compiledGroundBuildKey,
      scenes,
    };
  }

async function loadProjectFromScenePackageBytes(buffer: ArrayBuffer, compiledGroundBuildKey: string): Promise<void> {
  sceneDownload.active = true;
  setSceneDownloadState({
    phase: 'unzip',
    label: '正在解压场景包',
    detail: '正在读取 ZIP 目录与资源清单。',
    percent: 12,
    currentIndex: 0,
    currentTotal: 0,
    currentLabel: '',
    indeterminate: true,
  });
  await yieldToMainThread();

  const pkg = unzipScenePackage(buffer);
  setSceneDownloadState({
    phase: 'manifest',
    label: '正在解析 manifest',
    detail: `${pkg.manifest.scenes.length} 个场景 / ${pkg.manifest.resources.length} 个资源`,
    percent: 18,
    currentIndex: 0,
    currentTotal: 0,
    currentLabel: '',
    indeterminate: true,
  });
  await yieldToMainThread();

  activeScenePackagePkg = pkg;
  setSceneDownloadState({
    phase: 'resource-map',
    label: '正在构建资源覆盖表',
    detail: '正在生成包内资源到运行时资源的映射。',
    percent: 36,
    currentIndex: 0,
    currentTotal: pkg.manifest.resources.length,
    currentLabel: '',
  });
  await yieldToMainThread();
  activeScenePackageAssetOverrides = buildAssetOverridesFromScenePackage(pkg);

  setSceneDownloadState({
    phase: 'project-meta',
    label: '正在解析项目配置',
    detail: pkg.manifest.project.path,
    percent: 48,
    currentIndex: 0,
    currentTotal: pkg.manifest.scenes.length,
    currentLabel: '',
  });
  await yieldToMainThread();

  const normalizedBuildKey = compiledGroundBuildKey.trim();
  activeScenePackageBuildKey = normalizedBuildKey || null;
  const projectData = await parseScenePackageToProjectData(activeScenePackagePkg, normalizedBuildKey);
  setSceneDownloadState({
    phase: 'bundle',
    label: '正在组装场景索引',
    detail: `${projectData.scenes.length} 个场景`,
    percent: 72,
    currentIndex: projectData.scenes.length,
    currentTotal: projectData.scenes.length,
    currentLabel: '',
  });
  await yieldToMainThread();
  await loadProjectFromBundle(projectData);
}
async function loadProjectFromScenePackagePointer(pointer: ScenePackagePointer): Promise<void> {
  error.value = null;
  activeScenePackageAssetOverrides = null;
  activeScenePackagePkg = null;
  activeScenePackageBuildKey = null;
  lastCompiledGroundLoadedChunkVersion = -1;
  loading.value = true;
  try {
    resetSceneDownloadState();
    setSceneDownloadState({
      phase: 'read-cache',
      label: '正在读取本地缓存场景包',
      detail: '正在优先从本地缓存中恢复场景包数据。',
      percent: 8,
      currentIndex: 0,
      currentTotal: 0,
      currentLabel: '',
      indeterminate: true,
    });
    await yieldToMainThread();
    const buffer = await loadScenePackageZip(pointer);
    if (!buffer || buffer.byteLength <= 0) {
      throw new Error('场景包数据为空，请重新导入');
    }
    await loadProjectFromScenePackageBytes(buffer, normalizeScenePackageBuildKey(pointer));
  } catch (e) {
    console.error(e);
    error.value = '场景包加载失败，请返回首页重新导入';
    previewPayload.value = null;
  } finally {
    sceneDownload.active = false;
    loading.value = false;
  }
}
function requestSceneDocument(url: string): Promise<SceneJsonExportDocument> {
  if (sceneDownloadController) {
    sceneDownloadController.abort();
  }
  const controller = new AbortController();
  sceneDownloadController = controller;
  return fetchAssetBlob(url, controller, (progress) => {
    sceneDownload.phase = 'download';
    sceneDownload.percent = clampPercent(progress);
    sceneDownload.indeterminate = false;
    sceneDownload.label = `正在下载场景数据… ${sceneDownload.percent}%`;
  }).then(async ({ blob }) => {
    if (sceneDownloadController === controller) {
      sceneDownloadController = null;
    }
    const payload = typeof blob.text === 'function' ? await blob.text() : new TextDecoder().decode(await blob.arrayBuffer());
    return parseSceneDocument(payload);
  }, (error) => {
    if (sceneDownloadController === controller) {
      sceneDownloadController = null;
    }
    throw error;
  });
}

function resetSceneDownloadState(): void {
  clearSceneDownloadState();
}

function resetScenePreviewRuntimeState(): void {
  teardownRenderer();
  resetRemovedSkyState();
  clearSceneInitState();
  warnings.value = [];
  localMultiuserVehiclePresentationByNodeId.clear();
  localMultiuserCharacterPresentationByNodeId.clear();
}

function prepareScenePreviewPayload(payload: ScenePreviewPayload): void {
  error.value = null;
  warnings.value = [];
  resetRemovedSkyState();
  pendingEnvironmentSettings = cloneEnvironmentSettings(resolveDocumentEnvironment(payload.document));
  try {
    uni.setNavigationBarTitle({ title: payload.title || '场景预览' });
  } catch (_error) {
    // ignore
  }
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
      resetScenePreviewRuntimeState();
      return;
    }
    handlePreviewPayload(payload);
  },
  { flush: 'post' },
);

function handlePreviewPayload(payload: ScenePreviewPayload | null) {
  if (!payload) {
    resetScenePreviewRuntimeState();
    return;
  }
  prepareScenePreviewPayload(payload);
  startRenderIfReady();
}

async function startRenderIfReady() {
  const payload = previewPayload.value;
  const canvas = canvasResult;
  if (!payload || !canvas) {
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
    await ensureRendererContext(canvas);
    resourcePreload.label = '正在准备运行时 prefab 资源...';
    const runtimePrefabPreloadContext = await collectRuntimePrefabPreloadContext(props.runtimePrefabSpawns, runtimePrefabSourceResolverOptions);
    if (!isCurrentInitializationToken(token)) {
      return;
    }
    const preparedPayload = await prepareRenderPayloadForSceneEntry(payload, runtimePrefabPreloadContext);
    if (!isCurrentInitializationToken(token)) {
      return;
    }
    const warmReady = await warmRuntimePrefabAssetsForSceneEntry(preparedPayload, runtimePrefabPreloadContext, token);
    if (!warmReady) {
      return;
    }
    const rendered = await commitSceneEntryRendering(preparedPayload, canvas, token);
    if (rendered) {
      hasRenderedSceneOnce = true;
      emit('loaded');
    }
  } catch (initializationError) {
    console.error('Renderer initialization failed', initializationError);
    console.error(initializationError);
    if (isCurrentInitializationToken(token)) {
      error.value = '初始化渲染器失败';
      setSceneInitState({
        stage: 'error',
        label: '初始化失败',
        stagePercent: sceneInit.percent,
        currentIndex: sceneInit.currentIndex,
        currentTotal: sceneInit.currentTotal,
        active: false,
      });
    }
  } finally {
    if (isCurrentInitializationToken(token)) {
      loading.value = false;
      clearSceneInitState();
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
  clearSceneInitState();
  clearVehicleDriveIntroState();
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
  pendingRuntimePrefabSpawnRequests.length = 0;
  appliedRuntimePrefabSpawnKeys.clear();
  pendingDefaultSteerDriveEvent.value = null;
  clearSpawnedRuntimePrefabRoots();
  previewNodeMap.clear();
  clearSteerBindingIndex();
  autoTourRuntime.reset();
  activeAutoTourNodeIds.clear();
  autoTourRotationOnlyHold.value = false;
  autoTourFollowNodeId.value = null;
  resetAutoTourCameraFollowState();
  nodeObjectMap.forEach((_object, nodeId) => {
    releaseModelInstance(nodeId);
  });
  nodeObjectMap.clear();
  instancedLodRuntimeEntryCache.clear();
  instancedLodRuntimeRevision += 1;
  instancedLodLastProcessedRevision = -1;
  instancedLodLastCameraStateValid = false;
  multiuserNodeIds.clear();
  multiuserNodeObjects.clear();
  networkSyncNodeEntries.clear();
  characterControllerAnimationRuntime.clear();
  characterAutoTourRuntime.clear();
  physicsBridgeContactsByNodeId.clear();
  remoteSharedEntityEntries.clear();
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
  disposeSignboardBillboards(renderContext?.scene ?? null);
  clearInstancedMeshes();
  clearSceneryCompiledGroundRenderRuntime();
  disposeObject(scene);
  disposeMaterialTextureCache();
  renderer.dispose();
  renderContext = null;
  canvasResult = null;
  clearRemoteMultiuserPeers();
  resetRemoteSharedEntities();
  setActiveMultiuserRuntimeBridge(null);
  setActiveMultiuserSceneId(null);
  currentDocument = null;
  latestControlNodeRestoreSnapshot = null;
  dynamicGroundCache = null;
  sceneGraphRoot = null;
  viewerResourceCache = null;
  activeScenePackageBuildKey = null;
  lastCompiledGroundLoadedChunkVersion = -1;
  compiledGroundForceNextUpdate = true;
  sceneCsmForceNextUpdate = true;
  overlaySyncForceNextUpdate = true;
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
  compiledGroundForceNextUpdate = true;
  sceneCsmForceNextUpdate = true;
  overlaySyncForceNextUpdate = true;
  instancedLodLastProcessedRevision = -1;
  instancedLodLastCameraStateValid = false;
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
  // Reduce the cost of the transmission buffer for scenes that use physical materials.
  ;(renderer as THREE.WebGLRenderer & { transmissionResolutionScale?: number }).transmissionResolutionScale = 0.5

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, DEFAULT_SCENE_CAMERA_FAR);

  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
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
  let runtimePayload: ScenePreviewPayload = payload;
  let lastResourceProgressLogKey = '';
  try {
    const runtimeDocument = await prepareCouponSceneDocument(payload.document);
    payload.document = runtimeDocument;
    runtimePayload = {
      ...payload,
      document: runtimeDocument,
    };
    lazyLoadMeshesEnabled = runtimeDocument.lazyLoadMeshes !== false;
    setSceneInitState({
      stage: 'building',
      label: '姝ｅ湪鏋勫缓鍦烘櫙鍥炬牳',
      detail: '姝ｅ湪鍑嗗璧勬簮鍜屽浘褰㈡爧...',
      stagePercent: 0,
      currentIndex: 0,
      currentTotal: 0,
      currentLabel: '',
      active: true,
    });
    const buildOptions = createSceneGraphBuildOptions(runtimePayload, (info) => {
      const progressPercent = info.total > 0
        ? (info.loaded / info.total) * 100
        : resourcePreload.totalBytes > 0
          ? (resourcePreload.loadedBytes / Math.max(resourcePreload.totalBytes, 1)) * 100
          : 0;
      const progressKey = [
        info.loaded,
        info.total,
        Math.round(progressPercent),
        resourcePreload.loadedBytes,
        resourcePreload.totalBytes,
        info.assetId ?? '',
        info.message ?? '',
      ].join('|');
      if (progressKey !== lastResourceProgressLogKey) {
        lastResourceProgressLogKey = progressKey;
      }
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
      setSceneInitState({
        stage: 'building',
        label: '正在构建场景图',
        detail: resourcePreload.label,
        stagePercent: info.total > 0
          ? (info.loaded / info.total) * 100
          : resourcePreload.totalBytes > 0
            ? (resourcePreload.loadedBytes / Math.max(resourcePreload.totalBytes, 1)) * 100
            : 0,
        currentIndex: info.loaded,
        currentTotal: info.total,
        currentLabel: resourcePreload.label,
        active: true,
      });

      const stillLoadingByCount = info.total > 0 && info.loaded < info.total;
      const stillLoadingByBytes =
        resourcePreload.total > 0 && resourcePreload.totalBytes > 0 && resourcePreload.loadedBytes < resourcePreload.totalBytes;
      resourcePreload.active = stillLoadingByCount || stillLoadingByBytes;
    });

    resourceCache = ensureResourceCache(runtimePayload.document, buildOptions);
    viewerResourceCache = resourceCache;
    refreshDynamicGroundCache(runtimePayload.document);
    try {
      graph = await buildSceneGraph(runtimePayload.document, resourceCache, buildOptions);
    } catch (error) {
      throw error;
    }
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
    skipNodeIds.forEach((nodeId) => {
      if (canNodeUseRuntimeModelInstancing(resolveNodeById(nodeId))) {
        deferredInstancingNodeIds.add(nodeId);
      }
    });
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

async function warmRuntimePrefabAssetsBeforeSceneEntry(
  resourceCache: ResourceCache,
  preloadContext: RuntimePrefabPreloadContext,
): Promise<void> {
  const assetIds = preloadContext.warmAssetIds.length ? preloadContext.warmAssetIds : preloadContext.meshAssetIds;
  if (!assetIds.length) {
    return;
  }

  resourcePreload.active = true;
  resourcePreload.total = assetIds.length;
  resourcePreload.loaded = 0;
  resourcePreload.totalBytes = 0;
  resourcePreload.loadedBytes = 0;
  resourcePreload.label = '正在准备运行时 prefab 资源...';
  setSceneInitState({
    stage: 'preparing',
    label: '正在预热运行时 prefab 资源',
    detail: resourcePreload.label,
    stagePercent: 0,
    currentIndex: 0,
    currentTotal: assetIds.length,
    currentLabel: resourcePreload.label,
    active: true,
  });

  for (let index = 0; index < assetIds.length; index += 1) {
    const assetId = assetIds[index];
    try {
      await resourceCache.acquireAssetEntry(assetId);
    } catch (error) {
      console.warn('[SceneViewer] Failed to prewarm runtime prefab asset', assetId, error);
    } finally {
      resourcePreload.loaded = index + 1;
      setSceneInitState({
        stage: 'preparing',
        label: '正在预热运行时 prefab 资源',
        detail: resourcePreload.label,
        stagePercent: ((index + 1) / Math.max(assetIds.length, 1)) * 100,
        currentIndex: index + 1,
        currentTotal: assetIds.length,
        currentLabel: assetId,
        active: true,
      });
    }
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

  setSceneInitState({
    stage: 'mounting',
    label: '正在挂载场景',
    detail: '正在重建预览索引...',
    stagePercent: 0,
    currentIndex: 0,
    currentTotal: 6,
    currentLabel: 'rebuildPreviewNodeMap',
    active: true,
  });
  rebuildPreviewNodeMap(payload.document);
  await yieldToMainThread();

  setSceneInitState({
    stage: 'mounting',
    label: '正在挂载场景',
    detail: '正在同步预览组件...',
    stagePercent: 18,
    currentIndex: 1,
    currentTotal: 6,
    currentLabel: 'previewComponentManager.syncScene',
    active: true,
  });
  previewComponentManager.syncScene(payload.document.nodes ?? []);
  await yieldToMainThread();

  setSceneInitState({
    stage: 'mounting',
    label: '正在挂载场景',
    detail: '正在索引场景对象...',
    stagePercent: 34,
    currentIndex: 2,
    currentTotal: 6,
    currentLabel: 'indexSceneObjects',
    active: true,
  });
  indexSceneObjects(root);
  applyWeChatShadowPolicy(root);
  refreshMultiuserNodeReferences(payload.document);
  collectNetworkSyncNodeEntries(payload.document);
  collectPhysicsAuthorityNodeEntries(payload.document);
  refreshBehaviorProximityCandidates();
  await yieldToMainThread();

  setSceneInitState({
    stage: 'mounting',
    label: 'Mounting Scene',
    detail: 'Refreshing animation and interactions...',
    stagePercent: 52,
    currentIndex: 3,
    currentTotal: 6,
    currentLabel: 'refreshAnimationControllers',
    active: true,
  });
  refreshAnimationControllers(root);
  ensureBehaviorTapHandler(canvas, camera);
  await yieldToMainThread();

  setSceneInitState({
    stage: 'syncingPhysics',
    label: '正在同步物理系统',
    detail: '正在准备物理桥接...',
    stagePercent: 0,
    currentIndex: 0,
    currentTotal: 3,
    currentLabel: 'prepareSceneryPhysicsBridgeForDocument',
    active: true,
  });
  await prepareSceneryPhysicsBridgeForDocument(payload.document);
  initializeLazyPlaceholders(payload.document);
  await yieldToMainThread();

  setSceneInitState({
    stage: 'syncingPhysics',
    label: '正在同步物理系统',
    detail: '正在构建物理体...',
    stagePercent: 34,
    currentIndex: 1,
    currentTotal: 3,
    currentLabel: 'syncPhysicsBodiesForDocument',
    active: true,
  });
  // Bootstrap physics before the render loop so vehicle drive and ground collision never race initialization.
  await syncPhysicsBodiesForDocument(payload.document, (progress) => {
    setSceneInitState({
      stage: 'syncingPhysics',
      label: '正在同步物理系统',
      detail: progress.detail || '正在构建物理体...',
      stagePercent: progress.percent,
      currentIndex: progress.currentIndex ?? 0,
      currentTotal: progress.currentTotal ?? 0,
      currentLabel: progress.currentLabel ?? 'syncPhysicsBodiesForDocument',
      active: true,
    });
  });
  await yieldToMainThread();

  setSceneInitState({
    stage: 'syncingScatter',
    label: '正在同步地形散点',
    detail: '正在初始化散点实例...',
    stagePercent: 0,
    currentIndex: 0,
    currentTotal: 3,
    currentLabel: 'syncTerrainScatterInstances',
    active: true,
  });
  await syncTerrainScatterInstances(payload.document, resourceCache, (progress) => {
    setSceneInitState({
      stage: 'syncingScatter',
      label: '正在同步地形散点',
      detail: progress.detail || '正在初始化散点实例...',
      stagePercent: progress.percent,
      currentIndex: progress.currentIndex ?? 0,
      currentTotal: progress.currentTotal ?? 0,
      currentLabel: progress.currentLabel ?? 'syncTerrainScatterInstances',
      active: true,
    });
  });
  await yieldToMainThread();

  setSceneInitState({
    stage: 'finalizing',
    label: '正在注册场景子树',
    detail: '正在注册场景子树...',
    stagePercent: 0,
    currentIndex: 0,
    currentTotal: 4,
    currentLabel: 'registerSceneSubtree',
    active: true,
  });
  registerSceneSubtree(root);
  const groundNode = resolveDocumentGroundNode(payload.document);
  if (groundNode && isGroundDynamicMesh(groundNode.dynamicMesh)) {
    primeSceneryGroundChunkTextureRefresh(root, groundNode.dynamicMesh);
  }
  await yieldToMainThread();

  setSceneInitState({
    stage: 'finalizing',
    label: 'Refreshing Animation Controllers',
    detail: 'Refreshing animation controllers...',
    stagePercent: 34,
    currentIndex: 1,
    currentTotal: 4,
    currentLabel: 'refreshAnimationControllers',
    active: true,
  });
  refreshAnimationControllers(root);
  await yieldToMainThread();

  setSceneInitState({
    stage: 'finalizing',
    label: '正在整理实例剔除状态',
    detail: '正在整理实例剔除状态...',
    stagePercent: 68,
    currentIndex: 2,
    currentTotal: 4,
    currentLabel: 'markInstancedCullingDirty',
    active: true,
  });
  markInstancedCullingDirty();
  await yieldToMainThread();

  setSceneInitState({
    stage: 'ready',
    label: '场景已就绪',
    detail: '',
    stagePercent: 100,
    currentIndex: 4,
    currentTotal: 4,
    currentLabel: '',
    active: false,
  });
}

/** Apply camera alignment and environment settings for the current document. */
function applyDocumentViewSettings(document: SceneJsonExportDocument, camera: THREE.PerspectiveCamera): void {
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
  markOverlayRuntimeDirty();
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
          characterControlDeltaSeconds = deltaSeconds;
          const watchCameraLocked = isWatchCameraLocked();
          updateCharacterAuthorityInputFromKeys();
          updateMoveToSessionForFrame(deltaSeconds);
          previewFrameCameraWorldPosition.x = camera.position.x;
          previewFrameCameraWorldPosition.y = camera.position.y;
          previewFrameCameraWorldPosition.z = camera.position.z;
          previewComponentManager.setFrameState({
            cameraWorldPosition: previewFrameCameraWorldPosition,
          });
          previewComponentManager.update(deltaSeconds);
          flushParticleRuntimeCommands();
          waterRuntime.update(deltaSeconds, { renderer, scene, camera });
          updateCharacterPathFollow(deltaSeconds);
          updateCharacterControllerAnimations(deltaSeconds);
          nodeAnimationRuntime.update(deltaSeconds);
          activeBehaviorSounds.forEach((instance) => {
            if (!instance.audio || !instance.params.spatial || instance.stopped) {
              return;
            }
            applyBehaviorSoundVolume(instance);
          });

          if (autoTourPaused.value) {
            // Instead of advancing runtime, keep vehicles held still while paused.
            applyAutoTourPauseForActiveNodes();
          } else {
            autoTourRuntime.update(deltaSeconds);
          }
          const manualDriveNodeId = vehicleDriveActive.value ? vehicleDriveNodeId.value : null;
          const autoTourControlsVehicle = manualDriveNodeId ? activeAutoTourNodeIds.has(manualDriveNodeId) : false;
          if (!watchCameraLocked && vehicleDriveActive.value && !autoTourControlsVehicle) {
            applyVehicleDriveForces(deltaSeconds);
            if (!physicsEnvironmentEnabled.value && !vehicleDriveIntroState.active && !vehicleDriveIntroPendingState.active) {
              updateVehicleDriveCamera(deltaSeconds);
            }
          }
          stepPhysicsWorld(deltaSeconds);
          syncSceneryPhysicsBridgeVehicleInput();
          syncSceneryPhysicsBridgeCharacterInput();
          syncSceneryPhysicsBridgeBodyTransforms();
          stepSceneryPhysicsBridge(deltaSeconds);
          updateVehicleSpeedFromVehicle();
          updateControlledCharacterMotionTelemetry(getVehicleSpeedDisplayNowMs());
          updateSceneCompassHeading();
          updateVehicleWheelVisuals(deltaSeconds);
          syncRemoteMultiuserPeerVisibility(camera);
          updateRemoteMultiuserPeers(deltaSeconds);
          updateRemoteSharedEntityTransforms(deltaSeconds);
          retryPendingVehicleDriveIfNeeded();
          activatePendingDefaultSteerDriveIfNeeded();
        }

        if (deltaSeconds >= 0) {
          updateAutoTourFollowCamera(deltaSeconds);
        }

        if (deltaSeconds >= 0 && !isWatchCameraLocked() && !vehicleDriveActive.value && activeAutoTourNodeIds.size === 0) {
          updateCharacterFollowCamera(deltaSeconds);
        }

        if (!isWatchCameraLocked() && vehicleDriveActive.value) {
          if (vehicleDriveIntroState.active) {
            updateVehicleDriveIntroCamera(deltaSeconds);
          } else if (physicsEnvironmentEnabled.value && !vehicleDriveIntroPendingState.active) {
            updateVehicleDriveCamera(deltaSeconds);
          }
        }

        updateBillboardInstanceCameraWorldPosition(camera.position);

        updateBehaviorProximity();
        const instancingNow = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        const cameraFrameSnapshot = refreshCameraFrameSnapshot(camera, instancingNow);
        const shouldSyncOverlayUi = shouldRunOverlaySync(cameraFrameSnapshot);
        let overlayReference: ReturnType<typeof resolvePunchBadgeReference> | null = null;
        if (shouldSyncOverlayUi) {
          overlayReference = resolvePunchBadgeReference(camera, cameraFrameSnapshot);
          updatePunchBadgeOverlayEntries(camera, deltaSeconds, overlayReference);
          syncSceneSignboardsWithReference(overlayReference);
        }
        updatePurposeControlsPlacement(camera);
        applyFogSettings(activeEnvironmentSettings, camera, cameraFrameSnapshot);

        // Keep chunked ground meshes in sync with camera position.
        const cachedGround = dynamicGroundCache;
        try {
          if (cachedGround && shouldRunCompiledGroundTileSync(cameraFrameSnapshot)) {
            syncSceneryCompiledGroundRenderTiles(camera);
            if (!physicsBridgeSceneReloading) {
              const groundObject = nodeObjectMap.get(cachedGround.nodeId) ?? null;
              if (groundObject) {
                const hasGroundCollisionReference = resolveSceneryGroundCollisionReferenceWorld(camera, sceneryGroundCollisionReferencePositions);
                if (!hasGroundCollisionReference) {
                  clearGroundCollisionRuntimeHost(groundObject);
                }
                const shouldUpdateGroundCollisionSystems = hasGroundCollisionReference
                  ? shouldUpdateSceneryGroundCollisionForFrame(deltaSeconds, sceneryGroundCollisionReferencePositions)
                  : false;
                if (shouldUpdateGroundCollisionSystems && physicsBridgeSceneLoaded) {
                  syncSceneryGroundCollisionRuntimeLoadedTileKeys(currentDocument, camera);
                }
              }
            }
          }
        } catch (caughtError) {
          const message = caughtError instanceof Error
            ? caughtError.message
            : 'compiled ground 渲染失败';
          console.error('[SceneViewer] Compiled ground runtime failed', caughtError);
          error.value = message;
          cancel();
          return;
        }

        updateLazyPlaceholders(deltaSeconds);
        if (!vehicleDriveIntroState.active && vehicleDriveIntroPendingState.active) {
          tryStartPendingVehicleDriveIntro();
        }
        if (shouldRunTerrainScatterUpdate(cameraFrameSnapshot)) {
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
          if (sceneCsmShadowRuntime && shouldRunSceneCsmShadowUpdate(cameraFrameSnapshot)) {
            sceneCsmShadowRuntime.update();
          }
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

  clearVehicleDriveIntroState();

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
  pendingRuntimePrefabSpawnRequests.length = 0;
  appliedRuntimePrefabSpawnKeys.clear();
  pendingDefaultSteerDriveEvent.value = null;
  clearSpawnedRuntimePrefabRoots();

  previewNodeMap.clear();
  clearSteerBindingIndex();
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
  instancedLodRuntimeEntryCache.clear();
  instancedLodRuntimeRevision += 1;
  instancedLodLastProcessedRevision = -1;
  instancedLodLastCameraStateValid = false;
  multiuserNodeIds.clear();
  multiuserNodeObjects.clear();
  networkSyncNodeEntries.clear();
  characterControllerAnimationRuntime.clear();
  characterAutoTourRuntime.clear();
  physicsBridgeContactsByNodeId.clear();
  remoteSharedEntityEntries.clear();
  clearSceneryCompiledGroundRenderRuntime();

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
  const groundNode = resolveCurrentGroundNode();
  clearGroundCollisionRuntimeHost(groundNode ? (nodeObjectMap.get(groundNode.id) ?? null) : null);
  sceneryGroundCollisionReferenceInitialized = false;
  sceneryGroundCollisionReferenceElapsed = 0;

  if (sceneGraphRoot) {
    renderContext.scene.remove(sceneGraphRoot);
    disposeObject(sceneGraphRoot);
  }
  sceneGraphRoot = null;
  dynamicGroundCache = null;
  clearRemoteMultiuserPeers();
  setActiveMultiuserRuntimeBridge(null);
  setActiveMultiuserSceneId(null);
  viewerResourceCache = null;
  overlaySyncForceNextUpdate = true;
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
  latestControlNodeRestoreSnapshot = null;
  refreshDynamicGroundCache(currentDocument);
  setActiveMultiuserRuntimeBridge(multiuserRuntimeBridge);
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
  await flushPendingRuntimePrefabSpawnRequests();

  if (token !== initializeToken || sceneGraphRoot !== graph.root) {
    return;
  }

  // Phase 5: apply view settings (camera alignment, environment, projection).
  applyDocumentViewSettings(payload.document, camera);
  activatePendingDefaultSteerDriveIfNeeded();
  updateCharacterFollowCamera(0, { immediate: true });
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
    markOverlayRuntimeDirty();
  });
};

watch(error, (value) => {
  if (value) {
    emit('error', value);
  }
});

watch(
  [sceneLoadPercent, sceneLoadBytesLabel],
  ([_, bytesLabel]) => {
    if (!loading.value && !sceneDownload.active && !resourcePreload.active && !sceneInit.active) {
      return;
    }
    const loaded = sceneInit.active
      ? sceneInit.currentTotal > 0
        ? sceneInit.currentIndex + 1
        : Math.round(sceneInit.percent)
      : sceneDownload.active
        ? sceneDownload.phase === 'render' && resourcePreload.active
          ? resourcePreload.loadedBytes
          : sceneDownload.loaded
        : resourcePreload.loadedBytes;
    const total = sceneInit.active
      ? sceneInit.currentTotal > 0
        ? sceneInit.currentTotal
        : 100
      : sceneDownload.active
        ? sceneDownload.phase === 'render' && resourcePreload.active
          ? resourcePreload.totalBytes
          : sceneDownload.total
        : resourcePreload.totalBytes;
    emit('progress', {
      bytesLabel,
      loaded,
      total,
      percent: sceneLoadPercent.value,
      phase: sceneInit.active
        ? sceneInit.stage
        : sceneDownload.active
          ? sceneDownload.phase
          : resourcePreload.active
            ? 'resource-preload'
            : 'idle',
      stageLabel: sceneInit.active
        ? sceneInit.label
        : sceneDownload.active
          ? sceneDownload.label
          : resourcePreload.label,
      detail: sceneDownload.active
        ? sceneDownload.detail || sceneDownload.currentLabel
        : '',
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
  physicsInterpolationAlpha = 0;
}

function normalizeSceneInputValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeScenePackageUrl(value: string): string {
  if (!value.includes('%')) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildSceneInputKey(params: {
  projectId: string;
  packageUrl: string;
  packageCacheKey: string;
  physinterp: string;
}): string {
  return [
    params.projectId,
    params.packageUrl,
    params.packageCacheKey,
    String(props.physicsInterpolation ?? ''),
    String(props.physicsEngine ?? ''),
    params.physinterp,
  ].join('::');
}

function reportMissingSceneInput(): void {
  console.error('Input missing projectId and packageUrl');
  requestedMode.value = null;
  error.value = '缺少工程数据';
  loading.value = false;
}

function reportProjectLoadMissing(projectId: string): void {
  requestedMode.value = null;
  error.value = '未找到对应的项目，请返回首页重新导入';
  loading.value = false;
  currentProjectId.value = projectId;
}

function beginSceneLoadState(input: ResolvedSceneInput): void {
  requestedMode.value = 'project';
  if (input.mode === 'package-url') {
    currentProjectId.value = null;
    loading.value = true;
    return;
  }
  if (input.mode === 'project-id') {
    currentProjectId.value = input.projectId;
    loading.value = true;
  }
}

type ResolvedSceneInput = {
  projectId: string;
  packageUrl: string;
  packageCacheKey: string;
  physinterp: string;
  inputKey: string;
  mode: 'package-url' | 'project-id' | 'missing';
  effectiveCacheKey: string;
};

function applySceneInputFromProps(): void {
  applyInput({
    projectId: props.projectId,
    packageUrl: props.packageUrl,
    packageCacheKey: props.packageCacheKey,
    physinterp: '',
  });
}

function markPhysicsBridgeBodyDirty(nodeId: string | null | undefined): void {
  const normalized = typeof nodeId === 'string' ? nodeId.trim() : '';
  if (!normalized) {
    return;
  }
  physicsBridgeDirtyBodyNodeIds.add(normalized);
  physicsBridgeBodyDirtyRevisionByNodeId.set(
    normalized,
    (physicsBridgeBodyDirtyRevisionByNodeId.get(normalized) ?? 0) + 1,
  );
  const entry = rigidbodyInstances.get(normalized);
  if (entry) {
    entry.bridgeSyncDirty = true;
  }
}

function resolveSceneInput(params: {
  projectId?: string;
  packageUrl?: string;
  packageCacheKey?: string;
  physinterp?: string;
}): ResolvedSceneInput {
  const projectId = normalizeSceneInputValue(params.projectId);
  const packageUrl = normalizeScenePackageUrl(normalizeSceneInputValue(params.packageUrl));
  const packageCacheKey = normalizeSceneInputValue(params.packageCacheKey);
  const physinterp = normalizeSceneInputValue(params.physinterp);
  return {
    projectId,
    packageUrl,
    packageCacheKey,
    physinterp,
    mode: packageUrl ? 'package-url' : projectId ? 'project-id' : 'missing',
    effectiveCacheKey: packageCacheKey || packageUrl,
    inputKey: buildSceneInputKey({
      projectId,
      packageUrl,
      packageCacheKey,
      physinterp,
    }),
  };
}

function startSceneLoad(input: ResolvedSceneInput): void {
  beginSceneLoadState(input);
  if (input.mode === 'package-url') {
    void loadProjectFromScenePackageUrl(input.packageUrl, input.effectiveCacheKey);
    return;
  }

  if (input.mode === 'project-id') {
    const entry = projectStore.getProject();
    if (!entry || entry.id !== input.projectId) {
      reportProjectLoadMissing(input.projectId);
      return;
    }
    void loadProjectFromScenePackagePointer(entry.scenePackage);
    return;
  }

  reportMissingSceneInput();
}

function applyResolvedSceneInput(input: ResolvedSceneInput): void {
  const requestedPhysicsPreference = resolveSceneryPhysicsBridgePreference(
    currentDocument ? resolveDocumentEnvironment(currentDocument) : activeEnvironmentSettings,
  );
  currentPhysicsBridgePreference = requestedPhysicsPreference;
  // void syncCannonDebugger();

  configurePhysicsInterpolation(input.physinterp);
  error.value = null;
  startSceneLoad(input);

  bootstrapFinished.value = true;
  if (previewPayload.value) {
    handlePreviewPayload(previewPayload.value);
  } else {
    resetScenePreviewRuntimeState();
  }
}

function applyInput(params: {
  projectId?: string;
  packageUrl?: string;
  packageCacheKey?: string;
  physinterp?: string;
}): void {
  bootstrapRuntimeIfNeeded();
  const input = resolveSceneInput(params);
  if (input.inputKey === lastAppliedInputKey) {
    return;
  }
  lastAppliedInputKey = input.inputKey;
  applyResolvedSceneInput(input);
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

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleWindowKeyDown, { passive: true });
    window.addEventListener('keyup', handleWindowKeyUp, { passive: true });
    window.addEventListener('blur', handleWindowBlur);
  }

  if (hasAnyPropInput()) {
    applySceneInputFromProps();
  }
  setGroundTextureSourceResolver(resolveGroundTextureSource);
  setParticleTextureResolver(resolveParticleTextureAssetSource);
});

watch(
  () => [props.projectId, props.packageUrl, props.packageCacheKey, props.physicsInterpolation, props.physicsEngine],
  () => {
    if (!hasAnyPropInput()) {
      return;
    }
    applySceneInputFromProps();
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
  () => props.controllableAssets,
  () => {
    if (previewPayload.value) {
      handlePreviewPayload(previewPayload.value);
    }
  },
  { deep: true },
);

watch(
  () => props.runtimePrefabSpawns,
  (requests: RuntimePrefabSpawnRequest[] | undefined) => {
    if (!Array.isArray(requests) || !requests.length) {
      return;
    }
    requests.forEach((request) => {
      queueRuntimePrefabSpawnRequest(request);
    });
  },
  { deep: true, immediate: true },
);

defineExpose({
  async spawnRuntimePrefab(request: RuntimePrefabSpawnRequest): Promise<void> {
    queueRuntimePrefabSpawnRequest(request, { dedupe: false });
    await flushPendingRuntimePrefabSpawnRequests();
  },
  async spawnRuntimePrefabs(requests: RuntimePrefabSpawnRequest[]): Promise<void> {
    requests.forEach((request) => {
      queueRuntimePrefabSpawnRequest(request, { dedupe: false });
    });
    await flushPendingRuntimePrefabSpawnRequests();
  },
});

function cleanupRuntime(): void {
  dismissBehaviorBubble({ type: 'continue' });
  removeBehaviorRuntimeListener(behaviorRuntimeListener);
  teardownRenderer();
  if (resizeListener) {
    uni.offWindowResize(handleResize);
    resizeListener = null;
  }
  detachDrivePadMouseListeners();
  hideDrivePadImmediate();
  resetCharacterControlInputs();
  if (sceneDownloadController) {
    sceneDownloadController.abort();
    sceneDownloadController = null;
  }
  clearBehaviorSounds();
  resetInfoBoardOverlay();
  resetSceneDownloadState();
  runtimePrefabSourceCache.clear();
  waterRuntime.reset();
  clearRemoteMultiuserPeers();
  setActiveMultiuserRuntimeBridge(null);
  sharedResourceCache = null;
  lanternViewerInstance = null;
  localMultiuserVehiclePresentationByNodeId.clear();
  localMultiuserCharacterPresentationByNodeId.clear();
  setGroundTextureSourceResolver(null);
  delete (globalThis as typeof globalThis & Record<string, unknown>)[DISPLAY_BOARD_RESOLVER_KEY];
  setParticleTextureResolver(null);
}

onUnmounted(() => {
  cancelMoveToTransition();
  resetCharacterActionButtonState();
  void destroySceneryPhysicsBridge();
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleWindowKeyDown);
    window.removeEventListener('keyup', handleWindowKeyUp);
    window.removeEventListener('blur', handleWindowBlur);
  }
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
}

.viewer-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 80%;
  max-width: 320px;
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
  border: 1px solid rgba(153, 193, 255, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(244, 249, 255, 0.6)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.16), rgba(210, 232, 255, 0.1));
  box-shadow:
    0 16rpx 36rpx rgba(52, 87, 128, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.26);
  backdrop-filter: blur(20px) saturate(1.1);
  pointer-events: none;
  color: #15324f;
  overflow: hidden;
}

.viewer-punch-summary::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at left center, rgba(111, 214, 255, 0.14), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 45%);
  pointer-events: none;
}

.viewer-vehicle-intro-banner {
  position: absolute;
  top: 20%;
  left: 50%;
  z-index: 2200;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 16rpx 28rpx;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.viewer-vehicle-intro-banner__text {
  display: inline-block;
  color: #ffffff;
  font-size: 45px;
  font-weight: 900;
  font-style: italic;
  letter-spacing: 0.18em;
  text-shadow:
    0 2px 0 rgba(0, 0, 0, 0.24),
    0 0 24px rgba(122, 217, 255, 0.2);
  animation: viewer-vehicle-intro-banner-pulse 1s ease-in-out infinite;
}

@keyframes viewer-vehicle-intro-banner-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.94;
  }
  50% {
    transform: scale(1.03);
    opacity: 1;
  }
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
  border: 1px solid rgba(153, 193, 255, 0.22);
  border-radius: 18px;
  background:
    radial-gradient(circle at 18% 22%, rgba(111, 214, 255, 0.14), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(244, 249, 255, 0.78));
  box-shadow:
    0 16rpx 34rpx rgba(52, 87, 128, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(16px) saturate(1.06);
  color: #15324f;
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
  background: linear-gradient(180deg, rgba(102, 178, 255, 0.94), rgba(157, 229, 143, 0.92));
}

.viewer-auto-tour-trigger::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 48%);
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
  border-color: rgba(255, 198, 104, 0.28);
  background:
    radial-gradient(circle at 18% 22%, rgba(255, 198, 104, 0.16), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 250, 240, 0.82));
  color: #8e6a18;
}

.viewer-auto-tour-trigger.is-active::before {
  background: linear-gradient(180deg, rgba(255, 198, 104, 0.96), rgba(157, 229, 143, 0.92));
}

.viewer-auto-tour-trigger--secondary {
  left: 50%;
  right: auto;
  top: auto;
  transform: translateX(-50%);
  min-width: 156rpx;
  min-height: 64rpx;
  padding: 0 22rpx;
  border-color: rgba(153, 193, 255, 0.22);
  background:
    radial-gradient(circle at 18% 22%, rgba(90, 224, 205, 0.12), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(244, 249, 255, 0.78));
  box-shadow:
    0 14rpx 28rpx rgba(52, 87, 128, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.viewer-auto-tour-trigger--secondary::before {
  background: linear-gradient(180deg, rgba(102, 178, 255, 0.94), rgba(157, 229, 143, 0.9));
}

.viewer-auto-tour-trigger--secondary .viewer-auto-tour-trigger__label {
  font-size: 22rpx;
  letter-spacing: 0.4rpx;
}

.viewer-auto-tour-trigger--secondary.is-active {
  border-color: rgba(153, 193, 255, 0.24);
  background:
    radial-gradient(circle at 18% 22%, rgba(111, 214, 255, 0.14), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 249, 255, 0.8));
  color: #12314d;
}

.viewer-auto-tour-trigger--secondary.is-active::before {
  background: linear-gradient(180deg, rgba(102, 178, 255, 0.96), rgba(157, 229, 143, 0.92));
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
  color: rgba(21, 50, 79, 0.72);
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
  border: 1px solid rgba(107, 152, 198, 0.18);
  background: rgba(255, 255, 255, 0.8);
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 0.3rpx;
  color: #ffffff;
  white-space: nowrap;
  color: #28506f;
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
  border-left: 1px solid rgba(107, 152, 198, 0.18);
  font-size: 21rpx;
  color: rgba(21, 50, 79, 0.72);
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
  border: 1px solid rgba(115, 231, 170, 0.24);
  background: rgba(242, 255, 248, 0.9);
  color: #2f8f67;
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
  border: 1px solid rgba(115, 231, 170, 0.24);
  background: rgba(242, 255, 248, 0.9);
  box-shadow: 0 12rpx 24rpx rgba(52, 87, 128, 0.12);
  color: #2f8f67;
  transform-origin: center bottom;
  transition: opacity 0.12s linear, transform 0.12s ease-out;
  will-change: transform, opacity;
}

.viewer-punch-badge--vehicle {
  border-color: rgba(255, 198, 104, 0.24);
  background: rgba(255, 250, 240, 0.9);
  color: #8e6a18;
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
  border: 1px solid rgba(153, 193, 255, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(244, 249, 255, 0.7)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(210, 232, 255, 0.06));
  box-shadow: 0 18rpx 40rpx rgba(52, 87, 128, 0.14), 0 4rpx 12rpx rgba(83, 126, 173, 0.06);
  backdrop-filter: blur(16px) saturate(1.06);
  -webkit-backdrop-filter: blur(16px) saturate(1.06);
  transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), var(--behavior-bubble-offset-y, 0px));
  color: #15324f;
  text-align: center;
}

.viewer-bubble--node-anchored {
  transform: translate(calc(-50% + var(--behavior-bubble-offset-x, 0px)), calc(-100% + var(--behavior-bubble-offset-y, 0px)));
}

.viewer-bubble__message {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.55;
  letter-spacing: 0.2rpx;
  word-break: break-word;
}

.viewer-bubble--variant-info {
  border-color: rgba(122, 198, 255, 0.24);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(244, 249, 255, 0.72)),
    linear-gradient(135deg, rgba(122, 198, 255, 0.1), rgba(255, 255, 255, 0.05));
}

.viewer-bubble--variant-success {
  border-color: rgba(115, 231, 170, 0.24);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(242, 255, 248, 0.72)),
    linear-gradient(135deg, rgba(115, 231, 170, 0.1), rgba(255, 255, 255, 0.05));
}

.viewer-bubble--variant-warning {
  border-color: rgba(255, 198, 104, 0.24);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(255, 250, 240, 0.72)),
    linear-gradient(135deg, rgba(255, 198, 104, 0.1), rgba(255, 255, 255, 0.05));
}

.viewer-bubble--variant-danger {
  border-color: rgba(255, 132, 132, 0.24);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(255, 244, 246, 0.72)),
    linear-gradient(135deg, rgba(255, 132, 132, 0.1), rgba(255, 255, 255, 0.05));
}

.viewer-info-board-overlay {
  position: absolute;
  z-index: 2050;
  pointer-events: none;
  will-change: opacity;
}

.viewer-info-board {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(80vw, 220px);
  padding: 12rpx 14rpx 14rpx;
  box-sizing: border-box;
  border-radius: 24rpx;
  overflow: hidden;
  border: 1px solid rgba(153, 193, 255, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(244, 249, 255, 0.68)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(210, 232, 255, 0.08));
  box-shadow: 0 18rpx 42rpx rgba(52, 87, 128, 0.16), 0 6rpx 16rpx rgba(83, 126, 173, 0.08);
  backdrop-filter: blur(16px) saturate(1.08);
  -webkit-backdrop-filter: blur(16px) saturate(1.08);
  color: #15324f;
  transform-origin: center bottom;
  position: relative;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
}


.viewer-info-board::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at top right, rgba(120, 208, 255, 0.18), transparent 42%);
  pointer-events: none;
}

.viewer-info-board__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  z-index: 1;
  padding: 2rpx 2rpx 0;
  flex: 0 0 auto;
}

.viewer-info-board__title {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 26rpx;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: 0.6rpx;
  color: #12314d;
}

.viewer-info-board__body {
  flex: 1 1 auto;
  min-height: 0; /* allow flex children to shrink properly */
  overflow: auto; /* enable scrolling when content overflows */
  position: relative;
  z-index: 1;
  padding: 8rpx 12rpx 10rpx;
  border-radius: 18rpx;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.48), rgba(243, 249, 255, 0.32));
  box-sizing: border-box;
}

.viewer-info-board.is-expanded .viewer-info-board__body {
  /* Let the scroll area fill the available panel space but keep a comfortable inner margin */
  padding: 14rpx 16rpx 14rpx;
}

.viewer-info-board.is-expanded {
  width: min(80vw, 340px);
}

.viewer-info-board.is-expanded .viewer-info-board__header {
  display: none;
}

.viewer-info-board__loading,
.viewer-info-board__content {
  display: block;
  font-size: 28rpx;
  line-height: 1.45;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes viewer-info-board-float {
  0% {
    transform: translate3d(0, 0, 0) rotate(-0.15deg);
  }

  100% {
    transform: translate3d(0, -2px, 0) rotate(0.15deg);
  }
}

.viewer-info-board__loading {
  color: rgba(21, 50, 79, 0.64);
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

.viewer-debug-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.viewer-debug-button {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(14, 22, 42, 0.88);
  color: rgba(245, 250, 255, 0.95);
  font-size: 11px;
  line-height: 1;
}

.viewer-debug-button__label {
  display: inline-block;
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
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(244, 249, 255, 0.78)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(210, 232, 255, 0.08));
  border: 1px solid rgba(153, 193, 255, 0.2);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  color: #15324f;
  box-shadow: 0 16px 34px rgba(52, 87, 128, 0.14), 0 4px 10px rgba(83, 126, 173, 0.06);
  backdrop-filter: blur(16px) saturate(1.06);
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
  color: #28506f;
  font-size: 11px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 8px;
  border: 1px solid rgba(144, 189, 255, 0.18);
  background: rgba(255, 255, 255, 0.8);
}

.viewer-log-fab {
  pointer-events: auto;
  margin-left: auto;
  min-width: 104rpx;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(134, 176, 255, 0.2);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(235, 244, 255, 0.88));
  box-shadow: 0 8px 22px rgba(52, 87, 128, 0.14);
}

.viewer-log-fab__text {
  color: #28506f;
  font-size: 11px;
  font-weight: 600;
}

.viewer-log-overlay__title {
  display: block;
  color: #12314d;
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
  color: rgba(21, 50, 79, 0.62);
  font-size: 11px;
  line-height: 1.45;
}

.viewer-log-overlay__item {
  display: block;
  color: rgba(21, 50, 79, 0.78);
  font-size: 11px;
  line-height: 1.42;
  margin-bottom: 4px;
  word-break: break-all;
}

.viewer-log-overlay__item.is-info {
  color: #335f87;
}

.viewer-log-overlay__item.is-warn {
  color: #8e6a18;
}

.viewer-log-overlay__item.is-error {
  color: #b4444a;
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

.viewer-control-switch-overlay {
  position: absolute;
  inset: 0;
  z-index: 1700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(8, 14, 24, 0.58);
  backdrop-filter: blur(3px);
  color: rgba(245, 249, 255, 0.94);
  font-size: 14px;
  font-weight: 500;
  pointer-events: auto;
}

.viewer-control-switch-spinner {
  width: 22px;
  height: 22px;
  border: 3px solid rgba(255, 255, 255, 0.28);
  border-top-color: #70e1ff;
  border-radius: 50%;
  animation: viewer-control-switch-spin 0.8s linear infinite;
}

@keyframes viewer-control-switch-spin {
  to { transform: rotate(360deg); }
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
    linear-gradient(180deg, rgba(255, 255, 255, 0.86) 0%, rgba(244, 249, 255, 0.72) 100%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(210, 232, 255, 0.08));
  border: 1px solid rgba(153, 193, 255, 0.22);
  border-radius: 28px;
  padding: 24px 22px;
  box-shadow: 0 24px 60px rgba(52, 87, 128, 0.16), 0 6px 16px rgba(83, 126, 173, 0.08);
  backdrop-filter: blur(16px) saturate(1.08);
}

.viewer-overlay__card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(circle at top, rgba(120, 208, 255, 0.18), transparent 34%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), transparent 34%, transparent 66%, rgba(157, 229, 143, 0.08));
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
  color: #12314d;
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
  background: rgba(120, 152, 194, 0.12);
}

.viewer-progress__bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: inherit;
  transition: width 0.35s ease;
  background-image: linear-gradient(90deg, rgba(94, 161, 255, 0.42) 0%, rgba(94, 161, 255, 0.84) 45%, rgba(157, 229, 143, 0.92) 100%);
  background-size: 200% 100%;
  animation: viewer-progress-fill 1.8s linear infinite;
}

.viewer-progress__bar-fill.is-indeterminate {
  width: 38%;
  min-width: 120px;
  transition: none;
  background-image: linear-gradient(90deg, rgba(78, 221, 255, 0.28) 0%, rgba(94, 161, 255, 0.94) 35%, rgba(157, 229, 143, 0.96) 70%, rgba(114, 247, 255, 0.26) 100%);
  background-size: 240% 100%;
  animation: viewer-progress-indeterminate 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  filter: saturate(1.15);
}

.viewer-progress__bar.is-indeterminate {
  background: rgba(120, 152, 194, 0.1);
}

.viewer-progress__bar-glow {
  position: absolute;
  inset: -6px;
  pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(circle at 50% 50%, rgba(124, 188, 255, 0.22) 0%, rgba(124, 188, 255, 0) 72%);
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
  color: rgba(21, 50, 79, 0.78);
}

.viewer-progress__percent {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.viewer-progress__bytes {
  font-size: 12px;
  color: rgba(21, 50, 79, 0.62);
}

.viewer-overlay__caption {
  font-size: 12px;
  color: rgba(21, 50, 79, 0.68);
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
  background-color: rgba(17, 35, 56, 0.18);
  z-index: 2000; /* above loading/error overlays */
}

.viewer-behavior-dialog {
  min-width: 240px;
  max-width: 80vw;
  padding: 16px 18px;
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 249, 255, 0.84)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(210, 232, 255, 0.08));
  border: 1px solid rgba(153, 193, 255, 0.22);
  color: #15324f;
  text-align: center;
  box-shadow: 0 18px 46px rgba(52, 87, 128, 0.16), 0 6px 16px rgba(83, 126, 173, 0.08);
  backdrop-filter: blur(16px) saturate(1.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.viewer-behavior-title {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
  font-weight: 600;
  color: #12314d;
}

.viewer-behavior-message {
  max-height: 180px;
  font-size: 14px;
  color: rgba(21, 50, 79, 0.76);
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
  border: 1px solid rgba(107, 152, 198, 0.22);
  border-radius: 18px;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(235, 244, 255, 0.88));
  color: #28506f;
  font-size: 14px;
  min-width: 96px;
  box-shadow: 0 4px 12px rgba(72, 114, 158, 0.1);
}

.viewer-behavior-button.cancel {
  background-image: none;
  background-color: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(107, 152, 198, 0.18);
}

.viewer-lantern-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(17, 35, 56, 0.18);
  z-index: 2100;
  padding: 16px;
}

.viewer-lantern-dialog {
  position: relative;
  width: auto;
  max-width: min(620px, 92vw);
  max-height: 90vh;
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(244, 249, 255, 0.84)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(210, 232, 255, 0.08));
  border: 1px solid rgba(153, 193, 255, 0.22);
  color: #15324f;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  box-shadow: 0 22px 54px rgba(52, 87, 128, 0.18), 0 6px 16px rgba(83, 126, 173, 0.08);
  backdrop-filter: blur(16px) saturate(1.06);
  touch-action: pan-y;
}

.viewer-lantern-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(107, 152, 198, 0.22);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(235, 244, 255, 0.88));
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
  color: #4a6d8f;
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
  background:
    radial-gradient(circle at 30% 28%, rgba(120, 208, 255, 0.18), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(244, 249, 255, 0.76));
  border: 1px solid rgba(153, 193, 255, 0.22);
  box-shadow:
    0 24px 40px rgba(52, 87, 128, 0.16),
    inset 0 0 0 1px rgba(255, 255, 255, 0.24);
  position: relative;
  overflow: visible;
  backdrop-filter: blur(16px) saturate(1.06);
}

.viewer-drive-start__button:disabled {
  opacity: 0.92;
}

.viewer-drive-start__button.is-busy {
  box-shadow:
    0 18px 32px rgba(52, 87, 128, 0.14),
    inset 0 0 0 1px rgba(214, 195, 255, 0.38);
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

.viewer-character-console {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1550;
}

.viewer-character-console--mobile {
  display: block;
}

.viewer-character-drive-cluster {
  gap: 10px;
  align-items: center;
}

.viewer-character-actions-bar {
  position: absolute;
  left: 50%;
  right: auto;
  bottom: calc(18px + var(--viewer-safe-area-bottom, 0px));
  transform: translateX(-50%);
  pointer-events: none;
}

.viewer-character-actions {
  max-width: min(236px, calc(100vw - 24px));
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  pointer-events: auto;
  padding: 6px 8px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(8, 16, 28, 0.18), rgba(8, 16, 28, 0.08));
  border: 1px solid rgba(125, 159, 199, 0.12);
  backdrop-filter: blur(10px);
}

.viewer-character-action-button {
  width: 32px;
  min-width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid rgba(127, 166, 209, 0.18);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(30, 44, 63, 0.72), rgba(19, 31, 47, 0.62));
  color: rgba(220, 231, 245, 0.92);
  box-shadow: 0 6px 16px rgba(3, 8, 18, 0.22);
  backdrop-filter: blur(12px) saturate(1.02);
  transition: transform 0.16s ease, background-color 0.16s ease, border-color 0.16s ease, opacity 0.16s ease;
}

.viewer-character-action-button.is-active,
.viewer-character-action-button:active {
  transform: scale(0.94);
  background: linear-gradient(180deg, rgba(50, 70, 96, 0.88), rgba(33, 49, 70, 0.78));
  border-color: rgba(150, 186, 225, 0.28);
}

.viewer-character-action-button--danger {
  background: linear-gradient(180deg, rgba(64, 39, 49, 0.78), rgba(45, 27, 35, 0.68));
  border-color: rgba(233, 124, 151, 0.22);
  color: rgba(255, 214, 223, 0.96);
}

.viewer-character-action-button__icon {
  font-size: 13px;
  line-height: 1;
  font-weight: 700;
}

.viewer-drive-icon-button {
  min-width: 48px;
  min-height: 48px;
  padding: 6px 12px;
  border-radius: 14px;
  border: 1px solid rgba(153, 193, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 249, 255, 0.8));
  color: #28506f;
  box-shadow: 0 10px 24px rgba(52, 87, 128, 0.14);
  backdrop-filter: blur(16px) saturate(1.06);
  transition: background-color 0.18s ease, transform 0.18s cubic-bezier(.2,.9,.2,1), opacity 0.18s ease;
  position: relative;
  overflow: hidden;
}

.viewer-drive-icon-button--danger {
  background: linear-gradient(180deg, rgba(255, 244, 246, 0.96), rgba(255, 232, 236, 0.88));
  border-color: rgba(255, 143, 167, 0.25);
  color: #9e2d49;
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
  background: rgba(255, 255, 255, 0.94);
  color: #28506f;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(52, 87, 128, 0.14);
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
  background: rgba(102, 178, 255, 0.12);
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(235, 244, 255, 0.84));
  color: #28506f;
  border: 1px solid rgba(107, 152, 198, 0.18);
  box-shadow: 0 10px 22px rgba(72, 114, 158, 0.12);
  backdrop-filter: blur(16px) saturate(1.06);
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
  background: rgba(255, 255, 255, 0.94);
  color: #28506f;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 8px 20px rgba(52, 87, 128, 0.14);
  pointer-events: none;
}

.viewer-drive-start__text-button--stop {
  background: linear-gradient(180deg, rgba(255, 244, 246, 0.96), rgba(255, 232, 236, 0.88));
  border-color: rgba(255, 143, 167, 0.25);
  color: #9e2d49;
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
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(244, 249, 255, 0.78)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(210, 232, 255, 0.08));
  border: 1px solid rgba(153, 193, 255, 0.2);
  box-shadow: 0 16px 34px rgba(52, 87, 128, 0.14), 0 4px 10px rgba(83, 126, 173, 0.06);
  backdrop-filter: blur(16px) saturate(1.06);
}

.viewer-drive-start__text-button--close {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(237, 245, 255, 0.7));
  border: 1px solid rgba(107, 152, 198, 0.18);
  color: #28506f;
  padding: 8px 12px;
  border-radius: 10px;
  box-shadow: 0 8px 18px rgba(72, 114, 158, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(16px) saturate(1.06);
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
  border: 1px solid rgba(153, 193, 255, 0.2);
  background:
    radial-gradient(circle at 30% 28%, rgba(120, 208, 255, 0.18), transparent 34%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(244, 249, 255, 0.74));
  box-shadow:
    inset 0 0 18px rgba(255, 255, 255, 0.36),
    0 16px 30px rgba(52, 87, 128, 0.14);
  backdrop-filter: blur(16px) saturate(1.06);
}

.viewer-drive-compass::before {
  content: '';
  position: absolute;
  inset: 9%;
  border-radius: 50%;
  border: 1px solid rgba(107, 152, 198, 0.14);
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.58), rgba(243, 249, 255, 0.3));
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
  background: rgba(82, 117, 151, 0.26);
  transform-origin: center 34px;
  z-index: 1;
}

.viewer-drive-compass__tick.is-major {
  height: 10px;
  background: rgba(94, 161, 255, 0.7);
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
  color: rgba(21, 50, 79, 0.84);
  text-shadow: none;
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(102, 178, 255, 0.94), rgba(71, 149, 255, 0.9));
  box-shadow: 0 0 16px rgba(84, 170, 255, 0.24);
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
  border-bottom: 13px solid rgba(102, 178, 255, 0.96);
  filter: drop-shadow(0 0 8px rgba(88, 170, 255, 0.22));
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
  border: 2px solid rgba(153, 193, 255, 0.22);
  color: #15324f;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(244, 249, 255, 0.76)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(210, 232, 255, 0.08));
  box-shadow: 0 12px 22px rgba(52, 87, 128, 0.14);
  backdrop-filter: blur(16px) saturate(1.06);
  transition: transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease, border-color 0.16s ease;
}

.viewer-drive-pedal-button--forward {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 249, 255, 0.82)),
    linear-gradient(135deg, rgba(94, 161, 255, 0.14), rgba(255, 255, 255, 0.06));
  border-color: rgba(94, 161, 255, 0.24);
}

.viewer-drive-pedal-button--brake {
  background:
    linear-gradient(180deg, rgba(255, 244, 246, 0.96), rgba(255, 232, 236, 0.88)),
    linear-gradient(135deg, rgba(255, 112, 130, 0.12), rgba(255, 255, 255, 0.05));
  border-color: rgba(255, 150, 160, 0.24);
}

.viewer-drive-pedal-button.is-active {
  transform: scale(0.92);
  box-shadow: 0 6px 16px rgba(52, 87, 128, 0.14);
}

.viewer-drive-pedal-button--forward.is-active {
  border-color: rgba(94, 161, 255, 0.3);
}

.viewer-drive-pedal-button--brake.is-active {
  border-color: rgba(255, 150, 160, 0.3);
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
  left: 0;
  top: 0;
  z-index: 1600;
  pointer-events: auto;
  width: max-content;
  max-width: min(220px, calc(100vw - 20px));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  overflow: visible;
}

.viewer-watch-leave-bar {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 1601;
  pointer-events: auto;
}

.viewer-watch-leave-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.viewer-watch-action-button {
  min-width: 144px;
  min-height: 46px;
  padding: 0 22px;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.08em;
  box-shadow: 0 12px 30px rgba(8, 20, 36, 0.18);
  backdrop-filter: blur(16px) saturate(1.06);
  transition: transform 0.18s cubic-bezier(.2,.9,.2,1), opacity 0.18s ease, box-shadow 0.18s ease;
}

.viewer-watch-leave-button {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(237, 245, 255, 0.84)),
    linear-gradient(135deg, rgba(122, 198, 255, 0.16), rgba(255, 255, 255, 0.06));
  color: #173149;
}

.viewer-watch-photo-button {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(236, 247, 255, 0.86)),
    linear-gradient(135deg, rgba(110, 190, 255, 0.16), rgba(255, 255, 255, 0.06));
  color: #28506f;
  border: 1px solid rgba(153, 193, 255, 0.2);
}

.viewer-watch-action-button.is-busy,
.viewer-watch-action-button:disabled {
  opacity: 0.72;
}

.viewer-watch-action-button:active {
  transform: scale(0.97);
}

.viewer-watch-photo-button .viewer-drive-icon {
  width: 22px;
  height: 22px;
}

.viewer-watch-photo-button .viewer-drive-icon-text {
  font-size: 18px;
}

.viewer-purpose-chip {
  position: relative;
  min-width: 104px;
  min-height: 32px;
  width: 100%;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 999px;
  background:
    linear-gradient(90deg, rgba(18, 23, 32, 0.82) 0%, rgba(18, 23, 32, 0.7) 50%, rgba(18, 23, 32, 0.32) 78%, rgba(18, 23, 32, 0) 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-right-color: rgba(255, 255, 255, 0.18);
  border-bottom-color: rgba(255, 255, 255, 0.18);
  overflow: hidden;
  display: flex;
  align-items: stretch;
  justify-content: center;
  color: #f3f7fb;
  opacity: 0.96;
  box-shadow:
    0 10px 22px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset -18px 0 22px rgba(255, 255, 255, 0.02);
  transition: transform 0.24s ease, box-shadow 0.24s ease, opacity 0.24s ease;
  text-align: center;
  backdrop-filter: blur(18px) saturate(1.08);
  flex: none;
}

.viewer-purpose-chip::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.08) 48%, rgba(255, 255, 255, 0) 100%),
    linear-gradient(90deg, rgba(18, 23, 32, 0) 52%, rgba(18, 23, 32, 0.08) 78%, rgba(18, 23, 32, 0.2) 100%);
  pointer-events: none;
  z-index: 0;
}

.viewer-purpose-chip__halo {
  position: absolute;
  inset: -18%;
  border-radius: 22px;
  opacity: 0.14;
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
  gap: 4px;
  padding: 5px 12px 5px 10px;
  border-radius: 999px;
  background: transparent;
  border: none;
  backdrop-filter: none;
}

.viewer-purpose-chip__texts {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
}

.viewer-purpose-chip__title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.15px;
  line-height: 1;
  color: #f5f8fb;
  text-align: left;
  display: block;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-purpose-chip__subtitle {
  font-size: 10px;
  line-height: 1.3;
  opacity: 0.62;
  letter-spacing: 0.5px;
  color: rgba(233, 240, 248, 0.68);
}

.viewer-purpose-chip--watch .viewer-purpose-chip__content {
  background: transparent;
  box-shadow: none;
}

.viewer-purpose-chip--watch .viewer-purpose-chip__halo {
  background: linear-gradient(125deg, rgba(255, 255, 255, 0.14), rgba(120, 208, 255, 0.08), rgba(14, 35, 78, 0));
  animation: viewer-purpose-watch-halo 7s linear infinite;
}

.viewer-purpose-chip--watch .viewer-purpose-chip__title {
  text-shadow: none;
}

.viewer-purpose-chip--watch .viewer-purpose-chip__subtitle {
  color: rgba(233, 240, 248, 0.7);
}

.viewer-purpose-chip--level .viewer-purpose-chip__content {
  background: transparent;
  box-shadow: none;
}

.viewer-purpose-chip--level .viewer-purpose-chip__halo {
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.14), rgba(115, 231, 170, 0.08), rgba(5, 18, 36, 0));
  animation: viewer-purpose-level-halo 5s ease-in-out infinite;
}

.viewer-purpose-chip--level .viewer-purpose-chip__title {
  text-shadow: none;
}

.viewer-purpose-chip--level .viewer-purpose-chip__subtitle {
  color: rgba(233, 240, 248, 0.7);
}

.viewer-purpose-chip.is-active {
  transform: none;
  opacity: 1;
  box-shadow: none;
}

.viewer-purpose-chip.is-active::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 18px;
  border: 1px solid rgba(153, 193, 255, 0.35);
  background: radial-gradient(circle, rgba(120, 208, 255, 0.26) 0%, rgba(120, 208, 255, 0.08) 60%, transparent 100%);
  box-shadow:
    0 0 32px rgba(118, 212, 255, 0.22),
    0 0 64px rgba(118, 212, 255, 0.12);
  opacity: 0.72;
  transform-origin: center;
  animation: viewer-purpose-active-glow 3.2s ease-in-out infinite;
  pointer-events: none;
}

.viewer-purpose-chip.is-active .viewer-purpose-chip__content {
  filter: brightness(1.03) saturate(1.04);
  box-shadow:
    inset 0 0 24px rgba(255, 255, 255, 0.22),
    0 0 22px rgba(120, 207, 255, 0.16);
}

.viewer-purpose-chip.is-active .viewer-purpose-chip__halo {
  opacity: 1;
  filter: saturate(1.15);
}

.viewer-purpose-chip.is-active .viewer-purpose-chip__subtitle {
  opacity: 0.98;
}

.viewer-purpose-chip:active {
  transform: scale(0.97);
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(244, 249, 255, 0.78)) !important;
  box-shadow: 0 16px 34px rgba(52, 87, 128, 0.14) !important;
  border: 1px solid rgba(153, 193, 255, 0.2) !important;
  backdrop-filter: blur(16px) saturate(1.06) !important;
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(235, 244, 255, 0.88));
  color: #28506f;
  border: 1px solid rgba(107, 152, 198, 0.18);
  box-shadow: 0 8px 18px rgba(72, 114, 158, 0.12);
}
.viewer-drive-start__btn__label {
  display: block;
  width: 100%;
  text-align: center;
}
.viewer-drive-start__btn--primary {
  background: linear-gradient(180deg, rgba(102, 178, 255, 0.96), rgba(71, 149, 255, 0.9));
  color: #fff;
}
.viewer-drive-start__btn--close {
  background: rgba(255, 255, 255, 0.82);
  color: #28506f;
}
.viewer-drive-start__btn.is-busy .viewer-drive-start__btn__label,
.viewer-drive-start__btn.is-busy {
  opacity: 0.84;
}
</style>
