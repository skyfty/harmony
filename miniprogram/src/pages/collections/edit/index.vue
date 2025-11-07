<template>
  <view class="page collection-edit">
    <view class="header">
      <view class="header-info">
        <text class="title">作品集编辑</text>
        <text class="subtitle">{{ headerSubtitle }}</text>
      </view>
    </view>

    <view v-if="selectedWorks.length" class="preview" :style="{ background: previewGradient }">
      <text class="preview-label">已选作品</text>
    </view>

    <view v-if="selectedWorks.length" class="stats-card">
      <view class="stat" v-for="item in statBlocks" :key="item.label">
        <text class="stat-icon">{{ item.icon }}</text>
        <text class="stat-value">{{ item.value }}</text>
        <text class="stat-desc">{{ item.label }}</text>
      </view>
    </view>

    <view v-if="selectedWorks.length" class="gallery-card">
      <view class="card-header">
    <text class="card-title">刚创作的作品</text>
        <text class="card-meta">点击右上角可移除单个作品</text>
      </view>
      <view class="works-grid">
        <view
          class="work-thumb"
          v-for="work in selectedWorks"
          :key="work.id"
          :style="{ background: work.gradient }"
        >
          <button class="delete-icon" @tap.stop="confirmRemove(work.id)">×</button>
        </view>
      </view>
    </view>

    <view v-if="selectedWorks.length" class="info-card">
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
          <button class="link-btn" :disabled="!selectedWorks.length" @tap="appendToCollection(collection.id)">
            添加
          </button>
        </view>
      </view>
      <view v-else class="collection-empty">暂未创建作品集，先新建一个吧。</view>
    </view>

    <view v-if="!selectedWorks.length" class="empty">
      <text class="empty-title">暂无待处理作品</text>
  <text class="empty-desc">请返回创作页面选择素材后再试</text>
  <button class="outline" @tap="goWork">返回创作</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { storeToRefs } from 'pinia';
import { useWorksStore, type WorkItem } from '@/stores/worksStore';

const worksStore = useWorksStore();
const { collections } = storeToRefs(worksStore);

const workIds = ref<string[]>([]);
const title = ref('');
const description = ref('');
const submitting = ref(false);
const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';

const selectedWorks = computed<WorkItem[]>(() =>
  workIds.value
    .map((id) => worksStore.workMap[id])
    .filter((item): item is WorkItem => Boolean(item)),
);

const canCreate = computed(
  () => selectedWorks.value.length > 0 && title.value.trim().length > 0 && !submitting.value,
);

const headerSubtitle = computed(() =>
  selectedWorks.value.length
    ? `已选 ${selectedWorks.value.length} 个作品`
    : '请选择作品后再编辑',
);

const previewGradient = computed(() => selectedWorks.value[0]?.gradient || defaultGradient);

const averageRating = computed(() => {
  if (!selectedWorks.value.length) {
    return '--';
  }
  const total = selectedWorks.value.reduce((sum, item) => sum + (item.rating ?? 0), 0);
  const avg = total / selectedWorks.value.length;
  return avg > 0 ? avg.toFixed(1) : '--';
});

const totalLikes = computed(() => {
  if (!selectedWorks.value.length) {
    return '0';
  }
  const sum = selectedWorks.value.reduce((acc, item) => acc + (item.likes ?? 0), 0);
  return formatNumber(sum);
});

const statBlocks = computed(() => [
  { icon: '🖼', value: selectedWorks.value.length.toString(), label: '已选作品' },
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

watchEffect(() => {
  if (!title.value && selectedWorks.value.length) {
    title.value = `${selectedWorks.value[0].name} 系列`;
  }
});

function goWork() {
  uni.redirectTo({ url: '/pages/work/index' });
}

function createNewCollection() {
  if (!canCreate.value) {
    return;
  }
  submitting.value = true;
  const id = worksStore.createCollection({
    title: title.value.trim(),
    description: description.value.trim() || '尚未填写描述',
    workIds: workIds.value,
  });
  submitting.value = false;
  uni.showToast({ title: '已创建', icon: 'success' });
  setTimeout(() => {
    uni.redirectTo({ url: `/pages/collections/detail/index?id=${id}` });
  }, 400);
}

function appendToCollection(collectionId: string) {
  if (!selectedWorks.value.length) {
    uni.showToast({ title: '暂无待添加的作品', icon: 'none' });
    return;
  }
  worksStore.addWorksToCollection(workIds.value, collectionId);
  uni.showToast({ title: '已加入作品集', icon: 'success' });
  setTimeout(() => {
    uni.redirectTo({ url: `/pages/collections/detail/index?id=${collectionId}` });
  }, 400);
}

function confirmRemove(id: string) {
  const target = selectedWorks.value.find((item) => item.id === id);
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
      workIds.value = workIds.value.filter((workId) => workId !== id);
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
