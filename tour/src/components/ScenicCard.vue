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
        <view class="progress-bar-wrap">
          <view
            class="progress-bar-bg"
            role="progressbar"
            :aria-valuenow="Math.max(0, Math.min(100, Math.round(progressPercent)))"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <view
              class="progress-bar-fill"
              :style="{ width: Math.max(0, Math.min(100, Math.round(progressPercent))) + '%' }"
            ></view>
          </view>
          <text class="progress-perc">{{ Math.max(0, Math.min(100, Math.round(progressPercent))) }}%</text>
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
  position: relative;
  height: 140px;
  border-radius: 10px;
  overflow: hidden;
  -webkit-box-shadow: 0 10px 30px rgba(26, 31, 46, 0.14), 0 6px 20px rgba(31, 122, 236, 0.08);
  box-shadow: 0 10px 30px rgba(26, 31, 46, 0.14), 0 6px 20px rgba(31, 122, 236, 0.08);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.card:active {
  transform: translateY(1px) scale(0.998);
  -webkit-box-shadow: 0 12px 36px rgba(26, 31, 46, 0.18), 0 6px 18px rgba(31, 122, 236, 0.1);
  box-shadow: 0 12px 36px rgba(26, 31, 46, 0.18), 0 6px 18px rgba(31, 122, 236, 0.1);
}

.card:hover {
  transform: translateY(-4px) scale(1.01);
  -webkit-box-shadow: 0 18px 48px rgba(26, 31, 46, 0.22), 0 8px 28px rgba(31, 122, 236, 0.12);
  box-shadow: 0 18px 48px rgba(26, 31, 46, 0.22), 0 8px 28px rgba(31, 122, 236, 0.12);
}

.cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.body {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.35);
  -webkit-backdrop-filter: blur(5px);
  backdrop-filter: blur(5px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 13px;
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
  color: #5f6b83;
  line-height: 18px;
}

.progress-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
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

.progress-bar-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.progress-bar-bg {
  flex: 1;
  height: 8px;
  background: #eef3f7;
  border-radius: 8px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #20bc7e, #16a16d);
  border-radius: 8px;
  transition: width 0.36s cubic-bezier(.2,.8,.2,1);
}

.progress-perc {
  font-size: 11px;
  font-weight: 700;
  color: #16a16d;
}
</style>
