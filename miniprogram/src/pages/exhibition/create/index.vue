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

        <view class="schedule">
          <view class="schedule-item">
            <text class="label">开始时间</text>
            <input
              class="field"
              type="date"
              :value="form.startDate"
              @input="updateField('startDate', $event)"
            />
          </view>
          <view class="schedule-item">
            <text class="label">结束时间</text>
            <input
              class="field"
              type="date"
              :value="form.endDate"
              @input="updateField('endDate', $event)"
            />
          </view>
        </view>
      </view>

      <view class="form-card">
        <view class="section-header">
          <text class="section-title">关联作品集</text>
          <text class="section-hint">可选</text>
        </view>
        <view v-if="collectionOptions.length" class="collection-grid">
          <view
            v-for="collection in collectionOptions"
            :key="collection.id"
            class="collection-item"
            :class="{ 'is-selected': isCollectionSelected(collection.id) }"
            @tap="toggleCollection(collection.id)"
          >
            <view class="collection-header">
              <text class="collection-title">{{ collection.title }}</text>
              <text class="collection-count">{{ collection.workCount }} 件</text>
            </view>
            <text class="collection-desc">{{ collection.description }}</text>
          </view>
        </view>
        <view v-else class="empty-tip">暂无作品集，请先创建作品集后再尝试。</view>
      </view>

      <view class="form-card">
        <view class="section-header">
          <text class="section-title">选择展品</text>
          <text class="section-hint">点击卡片选择，支持多选</text>
        </view>
        <view v-if="workOptions.length" class="work-list">
          <view
            v-for="work in workOptions"
            :key="work.id"
            class="work-item"
            :class="{ 'is-selected': isWorkSelected(work.id) }"
            @tap="toggleWorkSelection(work.id)"
          >
            <image class="work-thumb" :src="work.thumbnailUrl || work.fileUrl" mode="aspectFill" />
            <view class="work-info">
              <text class="work-name">{{ work.title || '未命名作品' }}</text>
              <text class="work-meta">{{ formatWorkMeta(work) }}</text>
            </view>
            <button
              class="cover-toggle"
              :class="{ 'is-cover': isCoverSelected(work.id) }"
              @tap.stop="toggleCoverWork(work)"
            >
              {{ isCoverSelected(work.id) ? '封面' : '设为封面' }}
            </button>
          </view>
        </view>
        <view v-else class="empty-tip">尚未上传作品，完成上传后可在此选择展品。</view>
      </view>

      <view class="form-card">
        <view class="section-header">
          <text class="section-title">展览封面</text>
          <text class="section-hint">至少选择一张展示图，可从作品中勾选或手动添加</text>
        </view>
        <view class="cover-preview" v-if="coverPreview.length">
          <view
            v-for="item in coverPreview"
            :key="item.url"
            class="cover-preview__item"
          >
            <image class="cover-preview__image" :src="item.url" mode="aspectFill" />
            <view class="cover-preview__overlay">
              <text class="cover-preview__badge">{{ item.source === 'work' ? '作品' : '自定义' }}</text>
              <button class="cover-preview__remove" @tap.stop="removeCover(item)">×</button>
            </view>
          </view>
        </view>
        <view class="manual-cover">
          <input
            class="manual-input"
            type="text"
            placeholder="输入图片链接，例如 https://"
            :value="manualCoverInput"
            @input="onManualCoverInput"
            @confirm="addManualCover"
          />
          <button class="manual-add" @tap="addManualCover">添加</button>
        </view>
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

type FormKey = 'name' | 'description' | 'startDate' | 'endDate';

const loading = ref(false);
const submitting = ref(false);
const editingId = ref('');

const form = reactive<Record<FormKey, string>>({
  name: '',
  description: '',
  startDate: '',
  endDate: '',
});

const selectedCollectionIds = ref<string[]>([]);
const selectedWorkIds = ref<string[]>([]);
const coverWorkIds = ref<string[]>([]);
const manualCoverUrls = ref<string[]>([]);
const manualCoverInput = ref('');

const availableCollections = ref<CollectionSummary[]>([]);
const availableWorks = ref<WorkSummary[]>([]);

const isEditing = computed(() => Boolean(editingId.value));

const collectionOptions = computed(() =>
  availableCollections.value.map((collection) => ({
    id: collection.id,
    title: collection.title || '未命名作品集',
    description: collection.description || '暂无描述',
    workCount: collection.workCount ?? (collection.works ? collection.works.length : 0),
  })),
);

const workOptions = computed(() =>
  availableWorks.value.map((work) => ({
    ...work,
    title: work.title || '未命名作品',
  })),
);

const worksMap = computed(() => {
  const map = new Map<string, WorkSummary>();
  availableWorks.value.forEach((work) => map.set(work.id, work));
  return map;
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
  await initialize();
});

async function initialize(): Promise<void> {
  loading.value = true;
  uni.showLoading({ title: '加载中', mask: true });
  try {
    await fetchOptions();
    if (editingId.value) {
      await loadExhibition(editingId.value);
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
}

async function loadExhibition(id: string): Promise<void> {
  const detail = await apiGetExhibition(id);
  applyDetail(detail);
}

function applyDetail(detail: ExhibitionSummary): void {
  form.name = detail.name;
  form.description = detail.description ?? '';
  form.startDate = detail.startDate ? formatDateInput(detail.startDate) : '';
  form.endDate = detail.endDate ? formatDateInput(detail.endDate) : '';

  selectedCollectionIds.value = Array.isArray(detail.collectionIds) ? [...detail.collectionIds] : [];

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
}

function updateField(key: FormKey, event: any): void {
  form[key] = event?.detail?.value ?? '';
}

function toggleCollection(id: string): void {
  const set = new Set(selectedCollectionIds.value);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  selectedCollectionIds.value = Array.from(set);
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

function isCollectionSelected(id: string): boolean {
  return selectedCollectionIds.value.includes(id);
}

function isWorkSelected(id: string): boolean {
  return selectedWorkIds.value.includes(id);
}

function isCoverSelected(id: string): boolean {
  return coverWorkIds.value.includes(id);
}

function formatWorkMeta(work: WorkSummary): string {
  const type = work.mediaType === 'video' ? '视频' : work.mediaType === 'model' ? '模型' : '图片';
  return `${type} · ${formatDateLabel(work.updatedAt || work.createdAt)}`;
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
  const payload = {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    startDate: form.startDate || undefined,
    endDate: form.endDate || undefined,
    workIds: Array.from(new Set([...selectedWorkIds.value, ...coverWorkIds.value])),
    collectionIds: selectedCollectionIds.value,
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

function formatDateInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(iso?: string): string {
  if (!iso) {
    return '刚刚';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '刚刚';
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

.schedule {
  display: flex;
  gap: 16px;
}

.schedule-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.collection-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.collection-item {
  padding: 14px;
  border-radius: 16px;
  border: 1px dashed rgba(31, 122, 236, 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(31, 122, 236, 0.04);
}

.collection-item.is-selected {
  border-style: solid;
  border-color: #1f7aec;
  background: rgba(31, 122, 236, 0.1);
}

.collection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collection-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.collection-count {
  font-size: 12px;
  color: #5f6b83;
}

.collection-desc {
  font-size: 12px;
  color: #5f6b83;
  line-height: 1.5;
}

.empty-tip {
  font-size: 12px;
  color: #8a94a6;
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
  padding: 12px;
  border-radius: 16px;
  background: rgba(31, 122, 236, 0.04);
  border: 1px dashed rgba(31, 122, 236, 0.24);
}

.work-item.is-selected {
  border-style: solid;
  border-color: #1f7aec;
  background: rgba(31, 122, 236, 0.12);
}

.work-thumb {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background: #e3e9f2;
}

.work-info {
  flex: 1;
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

.cover-toggle {
  padding: 6px 12px;
  border-radius: 14px;
  border: none;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 12px;
}

.cover-toggle.is-cover {
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
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
