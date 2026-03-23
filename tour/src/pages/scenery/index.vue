<template>
  <view class="page">
    <view class="floating-back" :style="{ top: `${backButtonTop}px` }" @tap="handleBack">
      <text class="floating-back__icon">‹</text>
    </view>

    <SceneryViewer
      :project-id="projectId"
      :package-url="packageUrl"
      :server-asset-base-url="serverAssetBaseUrl"
      @punch="handlePunch"
    />

  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
import {
  completeTravelLeaveRecord,
  createPunchRecord,
  createTravelEnterRecord,
  getDownloadCdnBaseUrl,
  trackAnalyticsEvent,
} from '@harmony/utils';
import { getTopSafeAreaMetrics } from '@/utils/safeArea';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const enterAt = ref<number>(0);
const selectedVehicleId = ref<string>('');
const backButtonTop = ref<number>(8);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();

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
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
  selectedVehicleId.value = typeof record.vehicleId === 'string' ? decodeURIComponent(record.vehicleId) : '';

  enterAt.value = Date.now();

  if (sceneId.value && sceneSpotId.value) {
    void createTravelEnterRecord({
      sceneId: sceneId.value,
      scenicId: sceneSpotId.value,
      enterTime: new Date(enterAt.value).toISOString(),
      source: 'tour-miniapp',
      path: '/pages/scenery/index',
        metadata: {
        projectId: projectId.value,
        packageUrl: packageUrl.value,
        vehicleId: selectedVehicleId.value || undefined,
      },
    });
  }

  void trackAnalyticsEvent({
    eventType: 'enter_scene',
    sceneId: sceneId.value || undefined,
    sceneSpotId: sceneSpotId.value || undefined,
    source: 'tour-miniapp',
    path: '/pages/scenery/index',
    metadata: {
      projectId: projectId.value,
      vehicleId: selectedVehicleId.value || undefined,
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
      leaveTime: new Date().toISOString(),
      source: 'tour-miniapp',
      path: '/pages/scenery/index',
      metadata: {
        projectId: projectId.value,
        dwellMs,
        vehicleId: selectedVehicleId.value || undefined,
      },
    });
  }

  void trackAnalyticsEvent({
    eventType: 'leave_scene',
    sceneId: sceneId.value || undefined,
    sceneSpotId: sceneSpotId.value || undefined,
    source: 'tour-miniapp',
    path: '/pages/scenery/index',
    dwellMs,
    metadata: {
      projectId: projectId.value,
      vehicleId: selectedVehicleId.value || undefined,
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

</style>
