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

      <view class="card">
        <text class="section">评分与收藏</text>
        <view class="metrics">
          <view class="metric">
            <text class="metric-value">{{ formatRating(scenic.averageRating) }}</text>
            <text class="metric-label">综合评分</text>
          </view>
          <view class="metric">
            <text class="metric-value">{{ scenic.ratingCount }}</text>
            <text class="metric-label">评分人数</text>
          </view>
          <view class="metric">
            <text class="metric-value">{{ scenic.favoriteCount }}</text>
            <text class="metric-label">收藏次数</text>
          </view>
        </view>
        <view class="my-rating">
          <text class="my-rating-label">我的评分</text>
          <view class="stars">
            <text
              v-for="star in 5"
              :key="star"
              class="star"
              :class="{ active: star <= (scenic.userRating || 0), disabled: ratingLoading }"
              @tap="handleRate(star)"
            >
              {{ star <= (scenic.userRating || 0) ? '★' : '☆' }}
            </text>
          </view>
        </view>
        <button class="favorite-btn" :class="{ active: scenic.favorited }" :disabled="favoriteLoading" @tap="handleToggleFavorite">
          {{ scenic.favorited ? '已收藏' : '收藏景区' }}
        </button>
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
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { HttpError } from '@/api/http';
import ImageSwiper from '@/components/ImageSwiper.vue';
import UserCommentItem from '@/components/UserCommentItem.vue';
import { ensureDevLogin, getAccessToken, getScenic, rateScenic, setAccessToken, toggleScenicFavorite } from '@/api/mini';
import { listCommentsByScenic } from '@/mocks/comments';
import type { ScenicDetail } from '@/types/scenic';

const scenic = ref<ScenicDetail | null>(null);
const comments = ref(listCommentsByScenic(''));
const favoriteLoading = ref(false);
const ratingLoading = ref(false);

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  comments.value = id ? listCommentsByScenic(id) : [];
  if (!id) {
    scenic.value = null;
    return;
  }
  void getScenic(id)
    .then((scenicRes) => {
      scenic.value = scenicRes ?? null;
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
    url: `/pages/scenery/index?packageUrl=${encodeURIComponent(scenic.value.scene.fileUrl)}`,
  });
}

function formatRating(score: number) {
  return Number.isFinite(score) ? score.toFixed(1) : '0.0';
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

async function ensureActionLogin(): Promise<boolean> {
  if (getAccessToken()) {
    return true;
  }

  const token = await ensureDevLogin();
  if (token) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '请先登录',
      content: '登录后可进行评分和收藏操作',
      confirmText: '去个人中心',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          uni.navigateTo({ url: '/pages/profile/index' });
        }
        resolve(false);
      },
      fail: () => resolve(false),
    });
  });
}

function handleInteractionError(err: unknown) {
  if (err instanceof HttpError && err.status === 401) {
    setAccessToken('');
    uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
    return;
  }
  uni.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
}

async function handleToggleFavorite() {
  if (!scenic.value || favoriteLoading.value) return;
  const ok = await ensureActionLogin();
  if (!ok) return;

  favoriteLoading.value = true;
  try {
    const next = await toggleScenicFavorite(scenic.value.id);
    applyInteractionState(next);
  } catch (err) {
    handleInteractionError(err);
  } finally {
    favoriteLoading.value = false;
  }
}

async function handleRate(score: number) {
  if (!scenic.value || ratingLoading.value) return;
  const ok = await ensureActionLogin();
  if (!ok) return;

  ratingLoading.value = true;
  try {
    const next = await rateScenic(scenic.value.id, score);
    applyInteractionState(next);
    uni.showToast({ title: '评分成功', icon: 'none' });
  } catch (err) {
    handleInteractionError(err);
  } finally {
    ratingLoading.value = false;
  }
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

.metrics {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.metric {
  background: #f4f7fc;
  border-radius: 12px;
  padding: 10px 8px;
  text-align: center;
}

.metric-value {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.metric-label {
  margin-top: 4px;
  display: block;
  font-size: 11px;
  color: #8a94a6;
}

.my-rating {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.my-rating-label {
  font-size: 12px;
  color: #5f6b83;
}

.stars {
  display: flex;
  align-items: center;
  gap: 6px;
}

.star {
  font-size: 20px;
  color: #d9dfeb;
}

.star.active {
  color: #ffb340;
}

.star.disabled {
  opacity: 0.55;
}

.favorite-btn {
  margin-top: 12px;
  width: 100%;
  height: 38px;
  line-height: 38px;
  border-radius: 12px;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 13px;
  font-weight: 700;
}

.favorite-btn.active {
  background: #1f7aec;
  color: #ffffff;
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
