<template>
  <view class="page collection-edit">
    <view class="header">
      <view class="header-info">
        <text class="title">作品集编辑</text>
        <text class="subtitle">{{ headerSubtitle }}</text>
      </view>
    </view>

    <view v-if="displayItems.length" class="preview" :style="{ background: previewGradient }">
      <text class="preview-label">已选作品</text>
    </view>

    <view v-if="displayItems.length" class="stats-card">
      <view class="stat" v-for="item in statBlocks" :key="item.label">
        <text class="stat-icon">{{ item.icon }}</text>
        <text class="stat-value">{{ item.value }}</text>
        <text class="stat-desc">{{ item.label }}</text>
      </view>
    </view>

    <view v-if="displayItems.length" class="gallery-card">
      <view class="card-header">
    <text class="card-title">刚创作的作品</text>
        <text class="card-meta">点击右上角可移除单个作品</text>
      </view>
      <view class="works-grid">
        <view
          class="work-thumb"
          v-for="item in displayItems"
          :key="item.id"
          :style="{ background: item.gradient }"
        >
          <image v-if="item.preview" class="work-thumb__image" :src="item.preview" mode="aspectFill" />
          <view v-if="item.kind === 'pending'" class="work-thumb__badge">待上传</view>
          <button class="delete-icon" @tap.stop="confirmRemove(item.id)">×</button>
        </view>
      </view>
    </view>

    <view v-if="displayItems.length" class="info-card">
      <text class="info-title">新建作品集</text>
  <text class="info-desc">为本次创作创建独立作品集，并补充标题与描述信息。</text>
      <input class="input" v-model="title" placeholder="输入作品集标题" />
      <textarea class="textarea" v-model="description" placeholder="补充作品集描述"></textarea>
      <button class="primary" :disabled="!canCreate" @tap="createNewCollection">{{ submitting ? '创建中…' : '创建并保存' }}</button>
    </view>

    <view class="collections-card">
      <view class="collections-header">
        <text class="collections-title">添加到已有作品集</text>
        <text class="collections-subtitle" v-if="collections.length">共 {{ collections.length }} 个可选</text>
      </view>
      <view v-if="collections.length" class="collection-list">
        <view class="collection-item" v-for="collection in collections" :key="collection.id">
          <view class="collection-cover" :style="{ background: collection.cover }"></view>
          <view class="collection-info">
            <text class="collection-title">{{ collection.title }}</text>
            <text class="collection-meta">共 {{ collection.works.length }} 个作品</text>
          </view>
          <button class="link-btn" :disabled="!canAppendToExisting" @tap="appendToCollection(collection.id)">
            添加
          </button>
        </view>
      </view>
      <view v-else class="collection-empty">暂未创建作品集，先新建一个吧。</view>
    </view>

    <view v-if="!displayItems.length" class="empty">
      <text class="empty-title">暂无待处理作品</text>
  <text class="empty-desc">请返回创作页面选择素材后再试</text>
  <button class="outline" @tap="goWork">返回创作</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { storeToRefs } from 'pinia';
import { apiListResourceCategories, apiUploadAsset } from '@/api/miniprogram';
import { useWorksStore, type WorkItem, type PendingWorkUpload, type NewWorkInput } from '@/stores/worksStore';
import { formatWorkSize, prependWorkHistoryEntry } from '@/utils/workHistory';

const worksStore = useWorksStore();
const { collections } = storeToRefs(worksStore);

const workIds = ref<string[]>([]);
const title = ref('');
const description = ref('');
const submitting = ref(false);
const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';

const selectedExistingWorks = computed<WorkItem[]>(() =>
  workIds.value
    .map((id) => worksStore.workMap[id])
    .filter((item): item is WorkItem => Boolean(item)),
);

const pendingUploads = computed<PendingWorkUpload[]>(() => worksStore.pendingUploads);

type DisplayItem = {
  id: string;
  name: string;
  gradient: string;
  preview?: string;
  rating: number;
  likes: number;
  sizeLabel: string;
  kind: 'existing' | 'pending';
  work?: WorkItem;
  upload?: PendingWorkUpload;
};

const fallbackGradients = [
  'linear-gradient(135deg, #ffe0f2, #ffd0ec)',
  'linear-gradient(135deg, #dff5ff, #c6ebff)',
  'linear-gradient(135deg, #fff0ce, #ffe2a8)',
  'linear-gradient(135deg, #e7e4ff, #f1eeff)',
  'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
  'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
  'linear-gradient(135deg, #b7f5ec, #90e0d9)',
  'linear-gradient(135deg, #ffd59e, #ffe8c9)',
];

const displayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = [];
  selectedExistingWorks.value.forEach((work) => {
    items.push({
      id: work.id,
      name: work.name,
      gradient: work.gradient,
      preview: work.thumbnailUrl || (work.type === 'image' ? work.fileUrl : undefined),
      rating: work.rating,
      likes: work.likes,
      sizeLabel: work.size,
      kind: 'existing',
      work,
    });
  });
  pendingUploads.value.forEach((upload, index) => {
    const gradientIndex = (selectedExistingWorks.value.length + index) % fallbackGradients.length;
    items.push({
      id: upload.id,
      name: upload.name,
      gradient: fallbackGradients[gradientIndex],
      preview: upload.filePath,
      rating: 0,
      likes: 0,
      sizeLabel: formatWorkSize(upload.size),
      kind: 'pending',
      upload,
    });
  });
  return items;
});

const selectedCount = computed(() => displayItems.value.length);

const canCreate = computed(
  () => selectedCount.value > 0 && title.value.trim().length > 0 && !submitting.value,
);

const canAppendToExisting = computed(
  () => selectedExistingWorks.value.length > 0 && !pendingUploads.value.length && !submitting.value,
);

const headerSubtitle = computed(() =>
  selectedCount.value ? `已选 ${selectedCount.value} 个作品` : '请选择作品后再编辑',
);

const previewGradient = computed(() => displayItems.value[0]?.gradient || defaultGradient);

const averageRating = computed(() => {
  if (!selectedExistingWorks.value.length) {
    return '--';
  }
  const total = selectedExistingWorks.value.reduce((sum, item) => sum + (item.rating ?? 0), 0);
  const avg = total / selectedExistingWorks.value.length;
  return avg > 0 ? avg.toFixed(1) : '--';
});

const totalLikes = computed(() => {
  if (!selectedExistingWorks.value.length) {
    return '0';
  }
  const sum = selectedExistingWorks.value.reduce((acc, item) => acc + (item.likes ?? 0), 0);
  return formatNumber(sum);
});

const statBlocks = computed(() => [
  { icon: '🖼', value: selectedCount.value.toString(), label: '已选作品' },
  { icon: '★', value: averageRating.value, label: '平均评分' },
  { icon: '❤', value: totalLikes.value, label: '收到喜欢' },
]);

onLoad((options) => {
  const raw = typeof options?.workIds === 'string' ? options.workIds : '';
  if (raw) {
    const decoded = decodeURIComponent(raw);
    workIds.value = Array.from(new Set(decoded.split(',').filter(Boolean)));
  }
});

// 仅在首次进入且用户未手动编辑时，帮助生成一个默认标题；
// 一旦用户编辑过标题（包括清空），不再强制回填。
const hasAutoTitled = ref(false);
watchEffect(() => {
  if (!hasAutoTitled.value && !title.value && displayItems.value.length) {
    title.value = `${displayItems.value[0].name} 系列`;
    hasAutoTitled.value = true;
  }
});

function goWork() {
  worksStore.clearPendingUploads();
  uni.redirectTo({ url: '/pages/work/index' });
}

async function createNewCollection() {
  if (!canCreate.value) {
    return;
  }
  submitting.value = true;
  uni.showLoading({ title: '处理中…', mask: true });
  try {
    const newWorkIds = await uploadPendingWorks();
    const finalWorkIds = Array.from(new Set([...workIds.value, ...newWorkIds]));
    if (!finalWorkIds.length) {
      throw new Error('没有可保存的作品');
    }
    const collection = await worksStore.createCollection({
      title: title.value.trim(),
      description: description.value.trim() || '尚未填写描述',
      workIds: finalWorkIds,
    });
    recordCreationHistory(newWorkIds);
    worksStore.clearPendingUploads();
    workIds.value = finalWorkIds;
    uni.showToast({ title: '已创建', icon: 'success' });
    setTimeout(() => {
      const firstWorkId = finalWorkIds[0];
      const encodedCollectionId = encodeURIComponent(collection.id);
      const url = firstWorkId
        ? `/pages/collections/detail/index?id=${encodedCollectionId}&workId=${encodeURIComponent(firstWorkId)}`
        : `/pages/collections/detail/index?id=${encodedCollectionId}`;
      uni.redirectTo({ url });
    }, 400);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : '';
    const message = !rawMessage || rawMessage === 'No valid works provided' ? '创建失败，请稍后重试' : rawMessage;
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    uni.hideLoading();
    submitting.value = false;
  }
}

let cachedImageCategoryId: string | null = null;

async function resolveImageCategoryId(): Promise<string> {
  if (cachedImageCategoryId) {
    return cachedImageCategoryId;
  }
  const categories = await apiListResourceCategories();
  const imageCategory = categories.find((item) => item.type === 'image') ?? categories[0];
  if (!imageCategory) {
    throw new Error('未找到资源分类');
  }
  cachedImageCategoryId = imageCategory.id;
  return cachedImageCategoryId;
}

async function uploadPendingWorks(): Promise<string[]> {
  if (!pendingUploads.value.length) {
    return [];
  }
  const categoryId = await resolveImageCategoryId();
  const createdIds: string[] = [];
  const inputs: NewWorkInput[] = [];
  for (const upload of pendingUploads.value) {
    const assetType: 'model' | 'image' | 'texture' | 'file' =
      upload.type === 'image'
        ? 'image'
        : upload.type === 'model'
        ? 'model'
        : upload.type === 'video'
        ? 'file'
        : 'file';
    let asset;
    try {
      asset = await apiUploadAsset({
        filePath: upload.filePath,
        categoryId,
        fileName: upload.name,
        type: assetType,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败';
      throw new Error(`上传 ${upload.name} 失败：${message}`);
    }
    inputs.push({
      name: upload.name,
      fileUrl: asset.url,
      thumbnailUrl: asset.previewUrl ?? asset.url,
      description: '',
      size: typeof upload.size === 'number' ? upload.size : asset.size,
      type: upload.type,
      fileName: upload.name,
    });
  }
  if (inputs.length) {
    const ids = await worksStore.addWorks(inputs);
    createdIds.push(...ids);
  }
  return createdIds;
}

function recordCreationHistory(createdWorkIds: string[]) {
  if (!createdWorkIds.length) {
    return;
  }
  const created = createdWorkIds
    .map((id) => worksStore.workMap[id])
    .filter((item): item is WorkItem => Boolean(item));
  if (!created.length) {
    return;
  }
  const first = created[0];
  const displayName = created.length > 1 ? `${first.name} 等 ${created.length} 个` : first.name;
  prependWorkHistoryEntry({
    id: first.id,
    name: displayName,
  size: first.size || '未记录',
    time: '刚刚',
    status: '待整理',
    gradient: first.gradient || defaultGradient,
    createdAt: Date.now(),
  });
}

async function appendToCollection(collectionId: string) {
  if (!selectedExistingWorks.value.length) {
    uni.showToast({ title: '暂无待添加的作品', icon: 'none' });
    return;
  }
  if (pendingUploads.value.length) {
    uni.showToast({ title: '请先创建并保存新作品', icon: 'none' });
    return;
  }
  try {
    await worksStore.addWorksToCollection(workIds.value, collectionId);
    uni.showToast({ title: '已加入作品集', icon: 'success' });
    setTimeout(() => {
      const encodedId = encodeURIComponent(collectionId);
      uni.redirectTo({ url: `/pages/collections/detail/index?id=${encodedId}` });
    }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : '添加失败，请稍后重试';
    uni.showToast({ title: message, icon: 'none' });
  }
}

function confirmRemove(id: string) {
  const target = displayItems.value.find((item) => item.id === id);
  if (!target) {
    return;
  }
  uni.showModal({
    title: '移除作品',
  content: `确定从本次创作列表中移除“${target.name}”吗？`,
    confirmColor: '#d93025',
    success: (res) => {
      if (!res.confirm) {
        return;
      }
      if (target.kind === 'existing') {
        workIds.value = workIds.value.filter((workId) => workId !== id);
      } else {
        worksStore.removePendingUpload(id);
      }
      uni.showToast({ title: '已移除', icon: 'none' });
    },
  });
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
  flex-direction: column;
  gap: 6px;
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.preview {
  height: 220px;
  border-radius: 20px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: flex-end;
  padding: 16px;
  color: #ffffff;
  font-weight: 600;
  font-size: 16px;
}

.preview-label {
  background: rgba(0, 0, 0, 0.25);
  padding: 6px 12px;
  border-radius: 12px;
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

.gallery-card,
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

.info-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.info-desc {
  font-size: 13px;
  color: #5f6b83;
  line-height: 1.6;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.card-meta {
  font-size: 12px;
  color: #8a94a6;
}

.work-thumb {
  width: 88px;
  height: 74px;
  border-radius: 12px;
  position: relative;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
  overflow: hidden;
}

.work-thumb__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 12px;
}

.work-thumb__badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(31, 122, 236, 0.9);
  color: #fff;
  font-size: 10px;
}

.works-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.input,
.textarea {
  width: 100%;
  max-width: 420px;
  align-self: center;
  border: none;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  padding: 12px 14px;
  font-size: 14px;
  color: #1f1f1f;
}

.input::placeholder,
.textarea::placeholder {
  color: #8a94a6;
}

.textarea {
  min-height: 120px;
  resize: none;
}

.primary {
  padding: 12px 0;
  border: none;
  border-radius: 18px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 15px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.2);
  width: 100%;
}

.primary[disabled] {
  opacity: 0.6;
}


.collections-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collections-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.collections-subtitle {
  font-size: 12px;
  color: #8a94a6;
}

.collection-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.collection-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collection-cover {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.collection-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.collection-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.collection-meta {
  font-size: 12px;
  color: #8a94a6;
}

.link-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 12px;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 13px;
}

.link-btn[disabled] {
  opacity: 0.5;
}

.collection-empty {
  font-size: 12px;
  color: #8a94a6;
}

.empty {
  margin-top: 80px;
  background: #ffffff;
  border-radius: 20px;
  padding: 30px 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  text-align: center;
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

.outline {
  padding: 10px 24px;
  border-radius: 16px;
  border: 1px solid rgba(31, 122, 236, 0.4);
  background: transparent;
  color: #1f7aec;
  font-size: 14px;
}

.delete-icon {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border: none;
  border-radius: 50%;
  background: rgba(217, 48, 37, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.9);
  color: #ffffff;
  font-size: 14px;
  box-shadow: 0 4px 10px rgba(217, 48, 37, 0.25);
}
</style>
