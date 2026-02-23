<template>
  <view class="page">
    <SceneryViewer :project-id="projectId" :package-url="packageUrl" :scene-url="sceneUrl" @punch="handlePunch" />
    <view v-if="selectedVehicleName" class="vehicle-tag">
      <image v-if="selectedVehicleImageUrl" class="vehicle-tag__image" :src="selectedVehicleImageUrl" mode="aspectFill" />
      <text class="vehicle-tag__text">当前车辆：{{ selectedVehicleName }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
import { completeTravelLeaveRecord, createPunchRecord, createTravelEnterRecord, trackAnalyticsEvent } from '@harmony/utils';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
const sceneUrl = ref<string>('');
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const sceneName = ref<string>('');
const enterAt = ref<number>(0);
const selectedVehicleId = ref<string>('');
const selectedVehicleName = ref<string>('');
const selectedVehicleImageUrl = ref<string>('');

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

function handlePunch(payload: PunchEventPayload): void {
  if (!sceneSpotId.value) {
    return;
  }

  void createPunchRecord({
    sceneId: payload.sceneId,
    scenicId: sceneSpotId.value,
    sceneName: payload.sceneName,
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

onLoad((query: Record<string, unknown> | undefined) => {
  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = typeof record.packageUrl === 'string' ? record.packageUrl : '';
  sceneUrl.value = typeof record.sceneUrl === 'string' ? record.sceneUrl : '';
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
  sceneName.value = typeof record.sceneName === 'string' ? record.sceneName : '';
  selectedVehicleId.value = typeof record.vehicleId === 'string' ? decodeURIComponent(record.vehicleId) : '';
  selectedVehicleName.value = typeof record.vehicleName === 'string' ? decodeURIComponent(record.vehicleName) : '';
  selectedVehicleImageUrl.value = typeof record.vehicleImageUrl === 'string' ? decodeURIComponent(record.vehicleImageUrl) : '';

  if (!selectedVehicleId.value || !selectedVehicleName.value) {
    try {
      const selectedVehicleText = uni.getStorageSync('tour:selectedVehicle');
      if (typeof selectedVehicleText === 'string' && selectedVehicleText) {
        const selectedVehicle = JSON.parse(selectedVehicleText) as {
          id?: string;
          name?: string;
          imageUrl?: string;
          coverUrl?: string;
        };
        if (!selectedVehicleId.value && typeof selectedVehicle.id === 'string') {
          selectedVehicleId.value = selectedVehicle.id;
        }
        if (!selectedVehicleName.value && typeof selectedVehicle.name === 'string') {
          selectedVehicleName.value = selectedVehicle.name;
        }
        if (!selectedVehicleImageUrl.value) {
          const image =
            typeof selectedVehicle.imageUrl === 'string' && selectedVehicle.imageUrl
              ? selectedVehicle.imageUrl
              : selectedVehicle.coverUrl;
          selectedVehicleImageUrl.value = typeof image === 'string' ? image : '';
        }
      }
    } catch {
      // ignore
    }
  }

  enterAt.value = Date.now();

  if (sceneId.value && sceneSpotId.value) {
    void createTravelEnterRecord({
      sceneId: sceneId.value,
      scenicId: sceneSpotId.value,
      sceneName: sceneName.value || undefined,
      enterTime: new Date(enterAt.value).toISOString(),
      source: 'tour-miniapp',
      path: '/pages/scenery/index',
      metadata: {
        projectId: projectId.value,
        packageUrl: packageUrl.value,
        sceneUrl: sceneUrl.value,
        vehicleId: selectedVehicleId.value || undefined,
        vehicleName: selectedVehicleName.value || undefined,
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
      vehicleName: selectedVehicleName.value || undefined,
    },
  });
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
        vehicleName: selectedVehicleName.value || undefined,
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
      vehicleName: selectedVehicleName.value || undefined,
    },
  });
});
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
}

.vehicle-tag {
  position: fixed;
  left: 16rpx;
  top: 24rpx;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 10rpx 14rpx;
  border-radius: 999rpx;
  background: rgba(0, 0, 0, 0.45);
}

.vehicle-tag__image {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
}

.vehicle-tag__text {
  color: #ffffff;
  font-size: 22rpx;
}
</style>
