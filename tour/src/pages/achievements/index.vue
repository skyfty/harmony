<template>
  <view class="page">
    <view class="header">
      <view class="search-box">
        <text class="search-icon">🔍</text>
        <input v-model="keyword" class="search-input" type="text" placeholder="搜索成就" />
        <text v-if="keyword" class="clear-icon" @tap="keyword = ''">✕</text>
      </view>
    </view>

    <view class="content">
      <AchievementCard
        v-for="ach in filtered"
        :key="ach.id"
        :title="ach.title"
        :description="ach.description"
        :progress="ach.progress"
        :scenic-id="ach.scenicId"
        @enter="openScenic"
      />
    </view>

    <BottomNav active="achievement" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import BottomNav from '@/components/BottomNav.vue';
import AchievementCard from '@/components/AchievementCard.vue';
import { listAchievements } from '@/mocks/achievements';
import { redirectToNav, type NavKey } from '@/utils/navKey';

const keyword = ref('');
const achievements = computed(() => listAchievements());

const filtered = computed(() => {
  const k = keyword.value.trim();
  if (!k) return achievements.value;
  return achievements.value.filter((a) => a.title.includes(k) || a.description.includes(k));
});

function openScenic(scenicId: string) {
  uni.navigateTo({ url: `/pages/scenic/detail?id=${encodeURIComponent(scenicId)}` });
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: 70px;
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
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
</style>
