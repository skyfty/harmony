<template>
  <view class="page">
    <SceneryViewer :project-id="projectId" :package-url="packageUrl" @punch="handlePunch" />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';
import { createPunchRecord } from '@harmony/utils';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
// sceneUrl removed: use packageUrl instead
const sceneSpotId = ref<string>('');
const sceneId = ref<string>('');
const enterAt = ref<number>(0);

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
    source: 'viewer-miniapp',
    path: '/pages/scenery/index',
  });
}

onLoad((query: Record<string, unknown> | undefined) => {
  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = typeof record.packageUrl === 'string' ? record.packageUrl : '';
  // sceneUrl parameter removed; ignore record.sceneUrl
  sceneSpotId.value = typeof record.sceneSpotId === 'string' ? record.sceneSpotId : '';
  sceneId.value = typeof record.sceneId === 'string' ? record.sceneId : '';
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
