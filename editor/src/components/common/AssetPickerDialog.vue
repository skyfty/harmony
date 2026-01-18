<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import AssetPickerList from '@/components/common/AssetPickerList.vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    assetId?: string
    assetType?: string
    seriesId?: string
    /** Optional list of allowed filename extensions (without dot), e.g. ['wall', 'glb']. */
    extensions?: string[]
    assets?: ProjectAsset[]
    anchor?: { x: number; y: number } | null
    title?: string
    confirmText?: string
    cancelText?: string
    showSearch?: boolean
    disabled?: boolean
  }>(),
  {
    assetId: '',
    assetType: '',
    seriesId: '',
    anchor: null,
    showSearch: true,
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'update:asset', value: ProjectAsset | null): void
  (event: 'cancel'): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const panelRef = ref<HTMLDivElement | null>(null)
const panelStyle = ref<Record<string, string>>({ top: '0px', left: '0px' })
let resizeRaf: number | null = null
let listenersAttached = false

function getAnchorPoint(): { x: number; y: number } {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 }
  }
  const point = props.anchor
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return point
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

async function updatePanelPosition() {
  if (!dialogOpen.value) {
    return
  }
  await nextTick()
  const panel = panelRef.value
  if (!panel || typeof window === 'undefined') {
    return
  }
  const { innerWidth: viewportWidth, innerHeight: viewportHeight } = window
  const anchor = getAnchorPoint()
  const offset = 12
  const rect = panel.getBoundingClientRect()
  const width = rect.width
  const height = rect.height

  let left = anchor.x + offset
  let top = anchor.y + offset

  if (left + width > viewportWidth - offset) {
    left = anchor.x - width - offset
  }
  if (top + height > viewportHeight - offset) {
    top = anchor.y - height - offset
  }

  if (left + width > viewportWidth - offset) {
    left = viewportWidth - width - offset
  }
  if (top + height > viewportHeight - offset) {
    top = viewportHeight - height - offset
  }

  if (left < offset) {
    left = offset
  }
  if (top < offset) {
    top = offset
  }

  panelStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  }
}

function queuePanelReposition() {
  if (!dialogOpen.value) {
    return
  }
  if (resizeRaf !== null) {
    cancelAnimationFrame(resizeRaf)
  }
  resizeRaf = requestAnimationFrame(async () => {
    resizeRaf = null
    await updatePanelPosition()
  })
}

function handleGlobalPointerDown(event: PointerEvent) {
  if (!dialogOpen.value) {
    return
  }
  const panel = panelRef.value
  if (!panel) {
    return
  }
  const target = event.target as Node | null
  if (target && panel.contains(target)) {
    return
  }
  handleCancel()
}

function handleKeydown(event: KeyboardEvent) {
  if (!dialogOpen.value) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
  }
}

function attachGlobalListeners() {
  if (typeof window === 'undefined' || listenersAttached) {
    return
  }
  document.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('resize', queuePanelReposition)
  window.addEventListener('scroll', queuePanelReposition, true)
  document.addEventListener('keydown', handleKeydown)
  listenersAttached = true
}

function detachGlobalListeners() {
  if (!listenersAttached || typeof window === 'undefined') {
    return
  }
  document.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('resize', queuePanelReposition)
  window.removeEventListener('scroll', queuePanelReposition, true)
  document.removeEventListener('keydown', handleKeydown)
  listenersAttached = false
  if (resizeRaf !== null) {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = null
  }
}

function handleCancel() {
  emit('cancel')
  dialogOpen.value = false
}

function handleListLayout() {
  queuePanelReposition()
}

onMounted(() => {
  if (dialogOpen.value) {
    attachGlobalListeners()
    queuePanelReposition()
  }
})

onBeforeUnmount(() => {
  detachGlobalListeners()
})

watch(dialogOpen, (open) => {
  if (open) {
    attachGlobalListeners()
    const anchor = getAnchorPoint()
    panelStyle.value = {
      top: `${Math.round(anchor.y + 12)}px`,
      left: `${Math.round(anchor.x + 12)}px`,
    }
    queuePanelReposition()
  } else {
    detachGlobalListeners()
  }
})

watch(
  () => (props.anchor ? `${props.anchor.x},${props.anchor.y}` : ''),
  () => {
    if (dialogOpen.value) {
      queuePanelReposition()
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <transition name="asset-dialog-popover">
      <div v-if="dialogOpen" class="asset-picker-dialog__wrapper">
        <div ref="panelRef" class="asset-picker-dialog__popover" :style="panelStyle">
          <v-toolbar density="compact" class="panel-toolbar" height="40px">
            <div class="toolbar-text">
              <div class="asset-picker-dialog__title">{{ title ?? 'Select Asset' }}</div>
            </div>
            <v-spacer />
            <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleCancel" />
          </v-toolbar>

          <AssetPickerList
            :active="dialogOpen"
            :asset-id="assetId"
            :asset-type="assetType"
            :series-id="seriesId"
            :extensions="extensions"
            :assets="assets"
            :show-search="showSearch"
            :thumbnail-size="50"
            @update:asset="(asset) => emit('update:asset', asset)"
            @layout="handleListLayout"
          />
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.asset-picker-dialog__wrapper {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 40;
}

.asset-picker-dialog__popover {
  position: fixed;
  pointer-events: auto;
  width: 320px;
  max-width: 360px;
  max-height: min(600px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;

  background-color: rgba(18, 22, 28, 0.72);

  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}

.asset-picker-dialog__title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.94);
}
</style>
