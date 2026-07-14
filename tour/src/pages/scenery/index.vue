<template>
  <view class="page">
    <view
      class="floating-back"
      :style="{ top: `${backButtonTop}px` }"
      @tap="handleBack"
    >
      <text class="floating-back__icon">
        ‹
      </text>
    </view>

    <view
      class="floating-title"
      :style="{ top: `${backButtonTop}px` }"
    >
      <text class="floating-title__text">
        {{ scenicTitle || '未命名景区' }}
      </text>
    </view>

    <!-- #ifdef MP-WEIXIN -->
    <SceneryViewer
      v-if="sceneryEnabled"
      :project-id="projectId"
      :package-url="packageUrl"
      :package-cache-key="packageCacheKey"
      :multiuser-identity="multiuserIdentity"
      :nominate-state-map="nominateStateMap"
      :create-physics-bridge="createSceneryPhysicsBridge"
      :default-steer-identifier="selectedVehicleIdentifier"
      :runtime-prefab-spawns="runtimePrefabSpawns"
      :server-asset-base-url="serverAssetBaseUrl"
      :debug-console-enabled="false"
      :debug-console-default-expanded="true"
      :debug-console-max-entries="200"
      :initial-punched-node-ids="initialPunchedNodeIds"
      :physics-engine="resolvedPhysicsEngine"
      @punch="handlePunch"
      @coupon="handleCoupon"
    />
    <!-- #endif -->

    <view v-if="!sceneryEnabled" class="scenery-fallback">
      <view class="scenery-fallback__card">
        <text class="scenery-fallback__title">{{ scenicTitle || '景区导览' }}</text>
        <text class="scenery-fallback__description">当前平台的 3D 景区功能正在适配中，其他景区信息和账户功能仍可正常使用。</text>
        <button class="scenery-fallback__button" @tap="handleBack">返回景区详情</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
// #ifdef MP-WEIXIN
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
import { createSceneryPhysicsBridge } from './createSceneryPhysicsBridge';
// #endif
import { getProfile } from '@/api/mini/profile';
import { getDownloadCdnBaseUrl } from '@harmony/utils/http';
import {
  completeTravelLeaveRecord,
  createPunchRecord,
  createTravelEnterRecord,
  getPunchProgress,
  trackAnalyticsEvent,
} from '@harmony/utils/mini-client';
import { parseQueryString } from '@harmony/utils';
import { getTopSafeAreaMetrics } from '@/utils/safeArea';
import { getSelectedVehicle, getSelectedVehicleIdentifier } from '@/utils/vehicleSelection';
import { clearSceneryShareContext, setSceneryShareContext } from '@/services/share';
import { ensureMiniCapability } from '@/platform/runtime';

defineOptions({
  name: 'SceneryPage',
});

type RuntimePrefabPlacementAlignment = 'origin' | 'bottom-to-anchor' | 'center-to-anchor' | 'place-on-surface' | 'custom-offset';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
const packageCacheKey = ref<string>('');
const scenicTitle = ref<string>('');
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const enterAt = ref<number>(0);
const selectedVehicleIdentifier = ref<string>('');
const selectedVehiclePrefabUrl = ref<string>('');
const explicitPrefabUrl = ref<string>('');
const explicitPrefabTargetNodeId = ref<string>('');
const explicitPrefabTargetNodeName = ref<string>('');
const explicitPrefabPosition = ref<{ x: number; y: number; z: number } | null>(null);
const explicitPrefabRotation = ref<{ x: number; y: number; z: number } | null>(null);
const explicitPrefabPlacementAlignment = ref<RuntimePrefabPlacementAlignment | null>(null);
const explicitPrefabPlacementOffset = ref<{ x: number; y: number; z: number } | null>(null);
const backButtonTop = ref<number>(8);
const initialPunchedNodeIds = ref<string[]>([]);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();
const multiuserIdentity = ref<{ userId: string; displayName?: string | null } | null>(null);
const resolvedPhysicsEngine = ref<'ammo' | 'cannon' | 'auto' | undefined>(undefined);
const sceneryEnabled = ref(false);

const nominateStateMap = computed(() => {
  const vehicleIdentifier = selectedVehicleIdentifier.value.trim();
  if (!vehicleIdentifier) {
    return undefined;
  }
  return {
    [vehicleIdentifier]: {
      visible: true,
    },
  };
});

const runtimePrefabSpawns = computed(() => {
  const prefabUrl = explicitPrefabUrl.value.trim() || selectedVehiclePrefabUrl.value.trim();
  if (!prefabUrl) {
    return [];
  }
  return [{
    requestId: explicitPrefabUrl.value.trim().length
      ? `route-prefab:${prefabUrl}`
      : `vehicle-prefab:${selectedVehicleIdentifier.value.trim() || prefabUrl}`,
    assetUrl: prefabUrl,
    preloadPolicy: 'before-entry' as const,
    targetNodeId: explicitPrefabTargetNodeId.value.trim() || null,
    targetNodeName: explicitPrefabTargetNodeName.value.trim() || null,
    position: explicitPrefabPosition.value,
    rotation: explicitPrefabRotation.value,
    initializationMode: 'full' as const,
    placement: {
      alignment: explicitPrefabPlacementAlignment.value ?? 'place-on-surface',
      offset: explicitPrefabPlacementOffset.value,
    },
  }];
});

function decodePlacementAlignment(value: unknown): RuntimePrefabPlacementAlignment | null {
  const decoded = decodeQueryValue(value);
  if (
    decoded === 'origin'
    || decoded === 'bottom-to-anchor'
    || decoded === 'center-to-anchor'
    || decoded === 'place-on-surface'
    || decoded === 'custom-offset'
  ) {
    return decoded;
  }
  return null;
}

function decodeNumericQueryValue(value: unknown): number | null {
  const decoded = decodeQueryValue(value);
  if (!decoded.length) {
    return null;
  }
  const numeric = Number(decoded);
  return Number.isFinite(numeric) ? numeric : null;
}

function decodeVector3QueryValue(record: Record<string, unknown>, prefix: string): { x: number; y: number; z: number } | null {
  const x = decodeNumericQueryValue(record[`${prefix}X`]);
  const y = decodeNumericQueryValue(record[`${prefix}Y`]);
  const z = decodeNumericQueryValue(record[`${prefix}Z`]);
  if (x === null && y === null && z === null) {
    return null;
  }
  return {
    x: x ?? 0,
    y: y ?? 0,
    z: z ?? 0,
  };
}

function syncBackButtonTop(): void {
  const metrics = getTopSafeAreaMetrics();
  backButtonTop.value = metrics.topInset + Math.max((metrics.navBarHeight - 32) / 2, 6);
}

type PunchEventPayload = {
  eventName: 'punch';
  sceneId: string;
  sceneName: string;
  clientPunchTime: string;
  behaviorPunchTime: string;
  location: {
    nodeId: string;
    nodeName: string;
  };
};

type CouponEventPayload = {
  eventName: 'coupon';
  sceneId: string;
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
};

function handlePunch(payload: PunchEventPayload): void {
  if (!sceneSpotId.value) {
    return;
  }

  void createPunchRecord({
    sceneId: payload.sceneId,
    sceneName: scenicTitle.value || payload.sceneId,
    scenicId: sceneSpotId.value,
    vehicleIdentifier: selectedVehicleIdentifier.value || undefined,
    clientPunchTime: payload.clientPunchTime,
    behaviorPunchTime: payload.behaviorPunchTime,
    location: {
      nodeId: payload.location.nodeId,
      nodeName: payload.location.nodeName,
    },
    source: 'tour-miniapp',
    path: '/pages/scenery/index',
  });
}

function handleCoupon(payload: CouponEventPayload): void {
  if (!payload.coupon.id) {
    return;
  }
  void uni.showToast({
    title: payload.coupon.name || '已获得奖励',
    icon: 'none',
  });
}

async function loadPunchProgress(): Promise<void> {
  if (!sceneId.value || !sceneSpotId.value) {
    initialPunchedNodeIds.value = [];
    return;
  }

  try {
    const progress = await getPunchProgress({
      sceneId: sceneId.value,
      scenicId: sceneSpotId.value,
    });
    initialPunchedNodeIds.value = Array.isArray(progress.punchedNodeIds)
      ? progress.punchedNodeIds.filter((nodeId) => nodeId.trim().length > 0)
      : [];
  } catch {
    initialPunchedNodeIds.value = [];
  }
}

async function loadMultiuserIdentity(): Promise<void> {
  try {
    const profile = await getProfile();
    const userId = typeof profile.id === 'string' ? profile.id.trim() : '';
    if (!userId) {
      multiuserIdentity.value = null;
      return;
    }
    const displayName = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
    multiuserIdentity.value = {
      userId,
      displayName: displayName || userId,
    };
  } catch {
    multiuserIdentity.value = null;
  }
}

function handleBack(): void {
  uni.showModal({
    title: '确认离开',
    content: '确定要离开景区吗？',
    confirmText: '离开',
    cancelText: '取消',
    success: (result) => {
      if (!result.confirm) {
        return;
      }

      uni.navigateBack({
        fail: () => {
          void uni.reLaunch({ url: '/pages/home/index' });
        },
      });
    },
  });
}

function extractQueryFromQrLink(q: string): Record<string, string> {
  return parseQueryString(q);
}

function decodeQueryValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed.includes('%')) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

onLoad((query: Record<string, unknown> | undefined) => {
  syncBackButtonTop();
  void ensureMiniCapability('scenery').then((enabled) => {
    // The renderer dependency is currently validated only for WeChat.
    // #ifdef MP-WEIXIN
    sceneryEnabled.value = enabled;
    // #endif
  }).catch(() => {
    sceneryEnabled.value = false;
  });

  const record: Record<string, unknown> = query ?? {};
  const qrQuery = typeof record.q === 'string' ? extractQueryFromQrLink(record.q) : {};
  const mergedRecord = {
    ...qrQuery,
    ...Object.fromEntries(
      Object.entries(record).filter(([, value]) => typeof value === 'string' && value.length > 0)
    ),
  };

  projectId.value = decodeQueryValue(mergedRecord.projectId);
  packageUrl.value = decodeQueryValue(mergedRecord.packageUrl);
  packageCacheKey.value = decodeQueryValue(mergedRecord.packageCacheKey);
  scenicTitle.value = typeof mergedRecord.scenicTitle === 'string'
    ? decodeQueryValue(mergedRecord.scenicTitle)
        : typeof mergedRecord.sceneName === 'string'
          ? decodeQueryValue(mergedRecord.sceneName)
      : '';
  sceneSpotId.value = decodeQueryValue(mergedRecord.sceneSpotId);
  sceneId.value = decodeQueryValue(mergedRecord.sceneId);
  selectedVehicleIdentifier.value = typeof mergedRecord.vehicleIdentifier === 'string'
    ? decodeQueryValue(mergedRecord.vehicleIdentifier)
    : getSelectedVehicleIdentifier();
  {
    const selectedVehicle = getSelectedVehicle();
    const selectedPrefabUrl = selectedVehicle && typeof selectedVehicle === 'object'
      ? (selectedVehicle as { prefabUrl?: unknown }).prefabUrl
      : null;
    selectedVehiclePrefabUrl.value = typeof selectedPrefabUrl === 'string'
      ? selectedPrefabUrl.trim()
      : '';
  }
  explicitPrefabUrl.value = decodeQueryValue(mergedRecord.prefabUrl);
  explicitPrefabTargetNodeId.value = decodeQueryValue(mergedRecord.prefabTargetNodeId);
  explicitPrefabTargetNodeName.value = decodeQueryValue(mergedRecord.prefabTargetNodeName);
  explicitPrefabPosition.value = decodeVector3QueryValue(mergedRecord, 'prefabPosition');
  explicitPrefabRotation.value = decodeVector3QueryValue(mergedRecord, 'prefabRotation');
  explicitPrefabPlacementAlignment.value = decodePlacementAlignment(mergedRecord.prefabPlacement);
  explicitPrefabPlacementOffset.value = decodeVector3QueryValue(mergedRecord, 'prefabOffset');
  setSceneryShareContext({
    title: scenicTitle.value || '景区导览',
    query: {
      projectId: projectId.value,
      packageUrl: packageUrl.value,
      packageCacheKey: packageCacheKey.value,
      scenicTitle: scenicTitle.value,
      sceneSpotId: sceneSpotId.value,
      sceneId: sceneId.value,
      vehicleIdentifier: selectedVehicleIdentifier.value,
      prefabUrl: explicitPrefabUrl.value,
      prefabTargetNodeId: explicitPrefabTargetNodeId.value,
      prefabTargetNodeName: explicitPrefabTargetNodeName.value,
      prefabPlacement: explicitPrefabPlacementAlignment.value ?? '',
    },
  });

  enterAt.value = Date.now();
  void loadPunchProgress();
  void loadMultiuserIdentity();

  if (sceneId.value && sceneSpotId.value) {
    void createTravelEnterRecord({
      sceneId: sceneId.value,
      scenicId: sceneSpotId.value,
      vehicleIdentifier: selectedVehicleIdentifier.value || undefined,
      enterTime: new Date(enterAt.value).toISOString(),
      source: 'tour-miniapp',
      path: '/pages/scenery/index',
      metadata: {
        projectId: projectId.value,
        packageUrl: packageUrl.value,
        packageCacheKey: packageCacheKey.value,
        vehicleIdentifier: selectedVehicleIdentifier.value || '',
      },
    });
  }

  void trackAnalyticsEvent({
    eventType: 'enter_scene',
    sceneId: sceneId.value || undefined,
    sceneSpotId: sceneSpotId.value || undefined,
    vehicleIdentifier: selectedVehicleIdentifier.value || undefined,
    source: 'tour-miniapp',
    path: '/pages/scenery/index',
    metadata: {
      projectId: projectId.value,
      vehicleIdentifier: selectedVehicleIdentifier.value || '',
    },
  });
});

onShow(() => {
  syncBackButtonTop();
});

onUnload(() => {
  const dwellMs = enterAt.value > 0 ? Math.max(Date.now() - enterAt.value, 0) : 0;
  clearSceneryShareContext();

  if (sceneId.value && sceneSpotId.value) {
    void completeTravelLeaveRecord({
      sceneId: sceneId.value,
      scenicId: sceneSpotId.value,
      vehicleIdentifier: selectedVehicleIdentifier.value || undefined,
      leaveTime: new Date().toISOString(),
      source: 'tour-miniapp',
      path: '/pages/scenery/index',
      metadata: {
        projectId: projectId.value,
        dwellMs,
        vehicleIdentifier: selectedVehicleIdentifier.value || '',
      },
    });
  }

  void trackAnalyticsEvent({
    eventType: 'leave_scene',
    sceneId: sceneId.value || undefined,
    sceneSpotId: sceneSpotId.value || undefined,
    vehicleIdentifier: selectedVehicleIdentifier.value || undefined,
    source: 'tour-miniapp',
    path: '/pages/scenery/index',
    dwellMs,
    metadata: {
      projectId: projectId.value,
      vehicleIdentifier: selectedVehicleIdentifier.value || '',
    },
  });
});
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
}

.scenery-fallback {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 24px;
  background: linear-gradient(160deg, #eef7f3 0%, #f8faf9 100%);
}

.scenery-fallback__card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 420px;
  padding: 28px 24px;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 12px 36px rgba(25, 74, 55, 0.12);
}

.scenery-fallback__title {
  color: #173d30;
  font-size: 22px;
  font-weight: 600;
}

.scenery-fallback__description {
  color: #5f716a;
  font-size: 15px;
  line-height: 1.7;
}

.scenery-fallback__button {
  width: 100%;
  margin: 4px 0 0;
  color: #ffffff;
  background: #1d8f63;
}

.floating-back {
  position: fixed;
  left: 12px;
  width: 32px;
  height: 32px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
}

.floating-back__icon {
  font-size: 44px;
  color: #ffffff;
  line-height: 1;
  margin-top: -8px;
}

.floating-title {
  position: fixed;
  left: 56px;
  right: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
  pointer-events: none;
}

.floating-title__text {
  max-width: 100%;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.32);
  color: #ffffff;
  font-size: 14px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

</style>
