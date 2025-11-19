<template>
  <view class="page work-records">
    <view class="header">
      <text class="title">创作记录</text>
      <button class="clear-btn" v-if="records.length" @tap="clearAll">清除全部</button>
    </view>

    <view class="history-card" v-if="records.length">
      <view class="history-list">
        <view class="history-item" v-for="item in sortedRecords" :key="item.id">
          <view class="history-preview" :style="{ background: item.gradient }"></view>
          <view class="history-info">
            <text class="history-name">{{ item.name }}</text>
            <text class="history-meta">{{ item.size }} · {{ formatTime(item.createdAt) }}</text>
          </view>
          <text class="history-status">{{ item.status }}</text>
          <button class="delete-btn" @tap.stop="confirmDelete(item.id)">删除</button>
        </view>
      </view>
    </view>

    <view class="empty" v-else>
      <text class="empty-title">暂无创作记录</text>
      <text class="empty-desc">完成作品创作后可在此管理与清理记录</text>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';

const STORAGE_KEY = 'workHistory';
const LEGACY_STORAGE_KEY = 'uploadHistory';

type HistoryItem = {
  id: string;
  name: string;
  size: string;
  time?: string;
  status: string;
  gradient: string;
  createdAt: number;
};

function loadHistory(): HistoryItem[] {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY);
    let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !Array.isArray(parsed)) {
      const legacyRaw = uni.getStorageSync(LEGACY_STORAGE_KEY);
      parsed = typeof legacyRaw === 'string' ? JSON.parse(legacyRaw) : legacyRaw;
      if (Array.isArray(parsed)) {
        saveHistory(parsed);
      }
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(list: HistoryItem[]) {
  try {
    uni.setStorageSync(STORAGE_KEY, list);
  } catch {}
}

const records = ref<HistoryItem[]>(loadHistory());

const sortedRecords = computed(() =>
  [...records.value].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
);

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${mm}-${dd}`;
}

function confirmDelete(id: string) {
  uni.showModal({
    title: '删除确认',
    content: '确认删除该创作记录吗？',
    confirmColor: '#d93025',
    success: (res) => {
      if (!res.confirm) return;
      records.value = records.value.filter((r) => r.id !== id);
      saveHistory(records.value);
      uni.showToast({ title: '已删除', icon: 'none' });
    },
  });
}

function clearAll() {
  uni.showModal({
    title: '清除所有确认',
    content: '确认清除所有创作记录吗？',
    confirmColor: '#d93025',
    success: (res) => {
      if (!res.confirm) return;
      records.value = [];
      saveHistory(records.value);
      uni.showToast({ title: '已清除', icon: 'none' });
    },
  });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 40px;
  padding-top: 84px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
}

.clear-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 12px;
  background: rgba(217, 48, 37, 0.1);
  color: #d93025;
  font-size: 12px;
}

.history-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.history-preview {
  width: 56px;
  height: 56px;
  border-radius: 16px;
}

.history-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-name {
  font-size: 14px;
  color: #263248;
  font-weight: 600;
}

.history-meta {
  font-size: 12px;
  color: #8a94a6;
}

.history-status {
  font-size: 12px;
  color: #1f7aec;
}

.delete-btn {
  margin-left: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #ff7a7a, #d93025);
  color: #ffffff;
  font-size: 12px;
  box-shadow: 0 8px 16px rgba(217, 48, 37, 0.2);
}

.empty {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
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
