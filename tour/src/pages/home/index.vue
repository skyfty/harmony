<template>
  <view class="page">
    <view class="header">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索景区名称"
          confirm-type="search"
        />
        <text v-if="keyword" class="clear-icon" @tap="keyword = ''">✕</text>
      </view>
    </view>

    <view class="content">
      <view class="section-title">
        <text class="section-text">景区推荐</text>
      </view>
      <view class="grid">
        <ScenicCard
          v-for="scenic in filtered"
          :key="scenic.id"
          :name="scenic.name"
          :summary="scenic.summary"
          :cover-url="scenic.coverUrl"
          v-bind="scenic.rating !== undefined ? { rating: scenic.rating } : {}"
          @tap="openDetail(scenic.id)"
        />
      </view>

      <view class="section-title">
        <text class="section-text">热门活动</text>
      </view>
      <view class="activity">
        <view v-for="event in events" :key="event.id" class="activity-card">
          <text class="activity-title">{{ event.title }}</text>
          <text class="activity-desc">{{ event.description }}</text>
        </view>
      </view>
    </view>

    <BottomNav active="scenic" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BottomNav from '@/components/BottomNav.vue';
import ScenicCard from '@/components/ScenicCard.vue';
import { listHotEvents, listScenics } from '@/api/mini';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import type { ScenicSummary } from '@/types/scenic';

const keyword = ref('');
const scenics = ref<ScenicSummary[]>([]);
const events = ref<{ id: string; title: string; description: string }[]>([]);

async function reload() {
  const [scenicsRes, eventsRes] = await Promise.all([listScenics(), listHotEvents()]);
  scenics.value = scenicsRes;
  events.value = eventsRes.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
  }));
}

onMounted(() => {
  void reload().catch(() => {
    uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

const filtered = computed(() => {
  const k = keyword.value.trim();
  if (!k) return scenics.value;
  return scenics.value.filter((s) => s.name.includes(k) || s.summary.includes(k));
});

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/scenic/detail?id=${encodeURIComponent(id)}` });
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
}

.header {
  padding: 16px 16px 10px;
}

.search-box {
  background: #ffffff;
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.search-icon {
  font-size: 14px;
  color: #8a94a6;
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.clear-icon {
  font-size: 14px;
  color: #a8b0c1;
}

.content {
  padding: 0 16px 18px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 0 10px;
}

.section-text {
  font-size: 14px;
  font-weight: 600;
  color: #1a1f2e;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.activity {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.activity-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.activity-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #1a1f2e;
}

.activity-desc {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #5f6b83;
}
</style>
