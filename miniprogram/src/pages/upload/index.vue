<template>
  <view class="page upload">
    <view class="header">
      <text class="title">上传作品素材</text>
      <text class="subtitle">支持图片、视频、3D 模型等多种格式</text>
    </view>

    <view class="uploader">
      <view class="drop-zone">
        <view class="cloud-icon"></view>
        <text class="drop-title">拖放文件到此</text>
    <text class="drop-desc">或点击选择素材类型</text>
    <button class="primary" @tap="selectFile" :disabled="loading">{{ loading ? '处理中…' : '选择素材' }}</button>
      </view>
      <view class="format-hint">
        <text>支持：JPG、PNG、MP4、MOV、OBJ、GLTF、FBX 等</text>
      </view>
      <view class="upload-types">
        <view class="type-item" v-for="option in uploadTypes" :key="option.label">
          <view class="type-icon" :class="option.type"></view>
          <view class="type-info">
            <text class="type-label">{{ option.label }}</text>
            <text class="type-desc">{{ option.desc }}</text>
          </view>
        </view>
      </view>
      <view v-if="lastUpload" class="last-upload">
        <text class="last-upload-title">最近上传：</text>
        <text class="last-upload-name">{{ lastUpload.name }}</text>
        <text class="last-upload-type">{{ lastUpload.type }}</text>
      </view>
    </view>

    <view class="tools-card">
      <text class="tools-title">编辑工具</text>
      <view class="tools-grid">
        <view class="tool-item" v-for="tool in tools" :key="tool.label">
          <view class="tool-icon" :class="tool.type"></view>
          <text class="tool-label">{{ tool.label }}</text>
        </view>
      </view>
    </view>

    <view class="history-card">
      <view class="history-header">
        <text class="history-title">上传记录</text>
        <text class="history-action">管理</text>
      </view>
      <view class="history-list">
        <view class="history-item" v-for="item in uploadHistory" :key="item.id">
          <view class="history-preview" :style="{ background: item.gradient }"></view>
          <view class="history-info">
            <text class="history-name">{{ item.name }}</text>
            <text class="history-meta">{{ item.size }} · {{ item.time }}</text>
          </view>
          <text class="history-status">{{ item.status }}</text>
        </view>
      </view>
    </view>

    <BottomNav active="upload" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import BottomNav from '@/components/BottomNav.vue';
import { useWorksStore, type WorkType } from '@/stores/worksStore';

declare const wx: any | undefined;

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'settings';

type LastUpload = {
  name: string;
  type: string;
};

type HistoryItem = {
  id: string;
  name: string;
  size: string;
  time: string;
  status: string;
  gradient: string;
};

type UploadCandidate = {
  name: string;
  size?: number | string;
};

const worksStore = useWorksStore();

const loading = ref(false);
const lastUpload = ref<LastUpload | null>(null);
const uploadHistory = ref<HistoryItem[]>([
  {
    id: 'a',
    name: '未来雕塑.obj',
    size: '24.8MB',
    time: '2 分钟前',
    status: '转换完成',
    gradient: 'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
  },
  {
    id: 'b',
    name: '光影空间.gltf',
    size: '18.3MB',
    time: '15 分钟前',
    status: '待发布',
    gradient: 'linear-gradient(135deg, #b7f5ec, #90e0d9)',
  },
]);

const uploadTypes = [
  { label: '图片素材', desc: 'JPG · PNG · HEIC', type: 'image' },
  { label: '视频素材', desc: 'MP4 · MOV · AVI', type: 'video' },
  { label: '3D 模型', desc: 'OBJ · GLTF · FBX', type: 'model' },
];

const tools = [
  { label: '变形', type: 'deform' },
  { label: '编辑', type: 'edit' },
  { label: '抠图', type: 'cutout' },
  { label: '渲染', type: 'render' },
];

const typeLabels: Record<WorkType, string> = {
  image: '图片',
  video: '视频',
  model: '3D 模型',
};

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  upload: '/pages/upload/index',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  settings: '/pages/settings/index',
};

watchEffect(() => {
  if (uploadHistory.value.length > 20) {
    uploadHistory.value = uploadHistory.value.slice(0, 20);
  }
});

function handleNavigate(target: NavKey) {
  const route = routes[target];
  if (!route || target === 'upload') {
    return;
  }
  uni.redirectTo({ url: route });
}

function selectFile() {
  if (loading.value) {
    return;
  }
  uni.showActionSheet({
    itemList: ['上传图片', '上传视频', '上传 3D 模型'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) {
        handleImageUpload();
      } else if (tapIndex === 1) {
        handleVideoUpload();
      } else {
        handleModelUpload();
      }
    },
  });
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

function finalizeUpload(type: WorkType, files: UploadCandidate[]) {
  if (!files.length) {
    failUpload('未选择文件');
    return;
  }
  const normalized = files
    .map((file, index) => ({
      name: file.name || `${typeLabels[type]} ${index + 1}`,
      size: file.size,
    }))
    .filter((file) => Boolean(file.name));
  if (!normalized.length) {
    failUpload('未选择文件');
    return;
  }
  const newIds = worksStore.addWorks(
    normalized.map((file) => ({
      name: file.name,
      size: file.size,
      type,
    })),
  );
  const first = normalized[0];
  const displayName = normalized.length > 1 ? `${first.name} 等 ${normalized.length} 个` : first.name;
  lastUpload.value = { type: typeLabels[type], name: displayName };
  const representative = worksStore.workMap[newIds[0]];
  uploadHistory.value.unshift({
    id: newIds[0],
    name: displayName,
    size: representative?.size || formatSize(first.size),
    time: '刚刚',
    status: '待整理',
    gradient: representative?.gradient || 'linear-gradient(135deg, #dff5ff, #c6ebff)',
  });
  loading.value = false;
  uni.showToast({ title: `${typeLabels[type]}上传成功`, icon: 'success' });
  navigateToCollectionEditor(newIds);
}

function failUpload(message?: string, error?: { errMsg?: string }) {
  loading.value = false;
  if (error?.errMsg && error.errMsg.includes('cancel')) {
    return;
  }
  if (message) {
    uni.showToast({ title: message, icon: 'none' });
  }
}

function handleImageUpload() {
  loading.value = true;
  uni.chooseImage({
    count: 9,
    success: (res) => {
      const files: UploadCandidate[] = [];
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
      finalizeUpload('image', files);
    },
    fail: (err) => failUpload('选择图片失败', err),
  });
}

function handleVideoUpload() {
  loading.value = true;
  if (typeof uni.chooseMedia === 'function') {
    uni.chooseMedia({
      count: 5,
      mediaType: ['video'],
      success: (res) => {
        const files: UploadCandidate[] = (res.tempFiles || []).map((file: any) => ({
          name: file?.fileName || extractNameFromPath(file?.tempFilePath),
          size: file?.size,
        }));
        finalizeUpload('video', files);
      },
      fail: (err) => failUpload('选择视频失败', err),
    });
    return;
  }
  uni.chooseVideo({
    success: (res) => {
      const name = (res as any).name || extractNameFromPath((res as any).tempFilePath);
      const size = (res as any).size;
      finalizeUpload('video', [{ name: name || '视频', size }]);
    },
    fail: (err) => failUpload('选择视频失败', err),
  });
}

function handleModelUpload() {
  loading.value = true;
  if (typeof uni.chooseFile === 'function') {
    uni.chooseFile({
      count: 9,
      extension: ['.obj', '.gltf', '.glb', '.fbx'],
      success: (res) => {
        const tempFiles = Array.isArray(res.tempFiles) ? res.tempFiles : res.tempFiles ? [res.tempFiles] : [];
        const files: UploadCandidate[] = tempFiles
          .filter(Boolean)
          .map((file: any) => ({
            name: file?.name || extractNameFromPath(file?.path),
            size: file?.size,
          }));
        finalizeUpload('model', files);
      },
      fail: (err) => failUpload('选择模型失败', err),
    });
    return;
  }

  const wxChoose = typeof wx !== 'undefined' && typeof (wx as any).chooseMessageFile === 'function';
  if (wxChoose) {
    (wx as any).chooseMessageFile({
      count: 9,
      type: 'file',
      extension: ['.obj', '.gltf', '.glb', '.fbx', 'obj', 'gltf', 'glb', 'fbx'],
      success: (res: any) => {
        const tempFiles = Array.isArray(res.tempFiles) ? res.tempFiles : res.tempFiles ? [res.tempFiles] : [];
        const files: UploadCandidate[] = tempFiles
          .filter(Boolean)
          .map((file: any) => ({
            name: file?.name || extractNameFromPath(file?.path),
            size: file?.size,
          }));
        finalizeUpload('model', files);
      },
      fail: (err: any) => failUpload('选择模型失败', err),
    });
    return;
  }

  failUpload('当前环境暂不支持选择模型文件');
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
</style>
