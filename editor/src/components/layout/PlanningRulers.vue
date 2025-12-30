<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { computeRulerSteps, formatMetersValue, generateTicks } from '../../utils/rulerTicks'

const props = defineProps<{
  viewportWidth: number
  viewportHeight: number
  renderScale: number
  centerOffset: { x: number; y: number }
  offset: { x: number; y: number }
  canvasSize: { width: number; height: number }
  thickness?: number
}>()

const emit = defineEmits<{
  (
    event: 'guide-drag',
    payload: { phase: 'start' | 'move' | 'end' | 'cancel'; axis: 'x' | 'y'; clientX: number; clientY: number },
  ): void
}>()

const thickness = computed(() => {
  const raw = Number(props.thickness ?? 34)
  return Number.isFinite(raw) ? Math.max(18, Math.min(64, Math.round(raw))) : 34
})

const topCanvasRef = ref<HTMLCanvasElement | null>(null)
const leftCanvasRef = ref<HTMLCanvasElement | null>(null)

let rafHandle: number | null = null
function scheduleDraw() {
  if (rafHandle !== null) return
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null
    draw()
  })
}

function worldFromScreenX(screenX: number): number {
  return (screenX - props.centerOffset.x) / Math.max(1e-6, props.renderScale) - props.offset.x
}

function worldFromScreenY(screenY: number): number {
  return (screenY - props.centerOffset.y) / Math.max(1e-6, props.renderScale) - props.offset.y
}

function draw() {
  drawTopRuler()
  drawLeftRuler()
}

function setupCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number) {
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.floor(cssWidth))
  const height = Math.max(1, Math.floor(cssHeight))
  const nextW = Math.floor(width * dpr)
  const nextH = Math.floor(height * dpr)
  if (canvas.width !== nextW) canvas.width = nextW
  if (canvas.height !== nextH) canvas.height = nextH

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return { ctx, width, height }
}

function drawTopRuler() {
  const canvas = topCanvasRef.value
  if (!canvas) return

  const rulerThickness = thickness.value
  const cssWidth = Math.max(0, props.viewportWidth - rulerThickness)
  const cssHeight = rulerThickness
  const setup = setupCanvas(canvas, cssWidth, cssHeight)
  if (!setup) return
  const { ctx, width, height } = setup

  // Background
  ctx.fillStyle = 'rgba(18, 22, 30, 0.75)'
  ctx.fillRect(0, 0, width, height)

  // Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.beginPath()
  ctx.moveTo(0, height - 0.5)
  ctx.lineTo(width, height - 0.5)
  ctx.stroke()

  const ppm = props.renderScale
  const steps = computeRulerSteps(ppm)

  const visibleMin = worldFromScreenX(rulerThickness)
  const visibleMax = worldFromScreenX(rulerThickness + width)

  const ticks = generateTicks({
    visibleMinMeters: visibleMin,
    visibleMaxMeters: visibleMax,
    axisMaxMeters: props.canvasSize.width,
    majorStepMeters: steps.majorStepMeters,
    minorStepMeters: steps.minorStepMeters,
    anchorMeters: props.canvasSize.width / 2,
  })

  // Minor ticks
  ctx.strokeStyle = 'rgba(244, 246, 251, 0.35)'
  ctx.lineWidth = 1
  for (const t of ticks.minor) {
    const x = (t.valueMeters + props.offset.x) * ppm + props.centerOffset.x
    const sx = x - rulerThickness // top ruler starts after corner
    if (sx < 0 || sx > width) continue
    ctx.beginPath()
    ctx.moveTo(Math.round(sx) + 0.5, height)
    ctx.lineTo(Math.round(sx) + 0.5, height - 6)
    ctx.stroke()
  }

  // Major ticks + labels
  ctx.strokeStyle = 'rgba(244, 246, 251, 0.65)'
  ctx.fillStyle = 'rgba(244, 246, 251, 0.92)'
  ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'

  for (const t of ticks.major) {
    const x = (t.valueMeters + props.offset.x) * ppm + props.centerOffset.x
    const sx = x - rulerThickness
    if (sx < -1 || sx > width + 1) continue
    const px = Math.round(sx) + 0.5
    ctx.beginPath()
    ctx.moveTo(px, height)
    ctx.lineTo(px, height - 10)
    ctx.stroke()

    // 以画布中心为原点：右侧为正，左侧为负
    const centerX = props.canvasSize.width / 2
    const relX = t.valueMeters - centerX
    const label = formatMetersValue(relX, steps.majorStepMeters)
    if (label) {
      ctx.fillText(label, px, 3)
    }
  }
}

function drawLeftRuler() {
  const canvas = leftCanvasRef.value
  if (!canvas) return

  const rulerThickness = thickness.value
  const cssWidth = rulerThickness
  const cssHeight = Math.max(0, props.viewportHeight - rulerThickness)
  const setup = setupCanvas(canvas, cssWidth, cssHeight)
  if (!setup) return
  const { ctx, width, height } = setup

  // Background
  ctx.fillStyle = 'rgba(18, 22, 30, 0.75)'
  ctx.fillRect(0, 0, width, height)

  // Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.beginPath()
  ctx.moveTo(width - 0.5, 0)
  ctx.lineTo(width - 0.5, height)
  ctx.stroke()

  const ppm = props.renderScale
  const steps = computeRulerSteps(ppm)

  const visibleMin = worldFromScreenY(rulerThickness)
  const visibleMax = worldFromScreenY(rulerThickness + height)

  const ticks = generateTicks({
    visibleMinMeters: visibleMin,
    visibleMaxMeters: visibleMax,
    axisMaxMeters: props.canvasSize.height,
    majorStepMeters: steps.majorStepMeters,
    minorStepMeters: steps.minorStepMeters,
    anchorMeters: props.canvasSize.height / 2,
  })

  // Minor ticks
  ctx.strokeStyle = 'rgba(244, 246, 251, 0.35)'
  ctx.lineWidth = 1
  for (const t of ticks.minor) {
    const y = (t.valueMeters + props.offset.y) * ppm + props.centerOffset.y
    const sy = y - rulerThickness
    if (sy < 0 || sy > height) continue
    ctx.beginPath()
    ctx.moveTo(width, Math.round(sy) + 0.5)
    ctx.lineTo(width - 6, Math.round(sy) + 0.5)
    ctx.stroke()
  }

  // Major ticks + labels
  ctx.strokeStyle = 'rgba(244, 246, 251, 0.65)'
  ctx.fillStyle = 'rgba(244, 246, 251, 0.92)'
  const baseFont = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  const smallFont = '9px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  ctx.font = baseFont
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (const t of ticks.major) {
    const y = (t.valueMeters + props.offset.y) * ppm + props.centerOffset.y
    const sy = y - rulerThickness
    if (sy < -1 || sy > height + 1) continue
    const py = Math.round(sy) + 0.5
    ctx.beginPath()
    ctx.moveTo(width, py)
    ctx.lineTo(width - 10, py)
    ctx.stroke()

    // 以画布中心为原点：上方为正，下方为负
    const centerY = props.canvasSize.height / 2
    const relY = centerY - t.valueMeters
    const label = formatMetersValue(relY, steps.majorStepMeters)
    if (label) {
      ctx.font = baseFont
      const maxLabelWidth = Math.max(0, width - 14)
      if (ctx.measureText(label).width > maxLabelWidth) {
        ctx.font = smallFont
      }
      ctx.fillText(label, width - 12, py)
    }
  }
}

type DragState = { pointerId: number; axis: 'x' | 'y' } | null
const dragState = ref<DragState>(null)

function onPointerDown(axis: 'x' | 'y', event: PointerEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  dragState.value = { pointerId: event.pointerId, axis }
  target.setPointerCapture?.(event.pointerId)
  emit('guide-drag', { phase: 'start', axis, clientX: event.clientX, clientY: event.clientY })
}

function onPointerMove(event: PointerEvent) {
  const state = dragState.value
  if (!state) return
  emit('guide-drag', { phase: 'move', axis: state.axis, clientX: event.clientX, clientY: event.clientY })
}

function finishDrag(event: PointerEvent, phase: 'end' | 'cancel') {
  const state = dragState.value
  if (!state) return
  dragState.value = null
  emit('guide-drag', { phase, axis: state.axis, clientX: event.clientX, clientY: event.clientY })
}

function onWindowPointerUp(event: PointerEvent) {
  finishDrag(event, 'end')
}

function onWindowPointerCancel(event: PointerEvent) {
  finishDrag(event, 'cancel')
}

watchEffect(() => {
  // Any reactive input change should redraw.
  void props.viewportWidth
  void props.viewportHeight
  void props.renderScale
  void props.centerOffset.x
  void props.centerOffset.y
  void props.offset.x
  void props.offset.y
  void props.canvasSize.width
  void props.canvasSize.height
  scheduleDraw()
})

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerCancel)
  scheduleDraw()
})

onBeforeUnmount(() => {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle)
    rafHandle = null
  }
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerCancel)
})

const topCanvasStyle = computed(() => ({
  left: `${thickness.value}px`,
  top: '0px',
  width: `${Math.max(0, props.viewportWidth - thickness.value)}px`,
  height: `${thickness.value}px`,
}))

const leftCanvasStyle = computed(() => ({
  left: '0px',
  top: `${thickness.value}px`,
  width: `${thickness.value}px`,
  height: `${Math.max(0, props.viewportHeight - thickness.value)}px`,
}))

const cornerStyle = computed(() => ({
  left: '0px',
  top: '0px',
  width: `${thickness.value}px`,
  height: `${thickness.value}px`,
}))
</script>

<template>
  <div class="planning-rulers" aria-hidden="true">
    <div class="planning-rulers__corner" :style="cornerStyle" />

    <canvas
      ref="topCanvasRef"
      class="planning-ruler planning-ruler--top"
      :style="topCanvasStyle"
      @pointerdown.prevent="onPointerDown('x', $event as PointerEvent)"
    />

    <canvas
      ref="leftCanvasRef"
      class="planning-ruler planning-ruler--left"
      :style="leftCanvasStyle"
      @pointerdown.prevent="onPointerDown('y', $event as PointerEvent)"
    />
  </div>
</template>

<style scoped>
.planning-rulers {
  position: absolute;
  inset: 0;
  z-index: 7000;
  pointer-events: none;
  user-select: none;
}

.planning-rulers__corner {
  position: absolute;
  background: rgba(18, 22, 30, 0.75);
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.planning-ruler {
  position: absolute;
  display: block;
  pointer-events: auto;
}
</style>
