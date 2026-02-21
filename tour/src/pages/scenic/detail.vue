<template>
  <view class="page">
    <view v-if="!scenic" class="state">
      <text class="state-title">景区不存在</text>
      <button class="btn" @tap="goBack">返回</button>
    </view>

    <view v-else class="content">
      <ImageSwiper :image-urls="scenic.slides" />

      <view class="card">
        <view class="row">
          <text class="name">{{ scenic.title }}</text>
        </view>
        <text class="summary">{{ scenic.description }}</text>
      </view>

      <view class="card">
        <text class="section">景区介绍</text>
        <text class="desc">{{ scenic.description }}</text>
      </view>

      <view class="card">
        <text class="section">景区信息</text>
        <view class="info-row">
          <text class="label">地址</text>
          <text class="value">{{ scenic.address }}</text>
        </view>
      </view>

      <view class="stats-card">
        <view class="stat stat--action" @tap="openRatingModal">
          <text class="stat-icon">★</text>
          <text class="stat-value">{{ ratingLabel }}</text>
          <text class="stat-desc">评分 ({{ scenic.ratingCount || 0 }})</text>
        </view>
        <view class="stat stat--action" :class="{ 'stat--favorited': scenic.favorited }" @tap="handleToggleFavorite">
          <text class="stat-icon">{{ scenic.favorited ? '❤' : '♡' }}</text>
          <text class="stat-value">{{ scenic.favoriteCount || 0 }}</text>
          <text class="stat-desc">{{ scenic.favorited ? '已收藏' : '收藏' }}</text>
        </view>
        <view class="stat">
          <text class="stat-icon">👤</text>
          <text class="stat-value">{{ scenic.ratingCount || 0 }}</text>
          <text class="stat-desc">评分人数</text>
        </view>
      </view>

      <view class="card">
        <text class="section">评论</text>
        <view class="comments">
          <UserCommentItem
            v-for="c in comments"
            :key="c.id"
            :nickname="c.nickname"
            :time-i-s-o="c.timeISO"
            :content="c.content"
          />
          <view v-if="comments.length === 0" class="empty">暂无评论</view>
        </view>
      </view>

      <view class="cta">
        <button class="enter" @tap="enterScenery">进入景区</button>
      </view>

    </view>
  </view>

  <view v-if="ratingModalVisible" class="rating-modal-mask" @tap="closeRatingModal"></view>
  <view v-if="ratingModalVisible" class="rating-modal-panel" @tap.stop="noop" catchtap="noop">
    <text class="rating-modal__title">为该景区打分</text>
    <view class="rating-modal__stars">
      <view
        v-for="n in 5"
        :key="'star-' + n"
        class="rating-modal__star"
        :data-score="n"
        :class="{ active: n <= ratingSelection }"
        @tap.stop="selectRatingByEvent"
        catchtap="selectRatingByEvent"
      >
        <text :data-score="n">★</text>
      </view>
    </view>
    <view class="rating-modal__actions">
      <button
        class="rating-modal__submit"
        :disabled="ratingSubmitting"
        @tap="submitRating"
      >{{ ratingSubmitting ? '提交中…' : ratingSelection ? `提交 ${ratingSelection} 星` : '请选择星级' }}</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import ImageSwiper from '@/components/ImageSwiper.vue';
import UserCommentItem from '@/components/UserCommentItem.vue';
import { getScenic, rateScenic, toggleScenicFavorite, trackAnalyticsEvent } from '@/api/mini';
import type { ScenicDetail } from '@/types/scenic';

const scenic = ref<ScenicDetail | null>(null);
const comments = ref([]);
const favoriteLoading = ref(false);
const ratingModalVisible = ref(false);
const ratingSubmitting = ref(false);
const ratingSelection = ref(0);

const ratingLabel = computed(() => {
  const v = scenic.value?.averageRating ?? 0;
  if (v <= 0) return '--';
  if (v >= 4.95) return '满分';
  return v.toFixed(v >= 10 ? 0 : 1);
});

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  if (!id) {
    scenic.value = null;
    return;
  }
  void getScenic(id)
    .then((scenicRes) => {
      scenic.value = scenicRes ?? null;
      if (scenicRes) {
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

function goBack() {
  uni.navigateBack();
}

function enterScenery() {
  if (!scenic.value) return;
  uni.navigateTo({
    url: `/pages/scenery/index?packageUrl=${encodeURIComponent(scenic.value.scene.fileUrl)}&sceneSpotId=${encodeURIComponent(scenic.value.id)}&sceneId=${encodeURIComponent(scenic.value.sceneId)}`,
  });
}

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

function openRatingModal(): void {
  if (!scenic.value) return;
  ratingSelection.value = 0;
  ratingModalVisible.value = true;
}

function closeRatingModal(): void {
  ratingModalVisible.value = false;
  ratingSelection.value = 0;
}

function selectRating(n: number): void {
  ratingSelection.value = n;
}

function selectRatingByEvent(event: { currentTarget?: { dataset?: { score?: string | number } }; target?: { dataset?: { score?: string | number } } }): void {
  const scoreRaw = event?.currentTarget?.dataset?.score ?? event?.target?.dataset?.score;
  const score = Number(scoreRaw);
  if (Number.isFinite(score) && score >= 1 && score <= 5) {
    selectRating(score);
  }
}

function noop(): void {}

async function submitRating(): Promise<void> {
  if (!scenic.value || ratingSelection.value === 0) return;
  ratingSubmitting.value = true;
  try {
    const next = await rateScenic(scenic.value.id, ratingSelection.value);
    applyInteractionState(next);
    uni.showToast({ title: '评分成功', icon: 'success' });
    closeRatingModal();
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  } finally {
    ratingSubmitting.value = false;
  }
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

function getErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof (reason as { message: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  if (typeof reason === 'string') return reason;
  return '操作失败，请稍后重试';
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.content {
  padding: 16px;
  padding-bottom: 90px;
}

.card {
  margin-top: 12px;
  background: #ffffff;
  border-radius: 18px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.summary {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: #5f6b83;
  line-height: 18px;
}

.section {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
}

.desc {
  display: block;
  margin-top: 10px;
  font-size: 13px;
  color: #5f6b83;
  line-height: 20px;
}

.info-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.label {
  width: 48px;
  font-size: 12px;
  color: #8a94a6;
}

.value {
  flex: 1;
  font-size: 12px;
  color: #1a1f2e;
}

.comments {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.stats-card {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.stat {
  background: #ffffff;
  border-radius: 18px;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.08);
}

.stat-icon {
  font-size: 18px;
  color: #1f7aec;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #1a1f2e;
}

.stat-desc {
  font-size: 12px;
  color: #8a94a6;
}

.stat--action {
  cursor: pointer;
  transition: all 0.2s;
}

.stat--action:active {
  transform: scale(0.95);
  opacity: 0.8;
}

.stat--favorited {
  background: rgba(31, 122, 236, 0.08);
}

.stat--favorited .stat-icon {
  color: #e74c3c;
}

.rating-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
}

.rating-modal-panel {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 280px;
  background: #ffffff;
  border-radius: 24px;
  padding: 30px 24px 24px;
  box-shadow: 0 24px 48px rgba(31, 122, 236, 0.2);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.rating-modal__title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1f2e;
  text-align: center;
}

.rating-modal__stars {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.rating-modal__star {
  font-size: 36px;
  color: #e3e9f2;
  cursor: pointer;
  transition: all 0.2s;
}

.rating-modal__star.active {
  color: #ffb400;
  transform: scale(1.1);
}

.rating-modal__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rating-modal__submit {
  width: 100%;
  padding: 12px;
  border-radius: 16px;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
}

.rating-modal__submit:disabled {
  opacity: 0.5;
}

.empty {
  padding: 10px 0;
  text-align: center;
  color: #a8b0c1;
  font-size: 12px;
}

.cta {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 16px 20px;
  background: rgba(248, 248, 248, 0.92);
  backdrop-filter: blur(10px);
}

.enter {
  width: 100%;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 14px;
  height: 44px;
  line-height: 44px;
  font-size: 15px;
  font-weight: 700;
}

.state {
  padding: 40px 16px;
  text-align: center;
}

.state-title {
  display: block;
  font-size: 14px;
  color: #1a1f2e;
}

.btn {
  margin-top: 14px;
  width: 160px;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 999px;
  height: 36px;
  line-height: 36px;
  font-size: 13px;
}
</style>
