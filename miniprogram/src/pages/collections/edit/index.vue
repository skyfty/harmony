<template>
  <view class="page collection-edit">
    <view class="header">
      <view class="header-info">
        <text class="title">作品集编辑</text>
        <text class="subtitle">{{ headerSubtitle }}</text>
      </view>
    </view>

    <view v-if="!displayItems.length" class="empty">
      <text class="empty-title">暂无待处理作品</text>
      <text class="empty-desc">点击下方按钮添加作品</text>
      <button class="primary" @tap="goWork">添加作品</button>
    </view>

    <view v-if="displayItems.length" class="cover-card">
      <view class="cover-card__top">
        <view class="cover-card__info">
          <text class="cover-card__title">作品集封面</text>
          <text class="cover-card__subtitle">{{ coverHint }}</text>
        </view>
        <view class="cover-card__actions">
          <button class="cover-action" @tap="chooseCoverFromDevice">选择封面</button>
          <button
            v-if="hasCustomCover"
            class="cover-action cover-action--muted"
            @tap="resetCover"
          >
            使用默认封面
          </button>
        </view>
      </view>
      <view class="cover-card__preview" @tap="previewCoverImage">
        <image
          v-if="coverPreview"
          class="cover-card__image"
          :src="coverPreview"
          mode="aspectFill"
        />
        <view v-else class="cover-card__placeholder" :style="{ background: previewGradient }">
          <text class="cover-card__placeholder-text">暂无封面</text>
        </view>
      </view>
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
          @tap="openWorkPreview(item)"
        >
          <image v-if="item.preview" class="work-thumb__image" :src="item.preview" mode="aspectFill" />
          <view v-else class="work-thumb__placeholder">暂无预览</view>
          <view v-if="item.kind === 'pending'" class="work-thumb__badge">待上传</view>
          <view class="work-thumb__footer">
            <text class="work-thumb__name">
              {{ (editableEntries[item.id] && editableEntries[item.id].name) || item.name }}
            </text>
          </view>
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
        <text class="collections-subtitle" v-if="existingCollectionsSummary">{{ existingCollectionsSummary }}</text>
      </view>
      <view v-if="collectionsLoading" class="collection-empty">加载中…</view>
      <view v-else-if="collectionsError" class="collection-empty">{{ collectionsError }}</view>
      <view v-else-if="existingCollections.length" class="collection-list">
        <view class="collection-item" v-for="collection in existingCollections" :key="collection.id">
          <view class="collection-cover" :style="{ background: collection.background }"></view>
          <view class="collection-info">
            <text class="collection-title">{{ collection.title }}</text>
            <text class="collection-meta">共 {{ collection.workCount }} 个作品</text>
          </view>
          <button class="link-btn" :disabled="!canAppendToExisting" @tap="appendToCollection(collection.id)">
            添加
          </button>
        </view>
      </view>
      <view v-else class="collection-empty">暂未创建作品集，先新建一个吧。</view>
    </view>

    <view v-if="previewModal.visible" class="preview-modal">
      <view class="preview-modal__mask" @tap="closeWorkPreview"></view>
      <view
        class="preview-modal__panel"
        @tap.stop
        @touchstart.stop="handlePreviewTouchStart"
        @touchmove.stop.prevent="handlePreviewTouchMove"
        @touchend.stop="handlePreviewTouchEnd"
        @touchcancel.stop="handlePreviewTouchCancel"
      >
        <button class="preview-modal__close" @tap="closeWorkPreview">×</button>
        <view
          class="preview-modal__media"
          :style="{ background: previewModal.preview ? '#000' : previewModal.gradient }"
        >
          <image
            v-if="previewModal.preview"
            class="preview-modal__image"
            :src="previewModal.preview"
            mode="aspectFill"
          />
          <view v-else class="preview-modal__placeholder">暂无预览</view>
          <view v-if="previewModal.kind === 'pending'" class="preview-modal__badge">待上传</view>
        </view>
        <view class="preview-modal__content">
          <text class="preview-modal__title">
            {{ previewModal.kind === 'existing' ? '作品详情' : '待上传作品' }}
          </text>
          <view class="preview-modal__stats">
            <text>大小：{{ previewModal.sizeLabel }}</text>
            <text v-if="previewModal.kind === 'existing'">喜欢：{{ previewModal.likes }}</text>
            <text v-if="previewModal.kind === 'existing'">评分：{{ previewModal.rating }}</text>
          </view>
          <text class="preview-modal__label">作品名称</text>
          <input
            class="preview-modal__input"
            v-model="previewModal.name"
            placeholder="输入作品名称"
          />
          <text class="preview-modal__label preview-modal__label--spaced">作品描述</text>
          <textarea
            class="preview-modal__textarea"
            v-model="previewModal.description"
            placeholder="补充作品描述"
          />
          <view class="preview-modal__actions">
            <button class="preview-modal__btn preview-modal__btn--delete" @tap="handlePreviewRemove">删除</button>
            <button class="preview-modal__btn preview-modal__btn--save" @tap="applyPreviewEdits">保存</button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, reactive, ref, watch, watchEffect } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import {
  apiListResourceCategories,
  apiUploadAsset,
  apiGetCollections,
  type CollectionSummary,
} from '@/api/miniprogram';
import { useWorksStore, type WorkItem, type PendingWorkUpload, type NewWorkInput } from '@/stores/worksStore';
import { formatWorkSize, prependWorkHistoryEntry } from '@/utils/workHistory';

const worksStore = useWorksStore();
const collectionsLoading = ref(false);
const collectionsError = ref('');
const editingCollectionId = ref('');
const isEditingExistingCollection = computed(() => Boolean(editingCollectionId.value));

type ExistingCollectionOption = {
  id: string;
  title: string;
  background: string;
  workCount: number;
  summary: CollectionSummary;
};

const existingCollections = ref<ExistingCollectionOption[]>([]);
const existingCollectionsSummary = computed(() =>
  existingCollections.value.length ? `共 ${existingCollections.value.length} 个可选` : '',
);

const currentUserId = computed(() => worksStore.profile?.user?.id ?? '');

const workIds = ref<string[]>([]);
const title = ref('');
const description = ref('');
const submitting = ref(false);
const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';

type LocalCoverSelection = {
  source: 'local';
  filePath: string;
  name: string;
  uploadedUrl?: string;
};

const coverSelection = ref<LocalCoverSelection | null>(null);

const selectedExistingWorks = computed<WorkItem[]>(() =>
  workIds.value
    .map((id) => worksStore.workMap[id])
    .filter((item): item is WorkItem => Boolean(item)),
);

const pendingUploads = computed<PendingWorkUpload[]>(() => worksStore.pendingUploads);

type DisplayItem = {
  id: string;
  name: string;
  description: string;
  gradient: string;
  preview?: string;
  rating: number;
  likes: number;
  sizeLabel: string;
  kind: 'existing' | 'pending';
  work?: WorkItem;
  upload?: PendingWorkUpload;
};

type EditableEntry = {
  id: string;
  kind: 'existing' | 'pending';
  name: string;
  description: string;
  originalName: string;
  originalDescription: string;
};

const editableEntries = reactive<Record<string, EditableEntry>>({});

type PreviewModalState = {
  visible: boolean;
  itemId: string;
  index: number;
  kind: DisplayItem['kind'];
  preview: string;
  gradient: string;
  name: string;
  description: string;
  sizeLabel: string;
  likes: number;
  rating: number;
};

const previewModal = reactive<PreviewModalState>({
  visible: false,
  itemId: '',
  index: -1,
  kind: 'existing',
  preview: '',
  gradient: defaultGradient,
  name: '',
  description: '',
  sizeLabel: '',
  likes: 0,
  rating: 0,
});

type PreviewSwipeState = {
  active: boolean;
  startX: number;
  startY: number;
  deltaX: number;
  lockDirection: '' | 'horizontal' | 'vertical';
};

const previewSwipe = reactive<PreviewSwipeState>({
  active: false,
  startX: 0,
  startY: 0,
  deltaX: 0,
  lockDirection: '',
});

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

const rawDisplayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = [];
  selectedExistingWorks.value.forEach((work) => {
    items.push({
      id: work.id,
      name: work.name,
      description: work.description ?? '',
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
      description: upload.description ?? '',
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

const displayItems = computed<DisplayItem[]>(() =>
  rawDisplayItems.value.map((item) => {
    const editable = editableEntries[item.id];
    if (!editable) {
      return item;
    }
    return {
      ...item,
      name: editable.name,
      description: editable.description,
    };
  }),
);

watch(
  rawDisplayItems,
  (items) => {
    const nextIds = new Set(items.map((item) => item.id));
    Object.keys(editableEntries).forEach((id) => {
      if (!nextIds.has(id)) {
        delete editableEntries[id];
      }
    });
    items.forEach((item) => {
      const current = editableEntries[item.id];
      if (!current) {
        editableEntries[item.id] = {
          id: item.id,
          kind: item.kind,
          name: item.name,
          description: item.description,
          originalName: item.name,
          originalDescription: item.description,
        };
        return;
      }
      current.kind = item.kind;
      current.originalName = item.name;
      current.originalDescription = item.description;
    });
  },
  { immediate: true },
);

const selectedCount = computed(() => displayItems.value.length);

const canCreate = computed(
  () => selectedCount.value > 0 && title.value.trim().length > 0 && !submitting.value,
);

const canAppendToExisting = computed(
  () => (selectedExistingWorks.value.length > 0 || pendingUploads.value.length > 0) && !submitting.value,
);

const headerSubtitle = computed(() =>
  selectedCount.value ? `已选 ${selectedCount.value} 个作品` : '请选择作品后再编辑',
);

const previewGradient = computed(() => displayItems.value[0]?.gradient || defaultGradient);
const coverPreview = computed(() => {
  if (coverSelection.value) {
    return coverSelection.value.filePath;
  }
  return displayItems.value[0]?.preview || '';
});
const hasCustomCover = computed(() => Boolean(coverSelection.value));
const coverHint = computed(() => {
  if (hasCustomCover.value) {
    return '封面来源：本地图片';
  }
  if (displayItems.value[0]?.preview) {
    return '自动使用第一个作品的缩略图';
  }
  return '使用默认背景呈现封面';
});

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

const statBlocks = computed(() => {
  const blocks = [{ icon: '🖼', value: selectedCount.value.toString(), label: '已选作品' }];
  if (isEditingExistingCollection.value) {
    blocks.push(
      { icon: '★', value: averageRating.value, label: '平均评分' },
      { icon: '❤', value: totalLikes.value, label: '收到喜欢' },
    );
  }
  return blocks;
});

watch(
  displayItems,
  (items) => {
    if (!items.length) {
      coverSelection.value = null;
    }
  },
  { immediate: false },
);

watch(
  displayItems,
  (items) => {
    if (!previewModal.visible) {
      return;
    }
    const index = items.findIndex((candidate) => candidate.id === previewModal.itemId);
    if (index === -1) {
      closeWorkPreview();
      return;
    }
    const current = items[index];
    updatePreviewModalFromItem(current, index);
  },
  { deep: true },
);

onLoad((options) => {
  const rawId = typeof options?.id === 'string' ? options.id : '';
  editingCollectionId.value = rawId ? decodeURIComponent(rawId) : '';

  const rawWorkIds = typeof options?.workIds === 'string' ? options.workIds : '';
  if (rawWorkIds) {
    const decoded = decodeURIComponent(rawWorkIds);
    workIds.value = Array.from(new Set(decoded.split(',').filter(Boolean)));
  }
  void initializeCollections();
});

onShow(() => {
  void loadExistingCollections();
});

watch(
  () => currentUserId.value,
  (id, previous) => {
    if (previous && id && id !== previous) {
      void loadExistingCollections({ force: true });
    }
  },
);

// 仅在首次进入且用户未手动编辑时，帮助生成一个默认标题；
// 一旦用户编辑过标题（包括清空），不再强制回填。
const hasAutoTitled = ref(false);
watchEffect(() => {
  if (!hasAutoTitled.value && !title.value && displayItems.value.length) {
    title.value = `${displayItems.value[0].name} 系列`;
    hasAutoTitled.value = true;
  }
});

function findRawItem(id: string): DisplayItem | undefined {
  return rawDisplayItems.value.find((candidate) => candidate.id === id);
}

function resolveFallbackName(entry: EditableEntry, ...fallbacks: Array<string | undefined>): string {
  if (entry.originalName && entry.originalName.trim()) {
    return entry.originalName.trim();
  }
  for (const candidate of fallbacks) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '未命名作品';
}

function sanitizeWorkName(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function sanitizeWorkDescription(value: string): string {
  return value.trim();
}

function syncPendingEntries() {
  pendingUploads.value.forEach((upload) => {
    let entry = editableEntries[upload.id];
    const raw = findRawItem(upload.id);
    const fallbackEntry: EditableEntry = entry ?? {
      id: upload.id,
      kind: 'pending',
      name: upload.name,
      description: upload.description ?? '',
      originalName: upload.name,
      originalDescription: upload.description ?? '',
    };
    const fallback = resolveFallbackName(fallbackEntry, raw?.name, upload.name);
    const name = sanitizeWorkName(entry?.name ?? upload.name, fallback);
    const description = sanitizeWorkDescription(entry?.description ?? upload.description ?? '');
    if (!entry) {
      entry = {
        ...fallbackEntry,
        name,
        description,
      };
      editableEntries[upload.id] = entry;
    } else {
      entry.name = name;
      entry.description = description;
    }
    worksStore.updatePendingUpload(upload.id, { name, description });
    entry.originalName = name;
    entry.originalDescription = description;
  });
}

function updatePreviewModalFromItem(item: DisplayItem, index: number) {
  previewModal.itemId = item.id;
  previewModal.index = index;
  previewModal.kind = item.kind;
  previewModal.preview = item.preview || '';
  previewModal.gradient = item.gradient;
  previewModal.sizeLabel = item.sizeLabel;
  previewModal.likes = item.likes;
  previewModal.rating = item.rating;
  const entry = editableEntries[item.id];
  previewModal.name = entry ? entry.name : item.name;
  previewModal.description = entry ? entry.description : item.description;
}

function openWorkPreview(item: DisplayItem) {
  const items = displayItems.value;
  const index = items.findIndex((candidate) => candidate.id === item.id);
  updatePreviewModalFromItem(item, index >= 0 ? index : 0);
  previewModal.visible = true;
}

function closeWorkPreview() {
  previewModal.visible = false;
  previewModal.itemId = '';
  previewModal.index = -1;
}

function applyPreviewEdits(options: { closeAfterSave?: boolean; showToast?: boolean } = {}): boolean {
  const { closeAfterSave = true, showToast = true } = options;
  if (!previewModal.itemId) {
    if (closeAfterSave) {
      closeWorkPreview();
    }
    return false;
  }
  const item = rawDisplayItems.value.find((candidate) => candidate.id === previewModal.itemId);
  if (!item) {
    closeWorkPreview();
    return false;
  }
  let entry = editableEntries[item.id];
  const fallbackEntry: EditableEntry = entry ?? {
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.description,
    originalName: item.name,
    originalDescription: item.description,
  };
  const fallback = resolveFallbackName(fallbackEntry, item.name, worksStore.workMap[item.id]?.name, previewModal.name);
  const name = sanitizeWorkName(previewModal.name, fallback);
  const description = sanitizeWorkDescription(previewModal.description);
  if (!entry) {
    entry = {
      ...fallbackEntry,
      name,
      description,
    };
    editableEntries[item.id] = entry;
  } else {
    entry.name = name;
    entry.description = description;
  }
  if (entry.kind === 'pending') {
    worksStore.updatePendingUpload(item.id, { name, description });
    entry.originalName = name;
    entry.originalDescription = description;
  }
  const trimmedOriginal = previewModal.name.trim();
  previewModal.name = name;
  previewModal.description = description;
  if (showToast) {
    const message = trimmedOriginal ? '已保存' : '作品名称不能为空，已恢复原名称';
    uni.showToast({ title: message, icon: 'none' });
  }
  if (closeAfterSave) {
    closeWorkPreview();
  }
  return true;
}

function navigatePreview(direction: 'next' | 'prev') {
  if (!previewModal.visible) {
    return;
  }
  const items = displayItems.value;
  if (!items.length) {
    return;
  }
  applyPreviewEdits({ closeAfterSave: false, showToast: false });
  const currentIndex = previewModal.index >= 0 ? previewModal.index : items.findIndex((item) => item.id === previewModal.itemId);
  if (currentIndex === -1) {
    closeWorkPreview();
    return;
  }
  const step = direction === 'next' ? 1 : -1;
  const nextIndex = (currentIndex + step + items.length) % items.length;
  const nextItem = items[nextIndex];
  updatePreviewModalFromItem(nextItem, nextIndex);
}

function handlePreviewRemove() {
  if (!previewModal.itemId) {
    return;
  }
  confirmRemove(previewModal.itemId);
}

function handlePreviewTouchStart(event: TouchEvent) {
  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }
  previewSwipe.active = true;
  previewSwipe.startX = touch.clientX;
  previewSwipe.startY = touch.clientY;
  previewSwipe.deltaX = 0;
  previewSwipe.lockDirection = '';
}

function handlePreviewTouchMove(event: TouchEvent) {
  if (!previewSwipe.active) {
    return;
  }
  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }
  const dx = touch.clientX - previewSwipe.startX;
  const dy = touch.clientY - previewSwipe.startY;
  if (!previewSwipe.lockDirection) {
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      previewSwipe.lockDirection = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
  }
  if (previewSwipe.lockDirection === 'horizontal') {
    event.preventDefault();
  }
  previewSwipe.deltaX = dx;
}

function handlePreviewTouchEnd() {
  if (!previewSwipe.active) {
    return;
  }
  if (previewSwipe.lockDirection === 'horizontal') {
    const threshold = 50;
    if (previewSwipe.deltaX > threshold) {
      navigatePreview('prev');
    } else if (previewSwipe.deltaX < -threshold) {
      navigatePreview('next');
    }
  }
  previewSwipe.active = false;
  previewSwipe.deltaX = 0;
  previewSwipe.lockDirection = '';
}

function handlePreviewTouchCancel() {
  previewSwipe.active = false;
  previewSwipe.deltaX = 0;
  previewSwipe.lockDirection = '';
}

async function applyExistingWorkEdits(): Promise<void> {
  const candidates = Object.values(editableEntries).filter((entry) => entry.kind === 'existing');
  for (const entry of candidates) {
    const raw = findRawItem(entry.id);
    const fallback = resolveFallbackName(entry, raw?.name, worksStore.workMap[entry.id]?.name);
    const name = sanitizeWorkName(entry.name, fallback);
    const description = sanitizeWorkDescription(entry.description);
    const baselineName = entry.originalName.trim() || fallback;
    const baselineDescription = entry.originalDescription.trim();
    const payload: { title?: string; description?: string } = {};
    let changed = false;
    if (name !== baselineName) {
      payload.title = name;
      changed = true;
    }
    if (description !== baselineDescription) {
      payload.description = description;
      changed = true;
    }
    entry.name = name;
    entry.description = description;
    if (!changed) {
      continue;
    }
    try {
      await worksStore.updateWorkMetadata(entry.id, payload);
    } catch (error) {
      throw new Error(`更新“${name}”失败：${getErrorMessage(error)}`);
    }
    const refreshed = worksStore.workMap[entry.id];
    if (refreshed) {
      entry.name = refreshed.name;
      entry.description = refreshed.description ?? '';
      entry.originalName = refreshed.name;
      entry.originalDescription = refreshed.description ?? '';
    } else {
      if (payload.title) {
        entry.originalName = payload.title;
        entry.name = payload.title;
      }
      if (payload.description !== undefined) {
        const normalized = payload.description ?? '';
        entry.originalDescription = normalized;
        entry.description = normalized;
      }
    }
  }
}

async function applyWorkEditsBeforeSubmit(): Promise<void> {
  if (previewModal.visible) {
    applyPreviewEdits({ closeAfterSave: false, showToast: false });
  }
  await applyExistingWorkEdits();
  syncPendingEntries();
}

async function initializeCollections() {
  try {
    await worksStore.ensureProfile();
  } catch (error) {
    console.warn('Failed to ensure profile before loading collections', error);
  }
  await loadExistingCollections({ force: true });
}

async function loadExistingCollections(options: { force?: boolean } = {}) {
  if (collectionsLoading.value && !options.force) {
    return;
  }
  collectionsLoading.value = true;
  collectionsError.value = '';
  try {
    if (!currentUserId.value) {
      await worksStore.ensureProfile().catch(() => undefined);
    }
    const response = await apiGetCollections();
    const ownerId = currentUserId.value;
    const source = Array.isArray(response.collections) ? response.collections : [];
    const filtered = ownerId ? source.filter((item) => item.ownerId === ownerId) : source;
    existingCollections.value = filtered.map((collection, index) => mapCollectionOption(collection, index));
  } catch (error) {
    collectionsError.value = getErrorMessage(error);
    existingCollections.value = [];
    uni.showToast({ title: collectionsError.value, icon: 'none' });
  } finally {
  function updatePreviewModalFromItem(item: DisplayItem, index: number) {
    previewModal.itemId = item.id;
    previewModal.index = index;
    previewModal.kind = item.kind;
    previewModal.preview = item.preview || '';
    previewModal.gradient = item.gradient;
    previewModal.sizeLabel = item.sizeLabel;
    previewModal.likes = item.likes;
    previewModal.rating = item.rating;
    const entry = editableEntries[item.id];
    previewModal.name = entry ? entry.name : item.name;
    previewModal.description = entry ? entry.description : item.description;
  }

    collectionsLoading.value = false;
  }
}

function mapCollectionOption(summary: CollectionSummary, index: number): ExistingCollectionOption {
  const gradient = fallbackGradients[index % fallbackGradients.length];
  const coverUrl = extractCollectionCover(summary);
  const background = coverUrl ? `url(${coverUrl}) center/cover no-repeat` : gradient;
  return {
    id: summary.id,
    title: summary.title || '未命名作品集',
    background,
    workCount: typeof summary.workCount === 'number' ? summary.workCount : summary.works?.length ?? 0,
    summary,
  };
}

function extractCollectionCover(summary: CollectionSummary): string {
  const normalized = normalizeAssetUrl(summary.coverUrl);
  if (normalized) {
    return normalized;
  }
  const candidate = (summary.works ?? []).find((work) => work.thumbnailUrl || work.mediaType === 'image');
  if (candidate) {
    return normalizeAssetUrl(candidate.thumbnailUrl || (candidate.mediaType === 'image' ? candidate.fileUrl : ''));
  }
  return '';
}

function normalizeAssetUrl(value?: string | null): string {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('url(')) {
    const match = trimmed.match(/^url\((.*)\)$/i);
    if (match && match[1]) {
      return match[1].replace(/^['"]|['"]$/g, '');
    }
  }
  return trimmed;
}

async function chooseCoverFromDevice() {
  try {
    const result = await uni.chooseImage({
      count: 1,
      sizeType: ['compressed', 'original'],
      sourceType: ['album', 'camera'],
    });
    const filePath = result.tempFilePaths?.[0];
    if (!filePath) {
      return;
    }
    const name = filePath.split('/').pop() || 'collection-cover.jpg';
    coverSelection.value = {
      source: 'local',
      filePath,
      name,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('cancel')) {
      return;
    }
    uni.showToast({ title: '封面选取失败，请重试', icon: 'none' });
  }
}

function resetCover() {
  coverSelection.value = null;
}

function previewCoverImage() {
  const preview = coverPreview.value;
  if (!preview) {
    return;
  }
  uni.previewImage({ current: preview, urls: [preview] });
}

function goWork() {
  worksStore.clearPendingUploads();
  uni.redirectTo({ url: '/pages/works/indite' });
}

async function createNewCollection() {
  if (!canCreate.value) {
    return;
  }
  submitting.value = true;
  uni.showLoading({ title: '处理中…', mask: true });
  try {
    await applyWorkEditsBeforeSubmit();
    const newWorkIds = await uploadPendingWorks();
    const finalWorkIds = Array.from(new Set([...workIds.value, ...newWorkIds]));
    if (!finalWorkIds.length) {
      throw new Error('没有可保存的作品');
    }
    const coverUrl = await resolveCollectionCover(finalWorkIds);
    const collection = await worksStore.createCollection({
      title: title.value.trim(),
      description: description.value.trim() || '尚未填写描述',
      workIds: finalWorkIds,
      ...(coverUrl ? { coverUrl } : {}),
    });
    recordCreationHistory(newWorkIds);
    worksStore.clearPendingUploads();
    workIds.value = finalWorkIds;
    coverSelection.value = null;
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
  syncPendingEntries();
  const categoryId = await resolveImageCategoryId();
  const createdIds: string[] = [];
  const inputs: NewWorkInput[] = [];
  for (const upload of pendingUploads.value) {
    let entry = editableEntries[upload.id];
    const raw = findRawItem(upload.id);
    const fallbackEntry: EditableEntry = entry ?? {
      id: upload.id,
      kind: 'pending',
      name: upload.name,
      description: upload.description ?? '',
      originalName: upload.name,
      originalDescription: upload.description ?? '',
    };
    const fallback = resolveFallbackName(fallbackEntry, raw?.name, upload.name);
    const name = sanitizeWorkName(entry?.name ?? upload.name, fallback);
    const description = sanitizeWorkDescription(entry?.description ?? upload.description ?? '');
    if (!entry) {
      entry = {
        ...fallbackEntry,
        name,
        description,
        originalName: name,
        originalDescription: description,
      };
      editableEntries[upload.id] = entry;
    } else {
      entry.name = name;
      entry.description = description;
      entry.originalName = name;
      entry.originalDescription = description;
    }
    worksStore.updatePendingUpload(upload.id, { name, description });
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
      throw new Error(`上传 ${name} 失败：${message}`);
    }
    inputs.push({
      name,
      fileUrl: asset.url,
      thumbnailUrl: asset.previewUrl ?? asset.url,
      description,
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

async function resolveCollectionCover(finalWorkIds: string[]): Promise<string | undefined> {
  if (coverSelection.value?.source === 'local') {
    if (coverSelection.value.uploadedUrl) {
      return coverSelection.value.uploadedUrl;
    }
    const categoryId = await resolveImageCategoryId();
    try {
      const asset = await apiUploadAsset({
        filePath: coverSelection.value.filePath,
        categoryId,
        fileName: coverSelection.value.name,
        type: 'image',
      });
      const url = asset.previewUrl || asset.url;
      coverSelection.value.uploadedUrl = url;
      return url;
    } catch (error) {
      console.error('Failed to upload cover image', error);
      uni.showToast({ title: '封面上传失败，已采用默认封面', icon: 'none' });
    }
  }
  const firstWorkId = finalWorkIds[0];
  if (!firstWorkId) {
    return undefined;
  }
  const firstWork = worksStore.workMap[firstWorkId];
  if (!firstWork) {
    return undefined;
  }
  return firstWork.thumbnailUrl || firstWork.fileUrl;
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
  const hasExisting = selectedExistingWorks.value.length > 0;
  const hasPending = pendingUploads.value.length > 0;
  if (!hasExisting && !hasPending) {
    uni.showToast({ title: '暂无待添加的作品', icon: 'none' });
    return;
  }
  if (submitting.value) {
    return;
  }
  submitting.value = true;
  const loadingTitle = hasPending ? '正在上传…' : '处理中…';
  uni.showLoading({ title: loadingTitle, mask: true });
  try {
    await applyWorkEditsBeforeSubmit();
    const newWorkIds = await uploadPendingWorks();
    if (newWorkIds.length) {
      recordCreationHistory(newWorkIds);
      workIds.value = Array.from(new Set([...workIds.value, ...newWorkIds]));
    }
    const idsToAppend = Array.from(new Set([...workIds.value]));
    if (!idsToAppend.length) {
      throw new Error('没有可添加的作品');
    }
    await worksStore.addWorksToCollection(idsToAppend, collectionId);
    worksStore.clearPendingUploads();
    coverSelection.value = null;
    uni.hideLoading();
    uni.showToast({ title: '已加入作品集', icon: 'success' });
    setTimeout(() => {
      const encodedId = encodeURIComponent(collectionId);
      uni.redirectTo({ url: `/pages/collections/detail/index?id=${encodedId}` });
    }, 400);
  } catch (error) {
    uni.hideLoading();
    const message = getErrorMessage(error);
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function confirmRemove(id: string) {
  const target = displayItems.value.find((item) => item.id === id);
  if (!target) {
    return;
  }
  if (target.kind === 'existing') {
    workIds.value = workIds.value.filter((workId) => workId !== id);
  } else {
    worksStore.removePendingUpload(id);
  }
  if (editableEntries[id]) {
    delete editableEntries[id];
  }
  uni.showToast({ title: '已移除', icon: 'none' });
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

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return '加载失败，请稍后重试';
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 120px;
  padding-top: 74px;
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

.cover-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cover-card__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.cover-card__info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cover-card__title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.cover-card__subtitle {
  font-size: 12px;
  color: #8a94a6;
}

.cover-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cover-action {
  padding: 6px 12px;
  border-radius: 12px;
  border: 1px solid rgba(31, 122, 236, 0.4);
  background: transparent;
  color: #1f7aec;
  font-size: 13px;
}

.cover-action--muted {
  border-color: rgba(140, 152, 172, 0.5);
  color: #5f6b83;
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

.works-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.work-thumb {
  width: 102px;
  height: 102px;
  border-radius: 14px;
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
}

.work-thumb__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 14px;
}

.work-thumb__placeholder {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

.work-thumb__badge {
  position: absolute;
  left: 8px;
  top: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(31, 122, 236, 0.9);
  color: #fff;
  font-size: 10px;
}

.work-thumb__footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px 8px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(15, 18, 26, 0.78) 100%);
}

.work-thumb__name {
  font-size: 11px;
  color: #ffffff;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  margin-top: 10px;
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

.preview-modal {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-modal__mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.58);
}

.preview-modal__panel {
  position: relative;
  width: 88%;
  max-width: 540px;
  max-height: 90vh;
  background: #ffffff;
  border-radius: 24px;
  padding: 20px;
  box-shadow: 0 22px 60px rgba(31, 122, 236, 0.22);
  display: flex;
  flex-direction: column;
  gap: 16px;
  z-index: 1;
}

.preview-modal__close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 24px;
  line-height: 40px;
  text-align: center;
  z-index: 2;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.28);
}

.preview-modal__media {
  width: 100%;
  height: 220px;
  border-radius: 18px;
  position: relative;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.12);
}

.preview-modal__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-modal__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #556176;
}

.preview-modal__badge {
  position: absolute;
  left: 12px;
  top: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(31, 122, 236, 0.92);
  color: #ffffff;
  font-size: 11px;
}

.preview-modal__content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-modal__title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.preview-modal__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #5f6b83;
}

.preview-modal__label {
  font-size: 12px;
  color: #5f6b83;
}

.preview-modal__label--spaced {
  margin-top: 6px;
}

.preview-modal__input,
.preview-modal__textarea {
  width: 100%;
  border: none;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  padding: 12px 14px;
  font-size: 14px;
  color: #1f1f1f;
}

.preview-modal__input::placeholder,
.preview-modal__textarea::placeholder {
  color: #8a94a6;
}

.preview-modal__textarea {
  min-height: 120px;
  resize: none;
  line-height: 1.6;
}

.preview-modal__actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.preview-modal__btn {
  min-width: 96px;
  padding: 10px 0;
  border-radius: 16px;
  font-size: 14px;
  border: none;
}

.preview-modal__btn--delete {
  background: rgba(217, 48, 37, 0.12);
  color: #d93025;
}

.preview-modal__btn--save {
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.2);
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
