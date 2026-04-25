<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PlanningSceneData, PlanningTerrainDemData } from '@/types/planning-scene-data'
import { parsePlanningDemFile, demImportResultToTerrainData } from '@/utils/planningDemImport'
import { buildPlanningDataFromDem } from '@/utils/planningDemSceneSizing'
import { storePlanningDemBlobByHash } from '@/utils/planningDemStorage'

const props = defineProps<{
  sceneName: string
  planningData?: PlanningSceneData | null
  confirmError?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:sceneName', value: string): void
  (e: 'update:planningData', value: PlanningSceneData | null): void
}>()

const name = computed({
  get: () => props.sceneName,
  set: (v: string) => emit('update:sceneName', v),
})

const planningData = computed({
  get: () => props.planningData ?? null,
  set: (v: PlanningSceneData | null) => emit('update:planningData', v),
})

const demFileInputRef = ref<HTMLInputElement | null>(null)
const demImportError = ref<string | null>(null)
const demImportName = ref<string | null>(null)
const isImportingDem = ref(false)
const importedDem = computed<PlanningTerrainDemData | null>(() => planningData.value?.terrain?.dem ?? null)

function isPlanningDemFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.tif') || name.endsWith('.tiff') || file.type.includes('tiff') || file.type.includes('geotiff')
}

function handleDemImportClick() {
  demFileInputRef.value?.click()
}

function clearDemImport() {
  demImportError.value = null
  demImportName.value = null
  planningData.value = null
}

async function handleDemFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  if (!input?.files?.length || isImportingDem.value) {
    return
  }
  const file = input.files[0]!
  input.value = ''
  demImportError.value = null
  isImportingDem.value = true

  try {
    if (!isPlanningDemFile(file)) {
      throw new Error('Only GeoTIFF .tif or .tiff files are supported for DEM import.')
    }
    const result = await parsePlanningDemFile(file)
    await storePlanningDemBlobByHash(result.sourceFileHash, file)
    const dem = demImportResultToTerrainData(result)
    planningData.value = buildPlanningDataFromDem(dem)
    demImportName.value = file.name
  } catch (error) {
    demImportError.value = error instanceof Error ? error.message : 'Failed to import DEM file.'
  } finally {
    isImportingDem.value = false
  }
}
</script>

<template>
  <v-divider class="my-4" />

  <v-text-field
    id="new-scene-name"
    v-model="name"
    label="Scene Name"
    variant="underlined"
    density="comfortable"
    autofocus
  />

  <div class="scene-creator-dem-import">
    <div class="scene-creator-dem-import__header">
      <div class="scene-creator-dem-import__title">DEM Import</div>
      <div class="scene-creator-dem-import__actions">
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :loading="isImportingDem"
          @click="handleDemImportClick"
        >
          Import DEM
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          color="error"
          :disabled="!planningData"
          @click="clearDemImport"
        >
          Clear
        </v-btn>
      </div>
    </div>
    <input
      ref="demFileInputRef"
      type="file"
      accept=".tif,.tiff"
      class="sr-only"
      @change="handleDemFileChange"
    >
    <div v-if="importedDem" class="scene-creator-dem-import__body">
      <div class="scene-creator-dem-import__meta">
        <div class="scene-creator-dem-import__row"><span>File</span><strong>{{ demImportName || importedDem.filename || 'Unnamed DEM' }}</strong></div>
        <div class="scene-creator-dem-import__row"><span>Size</span><strong>{{ importedDem.width ?? '—' }} × {{ importedDem.height ?? '—' }}</strong></div>
        <div class="scene-creator-dem-import__row"><span>Elevation</span><strong>{{ importedDem.minElevation ?? '—' }} → {{ importedDem.maxElevation ?? '—' }}</strong></div>
      </div>
      <div class="scene-creator-dem-import__preview-placeholder">Imported DEM will be attached to the new scene.</div>
    </div>
    <div v-else class="scene-creator-dem-import__empty">
      Import a DEM to attach chunked terrain source data to the new scene.
    </div>
    <v-alert
      v-if="demImportError"
      class="mt-3"
      type="error"
      density="comfortable"
      border="start"
      border-color="error"
    >
      {{ demImportError }}
    </v-alert>
  </div>

  <v-alert
    v-if="props.confirmError"
    type="error"
    density="comfortable"
    border="start"
    border-color="error"
    class="mt-4"
  >
    {{ props.confirmError }}
  </v-alert>
</template>

<style scoped>
/* keep minimal styling — parent dialogs provide layout */

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.scene-creator-dem-import {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.scene-creator-dem-import__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.scene-creator-dem-import__title {
  font-size: 0.9rem;
  font-weight: 600;
}

.scene-creator-dem-import__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.scene-creator-dem-import__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scene-creator-dem-import__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scene-creator-dem-import__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.72);
}

.scene-creator-dem-import__row strong {
  color: rgba(255, 255, 255, 0.95);
  text-align: right;
  overflow-wrap: anywhere;
}

.scene-creator-dem-import__preview,
.scene-creator-dem-import__empty {
  min-height: 72px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.scene-creator-dem-import__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
}

.scene-creator-dem-import__preview-placeholder,
.scene-creator-dem-import__empty {
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.82rem;
  text-align: center;
}
</style>
