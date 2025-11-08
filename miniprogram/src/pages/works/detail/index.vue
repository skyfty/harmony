
<template>
  <view class="page work-detail">
    <view class="header">
      <view class="header-info">
        <text class="title">{{ work?.title || '作品详情' }}</text>
        <text class="subtitle">{{ headerSubtitle }}</text>
      </view>
      <button v-if="isOwner" class="edit-btn" @tap="goToEdit">编辑</button>
    </view>

    <view v-if="work" class="cover-card">
      <view class="cover-card__preview" :style="{ background: previewBackground }">
        <image v-if="previewImage" class="cover-card__image" :src="previewImage" mode="aspectFill" />
        <view v-else class="cover-card__placeholder">
          <text class="cover-card__placeholder-text">暂无预览</text>
        </view>
      </view>
      <text class="cover-card__caption">作品预览</text>
    </view>

    <view v-if="work" class="stats-card">
      <view class="stat stat--rating stat--action" @tap="openWorkRatingModal">
        <text class="stat-icon">★</text>
        <text class="stat-value">{{ workRating }}</text>
        <text class="stat-desc">{{ workRatingSummary }}</text>
      </view>
      <view
        class="stat stat--likes stat--action"
        :class="{ 'stat--liked': workLiked, 'stat--disabled': likeLoading }"
        @tap="toggleWorkLike"
      >
        <text class="stat-icon">❤</text>
        <text class="stat-value">{{ workLikes }}</text>
        <text class="stat-desc">{{ workLikeSummary }}</text>
      </view>
      <view class="stat">
        <text class="stat-icon">📁</text>
        <text class="stat-value">{{ workSizeLabel }}</text>
        <text class="stat-desc">文件大小</text>
      </view>
    </view>

    <view v-if="work" class="info-card">
      <text class="info-title">作品信息</text>
      <view class="info-row">
        <text class="info-label">标题</text>
        <text class="info-value">{{ work.title || '未命名作品' }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">简介</text>
        <text class="info-value info-value--multiline">{{ work.description || '尚未填写描述' }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">类型</text>
        <text class="info-value">{{ workTypeLabel }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">文件大小</text>
        <text class="info-value">{{ workSizeLabel }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">创建时间</text>
        <text class="info-value">{{ workCreatedAt }}</text>
      </view>
      <view class="info-row">
        <text class="info-label">更新时间</text>
        <text class="info-value">{{ workUpdatedAt }}</text>
      </view>
    </view>

    <view v-if="work" class="collections-card">
      <view class="collections-header">
        <text class="collections-title">所属作品集</text>
        <button
          v-if="isOwner"
          class="collections-action"
          :disabled="collectionsLoading"
          @tap="openCollectionPicker"
        >添加</button>
      </view>
      <view v-if="workCollections.length" class="collection-tags">
        <view
          class="collection-tag"
          v-for="collection in workCollections"
          :key="collection.id"
          @tap="openCollectionDetail(collection.id)"
        >
          <text class="collection-name">{{ collection.title }}</text>
        </view>
      </view>
      <view v-else class="collection-empty">
        <text>暂未加入作品集{{ isOwner ? '，点击右上角添加' : '' }}。</text>
      </view>
    </view>

    <view v-else class="empty">
      <text class="empty-title">{{ loadingError ? '加载失败' : '未找到作品' }}</text>
      <text class="empty-desc">{{ loadingError || '请返回作品列表重新选择' }}</text>
    </view>
  </view>

  <view v-if="ratingModalVisible" class="rating-modal-mask" @tap="closeWorkRatingModal"></view>
  <view v-if="ratingModalVisible" class="rating-modal-panel" @tap.stop>
    <button class="rating-modal__close" @tap="closeWorkRatingModal">×</button>
    <text class="rating-modal__title">为该作品打分</text>
    <view class="rating-modal__stars">
      <text
        v-for="n in 5"
        :key="n"
        class="rating-modal__star"
        :class="{ active: n <= ratingSelection }"
        @tap="selectWorkRating(n)"
      >★</text>
    </view>
    <view class="rating-modal__actions">
      <button
        class="rating-modal__submit"
        :disabled="ratingSubmitting"
        @tap="submitWorkRating"
      >{{ ratingSubmitting ? '提交中…' : ratingSelection ? `提交 ${ratingSelection} 星` : '请选择星级' }}</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import {
  apiGetWork,
  apiGetCollections,
  apiUpdateCollection,
  apiToggleWorkLike,
  apiRateWork,
  type WorkSummary,
  type CollectionSummary,
} from '@/api/miniprogram';
import { useWorksStore } from '@/stores/worksStore';

const worksStore = useWorksStore();

const workId = ref('');
const work = ref<WorkSummary | null>(null);
const loadingError = ref('');
const userCollections = ref<CollectionSummary[]>([]);
const collectionsLoaded = ref(false);
const collectionsLoading = ref(false);
const likeLoading = ref(false);
const ratingModalVisible = ref(false);
const ratingSubmitting = ref(false);
const ratingSelection = ref(0);

const currentUserId = computed(() => worksStore.profile?.user?.id ?? '');
const isOwner = computed(
  () => Boolean(work.value && currentUserId.value && work.value.ownerId === currentUserId.value),
);

const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';
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

const typeLabelMap: Record<WorkSummary['mediaType'], string> = {
  image: '图片',
  video: '视频',
  model: '模型',
  other: '其他',
};

function ensureBackground(index = 0): string {
  const paletteIndex = ((index % gradientPalette.length) + gradientPalette.length) % gradientPalette.length;
  return gradientPalette[paletteIndex];
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '操作失败，请稍后重试';
}

const previewImage = computed(() => {
  if (!work.value) {
    return '';
  }
  if (work.value.thumbnailUrl) {
    return work.value.thumbnailUrl;
  }
  if (work.value.mediaType === 'image') {
    return work.value.fileUrl;
  }
  return '';
});

const previewBackground = computed(() => {
  if (previewImage.value) {
    return defaultGradient;
  }
  return ensureBackground();
});

const headerSubtitle = computed(() => {
  if (!work.value) {
    return '正在获取作品信息';
  }
  const pieces: string[] = [];
  if (typeof work.value.size === 'number' && work.value.size > 0) {
    pieces.push(`大小 ${formatSize(work.value.size)}`);
  }
  const relative = formatRelativeTime(work.value.updatedAt || work.value.createdAt);
  if (relative) {
    pieces.push(relative);
  }
  return pieces.join(' · ') || '作品详情';
});

const workCollections = computed(() => work.value?.collections ?? []);

const optionalCollections = computed(() => {
  if (!isOwner.value) {
    return [] as CollectionSummary[];
  }
  const owned = new Set(workCollections.value.map((item) => item.id));
  return userCollections.value.filter((item) => !owned.has(item.id));
});

const workRating = computed(() => {
  if (!work.value) {
    return '--';
  }
  const rating = work.value.averageRating ?? 0;
  return rating > 0 ? rating.toFixed(1) : '--';
});

const workLikes = computed(() => formatNumber(work.value?.likesCount ?? 0));

const workRatingCount = computed(() => work.value?.ratingCount ?? 0);

const workUserRating = computed(() => work.value?.userRating?.score ?? 0);

const workRatingAction = computed(() => {
  const myScore = workUserRating.value;
  return myScore > 0 ? `我的 ${myScore} 星 · 点按修改` : '点按评分';
});

const workRatingSummary = computed(() => {
  const count = workRatingCount.value;
  const prefix = count > 0 ? `共 ${count} 次评分` : '尚无评分';
  return `${prefix} · ${workRatingAction.value}`;
});

const workLiked = computed(() => Boolean(work.value?.liked));

const workLikeSummary = computed(() => {
  if (likeLoading.value) {
    return '处理中…';
  }
  return workLiked.value ? '已喜欢 · 点按取消' : '点按喜欢';
});

const workTypeLabel = computed(() => {
  const type = work.value?.mediaType ?? 'other';
  return typeLabelMap[type as WorkSummary['mediaType']] ?? '其他';
});

const workSizeLabel = computed(() => {
  if (!work.value || typeof work.value.size !== 'number') {
    return formatSize(0);
  }
  return formatSize(work.value.size);
});

const workCreatedAt = computed(() => work.value?.createdAt || '--');
const workUpdatedAt = computed(() => work.value?.updatedAt || '--');

async function fetchWorkDetail(id?: string): Promise<void> {
  const targetId = id ?? workId.value;
  if (!targetId) {
    return;
  }
  workId.value = targetId;
  loadingError.value = '';
  uni.showLoading({ title: '加载中', mask: true });
  try {
    const data = await apiGetWork(targetId);
    work.value = data;
    if (data.ownerId === currentUserId.value) {
      await ensureOwnerCollections();
    } else {
      userCollections.value = [];
      collectionsLoaded.value = false;
    }
  } catch (error) {
    work.value = null;
    loadingError.value = getErrorMessage(error);
    uni.showToast({ title: loadingError.value, icon: 'none' });
  } finally {
    uni.hideLoading();
  }
}

async function ensureOwnerCollections(): Promise<void> {
  if (!isOwner.value || collectionsLoaded.value || collectionsLoading.value) {
    return;
  }
  collectionsLoading.value = true;
  try {
    const response = await apiGetCollections();
    userCollections.value = response.collections ?? [];
    collectionsLoaded.value = true;
  } catch (error) {
    const message = getErrorMessage(error);
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    collectionsLoading.value = false;
  }
}

async function openCollectionPicker(): Promise<void> {
  if (!isOwner.value || !work.value) {
    return;
  }
  await ensureOwnerCollections();
  const options = optionalCollections.value.map((item) => item.title);
  const createIndex = options.length;
  options.push('新建作品集');
  if (!options.length) {
    uni.showToast({ title: '暂无可用作品集', icon: 'none' });
    return;
  }
  uni.showActionSheet({
    itemList: options,
    success: async ({ tapIndex }) => {
      const workIdSnapshot = work.value?.id ?? workId.value;
      if (!workIdSnapshot) {
        uni.showToast({ title: '作品信息已刷新，请重试', icon: 'none' });
        return;
      }
      if (tapIndex === createIndex) {
        uni.navigateTo({ url: `/pages/collections/edit/index?workIds=${workIdSnapshot}` });
        return;
      }
      const target = optionalCollections.value[tapIndex];
      if (!target) {
        return;
      }
      uni.showLoading({ title: '处理中…', mask: true });
      try {
        await apiUpdateCollection(target.id, { appendWorkIds: [workIdSnapshot] });
        collectionsLoaded.value = false;
        await fetchWorkDetail(workIdSnapshot);
        await ensureOwnerCollections();
        uni.showToast({ title: `已加入“${target.title}”`, icon: 'success' });
      } catch (error) {
        uni.showToast({ title: getErrorMessage(error), icon: 'none' });
      } finally {
        uni.hideLoading();
      }
    },
  });
}

function openCollectionDetail(id: string): void {
  uni.navigateTo({ url: `/pages/collections/detail/index?id=${id}` });
}

function goToEdit(): void {
  if (!work.value) {
    return;
  }
  uni.navigateTo({ url: `/pages/works/edit/index?id=${work.value.id}` });
}

async function toggleWorkLike(): Promise<void> {
  if (!work.value || likeLoading.value) {
    return;
  }
  likeLoading.value = true;
  try {
    const { liked, likesCount } = await apiToggleWorkLike(work.value.id);
    const snapshot = work.value;
    work.value = { ...snapshot, liked, likesCount };
    uni.showToast({ title: liked ? '已喜欢' : '已取消喜欢', icon: 'success' });
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
  } finally {
    likeLoading.value = false;
  }
}

function openWorkRatingModal(): void {
  if (!work.value) {
    return;
  }
  ratingSelection.value = workUserRating.value || 0;
  ratingModalVisible.value = true;
}

function closeWorkRatingModal(): void {
  if (ratingSubmitting.value) {
    return;
  }
  ratingModalVisible.value = false;
}

function selectWorkRating(score: number): void {
  ratingSelection.value = score;
}

async function submitWorkRating(): Promise<void> {
  if (!work.value || ratingSubmitting.value) {
    return;
  }
  if (ratingSelection.value <= 0) {
    uni.showToast({ title: '请先选择星级', icon: 'none' });
    return;
  }
  ratingSubmitting.value = true;
  try {
    const updated = await apiRateWork(work.value.id, { score: ratingSelection.value });
    work.value = updated;
    ratingSelection.value = updated.userRating?.score ?? ratingSelection.value;
    uni.showToast({ title: '评分成功', icon: 'success' });
    ratingModalVisible.value = false;
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
  } finally {
    ratingSubmitting.value = false;
  }
}

function formatSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '未记录';
  }
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(mb >= 100 ? 0 : 1)}MB`;
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

function formatRelativeTime(iso?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) {
    return '刚刚更新';
  }
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} 分钟前更新`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} 小时前更新`;
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}.${month}.${day} 更新`;
}

onLoad((query) => {
  const id = typeof query?.id === 'string' ? decodeURIComponent(query.id) : '';
  if (id) {
    fetchWorkDetail(id);
  } else {
    loadingError.value = '未提供作品 ID';
  }
});

watch(isOwner, (value) => {
  if (value) {
    void ensureOwnerCollections();
  } else {
    userCollections.value = [];
    collectionsLoaded.value = false;
  }
});
</script>
<style scoped lang="scss">
.rating-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
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
  box-shadow: 0 28px 48px rgba(31, 122, 236, 0.25);
  display: flex;
  flex-direction: column;
  gap: 20px;
  z-index: 1000;
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
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #fff;
  font-size: 24px;
  line-height: 38px;
  text-align: center;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.28);
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
  justify-content: space-between;
  align-items: flex-start;
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
}

.cover-card__preview::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.18) 100%);
  pointer-events: none;
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
  background: linear-gradient(135deg, #d8e7ff, #bfd8ff);
  color: rgba(255, 255, 255, 0.9);
  z-index: 1;
}

.cover-card__placeholder-text {
  padding: 8px 14px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.35);
  font-size: 14px;
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

.stat--rating .stat-icon {
  color: #ffb400;
}

.stat--likes .stat-icon {
  color: #ff6f91;
}

.stat--liked .stat-icon {
  color: #ff3f6e;
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
.collections-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-title,
.collections-title {
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

.collections-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collections-action {
  padding: 6px 12px;
  border: none;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 12px;
}

.collections-action[disabled] {
  opacity: 0.6;
}

.collection-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.collection-tag {
  display: inline-flex;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  color: #1f1f1f;
  font-size: 13px;
}

.collection-name {
  font-weight: 600;
}

.collection-empty {
  font-size: 12px;
  color: #8a94a6;
}

.empty {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
