<template>
  <view class="page collection-detail">
    <view class="header">
      <button class="back-btn" @tap="goBack">返回</button>
      <view class="header-info">
        <text class="title">{{ collection?.title || '作品集详情' }}</text>
        <text class="subtitle" v-if="collection">更新于 {{ collection.updatedAt }}</text>
        <text class="subtitle" v-else>正在获取作品集信息</text>
      </view>
    </view>

    <view v-if="collection" class="info-card">
      <text class="section-title">作品集信息</text>
      <input class="input" v-model="editableTitle" placeholder="作品集标题" />
      <textarea class="textarea" v-model="editableDescription" placeholder="作品集描述"></textarea>
      <button class="primary" :disabled="!canSave" @tap="saveCollection">
        {{ saving ? '保存中…' : '保存信息' }}
      </button>
    </view>

    <view v-if="collection" class="works-card">
      <text class="section-title">包含作品</text>
      <view v-if="worksInCollection.length" class="works-grid">
        <view class="work-card" v-for="work in worksInCollection" :key="work.id" :style="{ background: work.gradient }">
          <text class="work-name">{{ work.name }}</text>
          <view class="work-actions">
            <button class="link-btn" @tap="openWorkDetail(work.id)">查看</button>
            <button class="danger-btn" @tap="removeWork(work.id)">移出</button>
          </view>
        </view>
      </view>
      <view v-else class="empty-hint">暂未包含作品，前往作品详情页添加。</view>
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

function goBack() {
  uni.navigateBack({ delta: 1 });
}

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
</script>
<style scoped lang="scss">
.page {
  padding: 20px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 12px;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 13px;
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

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
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
}

.primary[disabled] {
  opacity: 0.6;
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

.work-card {
  min-height: 160px;
  border-radius: 18px;
  padding: 16px;
  color: #ffffff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.work-name {
  font-size: 15px;
  font-weight: 600;
}

.work-actions {
  display: flex;
  gap: 10px;
}

.link-btn,
.danger-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 12px;
  font-size: 12px;
}

.link-btn {
  background: rgba(0, 0, 0, 0.25);
  color: #ffffff;
}

.danger-btn {
  background: rgba(217, 48, 37, 0.85);
  color: #ffffff;
}

.empty-hint {
  font-size: 13px;
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
