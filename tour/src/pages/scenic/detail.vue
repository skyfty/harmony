<template>
  <view class="page">
    <!-- Floating back button -->
    <view
      class="floating-back"
      :style="{ top: (statusBarHeight + 8) + 'px' }"
      @tap="handleBack"
    >
      <text class="floating-back__icon">‹</text>
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

        <view class="comments-section">
          <view class="section-header">
            <view class="section-dot" />
            <text class="section-title">游客留言</text>
          </view>

          <view class="comment-editor">
            <textarea
              v-model="commentContent"
              class="comment-editor__input"
              maxlength="500"
              placeholder="写下你的留言（审核通过后展示）"
            />
            <button class="comment-editor__submit" :disabled="commentSubmitting" @tap="handleSubmitComment">
              {{ commentSubmitting ? '提交中...' : '发布留言' }}
            </button>
          </view>

          <view v-if="commentLoading" class="comments-state">留言加载中...</view>
          <view v-else-if="comments.length === 0" class="comments-state">暂无留言，快来发布第一条吧</view>
          <view v-else class="comment-list">
            <view v-for="item in comments" :key="item.id" class="comment-item">
              <view class="comment-item__meta">
                <text class="comment-item__name">{{ item.userDisplayName || '匿名用户' }}</text>
                <view class="comment-item__right">
                  <text class="comment-item__status">{{ getScenicCommentStatusLabel(item.status) }}</text>
                  <text class="comment-item__time">{{ formatCommentTime(item.createdAt) }}</text>
                  <text v-if="item.canDelete" class="comment-item__delete" @tap="handleDeleteComment(item.id)">删除</text>
                </view>
              </view>
              <text class="comment-item__content">{{ item.content }}</text>
              <text v-if="item.status === 'rejected' && item.rejectReason" class="comment-item__reject">
                驳回原因：{{ item.rejectReason }}
              </text>
            </view>
          </view>
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
import { trackAnalyticsEvent } from '@harmony/utils';
import {
  createScenicComment,
  deleteScenicComment,
  getScenicCommentStatusLabel,
  getScenic,
  listAchievements,
  listScenicComments,
  toggleScenicFavorite,
} from '@/api/mini';
import type { ScenicCheckinProgressItem } from '@/types/achievement';
import type { ScenicComment } from '@/types/comment';
import type { ScenicDetail } from '@/types/scenic';

const scenic = ref<ScenicDetail | null>(null);
const favoriteLoading = ref(false);
const currentSlide = ref(0);
const scenicCheckinProgress = ref<ScenicCheckinProgressItem | null>(null);
const comments = ref<ScenicComment[]>([]);
const commentLoading = ref(false);
const commentSubmitting = ref(false);
const commentContent = ref('');

/* Status bar height for floating back button positioning */
const statusBarHeight = ref(0);
try {
  const sysInfo = uni.getSystemInfoSync();
  statusBarHeight.value = sysInfo?.statusBarHeight ?? 0;
} catch { /* fallback: keep 0 */ }

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
        void loadScenicComments(scenicRes.id);
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
    .catch(() => {
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

function enterScenery() {
  if (!scenic.value) return;
  let vehicleId = '';
  try {
    const selectedVehicleId = uni.getStorageSync('tour:selectedVehicleId');
    if (typeof selectedVehicleId === 'string' && selectedVehicleId) {
      vehicleId = selectedVehicleId;
    }
  } catch {
    // ignore
  }

  const queryParts = [
    `packageUrl=${encodeURIComponent(scenic.value.scene.fileUrl)}`,
    `sceneSpotId=${encodeURIComponent(scenic.value.id)}`,
    `sceneId=${encodeURIComponent(scenic.value.sceneId)}`,
  ];
  if (vehicleId) {
    queryParts.push(`vehicleId=${encodeURIComponent(vehicleId)}`);
  }
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

async function loadScenicComments(scenicId: string): Promise<void> {
  commentLoading.value = true;
  try {
    const response = await listScenicComments(scenicId, { page: 1, pageSize: 30 });
    comments.value = response.items;
  } catch {
    comments.value = [];
  } finally {
    commentLoading.value = false;
  }
}

async function handleSubmitComment(): Promise<void> {
  if (!scenic.value || commentSubmitting.value) {
    return;
  }
  const normalized = commentContent.value.trim();
  if (!normalized) {
    uni.showToast({ title: '请输入留言内容', icon: 'none' });
    return;
  }
  if (normalized.length > 500) {
    uni.showToast({ title: '留言最多500字', icon: 'none' });
    return;
  }

  commentSubmitting.value = true;
  try {
    const created = await createScenicComment(scenic.value.id, normalized);
    commentContent.value = '';
    comments.value = [created, ...comments.value];
    uni.showToast({ title: '留言已提交，待审核', icon: 'none' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  } finally {
    commentSubmitting.value = false;
  }
}

async function handleDeleteComment(commentId: string): Promise<void> {
  if (!scenic.value || !commentId) {
    return;
  }
  try {
    await deleteScenicComment(scenic.value.id, commentId);
    comments.value = comments.value.filter((item) => item.id !== commentId);
    uni.showToast({ title: '删除成功', icon: 'none' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
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

function formatCommentTime(input: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    return input || '-';
  }
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
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
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}

.floating-back__icon {
  font-size: 24px;
  color: #ffffff;
  line-height: 1;
  margin-top: -2px;
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
  font-size: 20px;
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

.comments-section {
  margin-top: 24px;
}

.comment-editor {
  margin-top: 10px;
  padding: 12px;
  background: #f7f9fc;
  border-radius: 14px;
}

.comment-editor__input {
  width: 100%;
  min-height: 96px;
  font-size: 13px;
  color: #1a1f2e;
  background: #ffffff;
  border-radius: 10px;
  padding: 10px;
  box-sizing: border-box;
}

.comment-editor__submit {
  margin-top: 10px;
  width: 120px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: #1f3a5f;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
}

.comment-editor__submit[disabled] {
  opacity: 0.6;
}

.comments-state {
  margin-top: 14px;
  font-size: 12px;
  color: #8a94a6;
}

.comment-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.comment-item {
  background: #ffffff;
  border: 1px solid #edf0f6;
  border-radius: 12px;
  padding: 10px 12px;
}

.comment-item__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.comment-item__name {
  font-size: 13px;
  font-weight: 600;
  color: #1a1f2e;
}

.comment-item__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.comment-item__status,
.comment-item__time,
.comment-item__delete {
  font-size: 11px;
  color: #8a94a6;
}

.comment-item__delete {
  color: #d9534f;
}

.comment-item__content {
  margin-top: 8px;
  display: block;
  font-size: 13px;
  color: #4f5d75;
  line-height: 1.5;
}

.comment-item__reject {
  margin-top: 6px;
  display: block;
  font-size: 11px;
  color: #d9534f;
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
</style>
