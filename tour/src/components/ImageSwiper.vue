<template>
  <swiper class="swiper" circular autoplay :interval="3500" :duration="400">
    <swiper-item v-for="(url, idx) in imageUrls" :key="idx" class="item">
      <image class="img" :src="url" mode="aspectFill" />
    </swiper-item>
  </swiper>
</template>

<script setup lang="ts">
defineProps<{ imageUrls: string[] }>();
</script>

<style scoped>
.swiper {
  width: 100%;
  height: 220px;
  border-radius: 16px;
  overflow: hidden;
}

.img {
  width: 100%;
  height: 220px;
  display: block;
}
</style>
