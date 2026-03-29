<template>
  <view :class="['card', variant === 'list' ? 'list' : 'card-bg']" @tap="emit('tap')">
    <template v-if="variant === 'list'">
      <image class="thumb" :src="coverUrl" mode="aspectFill" />
      <view class="body-list">
        <view class="title-row">
          <text class="name">{{ name }}</text>
          <view v-if="typeof rating === 'number'" class="rating">
            <text class="star">★</text>
            <text class="value">{{ rating.toFixed(1) }}</text>
          </view>
        </view>
        <view class="meta-row">
          <text v-if="typeof ratingCount === 'number'" class="review-count">点评 {{ ratingCount }} 条</text>
          <text v-if="distance" class="distance">{{ distance }}</text>
        </view>
        <text v-if="summary" class="summary">{{ summary }}</text>
      </view>
    </template>
    <template v-else>
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
    </template>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  summary: string | null;
  coverUrl: string;
  rating?: number;
  ratingCount?: number;
  progressPercent?: number;
  progressText?: string;
  distance?: string | null;
  variant?: 'card' | 'list';
}>();

const emit = defineEmits<{ (event: 'tap'): void }>();
</script>

<style scoped lang="scss">
.card {
  position: relative;
  height: 140px;
  border-radius: 10px;
  overflow: hidden;
  -webkit-box-shadow: 0 6px 16px rgba(26, 31, 46, 0.10), 0 3px 10px rgba(31, 122, 236, 0.06);
  box-shadow: 0 6px 16px rgba(26, 31, 46, 0.10), 0 3px 10px rgba(31, 122, 236, 0.06);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.card:active {
  transform: translateY(1px) scale(0.998);
  -webkit-box-shadow: 0 8px 20px rgba(26, 31, 46, 0.12), 0 4px 12px rgba(31, 122, 236, 0.08);
  box-shadow: 0 8px 20px rgba(26, 31, 46, 0.12), 0 4px 12px rgba(31, 122, 236, 0.08);
}

.card:hover {
  transform: translateY(-2px) scale(1.005);
  -webkit-box-shadow: 0 10px 24px rgba(26, 31, 46, 0.14), 0 5px 16px rgba(31, 122, 236, 0.09);
  box-shadow: 0 10px 24px rgba(26, 31, 46, 0.14), 0 5px 16px rgba(31, 122, 236, 0.09);
}

.cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.list {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: 90px;
  padding: 8px;
}

.thumb {
  width: 110px;
  height: 74px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.body-list {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding-left: 12px;
  padding-top: 6px;
  flex: 1;
}

.meta-row {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  align-items: center;
}

.distance {
  font-size: 12px;
  color: #8a94a6;
}

.body-list .meta-row {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.review-count {
  font-size: 12px;
  color: #8a94a6;
}

.body {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 10px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.35);
  -webkit-backdrop-filter: blur(5px);
  backdrop-filter: blur(5px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 16px;
  font-weight: 700;
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
