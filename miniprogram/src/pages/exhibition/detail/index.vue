<template>
  <view class="page exhibition-detail">
    <view class="header">
      <view class="header-title">
        <text class="title">{{ exhibition?.name || '展览详情' }}</text>
        <view v-if="exhibition" class="status-badge" :class="'status-' + exhibition.status">{{ statusLabel }}</view>
      </view>
      <view class="header-meta">
        <text class="subtitle">{{ dateRangeLabel }}</text>
        <text class="subtitle">更新时间 {{ updatedLabel }}</text>
      </view>
    </view>

    <view v-if="loading" class="state state--loading">
      <text class="state-text">正在加载展览信息…</text>
    </view>

    <view v-else-if="error" class="state state--error">
      <text class="state-text">{{ error }}</text>
      <button class="retry-btn" @tap="fetchDetail">重试</button>
    </view>

    <view v-else-if="exhibition" class="content">
      <view class="cover">
        <swiper v-if="coverImages.length > 1" :indicator-dots="true" class="cover-swiper">
          <swiper-item v-for="image in coverImages" :key="image">
            <image class="cover-image" :src="image" mode="aspectFill" />
          </swiper-item>
        </swiper>
        <view v-else class="cover-single" :style="{ background: coverBackground }">
          <image v-if="coverImages.length === 1" class="cover-image" :src="coverImages[0]" mode="aspectFill" />
          <view class="cover-placeholder" v-else>
            <text>暂无封面</text>
          </view>
        </view>
      </view>

      <view class="action-buttons" :class="{ 'buttons-even': !isOwner }">
        <view class="action-btn-icon" @tap="enterExhibition">
          <text class="icon">▶️</text>
          <text class="label">进入</text>
        </view>
        <view class="action-btn-icon" @tap="shareExhibition">
          <text class="icon">🔗</text>
          <text class="label">分享</text>
        </view>
        <view
          v-if="isOwner && exhibition.status === 'published'"
          class="action-btn-icon"
          @tap="withdrawExhibition"
        >
          <text class="icon">📥</text>
          <text class="label">撤展</text>
        </view>
        <view v-if="isOwner" class="action-btn-icon" @tap="editExhibition">
          <text class="icon">✏️</text>
          <text class="label">编辑</text>
        </view>
        <view v-if="isOwner" class="action-btn-icon danger" @tap="deleteExhibition">
          <text class="icon">🗑️</text>
          <text class="label">删除</text>
        </view>
      </view>

      <view class="stats-card">
        <view class="stat stat--action" @tap="openExhibitionRatingModal">
          <text class="stat-icon">★</text>
          <text class="stat-value">{{ ratingLabel }}</text>
          <text class="stat-desc">评分 ({{ exhibition.ratingCount || 0 }})</text>
        </view>
        <view class="stat">
          <text class="stat-icon">👁</text>
          <text class="stat-value">{{ formatCount(exhibition.visitCount || 0) }}</text>
          <text class="stat-desc">参观人次</text>
        </view>
        <view class="stat">
          <text class="stat-icon">🎨</text>
          <text class="stat-value">{{ exhibition.workCount || 0 }}</text>
          <text class="stat-desc">展品数量</text>
        </view>
      </view>

      <view class="segment">
        <text class="segment-title">展览简介</text>
        <text class="segment-desc">{{ exhibition.description || '尚未填写展览介绍。' }}</text>
      </view>

      <view v-if="exhibition.collections && exhibition.collections.length" class="segment">
        <text class="segment-title">关联作品集</text>
        <view class="collection-list">
          <view
            v-for="collection in exhibition.collections"
            :key="collection.id"
            class="collection-item"
            @tap="openCollection(collection.id)"
          >
            <text class="collection-name">{{ collection.title }}</text>
            <text class="collection-meta">{{ collection.workCount }} 件作品</text>
          </view>
        </view>
      </view>

      <view v-if="exhibition.works && exhibition.works.length" class="segment">
        <text class="segment-title">展出作品</text>
        <view class="work-list">
          <view
            v-for="work in exhibition.works"
            :key="work.id"
            class="work-item"
            @tap="openWork(work.id)"
          >
            <image class="work-thumb" :src="work.thumbnailUrl || work.fileUrl" mode="aspectFill" />
            <view class="work-info">
              <text class="work-name">{{ work.title || '未命名作品' }}</text>
              <text class="work-meta">{{ formatWorkMeta(work) }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-else class="state state--empty">
      <text class="state-text">未找到展览信息</text>
    </view>
    <BottomNav active="exhibition" @navigate="handleNavigate" />
  </view>

  <view v-if="ratingModalVisible" class="rating-modal-mask" @tap="closeExhibitionRatingModal"></view>
  <view v-if="ratingModalVisible" class="rating-modal-panel" @tap.stop>
    <text class="rating-modal__title">为该展览打分</text>
    <view class="rating-modal__stars">
      <text
        v-for="n in 5"
        :key="n"
        class="rating-modal__star"
        :class="{ active: n <= ratingSelection }"
        @tap="selectExhibitionRating(n)"
      >★</text>
    </view>
    <view class="rating-modal__actions">
      <button
        class="rating-modal__submit"
        :disabled="ratingSubmitting"
        @tap="submitExhibitionRating"
      >{{ ratingSubmitting ? '提交中…' : ratingSelection ? `提交 ${ratingSelection} 星` : '请选择星级' }}</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import {
  apiDeleteExhibition,
  apiGetExhibition,
  apiGetProfile,
  apiRateExhibition,
  apiShareExhibition,
  apiUpdateExhibition,
  apiVisitExhibition,
  apiWithdrawExhibition,
  type ExhibitionSummary,
  type WorkSummary,
} from '@/api/miniprogram';
import BottomNav from '@/components/BottomNav.vue';
import { redirectToNav, type NavKey } from '@/utils/navKey';

const exhibitionId = ref('');
const exhibition = ref<ExhibitionSummary | null>(null);
const loading = ref(false);
const error = ref('');
const ratingModalVisible = ref(false);
const ratingSubmitting = ref(false);
const ratingSelection = ref(0);
const currentUserId = ref<string>('');

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

const coverImages = computed(() => {
  if (!exhibition.value) {
    return [] as string[];
  }
  if (exhibition.value.coverUrls && exhibition.value.coverUrls.length) {
    return exhibition.value.coverUrls.filter((item) => typeof item === 'string' && item.length > 0);
  }
  if (exhibition.value.coverUrl) {
    return [exhibition.value.coverUrl];
  }
  if (Array.isArray(exhibition.value.works)) {
    const urls = exhibition.value.works
      .map((work) => work.thumbnailUrl || work.fileUrl)
      .filter((url): url is string => Boolean(url));
    return urls.slice(0, 5);
  }
  return [];
});

const coverBackground = computed(() => ensureBackground(coverImages.value[0], 0));

const isOwner = computed(() => {
  if (!exhibition.value || !currentUserId.value) {
    return false;
  }
  return exhibition.value.ownerId === currentUserId.value;
});

const statusLabel = computed(() => {
  if (!exhibition.value) {
    return '未知状态';
  }
  if (exhibition.value.status === 'draft') {
    return '草稿';
  }
  if (exhibition.value.status === 'withdrawn') {
    return '已撤展';
  }
  return '已发布';
});

const dateRangeLabel = computed(() => formatDateRange(exhibition.value?.startDate, exhibition.value?.endDate));
const updatedLabel = computed(() => formatDateLabel(exhibition.value?.updatedAt || exhibition.value?.createdAt));
const ratingLabel = computed(() => formatRating(exhibition.value?.averageRating ?? 0));

onLoad(async (options) => {
  exhibitionId.value = typeof options?.id === 'string' ? decodeURIComponent(options.id) : '';
  await Promise.all([fetchDetail(), fetchCurrentUser()]);
});

async function fetchCurrentUser(): Promise<void> {
  try {
    const profile = await apiGetProfile();
    currentUserId.value = profile.user.id;
  } catch (err) {
    console.warn('Failed to fetch current user', err);
  }
}

async function fetchDetail(): Promise<void> {
  if (!exhibitionId.value) {
    error.value = '未提供展览编号';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    exhibition.value = await apiGetExhibition(exhibitionId.value);
  } catch (err) {
    error.value = getErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function enterExhibition(): Promise<void> {
  if (!exhibition.value) {
    return;
  }
  try {
    const result = await apiVisitExhibition(exhibition.value.id);
    exhibition.value = { ...exhibition.value, visitCount: result.visitCount };
  } catch (err) {
    // 记录参观失败不会阻止进入场景，仅在控制台输出便于排查
    console.warn('[enterExhibition] failed to record visit', err);
  }
  const sceneUrl = typeof exhibition.value.scene === 'string' ? exhibition.value.scene.trim() : '';
  const target = sceneUrl
    ? `/pages/scene-viewer/index?sceneUrl=${encodeURIComponent(sceneUrl)}`
    : '/pages/scene-viewer/index';
  uni.navigateTo({ url: target });
}

async function shareExhibition(): Promise<void> {
  if (!exhibition.value) {
    return;
  }
  try {
    const result = await apiShareExhibition(exhibition.value.id);
    exhibition.value = { ...exhibition.value, shareCount: result.shareCount };
    uni.showToast({ title: '已生成分享链接', icon: 'none' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

function openExhibitionRatingModal(): void {
  ratingSelection.value = 0;
  ratingModalVisible.value = true;
}

function closeExhibitionRatingModal(): void {
  ratingModalVisible.value = false;
  ratingSelection.value = 0;
}

function selectExhibitionRating(score: number): void {
  ratingSelection.value = score;
}

async function submitExhibitionRating(): Promise<void> {
  if (!exhibition.value || ratingSelection.value === 0) {
    return;
  }
  ratingSubmitting.value = true;
  try {
    exhibition.value = await apiRateExhibition(exhibition.value.id, { score: ratingSelection.value });
    uni.showToast({ title: '评分成功', icon: 'success' });
    closeExhibitionRatingModal();
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  } finally {
    ratingSubmitting.value = false;
  }
}

function handleNavigate(target: NavKey): void {
  redirectToNav(target, { current: 'exhibition' });
}

async function publishExhibition(): Promise<void> {
  if (!exhibition.value) {
    return;
  }
  try {
    exhibition.value = await apiUpdateExhibition(exhibition.value.id, { status: 'published' });
    uni.showToast({ title: '已发布展览', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}
async function withdrawExhibition(): Promise<void> {
  if (!exhibition.value) {
    return;
  }
  const { confirm } = await showModal({
    title: '确认撤展',
    content: '撤展后将对参观者隐藏，可稍后重新发布。',
    confirmColor: '#d93025',
  });
  if (!confirm) {
    return;
  }
  try {
    exhibition.value = await apiWithdrawExhibition(exhibition.value.id);
    uni.showToast({ title: '已撤展', icon: 'none' });
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

async function deleteExhibition(): Promise<void> {
  if (!exhibition.value) {
    return;
  }
  const { confirm } = await showModal({
    title: '删除展览',
    content: '删除后无法恢复，确认继续吗？',
    confirmColor: '#d93025',
  });
  if (!confirm) {
    return;
  }
  try {
    await apiDeleteExhibition(exhibition.value.id);
    uni.showToast({ title: '已删除', icon: 'none' });
    setTimeout(() => {
      uni.navigateBack();
    }, 400);
  } catch (err) {
    uni.showToast({ title: getErrorMessage(err), icon: 'none' });
  }
}

function editExhibition(): void {
  if (!exhibition.value) {
    return;
  }
  uni.navigateTo({ url: `/pages/exhibition/create/index?id=${exhibition.value.id}` });
}

function openCollection(id: string): void {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/collections/detail/index?id=${id}` });
}

function openWork(id: string): void {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
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

function formatRating(value: number): string {
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

function formatDateRange(start?: string, end?: string): string {
  if (!start && !end) {
    return '展期待定';
  }
  const startLabel = start ? formatDateLabel(start) : '';
  const endLabel = end ? formatDateLabel(end) : '';
  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`;
  }
  return startLabel || endLabel;
}

function formatDateLabel(value?: string): string {
  if (!value) {
    return '刚刚';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '刚刚';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatWorkMeta(work: WorkSummary): string {
  const typeLabel = work.mediaType === 'video' ? '视频' : work.mediaType === 'model' ? '模型' : '图片';
  return `${typeLabel} · 更新于 ${formatDateLabel(work.updatedAt || work.createdAt)}`;
}

function getErrorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof (reason as { message: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  if (typeof reason === 'string') {
    return reason;
  }
  return '操作失败，请稍后重试';
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
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 96px;
  padding-top: 84px;
  // iOS 安全区适配（新旧写法都加，取其一生效）
  padding-bottom: calc(96px + env(safe-area-inset-bottom));
  padding-bottom: calc(96px + constant(safe-area-inset-bottom));
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.header-title {
  display: flex;
  gap: 12px;
  align-items: center;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: #ffffff;
  background: rgba(31, 122, 236, 0.6);
}

.status-badge.status-draft {
  background: rgba(255, 175, 66, 0.85);
}

.status-badge.status-withdrawn {
  background: rgba(138, 148, 166, 0.85);
}

.header-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #8a94a6;
  font-size: 12px;
}

.subtitle {
  font-size: 12px;
  color: #8a94a6;
}

.share-btn {
  align-self: flex-start;
  padding: 6px 14px;
  border-radius: 16px;
  border: none;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 12px;
}

.state {
  margin-top: 40px;
  padding: 20px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.state--loading {
  background: rgba(31, 122, 236, 0.08);
  color: #5f6b83;
}

.state--error {
  background: rgba(217, 48, 37, 0.08);
  color: #d93025;
}

.state--empty {
  background: rgba(95, 107, 131, 0.08);
  color: #5f6b83;
}

.state-text {
  font-size: 13px;
}

.retry-btn {
  padding: 6px 16px;
  border-radius: 14px;
  border: none;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 12px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.cover {
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 18px 36px rgba(31, 122, 236, 0.16);
}

.cover-swiper {
  height: 220px;
  border-radius: 20px;
}

.cover-single {
  position: relative;
  height: 220px;
  border-radius: 20px;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
}

.action-buttons {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  padding: 10px 0;
}

.action-buttons.buttons-even {
  justify-content: stretch;
  gap: 12px;
}

.action-buttons.buttons-even .action-btn-icon {
  flex: 1;
}

.action-btn-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(31, 122, 236, 0.08);
  transition: all 0.2s;
}

.action-btn-icon.danger {
  background: rgba(217, 48, 37, 0.08);
}

.action-btn-icon .icon {
  font-size: 24px;
}

.action-btn-icon .label {
  font-size: 12px;
  color: #5f6b83;
  font-weight: 500;
}

.action-btn-icon.danger .label {
  color: #d93025;
}

.stats-card {
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
  color: #1f1f1f;
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

.segment {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.segment-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.segment-desc {
  font-size: 13px;
  color: #5f6b83;
  line-height: 1.6;
}

.collection-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.collection-item {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collection-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.collection-meta {
  font-size: 12px;
  color: #5f6b83;
}

.work-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.work-item {
  display: flex;
  gap: 12px;
  align-items: center;
}

.work-thumb {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  background: #e3e9f2;
}

.work-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.work-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.work-meta {
  font-size: 12px;
  color: #5f6b83;
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
  color: #1f1f1f;
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
</style>
