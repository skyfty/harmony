<template>
  <view class="page">
    <SceneryViewer :project-id="projectId" :package-url="packageUrl" :scene-url="sceneUrl" />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import SceneryViewer from '@harmony/scenery/components/SceneryViewer.vue';

const projectId = ref<string>('');
const packageUrl = ref<string>('');
const sceneUrl = ref<string>('');

onLoad((query) => {
  const record = (query ?? {}) as Record<string, unknown>;
  projectId.value = typeof record.projectId === 'string' ? record.projectId : '';
  packageUrl.value = typeof record.packageUrl === 'string' ? record.packageUrl : '';
  sceneUrl.value = typeof record.sceneUrl === 'string' ? record.sceneUrl : '';
});
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
}
</style>
