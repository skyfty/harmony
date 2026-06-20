<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VProgressLinear } from 'vuetify/components'
import EditorView from '@/views/EditorView.vue'
import { useScenesStore } from '@/stores/scenesStore'
import { waitForPiniaHydration } from '@/utils/piniaPersist'
import { useSceneStore } from '@/stores/sceneStore'
import { useProjectsStore } from '@/stores/projectsStore'
import { useAuthStore } from '@/stores/authStore'
import { isLocalEditEnabled } from '@/utils/localEdit'

type BootstrapErrorCode =
  | 'project-not-found'
  | 'project-has-no-scenes'
  | 'missing-last-scene'
  | 'invalid-route-scene'
  | 'invalid-last-scene'
  | 'scene-open-failed'
  | 'unknown'

const LoadingScreen = defineComponent({
  name: 'EditorLoadingScreen',
  props: {
    progress: { type: Number, default: 0 },
    detail: { type: String, default: '' },
    status: { type: String, default: 'Initializing...' },
    error: { type: String, default: null },
    retrying: { type: Boolean, default: false },
    canRetry: { type: Boolean, default: false },
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
            h('div', { class: 'load-status-row' }, [
              h('span', { class: 'load-status-row__label', title: props.status }, props.status),
              h('span', { class: 'load-status-row__percent' }, `${percent.value}%`),
            ]),
            props.detail ? h('p', { class: 'load-detail' }, props.detail) : null,
          ]),
          h('section', { class: 'load-body' }, [
            h(VProgressLinear, {
              class: 'load-progress',
              modelValue: percent.value,
              height: 14,
              rounded: 'pill',
              bgColor: 'rgba(255, 255, 255, 0.10)',
              color: 'cyan-lighten-2',
              'aria-valuetext': `${percent.value}%`,
            }),
            h('div', { class: 'progress-caption' }, `Progress ${percent.value}%`),
            hasError.value
              ? h('div', { class: 'load-error' }, [
                  h('span', { class: 'load-error__text' }, props.error),
                  h(
                    'div',
                    { class: 'load-error__actions' },
                    [
                          props.canRetry
                            ? h(
                                'button',
                                {
                                  class: 'load-retry-button',
                                  type: 'button',
                                  disabled: props.retrying,
                                  onClick: handleRetry,
                                  'aria-label': 'Retry loading project',
                                },
                                props.retrying ? 'Retrying...' : 'Retry',
                              )
                            : null,
                      h(
                        'button',
                        {
                          class: 'load-back-button',
                          type: 'button',
                          onClick: handleBackToProjects,
                          'aria-label': 'Return to Projects',
                        },
                        'Return to Projects',
                      ),
                    ],
                  ),
                ])
              : null,
          ]),
        ]),
      ])
  },
})

const scenesStore = useScenesStore()
const projectsStore = useProjectsStore()
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const sceneStore = useSceneStore()

const currentComponent = shallowRef<typeof LoadingScreen | typeof EditorView>(LoadingScreen)
const progress = ref(5)
const statusDetail = ref('')
const statusMessage = ref('Initializing editor...')
const errorMessage = ref<string | null>(null)
const errorCode = ref<BootstrapErrorCode | null>(null)
const isBooting = ref(false)
const isRetrying = ref(false)

function formatLifecycleStatus(status: string): string {
  if (!status) {
    return ''
  }
  if (status === 'ready') {
    return 'Loading complete'
  }
  return status
    .split('-')
    .map((part) => part.length ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part)
    .join(' ')
}

watch(
  () => sceneStore.sceneLifecycle,
  (lifecycle) => {
    if (currentComponent.value !== LoadingScreen) {
      return
    }
    progress.value = Math.max(0, Math.min(100, Math.round(lifecycle.progress)))
    statusMessage.value = formatLifecycleStatus(lifecycle.status)
    statusDetail.value = lifecycle.detail
    errorMessage.value = lifecycle.error
  },
  { deep: true, immediate: true },
)

function resolveTargetSceneId(
  project: NonNullable<Awaited<ReturnType<typeof projectsStore.loadProjectDocument>>>,
  routeSceneId: string,
): string {
  const sceneIds = new Set(project.scenes.map((scene) => scene.id))
  if (!sceneIds.size) {
    throw new Error('Project has no scenes')
  }
  if (routeSceneId) {
    if (!sceneIds.has(routeSceneId)) {
      throw new Error('Requested scene is not part of this project')
    }
    return routeSceneId
  }
  if (project.lastEditedSceneId && sceneIds.has(project.lastEditedSceneId)) {
    return project.lastEditedSceneId
  }
  return project.scenes[0]?.id ?? ''
}

function classifyBootstrapError(error: unknown): { code: BootstrapErrorCode; message: string } {
  const message = error instanceof Error ? error.message : 'Load failed'
  switch (message) {
    case 'Project does not exist or has been deleted':
      return { code: 'project-not-found', message }
    case 'Project has no scenes':
      return {
        code: 'project-has-no-scenes',
        message: 'Project has no scenes. Create a scene from the project manager before opening the editor.',
      }
    case 'Requested scene is not part of this project':
      return { code: 'invalid-route-scene', message: 'The requested scene is not part of this project.' }
    case 'Failed to open scene':
      return {
        code: 'scene-open-failed',
        message: 'Failed to open scene. Return to Projects or retry after checking scene data.',
      }
    default:
      return { code: 'unknown', message }
  }
}

function setBootstrapStatus(next: { status: string; progress: number; detail?: string }) {
  statusMessage.value = next.status
  progress.value = Math.max(0, Math.min(100, Math.round(next.progress)))
  statusDetail.value = typeof next.detail === 'string' ? next.detail : ''
}

async function bootstrap() {
  if (isBooting.value) {
    return
  }
  if (!isLocalEditEnabled() && !authStore.isAuthenticated) {
    currentComponent.value = LoadingScreen
    progress.value = 5
    statusDetail.value = ''
    statusMessage.value = 'Redirecting to projects...'
    errorMessage.value = null
    errorCode.value = null
    await router.replace({ path: '/' })
    return
  }
  // Ensure the loading UI is visible when (re)bootstrapping
  currentComponent.value = LoadingScreen
  progress.value = 5
  setBootstrapStatus({
    status: 'Initializing editor',
    progress: 5,
    detail: 'Bootstrapping editor shell.',
  })
  statusMessage.value = 'Initializing editor...'
  isBooting.value = true
  errorMessage.value = null
  errorCode.value = null
  statusMessage.value = 'Initializing workspace...'
  progress.value = 12
  setBootstrapStatus({
    status: 'Initializing workspace',
    progress: 12,
    detail: 'Preparing local workspace stores.',
  })

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
      throw new Error('Project does not exist or has been deleted')
    }

    const routeSceneIdRaw = route.query.sceneId
    const routeSceneId = typeof routeSceneIdRaw === 'string' ? routeSceneIdRaw.trim() : ''

    statusMessage.value = 'Syncing local save...'
    progress.value = 28
    setBootstrapStatus({
      status: 'Syncing local save',
      progress: 28,
      detail: 'Waiting for persisted editor state.',
    })
    await waitForPiniaHydration()

    statusMessage.value = 'Checking scene data...'
    progress.value = 46
    setBootstrapStatus({
      status: 'Checking scene data',
      progress: 46,
      detail: 'Resolving which scene should open.',
    })

    const latestProject = (await projectsStore.loadProjectDocument(projectId)) ?? project
    const preferred = resolveTargetSceneId(latestProject, routeSceneId)

    statusMessage.value = 'Opening project...'
    progress.value = 78
    setBootstrapStatus({
      status: 'Opening project',
      progress: 78,
      detail: 'Preparing scene graph, assets, and terrain cache.',
    })
    const opened = await sceneStore.openScene(preferred, {
      projectId,
      setLastEdited: false,
      showLoadingOverlay: false,
    })
    if (!opened) {
      throw new Error('Failed to open scene')
    }

    await nextTick()

    statusMessage.value = 'Loading complete'
    progress.value = 100
    setBootstrapStatus({
      status: 'Loading complete',
      progress: 100,
      detail: 'Editor is ready.',
    })
    currentComponent.value = EditorView
  } catch (error) {
    const classified = classifyBootstrapError(error)
    console.error('[LoadView] Failed to initialize editor', error)
    errorCode.value = classified.code
    errorMessage.value = classified.message
    statusMessage.value = 'Load failed'
    progress.value = 100
    setBootstrapStatus({
      status: 'Load failed',
      progress: 100,
      detail: classified.message,
    })
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
  statusMessage.value = 'Retrying load...'
  setBootstrapStatus({
    status: 'Retrying load...',
    progress: 12,
    detail: 'Restarting the project boot flow.',
  })
  bootstrap()
}

const componentProps = computed(() =>
  currentComponent.value === LoadingScreen
    ? {
        progress: progress.value,
        status: statusMessage.value,
        detail: statusDetail.value,
        error: errorMessage.value,
        retrying: isRetrying.value,
        canRetry: errorCode.value === 'scene-open-failed' || errorCode.value === 'unknown',
        onRetry: handleRetry,
        onBackToProjects: errorCode.value !== null
          ? () => router.replace({ path: '/' })
          : undefined,
      }
    : {},
)

onMounted(() => {
  bootstrap()
})

// Re-run the loader when the projectId query changes (navigating to the same
// `/editor` route with a different project should re-run the full boot flow).
watch(
  () => [route.query.projectId, route.query.sceneId],
  (newVal, oldVal) => {
    if (newVal[0] !== oldVal[0] || newVal[1] !== oldVal[1]) {
      isRetrying.value = false
      errorMessage.value = null
      errorCode.value = null
      currentComponent.value = LoadingScreen
      statusDetail.value = 'Bootstrapping editor shell.'
      progress.value = 5
      statusMessage.value = 'Initializing editor...'
      bootstrap()
    }
  },
)
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

.load-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.load-status-row__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1rem;
  font-weight: 500;
  color: rgba(245, 247, 250, 0.92);
}

.load-status-row__percent {
  flex: none;
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.82);
}

.load-detail {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.5;
  color: rgba(220, 235, 244, 0.78);
}

.load-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.load-progress {
  width: 100%;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.progress-caption {
  font-size: 0.86rem;
  line-height: 1.2;
  color: rgba(214, 228, 236, 0.78);
  letter-spacing: 0.03em;
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
  padding: 10px 20px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.03);
  color: #f5f7fa;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 600;
  box-shadow: 0 6px 18px rgba(2, 18, 22, 0.22);
  transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, opacity 120ms ease;
}

.load-retry-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.load-retry-button:not(:disabled):hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 26px rgba(2, 18, 22, 0.28);
}

.load-error__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  align-items: center;
}

.load-back-button {
  padding: 10px 20px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(90deg, #00acc1 0%, #26c6da 60%, #80deea 100%);
  color: rgba(2, 18, 22, 0.98);
  cursor: pointer;
  font-size: 1rem;
  font-weight: 700;
  box-shadow: 0 8px 24px rgba(2, 18, 22, 0.35);
  transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  order: -1; /* place before Retry visually */
}

.load-back-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(2, 18, 22, 0.42);
  opacity: 0.98;
}

.load-back-button:active {
  transform: translateY(0);
}

/* Responsive: stack actions on small screens */
@media (max-width: 480px) {
  .load-error__actions {
    flex-direction: column-reverse;
    align-items: stretch;
  }
  .load-back-button,
  .load-retry-button {
    width: 100%;
  }
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
