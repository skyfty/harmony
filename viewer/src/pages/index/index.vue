<template>
  <view class="page">
    <view class="header">
      <text class="header__title">场景项目</text>
      <text class="header__subtitle">导入本地 ZIP 场景包，随时随地预览场景</text>
    </view>

    <view class="content">
      <view v-if="currentProject" class="project-card" @tap="openProject">
        <view class="project-name-row">
          <text class="project-name">{{ currentProject.project.name || '未命名项目' }}</text>
          <text class="status-badge">已导入</text>
        </view>

        <view class="meta-list">
          <view class="meta-item">
            <text class="meta-label">导入时间</text>
            <text class="meta-value">{{ formatDate(currentProject.savedAt) }}</text>
          </view>
          <view v-if="currentProject.origin" class="meta-item">
            <text class="meta-label">来源文件</text>
            <text class="meta-value meta-value--break">{{ currentProject.origin }}</text>
          </view>
        </view>

        <view class="card-actions">
          <button class="action action--primary" @tap.stop="openProject">进入预览</button>
          <button class="action action--danger" @tap.stop="removeProject">移除项目</button>
        </view>
      </view>

      <view v-else class="empty-card" @tap="handleLocalImport">
        <view class="empty-card__icon">
          <text class="empty-card__plus">＋</text>
        </view>
        <text class="empty-title">暂无项目</text>
        <text class="empty-desc">点击此处或下方按钮，导入本地 ZIP 场景包开始预览</text>
      </view>
    </view>

    <view class="toolbar">
      <button class="import-button" :disabled="importing" @tap="handleLocalImport">
        {{ importing ? '导入中...' : (currentProject ? '导入其他项目替换' : '导入本地项目') }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { saveScenePackageZip } from '@/lib/mainScenePackageStorage';
import { getMiniPlatformAdapter } from '@/platform/adapter';
import { useProjectStore } from '@/stores/projectStore';

const projectStore = useProjectStore();
const currentProject = projectStore.currentProject;
const importing = ref(false);

onMounted(() => {
  projectStore.bootstrap();
});

function formatDate(value?: string): string {
  if (!value) {
    return '未知时间';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day} ${hour}:${minute}`;
}

function openProject() {
  if (!currentProject.value) {
    return;
  }

  uni.navigateTo({
    url: `/pages/scenery/index?projectId=${encodeURIComponent(currentProject.value.id)}`,
  });
}

function removeProject() {
  uni.showModal({
    title: '确认移除',
    content: '确定要移除当前项目吗？',
    success: (result) => {
      if (result.confirm) {
        projectStore.clearProject();
      }
    },
  });
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    const safe = new ArrayBuffer(input.byteLength);
    new Uint8Array(safe).set(input);
    return safe;
  }
  return input;
}

function generateId(prefix = 'project'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${random}`;
}

async function readFileAsArrayBuffer(file: UniApp.ChooseFileSuccessCallbackResultFile): Promise<ArrayBuffer> {
  const adapter = getMiniPlatformAdapter();
  if (adapter.readFileAsArrayBuffer) {
    return await adapter.readFileAsArrayBuffer(file);
  }

  throw new Error('当前平台暂不支持读取所选文件');
}

async function importScenePackageZip(zip: ArrayBuffer | Uint8Array, origin?: string) {
  const projectId = generateId();
  const bytes = toArrayBuffer(zip);
  const scenePackage = await saveScenePackageZip(bytes, projectId);
  const rawName = String(origin ?? '本地文件');
  const nameMatch = rawName.match(/(.+?)(?:\.[^.]+)?$/);
  const displayName = nameMatch ? nameMatch[1] : rawName;

  projectStore.setProject(
    {
      scenePackage,
      project: {
        id: projectId,
        name: displayName,
        sceneOrder: [],
      } as never,
      sceneCount: 0,
    },
    rawName,
  );

  setTimeout(() => {
    openProject();
  }, 500);

  uni.showToast({ title: '项目导入成功', icon: 'success' });
}

async function handleLocalImport() {
  if (importing.value) {
    return;
  }

  importing.value = true;
  try {
    const adapter = getMiniPlatformAdapter();
    if (!adapter.chooseFile) {
      throw new Error('当前环境不支持文件选择');
    }

    const files = await adapter.chooseFile({ count: 1, extension: ['.zip', 'zip'] });
    const file = files[0] as UniApp.ChooseFileSuccessCallbackResultFile | undefined;
    if (!file) {
      throw new Error('未选择文件');
    }

    const name = String((file as { name?: string; path?: string }).name ?? (file as { path?: string }).path ?? '');
    if (!name.toLowerCase().endsWith('.zip')) {
      throw new Error('仅支持导入 .zip 场景包');
    }

    const bytes = await readFileAsArrayBuffer(file);
    const originName = String((file as { name?: string; path?: string }).name ?? (file as { path?: string }).path ?? '本地文件');
    await importScenePackageZip(bytes, originName);
  } catch (error) {
    console.error(error);
    uni.showToast({
      title: error instanceof Error ? error.message : '项目导入失败',
      icon: 'none',
    });
  } finally {
    importing.value = false;
  }
}
</script>

<style lang="scss">
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px;
  padding-top: 84px;
  padding-bottom: 96px;
  box-sizing: border-box;
  background: linear-gradient(180deg, #f5f7fb 0%, #eef3fa 100%);
  gap: 12px;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.header__title {
  font-size: 24px;
  font-weight: 700;
  color: #162034;
}

.header__subtitle {
  font-size: 13px;
  color: #64748b;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 20px 0;
}

.toolbar {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: 16px;
  display: flex;
  gap: 12px;
  z-index: 10;
}

.import-button {
  flex: 1;
  padding: 12px 16px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 24px;
  border: none;
  color: #ffffff;
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
  box-shadow: 0 6px 16px rgba(31, 122, 236, 0.28);
}

.import-button::after {
  border: none;
}

.import-button[disabled] {
  opacity: 0.6;
}

.project-card {
  width: 100%;
  max-width: 420px;
  padding: 18px 16px;
  border-radius: 20px;
  background-color: #ffffff;
  box-shadow: 0 8px 24px rgba(31, 47, 77, 0.1);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.project-name-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.project-name {
  flex: 1;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.4;
  color: #162034;
  word-break: break-all;
}

.status-badge {
  flex-shrink: 0;
  margin-top: 2px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #e8f2ff;
  color: #1f6fd6;
  font-size: 11px;
  font-weight: 600;
}

.meta-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 14px;
  background: #f7f9fc;
}

.meta-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.meta-label {
  flex-shrink: 0;
  width: 56px;
  font-size: 12px;
  line-height: 1.6;
  color: #94a3b8;
}

.meta-value {
  flex: 1;
  font-size: 13px;
  line-height: 1.6;
  color: #475569;
}

.meta-value--break {
  word-break: break-all;
}

.card-actions {
  display: flex;
  gap: 10px;
}

.action {
  flex: 1;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 20px;
  border: none;
}

.action::after {
  border: none;
}

.action--primary {
  color: #ffffff;
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
}

.action--danger {
  color: #be123c;
  background-color: #fff1f2;
  border: 1px solid rgba(190, 18, 60, 0.12);
}

.empty-card {
  width: 100%;
  max-width: 420px;
  padding: 40px 24px;
  border: 2px dashed #c8d6ea;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.72);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.empty-card__icon {
  width: 58px;
  height: 58px;
  margin-bottom: 4px;
  border-radius: 50%;
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
  box-shadow: 0 8px 18px rgba(31, 122, 236, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-card__plus {
  color: #ffffff;
  font-size: 30px;
  font-weight: 400;
  line-height: 1;
}

.empty-title {
  font-size: 18px;
  font-weight: 700;
  color: #162034;
}

.empty-desc {
  max-width: 260px;
  font-size: 13px;
  line-height: 1.7;
  text-align: center;
  color: #64748b;
}
</style>
