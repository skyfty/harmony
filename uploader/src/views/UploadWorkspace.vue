<script setup lang="ts">
import { AssetTypes } from '@harmony/schema/asset-types'
import { computed, onMounted, ref } from 'vue'
import type { AssetType } from '@/types'
import { useUploadManager, type UploadTask } from '@/composables/useUploadManager'
import { useTagStore } from '@/stores/tags'
import { useAuthStore } from '@/stores/auth'

const uploadManager = useUploadManager()
const tagStore = useTagStore()
const authStore = useAuthStore()

const fileInputRef = ref<HTMLInputElement | null>(null)
const dragActive = ref(false)
const dragCounter = ref(0)
const newTagName = ref('')
const newTagDescription = ref('')
const creatingTag = ref(false)
const tagError = ref<string | null>(null)

const tasks = uploadManager.tasks
const activeTaskId = uploadManager.activeTaskId

const activeTask = computed(() => tasks.value.find((task: UploadTask) => task.id === activeTaskId.value) ?? null)
const hasTasks = computed(() => tasks.value.length > 0)

const assetTypeLabels: Record<AssetType, string> = {
  model: '模型',
  image: '图片',
  texture: '纹理',
  material: '材质',
  mesh: '网格',
  prefab: '预制体',
  video: '视频',
  file: '文件',
}

onMounted(() => {
  tagStore.fetchTags()
})

function triggerFileDialog(): void {
  fileInputRef.value?.click()
}

function handleFileSelection(event: Event): void {
  const input = event.target as HTMLInputElement | null
  if (input?.files && input.files.length > 0) {
    uploadManager.addFiles(input.files)
    input.value = ''
  }
}

function handleDragEnter(event: DragEvent): void {
  event.preventDefault()
  dragCounter.value += 1
  dragActive.value = true
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
}

function handleDragLeave(event: DragEvent): void {
  event.preventDefault()
  dragCounter.value = Math.max(0, dragCounter.value - 1)
  if (dragCounter.value === 0) {
    dragActive.value = false
  }
}

function handleDrop(event: DragEvent): void {
  event.preventDefault()
  dragCounter.value = 0
  dragActive.value = false
  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    uploadManager.addFiles(files)
  }
}

function selectTask(taskId: string): void {
  uploadManager.setActiveTask(taskId)
}

function toggleTag(task: UploadTask, tagId: string): void {
  const index = task.tagIds.indexOf(tagId)
  if (index >= 0) {
    task.tagIds = task.tagIds.filter((id) => id !== tagId)
  } else {
    task.tagIds = [...task.tagIds, tagId]
  }
}

async function handleCreateTag(): Promise<void> {
  if (creatingTag.value) {
    return
  }
  const name = newTagName.value.trim()
  if (!name.length) {
    tagError.value = '请输入标签名称'
    return
  }
  creatingTag.value = true
  tagError.value = null
  try {
    const tag = await tagStore.createTag(name, newTagDescription.value.trim() || undefined)
    if (activeTask.value && !activeTask.value.tagIds.includes(tag.id)) {
      activeTask.value.tagIds = [...activeTask.value.tagIds, tag.id]
    }
    newTagName.value = ''
    newTagDescription.value = ''
  } catch (error) {
    tagError.value = error instanceof Error ? error.message : '创建标签失败'
  } finally {
    creatingTag.value = false
  }
}

function formatBytes(value: number): string {
  if (!isFinite(value) || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function statusBadge(task: UploadTask): string {
  switch (task.status) {
    case 'pending':
      return '待上传'
    case 'uploading':
      return '上传中'
    case 'success':
      return '成功'
    case 'error':
      return '失败'
    case 'canceled':
      return '已取消'
    default:
      return ''
  }
}

function statusClass(task: UploadTask): string {
  switch (task.status) {
    case 'pending':
      return 'is-pending'
    case 'uploading':
      return 'is-uploading'
    case 'success':
      return 'is-success'
    case 'error':
      return 'is-error'
    case 'canceled':
      return 'is-canceled'
    default:
      return ''
  }
}

function handleStartUpload(task: UploadTask): void {
  uploadManager.startUpload(task.id)
}

function handleRetry(task: UploadTask): void {
  uploadManager.resetTask(task.id)
  uploadManager.startUpload(task.id)
}

function handleCancel(task: UploadTask): void {
  uploadManager.cancelUpload(task.id)
  uploadManager.removeTask(task.id)
}

function handleClose(task: UploadTask): void {
  if (task.status === 'uploading') {
    return
  }
  uploadManager.removeTask(task.id)
}

function handleLogout(): void {
  authStore.logout()
}
</script>

<template>
  <main
    class="workspace"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop="handleDrop"
  >
    <header class="workspace__header">
      <div>
        <h1>资源上传中心</h1>
        <p>拖拽文件或点击右下角的“+”按钮上传图片、材质、纹理、网格模型、Prefab 等资产。</p>
      </div>
      <div class="workspace__user">
        <span class="workspace__user-name">{{ authStore.user?.displayName ?? authStore.user?.username ?? '管理员' }}</span>
        <button class="workspace__logout" type="button" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <section class="workspace__content">
      <div v-if="hasTasks" class="workspace__tabs">
        <button
          v-for="task in tasks"
          :key="task.id"
          class="workspace__tab"
          :class="[statusClass(task), { 'is-active': task.id === activeTaskId }]"
          type="button"
          @click="selectTask(task.id)"
        >
          <span class="workspace__tab-title">{{ task.name || task.file.name }}</span>
          <span class="workspace__tab-status">{{ statusBadge(task) }}</span>
          <span
            v-if="task.status !== 'uploading'"
            class="workspace__tab-close"
            role="button"
            tabindex="0"
            @click.stop="handleClose(task)"
            @keydown.enter.stop.prevent="handleClose(task)"
          >×</span>
        </button>
      </div>

      <div v-if="activeTask" class="task-panel">
        <header class="task-panel__header">
          <div>
            <h2>{{ activeTask.name || activeTask.file.name }}</h2>
            <p class="task-panel__subtitle">
              {{ formatBytes(activeTask.file.size) }} · {{ activeTask.file.type || '未知类型' }}
            </p>
          </div>
          <span class="task-panel__badge" :class="statusClass(activeTask)">{{ statusBadge(activeTask) }}</span>
        </header>

        <div class="task-panel__body">
          <div class="task-panel__form">
            <label class="form-field">
              <span>资产名称</span>
              <input
                v-model="activeTask.name"
                :disabled="activeTask.status === 'uploading'"
                type="text"
                placeholder="请输入资产名称"
              />
            </label>

            <label class="form-field">
              <span>资产描述</span>
              <textarea
                v-model="activeTask.description"
                :disabled="activeTask.status === 'uploading'"
                rows="3"
                placeholder="可选：为资产添加描述信息"
              />
            </label>

            <label class="form-field">
              <span>资产类型</span>
              <select
                v-model="activeTask.type"
                :disabled="activeTask.status === 'uploading'"
              >
                <option v-for="type in AssetTypes" :key="type" :value="type">
                  {{ assetTypeLabels[type] ?? type }}
                </option>
              </select>
            </label>

            <div class="form-field">
              <span>资产标签</span>
              <div class="tag-selector">
                <div class="tag-selector__options">
                  <label
                    v-for="tag in tagStore.sortedTags"
                    :key="tag.id"
                    class="tag-selector__option"
                  >
                    <input
                      type="checkbox"
                      :value="tag.id"
                      :checked="activeTask.tagIds.includes(tag.id)"
                      :disabled="activeTask.status === 'uploading'"
                      @change="toggleTag(activeTask, tag.id)"
                    />
                    <span>{{ tag.name }}</span>
                  </label>
                  <p v-if="tagStore.loading" class="tag-selector__hint">标签加载中...</p>
                </div>
                <form class="tag-selector__creator" @submit.prevent="handleCreateTag">
                  <input
                    v-model="newTagName"
                    type="text"
                    placeholder="输入新标签名称"
                    :disabled="creatingTag"
                  />
                  <input
                    v-model="newTagDescription"
                    type="text"
                    placeholder="可选：标签描述"
                    :disabled="creatingTag"
                  />
                  <button type="submit" :disabled="creatingTag">
                    {{ creatingTag ? '创建中...' : '新增标签' }}
                  </button>
                </form>
                <p v-if="tagError" class="tag-selector__error">{{ tagError }}</p>
              </div>
            </div>
          </div>

          <div class="task-panel__status">
            <div class="progress">
              <div class="progress__bar" :style="{ width: `${activeTask.progress}%` }" />
            </div>
            <p v-if="activeTask.status === 'uploading'" class="status-text">正在上传：{{ activeTask.progress }}%</p>
            <p v-else-if="activeTask.status === 'success'" class="status-text is-success">
              上传成功
              <template v-if="activeTask.asset">
                · 资源 ID：{{ activeTask.asset.id }}
              </template>
            </p>
            <p v-else-if="activeTask.status === 'error'" class="status-text is-error">{{ activeTask.errorMessage }}</p>
            <p v-else-if="activeTask.status === 'canceled'" class="status-text">上传已取消</p>

            <div class="task-panel__actions">
              <button
                v-if="activeTask.status === 'pending'"
                type="button"
                class="btn is-primary"
                @click="handleStartUpload(activeTask)"
              >
                开始上传
              </button>
              <button
                v-else-if="activeTask.status === 'uploading'"
                type="button"
                class="btn is-danger"
                @click="handleCancel(activeTask)"
              >
                取消上传
              </button>
              <button
                v-else-if="activeTask.status === 'error'"
                type="button"
                class="btn is-primary"
                @click="handleRetry(activeTask)"
              >
                重新上传
              </button>
              <button
                v-else
                type="button"
                class="btn"
                @click="handleClose(activeTask)"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="workspace__empty">
        <div class="workspace__empty-inner">
          <h2>将文件拖放到这里开始上传</h2>
          <p>支持图片、材质、纹理、模型、Prefab 等多种资源类型，单次可批量上传多个文件。</p>
          <button type="button" class="btn is-primary" @click="triggerFileDialog">选择文件</button>
        </div>
      </div>
    </section>

    <input
      ref="fileInputRef"
      class="workspace__file-input"
      type="file"
      multiple
      @change="handleFileSelection"
    />

    <button class="workspace__fab" type="button" @click="triggerFileDialog">+</button>

    <div v-if="dragActive" class="workspace__overlay">释放鼠标即可上传文件</div>
  </main>
</template>

<style scoped>
.workspace {
  position: relative;
  min-height: calc(100vh - 32px);
  margin: 16px;
  padding-bottom: 120px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 30px 60px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
}

.workspace__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 32px 40px 24px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  gap: 24px;
}

.workspace__header h1 {
  margin: 0 0 8px;
  font-size: 1.8rem;
  color: #1f2937;
}

.workspace__header p {
  margin: 0;
  color: #4b5563;
  font-size: 0.95rem;
}

.workspace__user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.workspace__user-name {
  color: #2d3748;
  font-weight: 600;
}

.workspace__logout {
  height: 36px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(244, 114, 182, 0.5);
  background: transparent;
  color: #db2777;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.workspace__logout:hover {
  background: rgba(244, 114, 182, 0.08);
}

.workspace__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px 40px 40px;
}

.workspace__tabs {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.workspace__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: rgba(99, 102, 241, 0.08);
  color: #4c51bf;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.workspace__tab.is-active {
  background: #4f46e5;
  color: #fff;
  border-color: rgba(255, 255, 255, 0.5);
  transform: translateY(-1px);
}

.workspace__tab-title {
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspace__tab-status {
  font-size: 0.85rem;
  opacity: 0.8;
}

.workspace__tab-close {
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.6;
}

.workspace__tab-close:hover {
  opacity: 1;
}

.workspace__tab.is-success {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}

.workspace__tab.is-error {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}

.workspace__tab.is-uploading {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
}

.workspace__tab.is-canceled {
  background: rgba(148, 163, 184, 0.2);
  color: #475569;
}

.task-panel {
  border-radius: 24px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.18);
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.task-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.task-panel__header h2 {
  margin: 0;
  font-size: 1.4rem;
  color: #1f2937;
}

.task-panel__subtitle {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 0.9rem;
}

.task-panel__badge {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
}

.task-panel__badge.is-success {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}

.task-panel__badge.is-error {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}

.task-panel__badge.is-uploading {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
}

.task-panel__badge.is-pending {
  background: rgba(99, 102, 241, 0.12);
  color: #4338ca;
}

.task-panel__badge.is-canceled {
  background: rgba(148, 163, 184, 0.2);
  color: #475569;
}

.task-panel__body {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 32px;
}

.task-panel__form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #4b5563;
  font-weight: 600;
}

.form-field input,
.form-field textarea,
.form-field select {
  border: 1px solid rgba(148, 163, 184, 0.5);
  border-radius: 12px;
  padding: 12px;
  font: inherit;
  background: #fff;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.form-field input:focus,
.form-field textarea:focus,
.form-field select:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.form-field textarea {
  resize: vertical;
}

.tag-selector {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tag-selector__options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  max-height: 180px;
  overflow-y: auto;
}

.tag-selector__option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.5);
  background: rgba(255, 255, 255, 0.8);
  font-size: 0.9rem;
}

.tag-selector__hint {
  width: 100%;
  margin: 0;
  color: #64748b;
}

.tag-selector__creator {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-selector__creator input {
  flex: 1 1 160px;
  min-width: 120px;
  border-radius: 999px;
}

.tag-selector__creator button {
  flex: 0 0 auto;
  padding: 0 16px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.tag-selector__error {
  margin: 0;
  color: #ef4444;
  font-size: 0.85rem;
}

.task-panel__status {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.progress {
  width: 100%;
  height: 10px;
  background: rgba(226, 232, 240, 0.9);
  border-radius: 999px;
  overflow: hidden;
}

.progress__bar {
  height: 100%;
  background: linear-gradient(135deg, #6366f1 0%, #14b8a6 100%);
  transition: width 0.2s ease;
}

.status-text {
  margin: 0;
  color: #475569;
  font-weight: 500;
}

.status-text.is-success {
  color: #047857;
}

.status-text.is-error {
  color: #b91c1c;
}

.task-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.btn {
  min-width: 120px;
  height: 40px;
  padding: 0 20px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  background: #fff;
  color: #1e293b;
  cursor: pointer;
  font-weight: 600;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(99, 102, 241, 0.18);
}

.btn.is-primary {
  background: linear-gradient(135deg, #6366f1 0%, #3b82f6 100%);
  border: none;
  color: #fff;
}

.btn.is-danger {
  background: linear-gradient(135deg, #f97316 0%, #ef4444 100%);
  border: none;
  color: #fff;
}

.workspace__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.workspace__empty-inner {
  text-align: center;
  padding: 48px;
  border-radius: 24px;
  border: 1px dashed rgba(99, 102, 241, 0.4);
  background: rgba(255, 255, 255, 0.8);
  max-width: 560px;
}

.workspace__empty-inner h2 {
  margin: 0 0 12px;
  color: #312e81;
}

.workspace__empty-inner p {
  margin: 0 0 24px;
  color: #4c1d95;
}

.workspace__file-input {
  display: none;
}

.workspace__fab {
  position: fixed;
  right: 36px;
  bottom: 36px;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
  color: #fff;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 20px 30px rgba(99, 102, 241, 0.35);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.workspace__fab:hover {
  transform: translateY(-4px) scale(1.03);
  box-shadow: 0 25px 35px rgba(99, 102, 241, 0.4);
}

.workspace__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(79, 70, 229, 0.15);
  border: 2px dashed rgba(79, 70, 229, 0.8);
  border-radius: 24px;
  font-size: 1.5rem;
  color: #312e81;
  pointer-events: none;
  z-index: 10;
}

@media (max-width: 1024px) {
  .task-panel__body {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .workspace {
    margin: 8px;
    padding-bottom: 96px;
  }

  .workspace__header {
    flex-direction: column;
  }

  .task-panel {
    padding: 20px;
  }

  .workspace__fab {
    right: 24px;
    bottom: 24px;
    width: 56px;
    height: 56px;
    font-size: 1.8rem;
  }
}
</style>
