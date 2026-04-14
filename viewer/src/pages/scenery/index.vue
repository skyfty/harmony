<template>
  <view class="page">
    <SceneryViewer
      :project-id="projectId"
      :package-url="packageUrl"
      :nominate-state-map="nominateStateMap"
      :default-steer-identifier="selectedVehicleIdentifier"
      :server-asset-base-url="serverAssetBaseUrl"
      :initial-punched-node-ids="initialPunchedNodeIds"
      @punch="handlePunch"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
import { createPunchRecord, getDownloadCdnBaseUrl, getPunchProgress } from '@harmony/utils';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
// sceneUrl removed: use packageUrl instead
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const selectedVehicleIdentifier = ref<string>('');
const enterAt = ref<number>(0);
const initialPunchedNodeIds = ref<string[]>([]);
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
    vehicleIdentifier: selectedVehicleIdentifier.value || undefined,
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

onLoad((query: Record<string, unknown> | undefined) => {
  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = decodeQueryValue(record.packageUrl);
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
  selectedVehicleIdentifier.value =  typeof record.vehicleIdentifier === 'string' ? record.vehicleIdentifier : 'car1';
  enterAt.value = Date.now();

  void loadPunchProgress();
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
