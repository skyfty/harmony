<template>
  <view class="page works-index">
    <view class="header">
      <view class="header-text">
        <text class="title">作品库</text>
        <text class="subtitle">{{ subtitleText }}</text>
      </view>
    </view>

    <view class="collection-filter" v-if="collectionOptions.length > 1">
      <scroll-view scroll-x class="filter-scroll" show-scrollbar="false">
        <view
          v-for="option in collectionOptions"
          :key="option.id"
          class="filter-chip"
          :class="{ active: activeCollection === option.id }"
          @tap="setActiveCollection(option.id)"
        >
          {{ option.title }} ({{ option.count }})
        </view>
      </scroll-view>
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
      <text class="state-title">暂无作品</text>
      <text class="state-desc">上传作品后会显示在这里</text>
    </view>

    <view v-else class="waterfall" :class="{ 'waterfall--single': columnCount === 1 }">
      <view
        v-for="(column, columnIndex) in columns"
        :key="columnIndex"
        class="waterfall-column"
        :style="{ width: columnWidth }"
      >
        <view v-for="card in column" :key="card.id" class="work-card">
          <view class="card-cover" :style="{ background: card.background }" @tap="openDetail(card.id)">
            <image
              v-if="card.thumbnail"
              class="card-cover__image"
              :src="card.thumbnail"
              mode="aspectFill"
            />
            <view v-else class="card-cover__placeholder">
              <text>{{ card.mediaTypeLabel }}</text>
            </view>
            <view class="card-cover__badge">{{ card.sizeLabel }}</view>
          </view>
          <view class="card-body">
            <text class="card-title" @tap="openDetail(card.id)">{{ card.title }}</text>
            <text class="card-desc">{{ card.description }}</text>
            <view class="card-meta">
              <text class="card-meta__item">更新 {{ card.updatedLabel }}</text>
              <text class="card-meta__item">{{ card.collectionsLabel }}</text>
            </view>
            <view class="card-stats">
              <view class="stat-item">
                <text class="stat-icon stat-icon--star" :class="{ 'is-active': card.rating > 0 || card.userRating > 0 }">★</text>
                <text class="stat-value">{{ formatRatingValue(card.rating) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--heart" :class="{ 'is-active': card.liked }">❤</text>
                <text class="stat-value">{{ formatCount(card.likes) }}</text>
              </view>
              <button
                class="delete-btn"
                :disabled="deletingId === card.id"
                @tap.stop="confirmDelete(card.id, card.title)"
              >
                {{ deletingId === card.id ? '删除中…' : '删除' }}
              </button>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading && cards.length > 0" class="loading-tip">正在同步最新作品…</view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh, onUnload } from '@dcloudio/uni-app';
import {
  apiDeleteWork,
  apiGetCollections,
  apiGetWorks,
  type CollectionSummary,
  type WorkSummary,
} from '@/api/miniprogram';

interface WorkCard {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  background: string;
  sizeLabel: string;
  updatedLabel: string;
  collectionsLabel: string;
  likes: number;
  liked: boolean;
  rating: number;
  userRating: number;
  mediaType: WorkSummary['mediaType'];
  mediaTypeLabel: string;
}

interface CollectionOption {
  id: string;
  title: string;
  count: number;
}

const loading = ref(false);
const error = ref('');
const total = ref(0);
const works = ref<WorkSummary[]>([]);
const collections = ref<CollectionSummary[]>([]);
const activeCollection = ref<string>('all');
const columnCount = ref(1);
const deletingId = ref<string>('');

const gradientPalette = [
  'linear-gradient(135deg, #dff5ff, #c6ebff)',
  'linear-gradient(135deg, #ffe0f2, #ffd0ec)',
  'linear-gradient(135deg, #fff0ce, #ffe2a8)',
  'linear-gradient(135deg, #e7e4ff, #f1eeff)',
  'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
  'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
  'linear-gradient(135deg, #b7f5ec, #90e0d9)',
  'linear-gradient(135deg, #ffd59e, #ffe8c9)'
];

const totalDisplay = computed(() => (total.value > 0 ? total.value : works.value.length));

const collectionOptions = computed<CollectionOption[]>(() => {
  const options: CollectionOption[] = [
    {
      id: 'all',
      title: '全部',
      count: totalDisplay.value,
    },
  ];
  collections.value.forEach((collection) => {
    options.push({
      id: collection.id,
      title: collection.title || '未命名合集',
      count: collection.workCount ?? collection.works?.length ?? 0,
    });
  });
  return options;
});

const filteredWorks = computed(() => {
  if (activeCollection.value === 'all') {
    return works.value;
  }
  return works.value.filter((item) => item.collections?.some((collection) => collection.id === activeCollection.value));
});

const cards = computed<WorkCard[]>(() =>
  filteredWorks.value.map((item, index) => ({
    id: item.id,
    title: item.title || '未命名作品',
    description: item.description || '暂无描述',
    thumbnail: extractCssImage(item.thumbnailUrl || item.fileUrl),
    background: ensureBackground(item.thumbnailUrl, index),
    sizeLabel: formatFileSize(item.size),
    updatedLabel: formatRelativeTime(item.updatedAt || item.createdAt),
    collectionsLabel: formatCollectionsLabel(item.collections),
    likes: Number(item.likesCount ?? 0),
    liked: Boolean(item.liked),
    rating: Number(item.averageRating ?? 0),
    userRating: item.userRating?.score ?? 0,
    mediaType: item.mediaType ?? 'other',
    mediaTypeLabel: formatMediaType(item.mediaType),
  }))
);

const filteredCount = computed(() => cards.value.length);
const subtitleText = computed(() => {
  if (activeCollection.value === 'all') {
    return `共 ${totalDisplay.value} 个作品`;
  }
  const option = collectionOptions.value.find((entry) => entry.id === activeCollection.value);
  return `${option?.title ?? '筛选'}：${filteredCount.value} 个（总计 ${totalDisplay.value}）`;
});

const columns = computed(() => {
  const count = Math.max(1, columnCount.value);
  const bucket = Array.from({ length: count }, () => [] as WorkCard[]);
  cards.value.forEach((card, index) => {
    bucket[index % count].push(card);
  });
  return bucket;
});

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
  void fetchWorks();
});

onUnload(() => {
  if (resizeHandler) {
    uni.offWindowResize(resizeHandler);
    resizeHandler = null;
  }
});

onPullDownRefresh(() => {
  void fetchWorks({ silent: true });
});

function updateColumnCount(windowWidth: number): void {
  const availableWidth = Math.max(windowWidth - PAGE_HORIZONTAL_PADDING, MIN_CARD_WIDTH);
  const estimated = Math.max(1, Math.floor((availableWidth + COLUMN_GAP) / (MIN_CARD_WIDTH + COLUMN_GAP)));
  columnCount.value = Math.min(MAX_COLUMNS, estimated);
}

function extractCssImage(value?: string | null): string {
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

function ensureBackground(raw: string | undefined | null, index: number): string {
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

function formatCollectionsLabel(list: WorkSummary['collections']): string {
  if (!list?.length) {
    return '未加入合集';
  }
  if (list.length === 1) {
    return list[0].title || '未命名合集';
  }
  return `${list.length} 个合集`;
}

function formatMediaType(type?: WorkSummary['mediaType']): string {
  switch (type) {
    case 'image':
      return '图片';
    case 'video':
      return '视频';
    case 'model':
      return '模型';
    case 'other':
      return '其他';
    default:
      return '作品';
  }
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return '未知大小';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)}${units[unitIndex]}`;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) {
    return '未知时间';
  }
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return '未知时间';
  }
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    return '刚刚';
  }
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return '刚刚';
  }
  if (diff < hour) {
    const minutes = Math.floor(diff / minute);
    return `${minutes} 分钟前`;
  }
  if (diff < day) {
    const hours = Math.floor(diff / hour);
    return `${hours} 小时前`;
  }
  const days = Math.floor(diff / day);
  if (days < 7) {
    return `${days} 天前`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 4) {
    return `${weeks} 周前`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} 个月前`;
  }
  const years = Math.floor(days / 365);
  return `${years} 年前`;
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

async function fetchWorks(options: { silent?: boolean } = {}): Promise<void> {
  if (loading.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  if (!options.silent) {
    uni.showLoading({ title: '加载中', mask: true });
  }
  try {
    const [worksResponse, collectionsResponse] = await Promise.all([apiGetWorks(), apiGetCollections()]);
    works.value = worksResponse.works ?? [];
    total.value = worksResponse.total ?? works.value.length;
    collections.value = collectionsResponse.collections ?? [];
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
  void fetchWorks();
}

function openDetail(id: string): void {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
}

function confirmDelete(id: string, title: string): void {
  if (!id || deletingId.value) {
    return;
  }
  uni.showModal({
    title: '删除作品',
    content: `确定删除作品“${title || '未命名作品'}”吗？`,
    confirmColor: '#d93025',
    success: (result) => {
      if (result.confirm) {
        void deleteWork(id);
      }
    },
  });
}

async function deleteWork(id: string): Promise<void> {
  deletingId.value = id;
  uni.showLoading({ title: '删除中', mask: true });
  try {
    await apiDeleteWork(id);
    works.value = works.value.filter((item) => item.id !== id);
    total.value = Math.max(0, total.value - 1);
    uni.showToast({ title: '已删除', icon: 'none' });
  } catch (err) {
    const message = getErrorMessage(err);
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    deletingId.value = '';
    uni.hideLoading();
  }
}

function setActiveCollection(id: string): void {
  if (activeCollection.value === id) {
    return;
  }
  activeCollection.value = id;
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

.collection-filter {
  background: #ffffff;
  border-radius: 16px;
  padding: 10px 12px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.06);
}

.filter-scroll {
  display: flex;
  flex-direction: row;
  gap: 8px;
  padding-bottom: 4px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 16px;
  background: rgba(31, 122, 236, 0.08);
  font-size: 13px;
  color: #4b566b;
  white-space: nowrap;
}

.filter-chip.active {
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  box-shadow: 0 8px 20px rgba(31, 122, 236, 0.2);
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

.work-card {
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.card-cover {
  position: relative;
  height: 180px;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
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
  font-size: 13px;
  letter-spacing: 2px;
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
  padding: 16px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 11px;
  color: #8a94a6;
}

.card-meta__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.card-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
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

.delete-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 12px;
  background: rgba(217, 48, 37, 0.85);
  color: #ffffff;
  font-size: 12px;
}

.delete-btn[disabled] {
  opacity: 0.7;
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
