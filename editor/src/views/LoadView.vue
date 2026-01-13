<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EditorView from '@/views/EditorView.vue'
import { useScenesStore } from '@/stores/scenesStore'
import { waitForPiniaHydration } from '@/utils/piniaPersist'
import { useSceneStore } from '@/stores/sceneStore'
import { useProjectsStore } from '@/stores/projectsStore'
import { buildServerApiUrl } from '@/api/serverApiConfig'


const LoadingScreen = defineComponent({
  name: 'EditorLoadingScreen',
  props: {
    progress: { type: Number, default: 0 },
    status: { type: String, default: 'Initializing…' },
    error: { type: String, default: null },
    retrying: { type: Boolean, default: false },
  },
  emits: ['retry', 'backToProjects'],
  setup(props, { emit }) {
    const percent = computed(() => {
      const value = Number.isFinite(props.progress) ? Math.round(props.progress) : 0
      return Math.min(100, Math.max(0, value))
    })

    const hasError = computed(() => typeof props.error === 'string' && props.error.trim().length > 0)

    const handleRetry = () => {
      if (!props.retrying) {
        emit('retry')
      }
    }

    const handleBackToProjects = () => {
      emit('backToProjects')
    }

    return () =>
      h('div', { class: 'load-root' }, [
        h('div', { class: 'load-card' }, [
          h('header', { class: 'load-header' }, [
            h('h1', { class: 'load-title' }, 'Harmony Scene Editor'),
            h('p', { class: 'load-subtitle' }, props.status),
          ]),
          h('section', { class: 'load-body' }, [
            h(
              'div',
              {
                class: 'progress-track',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': percent.value,
              },
              [h('div', { class: 'progress-fill', style: { width: `${percent.value}%` } })],
            ),
            h('div', { class: 'progress-label' }, `${percent.value}%`),
            hasError.value
              ? h('div', { class: 'load-error' }, [
                  h('span', { class: 'load-error__text' }, props.error),
                  // Retry button
                  h(
                    'button',
                    {
                      class: 'load-retry-button',
                      type: 'button',
                      disabled: props.retrying,
                      onClick: handleRetry,
                    },
                    props.retrying ? 'Retrying…' : 'Retry',
                  ),
                  // If project missing error, offer a return-to-projects button
                  typeof props.error === 'string' && props.error.includes('Project does not exist')
                    ? h(
                        'button',
                        {
                          class: 'load-back-button',
                          type: 'button',
                          onClick: handleBackToProjects,
                        },
                        'Return to Projects',
                      )
                    : null,
                ])
              : null,
          ]),
        ]),
      ])
  },
})

const scenesStore = useScenesStore()
const projectsStore = useProjectsStore()
const route = useRoute()
const router = useRouter()

const currentComponent = shallowRef<typeof LoadingScreen | typeof EditorView>(LoadingScreen)
const progress = ref(5)
const statusMessage = ref('Initializing scene editor…')
const errorMessage = ref<string | null>(null)
const isBooting = ref(false)
const isRetrying = ref(false)

async function bootstrap() {
  if (isBooting.value) {
    return
  }
  isBooting.value = true
  errorMessage.value = null
  statusMessage.value = 'Initializing scene directory…'
  progress.value = 12

  try {
    const projectIdRaw = route.query.projectId
    const projectId = typeof projectIdRaw === 'string' ? projectIdRaw.trim() : ''
    if (!projectId) {
      await router.replace({ path: '/' })
      return
    }

    projectsStore.setActiveProject(projectId)

    await Promise.all([scenesStore.initialize(), projectsStore.initialize()])

    const project = await projectsStore.loadProjectDocument(projectId)
    if (!project) {
      errorMessage.value = 'Project does not exist or has been deleted'
      statusMessage.value = 'Load failed'
      progress.value = 100
      return
    }

    statusMessage.value = 'Syncing local save…'
    progress.value = 28
    const sceneStore = useSceneStore()
    await waitForPiniaHydration()

    statusMessage.value = 'Checking scene data…'
    progress.value = 46

    // Ensure a default scene exists for newly created projects.
    if (!project.scenes.length) {
      statusMessage.value = 'Creating default scene…'
      progress.value = 60
      const newSceneId = await sceneStore.createScene('New Scene')
      const doc = await scenesStore.loadSceneDocument(newSceneId)
      if (!doc) {
        throw new Error('Failed to create default scene')
      }
      const sceneJsonUrl = buildServerApiUrl(`/api/user-scenes/${encodeURIComponent(doc.id)}`)
      await projectsStore.saveProjectDocument({
        ...project,
        scenes: [
          {
            id: doc.id,
            name: doc.name,
            sceneJsonUrl,
            projectId: project.id,
          },
        ],
        lastEditedSceneId: doc.id,
      })
    }

    const latestProject = (await projectsStore.loadProjectDocument(projectId)) ?? project
    const sceneIds = new Set(latestProject.scenes.map((s) => s.id))
    const preferred = latestProject.lastEditedSceneId && sceneIds.has(latestProject.lastEditedSceneId)
      ? latestProject.lastEditedSceneId
      : latestProject.scenes[0]?.id

    if (!preferred) {
      throw new Error('Project missing default scene')
    }

    statusMessage.value = '打开工程…'
    progress.value = 78
    const opened = await sceneStore.selectScene(preferred)
    if (!opened) {
      throw new Error('Failed to open scene')
    }
    await projectsStore.setLastEditedScene(projectId, preferred)

    await nextTick()

    statusMessage.value = 'Loading complete'
    progress.value = 100
    currentComponent.value = EditorView
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Load failed'
    console.error('[LoadView] Failed to initialize editor', error)
    errorMessage.value = message
    statusMessage.value = 'Load failed'
    progress.value = 100
  } finally {
    isBooting.value = false
    isRetrying.value = false
  }
}

function handleRetry() {
  if (isBooting.value) {
    return
  }
  isRetrying.value = true
  progress.value = 12
  statusMessage.value = 'Retrying load…'
  bootstrap()
}

const componentProps = computed(() =>
  currentComponent.value === LoadingScreen
    ? {
        progress: progress.value,
        status: statusMessage.value,
        error: errorMessage.value,
        retrying: isRetrying.value,
        onRetry: handleRetry,
        onBackToProjects: typeof errorMessage.value === 'string' && errorMessage.value.includes('Project does not exist')
          ? () => router.replace({ path: '/' })
          : undefined,
      }
    : {},
)

onMounted(() => {
  bootstrap()
})
</script>

<template>
  <component :is="currentComponent" v-bind="componentProps" />
</template>

<style scoped>
.load-root {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at top, #1e2a38 0%, #0e131a 55%, #080b10 100%);
  padding: 32px 16px;
  box-sizing: border-box;
}

.load-card {
  width: min(420px, 100%);
  background: rgba(20, 26, 34, 0.92);
  border-radius: 18px;
  padding: 32px 28px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px);
  color: #f5f7fa;
}

.load-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 32px;
}

.load-title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
}

.load-subtitle {
  margin: 0;
  font-size: 1rem;
  opacity: 0.78;
}

.load-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.progress-track {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #00acc1 0%, #26c6da 60%, #80deea 100%);
  border-radius: 999px;
  transition: width 200ms ease;
}

.progress-label {
  align-self: flex-end;
  font-size: 0.95rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.82);
}

.load-error {
  margin-top: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(207, 102, 121, 0.18);
  border: 1px solid rgba(244, 143, 177, 0.35);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.load-error__text {
  color: #ff8a80;
  font-size: 0.95rem;
}

.load-retry-button {
  align-self: flex-end;
  padding: 8px 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: transparent;
  color: #f5f7fa;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 120ms ease, color 120ms ease;
}

.load-retry-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.load-retry-button:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.15);
}

@media (max-width: 480px) {
  .load-card {
    padding: 28px 22px;
  }

  .load-title {
    font-size: 1.5rem;
  }
}
</style>