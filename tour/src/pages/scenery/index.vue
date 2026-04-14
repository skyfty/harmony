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
  trackAnalyticsEvent,
} from '@harmony/utils/mini-client';
import { getTopSafeAreaMetrics } from '@/utils/safeArea';
import { getSelectedVehicleIdentifier } from '@/utils/vehicleSelection';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
const packageCacheKey = ref<string>('');
const scenicTitle = ref<string>('');
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const enterAt = ref<number>(0);
const selectedVehicleIdentifier = ref<string>('');
const backButtonTop = ref<number>(8);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();
const nominateStateMap = computed(() => {
  const vehicleIdentifier = selectedVehicleIdentifier.value.trim();
  if (!vehicleIdentifier) {
    return null;
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

function handleBack(): void {
  uni.navigateBack({
    fail: () => {
      void uni.reLaunch({ url: '/pages/home/index' });
    },
  });
}

onLoad((query: Record<string, unknown> | undefined) => {
  syncBackButtonTop();

  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = typeof record.packageUrl === 'string' ? record.packageUrl : '';
  packageCacheKey.value = typeof record.packageCacheKey === 'string' ? record.packageCacheKey : '';
  scenicTitle.value = typeof record.scenicTitle === 'string'
    ? decodeURIComponent(record.scenicTitle)
    : typeof record.sceneName === 'string'
      ? decodeURIComponent(record.sceneName)
      : '';
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
  selectedVehicleIdentifier.value = typeof record.vehicleIdentifier === 'string'
    ? decodeURIComponent(record.vehicleIdentifier)
    : getSelectedVehicleIdentifier();

  enterAt.value = Date.now();

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
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
}

.floating-back__icon {
  font-size: 24px;
  color: #ffffff;
  line-height: 1;
  margin-top: -2px;
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
