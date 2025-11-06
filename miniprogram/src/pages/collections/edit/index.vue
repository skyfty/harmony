<template>
  <view class="page collection-edit">
    <view class="header">
      <text class="title">作品集编辑</text>
      <text class="subtitle" v-if="selectedWorks.length">已选 {{ selectedWorks.length }} 个作品</text>
      <text class="subtitle" v-else>请选择作品后再编辑</text>
    </view>

    <view v-if="selectedWorks.length" class="selected-card">
      <text class="section-title">刚上传的作品</text>
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

    <view v-if="selectedWorks.length" class="form-card">
      <text class="section-title">新建作品集</text>
      <input class="input" v-model="title" placeholder="输入作品集标题" />
      <textarea class="textarea" v-model="description" placeholder="补充作品集描述"></textarea>
      <button class="primary" :disabled="!canCreate" @tap="createNewCollection">{{ submitting ? '创建中…' : '创建并保存' }}</button>
    </view>

    <view class="existing-card">
      <text class="section-title">添加到已有作品集</text>
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
      <view v-else class="empty-hint">暂未创建作品集，先新建一个吧。</view>
    </view>

    <view v-if="!selectedWorks.length" class="empty">
      <text class="empty-title">暂无待处理作品</text>
      <text class="empty-desc">请返回上传页面选择素材后再试</text>
      <button class="outline" @tap="goUpload">返回上传</button>
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

const selectedWorks = computed<WorkItem[]>(() =>
  workIds.value
    .map((id) => worksStore.workMap[id])
    .filter((item): item is WorkItem => Boolean(item)),
);

const canCreate = computed(
  () => selectedWorks.value.length > 0 && title.value.trim().length > 0 && !submitting.value,
);

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

function goUpload() {
  uni.redirectTo({ url: '/pages/upload/index' });
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
    content: `确定从本次上传列表中移除“${target.name}”吗？`,
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
  flex-direction: column;
  gap: 6px;
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
  margin-bottom: 12px;
}

.selected-card,
.form-card,
.existing-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 560px;
  align-self: center;
}

.selected-card {
  align-items: stretch;
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

.empty-hint {
  font-size: 13px;
  color: #8a94a6;
}

.empty {
  margin-top: 40px;
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
  width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border: none;
  border-radius: 50%;
  background: rgba(217, 48, 37, 0.9);
  color: #ffffff;
  font-size: 12px;
  box-shadow: 0 4px 10px rgba(217, 48, 37, 0.25);
}
</style>
