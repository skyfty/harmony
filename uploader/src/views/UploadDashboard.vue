<template>
  <v-main class="bg-grey-lighten-4">

    <v-app-bar color="primary" prominent flat>
      <v-app-bar-title>Harmony 资源上传中心</v-app-bar-title>
      <v-spacer></v-spacer>
      <v-btn icon="mdi-refresh" variant="text" @click="refreshTags" :loading="loadingTags"></v-btn>
      <v-menu v-if="authStore.user" location="bottom right">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="text" prepend-icon="mdi-account-circle">
            {{ authStore.user?.displayName ?? authStore.user?.username }}
          </v-btn>
        </template>
        <v-list>
          <v-list-item>
            <v-list-item-title>{{ authStore.user?.username }}</v-list-item-title>
            <v-list-item-subtitle>{{ authStore.user?.email }}</v-list-item-subtitle>
          </v-list-item>
          <v-list-item @click="handleLogout" prepend-icon="mdi-logout">
            <v-list-item-title>退出登录</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-app-bar>
  <v-container class="uploader-container" fluid>
      <div
        class="upload-surface pa-8"
        :class="{ 'is-dragover': isDragOver }"
        @dragover.prevent="handleDragOver"
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <template v-if="!tasks.length">
          <div class="text-center py-16">
            <v-icon size="64" color="primary">mdi-cloud-upload</v-icon>
            <div class="text-h5 mt-4 mb-2">拖放文件到此处上传</div>
            <div class="text-body-2 text-medium-emphasis">支持图片、材质、纹理、模型、Prefab 等多种资源类型，or 点击右下角的 “+” 按钮选择文件</div>
          </div>
        </template>
        <template v-else>
          <v-tabs
            v-model="activeTab"
            slider-color="primary"
            show-arrows
          >
            <v-tab
              v-for="task in tasks"
              :key="task.id"
              :value="task.id"
            >
              <v-icon small class="mr-2" :color="statusColor(task.status)">
                {{ statusIcon(task.status) }}
              </v-icon>
              <span class="text-truncate" style="max-width: 200px">{{ task.name }}</span>
            </v-tab>
          </v-tabs>
          <v-window v-model="activeTab" class="mt-4">
            <v-window-item
              v-for="task in tasks"
              :key="task.id"
              :value="task.id"
            >
              <UploadTaskPane
                :task="task"
                :available-tags="availableTags"
                :asset-type-options="assetTypeOptions"
              />
            </v-window-item>
          </v-window>
        </template>
        <input
          ref="fileInput"
          type="file"
          class="d-none"
          multiple
          @change="handleFileSelection"
        />
      </div>
      <v-btn
        class="fab-trigger"
        color="primary"
        elevation="8"
        size="x-large"
        icon="mdi-plus"
        @click="triggerFileDialog"
      ></v-btn>
    </v-container>
  </v-main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import UploadTaskPane from '@/components/UploadTaskPane.vue'
import { useUploadStore } from '@/stores/upload'
import { useAuthStore } from '@/stores/auth'

const uploadStore = useUploadStore()
const authStore = useAuthStore()

const tasks = computed(() => uploadStore.tasks)
const availableTags = computed(() => uploadStore.availableTags)
const assetTypeOptions = computed(() => uploadStore.assetTypeOptions)
const loadingTags = computed(() => uploadStore.loadingTags)

const activeTab = computed({
  get: () => uploadStore.activeTaskId,
  set: (value: string | null) => uploadStore.setActiveTask(value),
})

const isDragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function triggerFileDialog(): void {
  fileInput.value?.click()
}

function extractFiles(event: DragEvent | Event): File[] {
  const files: File[] = []
  if (event instanceof DragEvent && event.dataTransfer) {
    if (event.dataTransfer.items) {
      for (let i = 0; i < event.dataTransfer.items.length; i += 1) {
        const item = event.dataTransfer.items[i]
        if (item && item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
    } else {
      files.push(...Array.from(event.dataTransfer.files ?? []))
    }
  } else if (event.target instanceof HTMLInputElement && event.target.files) {
    files.push(...Array.from(event.target.files))
  }
  return files
}

async function handleFiles(event: DragEvent | Event): Promise<void> {
  const files = extractFiles(event)
  if (!files.length) return
  await uploadStore.addFiles(files)
  if (event.target instanceof HTMLInputElement) {
    event.target.value = ''
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  isDragOver.value = true
}

function handleDragLeave(event: DragEvent): void {
  event.preventDefault()
  isDragOver.value = false
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  isDragOver.value = false
  await handleFiles(event)
}

async function handleFileSelection(event: Event): Promise<void> {
  await handleFiles(event)
}

function statusIcon(status: string): string {
  switch (status) {
    case 'success':
      return 'mdi-check-circle'
    case 'error':
      return 'mdi-alert-circle'
    case 'uploading':
      return 'mdi-cloud-upload'
    case 'canceled':
      return 'mdi-close-circle'
    default:
      return 'mdi-file'
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    case 'uploading':
      return 'primary'
    case 'canceled':
      return 'warning'
    default:
      return 'primary'
  }
}

async function refreshTags(): Promise<void> {
  await uploadStore.ensureTagsLoaded()
}

async function handleLogout(): Promise<void> {
  await authStore.logout()
  window.location.href = '/login'
}

uploadStore.ensureTagsLoaded().catch((error: unknown) => console.warn('加载标签失败', error))
</script>

<style scoped>
.uploader-container {
  width: 100%;
  margin: 0;
  padding: 48px clamp(24px, 6vw, 80px);
  box-sizing: border-box;
}

@media (min-width: 1920px) {
  .uploader-container {
    padding-left: 96px;
    padding-right: 96px;
  }
}

@media (max-width: 960px) {
  .uploader-container {
    padding: 32px 20px;
  }
}
</style>
