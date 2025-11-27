<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, ref, shallowRef } from 'vue'
import EditorView from '@/views/EditorView.vue'
import { useScenesStore } from '@/stores/scenesStore'
import { waitForPiniaHydration } from '@/utils/piniaPersist'
import { useSceneStore } from '@/stores/sceneStore'


const LoadingScreen = defineComponent({
  name: 'EditorLoadingScreen',
  props: {
    progress: { type: Number, default: 0 },
    status: { type: String, default: '正在初始化…' },
    error: { type: String, default: null },
    retrying: { type: Boolean, default: false },
  },
  emits: ['retry'],
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

    return () =>
      h('div', { class: 'load-root' }, [
        h('div', { class: 'load-card' }, [
          h('header', { class: 'load-header' }, [
            h('h1', { class: 'load-title' }, 'Harmony 场景编辑器'),
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
                  h(
                    'button',
                    {
                      class: 'load-retry-button',
                      type: 'button',
                      disabled: props.retrying,
                      onClick: handleRetry,
                    },
                    props.retrying ? '重试中…' : '重试',
                  ),
                ])
              : null,
          ]),
        ]),
      ])
  },
})

const scenesStore = useScenesStore()

const currentComponent = shallowRef<typeof LoadingScreen | typeof EditorView>(LoadingScreen)
const progress = ref(5)
const statusMessage = ref('正在初始化场景编辑器…')
const errorMessage = ref<string | null>(null)
const isBooting = ref(false)
const isRetrying = ref(false)

async function bootstrap() {
  if (isBooting.value) {
    return
  }
  isBooting.value = true
  errorMessage.value = null
  statusMessage.value = '初始化场景目录…'
  progress.value = 12

  try {
    await scenesStore.initialize()

    statusMessage.value = '同步本地存档…'
    progress.value = 28
    useSceneStore()
    await waitForPiniaHydration()

    statusMessage.value = '检查场景数据…'
    progress.value = 46

    await nextTick()

    statusMessage.value = '加载完成'
    progress.value = 100
    currentComponent.value = EditorView
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败'
    console.error('[LoadView] Failed to initialize editor', error)
    errorMessage.value = message
    statusMessage.value = '加载失败'
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
  statusMessage.value = '重新尝试加载…'
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