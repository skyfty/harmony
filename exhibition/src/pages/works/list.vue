<template>
  <view class="page works-list">
    <view class="header">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索作品名称或描述"
          confirm-type="search"
          @confirm="handleSearch"
        />
        <text v-if="keyword" class="clear-icon" @tap="clearSearch">✕</text>
      </view>
      
      <view class="sort-links">
        <view
          class="sort-link"
          :class="{ active: sortBy === 'latest' }"
          @tap="changeSortBy('latest')"
        >
          <text class="sort-icon">🕒</text>
          <text class="sort-text">最新</text>
        </view>
        <view
          class="sort-link"
          :class="{ active: sortBy === 'best' }"
          @tap="changeSortBy('best')"
        >
          <text class="sort-icon">⭐</text>
          <text class="sort-text">最佳</text>
        </view>
      </view>
    </view>

    <view v-if="loading && works.length === 0" class="state state--loading">
      <text class="state-title">正在加载作品…</text>
    </view>

    <view v-else-if="error && works.length === 0" class="state state--error">
      <text class="state-title">加载失败</text>
      <text class="state-desc">{{ error }}</text>
      <button class="retry-btn" @tap="refresh">重试</button>
    </view>

    <view v-else-if="works.length === 0" class="state state--empty">
      <text class="state-title">暂无作品</text>
      <text class="state-desc">{{ keyword ? '尝试调整搜索关键词' : '还没有作品' }}</text>
    </view>

    <view v-else class="content">
      <view class="works-grid">
        <view
          v-for="work in sortedWorks"
          :key="work.id"
          class="work-card"
          @tap="openDetail(work.id)"
        >
          <view class="work-thumb" :style="{ background: work.background }">
            <image
              v-if="work.thumbnail"
              class="work-image"
              :src="work.thumbnail"
              mode="aspectFill"
            />
            <text v-else class="work-initial">{{ work.initial }}</text>
          </view>
          <view class="work-info">
            <text class="work-title">{{ work.title }}</text>
            <text class="work-meta">{{ work.meta }}</text>
            <view class="work-stats">
              <view class="stat-item">
                <text class="stat-icon stat-icon--star" :class="{ 'is-active': work.userRating > 0 }">★</text>
                <text class="stat-value">{{ formatRating(work.rating) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--heart" :class="{ 'is-active': work.liked }">❤</text>
                <text class="stat-value">{{ work.likes }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading && works.length > 0" class="loading-tip">正在刷新…</view>

    <BottomNav active="work" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { apiGetWorks, type WorkSummary } from '@/api/miniprogram';
import { redirectToNav, type NavKey } from '@/utils/navKey';

interface WorkCard {
  id: string;
  title: string;
  thumbnail?: string;
  initial: string;
  background: string;
  meta: string;
  rating: number;
  ratingCount: number;
  userRating: number;
  likes: number;
  liked: boolean;
}

const loading = ref(false);
const error = ref('');
const keyword = ref('');
const sortBy = ref<'latest' | 'best'>('latest');
const works = ref<WorkSummary[]>([]);

const gradientPalette = [
  'linear-gradient(135deg, #ffe0f2, #ffd0ec)',
  'linear-gradient(135deg, #dff5ff, #c6ebff)',
  'linear-gradient(135deg, #fff0ce, #ffe2a8)',
  'linear-gradient(135deg, #e7e4ff, #f1eeff)',
  'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
  'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
  'linear-gradient(135deg, #b7f5ec, #90e0d9)',
  'linear-gradient(135deg, #ffd59e, #ffe8c9)',
];

const mediaTypeLabels: Record<WorkSummary['mediaType'], string> = {
  image: '图片',
  video: '视频',
  model: '模型',
  other: '其他',
};

onLoad((options?: { sort?: string }) => {
  if (options?.sort === 'best') {
    sortBy.value = 'best';
  } else if (options?.sort === 'latest') {
    sortBy.value = 'latest';
  }
  void fetchWorks();
});

onPullDownRefresh(() => {
  void fetchWorks();
});

const cards = computed<WorkCard[]>(() => {
  return works.value.map((item, index) => ({
    id: item.id,
    title: item.title || '未命名作品',
    thumbnail: item.thumbnailUrl,
    initial: (item.title || 'W').charAt(0).toUpperCase(),
    background: ensureBackground(item.thumbnailUrl, index),
    meta: formatWorkMeta(item),
    rating: item.averageRating ?? 0,
    ratingCount: item.ratingCount ?? 0,
    userRating: item.userRating?.score ?? 0,
    likes: item.likesCount ?? 0,
    liked: item.liked ?? false,
  }));
});

const sortedWorks = computed<WorkCard[]>(() => {
  const result = [...cards.value];
  
  if (sortBy.value === 'best') {
    return result.sort((a, b) => {
      if (b.rating === a.rating) {
        return b.likes - a.likes;
      }
      return b.rating - a.rating;
    });
  } else {
    // Sort by latest (updatedAt)
    return result.sort((a, b) => {
      const aWork = works.value.find(w => w.id === a.id);
      const bWork = works.value.find(w => w.id === b.id);
      if (!aWork || !bWork) return 0;
      return new Date(bWork.updatedAt).getTime() - new Date(aWork.updatedAt).getTime();
    });
  }
});

function ensureBackground(thumbnail: string | undefined, index: number): string {
  if (thumbnail) {
    if (/^https?:/i.test(thumbnail) || thumbnail.startsWith('data:')) {
      return `url(${thumbnail})`;
    }
  }
  const paletteIndex = ((index % gradientPalette.length) + gradientPalette.length) % gradientPalette.length;
  return gradientPalette[paletteIndex];
}

function formatWorkMeta(work: WorkSummary): string {
  const type = mediaTypeLabels[work.mediaType] || '其他';
  const date = new Date(work.createdAt);
  const dateStr = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  return `${type} · ${dateStr}`;
}

function formatRating(rating: number): string {
  return rating > 0 ? rating.toFixed(1) : '0.0';
}

function getErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return '未知错误';
}

async function fetchWorks(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const searchParam = keyword.value.trim() ? { search: keyword.value.trim() } : {};
    const response = await apiGetWorks(searchParam);
    works.value = response.works ?? [];
  } catch (err) {
    error.value = getErrorMessage(err);
    uni.showToast({ title: error.value, icon: 'none' });
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function refresh(): void {
  void fetchWorks();
}

function handleSearch(): void {
  void fetchWorks();
}

function clearSearch(): void {
  keyword.value = '';
  void fetchWorks();
}

function changeSortBy(type: 'latest' | 'best'): void {
  sortBy.value = type;
}

function openDetail(id: string): void {
  if (!id) return;
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
}

function handleNavigate(target: NavKey): void {
  redirectToNav(target, { current: 'work' });
}
</script>

<style scoped lang="scss">
.page {
  padding: 20px 20px calc(96px + env(safe-area-inset-bottom));
  padding-top: 84px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f5f7fb;
  padding-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #ffffff;
  border-radius: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.search-icon {
  font-size: 18px;
  color: #5f6b83;
}

.search-input {
  flex: 1;
  font-size: 15px;
  color: #1a1f2e;
}

.search-input::placeholder {
  color: #a8b0c1;
}

.clear-icon {
  font-size: 16px;
  color: #a8b0c1;
  padding: 4px;
}

.sort-links {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 0 4px;
}

.sort-link {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.sort-link:active {
  transform: scale(0.95);
}

.sort-link.active {
  background: rgba(31, 122, 236, 0.1);
}

.sort-icon {
  font-size: 14px;
  color: #a8b0c1;
  transition: color 0.2s;
}

.sort-link.active .sort-icon {
  color: #1f7aec;
}

.sort-text {
  font-size: 13px;
  color: #5f6b83;
  transition: color 0.2s;
}

.sort-link.active .sort-text {
  color: #1f7aec;
  font-weight: 500;
}

.sort-link.active .sort-text {
  color: #1f7aec;
  font-weight: 500;
}

.state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
}

.state-title {
  font-size: 16px;
  font-weight: 500;
  color: #1a1f2e;
}

.state-desc {
  font-size: 14px;
  color: #5f6b83;
}

.retry-btn {
  margin-top: 12px;
  padding: 10px 24px;
  border-radius: 20px;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 14px;
}

.content {
  flex: 1;
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.work-card {
  background: #ffffff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  transition: transform 0.2s, box-shadow 0.2s;
}

.work-card:active {
  transform: scale(0.98);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.work-thumb {
  position: relative;
  width: 100%;
  padding-bottom: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.work-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.work-initial {
  position: absolute;
  font-size: 48px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.work-info {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.work-title {
  font-size: 14px;
  font-weight: 500;
  color: #1a1f2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work-meta {
  font-size: 11px;
  color: #a8b0c1;
}

.work-stats {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-icon {
  font-size: 13px;
  color: #d0d5dd;
  transition: color 0.2s;
}

.stat-icon--star.is-active {
  color: #ffb340;
}

.stat-icon--heart.is-active {
  color: #ff3b57;
}

.stat-value {
  font-size: 11px;
  color: #5f6b83;
}

.loading-tip {
  text-align: center;
  padding: 20px;
  font-size: 13px;
  color: #a8b0c1;
}
</style>
