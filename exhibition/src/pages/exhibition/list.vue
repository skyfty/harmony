<template>
  <view class="page exhibition-list">
    <view class="header">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索展览名称或描述"
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

    <view v-if="loading && exhibitions.length === 0" class="state state--loading">
      <text class="state-title">正在加载展览…</text>
    </view>

    <view v-else-if="error && exhibitions.length === 0" class="state state--error">
      <text class="state-title">加载失败</text>
      <text class="state-desc">{{ error }}</text>
      <button class="retry-btn" @tap="refresh">重试</button>
    </view>

    <view v-else-if="exhibitions.length === 0" class="state state--empty">
      <text class="state-title">暂无展览</text>
      <text class="state-desc">{{ keyword ? '尝试调整搜索关键词' : '还没有展览' }}</text>
    </view>

    <view v-else class="content">
      <view class="waterfall">
        <view class="waterfall-column" v-for="(column, colIndex) in waterfallColumns" :key="colIndex">
          <view
            v-for="card in column"
            :key="card.id"
            class="exhibition-card"
            @tap="openDetail(card.id)"
          >
            <view class="card-cover" :style="{ background: card.background, paddingBottom: card.aspectRatio }">
              <image
                v-if="card.primaryCover"
                class="card-cover__image"
                :src="card.primaryCover"
                mode="aspectFill"
              />
              <view class="card-cover__overlay"></view>
              <view class="card-status" :class="'status-' + card.status">{{ formatStatus(card.status) }}</view>
            </view>
            <view class="card-body">
              <text class="card-title">{{ card.name }}</text>
              <text class="card-desc">{{ card.description }}</text>
              <view class="card-meta">
                <text class="meta-item">{{ card.dateRange || '待定展期' }}</text>
                <text class="meta-item">{{ card.workCount }} 件作品</text>
              </view>
              <view class="card-stats">
                <view class="stat-item">
                  <text class="stat-icon stat-icon--star" :class="{ 'is-active': card.userRating > 0 }">★</text>
                  <text class="stat-value">{{ formatRating(card.rating) }}</text>
                </view>
                <view class="stat-item">
                  <text class="stat-icon stat-icon--heart" :class="{ 'is-active': card.liked }">❤</text>
                  <text class="stat-value">{{ card.likes }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading && exhibitions.length > 0" class="loading-tip">正在刷新…</view>

    <BottomNav active="exhibition" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { apiGetExhibitions, type ExhibitionSummary } from '@/api/miniprogram';
import { redirectToNav, type NavKey } from '@/utils/navKey';

interface ExhibitionCard {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'withdrawn';
  description: string;
  primaryCover?: string;
  background: string;
  dateRange: string;
  workCount: number;
  likes: number;
  liked: boolean;
  rating: number;
  ratingCount: number;
  userRating: number;
  aspectRatio: string;
}

const loading = ref(false);
const error = ref('');
const keyword = ref('');
const sortBy = ref<'latest' | 'best'>('latest');
const exhibitions = ref<ExhibitionSummary[]>([]);

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

onLoad((options?: { sort?: string }) => {
  if (options?.sort === 'best') {
    sortBy.value = 'best';
  } else if (options?.sort === 'latest') {
    sortBy.value = 'latest';
  }
  void fetchExhibitions();
});

onPullDownRefresh(() => {
  void fetchExhibitions();
});

const cards = computed<ExhibitionCard[]>(() => {
  const mapped = exhibitions.value.map((item, index) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    description: item.description || '暂无描述',
    primaryCover: item.coverUrls?.[0] || item.coverUrl,
    background: ensureBackground(item.coverUrl, index),
    dateRange: formatDateRange(item.startDate, item.endDate),
    workCount: item.workCount ?? 0,
    likes: item.likesCount ?? 0,
    liked: item.liked ?? false,
    rating: item.averageRating ?? 0,
    ratingCount: item.ratingCount ?? 0,
    userRating: item.userRating?.score ?? 0,
    aspectRatio: '75%',
  }));

  // Sort by selected criteria
  if (sortBy.value === 'best') {
    return mapped.sort((a, b) => {
      if (b.rating === a.rating) {
        return b.likes - a.likes;
      }
      return b.rating - a.rating;
    });
  } else {
    // Sort by latest (updatedAt)
    return mapped.sort((a, b) => {
      const aExhibition = exhibitions.value.find(e => e.id === a.id);
      const bExhibition = exhibitions.value.find(e => e.id === b.id);
      if (!aExhibition || !bExhibition) return 0;
      return new Date(bExhibition.updatedAt).getTime() - new Date(aExhibition.updatedAt).getTime();
    });
  }
});

const waterfallColumns = computed(() => {
  const columnCount = 2;
  const columns: ExhibitionCard[][] = Array.from({ length: columnCount }, () => []);
  const heights: number[] = Array(columnCount).fill(0);

  cards.value.forEach((card) => {
    const minHeightIndex = heights.indexOf(Math.min(...heights));
    columns[minHeightIndex].push(card);
    heights[minHeightIndex] += parseFloat(card.aspectRatio) + 40; // Approximate height
  });

  return columns;
});

function ensureBackground(raw: string | undefined, index: number): string {
  if (raw) {
    if (raw.startsWith('linear-gradient') || raw.startsWith('#') || raw.startsWith('rgb')) {
      return raw;
    }
    if (/^https?:/i.test(raw) || raw.startsWith('data:')) {
      return `url(${raw})`;
    }
  }
  const paletteIndex = ((index % gradientPalette.length) + gradientPalette.length) % gradientPalette.length;
  return gradientPalette[paletteIndex];
}

function formatDateRange(start?: string, end?: string): string {
  if (!start && !end) return '待定展期';
  const formatDate = (d: string) => {
    const date = new Date(d);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };
  if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
  if (start) return `${formatDate(start)} 开始`;
  return `${formatDate(end!)} 结束`;
}

function formatStatus(status: 'draft' | 'published' | 'withdrawn'): string {
  const map: Record<typeof status, string> = {
    draft: '草稿',
    published: '已发布',
    withdrawn: '已撤展',
  };
  return map[status] || status;
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

async function fetchExhibitions(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const response = await apiGetExhibitions({ scope: 'all' });
    exhibitions.value = response.exhibitions ?? [];
    
    // Apply search filter
    if (keyword.value.trim()) {
      const searchLower = keyword.value.trim().toLowerCase();
      exhibitions.value = exhibitions.value.filter(
        (item) =>
          item.name.toLowerCase().includes(searchLower) ||
          (item.description && item.description.toLowerCase().includes(searchLower))
      );
    }
  } catch (err) {
    error.value = getErrorMessage(err);
    uni.showToast({ title: error.value, icon: 'none' });
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function refresh(): void {
  void fetchExhibitions();
}

function handleSearch(): void {
  void fetchExhibitions();
}

function clearSearch(): void {
  keyword.value = '';
  void fetchExhibitions();
}

function changeSortBy(type: 'latest' | 'best'): void {
  sortBy.value = type;
}

function openDetail(id: string): void {
  if (!id) return;
  uni.navigateTo({ url: `/pages/exhibition/detail/index?id=${id}` });
}

function handleNavigate(target: NavKey): void {
  redirectToNav(target, { current: 'exhibition' });
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

.waterfall {
  display: flex;
  gap: 12px;
}

.waterfall-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.exhibition-card {
  background: #ffffff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  transition: transform 0.2s, box-shadow 0.2s;
}

.exhibition-card:active {
  transform: scale(0.98);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.card-cover {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.card-cover__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-cover__overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.15) 100%);
}

.card-status {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  backdrop-filter: blur(8px);
}

.status-draft {
  background: rgba(95, 107, 131, 0.85);
  color: #ffffff;
}

.status-published {
  background: rgba(52, 199, 89, 0.85);
  color: #ffffff;
}

.status-withdrawn {
  background: rgba(217, 48, 37, 0.85);
  color: #ffffff;
}

.card-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-title {
  font-size: 15px;
  font-weight: 500;
  color: #1a1f2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-desc {
  font-size: 12px;
  color: #5f6b83;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
  min-height: 33.6px;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.meta-item {
  font-size: 11px;
  color: #a8b0c1;
}

.card-stats {
  display: flex;
  gap: 16px;
  margin-top: 6px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-icon {
  font-size: 14px;
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
  font-size: 12px;
  color: #5f6b83;
}

.loading-tip {
  text-align: center;
  padding: 20px;
  font-size: 13px;
  color: #a8b0c1;
}
</style>
