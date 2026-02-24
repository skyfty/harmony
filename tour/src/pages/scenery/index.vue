<template>
  <view class="page">
    <SceneryViewer :project-id="projectId" :package-url="packageUrl" :scene-url="sceneUrl" @punch="handlePunch" />

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

</style>
