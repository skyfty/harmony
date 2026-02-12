<template>
  <view class="card">
    <view class="top">
      <view class="left">
        <text class="title">{{ title }}</text>
        <text class="desc">{{ description }}</text>
      </view>
      <button v-if="scenicId" class="enter" @tap="emit('enter', scenicId)">进入景区</button>
    </view>
    <view class="bar">
      <view class="bar-fill" :style="{ width: `${Math.round(progress * 100)}%` }" />
    </view>
    <text class="percent">{{ Math.round(progress * 100) }}%</text>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  progress: number;
  scenicId?: string;
}>();

const emit = defineEmits<{ (event: 'enter', scenicId: string): void }>();
</script>

<style scoped lang="scss">
.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.left {
  flex: 1;
}

.title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: #1a1f2e;
}

.desc {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #5f6b83;
}

.enter {
  align-self: flex-start;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 12px;
  height: 30px;
  line-height: 30px;
}

.bar {
  margin-top: 12px;
  height: 8px;
  background: #f2f4f7;
  border-radius: 999px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(63, 151, 255, 0.9), rgba(126, 198, 255, 0.9));
}

.percent {
  display: block;
  margin-top: 8px;
  font-size: 11px;
  color: #8a94a6;
}
</style>
