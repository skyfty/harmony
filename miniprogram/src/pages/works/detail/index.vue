<template>
  <view class="page work-detail">
    <view class="header">
      <button class="back-btn" @tap="goBack">返回</button>
      <view class="header-info">
        <text class="title">{{ work?.name || '作品详情' }}</text>
        <text class="subtitle">大小 {{ work?.size }} · {{ work?.time }}</text>
      </view>
      <button class="add-collection-btn" v-if="work" @tap="openCollectionPicker">添加到作品集</button>
    </view>

    <view v-if="work" class="preview" :style="{ background: work.gradient }">
      <text class="preview-label">预览</text>
    </view>

    <view v-if="work" class="stats-card">
      <view class="stat">
        <text class="stat-icon">★</text>
        <text class="stat-value">{{ work.rating.toFixed(1) }}</text>
        <text class="stat-desc">评分</text>
      </view>
      <view class="stat">
        <text class="stat-icon">❤</text>
        <text class="stat-value">{{ work.likes }}</text>
        <text class="stat-desc">喜欢</text>
      </view>
      <view class="stat">
        <text class="stat-icon">⏱</text>
        <text class="stat-value">{{ work.duration }}</text>
        <text class="stat-desc">浏览时长</text>
      </view>
    </view>

    <view v-if="work" class="collections-card">
      <view class="collections-header">
        <text class="collections-title">所属作品集</text>
        <text class="collections-action" @tap="openCollectionPicker">添加</text>
      </view>
      <view v-if="workCollections.length" class="collection-tags">
        <view
          class="collection-tag"
          v-for="collection in workCollections"
          :key="collection.id"
          @tap="openCollectionDetail(collection.id)"
        >
          <text class="collection-name">{{ collection.title }}</text>
          <text class="collection-count">{{ collection.works.length }} 件</text>
        </view>
      </view>
      <view v-else class="collection-empty">
        <text>暂未加入作品集，点击上方添加按钮快速归类。</text>
      </view>
    </view>

    <view v-if="work" class="info-card">
      <text class="info-title">作品简介</text>
      <text class="info-desc">{{ work.description }}</text>
    </view>

    <view v-else class="empty">
      <text class="empty-title">未找到作品</text>
      <text class="empty-desc">请返回作品列表重新选择</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useWorksStore } from '@/stores/worksStore';
import type { CollectionItem } from '@/stores/worksStore';

const worksStore = useWorksStore();
const workId = ref<string>('');

const work = computed(() => (workId.value ? worksStore.workMap[workId.value] : null));
const workCollections = computed<CollectionItem[]>(() => {
  if (!work.value) {
    return [];
  }
  return work.value.collections
    .map((id) => worksStore.collectionMap[id])
    .filter((item): item is CollectionItem => Boolean(item));
});

const optionalCollections = computed<CollectionItem[]>(() => {
  if (!work.value) {
    return worksStore.collections;
  }
  const owned = new Set(work.value.collections);
  return worksStore.collections.filter((item) => !owned.has(item.id));
});

onLoad((query) => {
  const id = query?.id as string | undefined;
  if (!id) {
    return;
  }
  workId.value = id;
});

function goBack() {
  uni.navigateBack();
}

function openCollectionPicker() {
  if (!work.value) {
    return;
  }
  const options = optionalCollections.value.map((item) => item.title);
  const hasOptional = options.length > 0;
  options.push('新建作品集');
  uni.showActionSheet({
    itemList: options,
    success: ({ tapIndex }) => {
      if (tapIndex === options.length - 1) {
        uni.navigateTo({ url: `/pages/collections/edit/index?workIds=${workId.value}` });
        return;
      }
      if (!hasOptional) {
        return;
      }
      const target = optionalCollections.value[tapIndex];
      if (!target) {
        return;
      }
      worksStore.addWorksToCollection([workId.value], target.id);
      uni.showToast({ title: `已加入“${target.title}”`, icon: 'success' });
    },
  });
}

function openCollectionDetail(id: string) {
  uni.navigateTo({ url: `/pages/collections/detail/index?id=${id}` });
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
  color: #1f7aec;
}

.stat:nth-child(1) .stat-icon {
  color: #ffaf42;
}

.stat:nth-child(2) .stat-icon {
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

.info-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.add-collection-btn {
  margin-left: auto;
  padding: 8px 14px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 13px;
}

.collections-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
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

.collections-action {
  font-size: 14px;
  color: #1f7aec;
}

.collection-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.collection-tag {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  color: #1f1f1f;
  font-size: 12px;
}

.collection-name {
  font-weight: 600;
}

.collection-count {
  color: #8a94a6;
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
