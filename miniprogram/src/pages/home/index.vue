<template>
  <view class="page home">
    <view class="header">
      <view>
        <text class="header-title">最新展览</text>
        <text class="header-sub">雕塑展、绘画展、数字艺术</text>
      </view>
  <view class="search-icon" @tap="goSearch"></view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">最新展览</text>
        <text class="section-more" @tap="goExhibitionList">更多</text>
      </view>
      <view class="works-grid">
        <view class="work-card" v-for="card in latestExhibitions" :key="card.id" @tap="openExhibition(card.id)">
          <view class="work-thumb" :style="{ background: card.gradient }"></view>
          <view class="work-info">
            <text class="work-name">{{ card.name }}</text>
            <text class="work-meta">{{ card.meta }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">最佳展览</text>
        <text class="section-more" @tap="goExhibitionList">更多</text>
      </view>
      <view class="works-grid">
        <view class="work-card" v-for="card in bestExhibitions" :key="card.id" @tap="openExhibition(card.id)">
          <view class="work-thumb" :style="{ background: card.gradient }"></view>
          <view class="work-info">
            <text class="work-name">{{ card.name }}</text>
            <text class="work-meta">{{ card.meta }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">最佳作品</text>
        <text class="section-more" @tap="goWorksList">更多</text>
      </view>
      <view class="works-grid">
        <view class="work-card" v-for="work in bestWorks" :key="work.id" @tap="openWorkDetail(work.id)">
          <view class="work-thumb" :style="{ background: work.gradient }"></view>
          <view class="work-info">
            <text class="work-name">{{ work.name }}</text>
            <text class="work-meta">{{ work.meta }}</text>
          </view>
        </view>
      </view>
    </view>

    <BottomNav active="home" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { useWorksStore } from '@/stores/worksStore';
import type { ExhibitionItem, WorkItem } from '@/stores/worksStore';

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'optimize';

type ExhibitionCard = {
  id: string;
  name: string;
  meta: string;
  gradient: string;
};

type WorkCard = {
  id: string;
  name: string;
  meta: string;
  gradient: string;
};

const worksStore = useWorksStore();

onShow(async () => {
  try {
    await Promise.all([worksStore.ensureExhibitions(), worksStore.ensureWorks()]);
  } catch (error) {
    console.error('Failed to preload home page data', error);
  }
});

function formatExhibitionMeta(item: ExhibitionItem): string {
  const candidates = [item.dateRange, item.workCount ? `${item.workCount} 件作品` : '', formatRatingMeta(item.rating, item.ratingCount)];
  const result = candidates.filter(Boolean).join(' · ');
  return result || '查看详情';
}

function formatRatingMeta(rating: number, count: number): string {
  if (!rating) {
    return count ? `${count} 人评分` : '';
  }
  const label = rating >= 4.95 ? '满分' : rating.toFixed(1);
  return count ? `评分 ${label}（${count}）` : `评分 ${label}`;
}

function sortByUpdated(a: ExhibitionItem, b: ExhibitionItem): number {
  const parse = (value?: string) => {
    if (!value) {
      return 0;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  };
  return parse(b.updatedAt || b.createdAt) - parse(a.updatedAt || a.createdAt);
}

const latestExhibitions = computed<ExhibitionCard[]>(() =>
  worksStore.exhibitions
    .slice()
    .sort(sortByUpdated)
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      name: item.name,
      meta: formatExhibitionMeta(item),
      gradient: item.cover,
    })),
);

const bestExhibitions = computed<ExhibitionCard[]>(() =>
  worksStore.exhibitions
    .slice()
    .sort((a, b) => {
      if (b.rating === a.rating) {
        return (b.likesCount ?? 0) - (a.likesCount ?? 0);
      }
      return b.rating - a.rating;
    })
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      name: item.name,
      meta: formatExhibitionMeta(item),
      gradient: item.cover,
    })),
);

const bestWorks = computed<WorkCard[]>(() =>
  worksStore.works
    .slice()
    .sort((a, b) => {
      if (b.rating === a.rating) {
        return b.likes - a.likes;
      }
      return b.rating - a.rating;
    })
    .slice(0, 4)
    .map((item: WorkItem) => ({
      id: item.id,
      name: item.name,
      meta: `评分 ${item.rating.toFixed(1)} · 喜欢 ${item.likes}`,
      gradient: item.gradient,
    })),
);

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  upload: '/pages/upload/index',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  optimize: '/pages/optimize/index',
};

function handleNavigate(target: NavKey) {
  const route = routes[target];
  if (!route) {
    return;
  }
  uni.redirectTo({ url: route });
}

function goWorksList() {
  uni.navigateTo({ url: '/pages/works/index' });
}

function openExhibition(id: string) {
  uni.navigateTo({ url: `/pages/exhibition/detail/index?id=${id}` });
}

function goSearch() {
  uni.navigateTo({ url: '/pages/search/index' });
}

function goExhibitionList() {
  uni.navigateTo({ url: '/pages/exhibition/index' });
}

function openWorkDetail(id: string) {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 96px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.header-sub {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  color: #8a94a6;
}

.search-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.25), rgba(126, 198, 255, 0.15));
  position: relative;
}

.search-icon::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 7px;
  border: 3px solid #ffffff;
  left: 10px;
  top: 9px;
}

.search-icon::after {
  content: '';
  position: absolute;
  width: 6px;
  height: 3px;
  background: #ffffff;
  border-radius: 2px;
  right: 9px;
  bottom: 10px;
  transform: rotate(45deg);
}

.hero-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-radius: 20px;
  background: linear-gradient(140deg, #8bb8ff 0%, #b0d1ff 52%, #d2e3ff 100%);
  color: #ffffff;
  box-shadow: 0 12px 32px rgba(63, 151, 255, 0.25);
}

.hero-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hero-title {
  font-size: 20px;
  font-weight: 600;
}

.hero-desc {
  font-size: 14px;
  opacity: 0.9;
}

.hero-link {
  padding: 10px 16px;
  border-radius: 16px;
  border: none;
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
  font-size: 14px;
}

.work-stats {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(31, 122, 236, 0.08);
  padding: 4px 8px;
  border-radius: 10px;
  font-size: 11px;
  color: #1f1f1f;
}

.stat-item:last-child .stat-icon {
  color: #ff6f91;
}

.stat-icon {
  color: #ffaf42;
  font-size: 11px;
}

.stat-value {
  font-size: 12px;
}
.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
  margin-bottom: 12px;
}

.category-scroll {
  display: flex;
  flex-direction: row;
  gap: 12px;
}

.category-tag {
  padding: 10px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(31, 122, 236, 0.12), rgba(126, 198, 255, 0.12));
  color: #1f7aec;
  font-size: 14px;
  margin-right: 12px;
}

.section {
  background: #ffffff;
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 6px 18px rgba(31, 122, 236, 0.06);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.section-more {
  font-size: 14px;
  color: #1f7aec;
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.work-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.work-thumb {
  width: 100%;
  height: 110px;
  border-radius: 18px;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.12);
}

.work-info {
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
  color: #8a94a6;
}
</style>
