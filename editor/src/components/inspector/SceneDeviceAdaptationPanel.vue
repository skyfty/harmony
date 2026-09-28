<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import { isBuiltinDeviceAdaptationProfileId, removeDeviceAdaptationProfile, type DeviceAdaptationProfile, type DeviceAdaptationSettings } from '@schema/deviceAdaptation'

const sceneStore = useSceneStore()
const { deviceAdaptation } = storeToRefs(sceneStore)
const qualityOptions = [
  { title: '低', value: 'low' },
  { title: '平衡', value: 'balanced' },
  { title: '高', value: 'high' },
]
const profiles = computed(() => deviceAdaptation.value.profiles)

function commit(profilesNext: DeviceAdaptationProfile[], manualProfileId = deviceAdaptation.value.manualProfileId) {
  const next: DeviceAdaptationSettings = { profiles: profilesNext, manualProfileId }
  sceneStore.setDeviceAdaptationSettings(next)
}

function addProfile() {
  const id = `device-profile-${Date.now().toString(36)}`
  commit([...profiles.value, {
    id,
    name: `设备规则 ${profiles.value.length + 1}`,
    enabled: true,
    priority: profiles.value.length,
    conditions: { maxMemoryMb: 3072 },
    quality: 'low',
    pixelRatioCap: 1,
    shadowsEnabled: false,
    lazyLoadMeshes: true,
  }])
}

function updateProfile(id: string, patch: Partial<DeviceAdaptationProfile>) {
  commit(profiles.value.map((profile) => profile.id === id ? { ...profile, ...patch } : profile))
}

function updateName(id: string, value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name) updateProfile(id, { name })
}

function updateCondition(id: string, key: 'maxMemoryMb' | 'maxCpuCores' | 'maxBenchmarkLevel' | 'maxTextureSize', value: unknown) {
  const numeric = value === '' || value === null ? undefined : Number(value)
  const profile = profiles.value.find((entry) => entry.id === id)
  if (!profile) return
  updateProfile(id, {
    conditions: {
      ...profile.conditions,
      [key]: Number.isFinite(numeric) && numeric! > 0 ? numeric : undefined,
    },
  })
}

function updateSystemVersion(id: string, key: 'minSystemVersion' | 'maxSystemVersion', value: unknown) {
  const profile = profiles.value.find((entry) => entry.id === id)
  if (!profile) return
  const version = typeof value === 'string' ? value.trim() : ''
  updateProfile(id, { conditions: { ...profile.conditions, [key]: version || undefined } })
}

function removeProfile(id: string) {
  if (isBuiltinDeviceAdaptationProfileId(id)) return
  const next = removeDeviceAdaptationProfile(profiles.value, id)
  const manual = deviceAdaptation.value.manualProfileId === id ? null : deviceAdaptation.value.manualProfileId
  commit(next, manual)
}

function updateManualProfile(value: unknown) {
  commit(profiles.value, typeof value === 'string' && value ? value : null)
}

function updatePlatforms(id: string, value: unknown) {
  const profile = profiles.value.find((entry) => entry.id === id)
  if (!profile) return
  const platforms = Array.isArray(value) ? value as NonNullable<DeviceAdaptationProfile['conditions']['platforms']> : []
  updateProfile(id, { conditions: { ...profile.conditions, platforms: platforms.length ? platforms : undefined } })
}

function updateEnabled(id: string, value: unknown) {
  updateProfile(id, { enabled: Boolean(value) })
}

const platformOptions = [
  { title: '微信小程序', value: 'wechat-miniprogram' },
  { title: 'H5', value: 'h5' },
  { title: 'Android', value: 'android' },
  { title: 'iOS', value: 'ios' },
  { title: '未知平台', value: 'unknown' },
]
</script>

<template>
  <div class="device-adaptation-panel">
    <div class="actions">
      <v-select
        :model-value="deviceAdaptation.manualProfileId ?? ''"
        :items="[{ title: '自动匹配', value: '' }, ...profiles.map((profile) => ({ title: `手动：${profile.name}`, value: profile.id }))]"
        label="运行档位覆盖"
        density="compact"
        hide-details
        @update:model-value="updateManualProfile"
      />
      <v-btn size="small" prepend-icon="mdi-plus" @click="addProfile">添加规则</v-btn>
    </div>
    <v-alert v-if="!profiles.length" density="compact" type="info" variant="tonal">
      暂无规则。自动模式保持默认质量；信息不可用时不会跳过节点。
    </v-alert>
    <v-card v-for="profile in profiles" :key="profile.id" class="profile-card" variant="outlined">
      <v-card-title class="card-title">
        <v-switch :model-value="profile.enabled" density="compact" hide-details @update:model-value="updateEnabled(profile.id, $event)" />
        <v-text-field
          :model-value="profile.name"
          label="规则名称"
          density="compact"
          hide-details
          @update:model-value="updateName(profile.id, $event)"
        />
        <v-btn icon="mdi-delete-outline" size="small" variant="text" :disabled="isBuiltinDeviceAdaptationProfileId(profile.id)" :title="isBuiltinDeviceAdaptationProfileId(profile.id) ? '内置规则不可删除' : `删除 ${profile.name}`" @click="removeProfile(profile.id)" />
      </v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12">
            <v-select
              :model-value="profile.conditions.platforms ?? []"
              :items="platformOptions"
              label="适用平台（不选表示不限）"
              multiple
              chips
              closable-chips
              density="compact"
              hide-details
              @update:model-value="updatePlatforms(profile.id, $event)"
            />
          </v-col>
          <v-col cols="6">
            <v-text-field :model-value="profile.priority" type="number" label="优先级（越大越先）" density="compact" hide-details @update:model-value="updateProfile(profile.id, { priority: Number($event) || 0 })" />
          </v-col>
          <v-col cols="6">
            <v-select :model-value="profile.quality" :items="qualityOptions" label="质量档位" density="compact" hide-details @update:model-value="updateProfile(profile.id, { quality: $event })" />
          </v-col>
          <v-col cols="6">
            <v-text-field :model-value="profile.conditions.maxMemoryMb ?? null" type="number" label="最大内存 MB" density="compact" hide-details @update:model-value="updateCondition(profile.id, 'maxMemoryMb', $event)" />
          </v-col>
          <v-col cols="6">
            <v-text-field :model-value="profile.conditions.maxCpuCores ?? null" type="number" label="最大 CPU 核数" density="compact" hide-details @update:model-value="updateCondition(profile.id, 'maxCpuCores', $event)" />
          </v-col>
          <v-col cols="6">
            <v-text-field :model-value="profile.conditions.maxBenchmarkLevel ?? null" type="number" label="最大性能等级" density="compact" hide-details @update:model-value="updateCondition(profile.id, 'maxBenchmarkLevel', $event)" />
          </v-col>
          <v-col cols="6">
            <v-text-field :model-value="profile.conditions.maxTextureSize ?? null" type="number" label="最大纹理尺寸" density="compact" hide-details @update:model-value="updateCondition(profile.id, 'maxTextureSize', $event)" />
          </v-col>
          <v-col cols="6">
            <v-text-field :model-value="profile.conditions.minSystemVersion ?? ''" label="最低系统版本" placeholder="例如 16.0" density="compact" hide-details @update:model-value="updateSystemVersion(profile.id, 'minSystemVersion', $event)" />
          </v-col>
          <v-col cols="6">
            <v-text-field :model-value="profile.conditions.maxSystemVersion ?? ''" label="最高系统版本" placeholder="例如 18.0" density="compact" hide-details @update:model-value="updateSystemVersion(profile.id, 'maxSystemVersion', $event)" />
          </v-col>
          <v-col cols="12">
            <v-slider :model-value="profile.pixelRatioCap" :min="0.5" :max="2" :step="0.1" label="像素比上限" thumb-label density="compact" @update:model-value="updateProfile(profile.id, { pixelRatioCap: Number($event) })" />
          </v-col>
          <v-col cols="12" class="toggles">
            <v-switch :model-value="profile.shadowsEnabled" label="启用阴影" density="compact" hide-details @update:model-value="updateProfile(profile.id, { shadowsEnabled: Boolean($event) })" />
            <v-switch :model-value="profile.lazyLoadMeshes" label="视锥懒加载模型" density="compact" hide-details @update:model-value="updateProfile(profile.id, { lazyLoadMeshes: Boolean($event) })" />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.device-adaptation-panel { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.profile-card { margin-top: 10px; }
.card-title { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; }
.card-title .v-text-field { flex: 1; }
.toggles { display: flex; flex-wrap: wrap; gap: 8px 16px; }
</style>
