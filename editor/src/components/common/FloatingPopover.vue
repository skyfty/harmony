<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    anchor?: { x: number; y: number } | null
    width?: number
    maxWidth?: number
    maxHeight?: string
    offset?: number
    zIndex?: number
    closeOnOutside?: boolean
    closeOnEsc?: boolean
    panelClass?: string
  }>(),
  {
    anchor: null,
    width: 320,
    maxWidth: 360,
    maxHeight: 'min(600px, calc(100vh - 32px))',
    offset: 12,
    zIndex: 40,
    closeOnOutside: true,
    closeOnEsc: true,
    panelClass: '',
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'cancel'): void
}>()

const open = computed({
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
  if (!open.value) {
    return
  }
  await nextTick()
  const panel = panelRef.value
  if (!panel || typeof window === 'undefined') {
    return
  }

  const { innerWidth: viewportWidth, innerHeight: viewportHeight } = window
  const anchor = getAnchorPoint()
  const offset = props.offset
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
  if (!open.value || typeof window === 'undefined') {
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

function handleWindowResize() {
  queuePanelReposition()
}

function handleWindowScroll() {
  queuePanelReposition()
}

function closeAsCancel() {
  emit('cancel')
  open.value = false
}

function handleGlobalPointerDown(event: PointerEvent) {
  if (!open.value || !props.closeOnOutside) {
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
  closeAsCancel()
}

function handleKeydown(event: KeyboardEvent) {
  if (!open.value || !props.closeOnEsc) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeAsCancel()
  }
}

function attachGlobalListeners() {
  if (typeof window === 'undefined' || listenersAttached) {
    return
  }
  document.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('scroll', handleWindowScroll, true)
  document.addEventListener('keydown', handleKeydown)
  listenersAttached = true
}

function detachGlobalListeners() {
  if (!listenersAttached || typeof window === 'undefined') {
    return
  }
  document.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('scroll', handleWindowScroll, true)
  document.removeEventListener('keydown', handleKeydown)
  listenersAttached = false
  if (resizeRaf !== null) {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = null
  }
}

onMounted(() => {
  if (open.value) {
    attachGlobalListeners()
    queuePanelReposition()
  }
})

onBeforeUnmount(() => {
  detachGlobalListeners()
})

watch(open, (value) => {
  if (value) {
    attachGlobalListeners()
    const anchor = getAnchorPoint()
    panelStyle.value = {
      top: `${Math.round(anchor.y + props.offset)}px`,
      left: `${Math.round(anchor.x + props.offset)}px`,
    }
    queuePanelReposition()
  } else {
    detachGlobalListeners()
  }
})

watch(
  () => props.anchor,
  () => {
    if (open.value) {
      queuePanelReposition()
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <transition name="floating-popover">
      <div v-if="open" class="floating-popover__wrapper" :style="{ zIndex: String(zIndex) }">
        <div
          ref="panelRef"
          class="floating-popover__panel"
          :class="panelClass"
          :style="{
            ...panelStyle,
            width: `${width}px`,
            maxWidth: `${maxWidth}px`,
            maxHeight,
          }"
        >
          <div v-if="$slots.header" class="floating-popover__header">
            <slot name="header" />
          </div>
          <div class="floating-popover__body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="floating-popover__footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.floating-popover__wrapper {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.floating-popover__panel {
  position: fixed;
  pointer-events: auto;
  display: flex;
  flex-direction: column;

  background-color: rgba(18, 22, 28, 0.72);
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.floating-popover__header {
  flex: 0 0 auto;
}

.floating-popover__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.floating-popover__footer {
  flex: 0 0 auto;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 14, 20, 0.6);
}

.floating-popover-enter-active,
.floating-popover-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.floating-popover-enter-from,
.floating-popover-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
