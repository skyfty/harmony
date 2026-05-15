<template>
  <view class="page">
    <SceneryViewer
      v-if="pageReady && !loadError"
      :project-id="projectId"
      :package-url="packageUrl"
      :nominate-state-map="nominateStateMap"
      :default-steer-identifier="selectedVehicleIdentifier"
      :server-asset-base-url="serverAssetBaseUrl"
      :initial-punched-node-ids="initialPunchedNodeIds"
      :physics-engine="resolvedPhysicsEngine"
      @punch="handlePunch"
    />

    <view v-else class="loading-state">
      <view class="loading-state__card">
        <text class="loading-state__title">正在准备场景</text>
        <text class="loading-state__desc">
          {{ loadError || '正在初始化场景与物理引擎...' }}
        </text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { createPunchRecord, getDownloadCdnBaseUrl, getPunchProgress } from '@harmony/utils';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
// sceneUrl removed: use packageUrl instead
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const selectedVehicleIdentifier = ref<string>('');
const initialPunchedNodeIds = ref<string[]>([]);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();
const resolvedPhysicsEngine = ref<'cannon'>('cannon');
const loadError = ref<string>('');
const pageReady = ref(false);

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
  pageReady.value = false;
  loadError.value = '';
  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = decodeQueryValue(record.packageUrl);
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
  selectedVehicleIdentifier.value = typeof record.vehicleIdentifier === 'string' ? record.vehicleIdentifier : 'car1';

  void loadPunchProgress();
  pageReady.value = true;
});

onUnload(() => {
  pageReady.value = false;
});
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
}

.loading-state {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fa 100%);
}

.loading-state__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  padding: 20px 24px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 30px rgba(31, 47, 77, 0.12);
}

.loading-state__title {
  font-size: 16px;
  font-weight: 600;
  color: #202531;
}

.loading-state__desc {
  font-size: 13px;
  color: #667085;
}
</style>


