<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import type { ProjectAsset } from '@/types/project-asset'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import type { SceneNodeComponentState } from '@schema/core'
import { DEVICE_ADAPTATION_COMPONENT_TYPE, normalizeDeviceAdaptationNodeProps, type DeviceAdaptationComponentProps, type DeviceAdaptationNodeRule } from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, deviceAdaptation, draggingAssetId } = storeToRefs(sceneStore)
const component = computed(() => selectedNode.value?.components?.[DEVICE_ADAPTATION_COMPONENT_TYPE] as SceneNodeComponentState<DeviceAdaptationComponentProps> | undefined)
const rules = computed(() => normalizeDeviceAdaptationNodeProps(component.value?.props).rules)
const profileOptions = computed(() => deviceAdaptation.value.profiles.map((profile) => ({ title: profile.name, value: profile.id })))
const componentEnabled = computed(() => component.value?.enabled !== false)
const assetDialogVisible = ref(false)
const assetDialogProfileId = ref<string | null>(null)
const assetDialogNodeId = ref<string | null>(null)
const assetDialogSelectedId = ref('')
const assetDialogAnchor = ref<{ x: number; y: number } | null>(null)
const dragActiveProfileId = ref<string | null>(null)
const actionOptions = [
  { title: '跳过该节点视觉加载（保留子节点）', value: 'skip-visual' },
  { title: '跳过该节点及其所有子节点', value: 'skip-subtree' },
  { title: '替换为低模模型', value: 'replace-model' },
  { title: '禁用该节点贴图', value: 'disable-textures' },
  { title: '简化节点渲染', value: 'simplify-rendering' },
]
type DeviceAdaptationAction = DeviceAdaptationNodeRule['action']

function isModelAsset(asset: ProjectAsset | null | undefined): asset is ProjectAsset {
  return !!asset && (asset.type === 'model' || asset.type === 'mesh')
}

function getRule(profileId: string): DeviceAdaptationNodeRule | undefined {
  return rules.value.find((rule) => rule.profileId === profileId)
}

function getAssetLabel(assetId: string | null | undefined): string {
  const id = assetId?.trim() ?? ''
  if (!id) return '选择模型或网格资产'
  const asset = sceneStore.getAsset(id)
  return asset?.name?.trim() || id
}

function getModelAsset(assetId: string | null | undefined): ProjectAsset | null {
  const id = assetId?.trim() ?? ''
  return id ? sceneStore.getAsset(id) ?? null : null
}

function getModelAssetThumbnailStyle(assetId: string | null | undefined): Record<string, string> | undefined {
  const asset = getModelAsset(assetId)
  if (!asset) return undefined
  if (asset.thumbnail?.trim()) return { backgroundImage: `url(${asset.thumbnail})` }
  if (asset.previewColor?.trim()) return { backgroundColor: asset.previewColor }
  return undefined
}

function resetAssetDialogTarget(): void {
  assetDialogProfileId.value = null
  assetDialogNodeId.value = null
  assetDialogSelectedId.value = ''
  assetDialogAnchor.value = null
}

watch(assetDialogVisible, (visible) => {
  if (!visible) resetAssetDialogTarget()
})

watch(
  () => [
    selectedNodeId.value,
    component.value?.id,
    componentEnabled.value,
    assetDialogProfileId.value,
    assetDialogProfileId.value ? getRule(assetDialogProfileId.value)?.action : undefined,
    assetDialogProfileId.value && profileOptions.value.some((profile) => profile.value === assetDialogProfileId.value),
  ] as const,
  ([nodeId, componentId, enabled, targetProfileId, targetAction, targetProfileExists]) => {
    if (!assetDialogVisible.value) return
    if (
      !enabled
      || nodeId !== assetDialogNodeId.value
      || !componentId
      || !targetProfileId
      || targetAction !== 'replace-model'
      || !targetProfileExists
    ) {
      assetDialogVisible.value = false
    }
  },
)

function commit(nextRules: DeviceAdaptationNodeRule[]) {
  const nodeId = selectedNodeId.value
  const state = component.value
  if (!nodeId || !state) return
  sceneStore.updateNodeComponentProps(nodeId, state.id, { rules: nextRules })
}
function updateRule(profileId: string, patch: Partial<DeviceAdaptationNodeRule>) {
  const current = rules.value.find((rule) => rule.profileId === profileId)
  const next = current
    ? rules.value.map((rule) => rule.profileId === profileId ? { ...rule, ...patch } : rule)
    : [...rules.value, { profileId, action: 'simplify-rendering' as const, modelAssetId: null, ...patch }]
  commit(next)
}
function removeRule(profileId: string) {
  commit(rules.value.filter((rule) => rule.profileId !== profileId))
}

function openAssetDialog(profileId: string, event: MouseEvent): void {
  if (!componentEnabled.value || !selectedNodeId.value || getRule(profileId)?.action !== 'replace-model') return
  assetDialogProfileId.value = profileId
  assetDialogNodeId.value = selectedNodeId.value
  assetDialogSelectedId.value = getRule(profileId)?.modelAssetId ?? ''
  assetDialogAnchor.value = { x: event.clientX, y: event.clientY }
  assetDialogVisible.value = true
}

function resolveDraggedAsset(event: DragEvent): ProjectAsset | null {
  const transfer = event.dataTransfer
  if (!transfer || !Array.from(transfer.types ?? []).includes(ASSET_DRAG_MIME)) return null

  const raw = transfer.getData(ASSET_DRAG_MIME)
  if (raw) {
    try {
      const payload = JSON.parse(raw) as { assetId?: unknown }
      if (typeof payload.assetId === 'string' && payload.assetId.trim()) {
        return sceneStore.getAsset(payload.assetId.trim()) ?? null
      }
    } catch (error) {
      console.warn('Unable to parse device-adaptation asset drag payload', error)
    }
  }
  const fallbackId = draggingAssetId.value?.trim()
  return fallbackId ? sceneStore.getAsset(fallbackId) ?? null : null
}

function handleAssetDragOver(event: DragEvent, profileId: string): void {
  if (!componentEnabled.value || getRule(profileId)?.action !== 'replace-model') {
    dragActiveProfileId.value = null
    return
  }
  const asset = resolveDraggedAsset(event)
  if (!isModelAsset(asset)) {
    dragActiveProfileId.value = null
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dragActiveProfileId.value = profileId
}

function handleAssetDragLeave(event: DragEvent, profileId: string): void {
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) return
  if (dragActiveProfileId.value === profileId) dragActiveProfileId.value = null
}

function registerModelAsset(asset: ProjectAsset): ProjectAsset | null {
  try {
    return sceneStore.ensureSceneAssetRegistered(asset, {
      source: asset.source ?? { type: 'url' },
      commitOptions: { updateNodes: false },
    })
  } catch (error) {
    console.warn('Failed to register device-adaptation model asset', asset.id, error)
    return null
  }
}

function assignModelAsset(profileId: string, asset: ProjectAsset | null): void {
  if (!componentEnabled.value || getRule(profileId)?.action !== 'replace-model') return
  if (!asset) {
    updateRule(profileId, { modelAssetId: null })
    return
  }
  if (!isModelAsset(asset)) return
  const registeredAsset = registerModelAsset(asset)
  if (registeredAsset?.id) updateRule(profileId, { modelAssetId: registeredAsset.id })
}

function handleAssetDrop(event: DragEvent, profileId: string): void {
  dragActiveProfileId.value = null
  if (!componentEnabled.value || getRule(profileId)?.action !== 'replace-model') return
  const asset = resolveDraggedAsset(event)
  if (!isModelAsset(asset)) return
  event.preventDefault()
  event.stopPropagation()
  assignModelAsset(profileId, asset)
}

function handleAssetDialogUpdate(asset: ProjectAsset | null): void {
  const profileId = assetDialogProfileId.value
  if (profileId && assetDialogNodeId.value === selectedNodeId.value) {
    assignModelAsset(profileId, asset)
  }
  assetDialogVisible.value = false
}

function handleAssetDialogCancel(): void {
  assetDialogVisible.value = false
}
function toggleComponent() {
  const nodeId = selectedNodeId.value
  if (nodeId && component.value) sceneStore.toggleNodeComponentEnabled(nodeId, component.value.id)
}
function removeComponent() {
  const nodeId = selectedNodeId.value
  if (nodeId && component.value) sceneStore.removeNodeComponent(nodeId, component.value.id)
}
</script>

<template>
  <v-expansion-panel value="deviceAdaptation">
    <v-expansion-panel-title>
      <div class="component-header">
        <span>设备适配</span>
        <v-spacer />
        <v-menu v-if="component" location="bottom end" origin="auto" transition="fade-transition">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" size="small" class="component-menu-btn" @click.stop>
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="toggleComponent">
              <v-list-item-title>{{ component.enabled === false ? 'Enable' : 'Disable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="removeComponent">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <v-alert v-if="!deviceAdaptation.profiles.length" density="compact" type="warning" variant="tonal">
        请先在未选择节点时配置场景级设备规则。
      </v-alert>
      <v-alert v-else-if="!profileOptions.length" density="compact" type="info" variant="tonal">添加设备规则后即可配置节点行为。</v-alert>
      <div v-for="profile in profileOptions" :key="profile.value" class="rule-row">
        <div class="profile-name">{{ profile.title }}</div>
        <v-select
          :model-value="rules.find((rule) => rule.profileId === profile.value)?.action ?? ''"
          :items="[{ title: '不覆盖', value: '' }, ...actionOptions]"
          label="低配时行为"
          density="compact"
          hide-details
          :disabled="component?.enabled === false"
          @update:model-value="(value) => value ? updateRule(profile.value, { action: value as DeviceAdaptationAction }) : removeRule(profile.value)"
        />
        <div
          v-if="getRule(profile.value)?.action === 'replace-model'"
          class="model-asset-selector"
          :class="{ 'model-asset-selector--drag-active': dragActiveProfileId === profile.value }"
          :aria-disabled="!componentEnabled"
          @click="openAssetDialog(profile.value, $event)"
          @dragenter="handleAssetDragOver($event, profile.value)"
          @dragover="handleAssetDragOver($event, profile.value)"
          @dragleave="handleAssetDragLeave($event, profile.value)"
          @drop="handleAssetDrop($event, profile.value)"
        >
          <div
            class="model-asset-selector__thumbnail"
            :class="{ 'model-asset-selector__thumbnail--placeholder': !getModelAsset(getRule(profile.value)?.modelAssetId) }"
            :style="getModelAssetThumbnailStyle(getRule(profile.value)?.modelAssetId)"
            :title="getAssetLabel(getRule(profile.value)?.modelAssetId)"
          >
            <v-icon v-if="!getModelAsset(getRule(profile.value)?.modelAssetId)" size="20">mdi-cube-outline</v-icon>
          </div>
          <span class="model-asset-selector__label" :title="getRule(profile.value)?.modelAssetId ?? ''">
            {{ getAssetLabel(getRule(profile.value)?.modelAssetId) }}
          </span>
          <v-btn
            v-if="getRule(profile.value)?.modelAssetId"
            icon
            size="x-small"
            variant="text"
            density="compact"
            :disabled="!componentEnabled"
            aria-label="清除低模资产"
            @click.stop="updateRule(profile.value, { modelAssetId: null })"
          >
            <v-icon size="16">mdi-close</v-icon>
          </v-btn>
          <v-icon size="16">mdi-chevron-down</v-icon>
        </div>
      </div>
      <AssetPickerDialog
        v-model="assetDialogVisible"
        :asset-id="assetDialogSelectedId"
        asset-type="model,mesh"
        title="选择低模模型资产"
        :anchor="assetDialogAnchor"
        :disabled="!componentEnabled"
        @update:asset="handleAssetDialogUpdate"
        @cancel="handleAssetDialogCancel"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.rule-row { display: grid; gap: 8px; margin: 10px 0 16px; }
.profile-name { font-size: 0.8rem; font-weight: 600; opacity: 0.8; }
.component-header { display: flex; align-items: center; gap: 0.4rem; width: 100%; }
.component-menu-btn { color: rgba(233, 236, 241, 0.82); }
.component-menu-divider { margin-inline: 0.6rem; }
.model-asset-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  cursor: pointer;
  color: rgba(233, 236, 241, 0.9);
  transition: border-color 120ms ease, background-color 120ms ease;
}
.model-asset-selector:hover:not([aria-disabled='true']),
.model-asset-selector--drag-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.model-asset-selector[aria-disabled='true'] { opacity: 0.5; cursor: default; }
.model-asset-selector__label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-asset-selector__thumbnail {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  border-radius: 6px;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
.model-asset-selector__thumbnail--placeholder {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
}
</style>
