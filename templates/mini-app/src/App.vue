<template>
  <view class="app-root">
    <slot />
  </view>
</template>

<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { ensureMiniRuntimeConfig } from '@/platform/runtime';

onLaunch(() => {
  void ensureMiniRuntimeConfig();
});
</script>

<style lang="scss">
.app-root {
  min-height: 100vh;
}
</style>
