<template>
  <view class="page work">
    <view class="header">
  <text class="title">创作新作品</text>
  <text class="subtitle">目前支持批量导入图片素材，可一次选择多张</text>
    </view>

    <view class="uploader">
      <view class="drop-zone">
        <view class="cloud-icon"></view>
        <text class="drop-title">拖放文件到此</text>
        <text class="drop-desc">或点击选择图片</text>
        <button class="primary" @tap="selectImages" :disabled="loading">{{ loading ? '处理中…' : '选择图片' }}</button>
      </view>
      <view class="format-hint">
        <text>支持：JPG、PNG 等常见图片格式</text>
      </view>
    </view>

    <view class="history-card">
      <view class="history-header">
  <text class="history-title">创作记录</text>
        <text class="history-action" @tap="goManage">管理</text>
      </view>
      <view class="history-list">
          <view class="history-item" v-for="item in workHistory" :key="item.id">
            <view class="history-preview" :style="{ background: item.gradient }"></view>
            <view class="history-info">
              <text class="history-name">{{ item.name }}</text>
              <text class="history-meta">{{ item.size }} · {{ item.time }}</text>
            </view>
            <text class="history-status">{{ item.status }}</text>
        </view>
      </view>
    </view>

    <view class="my-works-card">
      <view class="my-works-header">
        <text class="my-works-title">我的作品</text>
        <text class="my-works-action" @tap="goWorksList">更多</text>
      </view>
      <view class="my-works-grid">
        <view class="my-work-card" v-for="work in featuredWorks" :key="work.id" @tap="openWorkDetail(work.id)">
          <view class="my-work-thumb" :style="{ background: work.gradient }"></view>
          <view class="my-work-info">
            <text class="my-work-name">{{ work.name }}</text>
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
    </view>

    <BottomNav active="work" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import BottomNav from '@/components/BottomNav.vue';
import { useWorksStore, type WorkItem, type WorkType } from '@/stores/worksStore';

declare const wx: any | undefined;

type NavKey = 'home' | 'work' | 'exhibition' | 'profile' | 'optimize';

type HistoryItem = {
  id: string;
  name: string;
  size: string;
  time: string;
  status: string;
  gradient: string;
  createdAt: number;
};

type WorkCandidate = {
  name: string;
  size?: number | string;
};

const worksStore = useWorksStore();

const HISTORY_STORAGE_KEY = 'workHistory';
const LEGACY_STORAGE_KEY = 'uploadHistory';
const loading = ref(false);

function readHistory(key: string): HistoryItem[] {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) {
      return [];
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadHistory(): HistoryItem[] {
  const current = readHistory(HISTORY_STORAGE_KEY);
  if (current.length) {
    return current;
  }
  const legacy = readHistory(LEGACY_STORAGE_KEY);
  if (legacy.length) {
    saveHistory(legacy);
    return legacy;
  }
  return [];
}

function saveHistory(list: HistoryItem[]) {
  try {
    uni.setStorageSync(HISTORY_STORAGE_KEY, list);
  } catch {
    // ignore storage failures
  }
}

const sampleHistory: HistoryItem[] = [
  {
    id: 'a',
    name: '概念视觉海报.jpg',
    size: '2.8MB',
    time: '2 分钟前',
    status: '待整理',
    gradient: 'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
    createdAt: Date.now() - 2 * 60 * 1000,
  },
  {
    id: 'b',
    name: '空间渲染预览.png',
    size: '4.3MB',
    time: '15 分钟前',
    status: '待发布',
    gradient: 'linear-gradient(135deg, #b7f5ec, #90e0d9)',
    createdAt: Date.now() - 15 * 60 * 1000,
  },
];

const initialHistory: HistoryItem[] = (() => {
  const fromStore = loadHistory();
  return fromStore.length ? fromStore : sampleHistory;
})();
const workHistory = ref<HistoryItem[]>(initialHistory);

const typeLabels: Record<WorkType, string> = {
  image: '图片',
  video: '视频',
  model: '3D 模型',
  other: '其他',
};

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  work: '/pages/work/index',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  optimize: '/pages/optimize/index',
};

type FeaturedWork = WorkItem & {
  ratingText: string;
  likesText: string;
  metaText: string;
};

const featuredWorks = computed<FeaturedWork[]>(() =>
  worksStore.works.slice(0, 4).map((work) => ({
    ...work,
    ratingText: typeof work.rating === 'number' ? work.rating.toFixed(1) : `${work.rating}`,
    likesText: typeof work.likes === 'number' ? work.likes.toString() : `${work.likes}`,
    metaText: work.time || work.size || '刚刚',
  })),
);

watchEffect(() => {
  if (workHistory.value.length > 20) {
    workHistory.value = workHistory.value.slice(0, 20);
  }
});

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

function formatSize(size?: number | string): string {
  if (typeof size === 'string') {
    return size;
  }
  if (typeof size === 'number' && size > 0) {
    const mb = size / (1024 * 1024);
    return `${mb.toFixed(mb >= 100 ? 0 : 1)}MB`;
  }
  return '刚刚';
}

function navigateToCollectionEditor(workIds: string[]) {
  if (!workIds.length) {
    return;
  }
  const query = encodeURIComponent(workIds.join(','));
  uni.navigateTo({ url: `/pages/collections/edit/index?workIds=${query}` });
}

async function finalizeWorkCreation(type: WorkType, files: WorkCandidate[]) {
  if (!files.length) {
    failCreation('未选择文件');
    return;
  }
  const normalized = files
    .map((file, index) => ({
      name: file.name || `${typeLabels[type]} ${index + 1}`,
      size: file.size,
    }))
    .filter((file) => Boolean(file.name));
  if (!normalized.length) {
    failCreation('未选择文件');
    return;
  }
  const newIds = await worksStore.addWorks(
    normalized.map((file) => ({
      name: file.name,
      size: file.size,
      type,
    })) as any,
  );
  const first = normalized[0];
  const displayName = normalized.length > 1 ? `${first.name} 等 ${normalized.length} 个` : first.name;
  const representative = worksStore.workMap[newIds[0]];
  workHistory.value.unshift({
    id: newIds[0],
    name: displayName,
    size: representative?.size || formatSize(first.size),
    time: '刚刚',
    status: '待整理',
    gradient: representative?.gradient || 'linear-gradient(135deg, #dff5ff, #c6ebff)',
    createdAt: Date.now(),
  });
  saveHistory(workHistory.value);
  loading.value = false;
  uni.showToast({ title: `${typeLabels[type]}创建成功`, icon: 'success' });
  navigateToCollectionEditor(newIds);
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
          const record = file as UniApp.ChooseImageSuccessCallbackResultFile & { name?: string };
          files.push({
            name: record?.name || extractNameFromPath(record?.path || fallbackPaths[index]),
            size: record?.size,
          });
        });
      } else {
        for (const path of fallbackPaths) {
          files.push({ name: extractNameFromPath(path) });
        }
      }
      await finalizeWorkCreation('image', files);
    },
    fail: (err) => failCreation('选择图片失败', err),
  });
}

function goManage() {
  uni.navigateTo({ url: '/pages/work/records/index' });
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

.upload-types {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.type-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(31, 122, 236, 0.08), rgba(98, 166, 255, 0.12));
}

.type-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.18);
  position: relative;
}

.type-icon::before,
.type-icon::after {
  content: '';
  position: absolute;
  background: #ffffff;
}

.type-icon.image::before {
  inset: 10px;
  border-radius: 10px;
  background: linear-gradient(135deg, #8bb8ff, #b5d1ff);
}

.type-icon.image::after {
  width: 14px;
  height: 10px;
  border-radius: 4px;
  bottom: 9px;
  left: 9px;
  background: rgba(255, 255, 255, 0.8);
}

.type-icon.video::before {
  inset: 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.18);
}

.type-icon.video::after {
  width: 0;
  height: 0;
  border-top: 9px solid transparent;
  border-bottom: 9px solid transparent;
  border-left: 12px solid #ffffff;
  left: 16px;
  top: 12px;
}

.type-icon.model::before {
  inset: 11px;
  border-radius: 6px;
  border: 2px solid rgba(255, 255, 255, 0.9);
  background: transparent;
}

.type-icon.model::after {
  width: 18px;
  height: 2px;
  background: rgba(255, 255, 255, 0.7);
  left: 12px;
  bottom: 12px;
}

.type-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.type-label {
  font-size: 14px;
  color: #1f1f1f;
  font-weight: 600;
}

.type-desc {
  font-size: 12px;
  color: #5f6b83;
}

.last-upload {
  margin-top: 6px;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: center;
}

.last-upload-title {
  font-size: 12px;
  color: #5f6b83;
}

.last-upload-name {
  font-size: 14px;
  color: #1f1f1f;
  font-weight: 600;
}

.last-upload-type {
  font-size: 12px;
  color: #1f7aec;
}

.tools-card,
.history-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.tools-title,
.history-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.tools-grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.tool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.tool-icon {
  width: 48px;
  height: 48px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(98, 166, 255, 0.2), rgba(31, 122, 236, 0.35));
  position: relative;
}

.tool-icon::after {
  content: '';
  position: absolute;
  inset: 14px;
  background: #ffffff;
  border-radius: 12px;
}

.tool-icon.deform::after {
  transform: rotate(45deg);
}

.tool-icon.edit::after {
  background: linear-gradient(135deg, #ffffff 40%, #1f7aec 41%, #1f7aec 60%, #ffffff 61%);
}

.tool-icon.cutout::after {
  border: 3px dashed #62a6ff;
  background: transparent;
}

.tool-icon.render::after {
  background: radial-gradient(circle at center, #ffffff 0%, #ffffff 45%, #62a6ff 46%, #62a6ff 60%, transparent 61%);
}

.tool-label {
  font-size: 13px;
  color: #4b566b;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.history-action {
  font-size: 14px;
  color: #1f7aec;
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

.my-works-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.my-works-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.my-works-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.my-works-action {
  font-size: 14px;
  color: #1f7aec;
}

.my-works-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.my-work-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.my-work-thumb {
  width: 100%;
  height: 110px;
  border-radius: 18px;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.12);
}

.my-work-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.my-work-name {
  font-size: 14px;
  color: #1f1f1f;
  font-weight: 600;
}

.my-work-meta {
  font-size: 12px;
  color: #8a94a6;
}

.my-work-stats {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.my-work-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(31, 122, 236, 0.08);
  padding: 4px 8px;
  border-radius: 10px;
  font-size: 11px;
  color: #1f1f1f;
}

.my-work-stat-icon {
  color: #ffaf42;
  font-size: 11px;
}

.my-work-stat-icon.likes {
  color: #ff6f91;
}

.my-work-stat-value {
  font-size: 11px;
}
</style>
