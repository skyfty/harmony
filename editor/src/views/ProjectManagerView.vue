<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '@/stores/projectsStore'
import { useAuthStore } from '@/stores/authStore'
import { useScenesStore } from '@/stores/scenesStore'
import { useUiStore } from '@/stores/uiStore'
import LoginDialog from '@/components/layout/LoginDialog.vue'
import NewProjectDialog from '@/components/layout/NewProjectDialog.vue'
// OpenProjectDialog removed — opening projects is handled on the Project Manager page
import {type ProjectCreateParams} from '@/types/project-summary'

import { createProjectWithDefaultScene } from '@/stores/useProjectCreation'
import type { DuplicateProjectResolution } from '@/utils/projectPackageWorkflow'
import { runProjectExportWorkflow, runProjectImportWorkflow } from '@/utils/projectPackageWorkflow'

import { PROJECT_MANAGER_OVERLAY_CLOSE_KEY } from '@/injectionKeys'

const router = useRouter()
const projectsStore = useProjectsStore()
const uiStore = useUiStore()

  async function handleSignOut() {
    try {
      await authStore.logout()
    } finally {
      // Ensure page state is fully refreshed after logout
      window.location.reload()
    }
  }
const scenesStore = useScenesStore()
const authStore = useAuthStore()
const route = useRoute()

const loginOpen = ref(false)
const newProjectOpen = ref(false)
const projectImportInputRef = ref<HTMLInputElement | null>(null)
// OpenProjectDialog removed — opening projects is handled on the Project Manager page
const deletingId = ref<string | null>(null)
const exportingId = ref<string | null>(null)
const importingProject = ref(false)
const confirmDeleteOpen = ref(false)
const pendingDeleteProjectId = ref<string | null>(null)
const pendingDeleteProjectName = ref('')
const duplicateImportDialogOpen = ref(false)
const duplicateImportProjectName = ref('')
const duplicateImportProjectCount = ref(0)
const duplicateImportResolver = ref<((value: DuplicateProjectResolution) => void) | null>(null)

const isLoggedIn = computed(() => !!authStore.user)
const projects = computed(() => projectsStore.sortedMetadata)

const overlayClose = inject(PROJECT_MANAGER_OVERLAY_CLOSE_KEY, null)
const isOverlay = computed(() => overlayClose !== null)

const returnTo = computed(() => {
  const q = route.query?.returnTo
  return typeof q === 'string' && q.length ? q : null
})

function handleClose() {
  // Prefer using history.back to avoid a full navigation/refresh.
  if (window.history.length > 1) {
    router.back()
    return
  }
  // No history entry to go back to — fallback to explicit returnTo or home.
  if (returnTo.value) {
    router.push(returnTo.value)
  } else {
    router.push('/')
  }
}

function handleCloseButton() {
  if (overlayClose) {
    overlayClose()
    return
  }
  handleClose()
}

async function refreshAll() {
  await Promise.all([projectsStore.initialize(), scenesStore.initialize()])
}

onMounted(() => {
  refreshAll()
})

function openLogin() {
  loginOpen.value = true
}

async function handleCreateProject(payload: ProjectCreateParams) {
  const { project, scene } = await createProjectWithDefaultScene(payload)
  await router.push({ path: '/editor', query: { projectId: project.id, sceneId: scene.id } })
  overlayClose?.()
}

async function handleOpenProject(payload: { projectId: string; sceneId?: string | null }) {
  const query: Record<string, string> = { projectId: payload.projectId }
  if (typeof payload.sceneId === 'string' && payload.sceneId.trim()) {
    query.sceneId = payload.sceneId.trim()
  }
  await router.push({ path: '/editor', query })
  overlayClose?.()
}

async function handleDeleteProject(projectId: string) {
  if (deletingId.value) return
  deletingId.value = projectId
  try {
    await projectsStore.deleteProjectCascade(projectId)
  } finally {
    deletingId.value = null
  }
}

function requestDeleteProject(projectId: string, projectName: string) {
  if (deletingId.value) return
  pendingDeleteProjectId.value = projectId
  pendingDeleteProjectName.value = projectName
  confirmDeleteOpen.value = true
}

function cancelDeleteProject() {
  if (deletingId.value) return
  confirmDeleteOpen.value = false
  pendingDeleteProjectId.value = null
  pendingDeleteProjectName.value = ''
}

async function confirmDeleteProject() {
  if (!pendingDeleteProjectId.value || deletingId.value) return
  const projectId = pendingDeleteProjectId.value
  try {
    await handleDeleteProject(projectId)
  } finally {
    confirmDeleteOpen.value = false
    pendingDeleteProjectId.value = null
    pendingDeleteProjectName.value = ''
  }
}

async function handleSync() {
  await Promise.all([
    projectsStore.syncUserWorkspaceFromServer({ replace: true }),
    scenesStore.syncUserWorkspaceFromServer({ replace: true }),
  ])
}

function openDuplicateImportDialog(payload: {
  incomingName: string
  duplicates: Array<{ id: string; name: string }>
}): Promise<DuplicateProjectResolution> {
  duplicateImportProjectName.value = payload.incomingName
  duplicateImportProjectCount.value = payload.duplicates.length
  duplicateImportDialogOpen.value = true

  return new Promise<DuplicateProjectResolution>((resolve) => {
    duplicateImportResolver.value = resolve
  })
}

function closeDuplicateImportDialogWith(value: DuplicateProjectResolution): void {
  const resolver = duplicateImportResolver.value
  duplicateImportResolver.value = null
  duplicateImportDialogOpen.value = false
  duplicateImportProjectName.value = ''
  duplicateImportProjectCount.value = 0
  resolver?.(value)
}

function requestProjectImport(): void {
  if (importingProject.value) {
    return
  }
  const input = projectImportInputRef.value
  if (!input) {
    return
  }
  input.value = ''
  input.click()
}

async function handleProjectImportFileChange(event: Event): Promise<void> {
  const input = (event.target as HTMLInputElement | null) ?? projectImportInputRef.value
  const file = input?.files?.[0] ?? null
  if (!input || !file || importingProject.value) {
    if (input) {
      input.value = ''
    }
    return
  }

  importingProject.value = true

  try {
    await runProjectImportWorkflow({
      file,
      projectsStore,
      scenesStore,
      uiStore,
      onDuplicateProjectName: openDuplicateImportDialog,
    })
  } catch (error) {
    console.warn('[ProjectManager] import project package failed', error)
  } finally {
    importingProject.value = false
    input.value = ''
  }
}

async function handleExportProject(projectId: string): Promise<void> {
  if (exportingId.value || importingProject.value) {
    return
  }

  exportingId.value = projectId

  try {
    await runProjectExportWorkflow({
      projectId,
      projectsStore,
      scenesStore,
      uiStore,
    })
  } catch (error) {
    console.warn('[ProjectManager] export project package failed', error)
  } finally {
    exportingId.value = null
  }
}
</script>

<template>
  <div class="pm-root">
    <v-btn
      v-if="returnTo || isOverlay"
      class="pm-close-btn"
      variant="text"
      density="comfortable"
      @click="handleCloseButton"
    >
      <v-icon size="20">mdi-close</v-icon>
    </v-btn>
    <div class="pm-header">
      <div>
        <div class="pm-title">Harmony Projects</div>
        <div class="pm-subtitle">Local-first · Sign in to sync to cloud</div>
      </div>
      <div class="pm-actions">
        <v-btn v-if="!isLoggedIn" variant="text" @click="openLogin">Sign In</v-btn>
        <v-btn v-else variant="text" @click="handleSignOut">Sign Out</v-btn>
        <v-btn variant="text" :disabled="!isLoggedIn" @click="handleSync">Sync</v-btn>
        <v-btn variant="text" :disabled="importingProject || deletingId !== null || exportingId !== null" @click="requestProjectImport">Import</v-btn>
        <v-btn color="primary" variant="flat" @click="newProjectOpen = true">New Project</v-btn>
      </div>
    </div>

    <div class="pm-body">
      <v-card v-if="projectsStore.error" class="mb-4" variant="tonal" color="error">
        <v-card-text>{{ projectsStore.error }}</v-card-text>
      </v-card>

      <v-card v-if="!projects.length" class="pm-empty" variant="tonal">
        <v-card-text>
          No projects yet.
          <v-btn class="ml-2" size="small" color="primary" variant="flat" @click="newProjectOpen = true">Create one</v-btn>
        </v-card-text>
      </v-card>

      <v-row v-else>
        <v-col v-for="p in projects" :key="p.id" cols="12" md="6" lg="4">
          <v-card :class="['pm-project', { 'pm-project--active': projectsStore.activeProjectId === p.id }]" variant="elevated">
            <v-card-title class="pm-project__title">{{ p.name }}</v-card-title>
            <v-card-subtitle>{{ p.sceneCount }} scenes</v-card-subtitle>
            <v-card-text class="pm-project__meta">{{ p.id }}</v-card-text>
            <v-card-actions>
              <v-btn color="primary" variant="flat" @click="handleOpenProject({ projectId: p.id, sceneId: p.lastEditedSceneId })">Open</v-btn>
              <v-btn
                variant="text"
                :loading="exportingId === p.id"
                :disabled="deletingId !== null || importingProject || (exportingId !== null && exportingId !== p.id)"
                @click="handleExportProject(p.id)"
              >
                Export
              </v-btn>
              <v-spacer />
              <v-btn
                color="error"
                variant="text"
                :loading="deletingId === p.id"
                :disabled="deletingId !== null || exportingId !== null || importingProject"
                @click="requestDeleteProject(p.id, p.name)"
              >
                Move to Trash
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <LoginDialog v-model="loginOpen" />
    <input
      ref="projectImportInputRef"
      type="file"
      accept=".zip,application/zip"
      style="display: none"
      @change="handleProjectImportFileChange"
    >
    <NewProjectDialog v-model="newProjectOpen" @confirm="handleCreateProject" />
    <v-dialog v-model="confirmDeleteOpen" max-width="420" :persistent="deletingId !== null">
      <v-card>
        <v-card-title>Move project to trash?</v-card-title>
        <v-card-text>
          Are you sure you want to move "{{ pendingDeleteProjectName }}" to trash?
          You can restore it later from the admin recycle bin.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="deletingId !== null" @click="cancelDeleteProject">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="deletingId === pendingDeleteProjectId"
            :disabled="!pendingDeleteProjectId || deletingId !== null"
            @click="confirmDeleteProject"
          >
            Move to Trash
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="duplicateImportDialogOpen" max-width="520" persistent>
      <v-card>
        <v-card-title>检测到同名工程</v-card-title>
        <v-card-text>
          发现同名工程「{{ duplicateImportProjectName }}」
          <span v-if="duplicateImportProjectCount > 1">（共 {{ duplicateImportProjectCount }} 个）</span>。
          请选择导入方式：
          <br>
          1) 替换覆盖：删除现有同名工程后导入。
          <br>
          2) 新建副本：保留现有工程，并创建新的导入副本。
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeDuplicateImportDialogWith('create')">新建副本</v-btn>
          <v-btn color="warning" variant="flat" @click="closeDuplicateImportDialogWith('replace')">替换覆盖</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <!-- OpenProjectDialog removed; project opening is done inline via the list -->
  </div>
</template>

<style scoped>
.pm-root {
  min-height: 100vh;
  background: radial-gradient(circle at top, #1e2a38 0%, #0e131a 55%, #080b10 100%);
  padding: 28px 18px 40px;
  box-sizing: border-box;
}

.pm-header {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  color: rgba(255, 255, 255, 0.9);
}

.pm-title {
  font-size: 1.8rem;
  font-weight: 600;
}

.pm-subtitle {
  margin-top: 6px;
  opacity: 0.7;
}

.pm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.pm-body {
  max-width: 1100px;
  margin: 18px auto 0;
}

.pm-empty {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(20, 26, 34, 0.92);
}

.pm-project {
  background: rgba(20, 26, 34, 0.92);
  color: rgba(255, 255, 255, 0.88);
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease;
}

.pm-project__title {
  font-weight: 600;
}

.pm-project__meta {
  opacity: 0.75;
  font-size: 0.85rem;
  word-break: break-all;
}

.pm-close-btn {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 1920;
  color: rgba(255, 255, 255, 0.9);
}

/* Hover effect for project cards */
.pm-project:hover {
  transform: translateY(-6px);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  background: rgba(30, 36, 44, 0.98);
  cursor: pointer;
}

/* Active project highlight */
.pm-project--active {
  outline: 3px solid rgba(38, 198, 218, 0.18);
  box-shadow: 0 20px 64px rgba(2, 120, 130, 0.18);
  background: linear-gradient(180deg, rgba(24,30,36,0.98), rgba(14,20,26,0.98));
  border-left: 4px solid #00acc1;
}

/* Slightly stronger visual on active + hover */
.pm-project--active:hover {
  transform: translateY(-8px);
  box-shadow: 0 26px 78px rgba(2, 120, 130, 0.22);
}
</style>
