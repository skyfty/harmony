<template>
  <view class="page exhibition-index">
    <view class="header">
      <view class="header-info">
        <text class="title">我的展览</text>
        <text class="subtitle">共 {{ totalDisplay }} 个展览</text>
      </view>
      <view class="header-actions">
        <button class="create-btn" @tap="goCreate">
          <text class="create-icon">+</text>
        </button>
      </view>
    </view>

    <view v-if="loading && cards.length === 0" class="state state--loading">
      <text class="state-title">正在加载展览…</text>
      <text class="state-desc">请稍候</text>
    </view>

    <view v-else-if="error && cards.length === 0" class="state state--error">
      <text class="state-title">加载失败</text>
      <text class="state-desc">{{ error }}</text>
      <button class="retry-btn" @tap="refresh">重试</button>
    </view>

    <view v-else-if="cards.length === 0" class="state state--empty">
      <text class="state-title">暂未创建展览</text>
      <text class="state-desc">点击右上角按钮创建你的第一个展览</text>
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
          class="exhibition-card"
          @tap="openDetail(card.id)"
        >
          <view class="card-cover" :style="{ background: card.background }">
            <image
              v-if="card.primaryCover"
              class="card-cover__image"
              :src="card.primaryCover"
              mode="aspectFill"
            />
            <view class="card-cover__overlay"></view>
            <view class="card-status" :class="'status-' + card.status">{{ formatStatus(card.status) }}</view>
            <view class="card-count">{{ card.workCount }} 件作品</view>
          </view>
          <view class="card-body">
            <view class="card-header">
              <text class="card-title">{{ card.name }}</text>
              <text class="card-date">{{ card.dateRange || '待定展期' }}</text>
            </view>
            <text class="card-desc">{{ card.description }}</text>
            <view v-if="card.collections.length" class="card-collections">
              <view
                v-for="collection in card.collections.slice(0, 3)"
                :key="collection.id"
                class="collection-chip"
                @tap.stop="openCollection(collection.id)"
              >
                <text class="collection-name">{{ collection.title }}</text>
                <text class="collection-meta">{{ collection.workCount }} 件</text>
              </view>
              <text v-if="card.collections.length > 3" class="collection-more">等 {{ card.collections.length }} 个合集</text>
            </view>
            <view class="card-stats">
              <view class="stat-item">
                <text class="stat-icon stat-icon--star" :class="{ 'is-active': card.rating > 0 || card.userRating > 0 }">★</text>
                <text class="stat-value">{{ formatRating(card.rating) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--heart" :class="{ 'is-active': card.liked }">❤</text>
                <text class="stat-value">{{ formatCount(card.likes) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--visit">👁</text>
                <text class="stat-value">{{ formatCount(card.visitCount) }}</text>
              </view>
            </view>
            <view class="card-actions">
              <button class="action-btn primary" @tap.stop="enterExhibition(card)">进入</button>
              <button class="action-btn" @tap.stop="shareExhibition(card)">分享</button>
              <button
                class="action-btn ghost"
                v-if="card.status !== 'published'"
                @tap.stop="publishExhibition(card)"
              >
                发布
              </button>
              <button
                class="action-btn danger"
                :disabled="card.status !== 'published'"
                @tap.stop="withdrawExhibition(card)"
              >
                撤展
              </button>
              <button class="action-btn ghost" @tap.stop="editExhibition(card.id)">编辑</button>
              <button class="action-btn ghost" @tap.stop="deleteExhibition(card.id)">删除</button>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading && cards.length > 0" class="loading-tip">正在刷新展览…</view>

    <BottomNav active="exhibition" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh, onUnload } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import {
  apiDeleteExhibition,
  apiGetExhibitions,
  apiShareExhibition,
  apiUpdateExhibition,
  apiVisitExhibition,
  apiWithdrawExhibition,
  type ExhibitionSummary,
} from '@/api/miniprogram';
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
  visitCount: number;
  shareCount: number;
  collections: Array<{ id: string; title: string; workCount: number }>;
  updatedAt?: string;
}

const loading = ref(false);
const error = ref('');
const total = ref(0);
const exhibitions = ref<ExhibitionSummary[]>([]);
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

const cards = computed<ExhibitionCard[]>(() =>
  exhibitions.value.map((item, index) => {
    const primaryCover = item.coverUrls && item.coverUrls.length ? item.coverUrls[0] : item.coverUrl;
    return {
      id: item.id,
      name: item.name,
      status: item.status,
      description: item.description || '尚未填写展览介绍。',
      primaryCover,
      background: ensureBackground(primaryCover, index),
      dateRange: formatDateRange(item.startDate, item.endDate),
      workCount: item.workCount ?? (item.works ? item.works.length : 0),
      likes: item.likesCount ?? 0,
      liked: Boolean(item.liked),
      rating: Number(item.averageRating ?? 0),
      ratingCount: item.ratingCount ?? 0,
      userRating: item.userRating?.score ?? 0,
      visitCount: item.visitCount ?? 0,
      shareCount: item.shareCount ?? 0,
      collections: Array.isArray(item.collections)
        ? item.collections.map((collection) => ({
            id: collection.id,
            title: collection.title,
            workCount: collection.workCount ?? 0,
          }))
        : [],
      updatedAt: item.updatedAt,
    };
  }),
);

const columns = computed(() => {
  const count = Math.max(1, columnCount.value);
  const bucket = Array.from({ length: count }, () => [] as ExhibitionCard[]);
  cards.value.forEach((card, index) => {
    bucket[index % count].push(card);
  });
  return bucket;
});

const totalDisplay = computed(() => (total.value > 0 ? total.value : cards.value.length));

const COLUMN_GAP = 12;
const MIN_CARD_WIDTH = 240;
const MAX_COLUMNS = 3;
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
  void fetchExhibitions();
});

onUnload(() => {
  if (resizeHandler) {
    uni.offWindowResize(resizeHandler);
    resizeHandler = null;
  }
});

onPullDownRefresh(() => {
  void fetchExhibitions({ silent: true });
});

function updateColumnCount(windowWidth: number): void {
  const availableWidth = Math.max(windowWidth - PAGE_HORIZONTAL_PADDING, MIN_CARD_WIDTH);
  const estimated = Math.max(1, Math.floor((availableWidth + COLUMN_GAP) / (MIN_CARD_WIDTH + COLUMN_GAP)));
  columnCount.value = Math.min(MAX_COLUMNS, estimated);
}

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
  if (!start && !end) {
    return '';
  }
  const startLabel = start ? formatDate(start) : '';
  const endLabel = end ? formatDate(end) : '';
  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`;
  }
  return startLabel || endLabel;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
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

function formatRating(value: number): string {
  if (value <= 0) {
    return '--';
  }
  if (value >= 4.95) {
    return '满分';
  }
  return value.toFixed(value >= 10 ? 0 : 1);
}

function formatStatus(status: ExhibitionCard['status']): string {
  if (status === 'draft') {
    return '草稿';
  }
  if (status === 'withdrawn') {
    return '已撤展';
  }
  return '已发布';
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

function showModal(options: UniApp.ShowModalOptions): Promise<UniApp.ShowModalRes> {
  return new Promise((resolve) => {
    uni.showModal({
      ...options,
      success: resolve,
      fail: () =>
        resolve({
          confirm: false,
          cancel: true,
          errMsg: 'showModal:fail',
        } as UniApp.ShowModalRes),
    });
  });
}

async function fetchExhibitions(options: { silent?: boolean } = {}): Promise<void> {
  if (loading.value) {
    return;
  }
  loading.value = true;
  error.value = '';
  if (!options.silent) {
    uni.showLoading({ title: '加载中', mask: true });
  }
  try {
    const response = await apiGetExhibitions({ scope: 'mine' });
    exhibitions.value = response.exhibitions ?? [];
    total.value = response.total ?? exhibitions.value.length;
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
  void fetchExhibitions();
}

function goCreate(): void {
  uni.navigateTo({ url: '/pages/exhibition/create/index' });
}

function openDetail(id: string): void {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/exhibition/detail/index?id=${id}` });
}

function editExhibition(id: string): void {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/exhibition/create/index?id=${id}` });
}

function openCollection(id: string): void {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/collections/detail/index?id=${id}` });
}

async function enterExhibition(card: ExhibitionCard): Promise<void> {
  try {
    const result = await apiVisitExhibition(card.id);
    updateExhibitionCache(card.id, { visitCount: result.visitCount });
    uni.navigateTo({ url: `/pages/exhibition/detail/index?id=${card.id}` });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

async function shareExhibition(card: ExhibitionCard): Promise<void> {
  try {
    const result = await apiShareExhibition(card.id);
    updateExhibitionCache(card.id, { shareCount: result.shareCount });
    uni.showToast({ title: '已生成分享链接', icon: 'none' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

async function publishExhibition(card: ExhibitionCard): Promise<void> {
  try {
    const updated = await apiUpdateExhibition(card.id, { status: 'published' });
    applyExhibitionUpdate(updated);
    uni.showToast({ title: '已发布展览', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

async function withdrawExhibition(card: ExhibitionCard): Promise<void> {
  if (card.status !== 'published') {
    return;
  }
  const { confirm } = await showModal({
    title: '确认撤展',
    content: '撤展后将对参观者隐藏，稍后可重新发布。',
    confirmColor: '#d93025',
  });
  if (!confirm) {
    return;
  }
  try {
    const updated = await apiWithdrawExhibition(card.id);
    applyExhibitionUpdate(updated);
    uni.showToast({ title: '已撤展', icon: 'none' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

async function deleteExhibition(id: string): Promise<void> {
  const { confirm } = await showModal({
    title: '删除展览',
    content: '删除后无法恢复，确认继续吗？',
    confirmColor: '#d93025',
  });
  if (!confirm) {
    return;
  }
  try {
    await apiDeleteExhibition(id);
    exhibitions.value = exhibitions.value.filter((item) => item.id !== id);
    uni.showToast({ title: '已删除', icon: 'none' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

function updateExhibitionCache(id: string, patch: Partial<ExhibitionSummary>): void {
  exhibitions.value = exhibitions.value.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function applyExhibitionUpdate(summary: ExhibitionSummary): void {
  const index = exhibitions.value.findIndex((item) => item.id === summary.id);
  if (index >= 0) {
    exhibitions.value.splice(index, 1, summary);
  } else {
    exhibitions.value.unshift(summary);
  }
}

function handleNavigate(target: NavKey) {
  redirectToNav(target, { current: 'exhibition' });
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
  gap: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.header-info {
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

.header-actions {
  display: flex;
  gap: 10px;
}

.create-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 20px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.22);
}

.create-icon {
  color: #ffffff;
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
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
  padding: 6px 16px;
  border-radius: 14px;
  border: none;
  background: rgba(31, 122, 236, 0.14);
  color: #1f7aec;
  font-size: 13px;
}

.waterfall {
  display: flex;
  gap: 12px;
}

.waterfall--single {
  justify-content: center;
}

.waterfall-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.exhibition-card {
  background: #ffffff;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 18px 36px rgba(31, 122, 236, 0.12);
  display: flex;
  flex-direction: column;
}

.card-cover {
  position: relative;
  height: 160px;
  background-size: cover;
  background-position: center;
}

.card-cover__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-cover__overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(16, 29, 66, 0.55), rgba(31, 122, 236, 0.18));
}

.card-status {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.3);
}

.card-status.status-draft {
  background: rgba(255, 175, 66, 0.85);
}

.card-status.status-withdrawn {
  background: rgba(138, 148, 166, 0.85);
}

.card-status.status-published {
  background: rgba(34, 197, 94, 0.85);
}

.card-count {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
  font-size: 12px;
  backdrop-filter: blur(4px);
}

.card-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.card-date {
  font-size: 12px;
  color: #8a94a6;
}

.card-desc {
  font-size: 13px;
  color: #5f6b83;
  line-height: 1.6;
}

.card-collections {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.collection-chip {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  color: #1f1f1f;
  font-size: 12px;
}

.collection-chip:active {
  opacity: 0.8;
}

.collection-name {
  font-weight: 600;
}

.collection-meta {
  color: #8a94a6;
}

.collection-more {
  font-size: 12px;
  color: #8a94a6;
}

.card-stats {
  display: flex;
  gap: 14px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #5f6b83;
}

.stat-icon {
  font-size: 16px;
}

.stat-icon--star {
  color: #ffaf42;
}

.stat-icon--heart {
  color: #ff627d;
}

.stat-icon--visit {
  font-size: 14px;
}

.stat-icon.is-active {
  opacity: 1;
}

.stat-value {
  font-size: 13px;
  color: #1f1f1f;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.action-btn {
  flex: 1;
  min-width: 92px;
  padding: 8px 0;
  border-radius: 16px;
  border: none;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 13px;
}

.action-btn.primary {
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
}

.action-btn.danger {
  background: rgba(217, 48, 37, 0.12);
  color: #d93025;
}

.action-btn.ghost {
  background: rgba(95, 107, 131, 0.08);
  color: #5f6b83;
}

.action-btn[disabled] {
  opacity: 0.5;
}

.loading-tip {
  text-align: center;
  font-size: 12px;
  color: #8a94a6;
}
</style>
