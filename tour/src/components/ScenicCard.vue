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
      <view v-if="typeof progressPercent === 'number'" class="progress-row">
        <text class="progress-label">{{ progressText || '打卡进度' }}</text>
        <view class="progress-tag">
          <text class="progress-value">{{ Math.max(0, Math.min(100, Math.round(progressPercent))) }}%</text>
        </view>
      </view>
      <text v-if="summary" class="summary">{{ summary }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  summary: string | null;
  coverUrl: string;
  rating?: number;
  progressPercent?: number;
  progressText?: string;
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

.progress-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.progress-label {
  font-size: 11px;
  color: #8a94a6;
}

.progress-tag {
  height: 22px;
  border-radius: 999px;
  padding: 0 8px;
  background: rgba(32, 188, 126, 0.14);
  display: flex;
  align-items: center;
}

.progress-value {
  font-size: 11px;
  font-weight: 700;
  color: #16a16d;
}
</style>
