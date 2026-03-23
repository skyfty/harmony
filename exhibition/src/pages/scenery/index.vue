<template>
  <view class="page">
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
import { onLoad, onUnload } from '@dcloudio/uni-app';
import SceneryViewer from '@harmony/scenery/components/SceneryViewer.vue';
import { createPunchRecord, getDownloadCdnBaseUrl, trackAnalyticsEvent } from '@harmony/utils';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
// sceneUrl removed: use packageUrl instead
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const enterAt = ref<number>(0);
const serverAssetBaseUrl = getDownloadCdnBaseUrl();

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
    source: 'miniapp',
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
  enterAt.value = Date.now();

  void trackAnalyticsEvent({
    eventType: 'enter_scene',
    sceneId: sceneId.value || undefined,
    sceneSpotId: sceneSpotId.value || undefined,
    source: 'miniapp',
    path: '/pages/scenery/index',
    metadata: {
      projectId: projectId.value,
    },
  });
});

onUnload(() => {
  const stayMs = enterAt.value > 0 ? Math.max(Date.now() - enterAt.value, 0) : 0;
  void trackAnalyticsEvent({
    eventType: 'leave_scene',
    sceneId: sceneId.value || undefined,
    sceneSpotId: sceneSpotId.value || undefined,
    source: 'miniapp',
    path: '/pages/scenery/index',
    dwellMs: stayMs,
    metadata: {
      projectId: projectId.value,
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
