<template>
  <view class="page">
    <view class="content">
      <view v-if="currentProject" class="current-project">
        <view class="project-card" @tap="openProject">
          <view class="card-header">
            <text class="project-name">{{ currentProject.project.name || '未命名项目' }}</text>
          </view>
          <view class="card-meta">
            <text>导入时间：{{ formatDate(currentProject.savedAt) }}</text>
            <text>场景数：{{ currentProject.sceneCount }}</text>
          </view>
          <view class="card-footer">
            <text v-if="currentProject.origin" class="card-origin">来源：{{ currentProject.origin }}</text>
          </view>
        </view>
        <button class="remove-button" @tap="removeProject">移除项目</button>
      </view>

      <view v-else class="empty">
        <text class="empty-title">暂无项目</text>
        <text class="empty-desc">通过本地 ZIP 场景包导入一个项目</text>
      </view>
    </view>

    <view class="toolbar">
      <button class="action primary" :disabled="importing" @tap="handleLocalImport">
        {{ importing ? '导入中...' : '本地导入项目' }}
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
  background-color: #f5f7fb;
  gap: 12px;
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

.action {
  flex: 1;
  padding: 10px 12px;
  font-size: 15px;
  border-radius: 24px;
  border: none;
  background-color: #ffffff;
  color: #1a1a1a;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.action.primary {
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
  color: #ffffff;
}

.action[disabled] {
  opacity: 0.5;
}

.current-project {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project-card {
  padding: 16px;
  border-radius: 16px;
  background-color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.project-name {
  font-size: 18px;
  font-weight: 700;
  color: #162034;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #64748b;
}

.card-footer {
  font-size: 12px;
  color: #94a3b8;
}

.card-origin {
  display: block;
  word-break: break-all;
}

.remove-button {
  border-radius: 20px;
  background: #fff1f2;
  color: #be123c;
  border: 1px solid rgba(190, 18, 60, 0.12);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #64748b;
}

.empty-title {
  font-size: 18px;
  font-weight: 700;
  color: #162034;
}

.empty-desc {
  font-size: 13px;
  line-height: 1.7;
}
</style>
