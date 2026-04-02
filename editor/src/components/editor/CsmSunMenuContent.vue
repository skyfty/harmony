<template>
  <div class="popup-menu-card__content csm-sun-menu__content">
    <div class="csm-switch-row">
      <v-switch
        :model-value="csmEnabled"
        density="compact"
        hide-details
        color="primary"
        label="Enable CSM"
        @update:model-value="handleCsmEnabledUpdate"
      />
      <v-switch
        :model-value="csmShadowEnabled"
        density="compact"
        hide-details
        color="primary"
        label="Enable Shadows"
        @update:model-value="handleCsmShadowEnabledUpdate"
      />
    </div>
    <div class="csm-sun-grid">
      <div class="material-color">
        <div class="color-input">
          <v-text-field
            v-model="csmLightColorInput"
            label="Light Color"
            density="compact"
            variant="underlined"
            hide-details
            @blur="commitCsmLightColorInput"
            @keydown.enter.prevent="commitCsmLightColorInput"
          />
          <v-menu
            v-model="csmLightColorMenuOpen"
            :close-on-content-click="false"
            transition="scale-transition"
            location="bottom start"
          >
            <template #activator="{ props: menuProps }">
              <button
                class="color-swatch"
                type="button"
                v-bind="menuProps"
                :style="{ backgroundColor: csmLightColorInput }"
              >
                <span class="sr-only">Choose color</span>
              </button>
            </template>
            <div class="color-picker">
              <v-color-picker
                :model-value="csmLightColorInput"
                mode="hex"
                :modes="['hex']"
                hide-inputs
                @update:model-value="handleCsmColorPickerInput"
              />
            </div>
          </v-menu>
        </div>
      </div>
      <v-text-field
        v-model="csmLightIntensityInput"
        type="number"
        min="0"
        max="16"
        step="0.05"
        label="Intensity"
        density="compact"
        variant="underlined"
        hide-details
        @update:modelValue="commitCsmLightIntensityInput"
      />
      <div class="csm-sun-dial-card">
        <div class="csm-sun-dial-card__header">
          <div>
            <div class="csm-sun-dial-card__title">Sun Direction</div>
            <div class="csm-sun-dial-card__caption">Drag the outer ring to adjust azimuth; drag toward the center to raise the sun</div>
          </div>
          <div class="csm-sun-dial-card__values">
            <span class="csm-sun-dial-card__state">{{ currentSunStateLabel }}</span>
            <span>Az {{ displaySunAzimuthDeg }}°</span>
            <span>El {{ displaySunElevationDeg }}°</span>
          </div>
        </div>
        <div
          ref="sunDialRef"
          class="csm-sun-dial"
          role="presentation"
          @pointerdown.stop.prevent="handleSunDialPointerDown"
          @pointermove.stop.prevent="handleSunDialPointerMove"
          @pointerup.stop.prevent="handleSunDialPointerUp"
          @pointercancel.stop.prevent="handleSunDialPointerCancel"
        >
          <div class="csm-sun-dial__ring csm-sun-dial__ring--outer" />
          <div class="csm-sun-dial__ring csm-sun-dial__ring--middle" />
          <div class="csm-sun-dial__ring csm-sun-dial__ring--inner" />
          <div class="csm-sun-dial__axis csm-sun-dial__axis--vertical" />
          <div class="csm-sun-dial__axis csm-sun-dial__axis--horizontal" />
          <span class="csm-sun-dial__label csm-sun-dial__label--north">N</span>
          <span class="csm-sun-dial__label csm-sun-dial__label--east">E</span>
          <span class="csm-sun-dial__label csm-sun-dial__label--south">S</span>
          <span class="csm-sun-dial__label csm-sun-dial__label--west">W</span>
          <span
            class="csm-sun-dial__hint csm-sun-dial__hint--sunrise"
            :class="{ 'csm-sun-dial__hint--active': activeSunReferenceKey === 'sunrise' }"
          >Sunrise</span>
          <span
            class="csm-sun-dial__hint csm-sun-dial__hint--noon"
            :class="{ 'csm-sun-dial__hint--active': activeSunReferenceKey === 'noon' }"
          >Noon</span>
          <span
            class="csm-sun-dial__hint csm-sun-dial__hint--sunset"
            :class="{ 'csm-sun-dial__hint--active': activeSunReferenceKey === 'sunset' }"
          >Sunset</span>
          <div class="csm-sun-dial__center" />
          <div class="csm-sun-dial__ray" :style="sunDialRayStyle" />
          <div class="csm-sun-dial__indicator" :style="sunDialIndicatorStyle" />
        </div>
        <div class="csm-sun-dial-card__legend">
          <span>Sunrise is on the east</span>
          <span>Noon is to the south</span>
          <span>Sunset is on the west</span>
        </div>
      </div>
      <v-text-field
        v-model="csmSunAzimuthDegInput"
        type="number"
        min="-180"
        max="180"
        step="1"
        label="Azimuth (deg)"
        density="compact"
        variant="underlined"
        hide-details
        @focus="handleCsmSunAzimuthFocus"
        @update:modelValue="handleCsmSunAzimuthInput"
        @blur="commitCsmSunAzimuthDegInput"
        @keydown.enter.prevent="commitCsmSunAzimuthDegInput"
      />
      <v-text-field
        v-model="csmSunElevationDegInput"
        type="number"
        min="-10"
        max="89"
        step="1"
        label="Elevation (deg)"
        density="compact"
        variant="underlined"
        hide-details
        @focus="handleCsmSunElevationFocus"
        @update:modelValue="handleCsmSunElevationInput"
        @blur="commitCsmSunElevationDegInput"
        @keydown.enter.prevent="commitCsmSunElevationDegInput"
      />
      <v-select
        v-model="csmCascadesInput"
        :items="csmCascadeOptions"
        item-title="label"
        item-value="value"
        label="Cascades"
        density="compact"
        variant="underlined"
        hide-details
        @update:modelValue="commitCsmCascadesInput"
      />
      <v-text-field
        v-model="csmMaxFarInput"
        type="number"
        min="1"
        max="10000"
        step="10"
        label="Max Far"
        density="compact"
        variant="underlined"
        hide-details
        @update:modelValue="commitCsmMaxFarInput"
      />
      <v-select
        v-model="csmShadowMapSizeInput"
        :items="csmShadowMapSizeOptions"
        item-title="label"
        item-value="value"
        label="Shadow Map"
        density="compact"
        variant="underlined"
        hide-details
        @update:modelValue="commitCsmShadowMapSizeInput"
      />
      <v-text-field
        v-model="csmShadowBiasInput"
        type="number"
        min="-0.01"
        max="0.01"
        step="0.00005"
        label="Shadow Bias"
        density="compact"
        variant="underlined"
        hide-details
        @update:modelValue="commitCsmShadowBiasInput"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  csmEnabled: boolean
  csmShadowEnabled: boolean
  csmLightColor: string
  csmLightIntensity: number
  csmSunAzimuthDeg: number
  csmSunElevationDeg: number
  csmCascades: number
  csmMaxFar: number
  csmShadowMapSize: number
  csmShadowBias: number
}>()

const emit = defineEmits<{
  (event: 'update:csm-enabled', value: boolean): void
  (event: 'update:csm-shadow-enabled', value: boolean): void
  (event: 'update:csm-light-color', value: string): void
  (event: 'update:csm-light-intensity', value: number): void
  (event: 'update:csm-sun-azimuth-deg', value: number): void
  (event: 'update:csm-sun-elevation-deg', value: number): void
  (event: 'update:csm-cascades', value: number): void
  (event: 'update:csm-max-far', value: number): void
  (event: 'update:csm-shadow-map-size', value: number): void
  (event: 'update:csm-shadow-bias', value: number): void
}>()

const csmCascadeOptions: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 (fast)' },
  { value: 2, label: '2' },
  { value: 3, label: '3 (recommended)' },
  { value: 4, label: '4 (high quality)' },
  { value: 5, label: '5' },
  { value: 6, label: '6 (max)' },
]

const csmShadowMapSizeOptions: Array<{ value: number; label: string }> = [
  { value: 128, label: '128' },
  { value: 256, label: '256' },
  { value: 512, label: '512' },
  { value: 1024, label: '1024 (recommended)' },
  { value: 2048, label: '2048 (high quality)' },
  { value: 4096, label: '4096 (very high)' },
  { value: 8192, label: '8192 (extreme)' },
]

const csmLightColorInput = ref(props.csmLightColor)
const csmLightColorMenuOpen = ref(false)
const csmLightIntensityInput = ref(props.csmLightIntensity)
const csmSunAzimuthDegInput = ref(String(props.csmSunAzimuthDeg))
const csmSunElevationDegInput = ref(String(props.csmSunElevationDeg))
const csmCascadesInput = ref(props.csmCascades)
const csmMaxFarInput = ref(props.csmMaxFar)
const csmShadowMapSizeInput = ref(Number(props.csmShadowMapSize))
const csmShadowBiasInput = ref(props.csmShadowBias)
const isEditingCsmSunAzimuth = ref(false)
const isEditingCsmSunElevation = ref(false)
const sunDialRef = ref<HTMLElement | null>(null)
const sunDialPointerId = ref<number | null>(null)

const SUN_AZIMUTH_MIN = -180
const SUN_AZIMUTH_MAX = 180
const SUN_ELEVATION_MIN = -10
const SUN_ELEVATION_MAX = 89
const SUN_DIAL_MAX_ORBIT_PERCENT = 42
const SUN_REFERENCE_SNAP_THRESHOLD_DEG = 12

const SUN_REFERENCE_POINTS = [
  { key: 'sunrise', azimuthDeg: 90 },
  { key: 'noon', azimuthDeg: 180 },
  { key: 'sunset', azimuthDeg: -90 },
] as const

type SunReferenceKey = typeof SUN_REFERENCE_POINTS[number]['key']

watch(() => props.csmLightColor, (value: string) => {
  csmLightColorInput.value = value
})

watch(() => props.csmLightIntensity, (value: number) => {
  csmLightIntensityInput.value = value
})

watch(() => props.csmSunAzimuthDeg, (value: number) => {
  if (!isEditingCsmSunAzimuth.value && sunDialPointerId.value === null) {
    csmSunAzimuthDegInput.value = formatSunAngleValue(value)
  }
})

watch(() => props.csmSunElevationDeg, (value: number) => {
  if (!isEditingCsmSunElevation.value && sunDialPointerId.value === null) {
    csmSunElevationDegInput.value = formatSunAngleValue(value)
  }
})

watch(() => props.csmCascades, (value: number) => {
  csmCascadesInput.value = value
})

watch(() => props.csmMaxFar, (value: number) => {
  csmMaxFarInput.value = value
})

watch(() => props.csmShadowMapSize, (value: number) => {
  csmShadowMapSizeInput.value = Number(value)
})

watch(() => props.csmShadowBias, (value: number) => {
  csmShadowBiasInput.value = value
})

function handleCsmEnabledUpdate(value: unknown): void {
  emit('update:csm-enabled', Boolean(value))
}

function handleCsmShadowEnabledUpdate(value: unknown): void {
  emit('update:csm-shadow-enabled', Boolean(value))
}

function commitCsmLightColorInput() {
  emit('update:csm-light-color', String(csmLightColorInput.value ?? ''))
  nextTick(() => {
    csmLightColorInput.value = props.csmLightColor
  })
}

function handleCsmColorPickerInput(value: string | null) {
  if (typeof value !== 'string') {
    return
  }
  csmLightColorInput.value = value
  commitCsmLightColorInput()
}

function commitCsmLightIntensityInput() {
  emit('update:csm-light-intensity', Number(csmLightIntensityInput.value))
  nextTick(() => {
    csmLightIntensityInput.value = props.csmLightIntensity
  })
}

const resolvedCsmSunAzimuthDeg = computed(() => {
  const parsed = parseSunAngleInput(csmSunAzimuthDegInput.value)
  return parsed === null ? props.csmSunAzimuthDeg : normalizeSunAzimuthDeg(parsed)
})

const resolvedCsmSunElevationDeg = computed(() => {
  const parsed = parseSunAngleInput(csmSunElevationDegInput.value)
  return parsed === null ? props.csmSunElevationDeg : normalizeSunElevationDeg(parsed)
})

const displaySunAzimuthDeg = computed(() => formatSunAngleValue(resolvedCsmSunAzimuthDeg.value))
const displaySunElevationDeg = computed(() => formatSunAngleValue(resolvedCsmSunElevationDeg.value))

const currentSunStateLabel = computed(() => {
  const elevation = resolvedCsmSunElevationDeg.value
  const azimuth = resolvedCsmSunAzimuthDeg.value
  if (elevation <= 0) {
    if (azimuth >= 45 && azimuth <= 135) {
      return 'Horizon Dawn'
    }
    if (azimuth >= -135 && azimuth <= -45) {
      return 'Horizon Dusk'
    }
    return 'Low-angle Light'
  }
  if (elevation >= 62) {
    return 'High-angle Direct Sun'
  }
  if (azimuth >= 45 && azimuth <= 135) {
    return elevation >= 30 ? 'Morning Sun' : 'Morning Slant Light'
  }
  if (azimuth >= -135 && azimuth <= -45) {
    return elevation >= 30 ? 'Afternoon Sun' : 'Sunset Slant Light'
  }
  if (azimuth > 135 || azimuth < -135) {
    return 'Back-facing Cool Light'
  }
  return 'Strong Noon Light'
})

const activeSunReferenceKey = computed<SunReferenceKey | null>(() => {
  return resolveSunReferenceKey(resolvedCsmSunAzimuthDeg.value, SUN_REFERENCE_SNAP_THRESHOLD_DEG)
})

const sunDialIndicatorStyle = computed(() => {
  const azimuthRad = (resolvedCsmSunAzimuthDeg.value * Math.PI) / 180
  const orbitPercent = resolveSunDialOrbitPercent(resolvedCsmSunElevationDeg.value)
  const x = Math.sin(azimuthRad) * orbitPercent
  const y = -Math.cos(azimuthRad) * orbitPercent
  return {
    left: `calc(50% + ${x}%)`,
    top: `calc(50% + ${y}%)`,
  }
})

const sunDialRayStyle = computed(() => {
  const azimuthRad = (resolvedCsmSunAzimuthDeg.value * Math.PI) / 180
  const orbitPercent = resolveSunDialOrbitPercent(resolvedCsmSunElevationDeg.value)
  const x = Math.sin(azimuthRad) * orbitPercent
  const y = -Math.cos(azimuthRad) * orbitPercent
  const length = Math.sqrt((x * x) + (y * y))
  const angle = Math.atan2(y, x)
  return {
    width: `${length}%`,
    transform: `translateY(-50%) rotate(${angle}rad)`,
  }
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseSunAngleInput(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return isFinite(value) ? value : null
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
    return null
  }
  const parsed = Number(trimmed)
  return isFinite(parsed) ? parsed : null
}

function formatSunAngleValue(value: number): string {
  return String(Math.round(value))
}

function normalizeSunAzimuthDeg(value: number): number {
  return Math.round(clamp(value, SUN_AZIMUTH_MIN, SUN_AZIMUTH_MAX))
}

function normalizeSunElevationDeg(value: number): number {
  return Math.round(clamp(value, SUN_ELEVATION_MIN, SUN_ELEVATION_MAX))
}

function resolveSunDialOrbitPercent(elevationDeg: number): number {
  const normalized = (SUN_ELEVATION_MAX - normalizeSunElevationDeg(elevationDeg)) / (SUN_ELEVATION_MAX - SUN_ELEVATION_MIN)
  return clamp(normalized, 0, 1) * SUN_DIAL_MAX_ORBIT_PERCENT
}

function resolveAzimuthDeltaDeg(a: number, b: number): number {
  let delta = normalizeSunAzimuthDeg(a) - normalizeSunAzimuthDeg(b)
  while (delta > 180) {
    delta -= 360
  }
  while (delta < -180) {
    delta += 360
  }
  return delta
}

function resolveSunReferenceKey(azimuthDeg: number, thresholdDeg: number): SunReferenceKey | null {
  let closestKey: SunReferenceKey | null = null
  let closestDistance = thresholdDeg + 1
  for (const reference of SUN_REFERENCE_POINTS) {
    const distance = Math.abs(resolveAzimuthDeltaDeg(azimuthDeg, reference.azimuthDeg))
    if (distance <= thresholdDeg && distance < closestDistance) {
      closestDistance = distance
      closestKey = reference.key
    }
  }
  return closestKey
}

function resolveSnappedSunAzimuthDeg(azimuthDeg: number, distanceRatio: number): number {
  const normalized = normalizeSunAzimuthDeg(azimuthDeg)
  const threshold = distanceRatio >= 0.72 ? SUN_REFERENCE_SNAP_THRESHOLD_DEG : 7
  const referenceKey = resolveSunReferenceKey(normalized, threshold)
  if (!referenceKey) {
    return normalized
  }
  for (const reference of SUN_REFERENCE_POINTS) {
    if (reference.key === referenceKey) {
      return reference.azimuthDeg
    }
  }
  return normalized
}

function emitCsmSunAzimuthPreview(value: number): void {
  const normalized = normalizeSunAzimuthDeg(value)
  if (normalized !== props.csmSunAzimuthDeg) {
    emit('update:csm-sun-azimuth-deg', normalized)
  }
}

function emitCsmSunElevationPreview(value: number): void {
  const normalized = normalizeSunElevationDeg(value)
  if (normalized !== props.csmSunElevationDeg) {
    emit('update:csm-sun-elevation-deg', normalized)
  }
}

function handleCsmSunAzimuthFocus(): void {
  isEditingCsmSunAzimuth.value = true
}

function handleCsmSunElevationFocus(): void {
  isEditingCsmSunElevation.value = true
}

function handleCsmSunAzimuthInput(value: string | number | null): void {
  csmSunAzimuthDegInput.value = value == null ? '' : String(value)
  const parsed = parseSunAngleInput(csmSunAzimuthDegInput.value)
  if (parsed !== null) {
    emitCsmSunAzimuthPreview(parsed)
  }
}

function handleCsmSunElevationInput(value: string | number | null): void {
  csmSunElevationDegInput.value = value == null ? '' : String(value)
  const parsed = parseSunAngleInput(csmSunElevationDegInput.value)
  if (parsed !== null) {
    emitCsmSunElevationPreview(parsed)
  }
}

function commitCsmSunAzimuthDegInput() {
  isEditingCsmSunAzimuth.value = false
  const parsed = parseSunAngleInput(csmSunAzimuthDegInput.value)
  const normalized = parsed === null ? props.csmSunAzimuthDeg : normalizeSunAzimuthDeg(parsed)
  csmSunAzimuthDegInput.value = formatSunAngleValue(normalized)
  emitCsmSunAzimuthPreview(normalized)
}

function commitCsmSunElevationDegInput() {
  isEditingCsmSunElevation.value = false
  const parsed = parseSunAngleInput(csmSunElevationDegInput.value)
  const normalized = parsed === null ? props.csmSunElevationDeg : normalizeSunElevationDeg(parsed)
  csmSunElevationDegInput.value = formatSunAngleValue(normalized)
  emitCsmSunElevationPreview(normalized)
}

function updateSunDialFromPointer(clientX: number, clientY: number): void {
  const dial = sunDialRef.value
  if (!dial) {
    return
  }
  const rect = dial.getBoundingClientRect()
  const centerX = rect.left + (rect.width / 2)
  const centerY = rect.top + (rect.height / 2)
  const dx = clientX - centerX
  const dy = clientY - centerY
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2)
  const distance = Math.min(Math.sqrt((dx * dx) + (dy * dy)), radius)
  const distanceRatio = clamp(distance / radius, 0, 1)
  const azimuthDeg = resolveSnappedSunAzimuthDeg((Math.atan2(dx, -dy) * 180) / Math.PI, distanceRatio)
  const elevationDeg = normalizeSunElevationDeg(
    SUN_ELEVATION_MAX - (distanceRatio * (SUN_ELEVATION_MAX - SUN_ELEVATION_MIN)),
  )

  csmSunAzimuthDegInput.value = formatSunAngleValue(azimuthDeg)
  csmSunElevationDegInput.value = formatSunAngleValue(elevationDeg)
  emitCsmSunAzimuthPreview(azimuthDeg)
  emitCsmSunElevationPreview(elevationDeg)
}

function handleSunDialPointerDown(event: PointerEvent): void {
  if (event.button !== 0) {
    return
  }
  sunDialPointerId.value = event.pointerId
  isEditingCsmSunAzimuth.value = false
  isEditingCsmSunElevation.value = false
  sunDialRef.value?.setPointerCapture(event.pointerId)
  updateSunDialFromPointer(event.clientX, event.clientY)
}

function handleSunDialPointerMove(event: PointerEvent): void {
  if (sunDialPointerId.value !== event.pointerId) {
    return
  }
  updateSunDialFromPointer(event.clientX, event.clientY)
}

function handleSunDialPointerUp(event: PointerEvent): void {
  if (sunDialPointerId.value !== event.pointerId) {
    return
  }
  sunDialRef.value?.releasePointerCapture(event.pointerId)
  sunDialPointerId.value = null
  csmSunAzimuthDegInput.value = formatSunAngleValue(resolvedCsmSunAzimuthDeg.value)
  csmSunElevationDegInput.value = formatSunAngleValue(resolvedCsmSunElevationDeg.value)
}

function handleSunDialPointerCancel(event: PointerEvent): void {
  if (sunDialPointerId.value !== event.pointerId) {
    return
  }
  sunDialRef.value?.releasePointerCapture(event.pointerId)
  sunDialPointerId.value = null
}

function commitCsmCascadesInput() {
  emit('update:csm-cascades', Number(csmCascadesInput.value))
  nextTick(() => {
    csmCascadesInput.value = props.csmCascades
  })
}

function commitCsmMaxFarInput() {
  emit('update:csm-max-far', Number(csmMaxFarInput.value))
  nextTick(() => {
    csmMaxFarInput.value = props.csmMaxFar
  })
}

function commitCsmShadowMapSizeInput() {
  emit('update:csm-shadow-map-size', Number(csmShadowMapSizeInput.value))
  nextTick(() => {
    csmShadowMapSizeInput.value = Number(props.csmShadowMapSize)
  })
}

function commitCsmShadowBiasInput() {
  emit('update:csm-shadow-bias', Number(csmShadowBiasInput.value))
  nextTick(() => {
    csmShadowBiasInput.value = props.csmShadowBias
  })
}
</script>

<style scoped>
.popup-menu-card__content {
    margin: 5px;
}
.csm-sun-menu__content {
  padding: 8px 10px 10px;
}

.csm-sun-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.csm-sun-dial-card {
  grid-column: 1 / -1;
  padding: 10px 12px 12px;
  border-radius: 12px;
  background:
    radial-gradient(circle at top, rgba(255, 221, 143, 0.16), transparent 48%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.csm-sun-dial-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.csm-sun-dial-card__title {
  font-size: 13px;
  font-weight: 600;
}

.csm-sun-dial-card__caption {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.68);
}

.csm-sun-dial-card__values {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
}

.csm-sun-dial-card__state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 208, 110, 0.12);
  border: 1px solid rgba(255, 208, 110, 0.24);
  color: rgba(255, 232, 180, 0.92);
}

.csm-sun-dial {
  position: relative;
  width: min(100%, 190px);
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 50%;
  touch-action: none;
  background:
    radial-gradient(circle at center, rgba(255, 205, 107, 0.18), rgba(255, 205, 107, 0.04) 24%, rgba(8, 14, 24, 0.16) 25%, rgba(8, 14, 24, 0.02) 100%),
    linear-gradient(180deg, rgba(63, 106, 180, 0.26), rgba(11, 19, 33, 0.12));
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.csm-sun-dial__ring,
.csm-sun-dial__axis,
.csm-sun-dial__center,
.csm-sun-dial__ray,
.csm-sun-dial__indicator,
.csm-sun-dial__label,
.csm-sun-dial__hint {
  position: absolute;
}

.csm-sun-dial__ring {
  inset: 50%;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transform: translate(-50%, -50%);
}

.csm-sun-dial__ring--outer {
  width: calc(100% - 22px);
  height: calc(100% - 22px);
}

.csm-sun-dial__ring--middle {
  width: calc(64% - 6px);
  height: calc(64% - 6px);
}

.csm-sun-dial__ring--inner {
  width: calc(32% - 4px);
  height: calc(32% - 4px);
}

.csm-sun-dial__axis {
  left: 50%;
  top: 50%;
  background: rgba(255, 255, 255, 0.08);
  transform: translate(-50%, -50%);
}

.csm-sun-dial__axis--vertical {
  width: 1px;
  height: calc(100% - 28px);
}

.csm-sun-dial__axis--horizontal {
  width: calc(100% - 28px);
  height: 1px;
}

.csm-sun-dial__label {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  transform: translate(-50%, -50%);
}

.csm-sun-dial__label--north {
  left: 50%;
  top: 10px;
}

.csm-sun-dial__label--east {
  right: 10px;
  top: 50%;
  transform: translate(0, -50%);
}

.csm-sun-dial__label--south {
  left: 50%;
  bottom: 2px;
  transform: translate(-50%, 0);
}

.csm-sun-dial__label--west {
  left: 10px;
  top: 50%;
  transform: translate(0, -50%);
}

.csm-sun-dial__hint {
  font-size: 9px;
  line-height: 1;
  color: rgba(255, 219, 158, 0.68);
  letter-spacing: 0.02em;
  transition: color 120ms ease, text-shadow 120ms ease, opacity 120ms ease;
  transform: translate(-50%, -50%);
}

.csm-sun-dial__hint--active {
  color: rgba(255, 242, 199, 0.96);
  text-shadow: 0 0 12px rgba(255, 204, 102, 0.4);
}

.csm-sun-dial__hint--sunrise {
  left: calc(100% - 24px);
  top: 50%;
  transform: translate(0, -50%);
}

.csm-sun-dial__hint--noon {
  left: 50%;
  bottom: 18px;
  transform: translate(-50%, 0);
}

.csm-sun-dial__hint--sunset {
  left: 24px;
  top: 50%;
  transform: translate(-100%, -50%);
}

.csm-sun-dial__center {
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 244, 214, 0.9);
  box-shadow: 0 0 12px rgba(255, 211, 118, 0.35);
  transform: translate(-50%, -50%);
}

.csm-sun-dial__ray {
  left: 50%;
  top: 50%;
  height: 2px;
  transform-origin: left center;
  background: linear-gradient(90deg, rgba(255, 222, 131, 0.24), rgba(255, 208, 91, 0.85));
}

.csm-sun-dial__indicator {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff8d4, #ffd166 60%, #e59d20);
  box-shadow:
    0 0 0 3px rgba(255, 209, 102, 0.14),
    0 0 18px rgba(255, 196, 76, 0.45);
  transform: translate(-50%, -50%);
}

.csm-sun-dial-card__legend {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 10px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.58);
}

.csm-switch-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.csm-switch-row > * {
  flex: 1;
}

.material-color {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.color-input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 0;
  display: inline-block;
  background: transparent;
}

.color-swatch:focus-visible {
  outline: 2px solid rgba(107, 152, 255, 0.8);
  outline-offset: 2px;
}

.color-picker {
  padding: 12px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

@media (max-width: 520px) {
  .csm-sun-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .csm-sun-dial-card__header {
    flex-direction: column;
  }

  .csm-sun-dial-card__values {
    align-items: flex-start;
  }
}
</style>