<template>
  <view class="page">
    <view class="floating-back" :style="{ top: `${backButtonTop}px` }" @tap="handleBack">
      <text class="floating-back__icon">‹</text>
    </view>

    <view class="floating-title" :style="{ top: `${backButtonTop}px` }">
      <text class="floating-title__text">{{ scenicTitle || '未命名景区' }}</text>
    </view>

    <SceneryViewer
      :project-id="projectId"
      :package-url="packageUrl"
      :package-cache-key="packageCacheKey"
      :nominate-state-map="nominateStateMap"
      :default-steer-identifier="selectedVehicleIdentifier"
      :server-asset-base-url="serverAssetBaseUrl"
      :debug-console-enabled="false"
      :debug-console-default-expanded="true"
      :debug-console-max-entries="200"
      :initial-punched-node-ids="initialPunchedNodeIds"
      @punch="handlePunch"
    />

  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
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
import { getSelectedVehicleIdentifier } from '@/utils/vehicleSelection';
import { clearSceneryShareContext, setSceneryShareContext } from '@/services/share';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
const packageCacheKey = ref<string>('');
const scenicTitle = ref<string>('');
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const enterAt = ref<number>(0);
const selectedVehicleIdentifier = ref<string>('');
const backButtonTop = ref<number>(8);
const initialPunchedNodeIds = ref<string[]>([]);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();

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

function syncBackButtonTop(): void {
  const metrics = getTopSafeAreaMetrics();
  backButtonTop.value = metrics.topInset + Math.max((metrics.navBarHeight - 32) / 2, 6);
}

type PunchEventPayload = {
  eventName: 'punch';
  sceneId: string;
  clientPunchTime: string;
  behaviorPunchTime: string;
  location: {
    nodeId: string;
    nodeName: string;
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
      ? (progress.punchedNodeIds as string[]).filter((nodeId: string) => nodeId.trim().length > 0)
      : [];
  } catch {
    initialPunchedNodeIds.value = [];
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

  const record = (query ?? {}) as Record<string, unknown>;
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
  setSceneryShareContext({
    title: scenicTitle.value || '景区导览',
    path: '/pages/scenery/index',
    query: {
      projectId: projectId.value,
      packageUrl: packageUrl.value,
      packageCacheKey: packageCacheKey.value,
      scenicTitle: scenicTitle.value,
      sceneSpotId: sceneSpotId.value,
      sceneId: sceneId.value,
      vehicleIdentifier: selectedVehicleIdentifier.value,
    },
  });

  enterAt.value = Date.now();
  void loadPunchProgress();

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
