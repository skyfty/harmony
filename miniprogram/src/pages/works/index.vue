<template>
  <view class="page works">
    <view class="header">
      <text class="title">作品库</text>
      <text class="subtitle">共 {{ filteredWorks.length }} 个作品</text>
    </view>

    <view class="collection-filter">
      <scroll-view scroll-x class="filter-scroll" show-scrollbar="false">
        <view
          class="filter-chip"
          :class="{ active: activeCollection === 'all' }"
          @tap="setActiveCollection('all')"
        >全部</view>
        <view
          class="filter-chip"
          v-for="collection in collections"
          :key="collection.id"
          :class="{ active: activeCollection === collection.id }"
          @tap="setActiveCollection(collection.id)"
        >{{ collection.title }}</view>
      </scroll-view>
    </view>

    <view class="works-grid">
      <view class="work-card" v-for="item in filteredWorks" :key="item.id">
        <view class="thumb" :style="{ background: item.gradient }" @tap="openDetail(item.id)">
          <text class="thumb-title">{{ item.name }}</text>
        </view>
        <view class="work-info">
          <view class="work-meta">
            <text class="work-size">{{ item.size }}</text>
            <text class="work-time">更新 {{ item.time }}</text>
          </view>
          <view class="work-stats">
            <view class="stat-item">
              <text class="stat-icon">★</text>
              <text class="stat-value">{{ item.rating.toFixed(1) }}</text>
            </view>
            <view class="stat-item">
              <text class="stat-icon">❤</text>
              <text class="stat-value">{{ item.likes }}</text>
            </view>
          </view>
        </view>
        <button class="delete-btn" @tap.stop="confirmDelete(item.id)">删除</button>
      </view>
    </view>

    <view v-if="!filteredWorks.length" class="empty">
      <text class="empty-title">暂未上传作品</text>
      <text class="empty-desc">在上传页面添加作品后会显示在这里</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useWorksStore, type WorkItem } from '@/stores/worksStore';

const worksStore = useWorksStore();
const { works, collections } = storeToRefs(worksStore);
const activeCollection = ref<string>('all');
const filteredWorks = computed<WorkItem[]>(() => worksStore.worksByCollection(activeCollection.value));

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
}

function confirmDelete(id: string) {
  const target = works.value.find((item) => item.id === id);
  if (!target) {
    return;
  }
  uni.showModal({
    title: '删除作品',
    content: `确定删除作品“${target.name}”吗？`,
    confirmColor: '#d93025',
    success: (res) => {
      if (res.confirm) {
        worksStore.deleteWork(id);
        uni.showToast({ title: '已删除', icon: 'none' });
      }
    },
  });
}

function setActiveCollection(id: string) {
  activeCollection.value = id;
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 40px;
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

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 14px;
  color: #8a94a6;
}

.collection-filter {
  background: #ffffff;
  border-radius: 16px;
  padding: 8px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.06);
}

.filter-scroll {
  display: flex;
  flex-direction: row;
  gap: 10px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  font-size: 13px;
  color: #4b566b;
  margin-right: 10px;
}

.filter-chip.active {
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  box-shadow: 0 8px 20px rgba(31, 122, 236, 0.2);
}

.works-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.work-card {
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: relative;
}

.thumb {
  height: 160px;
  border-radius: 16px;
  display: flex;
  align-items: flex-end;
  padding: 16px;
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}

.thumb-title {
  background: rgba(0, 0, 0, 0.25);
  padding: 6px 10px;
  border-radius: 12px;
}

.work-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.work-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #5f6b83;
}

.work-stats {
  display: flex;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(31, 122, 236, 0.08);
  padding: 6px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: #1f1f1f;
}

.stat-icon {
  color: #ffaf42;
  font-size: 12px;
}

.stat-item:nth-child(2) .stat-icon {
  color: #ff6f91;
}

.delete-btn {
  position: absolute;
  right: 16px;
  top: 16px;
  padding: 6px 12px;
  border: none;
  border-radius: 12px;
  background: rgba(217, 48, 37, 0.85);
  color: #ffffff;
  font-size: 12px;
  box-shadow: 0 6px 16px rgba(217, 48, 37, 0.2);
}

.empty {
  margin-top: 40px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  color: #8a94a6;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.empty-desc {
  font-size: 13px;
  color: #8a94a6;
}
</style>
