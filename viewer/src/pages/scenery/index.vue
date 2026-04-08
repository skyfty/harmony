<template>
  <view class="page">
    <SceneryViewer
      :project-id="projectId"
      :package-url="packageUrl"
      :nominate-state-map="nominateStateMap"
      :server-asset-base-url="serverAssetBaseUrl"
      @punch="handlePunch"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
import { createPunchRecord, getDownloadCdnBaseUrl } from '@harmony/utils';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
// sceneUrl removed: use packageUrl instead
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const selectedVehicleId = ref<string>('');
const enterAt = ref<number>(0);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();
const nominateStateMap = computed(() => {
  const vehicleId = selectedVehicleId.value.trim();
  if (!vehicleId) {
    return null;
  }
  return {
    [vehicleId]: {
      visible: true,
    },
  };
});

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
    source: 'viewer-miniapp',
    path: '/pages/scenery/index',
  });
}

onLoad((query: Record<string, unknown> | undefined) => {
  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = decodeQueryValue(record.packageUrl);
  // sceneUrl parameter removed; ignore record.sceneUrl
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
  selectedVehicleId.value = decodeQueryValue(record.vehicleId);
  enterAt.value = Date.now();
});

onUnload(() => {

});
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
}
</style>
