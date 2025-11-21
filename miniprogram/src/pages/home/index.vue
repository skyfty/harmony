<template>
  <view class="page home">

    <view class="section">
      <view class="section-header">
        <text class="section-title">最新展览</text>
        <text class="section-more" @tap="goExhibitionListLatest">更多</text>
      </view>
      <view class="works-grid works-grid--masonry">
        <view
          class="work-card"
          v-for="card in latestExhibitions"
          :key="card.id"
          :style="{ background: card.gradient }"
          @tap="openExhibition(card.id)"
        >
          <view class="work-card__preview" :style="{ height: card.previewHeight + 'px' }">
            <image
              v-if="card.previewImage"
              class="work-card__image"
              :src="card.previewImage"
              mode="aspectFill"
            />
            <view v-else class="work-card__placeholder">
              <text>暂无预览</text>
            </view>
            <view class="work-card__stats">
              <view class="stat-item">
                <text class="stat-icon stat-icon--star" :class="{ 'is-active': card.userRating > 0 }">★</text>
                <text class="stat-value">{{ formatRatingValue(card.rating) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--heart" :class="{ 'is-active': card.liked }">❤</text>
                <text class="stat-value">{{ formatCount(card.likes) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">最佳展览</text>
        <text class="section-more" @tap="goExhibitionListBest">更多</text>
      </view>
      <view class="works-grid works-grid--masonry">
        <view
          class="work-card"
          v-for="card in bestExhibitions"
          :key="card.id"
          :style="{ background: card.gradient }"
          @tap="openExhibition(card.id)"
        >
          <view class="work-card__preview" :style="{ height: card.previewHeight + 'px' }">
            <image
              v-if="card.previewImage"
              class="work-card__image"
              :src="card.previewImage"
              mode="aspectFill"
            />
            <view v-else class="work-card__placeholder">
              <text>暂无预览</text>
            </view>
            <view class="work-card__stats">
              <view class="stat-item">
                <text class="stat-icon stat-icon--star" :class="{ 'is-active': card.userRating > 0 }">★</text>
                <text class="stat-value">{{ formatRatingValue(card.rating) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--heart" :class="{ 'is-active': card.liked }">❤</text>
                <text class="stat-value">{{ formatCount(card.likes) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">最佳作品</text>
        <text class="section-more" @tap="goWorksListBest">更多</text>
      </view>
      <view class="works-grid works-grid--masonry">
        <view
          class="work-card"
          v-for="work in bestWorks"
          :key="work.id"
          :style="{ background: work.gradient }"
          @tap="openWorkDetail(work.id)"
        >
          <view class="work-card__preview" :style="{ height: work.previewHeight + 'px' }">
            <image
              v-if="work.previewImage"
              class="work-card__image"
              :src="work.previewImage"
              mode="aspectFill"
            />
            <view v-else class="work-card__placeholder">
              <text>暂无预览</text>
            </view>
            <view class="work-card__stats">
              <view class="stat-item">
                <text class="stat-icon stat-icon--star" :class="{ 'is-active': work.userRating > 0 }">★</text>
                <text class="stat-value">{{ formatRatingValue(work.rating) }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon stat-icon--heart" :class="{ 'is-active': work.liked }">❤</text>
                <text class="stat-value">{{ formatCount(work.likes) }}</text>
              </view>
            </view>
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
import { redirectToNav, type NavKey } from '@/utils/navKey';

type ExhibitionCard = {
  id: string;
  name: string;
  subtitle: string;
  gradient: string;
  rating: number;
  ratingCount: number;
  userRating: number;
  likes: number;
  liked: boolean;
  previewImage: string;
  previewHeight: number;
};

type WorkCard = {
  id: string;
  name: string;
  subtitle: string;
  gradient: string;
  rating: number;
  ratingCount: number;
  userRating: number;
  likes: number;
  liked: boolean;
  previewImage: string;
  previewHeight: number;
};

const worksStore = useWorksStore();

const gradientPalette = [
  'linear-gradient(135deg, #ffe0f2, #ffd0ec)',
  'linear-gradient(135deg, #dff5ff, #c6ebff)',
  'linear-gradient(135deg, #fff0ce, #ffe2a8)',
  'linear-gradient(135deg, #e7e4ff, #f1eeff)',
  'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
  'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
  'linear-gradient(135deg, #b7f5ec, #90e0d9)',
  'linear-gradient(135deg, #ffd59e, #ffe8c9)',
];

const previewHeightPattern = [168, 210, 238, 192, 224, 256];

function ensureBackground(source: string | undefined, index: number): string {
  if (source && source.startsWith('linear-gradient')) {
    return source;
  }
  if (source && source.startsWith('url(')) {
    return source;
  }
  if (source && /^(https?:)?\/\//i.test(source)) {
    return `url(${source})`;
  }
  const paletteIndex = ((index % gradientPalette.length) + gradientPalette.length) % gradientPalette.length;
  return gradientPalette[paletteIndex];
}

function extractCssImage(value?: string): string {
  if (!value) {
    return '';
  }
  const match = value.match(/^url\((.*)\)$/i);
  if (match && match[1]) {
    return match[1].replace(/^['"]|['"]$/g, '');
  }
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) {
    return value;
  }
  return '';
}

function resolvePreviewImage(...sources: Array<string | undefined>): string {
  for (const source of sources) {
    const resolved = extractCssImage(source);
    if (resolved) {
      return resolved;
    }
  }
  return '';
}

function computePreviewHeight(index: number): number {
  const normalizedIndex = Number.isFinite(index) ? index : 0;
  const patternIndex = ((normalizedIndex % previewHeightPattern.length) + previewHeightPattern.length) % previewHeightPattern.length;
  return previewHeightPattern[patternIndex];
}

onShow(async () => {
  try {
    await Promise.all([worksStore.ensureExhibitions(), worksStore.ensureWorks()]);
  } catch (error) {
    console.error('Failed to preload home page data', error);
  }
});

const workTypeLabels: Record<WorkItem['type'], string> = {
  image: '图片',
  video: '视频',
  model: '模型',
  other: '其他',
};

function formatExhibitionSubtitle(item: ExhibitionItem): string {
  const candidates = [item.dateRange, item.workCount ? `${item.workCount} 件作品` : ''];
  const result = candidates.filter(Boolean).join(' · ');
  return result || '查看详情';
}

function formatWorkSubtitle(item: WorkItem): string {
  const typeLabel = workTypeLabels[item.type] || '作品';
  const pieces = [typeLabel, item.time].filter(Boolean);
  return pieces.join(' · ') || '查看详情';
}

function formatRatingValue(value: number): string {
  if (value <= 0) {
    return '--';
  }
  return value >= 4.95 ? '满分' : value.toFixed(value >= 10 ? 0 : 1);
}

function formatCount(value: number): string {
  if (value <= 0) {
    return '0';
  }
  if (value >= 1000) {
    const normalized = value / 1000;
    return `${normalized.toFixed(normalized >= 10 ? 0 : 1)}K`;
  }
  return value.toString();
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
    .map((item, index) => {
      const previewImage = resolvePreviewImage(item.primaryCover, item.coverImages?.[0], item.cover);
      return {
        id: item.id,
        name: item.name,
        subtitle: formatExhibitionSubtitle(item),
        gradient: ensureBackground(item.cover || previewImage, index),
        rating: item.rating,
        ratingCount: item.ratingCount,
        userRating: item.userRatingScore ?? 0,
        likes: item.likesCount ?? 0,
        liked: item.liked,
        previewImage,
        previewHeight: computePreviewHeight(index),
      };
    }),
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
    .map((item, index) => {
      const previewImage = resolvePreviewImage(item.primaryCover, item.coverImages?.[0], item.cover);
      return {
        id: item.id,
        name: item.name,
        subtitle: formatExhibitionSubtitle(item),
        gradient: ensureBackground(item.cover || previewImage, index),
        rating: item.rating,
        ratingCount: item.ratingCount,
        userRating: item.userRatingScore ?? 0,
        likes: item.likesCount ?? 0,
        liked: item.liked,
        previewImage,
        previewHeight: computePreviewHeight(index),
      };
    }),
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
    .map((item: WorkItem, index) => {
      const previewImage = resolvePreviewImage(item.thumbnailUrl, item.fileUrl);
      return {
        id: item.id,
        name: item.name,
        subtitle: formatWorkSubtitle(item),
        gradient: ensureBackground(item.gradient, index),
        rating: item.rating,
        ratingCount: item.ratingCount,
        userRating: item.userRatingScore ?? 0,
        likes: item.likes,
        liked: item.liked,
        previewImage,
        previewHeight: computePreviewHeight(index),
      };
    }),
);

function handleNavigate(target: NavKey) {
  redirectToNav(target, { current: 'home', allowSame: true });
}

function goWorksListBest() {
  uni.navigateTo({ url: '/pages/works/list?sort=best' });
}

function openExhibition(id: string) {
  uni.navigateTo({ url: `/pages/exhibition/detail/index?id=${id}` });
}

function goSearch() {
  uni.navigateTo({ url: '/pages/search/index' });
}

function goExhibitionListLatest() {
  uni.navigateTo({ url: '/pages/exhibition/list?sort=latest' });
}

function goExhibitionListBest() {
  uni.navigateTo({ url: '/pages/exhibition/list?sort=best' });
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
  padding-top: 84px;
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


.work-card__stats {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  padding: 8px 12px;
  border-radius: 16px;
  background: rgba(6, 9, 20, 0.58);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  box-shadow: 0 15px 32px rgba(6, 9, 20, 0.45);
}

.stat-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
}

.stat-icon {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  transition: color 0.2s ease;
}

.stat-icon--star.is-active {
  color: #ffb400;
}

.stat-icon--heart.is-active {
  color: #ff3f6e;
}

.stat-value {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.92);
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
  width: 100%;
}

.works-grid--masonry {
  column-count: 2;
  column-gap: 16px;
}

@media (min-width: 540px) {
  .works-grid--masonry {
    column-count: 3;
  }
}

.work-card {
  border-radius: 24px;
  padding: 6px;
  color: #ffffff;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 38px rgba(31, 122, 236, 0.18);
  position: relative;
  margin-bottom: 16px;
  break-inside: avoid;
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(6px);
}

.work-card__preview {
  border-radius: 20px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.16);
  position: relative;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.work-card__image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.work-card__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

</style>
