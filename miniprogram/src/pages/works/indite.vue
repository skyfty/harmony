<template>
  <view class="page work">
    <view class="header">
      <text class="title">创作新作品</text>
      <text class="subtitle">目前支持批量导入图片素材，可一次选择多张</text>
    </view>

    <view class="uploader">
      <view class="drop-zone">
        <view class="cloud-icon" />
        <text class="drop-title">拖放文件到此</text>
        <text class="drop-desc">或点击选择图片</text>
        <button class="primary" @tap="selectImages" :disabled="loading">{{ loading ? '处理中…' : '选择图片' }}</button>
      </view>
      <view class="format-hint">
        <text>支持：JPG、PNG 等常见图片格式</text>
      </view>
    </view>

    <view class="my-works-card">
      <view class="my-works-header">
        <text class="my-works-title">我的作品</text>
        <text class="my-works-action" @tap="goWorksList">更多</text>
      </view>
      <view v-if="worksLoading" class="my-works-message">加载中…</view>
      <view v-else-if="worksError" class="my-works-message">{{ worksError }}</view>
      <view v-else-if="featuredWorks.length" class="my-works-grid">
        <view class="my-work-card" v-for="work in featuredWorks" :key="work.id" @tap="openWorkDetail(work.id)">
          <view class="my-work-thumb" :style="{ background: work.background }">
            <image v-if="work.thumbnail" class="my-work-image" :src="work.thumbnail" mode="aspectFill" />
            <text v-else class="my-work-thumb-title">{{ work.initial }}</text>
          </view>
          <view class="my-work-info">
            <text class="my-work-name">{{ work.title }}</text>
            <text class="my-work-meta">{{ work.metaText }}</text>
            <view class="my-work-stats">
              <view class="my-work-stat">
                <text class="my-work-stat-icon">★</text>
                <text class="my-work-stat-value">{{ work.ratingText }}</text>
              </view>
              <view class="my-work-stat">
                <text class="my-work-stat-icon likes">❤</text>
                <text class="my-work-stat-value">{{ work.likesText }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
      <view v-else class="my-works-message">暂未上传作品</view>
    </view>

    <view class="collections-card">
      <view class="collections-header">
        <text class="collections-title">最近作品集</text>
        <text class="collections-more" @tap="goCollectionsList">更多</text>
      </view>
      <view v-if="collectionsLoading" class="collections-message">加载中…</view>
      <view v-else-if="collectionsError" class="collections-message">{{ collectionsError }}</view>
      <view v-else-if="recentCollectionCards.length" class="collections-grid">
        <view
          class="collection-card"
          v-for="collection in recentCollectionCards"
          :key="collection.id"
          @tap="openCollectionDetail(collection.id)"
        >
          <view class="collection-thumb">
            <image
              v-if="collection.cover"
              class="collection-image"
              :src="collection.cover"
              mode="aspectFill"
            />
            <view v-else class="collection-placeholder" :style="{ background: collection.placeholder }">
              <text class="collection-placeholder-text">{{ collection.initials }}</text>
            </view>
          </view>
          <view class="collection-info">
            <text class="collection-name">{{ collection.title }}</text>
            <text class="collection-meta">{{ collection.meta }}</text>
          </view>
        </view>
      </view>
      <view v-else class="collections-message">暂未创建作品集</view>
    </view>

    <BottomNav active="work" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { useWorksStore, type WorkType } from '@/stores/worksStore';
import {
  apiGetWorks,
  apiGetCollections,
  type WorkSummary,
  type CollectionSummary,
} from '@/api/miniprogram';

type NavKey = 'home' | 'work' | 'exhibition' | 'profile' | 'optimize';

type WorkCandidate = {
  name: string;
  size?: number;
  path?: string;
  mimeType?: string;
};

type FeaturedWorkCard = {
  id: string;
  title: string;
  thumbnail?: string;
  initial: string;
  background: string;
  ratingText: string;
  likesText: string;
  metaText: string;
};

type CollectionCard = {
  id: string;
  title: string;
  cover?: string;
  placeholder: string;
  initials: string;
  meta: string;
};

const worksStore = useWorksStore();
const currentUserId = computed(() => worksStore.profile?.user?.id ?? '');

const loading = ref(false);
const worksLoading = ref(false);
const collectionsLoading = ref(false);
const worksError = ref('');
const collectionsError = ref('');

const remoteWorks = ref<WorkSummary[]>([]);
const remoteCollections = ref<CollectionSummary[]>([]);

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

const typeLabels: Record<WorkType, string> = {
  image: '图片',
  video: '视频',
  model: '3D 模型',
  other: '其他',
};

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  work: '/pages/works/indite',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  optimize: '/pages/optimize/index',
};

const sortedWorks = computed(() => {
  const list = [...remoteWorks.value];
  return list.sort((a, b) => dateValue(b.updatedAt || b.createdAt) - dateValue(a.updatedAt || a.createdAt));
});

const featuredWorks = computed<FeaturedWorkCard[]>(() =>
  sortedWorks.value.slice(0, 4).map((work, index) => {
    const rating = typeof work.averageRating === 'number' ? work.averageRating : 0;
    const likes = typeof work.likesCount === 'number' ? work.likesCount : 0;
    const background = ensureBackground(work.thumbnailUrl, index);
    const thumbnail = work.thumbnailUrl || (work.mediaType === 'image' ? work.fileUrl : '');
    const name = work.title || '未命名作品';
    const metaParts: string[] = [];
    const sizeText = formatSize(work.size);
    if (sizeText) {
      metaParts.push(sizeText);
    }
    const relative = formatRelativeTime(work.updatedAt || work.createdAt);
    if (relative) {
      metaParts.push(relative);
    }
    return {
      id: work.id,
      title: name,
      thumbnail,
      initial: computeInitial(name),
      background,
      ratingText: rating > 0 ? rating.toFixed(rating >= 10 ? 0 : 1) : '--',
      likesText: formatNumber(likes),
      metaText: metaParts.join(' · ') || '暂无信息',
    };
  }),
);

const sortedCollections = computed(() => {
  const list = currentUserId.value
    ? remoteCollections.value.filter((item) => item.ownerId === currentUserId.value)
    : [...remoteCollections.value];
  return list.sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));
});

const recentCollectionCards = computed<CollectionCard[]>(() =>
  sortedCollections.value.slice(0, 3).map((collection, index) => {
    const cover = resolveCollectionCover(collection);
    const title = collection.title || '未命名作品集';
    return {
      id: collection.id,
      title,
      cover,
      placeholder: ensureBackground(undefined, index + 5),
      initials: computeInitial(title),
      meta: buildCollectionMeta(collection),
    };
  }),
);

function ensureBackground(url: string | undefined, index: number): string {
  if (url && /^https?:\/\//i.test(url)) {
    return gradientPalette[index % gradientPalette.length];
  }
  const paletteIndex = ((index % gradientPalette.length) + gradientPalette.length) % gradientPalette.length;
  return gradientPalette[paletteIndex];
}

function dateValue(iso?: string): number {
  if (!iso) {
    return 0;
  }
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '加载失败，请稍后重试';
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

function formatSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)}MB`;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) {
    return '';
  }
  const ts = dateValue(iso);
  if (!ts) {
    return '';
  }
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) {
    return '刚刚更新';
  }
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / 60000)} 分钟前更新`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / 3600000)} 小时前更新`;
  }
  const date = new Date(ts);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}.${month}.${day} 更新`;
}

function computeInitial(text?: string): string {
  if (!text) {
    return '集';
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return '集';
  }
  return trimmed.slice(0, 1).toUpperCase();
}

function normalizeAssetUrl(value?: string | null): string {
  if (!value) {
    return '';
  }
  if (value.startsWith('url(')) {
    const match = value.match(/^url\((.*)\)$/i);
    if (match && match[1]) {
      return match[1].replace(/^['"]|['"]$/g, '');
    }
  }
  return value;
}

function resolveCollectionCover(collection: CollectionSummary): string {
  const cover = normalizeAssetUrl(collection.coverUrl);
  if (cover) {
    return cover;
  }
  const candidate = (collection.works ?? []).find((work) => work.thumbnailUrl || work.mediaType === 'image');
  if (candidate) {
    return candidate.thumbnailUrl || (candidate.mediaType === 'image' ? candidate.fileUrl : '');
  }
  return '';
}

function buildCollectionMeta(collection: CollectionSummary): string {
  const counts = typeof collection.workCount === 'number' ? collection.workCount : collection.works?.length ?? 0;
  const segments = [`作品 ${counts}`];
  const relative = formatRelativeTime(collection.updatedAt || collection.createdAt);
  if (relative) {
    segments.push(relative);
  }
  return segments.join(' · ');
}

async function loadWorks(): Promise<void> {
  worksLoading.value = true;
  worksError.value = '';
  try {
    const response = await apiGetWorks(currentUserId.value ? { owner: currentUserId.value } : undefined);
    remoteWorks.value = response.works ?? [];
  } catch (error) {
    worksError.value = getErrorMessage(error);
    remoteWorks.value = [];
    uni.showToast({ title: worksError.value, icon: 'none' });
  } finally {
    worksLoading.value = false;
  }
}

async function loadCollections(): Promise<void> {
  collectionsLoading.value = true;
  collectionsError.value = '';
  try {
    const response = await apiGetCollections();
    remoteCollections.value = response.collections ?? [];
  } catch (error) {
    collectionsError.value = getErrorMessage(error);
    remoteCollections.value = [];
    uni.showToast({ title: collectionsError.value, icon: 'none' });
  } finally {
    collectionsLoading.value = false;
  }
}

async function reloadData(): Promise<void> {
  await Promise.all([loadWorks(), loadCollections()]).catch(() => undefined);
}

onShow(() => {
  void reloadData();
});

watch(
  () => currentUserId.value,
  () => {
    if (!worksLoading.value && !collectionsLoading.value) {
      void reloadData();
    }
  },
);

function handleNavigate(target: NavKey) {
  const route = routes[target];
  if (!route || target === 'work') {
    return;
  }
  uni.redirectTo({ url: route });
}

function goWorksList() {
  uni.navigateTo({ url: '/pages/works/index' });
}

function openWorkDetail(id: string) {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/works/detail/index?id=${id}` });
}

function goCollectionsList() {
  uni.navigateTo({ url: '/pages/collections/index' });
}

function openCollectionDetail(id: string) {
  if (!id) {
    return;
  }
  uni.navigateTo({ url: `/pages/collections/detail/index?id=${id}` });
}

function selectImages() {
  if (loading.value) {
    return;
  }
  handleImageSelection();
}

function extractNameFromPath(path?: string | null): string {
  if (!path) {
    return '未命名文件';
  }
  const segments = path.split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last || '未命名文件';
}

function navigateToCollectionEditor(options: { workIds?: string[]; pending?: boolean }) {
  if (options.pending) {
    uni.navigateTo({ url: '/pages/collections/edit/index?mode=pending' });
    return;
  }
  const workIds = options.workIds ?? [];
  if (!workIds.length) {
    return;
  }
  const query = encodeURIComponent(workIds.join(','));
  uni.navigateTo({ url: `/pages/collections/edit/index?workIds=${query}` });
}

function createPendingId(index: number): string {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function prepareWorkCreation(type: WorkType, files: WorkCandidate[]) {
  if (!files.length) {
    failCreation('未选择文件');
    return;
  }
  const valid = files
    .map((file, index) => ({
      id: createPendingId(index),
      name: file.name || `${typeLabels[type]} ${index + 1}`,
      size: file.size,
      filePath: file.path,
      mimeType: file.mimeType,
    }))
    .filter((file) => typeof file.filePath === 'string' && file.filePath.length > 0);
  if (!valid.length) {
    failCreation('未选择文件');
    return;
  }
  worksStore.setPendingUploads(
    valid.map((file) => ({
      id: file.id,
      name: file.name,
      size: file.size,
      filePath: file.filePath!,
      mimeType: file.mimeType,
      type,
    })),
  );
  loading.value = false;
  navigateToCollectionEditor({ pending: true });
}

function failCreation(message?: string, error?: { errMsg?: string }) {
  loading.value = false;
  if (error?.errMsg && error.errMsg.includes('cancel')) {
    return;
  }
  if (message) {
    uni.showToast({ title: message, icon: 'none' });
  }
}

function handleImageSelection() {
  loading.value = true;
  uni.chooseImage({
    count: 9,
    success: async (res) => {
      const files: WorkCandidate[] = [];
      const tempFiles = Array.isArray(res.tempFiles) ? res.tempFiles : [];
      const fallbackPaths = Array.isArray(res.tempFilePaths)
        ? res.tempFilePaths
        : res.tempFilePaths
        ? [res.tempFilePaths]
        : [];
      if (tempFiles.length) {
        tempFiles.forEach((file, index) => {
          const record = file as UniApp.ChooseImageSuccessCallbackResultFile & {
            name?: string;
            type?: string;
            fileType?: string;
          };
          const filePath = (record as { path?: string }).path ?? fallbackPaths[index];
          files.push({
            name: record?.name || extractNameFromPath(filePath),
            size: record?.size,
            path: filePath,
            mimeType: record?.type || record?.fileType,
          });
        });
      } else {
        fallbackPaths.forEach((path) => {
          files.push({ name: extractNameFromPath(path), path });
        });
      }
      prepareWorkCreation('image', files);
    },
    fail: (err) => failCreation('选择图片失败', err),
  });
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

.uploader {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.drop-zone {
  border: 2px dashed rgba(31, 122, 236, 0.4);
  border-radius: 18px;
  padding: 28px 16px;
  background: linear-gradient(135deg, rgba(145, 189, 255, 0.14), rgba(209, 227, 255, 0.26));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  color: #1f7aec;
}

.cloud-icon {
  width: 56px;
  height: 40px;
  position: relative;
  margin-bottom: 6px;
}

.cloud-icon::before,
.cloud-icon::after {
  content: '';
  position: absolute;
  background: rgba(31, 122, 236, 0.25);
  border-radius: 50%;
}

.cloud-icon::before {
  width: 36px;
  height: 36px;
  left: 10px;
  top: 6px;
}

.cloud-icon::after {
  width: 20px;
  height: 20px;
  left: 0;
  top: 16px;
  box-shadow: 36px -8px 0 rgba(31, 122, 236, 0.25);
}

.drop-title {
  font-size: 16px;
  font-weight: 600;
}

.drop-desc {
  font-size: 13px;
  color: rgba(31, 122, 236, 0.8);
}

.primary {
  padding: 10px 28px;
  border: none;
  border-radius: 18px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 14px;
  margin-top: 6px;
  box-shadow: 0 8px 20px rgba(31, 122, 236, 0.3);
}

.primary[disabled] {
  opacity: 0.6;
}

.format-hint {
  font-size: 12px;
  color: #8a94a6;
  text-align: center;
}

.collections-card,
.my-works-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.collections-header,
.my-works-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collections-title,
.my-works-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.collections-more,
.my-works-action {
  font-size: 13px;
  color: #1f7aec;
}

.collections-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.collection-card {
  display: flex;
  gap: 12px;
  align-items: center;
}

.collection-thumb {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(31, 122, 236, 0.12), rgba(98, 166, 255, 0.18));
  display: flex;
  align-items: center;
  justify-content: center;
}

.collection-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.collection-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.9);
  font-size: 20px;
  font-weight: 600;
}

.collection-placeholder-text {
  background: rgba(0, 0, 0, 0.2);
  padding: 6px 10px;
  border-radius: 12px;
}

.collection-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.collection-name {
  font-size: 16px;
  color: #263248;
  font-weight: 600;
}

.collection-meta {
  font-size: 12px;
  color: #8a94a6;
}

.collections-message,
.my-works-message {
  font-size: 13px;
  color: #8a94a6;
}

.my-works-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.my-work-card {
  display: flex;
  gap: 14px;
  align-items: center;
}

.my-work-thumb {
  width: 90px;
  height: 90px;
  border-radius: 18px;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.92);
  font-size: 18px;
  font-weight: 600;
}

.my-work-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.my-work-thumb-title {
  background: rgba(0, 0, 0, 0.2);
  padding: 6px 12px;
  border-radius: 12px;
}

.my-work-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.my-work-name {
  font-size: 16px;
  color: #263248;
  font-weight: 600;
}

.my-work-meta {
  font-size: 12px;
  color: #8a94a6;
}

.my-work-stats {
  display: flex;
  gap: 12px;
}

.my-work-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #5f6b83;
}

.my-work-stat-icon {
  font-size: 14px;
}

.my-work-stat-icon.likes {
  color: #ff6f91;
}

.my-work-stat-value {
  font-weight: 600;
}
</style>
