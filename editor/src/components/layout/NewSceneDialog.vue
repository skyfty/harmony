<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { fetchPresetSceneDetail, fetchPresetSceneSummaries } from '@/api/presetScenes'
import type { PresetSceneDetail, PresetSceneDocument, PresetSceneSummary } from '@/types/preset-scene'
import { generateUuid } from '@/utils/uuid'

const props = defineProps<{
  modelValue: boolean
  initialName?: string
  initialGroundWidth?: number
  initialGroundDepth?: number
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: {
    name: string
    groundWidth: number
    groundDepth: number
    presetSceneId?: string | null
    presetSceneDocument?: PresetSceneDocument | null
  }): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const sceneName = ref('New Scene')
const groundWidth = ref<number>(100)
const groundDepth = ref<number>(100)

type PresetSourceType = 'local' | 'remote'

interface PresetListEntry {
  id: string
  name: string
  thumbnailUrl: string | null
  description?: string | null
  source: PresetSourceType
}

const localPresetsLoaded = ref(false)
const localPresetEntries = ref<PresetListEntry[]>([])
const remotePresetSummaries = ref<PresetSceneSummary[]>([])
const presetEntries = ref<PresetListEntry[]>([])
const remotePresetsLoaded = ref(false)
const presetScenesLoading = ref(false)
const selectedPresetId = ref<string | null>(null)
const loadingPresetDetailId = ref<string | null>(null)
const presetSceneDetails = ref<Record<string, PresetSceneDetail>>({})
const confirmError = ref<string | null>(null)
const isConfirming = ref(false)

const hasPresetScenes = computed(() => presetEntries.value.length > 0)

const selectedPresetDetail = computed(() =>
  selectedPresetId.value ? presetSceneDetails.value[selectedPresetId.value] ?? null : null,
)

const isCreateDisabled = computed(() => {
  if (!selectedPresetId.value) {
    return true
  }
  if (loadingPresetDetailId.value !== null) {
    return true
  }
  if (isConfirming.value) {
    return true
  }
  return !presetSceneDetails.value[selectedPresetId.value]
})

function normalizeDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(20000, Math.max(1, numeric))
}

function createSuggestedSceneName(baseName: string): string {
  const normalized = baseName?.trim() ?? ''
  const fallback = normalized.length ? normalized : '新场景'
  return `${fallback} ${generateUuid().slice(0, 8)}`
}

function extractFileSlug(path: string): string {
  const fileName = path.split('/').pop() ?? 'preset'
  return fileName.replace(/\.json$/i, '')
}

function sanitizeLocalPresetDetail(path: string, moduleValue: unknown): PresetSceneDetail | null {
  const raw = (moduleValue as { default?: unknown })?.default ?? moduleValue
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const data = raw as Record<string, unknown>
  const slug = extractFileSlug(path)
  const idCandidates = [data.id, data.name, slug]
  const resolvedId = idCandidates.find((item) => typeof item === 'string' && item.trim().length) as string | undefined
  const resolvedName = typeof data.name === 'string' && data.name.trim().length ? data.name.trim() : slug
  const thumbnail = typeof data.thumbnail === 'string' ? data.thumbnail : null
  const description = typeof data.description === 'string' ? data.description : null
  const documentData = structuredClone(data) as Record<string, unknown>
  delete documentData.id
  delete documentData.description
  documentData.name = resolvedName
  documentData.thumbnail = thumbnail
  return {
    id: resolvedId ?? `${slug}-${generateUuid().slice(0, 6)}`,
    name: resolvedName,
    thumbnailUrl: thumbnail,
    description,
    document: documentData as PresetSceneDocument,
  }
}

function updatePresetEntriesList() {
  const remoteEntries = remotePresetSummaries.value.map<PresetListEntry>((item) => ({
    id: item.id,
    name: item.name,
    thumbnailUrl: item.thumbnailUrl ?? null,
    description: item.description ?? null,
    source: 'remote',
  }))
  presetEntries.value = [...localPresetEntries.value, ...remoteEntries]
}

async function loadLocalPresetsOnce(): Promise<void> {
  if (localPresetsLoaded.value) {
    return
  }
  const modules = import.meta.glob<{ default: unknown }>('@/resources/scenes/*.json', { eager: true })
  const entries: PresetListEntry[] = []
  const details: Record<string, PresetSceneDetail> = {}
  Object.entries(modules).forEach(([path, mod]) => {
    const detail = sanitizeLocalPresetDetail(path, mod)
    if (!detail) {
      return
    }
    entries.push({
      id: detail.id,
      name: detail.name,
      thumbnailUrl: detail.thumbnailUrl ?? null,
      description: detail.description ?? null,
      source: 'local',
    })
    details[detail.id] = detail
  })
  localPresetEntries.value = entries
  presetSceneDetails.value = { ...presetSceneDetails.value, ...details }
  localPresetsLoaded.value = true
  updatePresetEntriesList()
  void ensureDefaultPresetSelection()
}

async function loadRemotePresetSummaries(options: { force?: boolean } = {}) {
  if (presetScenesLoading.value) {
    return
  }
  if (remotePresetsLoaded.value && !options.force) {
    return
  }
  presetScenesLoading.value = true
  try {
    const data = await fetchPresetSceneSummaries()
    remotePresetSummaries.value = data
    remotePresetsLoaded.value = true
    updatePresetEntriesList()
    void ensureDefaultPresetSelection()
  } catch (error) {
    console.warn('[NewSceneDialog] Failed to load remote preset scenes', error)
  } finally {
    presetScenesLoading.value = false
  }
}

function resetPresetState() {
  selectedPresetId.value = null
  loadingPresetDetailId.value = null
  confirmError.value = null
}

async function ensurePresetDetail(id: string): Promise<PresetSceneDetail | null> {
  const cached = presetSceneDetails.value[id]
  if (cached) {
    return cached
  }
  loadingPresetDetailId.value = id
  try {
    const detail = await fetchPresetSceneDetail(id)
    presetSceneDetails.value = { ...presetSceneDetails.value, [id]: detail }
    return detail
  } catch (error) {
    const message = error instanceof Error ? error.message : '预置场景详情加载失败'
    confirmError.value = message
    return null
  } finally {
    if (loadingPresetDetailId.value === id) {
      loadingPresetDetailId.value = null
    }
  }
}

async function selectPreset(id: string, options: { userInitiated?: boolean } = {}) {
  confirmError.value = null
  const isSameSelection = selectedPresetId.value === id
  if (!isSameSelection) {
    selectedPresetId.value = id
  }
  const detail = await ensurePresetDetail(id)
  if (!detail) {
    if (options.userInitiated) {
      confirmError.value = '无法加载预置场景详情，请稍后重试'
    }
    return
  }
  if (!isSameSelection) {
    sceneName.value = createSuggestedSceneName(detail.name)
    const recommendedWidth = detail.document.groundSettings?.width
    if (typeof recommendedWidth === 'number') {
      groundWidth.value = normalizeDimension(recommendedWidth, groundWidth.value)
    }
    const recommendedDepth = detail.document.groundSettings?.depth
    if (typeof recommendedDepth === 'number') {
      groundDepth.value = normalizeDimension(recommendedDepth, groundDepth.value)
    }
  }
}

async function ensureDefaultPresetSelection() {
  if (!selectedPresetId.value && presetEntries.value.length > 0) {
    const firstId = presetEntries.value[0]!.id
    await selectPreset(firstId, { userInitiated: false })
  } else if (selectedPresetId.value && !presetEntries.value.some((entry) => entry.id === selectedPresetId.value)) {
    selectedPresetId.value = null
    await ensureDefaultPresetSelection()
  }
}

function reloadPresetScenes() {
  void loadRemotePresetSummaries({ force: true }).then(() => ensureDefaultPresetSelection())
}

async function handlePresetSelection(id: string) {
  await selectPreset(id, { userInitiated: true })
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      sceneName.value = props.initialName?.trim().length
        ? props.initialName.trim()
        : 'New Scene'
      groundWidth.value = normalizeDimension(props.initialGroundWidth, 100)
      groundDepth.value = normalizeDimension(props.initialGroundDepth, 100)
      confirmError.value = null
      selectedPresetId.value = null
      await loadLocalPresetsOnce()
      await ensureDefaultPresetSelection()
      void loadRemotePresetSummaries()
      await nextTick()
      const input = document.getElementById('new-scene-name') as HTMLInputElement | null
      input?.focus()
      input?.select()
    } else {
      sceneName.value = 'New Scene'
      groundWidth.value = 100
      groundDepth.value = 100
      resetPresetState()
      isConfirming.value = false
    }
  },
  { immediate: true },
)

async function confirm() {
  if (isConfirming.value) {
    return
  }
  confirmError.value = null
  isConfirming.value = true

  try {
    let presetDocument: PresetSceneDocument | null = null
    const presetId = selectedPresetId.value ?? null
    if (!presetId) {
      throw new Error('请先选择一个预置场景')
    }
    const detail = await ensurePresetDetail(presetId)
    if (!detail) {
      throw new Error('预置场景详情加载失败')
    }
    presetDocument = detail.document

    const trimmed = sceneName.value.trim()
    const name = trimmed.length ? trimmed : 'New Scene'
    const width = normalizeDimension(groundWidth.value, 100)
    const depth = normalizeDimension(groundDepth.value, 100)
    groundWidth.value = width
    groundDepth.value = depth

    emit('confirm', {
      name,
      groundWidth: width,
      groundDepth: depth,
      presetSceneId: presetId,
      presetSceneDocument: presetDocument,
    })
    emit('update:modelValue', false)
  } catch (error) {
    confirmError.value = error instanceof Error ? error.message : '创建新场景失败'
    return
  } finally {
    isConfirming.value = false
  }
}

function cancel() {
  resetPresetState()
  emit('update:modelValue', false)
}

</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="880">
    <v-card>
      <v-card-title>新建场景</v-card-title>
      <v-card-text>
        <div class="preset-section">
          <div class="preset-header">
            <span class="preset-title">预置场景</span>
            <v-btn size="small" variant="text" :loading="presetScenesLoading" @click="reloadPresetScenes">
              刷新
            </v-btn>
          </div>
          <div v-if="presetScenesLoading && !hasPresetScenes" class="preset-loading-row">
            <v-progress-linear color="primary" indeterminate rounded />
          </div>
          <v-alert
            v-else-if="!presetScenesLoading && !hasPresetScenes"
            type="info"
            density="comfortable"
            border="start"
            border-color="info"
          >
            暂无可用预置场景，请检查资源目录或网络连接后重试。
          </v-alert>
          <div v-else-if="hasPresetScenes" class="preset-grid" role="list">
            <button
              v-for="scene in presetEntries"
              :key="scene.id"
              type="button"
              role="listitem"
              class="preset-card"
              :class="{ selected: scene.id === selectedPresetId }"
              @click="handlePresetSelection(scene.id)"
            >
              <div class="preset-thumbnail">
                <v-img
                  :src="scene.thumbnailUrl || undefined"
                  :alt="scene.name"
                  cover
                  width="100%"
                  height="100%"
                />
                <div v-if="loadingPresetDetailId === scene.id" class="preset-spinner">
                  <v-progress-circular color="primary" indeterminate size="30" width="3" />
                </div>
              </div>
              <div class="preset-card-body">
                <div class="preset-name">{{ scene.name }}</div>
                <div v-if="scene.description" class="preset-description">{{ scene.description }}</div>
              </div>
            </button>
          </div>
          <div v-if="selectedPresetDetail" class="preset-meta">
            <span class="preset-meta-name">当前选择：{{ selectedPresetDetail.name }}</span>
            <span class="preset-meta-size">
              建议地面：
              {{ selectedPresetDetail.document.groundSettings?.width ?? '—' }}m ×
              {{ selectedPresetDetail.document.groundSettings?.depth ?? '—' }}m
            </span>
          </div>
        </div>

        <v-divider class="my-4" />

        <v-text-field
          id="new-scene-name"
          v-model="sceneName"
          label="场景名称"
          variant="outlined"
          density="comfortable"
          autofocus
          @keydown.enter.prevent="confirm"
        />
        <v-row dense>
          <v-col cols="6">
            <v-text-field
              v-model.number="groundWidth"
              label="地面宽度 (m)"
              variant="outlined"
              density="comfortable"
              type="number"
              min="1"
              step="1"
              suffix="m"
              @keydown.enter.prevent="confirm"
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model.number="groundDepth"
              label="地面深度 (m)"
              variant="outlined"
              density="comfortable"
              type="number"
              min="1"
              step="1"
              suffix="m"
              @keydown.enter.prevent="confirm"
            />
          </v-col>
        </v-row>

        <v-alert
          v-if="confirmError"
          type="error"
          density="comfortable"
          border="start"
          border-color="error"
          class="mt-4"
        >
          {{ confirmError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">取消</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="isConfirming"
          :disabled="isCreateDisabled"
          @click="confirm"
        >
          创建
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.preset-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.preset-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.preset-loading-row {
  padding: 6px 0;
}

.preset-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(220px, 1fr);
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 6px;
}

.preset-card {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  border-radius: 12px;
  padding: 0;
  cursor: pointer;
  text-align: left;
  color: inherit;
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.preset-card:hover {
  border-color: rgba(99, 179, 237, 0.85);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  transform: translateY(-2px);
}

.preset-card.selected {
  border-color: rgb(99, 179, 237);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
}

.preset-thumbnail {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
  background: #212733;
}

.preset-card-body {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preset-name {
  font-weight: 600;
  font-size: 0.95rem;
  line-height: 1.3;
}

.preset-description {
  font-size: 0.78rem;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.65);
}

.preset-spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 22, 31, 0.45);
}

.preset-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.75);
}

.preset-meta-name {
  font-weight: 600;
}

.preset-meta-size {
  opacity: 0.85;
}

@media (max-width: 600px) {
  .preset-grid {
    grid-auto-columns: minmax(140px, 1fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }
}
</style>
