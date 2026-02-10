<template>
  <view class="page"></view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';

onLoad(() => {
  uni.redirectTo({ url: '/uni_modules/scenery/pages/index' });
});
</script>
