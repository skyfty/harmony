<template>
  <view class="page">
    <!-- Floating back button -->
    <view
      class="floating-back"
      :style="{ top: (statusBarHeight + 8) + 'px' }"
      @tap="handleBack"
    >
      <image class="floating-back__img" src="/static/images/back.png" mode="aspectFit" />
    </view>

    <view v-if="!scenic" class="state">
      <text class="state-title">景区不存在</text>
    </view>

    <view v-else>
      <!-- Full-bleed hero swiper -->
      <view class="hero-wrap">
        <swiper
          class="hero-swiper"
          circular
          autoplay
          :interval="3500"
          :duration="400"
          @change="onSwiperChange"
        >
          <swiper-item v-for="(url, idx) in scenic.slides" :key="idx">
            <image class="hero-img" :src="url" mode="aspectFill" />
          </swiper-item>
        </swiper>
        <!-- Page indicator badge -->
        <view v-if="scenic.slides.length > 1" class="page-indicator">
          <text class="page-indicator__text">{{ currentSlide + 1 }}/{{ scenic.slides.length }}</text>
        </view>
      </view>

      <!-- Content body overlapping hero image -->
      <view class="detail-body">
        <!-- Title + rating + favorite -->
        <view class="title-row">
          <view class="title-left">
            <text class="scenic-name">{{ scenic.title }}</text>
            <view class="badge-wrap-detail">
              <view v-if="scenic.isHot" class="badge badge-hot">热门</view>
              <view v-if="scenic.isHome || scenic.isFeatured" class="badge badge-featured">精选</view>
            </view>
            <view class="rating-row">
              <view class="stars-inline">
                <text
                  v-for="n in 5"
                  :key="'s' + n"
                  class="star-char"
                  :class="{ filled: n <= Math.round(scenic.averageRating || 0) }"
                >★</text>
              </view>
              <text class="rating-num">{{ ratingLabel }}</text>
              <text class="rating-count">({{ formatFavoriteCount(scenic.favoriteCount) }}点赞)</text>
            </view>
          </view>
          <view
            class="favorite-btn"
            :class="{ 'favorite-btn--active': scenic.favorited }"
            @tap="handleToggleFavorite"
          >
            <text class="favorite-btn__icon">{{ scenic.favorited ? '❤' : '♡' }}</text>
            <text class="favorite-btn__label">点赞</text>
          </view>
        </view>

        <view class="meta-rows">
          <view class="meta-row meta-compact meta-compact--split">
            <view class="meta-compact__left">
              <text class="meta-address">{{ scenic.address || '未提供' }}</text>
              <text v-if="scenic.distance" class="meta-distance">{{ scenic.distance }}</text>
            </view>
            <view class="meta-compact__right">
              <text
                v-if="scenic.location"
                class="meta-action meta-action--map"
                @tap="openMap(scenic.location.lat, scenic.location.lng)"
                >📍</text>
              <text
                v-if="scenic.phone"
                class="meta-action meta-action--phone"
                @tap="callPhone(scenic.phone)"
                >📞</text>
            </view>
          </view>
        </view>

        <view class="progress-section">
          <view class="progress-badge">
            <text class="progress-badge__value">{{ scenicProgressPercentText }}</text>
          </view>
          <view class="progress-content">
            <text class="progress-title">打卡进度</text>
            <text class="progress-desc">{{ scenicProgressDescription }}</text>
          </view>
          <view class="progress-check">✓</view>
        </view>

        <!-- 景区介绍 -->
        <view class="intro-section">
          <view class="section-header">
            <view class="section-dot" />
            <text class="section-title">景区介绍</text>
          </view>
          <text class="intro-text">{{ scenic.description }}</text>
        </view>



        <!-- CTA button -->
        <view class="cta-area">
          <button class="cta-btn" @tap="enterScenery">
            <text class="cta-btn__text">进入景区</text>
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { buildQueryString, trackAnalyticsEvent } from '@harmony/utils';
import {
  getScenic,
  listAchievements,
  toggleScenicFavorite,
} from '@/api/mini';
import type { ScenicCheckinProgressItem } from '@/types/achievement';
import type { ScenicDetail } from '@/types/scenic';
import { getSelectedVehicleIdentifier, setSelectedVehicle } from '@/utils/vehicleSelection';
import { listVehicles } from '@/api/mini/vehicles';
import { getStatusBarHeight } from '@/utils/systemInfo';

type ScenicDetailWithFlags = ScenicDetail & {
  isFeatured?: boolean;
  isHot?: boolean;
};

const scenic = ref<ScenicDetailWithFlags | null>(null);
const scenicId = ref('');
const favoriteLoading = ref(false);
const currentSlide = ref(0);
const scenicCheckinProgress = ref<ScenicCheckinProgressItem | null>(null);



/* Status bar height for floating back button positioning */
const statusBarHeight = ref(getStatusBarHeight());

const ratingLabel = computed(() => {
  const v = scenic.value?.averageRating ?? 0;
  if (v <= 0) return '--';
  if (v >= 4.95) return '满分';
  return v.toFixed(v >= 10 ? 0 : 1);
});

const scenicProgressPercentText = computed(() => `${Math.round(computeScenicCheckinRatio() * 100)}%`);

const scenicProgressDescription = computed(() => {
  const checked = getSafeCount(scenicCheckinProgress.value?.checkedCount);
  const total = getSafeCount(scenicCheckinProgress.value?.totalCount);
  const percent = Math.round(computeScenicCheckinRatio() * 100);
  if (percent >= 100 && total > 0) {
    return '已完成该景区所有景点打卡';
  }
  if (total > 0) {
    return `已完成该景区${checked}/${total}个景点打卡`;
  }
  return '暂未开始该景区景点打卡';
});

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  scenicId.value = id;
  if (!id) {
    scenic.value = null;
    scenicCheckinProgress.value = null;
    return;
  }
  scenicCheckinProgress.value = null;
  void getScenic(id)
    .then((scenicRes) => {
      scenic.value = scenicRes ?? null;
      if (scenicRes) {
        void loadScenicCheckinProgress(scenicRes.id);
        void trackAnalyticsEvent({
          eventType: 'view_spot',
          sceneId: scenicRes.sceneId,
          sceneSpotId: scenicRes.id,
          source: 'tour-miniapp',
          path: '/pages/scenic/detail',
          metadata: {
            scenicTitle: scenicRes.title,
          },
        });
      }
    })
    .catch((e) => {
      console.error('Failed to load scenic detail', e);
      scenic.value = null;
      uni.showToast({ title: '加载失败', icon: 'none' });
    });
});

/* ---- Navigation ---- */

function handleBack() {
  uni.navigateBack({
    fail: () => {
      void uni.redirectTo({ url: '/pages/home/index' });
    },
  });
}

async function loadScenicCheckinProgress(scenicId: string): Promise<void> {
  try {
    const achievementData = await listAchievements();
    const progressList = Array.isArray(achievementData.scenicCheckinProgresses)
      ? achievementData.scenicCheckinProgresses
      : [];
    scenicCheckinProgress.value = progressList.find((item) => item.scenicId === scenicId) ?? null;
  } catch {
    scenicCheckinProgress.value = null;
  }
}

async function enterScenery() {
  if (!scenic.value) return;

  let vehicleIdentifier = getSelectedVehicleIdentifier();
  // 若本地未同步车辆信息，则主动同步
  if (!vehicleIdentifier) {
    try {
      const vehicles = await listVehicles();
      const current = vehicles.find((v) => v.isCurrent) || vehicles.find((v) => v.owned);
      if (current) {
        setSelectedVehicle(current);
        vehicleIdentifier = typeof current.identifier === 'string' ? current.identifier.trim() : '';
      }
    } catch (e) {
      // ignore, fallback to empty
    }
  }

  const queryParts = [
    `packageUrl=${encodeURIComponent(scenic.value.scene.fileUrl)}`,
    `packageCacheKey=${encodeURIComponent(scenic.value.scene.fileKey)}`,
    `sceneSpotId=${encodeURIComponent(scenic.value.id)}`,
    `sceneId=${encodeURIComponent(scenic.value.sceneId)}`,
    `scenicTitle=${encodeURIComponent(scenic.value.title)}`,
    `vehicleIdentifier=${encodeURIComponent(vehicleIdentifier)}`,
  ];
  uni.navigateTo({
    url: `/pages/scenery/index?${queryParts.join('&')}`,
  });
}

/* ---- Swiper ---- */

function onSwiperChange(e: { detail: { current: number } }) {
  currentSlide.value = e.detail.current;
}

/* ---- Interactions ---- */

function applyInteractionState(next: {
  averageRating: number;
  ratingCount: number;
  favoriteCount: number;
  favorited: boolean;
  userRating: number | null;
}) {
  if (!scenic.value) return;
  scenic.value.averageRating = Number(next.averageRating ?? 0);
  scenic.value.ratingCount = Number(next.ratingCount ?? 0);
  scenic.value.favoriteCount = Number(next.favoriteCount ?? 0);
  scenic.value.favorited = next.favorited === true;
  scenic.value.userRating = typeof next.userRating === 'number' ? next.userRating : null;
}

async function handleToggleFavorite(): Promise<void> {
  if (!scenic.value || favoriteLoading.value) return;
  favoriteLoading.value = true;
  try {
    const next = await toggleScenicFavorite(scenic.value.id);
    applyInteractionState(next);
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  } finally {
    favoriteLoading.value = false;
  }
}

/* ---- Helpers ---- */

function formatFavoriteCount(count: number | undefined): string {
  const n = count || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof (reason as { message: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  if (typeof reason === 'string') return reason;
  return '操作失败，请稍后重试';
}

function getSafeCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(Number(value), 0);
}

function openMap(lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null) {
    uni.showToast({ title: '定位信息不可用', icon: 'none' })
    return
  }
  try {
    uni.openLocation({ latitude: Number(lat), longitude: Number(lng), name: scenic.value?.title ?? '', address: scenic.value?.address ?? '' })
  } catch {
    uni.showToast({ title: '无法打开地图', icon: 'none' })
  }
}

function callPhone(phone?: string | null) {
  if (!phone) {
    uni.showToast({ title: '未提供电话', icon: 'none' })
    return
  }
  try {
    // some runtimes provide makePhoneCall
    // @ts-ignore
    if (typeof uni.makePhoneCall === 'function') {
      // @ts-ignore
      uni.makePhoneCall({ phoneNumber: phone })
    } else {
      uni.setClipboardData({ data: phone })
      uni.showToast({ title: '已复制电话号码', icon: 'none' })
    }
  } catch {
    uni.showToast({ title: '无法拨号', icon: 'none' })
  }
}

function computeScenicCheckinRatio(): number {
  const checked = getSafeCount(scenicCheckinProgress.value?.checkedCount);
  const total = getSafeCount(scenicCheckinProgress.value?.totalCount);
  if (total <= 0) {
    return 0;
  }
  return Math.min(checked / total, 1);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

/* ---- Floating back button ---- */
.floating-back {
  position: fixed;
  left: 16px;
  z-index: 200;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(12, 16, 30, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.floating-back__img {
  width: 16px;
  height: 16px;
  display: block;
}

/* ---- Hero swiper ---- */
.hero-wrap {
  position: relative;
  width: 100%;
}

.hero-swiper {
  width: 100%;
  height: 340px;
}

.hero-img {
  width: 100%;
  height: 340px;
  display: block;
}

.page-indicator {
  position: absolute;
  right: 16px;
  bottom: 36px; /* above the overlap region */
  background: rgba(0, 0, 0, 0.45);
  border-radius: 10px;
  padding: 2px 10px;
}

.page-indicator__text {
  font-size: 12px;
  color: #ffffff;
}

/* ---- Content body (overlaps hero) ---- */
.detail-body {
  position: relative;
  margin-top: -24px;
  background: #ffffff;
  border-radius: 24px 24px 0 0;
  padding: 24px 20px 120px;
  min-height: 50vh;
}

/* ---- Title + favorite row ---- */
.title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title-left {
  flex: 1;
  min-width: 0;
}

.scenic-name {
  display: block;
  font-size: 27px;
  font-weight: 700;
  color: #1a1f2e;
  line-height: 1.3;
  word-break: break-all;
}

.rating-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.stars-inline {
  display: flex;
  gap: 1px;
}

.star-char {
  font-size: 14px;
  color: #e3e9f2;
}

.star-char.filled {
  color: #ffb400;
}

.rating-num {
  font-size: 13px;
  font-weight: 600;
  color: #1a1f2e;
  margin-left: 4px;
}

.rating-count {
  font-size: 12px;
  color: #8a94a6;
}

/* ---- Favorite button ---- */
.favorite-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 12px;
  flex-shrink: 0;
  transition: all 0.2s;
}

.favorite-btn:active {
  transform: scale(0.92);
  opacity: 0.8;
}

.favorite-btn--active {
  border-color: #fdd;
  background: rgba(231, 76, 60, 0.06);
}

.favorite-btn__icon {
  font-size: 20px;
  color: #8a94a6;
}

.favorite-btn--active .favorite-btn__icon {
  color: #e74c3c;
}

.favorite-btn__label {
  font-size: 11px;
  color: #8a94a6;
}

.progress-section {
  margin-top: 16px;
  padding: 14px 14px;
  border-radius: 16px;
  border: 1px solid #dbe3f0;
  background: #f5f7fb;
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-badge {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(32, 188, 126, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.progress-badge__value {
  font-size: 14px;
  font-weight: 700;
  color: #14a16b;
}

.progress-content {
  min-width: 0;
  flex: 1;
}

.progress-title {
  display: block;
  font-size: 15px;
  font-weight: 700;
  color: #1a1f2e;
}

.progress-desc {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #8a94a6;
  line-height: 1.4;
}

.progress-check {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #16b574;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* ---- Intro section ---- */
.intro-section {
  margin-top: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-dot {
    width: 6px;
    height: 15px;
    border-radius: 30%;
    background: #4b96f3;
    flex-shrink: 0;
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a1f2e;
}

.intro-text {
  display: block;
  margin-top: 12px;
  font-size: 13px;
  color: #5f6b83;
  line-height: 22px;
}

/* ---- 地址/距离按行展示 ---- */
.meta-rows {
  margin-top: 12px;
  background: #ffffff;
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid #f0f3f7;
}
.meta-row {
  display: block;
  padding: 8px 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.03);
}
.meta-row:last-child {
  border-bottom: none;
}
.meta-row.meta-compact {
  border-bottom: none;
  padding: 6px 0;
}
.meta-compact--split {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.meta-compact__left {
  flex: 1;
  min-width: 0;
}
.meta-compact__right {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-left: 12px;
  flex-shrink: 0;
}
.meta-action {
  font-size: 18px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #f4f6fb;
}
.meta-action:active { opacity: 0.8; transform: scale(0.96); }
.meta-action--map { color: #3b82f6 }
.meta-action--phone { color: #16a34a }
.meta-label {
  display: block;
  font-size: 12px;
  color: #8a94a6;
}
.meta-text {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  color: #1a1f2e;
  word-break: break-all;
}

/* 地址显著 */
.meta-address {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: #161925;
}

/* 距离较小且颜色淡 */
.meta-distance {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #98a3b3;
}

/* ---- CTA button ---- */
.cta-area {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 16px 28px;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.cta-btn {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 70%;
  height: 48px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #1a2744, #1f3a5f);
  box-shadow: 0 8px 24px rgba(26, 39, 68, 0.35);
  padding: 0;
}

.cta-btn__icon {
  font-size: 18px;
}

.cta-btn__text {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
}

/* ---- Empty state ---- */
.state {
  padding: 40px 16px;
  text-align: center;
}

.state-title {
  display: block;
  font-size: 14px;
  color: #1a1f2e;
}

/* Badges for scenic detail */
.badge-wrap-detail {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  align-items: center;
}


.badge {
  height: 18px;
  border-radius: 4px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  box-shadow: 0 6px 14px rgba(10, 14, 33, 0.10);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
}


.badge:hover {
  transform: translateY(-1px);
}

.badge-hot {
  background: linear-gradient(90deg, #ff7a6b, #ff3b3b);
}

.badge-hot::before {
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.06) inset;
}

.badge-featured {
  background: linear-gradient(90deg, #fff2b8, #ffd07a);
  color: #1a1f2e;
}

.badge-featured::before {
  background: rgba(255, 255, 255, 0.98);
}
</style>
