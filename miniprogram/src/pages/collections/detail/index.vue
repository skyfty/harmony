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
      <view class="stat" v-for="stat in statBlocks" :key="stat.label">
        <text class="stat-icon">{{ stat.icon }}</text>
        <text class="stat-value">{{ stat.value }}</text>
        <text class="stat-desc">{{ stat.label }}</text>
      </view>
    </view>

        <view v-if="collection" class="engage-card">
          <view class="engage-row">
            <text class="engage-label">为作品集评分</text>
            <button class="like-btn" @tap="openCollectionRatingModal">
              ★ 平均 {{ collectionAverageRating }}（点按评分）
            </button>
          </view>
          <view class="engage-row">
            <text class="engage-label">喜欢</text>
            <button class="like-btn" :class="{ liked: collectionLiked }" @tap="toggleCollectionLike">
              ❤ {{ collectionLikesDisplay }}
            </button>
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

const averageRating = computed(() => {
  if (!worksInCollection.value.length) {
    return '--';
  }
  const total = worksInCollection.value.reduce((sum, item) => sum + item.rating, 0);
  const avg = total / worksInCollection.value.length;
  return avg > 0 ? avg.toFixed(1) : '--';
});

const totalLikes = computed(() => {
  if (!worksInCollection.value.length) {
    return '0';
  }
  const sum = worksInCollection.value.reduce((acc, item) => acc + item.likes, 0);
  return formatNumber(sum);
});

const statBlocks = computed(() => [
  { icon: '🖼', value: worksInCollection.value.length.toString(), label: '作品数量' },
  { icon: '★', value: averageRating.value, label: '平均评分' },
  { icon: '❤', value: totalLikes.value, label: '累计喜欢' },
]);

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
  if (!collection.value) return;
  try {
    const { liked, likesCount } = await apiToggleCollectionLike(collection.value.id);
    collection.value.liked = liked;
    collection.value.likesCount = likesCount;
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
  }
}

async function rateCollection(score: number): Promise<void> {
  if (!collection.value) return;
  try {
    const updated = await apiRateCollection(collection.value.id, { score });
    collection.value.averageRating = updated.averageRating;
    collection.value.ratingCount = updated.ratingCount;
    collection.value.userRating = updated.userRating;
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
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

const collectionRatingModalVisible = ref(false);
function openCollectionRatingModal(): void {
  if (!collection.value) return;
  collectionRatingModalVisible.value = true;
}
function closeCollectionRatingModal(): void {
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
<template v-if="collectionRatingModalVisible">
  <view class="rating-modal-mask" @tap="closeCollectionRatingModal"></view>
  <view class="rating-modal-panel" @tap.stop>
    <button class="rating-modal__close" @tap="closeCollectionRatingModal">×</button>
    <text class="rating-modal__title">为该作品集打分</text>
    <view class="rating-modal__stars">
      <text
        v-for="n in 5"
        :key="n"
        class="rating-modal__star"
        :class="{ active: n <= (collectionUserRating || 0) }"
        @tap="rateCollection(n)"
      >★</text>
    </view>
    <view class="rating-modal__actions">
      <text v-if="false" class="pending-label">提交中…</text>
    </view>
  </view>
</template>
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
  gap: 14px;
}
.rating-modal__star {
  font-size: 40px;
  color: #cfd6e4;
}
.rating-modal__star.active {
  color: #ffb400;
}
.rating-modal__actions {
  display: flex;
  justify-content: center;
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
  font-size: 18px;
}

.stat:nth-child(1) .stat-icon {
  color: #1f7aec;
}

.stat:nth-child(2) .stat-icon {
  color: #ffaf42;
}

.stat:nth-child(3) .stat-icon {
  color: #ff6f91;
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

.engage-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 18px 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.engage-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.engage-label {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.stars {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.star {
  font-size: 20px;
  color: #cfd6e4;
}
.star.active {
  color: #ffb400;
}

.avg-label {
  font-size: 12px;
  color: #5f6b83;
  margin-left: 8px;
}

.like-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 18px;
  background: rgba(31, 122, 236, 0.1);
  color: #1f1f1f;
  font-size: 14px;
}
.like-btn.liked {
  background: rgba(255, 111, 145, 0.15);
  color: #ff3f6e;
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
