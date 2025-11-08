<template>
  <view class="page collection-detail">
    <view class="header">
      <view class="header-info">
        <text class="title">{{ collection?.title || '作品集详情' }}</text>
        <text class="subtitle">{{ headerSubtitle }}</text>
      </view>
      <button v-if="canEdit" class="edit-btn" @tap="goToEdit">编辑</button>
    </view>

    <view v-if="collection" class="cover-card">
      <view class="cover-card__preview">
        <image
          v-if="coverImage"
          class="cover-card__image"
          :src="coverImage"
          mode="aspectFill"
        />
        <view v-else class="cover-card__placeholder" :style="{ background: coverBackground }">
          <text class="cover-card__placeholder-text">暂无封面</text>
        </view>
      </view>
      <text class="cover-card__caption">作品集封面</text>
    </view>

    <view v-if="collection" class="stats-card">
      <view class="stat">
        <text class="stat-icon">🖼</text>
        <text class="stat-value">{{ worksInCollection.length }}</text>
        <text class="stat-desc">作品数量</text>
      </view>
      <view class="stat stat--action stat--rating" @tap="openCollectionRatingModal">
        <text class="stat-icon">★</text>
        <text class="stat-value">{{ collectionAverageRating }}</text>
        <text class="stat-desc">{{ collectionRatingSummary }}</text>
      </view>
      <view
        class="stat stat--action stat--likes"
        :class="{ 'stat--liked': collectionLiked, 'stat--disabled': collectionLikeLoading }"
        @tap="toggleCollectionLike"
      >
        <text class="stat-icon">❤</text>
        <text class="stat-value">{{ collectionLikesDisplay }}</text>
        <text class="stat-desc">{{ collectionLikeSummary }}</text>
      </view>
    </view>

    <view v-if="collection" class="info-card">
      <text class="info-title">作品集信息</text>
      <view class="info-row">
        <text class="info-label">标题</text>
        <text class="info-value">{{ collection.title || '未命名作品集' }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">简介</text>
        <text class="info-value info-value--multiline">{{ collection.description || '尚未填写描述' }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">可见性</text>
        <text class="info-value">{{ collection.isPublic ? '公开' : '仅自己可见' }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">更新时间</text>
        <text class="info-value">{{ collection.updatedAt }}</text>
      </view>
    </view>

    <view v-if="collection" class="works-card">
      <view class="works-header">
        <text class="works-title">包含作品</text>
        <text class="works-meta">共 {{ worksInCollection.length }} 个</text>
      </view>
      <view v-if="worksInCollection.length" class="works-grid">
        <view class="work-card" v-for="work in worksInCollection" :key="work.id" :style="{ background: work.gradient }">
          <view class="work-card__preview" @tap="openWorkDetail(work.id)">
            <image
              v-if="workPreview(work)"
              class="work-card__image"
              :src="workPreview(work)"
              mode="aspectFill"
            />
            <view v-else class="work-card__placeholder">
              <text>暂无预览</text>
            </view>
          </view>
          <view class="work-info">
            <text class="work-name">{{ work.name }}</text>
            <text class="work-meta">评分 {{ work.rating.toFixed(1) }} · 喜欢 {{ work.likes }}</text>
          </view>
          <view class="work-actions">
            <button class="link-btn" @tap="openWorkDetail(work.id)">查看</button>
          </view>
        </view>
      </view>
      <view v-else class="collection-empty">暂未包含作品，前往作品详情页添加。</view>
    </view>

    <view v-else class="empty">
      <text class="empty-title">{{ loadingError ? '加载失败' : '未找到作品集' }}</text>
      <text class="empty-desc">{{ loadingError || '请返回作品集列表或重新选择' }}</text>
    </view>
  </view>

  <view v-if="collectionRatingModalVisible" class="rating-modal-mask" @tap="closeCollectionRatingModal"></view>
  <view v-if="collectionRatingModalVisible" class="rating-modal-panel" @tap.stop>
    <button class="rating-modal__close" @tap="closeCollectionRatingModal">×</button>
    <text class="rating-modal__title">为该作品集打分</text>
    <view class="rating-modal__stars">
      <text
        v-for="n in 5"
        :key="n"
        class="rating-modal__star"
        :class="{ active: n <= collectionRatingSelection }"
        @tap="selectCollectionRating(n)"
      >★</text>
    </view>
    <view class="rating-modal__actions">
      <button
        class="rating-modal__submit"
        :disabled="collectionRatingSubmitting"
        @tap="submitCollectionRating"
      >{{ collectionRatingSubmitting ? '提交中…' : collectionRatingSelection ? `提交 ${collectionRatingSelection} 星` : '请选择星级' }}</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import {
  apiGetCollection,
  apiToggleCollectionLike,
  apiRateCollection,
  type CollectionSummary,
  type WorkSummary,
} from '@/api/miniprogram';
import { useWorksStore } from '@/stores/worksStore';

type WorkMediaType = WorkSummary['mediaType'];

interface WorkDisplay {
  id: string;
  name: string;
  rating: number;
  likes: number;
  gradient: string;
  type: WorkMediaType;
  thumbnailUrl?: string;
  fileUrl: string;
}

const collectionId = ref('');
const collection = ref<CollectionSummary | null>(null);
const loading = ref(false);
const loadingError = ref('');
const collectionLikeLoading = ref(false);
const collectionRatingModalVisible = ref(false);
const collectionRatingSelection = ref(0);
const collectionRatingSubmitting = ref(false);
const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';
const worksStore = useWorksStore();
const currentUserId = computed(() => worksStore.profile?.user?.id ?? '');
const canEdit = computed(() => Boolean(collection.value && currentUserId.value && collection.value.ownerId === currentUserId.value));

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

function ensureBackground(url: string | undefined, index: number): string {
  if (url && url.startsWith('http')) {
    return `url(${url})`;
  }
  const normalizedIndex = Number.isFinite(index) ? index : 0;
  const paletteIndex = ((normalizedIndex % gradientPalette.length) + gradientPalette.length) % gradientPalette.length;
  return gradientPalette[paletteIndex];
}

function extractCssImage(value?: string): string {
  if (!value) {
    return '';
  }
  const match = value.match(/^url\((.*)\)$/i);
  if (match && match[1]) {
    return match[1].replace(/^['"]|['"]$/g, '');
  }
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) {
    return value;
  }
  if (value.startsWith('linear-gradient')) {
    return '';
  }
  return '';
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '加载失败，请稍后重试';
}

const worksInCollection = computed<WorkDisplay[]>(() => {
  if (!collection.value) {
    return [];
  }
  return (collection.value.works ?? []).map((work, index) => ({
    id: work.id,
    name: work.title,
    rating: Number(work.averageRating ?? 0),
    likes: Number(work.likesCount ?? 0),
    gradient: ensureBackground(work.thumbnailUrl, index),
    type: (work.mediaType ?? 'image') as WorkMediaType,
    thumbnailUrl: work.thumbnailUrl ?? undefined,
    fileUrl: work.fileUrl,
  }));
});

const coverImage = computed(() => {
  const primary = extractCssImage(collection.value?.coverUrl);
  if (primary) {
    return primary;
  }
  const fallback = worksInCollection.value[0];
  if (!fallback) {
    return '';
  }
  return fallback.thumbnailUrl || (fallback.type === 'image' ? fallback.fileUrl : '');
});

const coverBackground = computed(() => {
  const raw = collection.value?.coverUrl;
  if (raw && raw.startsWith('linear-gradient')) {
    return raw;
  }
  if (coverImage.value) {
    return defaultGradient;
  }
  return defaultGradient;
});

function workPreview(work: WorkDisplay): string {
  return work.thumbnailUrl || (work.type === 'image' ? work.fileUrl : '');
}

const headerSubtitle = computed(() => {
  if (!collection.value) {
    return '正在获取作品集信息';
  }
  const updated = collection.value.updatedAt ? `更新于 ${collection.value.updatedAt}` : '';
  const total = `共 ${(collection.value.works ?? []).length} 个作品`;
  return [updated, total].filter(Boolean).join('  ');
});

const collectionAverageRating = computed(() => {
  const v = collection.value?.averageRating ?? 0;
  return v > 0 ? v.toFixed(1) : '--';
});

const collectionLiked = computed(() => !!collection.value?.liked);
const collectionLikes = computed(() => Number(collection.value?.likesCount ?? 0));
const collectionLikesDisplay = computed(() => formatNumber(collectionLikes.value));
const collectionUserRating = computed(() => collection.value?.userRating?.score ?? 0);

const collectionRatingCount = computed(() => collection.value?.ratingCount ?? 0);

const collectionRatingSummary = computed(() => {
  const count = collectionRatingCount.value;
  const base = count > 0 ? `共 ${count} 次评分` : '尚无评分';
  const myScore = collectionUserRating.value;
  const action = myScore > 0 ? `我的 ${myScore} 星 · 点按修改` : '点按评分';
  return `${base} · ${action}`;
});

const collectionLikeSummary = computed(() => {
  if (collectionLikeLoading.value) {
    return '处理中…';
  }
  return collectionLiked.value ? '已喜欢 · 点按取消' : '点按喜欢';
});

async function fetchCollectionDetail(id: string): Promise<void> {
  if (!id || loading.value) {
    return;
  }
  loading.value = true;
  loadingError.value = '';
  uni.showLoading({ title: '加载中', mask: true });
  try {
    const data = await apiGetCollection(id);
    collection.value = data;
  } catch (error) {
    collection.value = null;
    loadingError.value = getErrorMessage(error);
    uni.showToast({ title: loadingError.value, icon: 'none' });
  } finally {
    loading.value = false;
    uni.hideLoading();
    uni.stopPullDownRefresh();
  }
}

function openWorkDetail(id: string): void {
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
}

function goToEdit(): void {
  if (!collection.value) {
    return;
  }
  uni.navigateTo({ url: `/pages/collections/edit/index?id=${collection.value.id}` });
}

async function toggleCollectionLike(): Promise<void> {
  if (!collection.value || collectionLikeLoading.value) {
    return;
  }
  collectionLikeLoading.value = true;
  try {
    const { liked, likesCount } = await apiToggleCollectionLike(collection.value.id);
    const snapshot = collection.value;
    collection.value = { ...snapshot, liked, likesCount };
    uni.showToast({ title: liked ? '已喜欢' : '已取消喜欢', icon: 'success' });
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
  } finally {
    collectionLikeLoading.value = false;
  }
}

function selectCollectionRating(score: number): void {
  collectionRatingSelection.value = score;
}

async function submitCollectionRating(): Promise<void> {
  if (!collection.value || collectionRatingSubmitting.value) {
    return;
  }
  if (collectionRatingSelection.value <= 0) {
    uni.showToast({ title: '请先选择星级', icon: 'none' });
    return;
  }
  collectionRatingSubmitting.value = true;
  try {
    const updated = await apiRateCollection(collection.value.id, { score: collectionRatingSelection.value });
    collection.value = updated;
    collectionRatingSelection.value = updated.userRating?.score ?? collectionRatingSelection.value;
    uni.showToast({ title: '评分成功', icon: 'success' });
    collectionRatingModalVisible.value = false;
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
  } finally {
    collectionRatingSubmitting.value = false;
  }
}

onLoad((options) => {
  const rawId = typeof options?.id === 'string' ? options.id : '';
  if (rawId) {
    collectionId.value = decodeURIComponent(rawId);
    fetchCollectionDetail(collectionId.value);
  } else {
    loadingError.value = '未提供作品集 ID';
  }
});

function openCollectionRatingModal(): void {
  if (!collection.value) {
    return;
  }
  collectionRatingSelection.value = collectionUserRating.value || 0;
  collectionRatingModalVisible.value = true;
}

function closeCollectionRatingModal(): void {
  if (collectionRatingSubmitting.value) {
    return;
  }
  collectionRatingModalVisible.value = false;
}

function formatNumber(value: number): string {
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
.rating-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 999;
}
.rating-modal-panel {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 84%;
  max-width: 420px;
  background: #ffffff;
  border-radius: 24px;
  padding: 26px 24px 30px;
  box-shadow: 0 28px 48px rgba(31,122,236,0.25);
  display: flex;
  flex-direction: column;
  gap: 20px;
  z-index: 1000;
}
.rating-modal__title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}
.rating-modal__stars {
  display: flex;
  justify-content: center;
  gap: 16px;
}
.rating-modal__star {
  font-size: 42px;
  color: #cfd6e4;
}
.rating-modal__star.active {
  color: #ffb400;
}
.rating-modal__actions {
  display: flex;
  justify-content: center;
}
.rating-modal__submit {
  padding: 10px 40px;
  border: none;
  border-radius: 24px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 15px;
}
.rating-modal__submit[disabled] {
  opacity: 0.65;
}
.rating-modal__close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg,#1f7aec,#62a6ff);
  color: #fff;
  font-size: 24px;
  line-height: 38px;
  text-align: center;
  box-shadow: 0 10px 24px rgba(31,122,236,0.28);
}
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}


.title {
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 13px;
  color: #8a94a6;
}

.edit-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 16px;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 14px;
}

.cover-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cover-card__preview {
  height: 220px;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
  background: #f0f4ff;
}

.cover-card__image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.cover-card__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  font-weight: 500;
}

.cover-card__placeholder-text {
  padding: 8px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.35);
}

.cover-card__caption {
  font-size: 13px;
  color: #5f6b83;
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
  font-size: 26px;
  color: #1f7aec;
}

.stat--rating .stat-icon {
  color: #ffb400;
}

.stat--likes .stat-icon {
  color: #ff6f91;
}

.stat--liked .stat-icon {
  color: #ff3f6e;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
}

.stat-desc {
  font-size: 12px;
  color: #8a94a6;
  text-align: center;
  line-height: 1.6;
}

.stat--action {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat--action:active {
  transform: scale(0.97);
  box-shadow: 0 6px 16px rgba(31, 122, 236, 0.12);
}

.stat--disabled {
  opacity: 0.6;
}

.info-card,
.works-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.info-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-label {
  font-size: 13px;
  color: #8a94a6;
}

.info-value {
  font-size: 14px;
  color: #1f1f1f;
}

.info-value--multiline {
  line-height: 1.6;
  white-space: pre-wrap;
}

.works-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.works-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.works-meta {
  font-size: 12px;
  color: #8a94a6;
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

.work-card {
  min-height: 160px;
  border-radius: 18px;
  padding: 18px;
  color: #ffffff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  position: relative;
  gap: 12px;
}

.work-card__preview {
  height: 150px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.16);
  position: relative;
}

.work-card__image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.work-card__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

.work-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.work-name {
  font-size: 15px;
  font-weight: 600;
}

.work-meta {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.work-actions {
  display: flex;
  gap: 10px;
}

.link-btn {
  flex: 0 0 auto;
  padding: 6px 10px;
  border: none;
  border-radius: 10px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.25);
  color: #ffffff;
}

.collection-empty {
  font-size: 12px;
  color: #8a94a6;
}

.empty {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  color: #8a94a6;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.empty-desc {
  font-size: 13px;
  color: #8a94a6;
}
</style>
