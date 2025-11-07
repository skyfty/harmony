<template>
  <view class="page collection-detail">
    <view class="header">
      <view class="header-info">
        <text class="title">{{ collection?.title || '作品集详情' }}</text>
        <text class="subtitle">{{ headerSubtitle }}</text>
      </view>
    </view>

    <view v-if="collection" class="preview" :style="{ background: collection.cover || defaultGradient }">
      <text class="preview-label">作品集封面</text>
    </view>

    <view v-if="collection" class="stats-card">
      <view class="stat" v-for="stat in statBlocks" :key="stat.label">
        <text class="stat-icon">{{ stat.icon }}</text>
        <text class="stat-value">{{ stat.value }}</text>
        <text class="stat-desc">{{ stat.label }}</text>
      </view>
    </view>

    <view v-if="collection" class="info-card">
      <text class="info-title">作品集信息</text>
      <text class="info-desc">调整标题与描述信息可同步更新作品集展示。</text>
      <input class="input" v-model="editableTitle" placeholder="作品集标题" />
      <textarea class="textarea" v-model="editableDescription" placeholder="作品集描述"></textarea>
      <button class="primary" :disabled="!canSave" @tap="saveCollection">{{ saving ? '保存中…' : '保存信息' }}</button>
    </view>

    <view v-if="collection" class="works-card">
      <view class="works-header">
        <text class="works-title">包含作品</text>
        <text class="works-meta">共 {{ worksInCollection.length }} 个</text>
      </view>
      <view v-if="worksInCollection.length" class="works-grid">
        <view class="work-card" v-for="work in worksInCollection" :key="work.id" :style="{ background: work.gradient }">
          <view class="work-info">
            <text class="work-name">{{ work.name }}</text>
            <text class="work-meta">评分 {{ work.rating.toFixed(1) }} · 喜欢 {{ work.likes }}</text>
          </view>
          <view class="work-actions">
            <button class="link-btn" @tap="openWorkDetail(work.id)">查看</button>
            <button class="danger-btn" @tap="removeWork(work.id)">移出</button>
          </view>
        </view>
      </view>
      <view v-else class="collection-empty">暂未包含作品，前往作品详情页添加。</view>
    </view>

    <view v-else class="empty">
      <text class="empty-title">未找到作品集</text>
      <text class="empty-desc">请返回作品集列表或重新选择</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useWorksStore, type WorkItem, type CollectionItem } from '@/stores/worksStore';

const worksStore = useWorksStore();

const collectionId = ref('');
const saving = ref(false);
const editableTitle = ref('');
const editableDescription = ref('');
const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';

const collection = computed<CollectionItem | undefined>(() =>
  collectionId.value ? worksStore.collectionMap[collectionId.value] : undefined,
);

const worksInCollection = computed<WorkItem[]>(() => {
  if (!collection.value) {
    return [];
  }
  return collection.value.works
    .map((id) => worksStore.workMap[id])
    .filter((item): item is WorkItem => Boolean(item));
});

const canSave = computed(() => {
  if (!collection.value || saving.value) {
    return false;
  }
  const title = editableTitle.value.trim();
  const desc = editableDescription.value.trim();
  return title !== collection.value.title || desc !== collection.value.description;
});

const headerSubtitle = computed(() => {
  if (!collection.value) {
    return '正在获取作品集信息';
  }
  const updated = collection.value.updatedAt ? `更新于 ${collection.value.updatedAt}` : '';
  const total = `共 ${collection.value.works.length} 个作品`;
  return [updated, total].filter(Boolean).join('  ');
});

const averageRating = computed(() => {
  if (!worksInCollection.value.length) {
    return '--';
  }
  const total = worksInCollection.value.reduce((sum, item) => sum + (item.rating ?? 0), 0);
  const avg = total / worksInCollection.value.length;
  return avg > 0 ? avg.toFixed(1) : '--';
});

const totalLikes = computed(() => {
  if (!worksInCollection.value.length) {
    return '0';
  }
  const sum = worksInCollection.value.reduce((acc, item) => acc + (item.likes ?? 0), 0);
  return formatNumber(sum);
});

const statBlocks = computed(() => [
  { icon: '🖼', value: worksInCollection.value.length.toString(), label: '作品数量' },
  { icon: '★', value: averageRating.value, label: '平均评分' },
  { icon: '❤', value: totalLikes.value, label: '累计喜欢' },
]);

onLoad((options) => {
  const raw = typeof options?.id === 'string' ? options.id : '';
  if (raw) {
    collectionId.value = decodeURIComponent(raw);
  }
});

watch(
  collection,
  (value) => {
    if (value) {
      editableTitle.value = value.title;
      editableDescription.value = value.description;
    }
  },
  { immediate: true },
);

function saveCollection() {
  if (!collection.value || !canSave.value) {
    return;
  }
  saving.value = true;
  worksStore.updateCollection(collection.value.id, {
    title: editableTitle.value.trim(),
    description: editableDescription.value.trim(),
  });
  saving.value = false;
  uni.showToast({ title: '已保存', icon: 'success' });
}

function openWorkDetail(id: string) {
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
}

function removeWork(id: string) {
  if (!collection.value) {
    return;
  }
  worksStore.removeWorkFromCollection(id, collection.value.id);
  uni.showToast({ title: '已移出', icon: 'none' });
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

.info-desc {
  font-size: 13px;
  color: #5f6b83;
  line-height: 1.6;
}

.input,
.textarea {
  width: 100%;
  border: none;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  padding: 12px 14px;
  font-size: 14px;
  color: #1f1f1f;
}

.textarea {
  min-height: 120px;
  resize: none;
}

.input::placeholder,
.textarea::placeholder {
  color: #8a94a6;
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

.work-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
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

.link-btn,
.danger-btn {
  flex: 0 0 auto;
  padding: 6px 10px;
  border: none;
  border-radius: 10px;
  font-size: 11px;
}

.link-btn {
  background: rgba(0, 0, 0, 0.25);
  color: #ffffff;
}

.danger-btn {
  background: rgba(217, 48, 37, 0.85);
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
