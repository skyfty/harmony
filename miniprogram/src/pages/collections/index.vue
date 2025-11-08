<template>
  <view class="page collections-index">
    <view class="header">
      <view class="header-text">
        <text class="title">我的作品集</text>
        <text class="subtitle">共 {{ totalDisplay }} 个作品集</text>
      </view>
    </view>

    <view v-if="loading && cards.length === 0" class="state state--loading">
      <text class="state-title">加载中…</text>
    </view>

    <view v-else-if="error && cards.length === 0" class="state state--error">
      <text class="state-title">加载失败</text>
      <text class="state-desc">{{ error }}</text>
      <button class="retry-btn" @tap="refresh">重试</button>
    </view>

    <view v-else-if="cards.length === 0" class="state state--empty">
      <text class="state-title">暂无作品集</text>
      <text class="state-desc">去创作一个新的作品集吧</text>
    </view>

    <view v-else class="waterfall" :class="{ 'waterfall--single': columnCount === 1 }">
      <view
        v-for="(column, columnIndex) in columns"
        :key="columnIndex"
        class="waterfall-column"
        :style="{ width: columnWidth }"
      >
        <view
          v-for="card in column"
          :key="card.id"
          class="collection-card"
          @tap="openCollection(card.id)"
        >
          <view class="card-cover" :style="{ background: card.background }">
            <image
              v-if="card.coverImage"
              class="card-cover__image"
              :src="card.coverImage"
              mode="aspectFill"
            />
            <view v-else class="card-cover__placeholder">
              <text>暂无封面</text>
            </view>
            <view class="card-cover__badge">{{ card.workCount }} 个作品</view>
          </view>
          <view class="card-body">
            <text class="card-title">{{ card.title }}</text>
            <text class="card-desc">{{ card.description }}</text>
            <view class="card-stats">
              <view class="stat-item">
                <text class="stat-icon stat-icon--star" :class="{ 'is-active': card.rating > 0 || card.userRating > 0 }">★</text>
                <text class="stat-value">{{ formatRatingValue(card.rating) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--heart" :class="{ 'is-active': card.liked }">❤</text>
                <text class="stat-value">{{ formatCount(card.likes) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading && cards.length > 0" class="loading-tip">正在加载最新数据…</view>

    <BottomNav active="work" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh, onUnload } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { apiGetCollections, type CollectionSummary } from '@/api/miniprogram';
import { redirectToNav, type NavKey } from '@/utils/navKey';

interface CollectionCard {
  id: string;
  title: string;
  description: string;
  workCount: number;
  coverImage: string;
  background: string;
  rating: number;
  likes: number;
  liked: boolean;
  userRating: number;
}

const loading = ref(false);
const error = ref('');
const total = ref(0);
const collections = ref<CollectionSummary[]>([]);
const columnCount = ref(1);

const gradientPalette = [
  'linear-gradient(135deg, #ffe0f2, #ffd0ec)',
  'linear-gradient(135deg, #dff5ff, #c6ebff)',
  'linear-gradient(135deg, #fff0ce, #ffe2a8)',
  'linear-gradient(135deg, #e7e4ff, #f1eeff)',
  'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
  'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
  'linear-gradient(135deg, #b7f5ec, #90e0d9)',
  'linear-gradient(135deg, #ffd59e, #ffe8c9)'
];

const cards = computed<CollectionCard[]>(() =>
  collections.value.map((item, index) => ({
    id: item.id,
    title: item.title || '未命名作品集',
    description: item.description || '尚未填写描述',
    workCount: item.workCount ?? (item.works ? item.works.length : 0),
    coverImage: extractCssImage(item.coverUrl),
    background: ensureBackground(item.coverUrl, index),
    rating: Number(item.averageRating ?? 0),
    likes: Number(item.likesCount ?? 0),
    liked: Boolean(item.liked),
    userRating: item.userRating?.score ?? 0,
  }))
);

const columns = computed(() => {
  const count = Math.max(1, columnCount.value);
  const bucket = Array.from({ length: count }, () => [] as CollectionCard[]);
  cards.value.forEach((card, index) => {
    bucket[index % count].push(card);
  });
  return bucket;
});

const totalDisplay = computed(() => (total.value > 0 ? total.value : cards.value.length));

const COLUMN_GAP = 12;
const MIN_CARD_WIDTH = 220;
const MAX_COLUMNS = 4;
const PAGE_HORIZONTAL_PADDING = 40;
const columnWidth = computed(() => {
  const count = Math.max(1, columnCount.value);
  const gapTotal = (count - 1) * COLUMN_GAP;
  return `calc((100% - ${gapTotal}px) / ${count})`;
});

type WindowResizeCallback = (result: { size: { windowWidth: number; windowHeight: number } }) => void;
let resizeHandler: WindowResizeCallback | null = null;

onLoad(() => {
  uni.getSystemInfo({
    success: ({ windowWidth }) => updateColumnCount(windowWidth),
    fail: () => updateColumnCount(375),
  });
  resizeHandler = (result) => updateColumnCount(result.size.windowWidth);
  uni.onWindowResize(resizeHandler);
  void fetchCollections();
});

onUnload(() => {
  if (resizeHandler) {
    uni.offWindowResize(resizeHandler);
    resizeHandler = null;
  }
});

onPullDownRefresh(() => {
  void fetchCollections({ silent: true });
});

function updateColumnCount(windowWidth: number): void {
  const availableWidth = Math.max(windowWidth - PAGE_HORIZONTAL_PADDING, MIN_CARD_WIDTH);
  const estimated = Math.max(1, Math.floor((availableWidth + COLUMN_GAP) / (MIN_CARD_WIDTH + COLUMN_GAP)));
  columnCount.value = Math.min(MAX_COLUMNS, estimated);
}

function extractCssImage(value?: string): string {
  if (!value) {
    return '';
  }
  const match = value.match(/^url\((.*)\)$/i);
  if (match && match[1]) {
    return match[1].replace(/^["']|["']$/g, '');
  }
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) {
    return value;
  }
  return '';
}

function ensureBackground(raw: string | undefined, index: number): string {
  if (raw) {
    if (raw.startsWith('linear-gradient')) {
      return raw;
    }
    if (raw.startsWith('#') || raw.startsWith('rgb')) {
      return raw;
    }
  }
  const normalizedIndex = Number.isFinite(index) ? index : 0;
  const paletteIndex = ((normalizedIndex % gradientPalette.length) + gradientPalette.length) % gradientPalette.length;
  return gradientPalette[paletteIndex];
}

function getErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof (reason as { message: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  if (typeof reason === 'string') {
    return reason;
  }
  return '加载失败，请稍后重试';
}

async function fetchCollections(options: { silent?: boolean } = {}): Promise<void> {
  if (loading.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  if (!options.silent) {
    uni.showLoading({ title: '加载中', mask: true });
  }
  try {
    const response = await apiGetCollections();
    collections.value = response.collections ?? [];
    total.value = response.total ?? collections.value.length;
  } catch (err) {
    error.value = getErrorMessage(err);
    if (!options.silent) {
      uni.showToast({ title: error.value, icon: 'none' });
    }
  } finally {
    loading.value = false;
    if (!options.silent) {
      uni.hideLoading();
    }
    uni.stopPullDownRefresh();
  }
}

function refresh(): void {
  void fetchCollections();
}

function openCollection(id: string): void {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/collections/detail/index?id=${id}` });
}

function formatRatingValue(value: number): string {
  if (value <= 0) {
    return '--';
  }
  if (value >= 4.95) {
    return '满分';
  }
  return value.toFixed(value >= 10 ? 0 : 1);
}

function formatCount(value: number): string {
  if (value <= 0) {
    return '0';
  }
  if (value >= 1000) {
    const normalized = value / 1000;
    return `${normalized.toFixed(normalized >= 10 ? 0 : 1)}K`;
  }
  return value.toString();
}

function handleNavigate(target: NavKey): void {
  redirectToNav(target, { current: 'work' });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 120px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 13px;
  color: #8a94a6;
}

.state {
  margin-top: 40px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  text-align: center;
  color: #8a94a6;
}

.state-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.state-desc {
  font-size: 13px;
  color: #8a94a6;
}

.retry-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 13px;
}

.waterfall {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.waterfall--single {
  justify-content: center;
}

.waterfall-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 0 0 auto;
}

.collection-card {
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.card-cover {
  position: relative;
  height: 180px;
  overflow: hidden;
  background: linear-gradient(135deg, #d8e7ff, #bfd8ff);
}

.card-cover__image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.card-cover__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.88);
  font-size: 12px;
}

.card-cover__badge {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.35);
  color: #ffffff;
  font-size: 11px;
}

.card-body {
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.card-desc {
  font-size: 12px;
  color: #5f6b83;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.card-stats {
  display: flex;
  gap: 10px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 10px;
  background: rgba(31, 122, 236, 0.08);
}

.stat-icon {
  font-size: 12px;
  color: #c1c7d4;
  transition: color 0.2s ease;
}

.stat-icon--star.is-active {
  color: #ffb400;
}

.stat-icon--heart.is-active {
  color: #ff3f6e;
}

.stat-value {
  font-size: 12px;
  color: #1f1f1f;
}

.loading-tip {
  margin-top: 12px;
  font-size: 12px;
  color: #8a94a6;
  text-align: center;
}

@media screen and (max-width: 420px) {
  .waterfall {
    flex-direction: column;
  }

  .waterfall-column {
    width: 100% !important;
  }
}
</style>
