<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '@/stores/projectsStore'
import { useAuthStore } from '@/stores/authStore'
import { useScenesStore } from '@/stores/scenesStore'
import LoginDialog from '@/components/layout/LoginDialog.vue'
import NewProjectDialog from '@/components/layout/NewProjectDialog.vue'
import OpenProjectDialog from '@/components/layout/OpenProjectDialog.vue'

const router = useRouter()
const projectsStore = useProjectsStore()
const scenesStore = useScenesStore()
const authStore = useAuthStore()

const loginOpen = ref(false)
const newProjectOpen = ref(false)
const openProjectOpen = ref(false)
const deletingId = ref<string | null>(null)

const isLoggedIn = computed(() => !!authStore.user)
const projects = computed(() => projectsStore.sortedMetadata)

async function refreshAll() {
  await Promise.all([projectsStore.initialize(), scenesStore.initialize()])
}

onMounted(() => {
  refreshAll()
})

function openLogin() {
  loginOpen.value = true
}

async function handleCreateProject(payload: { name: string }) {
  await projectsStore.initialize()
  const project = await projectsStore.createProject(payload.name)
  // Opening the project will create default scene if missing.
  await router.push({ path: '/editor', query: { projectId: project.id } })
}

async function handleOpenProject(payload: { projectId: string }) {
  await router.push({ path: '/editor', query: { projectId: payload.projectId } })
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

async function handleSync() {
  await Promise.all([
    projectsStore.syncUserWorkspaceFromServer({ replace: true }),
    scenesStore.syncUserWorkspaceFromServer({ replace: true }),
  ])
}
</script>

<template>
  <div class="pm-root">
    <div class="pm-header">
      <div>
        <div class="pm-title">Harmony Projects</div>
        <div class="pm-subtitle">Local-first · Sign in to sync to cloud</div>
      </div>
      <div class="pm-actions">
        <v-btn variant="text" @click="openLogin">Sign In</v-btn>
        <v-btn variant="text" :disabled="!isLoggedIn" @click="handleSync">Sync</v-btn>
        <v-btn color="primary" variant="flat" @click="newProjectOpen = true">New Project</v-btn>
        <v-btn variant="outlined" @click="openProjectOpen = true">Open Project…</v-btn>
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
          <v-card class="pm-project" variant="elevated">
            <v-card-title class="pm-project__title">{{ p.name }}</v-card-title>
            <v-card-subtitle>{{ p.sceneCount }} scenes</v-card-subtitle>
            <v-card-text class="pm-project__meta">{{ p.id }}</v-card-text>
            <v-card-actions>
              <v-btn color="primary" variant="flat" @click="handleOpenProject({ projectId: p.id })">Open</v-btn>
              <v-spacer />
              <v-btn
                color="error"
                variant="text"
                :loading="deletingId === p.id"
                :disabled="deletingId !== null"
                @click="handleDeleteProject(p.id)"
              >
                Delete (cascade)
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <LoginDialog v-model="loginOpen" />
    <NewProjectDialog v-model="newProjectOpen" @confirm="handleCreateProject" />
    <OpenProjectDialog v-model="openProjectOpen" :projects="projects" @open="handleOpenProject" />
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
}

.pm-project__title {
  font-weight: 600;
}

.pm-project__meta {
  opacity: 0.75;
  font-size: 0.85rem;
  word-break: break-all;
}
</style>
