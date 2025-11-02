<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import type { AnimationBehaviorParams, SceneNode } from '@harmony/schema'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import { useNodePickerStore } from '@/stores/nodePickerStore'

const props = defineProps<{
  modelValue: AnimationBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: AnimationBehaviorParams): void
  (event: 'pick-state-change', value: boolean): void
}>()

const sceneStore = useSceneStore()
const nodePickerStore = useNodePickerStore()
const { nodes } = storeToRefs(sceneStore)

const params = computed<AnimationBehaviorParams>(() => ({
  targetNodeId: props.modelValue?.targetNodeId ?? null,
  clipName: props.modelValue?.clipName ?? null,
  loop: props.modelValue?.loop ?? false,
  waitForCompletion: props.modelValue?.waitForCompletion ?? false,
}))

const isPicking = ref(false)
let activeRequestId: number | null = null

const clipOptions = ref<Array<{ label: string; value: string }>>([])
const isLoadingClips = ref(false)
const clipLoadError = ref<string | null>(null)
let clipLoadRequestId = 0

function updateParams(next: AnimationBehaviorParams) {
  emit('update:modelValue', next)
}

function updateTarget(nodeId: string | null) {
  updateParams({
    targetNodeId: nodeId,
    clipName: null,
    loop: params.value.loop,
    waitForCompletion: nodeId ? params.value.waitForCompletion : false,
  })
}

function updateClip(clipName: string | null) {
  updateParams({
    targetNodeId: params.value.targetNodeId,
    clipName,
    loop: params.value.loop,
    waitForCompletion: params.value.waitForCompletion,
  })
}

function updateLoop(loop: boolean) {
  updateParams({
    targetNodeId: params.value.targetNodeId,
    clipName: params.value.clipName,
    loop,
    waitForCompletion: loop ? false : params.value.waitForCompletion,
  })
}

function updateWait(wait: boolean) {
  updateParams({
    targetNodeId: params.value.targetNodeId,
    clipName: params.value.clipName,
    loop: params.value.loop,
    waitForCompletion: wait,
  })
}

function findNodeName(tree: SceneNode[] | undefined, id: string | null): string | null {
  if (!tree || !id) {
    return null
  }
  for (const node of tree) {
    if (node.id === id) {
      return node.name?.trim().length ? node.name : node.id
    }
    const child = findNodeName(node.children, id)
    if (child) {
      return child
    }
  }
  return null
}

function findNodeById(tree: SceneNode[] | undefined, id: string | null): SceneNode | null {
  if (!tree || !id) {
    return null
  }
  for (const node of tree) {
    if (node.id === id) {
      return node
    }
    const child = findNodeById(node.children, id)
    if (child) {
      return child
    }
  }
  return null
}

const targetNodeName = computed(() => findNodeName(nodes.value, params.value.targetNodeId))

async function loadClipsForNode(nodeId: string | null) {
  const requestId = ++clipLoadRequestId
  clipOptions.value = []
  clipLoadError.value = null
  if (!nodeId) {
    return
  }
  const node = findNodeById(nodes.value, nodeId)
  if (!node) {
    return
  }
  isLoadingClips.value = true
  try {
    let runtimeObject = getRuntimeObject(nodeId)
    if (!runtimeObject) {
      await sceneStore.ensureSceneAssetsReady({ nodes: [node], showOverlay: false, refreshViewport: false })
      runtimeObject = getRuntimeObject(nodeId)
    }
    const clipEntries: Array<{ label: string; value: string }> = []
    const animations = (runtimeObject as unknown as { animations?: THREE.AnimationClip[] })?.animations
    if (Array.isArray(animations) && animations.length) {
      animations.forEach((clip, index) => {
        if (!clip) {
          return
        }
        const rawName = typeof clip.name === 'string' ? clip.name : ''
        const trimmed = rawName.trim()
        const label = trimmed.length ? trimmed : `剪辑 ${index + 1}`
        clipEntries.push({ label, value: trimmed })
      })
    }
    const userDataNames = Array.isArray((runtimeObject as any)?.userData?.__animations)
      ? ((runtimeObject as any).userData.__animations as string[])
      : []
    userDataNames.forEach((name: string) => {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (!trimmed.length) {
        return
      }
      if (clipEntries.some((entry) => entry.value === trimmed)) {
        return
      }
      clipEntries.push({ label: trimmed, value: trimmed })
    })
    if (requestId === clipLoadRequestId) {
      clipOptions.value = clipEntries
    }
  } catch (error) {
    console.warn('[AnimationParams] Failed to load animation clips', error)
    if (requestId === clipLoadRequestId) {
      clipLoadError.value = '无法加载动画剪辑，请稍后重试。'
    }
  } finally {
    if (requestId === clipLoadRequestId) {
      isLoadingClips.value = false
    }
  }
}

watch(
  () => params.value.targetNodeId,
  (nodeId) => {
    void loadClipsForNode(nodeId)
  },
  { immediate: true },
)

watch(
  clipOptions,
  (options) => {
    if (!options.length) {
      if (params.value.clipName) {
        updateClip(null)
      }
      return
    }
    const hasSelection = options.some((option) => option.value === (params.value.clipName ?? '').trim())
    if (!hasSelection) {
      updateClip(null)
    }
  },
  { deep: true },
)

watch(
  () => params.value.loop,
  (loopEnabled) => {
    if (loopEnabled && params.value.waitForCompletion) {
      updateWait(false)
    }
  },
)

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelPicking()
  }
}

function handlePointerDown(event: PointerEvent) {
  if (event.button === 2) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    cancelPicking()
  }
}

function startPicking() {
  if (isPicking.value) {
    return
  }
  isPicking.value = true
  emit('pick-state-change', true)
  activeRequestId = nodePickerStore.beginPick({
  owner: 'behavior-target',
    hint: '选择要播放动画的节点',
    handlers: {
      onPick(nodeId: string) {
        activeRequestId = null
        stopPicking()
        updateTarget(nodeId)
      },
      onCancel() {
        activeRequestId = null
        stopPicking()
      },
    },
  })
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('pointerdown', handlePointerDown, true)
}

function cancelPicking() {
  if (!isPicking.value) {
    return
  }
  if (activeRequestId && nodePickerStore.activeRequestId === activeRequestId) {
    nodePickerStore.cancelActivePick('user')
  } else {
    stopPicking()
  }
}

function stopPicking() {
  if (!isPicking.value) {
    return
  }
  isPicking.value = false
  emit('pick-state-change', false)
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
}

function clearTarget() {
  updateTarget(null)
}

const clipItems = computed(() =>
  clipOptions.value.map((option) => ({
    label: option.label,
    value: option.value.length ? option.value : '',
  })),
)

const clipSelection = computed({
  get() {
    const name = params.value.clipName?.trim() ?? ''
    return name
  },
  set(value: string | null | undefined) {
    const normalized = value?.trim() ?? ''
    updateClip(normalized.length ? normalized : null)
  },
})

const loopSelection = computed({
  get() {
    return params.value.loop
  },
  set(value: boolean) {
    updateLoop(value)
  },
})

const waitSelection = computed({
  get() {
    return params.value.waitForCompletion
  },
  set(value: boolean) {
    updateWait(value)
  },
})

const clipSelectPlaceholder = computed(() => {
  if (!params.value.targetNodeId) {
    return '请先选择一个目标节点'
  }
  if (isLoadingClips.value) {
    return '正在加载可用的动画剪辑…'
  }
  return '选择要播放的动画剪辑'
})

defineExpose({ cancelPicking })

onBeforeUnmount(() => {
  if (isPicking.value) {
    cancelPicking()
  }
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('pointerdown', handlePointerDown, true)
})
</script>

<template>
  <div class="animation-params">
    <div class="animation-params__row">
      <div class="animation-params__target">
        <v-btn
          class="animation-params__icon-button"
          size="small"
          variant="text"
          icon="mdi-crosshairs-gps"
          :loading="isPicking"
          @click="startPicking"
        />
        <span v-if="params.targetNodeId" class="animation-params__value">
          {{ targetNodeName ?? params.targetNodeId }}
        </span>
        <span v-else class="animation-params__placeholder">未选择节点</span>
        <v-btn
          class="animation-params__icon-button animation-params__icon-button--clear"
          size="small"
          variant="text"
          icon="mdi-close"
          :disabled="!params.targetNodeId"
          @click="clearTarget"
        />
      </div>
    </div>
    <div v-if="isPicking" class="animation-params__hint">
      点击场景中的节点进行选择，显示在左侧，右侧显示清除按钮。
    </div>
    <v-select
      v-model="clipSelection"
      class="animation-params__select"
      :items="clipItems"
      label="动画剪辑"
      density="compact"
      variant="underlined"
      hide-details
      :loading="isLoadingClips"
      :disabled="!params.targetNodeId || isLoadingClips"
      :placeholder="clipSelectPlaceholder"
      item-title="label"
      item-value="value"
      clearable
      clear-icon="mdi-close"
    />
    <div v-if="clipLoadError" class="animation-params__message animation-params__message--error">
      {{ clipLoadError }}
    </div>
    <div
      v-else-if="!isLoadingClips && params.targetNodeId && !clipItems.length"
      class="animation-params__message"
    >
      未在该节点上找到可播放的动画剪辑。
    </div>
    <div class="animation-params__switches">
      <v-switch
        v-model="loopSelection"
        label="循环播放"
        density="compact"
        hide-details
        inset
      />
      <v-switch
        v-model="waitSelection"
        label="等待播放完成"
        density="compact"
        hide-details
        inset
        :disabled="loopSelection"
      />
    </div>
  </div>
</template>

<style scoped>
.animation-params {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.animation-params__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.animation-params__target {
  flex: 1;
  min-height: 32px;
  display: flex;
  align-items: center;
  padding: 0 0.4rem;
  border-radius: 6px;
  background: rgba(233, 236, 241, 0.06);
}

.animation-params__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
}

.animation-params__placeholder {
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.5);
}

.animation-params__icon-button {
  color: rgba(233, 236, 241, 0.82);
}

.animation-params__icon-button--clear {
  margin-left: auto;
}

.animation-params__hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.animation-params__select {
  max-width: 100%;
}

.animation-params__switches {
  display: flex;
  gap: 0.5rem;
}

.animation-params__message {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.animation-params__message--error {
  color: #ff8a80;
}
</style>
