<template>
  <view class="page create-exhibition">
    <view class="header">
      <text class="title">{{ isEditing ? '编辑展览' : '新增展览' }}</text>
      <text class="subtitle">完善展览信息并发布到展厅</text>
    </view>

    <view v-if="loading" class="loading-state">
      <text class="loading-text">正在加载展览数据…</text>
    </view>

    <template v-else>
      <view class="form-card">
        <view class="form-item">
          <text class="label">展览标题</text>
          <input
            class="field"
            type="text"
            placeholder="请输入展览名称"
            :value="form.name"
            @input="updateField('name', $event)"
          />
        </view>

        <view class="form-item">
          <text class="label">展览简介</text>
          <textarea
            class="textarea"
            placeholder="简要描述展览亮点、策展思路等内容"
            :value="form.description"
            @input="updateField('description', $event)"
          />
        </view>

      </view>

      <view class="form-card">
        <view class="section-header">
          <text class="section-title">关联作品集</text>
          <text class="section-hint">选择一个作品集作为展览来源</text>
        </view>
        <view v-if="collectionOptions.length" class="collection-picker">
          <picker
            class="collection-picker__picker"
            mode="selector"
            :range="collectionOptions"
            range-key="title"
            :value="collectionPickerValue"
            @change="handleCollectionChange"
          >
            <view class="collection-picker__trigger">
              <view class="collection-picker__info">
                <text v-if="selectedCollection" class="collection-picker__title">
                  {{ selectedCollection?.title || '未命名作品集' }}
                </text>
                <text v-else class="collection-picker__placeholder">请选择作品集（可选“无”清除）</text>
                <text v-if="selectedCollection" class="collection-picker__count">共 {{ selectedCollectionWorkCount }} 件作品</text>
              </view>
              <text class="collection-picker__arrow">⌵</text>
            </view>
          </picker>
        </view>
        <view v-else class="empty-tip">暂无作品集，请先创建作品集后再尝试。</view>
        <view v-if="selectedCollection" class="collection-preview">
          <text class="collection-preview__desc">{{ selectedCollection?.description || '暂无描述' }}</text>
        </view>
      </view>

      <view class="form-card">
        <view class="section-header">
          <text class="section-title">选择展品</text>
          <text class="section-hint">请先选择作品集，再从中挑选展品</text>
        </view>
        <view v-if="!hasCollectionSelected" class="empty-tip">请选择作品集后显示可用展品。</view>
        <view v-else-if="workOptions.length" class="work-list">
          <view
            v-for="(work, index) in workOptions"
            :key="work.id"
            class="work-item"
            :class="[getWorkTileClass(index), { 'is-selected': isWorkSelected(work.id), 'is-cover': isCoverSelected(work.id) }]"
            @tap="toggleWorkSelection(work.id)"
          >
            <image class="work-thumb" :src="work.thumbnailUrl || work.fileUrl" mode="aspectFill" />
            <view class="work-item__overlay" :class="{ 'is-visible': isWorkSelected(work.id) }" />
            <view v-if="isWorkSelected(work.id)" class="work-item__badge">
              <text class="work-item__badge-icon">{{ isCoverSelected(work.id) ? '📌' : '✓' }}</text>
              <text class="work-item__badge-text">{{ isCoverSelected(work.id) ? '封面图' : '已选择' }}</text>
            </view>
            <button
              class="cover-toggle"
              :class="{ 'is-cover': isCoverSelected(work.id) }"
              @tap.stop="toggleCoverWork(work)"
            >
              <text class="cover-toggle__text">{{ isCoverSelected(work.id) ? '取消封面' : '设为封面' }}</text>
            </button>
          </view>
        </view>
        <view v-else class="empty-tip">该作品集暂无作品，请先在作品集中添加作品。</view>
      </view>

      
      <button class="submit-btn" :disabled="submitting" @tap="submit">
        {{ submitting ? '保存中…' : isEditing ? '保存修改' : '立即创建' }}
      </button>
    </template>
  </view>
</template>
<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import {
  apiCreateExhibition,
  apiGetCollections,
  apiGetExhibition,
  apiGetWorks,
  apiUpdateExhibition,
  type CollectionSummary,
  type ExhibitionSummary,
  type WorkSummary,
} from '@/api/miniprogram';

type FormKey = 'name' | 'description';

interface CollectionOption {
  id: string;
  title: string;
  description: string;
  workCount: number;
}

const loading = ref(false);
const submitting = ref(false);
const editingId = ref('');

const form = reactive<Record<FormKey, string>>({
  name: '',
  description: '',
});

const selectedCollectionId = ref<string>('');
const selectedWorkIds = ref<string[]>([]);
const coverWorkIds = ref<string[]>([]);
const manualCoverUrls = ref<string[]>([]);
const manualCoverInput = ref('');

const availableCollections = ref<CollectionSummary[]>([]);
const availableWorks = ref<WorkSummary[]>([]);

const isEditing = computed(() => Boolean(editingId.value));

const collectionOptions = computed<CollectionOption[]>(() => {
  const options = availableCollections.value.map((collection) => ({
    id: collection.id,
    title: collection.title || '未命名作品集',
    description: collection.description || '暂无描述',
    workCount: collection.workCount ?? (collection.works ? collection.works.length : 0),
  }));
  return [{ id: '', title: '无', description: '不选择作品集', workCount: 0 }, ...options];
});

const selectedCollection = computed(() =>
  availableCollections.value.find((collection) => collection.id === selectedCollectionId.value) ?? null,
);

const selectedCollectionWorkCount = computed(() => {
  if (!selectedCollection.value) {
    return 0;
  }
  return selectedCollection.value.workCount ?? (selectedCollection.value.works?.length ?? 0);
});

const collectionPickerValue = computed(() => {
  if (!collectionOptions.value.length) {
    return 0;
  }
  const index = collectionOptions.value.findIndex((item) => item.id === selectedCollectionId.value);
  return index >= 0 ? index : 0;
});

const hasCollectionSelected = computed(() => Boolean(selectedCollection.value));

const worksMap = computed(() => {
  const map = new Map<string, WorkSummary>();
  availableWorks.value.forEach((work) => {
    map.set(work.id, work);
  });
  availableCollections.value.forEach((collection) => {
    (collection.works ?? []).forEach((work) => {
      if (!map.has(work.id)) {
        map.set(work.id, work);
      }
    });
  });
  return map;
});

const workOptions = computed(() => {
  if (!selectedCollection.value) {
    return [] as WorkSummary[];
  }
  const works = selectedCollection.value.works ?? [];
  return works
    .map((work) => worksMap.value.get(work.id) ?? work)
    .filter((work): work is WorkSummary => Boolean(work))
    .map((work) => ({
      ...work,
      title: work.title || '未命名作品',
    }));
});

const coverPreview = computed(() => {
  const seen = new Set<string>();
  const items: Array<{ url: string; source: 'work' | 'manual'; id?: string }> = [];
  coverWorkIds.value.forEach((id) => {
    const work = worksMap.value.get(id);
    if (!work) {
      return;
    }
    const url = work.thumbnailUrl || work.fileUrl || '';
    if (url && !seen.has(url)) {
      seen.add(url);
      items.push({ url, source: 'work', id });
    }
  });
  manualCoverUrls.value.forEach((url) => {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    items.push({ url: trimmed, source: 'manual' });
  });
  return items;
});

onLoad(async (options) => {
  editingId.value = typeof options?.id === 'string' ? options.id : '';
  const preselectedCollectionId = typeof options?.collectionId === 'string' ? options.collectionId : '';
  await initialize(preselectedCollectionId);
});

async function initialize(preselectedCollectionId?: string): Promise<void> {
  loading.value = true;
  uni.showLoading({ title: '加载中', mask: true });
  try {
    await fetchOptions();
    if (editingId.value) {
      await loadExhibition(editingId.value);
    } else if (preselectedCollectionId) {
      // Pre-select the collection passed from collections detail page
      const collectionIndex = availableCollections.value.findIndex(c => c.id === preselectedCollectionId);
      if (collectionIndex !== -1) {
        selectedCollectionId.value = preselectedCollectionId;
        syncSelectedWorksForCollection(preselectedCollectionId);
      }
    }
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
  } finally {
    loading.value = false;
    uni.hideLoading();
  }
}

async function fetchOptions(): Promise<void> {
  const [collectionResponse, worksResponse] = await Promise.all([
    apiGetCollections().catch(() => ({ collections: [] as CollectionSummary[], total: 0 })),
    apiGetWorks({ owner: 'me' }).catch(() => ({ works: [] as WorkSummary[], total: 0 })),
  ]);
  availableCollections.value = collectionResponse.collections ?? [];
  availableWorks.value = (worksResponse.works ?? []).slice(0, 100);
  syncSelectedWorksForCollection(selectedCollectionId.value);
}

async function loadExhibition(id: string): Promise<void> {
  const detail = await apiGetExhibition(id);
  applyDetail(detail);
}

function applyDetail(detail: ExhibitionSummary): void {
  form.name = detail.name;
  form.description = detail.description ?? '';
  const workIds = Array.isArray(detail.works) ? detail.works.map((work) => work.id) : [];
  const uniqueWorkIds = new Set<string>(workIds);
  selectedWorkIds.value = Array.from(uniqueWorkIds);

  const existingWorkIds = new Set(availableWorks.value.map((work) => work.id));
  detail.works.forEach((work) => {
    if (!existingWorkIds.has(work.id)) {
      availableWorks.value.push(work);
      existingWorkIds.add(work.id);
    }
  });

  const coverUrls = detail.coverUrls && detail.coverUrls.length
    ? detail.coverUrls
    : detail.coverUrl
      ? [detail.coverUrl]
      : [];
  const matchedCoverIds: string[] = [];
  const unmatched: string[] = [];
  coverUrls.forEach((url) => {
    const match = detail.works.find((work) => work.thumbnailUrl === url || work.fileUrl === url);
    if (match) {
      matchedCoverIds.push(match.id);
    } else if (url) {
      unmatched.push(url);
    }
  });
  coverWorkIds.value = Array.from(new Set(matchedCoverIds));
  manualCoverUrls.value = Array.from(new Set(unmatched));
  selectedWorkIds.value = Array.from(new Set([...selectedWorkIds.value, ...coverWorkIds.value]));

  const primaryCollectionId = Array.isArray(detail.collectionIds) && detail.collectionIds.length ? detail.collectionIds[0] : '';
  selectedCollectionId.value = primaryCollectionId;
  syncSelectedWorksForCollection(primaryCollectionId);
}

function updateField(key: FormKey, event: any): void {
  form[key] = event?.detail?.value ?? '';
}

function handleCollectionChange(event: any): void {
  const index = Number(event?.detail?.value ?? -1);
  if (!Number.isInteger(index) || index < 0 || index >= collectionOptions.value.length) {
    return;
  }
  const target = collectionOptions.value[index];
  selectedCollectionId.value = target?.id ?? '';
  syncSelectedWorksForCollection(selectedCollectionId.value);
}

function clearCollectionSelection(): void {
  if (!selectedCollectionId.value) {
    return;
  }
  selectedCollectionId.value = '';
  syncSelectedWorksForCollection('');
}

function toggleWorkSelection(id: string): void {
  const set = new Set(selectedWorkIds.value);
  if (set.has(id)) {
    set.delete(id);
    coverWorkIds.value = coverWorkIds.value.filter((coverId) => coverId !== id);
  } else {
    set.add(id);
  }
  selectedWorkIds.value = Array.from(set);
}

function toggleCoverWork(work: WorkSummary): void {
  const workId = work.id;
  const set = new Set(coverWorkIds.value);
  if (set.has(workId)) {
    set.delete(workId);
  } else {
    set.add(workId);
    if (!isWorkSelected(workId)) {
      selectedWorkIds.value = [...selectedWorkIds.value, workId];
    }
  }
  coverWorkIds.value = Array.from(set);
}

function isWorkSelected(id: string): boolean {
  return selectedWorkIds.value.includes(id);
}

function isCoverSelected(id: string): boolean {
  return coverWorkIds.value.includes(id);
}

const tileClassPattern = ['tile-square', 'tile-portrait', 'tile-landscape', 'tile-wide'];

function getWorkTileClass(index: number): string {
  return tileClassPattern[index % tileClassPattern.length];
}

function syncSelectedWorksForCollection(collectionId: string): void {
  if (!collectionId) {
    selectedWorkIds.value = [];
    coverWorkIds.value = [];
    return;
  }
  const collection = availableCollections.value.find((item) => item.id === collectionId);
  if (!collection) {
    selectedWorkIds.value = [];
    coverWorkIds.value = [];
    return;
  }
  const allowedIds = new Set((collection.works ?? []).map((work) => work.id));
  selectedWorkIds.value = selectedWorkIds.value.filter((id) => allowedIds.has(id));
  coverWorkIds.value = coverWorkIds.value.filter((id) => allowedIds.has(id));
}

function onManualCoverInput(event: any): void {
  manualCoverInput.value = event?.detail?.value ?? '';
}

function addManualCover(): void {
  const url = manualCoverInput.value.trim();
  if (!url) {
    uni.showToast({ title: '请输入链接', icon: 'none' });
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    uni.showToast({ title: '请输入有效的 http(s) 链接', icon: 'none' });
    return;
  }
  const set = new Set(manualCoverUrls.value);
  set.add(url);
  manualCoverUrls.value = Array.from(set);
  manualCoverInput.value = '';
}

function removeCover(item: { url: string; source: 'work' | 'manual'; id?: string }): void {
  if (item.source === 'work' && item.id) {
    coverWorkIds.value = coverWorkIds.value.filter((id) => id !== item.id);
  } else {
    manualCoverUrls.value = manualCoverUrls.value.filter((url) => url !== item.url);
  }
}

function validateForm(): boolean {
  if (!form.name.trim()) {
    uni.showToast({ title: '请输入展览标题', icon: 'none' });
    return false;
  }
  const combinedWorkIds = getCombinedWorkIds();
  if (combinedWorkIds.length === 0) {
    uni.showToast({ title: '请至少选择一个展品', icon: 'none' });
    return false;
  }
  if (coverPreview.value.length === 0) {
    uni.showToast({ title: '请至少选择一张封面图片', icon: 'none' });
    return false;
  }
  return true;
}

async function submit(): Promise<void> {
  if (submitting.value) {
    return;
  }
  if (!validateForm()) {
    return;
  }
  submitting.value = true;
  const coverUrls = coverPreview.value.map((item) => item.url);
  const workIds = getCombinedWorkIds();
  const payload = {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    workIds,
    collectionIds: selectedCollectionId.value ? [selectedCollectionId.value] : [],
    coverUrls,
  };
  try {
    const response = isEditing.value
      ? await apiUpdateExhibition(editingId.value, payload)
      : await apiCreateExhibition(payload);
    uni.showToast({ title: isEditing.value ? '已保存' : '创建成功', icon: 'success' });
    setTimeout(() => {
      uni.redirectTo({ url: `/pages/exhibition/detail/index?id=${response.id}` });
    }, 400);
  } catch (error) {
    uni.showToast({ title: getErrorMessage(error), icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function getCombinedWorkIds(): string[] {
  return Array.from(new Set([...selectedWorkIds.value, ...coverWorkIds.value]));
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
</script>
<style scoped lang="scss">
.page {
  padding: 24px 20px 120px;
  padding-top: 84px;
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
  gap: 8px;
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

.loading-state {
  margin-top: 40px;
  padding: 20px;
  border-radius: 16px;
  background: rgba(31, 122, 236, 0.08);
  text-align: center;
  color: #5f6b83;
}

.loading-text {
  font-size: 14px;
}

.form-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 14px;
  color: #1f1f1f;
  font-weight: 600;
}

.field {
  padding: 12px 14px;
  border-radius: 14px;
  background: #f0f4fb;
  font-size: 14px;
  color: #1f1f1f;
  border: none;
}

.textarea {
  min-height: 110px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f0f4fb;
  font-size: 14px;
  color: #1f1f1f;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.section-hint {
  font-size: 12px;
  color: #8a94a6;
}

.collection-picker {
  display: flex;
  gap: 10px;
  align-items: center;
}

.collection-picker__picker {
  flex: 1;
}

.collection-picker__trigger {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px;
  border-radius: 16px;
  background: rgba(31, 122, 236, 0.04);
  border: 1px dashed rgba(31, 122, 236, 0.24);
}

.collection-picker__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.collection-picker__title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.collection-picker__placeholder {
  font-size: 13px;
  color: #8a94a6;
}

.collection-picker__count {
  font-size: 12px;
  color: #5f6b83;
}

.collection-picker__arrow {
  font-size: 18px;
  color: #8a94a6;
  padding-left: 10px;
}

.collection-picker__clear {
  padding: 10px 16px;
  border-radius: 14px;
  border: none;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 13px;
}

.collection-preview {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  color: #5f6b83;
  font-size: 12px;
  line-height: 1.6;
}

.collection-preview__desc {
  display: block;
  color: #5f6b83;
}

.empty-tip {
  font-size: 12px;
  color: #8a94a6;
}

.work-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
  gap: 16px;
}

.work-item {
  position: relative;
  overflow: hidden;
  border-radius: 20px;
  height: 180px;
  background: linear-gradient(145deg, #dbe3f4, #f0f4fb);
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.12);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.work-item.is-selected {
  transform: translateY(-4px) scale(1.01);
  box-shadow: 0 26px 48px rgba(31, 122, 236, 0.28);
}

.work-item.is-cover {
  box-shadow: 0 32px 56px rgba(31, 122, 236, 0.35);
}

.work-item.is-cover .work-item__overlay {
  background: linear-gradient(155deg, rgba(255, 198, 92, 0.55), rgba(31, 122, 236, 0.3));
}

.work-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tile-square {
  height: 180px;
}

.tile-portrait {
  height: 220px;
}

.tile-landscape {
  height: 150px;
}

.tile-wide {
  height: 200px;
  grid-column: span 2;
}

.work-item__overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(155deg, rgba(31, 122, 236, 0.45), rgba(98, 166, 255, 0.32));
  opacity: 0;
  transition: opacity 0.25s ease, background 0.25s ease;
}

.work-item__overlay.is-visible {
  opacity: 1;
}

.work-item__badge {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.88);
  color: #15479c;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 18px 34px rgba(31, 122, 236, 0.28);
  animation: badge-pop 0.26s ease;
}

.work-item__badge-icon {
  font-size: 14px;
}

.work-item__badge-text {
  line-height: 1;
}

@keyframes badge-pop {
  0% {
    transform: translateY(6px) scale(0.9);
    opacity: 0;
  }
  100% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

.cover-toggle {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 8px 14px;
  border: none;
  border-radius: 999px;
  background: rgba(12, 30, 66, 0.72);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 18px 36px rgba(12, 30, 66, 0.32);
  transition: transform 0.2s ease, background 0.2s ease;
}

.cover-toggle:active {
  transform: scale(0.94);
}

.cover-toggle.is-cover {
  background: linear-gradient(135deg, #ffb347, #ff6969);
  box-shadow: 0 20px 40px rgba(255, 120, 92, 0.38);
}

.cover-toggle__text {
  line-height: 1;
}

.cover-preview {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.cover-preview__item {
  position: relative;
  width: 96px;
  height: 72px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 20px rgba(31, 122, 236, 0.12);
}

.cover-preview__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-preview__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 6px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.35), transparent 60%);
}

.cover-preview__badge {
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 10px;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.28);
}

.cover-preview__remove {
  width: 20px;
  height: 20px;
  border-radius: 12px;
  border: none;
  background: rgba(0, 0, 0, 0.45);
  color: #ffffff;
  font-size: 12px;
  line-height: 20px;
}

.manual-cover {
  display: flex;
  gap: 10px;
  align-items: center;
}

.manual-input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 14px;
  background: #f0f4fb;
  font-size: 13px;
  border: none;
}

.manual-add {
  padding: 10px 16px;
  border-radius: 16px;
  border: none;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 13px;
}

.submit-btn {
  margin-top: auto;
  width: 100%;
  padding: 14px 0;
  border-radius: 20px;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 16px 32px rgba(31, 122, 236, 0.22);
}

.submit-btn[disabled] {
  opacity: 0.6;
}
</style>
