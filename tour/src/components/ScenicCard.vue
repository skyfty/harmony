<template>
  <view class="card" @tap="emit('tap')">
    <image class="cover" :src="coverUrl" mode="aspectFill" />
    <view class="body">
      <view class="title-row">
        <text class="name">{{ name }}</text>
        <view v-if="typeof rating === 'number'" class="rating">
          <text class="star">★</text>
          <text class="value">{{ rating.toFixed(1) }}</text>
        </view>
      </view>
      <text class="summary">{{ summary }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  summary: string;
  coverUrl: string;
  rating?: number;
}>();

const emit = defineEmits<{ (event: 'tap'): void }>();
</script>

<style scoped lang="scss">
.card {
  background: #ffffff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.cover {
  width: 100%;
  height: 160px;
  display: block;
}

.body {
  padding: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 15px;
  font-weight: 600;
  color: #1a1f2e;
}

.rating {
  display: flex;
  align-items: center;
  gap: 4px;
}

.star {
  font-size: 12px;
  color: #ffb340;
}

.value {
  font-size: 12px;
  color: #5f6b83;
}

.summary {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #8a94a6;
  line-height: 18px;
}
</style>
