<template>
  <view class="page-container">
    <SceneryViewer
      :project-id="projectId"
      :package-url="packageUrl"
      :scene-url="sceneUrl"
      :physics-interpolation="true"
      @progress="handleProgress"
      @error="handleError"
    />

    <view v-if="loadingText" class="loading-overlay">
      <text class="loading-text">{{ loadingText }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';
import SceneryViewer from './uni_modules/scenery/components/SceneryViewer.vue';

const projectId = ref('');
const packageUrl = ref('');
const sceneUrl = ref('');
const loadingText = ref('');

onLoad((query) => {
  projectId.value = typeof query?.projectId === 'string' ? query.projectId : '';
  packageUrl.value = typeof query?.packageUrl === 'string' ? query.packageUrl : '';
  sceneUrl.value = typeof query?.sceneUrl === 'string' ? query.sceneUrl : '';
});

function handleProgress(value: any) {
  if (!value) {
    loadingText.value = '';
    return;
  }
  const percent = typeof value.percent === 'number' ? Math.round(value.percent) : null;
  if (percent !== null) {
    loadingText.value = `正在加载… ${percent}%`;
    return;
  }
  loadingText.value = '正在加载…';
}

function handleError(err: any) {
  const message =
    typeof err === 'string' ? err : typeof err?.message === 'string' ? err.message : '加载失败';
  uni.showToast({ title: message, icon: 'none' });
}
</script>

<style scoped>
.loading-overlay {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
  z-index: 999;
}

.loading-text {
  background: rgba(26, 31, 46, 0.75);
  color: #ffffff;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
}
</style>
