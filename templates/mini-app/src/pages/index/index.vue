<template>
  <view class="page">
    <view class="card">
      <text class="title">{{ appName }}</text>
      <text class="line">appKey: {{ appKey }}</text>
      <text class="line">platform: {{ platform }}</text>
      <text class="line">appType: {{ appType }}</text>
      <button class="button" @tap="reloadRuntime">Reload runtime config</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { detectMiniPlatform, type MiniRuntimeConfig } from '@mini-platform/core';
import { ensureMiniRuntimeConfig, getMiniAppKey } from '@/platform/runtime';

const appKey = getMiniAppKey();
const platform = detectMiniPlatform();
const runtime = ref<MiniRuntimeConfig | null>(null);

const appName = computed(() => runtime.value?.publicRuntimeConfig.branding.appName || '__APP_TITLE__');
const appType = computed(() => runtime.value?.appType || '__APP_TYPE__');

async function reloadRuntime() {
  runtime.value = await ensureMiniRuntimeConfig();
}

onLoad(() => {
  void reloadRuntime();
});
</script>

<style lang="scss">
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #f7fbff 0%, #f4f7fb 100%);
}

.card {
  width: min(100%, 320px);
  padding: 20px;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 16px 40px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #162034;
}

.line {
  font-size: 13px;
  color: #64748b;
}

.button {
  margin-top: 8px;
  border-radius: 20px;
  background: linear-gradient(135deg, #1f7aec, #5d9bff);
  color: #ffffff;
}
</style>
