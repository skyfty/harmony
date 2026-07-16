<template>
  <view :class="['card', variant === 'list' ? 'list' : 'card-bg']" @tap="emit('tap')">
    <template v-if="variant === 'list'">
      <view class="list-row">
        <image class="thumb" :src="coverUrl" mode="aspectFill" />
        <view class="body-list">
          <view class="title-row">
            <view class="name-fav">
              <text class="name">{{ name }}</text>
              <view v-if="typeof favoriteCount === 'number'" class="fav">
                <text class="fav-icon">❤</text>
                <text class="fav-count">{{ favoriteCount }}</text>
              </view>
            </view>
            <view v-if="typeof rating === 'number'" class="rating">
              <text class="star">★</text>
              <text class="value">{{ rating.toFixed(1) }}</text>
            </view>
          </view>

          <view class="meta-row">
            <view class="badge-wrap">
              <view v-if="isHot" class="badge badge-hot">热门</view>
              <view v-if="isFeatured" class="badge badge-featured">精选</view>
              <view v-if="realSceneCheckedIn" class="badge badge-checkin">实景打卡</view>
            </view>
            <text v-if="address" class="address">{{ address }}</text>
          </view>

          <text v-if="summary" class="summary">{{ summary }}</text>

          <view v-if="typeof progressPercent === 'number'" class="progress-row list-progress-row">
            <image class="progress-icon" src="/static/images/checkin.jpg" mode="aspectFit" aria-hidden="true" />
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
                />
              </view>
              <text class="progress-perc">{{ Math.max(0, Math.min(100, Math.round(progressPercent))) }}%</text>
            </view>
          </view>
        </view>
      </view>
    </template>

    <template v-else>
      <image class="cover" :src="coverUrl" mode="aspectFill" />
      <view class="body">
        <view class="title-row">
          <view class="name-fav">
            <text class="name">{{ name }}</text>
            <view v-if="typeof favoriteCount === 'number'" class="fav">
              <text class="fav-icon">❤</text>
              <text class="fav-count">{{ favoriteCount }}</text>
            </view>
          </view>
          <view v-if="typeof rating === 'number'" class="rating">
            <text class="star">★</text>
            <text class="value">{{ rating.toFixed(1) }}</text>
          </view>
        </view>

        <view v-if="typeof progressPercent === 'number'" class="progress-row">
          <image class="progress-icon" src="/static/images/checkin.jpg" mode="aspectFit" aria-hidden="true" />
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
              />
            </view>
            <text class="progress-perc">{{ Math.max(0, Math.min(100, Math.round(progressPercent))) }}%</text>
          </view>
        </view>

        <view v-if="realSceneCheckedIn" class="checkin-chip">
          <text class="checkin-chip__text">实景打卡</text>
        </view>

        <text v-if="summary" class="summary">{{ summary }}</text>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  summary: string | null
  coverUrl: string
  isFeatured?: boolean
  isHot?: boolean
  realSceneCheckedIn?: boolean
  rating?: number
  ratingCount?: number
  favoriteCount?: number
  progressPercent?: number
  progressText?: string
  distance?: string | null
  address?: string | null
  variant?: 'card' | 'list'
}>()

const emit = defineEmits<{ (event: 'tap'): void }>()
</script>

<style scoped lang="scss">
.card {
  position: relative;
  height: 110px;
  border-radius: 10px;
  overflow: hidden;
  -webkit-box-shadow: 0 6px 16px rgba(26, 31, 46, 0.1), 0 3px 10px rgba(31, 122, 236, 0.06);
  box-shadow: 0 6px 16px rgba(26, 31, 46, 0.1), 0 3px 10px rgba(31, 122, 236, 0.06);
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
  display: block;
  padding: 8px;
}

.thumb {
  width: 110px;
  height: 110px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.list-row {
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: flex-start;
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
  align-items: flex-start;
  flex-direction: column;
}

.badge-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.badge {
  height: 18px;
  border-radius: 4px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  box-shadow: 0 6px 14px rgba(10, 14, 33, 0.1);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.badge-hot {
  background: linear-gradient(90deg, #ff7a6b, #ff3b3b);
}

.badge-featured {
  background: linear-gradient(90deg, #fff2b8, #ffd07a);
  color: #1a1f2e;
}

.badge-checkin {
  background: linear-gradient(90deg, #16b574, #0f9d58);
}

.address {
  font-size: 12px;
  color: #8a94a6;
}

.summary {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #5f6b83;
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

.name-fav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fav {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #ff6b6b;
  font-size: 12px;
}

.fav-icon,
.star {
  font-size: 12px;
}

.rating {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #ffb400;
  font-size: 12px;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.list-progress-row {
  margin-top: 10px;
}

.progress-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.progress-bar-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.progress-bar-bg {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: rgba(122, 132, 255, 0.16);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #7b74e7, #4ec3ff);
}

.progress-perc {
  font-size: 11px;
  color: #4a5568;
  min-width: 30px;
  text-align: right;
}

.checkin-chip {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  margin-top: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(22, 181, 116, 0.12);
  border: 1px solid rgba(22, 181, 116, 0.2);
}

.checkin-chip__text {
  font-size: 11px;
  font-weight: 700;
  color: #0f9d58;
}
</style>
