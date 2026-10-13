<script setup lang="ts">
/**
 * 环境面板（收敛后）：环境只由 Slow Roads 预设驱动。
 * - Slow Roads 环境：季节 / 时间 / 天气 + 云层 / 星空 / 降雪开关 + 曝光缩放
 * - 其余：阴影总开关、视口性能模式、北向、物理参数（与应用环境无关）
 * 已移除 Background（纯色/渐变/HDRI/SkyCube）与阳光(CSM)设置，避免参数冲突。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  EnvironmentNorthDirection,
  EnvironmentPhysicsEngine,
  EnvironmentSettings,
} from '@/types/environment'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { environmentSettings: storeEnvironmentSettings, shadowsEnabled } = storeToRefs(sceneStore)

const environmentSettings = computed(() => storeEnvironmentSettings.value)

const northDirectionOptions: Array<{ title: string; value: EnvironmentNorthDirection }> = [
  { title: '+X', value: '+X' },
  { title: '-X', value: '-X' },
  { title: '+Z', value: '+Z' },
  { title: '-Z', value: '-Z' },
]

const physicsEngineOptions: Array<{ title: string; value: EnvironmentPhysicsEngine }> = [
  { title: 'Ammo', value: 'ammo' },
  { title: 'Cannon', value: 'cannon' },
]

const isPhysicsEnabled = computed(() => environmentSettings.value.physicsEnabled !== false)
const physicsEngine = computed<EnvironmentPhysicsEngine>(() => environmentSettings.value.physicsEngine ?? 'cannon')

// ---- Slow Roads 环境（季节 × 时间 × 天气）----
const SLOWROADS_SEASONS = [
  { title: '春', value: 'spring' as const },
  { title: '夏', value: 'summer' as const },
  { title: '秋', value: 'autumn' as const },
  { title: '冬', value: 'winter' as const },
]
const SLOWROADS_TIMES = [
  { title: '早晨', value: 'morning' as const },
  { title: '白天', value: 'day' as const },
  { title: '傍晚', value: 'evening' as const },
  { title: '夜晚', value: 'night' as const },
]
const SLOWROADS_WEATHERS = [
  { title: '晴', value: 'clear' as const },
  { title: '阴', value: 'overcast' as const },
]

function patchSlowroadsSettings(patch: Partial<EnvironmentSettings['slowroads']>) {
  sceneStore.patchEnvironmentSettings({
    slowroads: { ...environmentSettings.value.slowroads, ...patch },
  })
}

function handleExposureScaleInput(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0.2, Math.min(3, numeric))
  if (Math.abs(clamped - environmentSettings.value.slowroads.exposureScale) < 1e-6) {
    return
  }
  patchSlowroadsSettings({ exposureScale: clamped })
}

function handleShadowsToggle(enabled: boolean | null) {
  if (typeof enabled !== 'boolean' || enabled === shadowsEnabled.value) {
    return
  }
  sceneStore.setShadowsEnabled(enabled)
}

function handleViewportPerformanceModeToggle(enabled: boolean | null) {
  if (typeof enabled !== 'boolean' || enabled === Boolean(environmentSettings.value.viewportPerformanceMode)) {
    return
  }
  sceneStore.patchEnvironmentSettings({ viewportPerformanceMode: enabled })
}

function updateNorthDirection(direction: EnvironmentNorthDirection | null) {
  if (!direction || direction === environmentSettings.value.northDirection) {
    return
  }
  sceneStore.patchEnvironmentSettings({ northDirection: direction })
}

function handlePhysicsEnabledToggle(enabled: boolean | null) {
  if (typeof enabled !== 'boolean' || enabled === (environmentSettings.value.physicsEnabled !== false)) {
    return
  }
  sceneStore.patchEnvironmentSettings({ physicsEnabled: enabled })
}

function handlePhysicsEngineChange(nextEngine: EnvironmentPhysicsEngine | { value?: unknown } | null) {
  const normalizedEngine = typeof nextEngine === 'string'
    ? nextEngine
    : nextEngine && typeof nextEngine === 'object' && 'value' in nextEngine
      ? (nextEngine as { value?: unknown }).value
      : null

  if (normalizedEngine !== 'ammo' && normalizedEngine !== 'cannon') {
    return
  }
  if (normalizedEngine === (environmentSettings.value.physicsEngine ?? 'cannon')) {
    return
  }
  sceneStore.patchEnvironmentSettings({ physicsEngine: normalizedEngine })
}

function handleGravityStrengthInput(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(100, numeric))
  if (Math.abs(clamped - environmentSettings.value.gravityStrength) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ gravityStrength: clamped })
}

function formatGravityStrength(): string {
  return environmentSettings.value.gravityStrength.toFixed(2)
}

function handleRestitutionInput(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(1, numeric))
  if (Math.abs(clamped - environmentSettings.value.collisionRestitution) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ collisionRestitution: clamped })
}

function formatRestitution(): string {
  return environmentSettings.value.collisionRestitution.toFixed(2)
}

function handleFrictionInput(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clamped = Math.max(0, Math.min(1, numeric))
  if (Math.abs(clamped - environmentSettings.value.collisionFriction) < 1e-3) {
    return
  }
  sceneStore.patchEnvironmentSettings({ collisionFriction: clamped })
}

function formatFriction(): string {
  return environmentSettings.value.collisionFriction.toFixed(2)
}
</script>

<template>
  <v-expansion-panel value="environment">
    <v-expansion-panel-title>
      Environment
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="environment-panel">
        <section class="environment-section">
          <div class="section-title">Slow Roads 环境</div>
          <div class="section-hint">季节/时间/天气驱动光照、三色雾、天空、云层、星空与降雪；素材固定来自在线资产包，太阳方向固定，无独立背景/雾参数。</div>
          <div class="toggle-label">季节</div>
          <div class="pl-choice-row">
            <button
              v-for="item in SLOWROADS_SEASONS"
              :key="item.value"
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': environmentSettings.slowroads.season === item.value }"
              @click="patchSlowroadsSettings({ season: item.value })"
            >{{ item.title }}</button>
          </div>
          <div class="toggle-label">时间</div>
          <div class="pl-choice-row">
            <button
              v-for="item in SLOWROADS_TIMES"
              :key="item.value"
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': environmentSettings.slowroads.timeOfDay === item.value }"
              @click="patchSlowroadsSettings({ timeOfDay: item.value })"
            >{{ item.title }}</button>
          </div>
          <div class="toggle-label">天气</div>
          <div class="pl-choice-row">
            <button
              v-for="item in SLOWROADS_WEATHERS"
              :key="item.value"
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': environmentSettings.slowroads.weather === item.value }"
              @click="patchSlowroadsSettings({ weather: item.value })"
            >{{ item.title }}</button>
          </div>
          <div class="toggle-row">
            <span class="toggle-label">云层</span>
            <v-switch
              :model-value="environmentSettings.slowroads.showClouds"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="(v) => patchSlowroadsSettings({ showClouds: Boolean(v) })"
            />
          </div>
          <div class="toggle-row">
            <span class="toggle-label">星空</span>
            <v-switch
              :model-value="environmentSettings.slowroads.showStars"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="(v) => patchSlowroadsSettings({ showStars: Boolean(v) })"
            />
          </div>
          <div class="toggle-row">
            <span class="toggle-label">降雪</span>
            <v-switch
              :model-value="environmentSettings.slowroads.showSnow"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="(v) => patchSlowroadsSettings({ showSnow: Boolean(v) })"
            />
          </div>
          <div class="slider-row">
            <v-slider
              class="slider-control"
              :min="0.2"
              :max="3"
              :step="0.05"
              :model-value="environmentSettings.slowroads.exposureScale"
              @update:model-value="handleExposureScaleInput"
            />
            <v-text-field
              class="slider-input"
              label="曝光缩放"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0.2"
              :max="3"
              :step="0.05"
              :model-value="String(environmentSettings.slowroads.exposureScale)"
              @update:model-value="handleExposureScaleInput"
            />
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Shadows</div>
          <div class="toggle-row">
            <span class="toggle-label">Enable Shadows</span>
            <v-switch
              :model-value="shadowsEnabled"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="handleShadowsToggle"
            />
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Viewport</div>
          <div class="toggle-row">
            <span class="toggle-label">Performance Mode</span>
            <v-switch
              :model-value="Boolean(environmentSettings.viewportPerformanceMode)"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="handleViewportPerformanceModeToggle"
            />
          </div>
        </section>

        <section class="environment-section">
          <div class="section-title">Navigation</div>
          <v-select
            :items="northDirectionOptions"
            :model-value="environmentSettings.northDirection ?? '+X'"
            density="compact"
            hide-details
            variant="underlined"
            class="section-select"
            label="North Direction"
            @update:model-value="(value) => updateNorthDirection(value as EnvironmentNorthDirection | null)"
          />
        </section>

        <section class="environment-section">
          <div class="section-title">Physics</div>
          <div class="toggle-row">
            <span class="toggle-label">Enable Physics</span>
            <v-switch
              :model-value="isPhysicsEnabled"
              density="compact"
              hide-details
              color="primary"
              size="small"
              @update:model-value="handlePhysicsEnabledToggle"
            />
          </div>
          <div class="slider-row">
            <v-select
              class="slider-input"
              label="Physics Engine"
              density="compact"
              variant="underlined"
              hide-details
              :items="physicsEngineOptions"
              item-title="title"
              item-value="value"
              :return-object="false"
              :model-value="physicsEngine"
              @update:model-value="handlePhysicsEngineChange"
            />
          </div>
          <div class="slider-row">
            <v-text-field
              class="slider-input"
              label="Gravity Strength (m/s^2)"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="100"
              :step="0.1"
              :model-value="formatGravityStrength()"
              @update:model-value="handleGravityStrengthInput"
            />
          </div>
          <div class="slider-row">
            <v-text-field
              class="slider-input"
              label="Collision Restitution"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="1"
              :step="0.05"
              :model-value="formatRestitution()"
              @update:model-value="handleRestitutionInput"
            />
          </div>
          <div class="slider-row">
            <v-text-field
              class="slider-input"
              label="Collision Friction"
              density="compact"
              variant="underlined"
              hide-details
              type="number"
              inputmode="decimal"
              :min="0"
              :max="1"
              :step="0.05"
              :model-value="formatFriction()"
              @update:model-value="handleFrictionInput"
            />
          </div>
        </section>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.environment-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.environment-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(15, 20, 28, 0.55);
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(159, 181, 199, 0.9);
}

.section-hint {
  font-size: 0.72rem;
  line-height: 1.35;
  color: rgba(159, 181, 199, 0.72);
}

.pl-choice-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 2px 0 6px;
}

.pl-choice {
  border: 1px solid rgba(126, 148, 168, 0.45);
  background: transparent;
  color: rgba(214, 226, 236, 0.9);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
}

.pl-choice--active {
  border-color: rgba(88, 160, 232, 0.9);
  background: rgba(88, 160, 232, 0.18);
  color: #ffffff;
}

.section-select :deep(.v-field__input) {
  font-size: 0.82rem;
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-input {
  width: 100%;
}

.slider-input :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

.slider-input :deep(input) {
  font-variant-numeric: tabular-nums;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.toggle-label {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.82);
}
</style>
