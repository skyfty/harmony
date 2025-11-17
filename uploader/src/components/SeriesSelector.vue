<template>
  <div class="series-selector">
    <v-autocomplete
      v-model="internalValue"
      :items="items"
      :loading="loading"
      :label="label"
      :clearable="clearable"
      :disabled="disabled"
      :custom-filter="filter"
      item-title="name"
      item-value="id"
      variant="outlined"
      density="comfortable"
      hide-details="auto"
  :return-object="false"
      v-model:search="search"
      @update:modelValue="handleUpdate"
    >
      <template #item="{ item, props }">
        <v-list-item v-bind="props">
          <template #title>
            <div class="series-item__title">
              <span class="series-item__name">{{ item.raw.name }}</span>
              <v-chip
                v-if="typeof item.raw.assetCount === 'number'"
                size="x-small"
                variant="tonal"
                color="primary"
              >
                {{ item.raw.assetCount }}
              </v-chip>
            </div>
          </template>
          <template #subtitle>
            <span class="series-item__description" v-if="item.raw.description">
              {{ item.raw.description }}
            </span>
          </template>
        </v-list-item>
      </template>
      <template #append-item>
        <v-divider></v-divider>
        <v-list-item
          v-if="allowCreate && searchLabel"
          prepend-icon="mdi-plus"
          title="创建新系列"
          :subtitle="`“${searchLabel}”`"
          @click="openCreateDialog"
        />
      </template>
      <template #no-data>
        <v-list-item title="暂无可选系列" />
      </template>
    </v-autocomplete>

    <v-dialog v-model="createDialog" max-width="420">
      <v-card>
        <v-card-title>创建新系列</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="createForm.name"
            label="系列名称"
            required
            autofocus
          />
          <v-textarea
            v-model="createForm.description"
            label="系列描述 (可选)"
            rows="3"
          />
          <v-alert v-if="createError" type="error" variant="tonal" density="comfortable">
            {{ createError }}
          </v-alert>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="closeCreateDialog" :disabled="creating">取消</v-btn>
          <v-btn color="primary" :loading="creating" @click="submitCreate">创建</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FilterFunction } from 'vuetify'
import type { AssetSeries } from '@/types'

type CreateSeriesHandler = (payload: { name: string; description?: string | null }) => Promise<AssetSeries>

const props = defineProps<{
  modelValue: string | null
  seriesOptions: AssetSeries[]
  loading?: boolean
  label?: string
  disabled?: boolean
  clearable?: boolean
  allowCreate?: boolean
  createSeries?: CreateSeriesHandler
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
  (e: 'series-created', series: AssetSeries): void
}>()

const loading = computed(() => props.loading ?? false)
const label = computed(() => props.label ?? '系列')
const disabled = computed(() => props.disabled ?? false)
const clearable = computed(() => props.clearable ?? true)
const allowCreate = computed(() => props.allowCreate ?? true)

const items = computed(() => props.seriesOptions)
const internalValue = ref<string | null>(props.modelValue ?? null)
const search = ref('')

watch(
  () => props.modelValue,
  (next) => {
    internalValue.value = next ?? null
  },
)

const searchLabel = computed(() => search.value.trim())

function handleUpdate(value: string | AssetSeries | null): void {
  const raw = typeof value === 'object' && value !== null ? value.id : value
  const normalized = typeof raw === 'string' && raw.trim().length ? raw.trim() : null
  internalValue.value = normalized
  emit('update:modelValue', normalized)
}

const filter: FilterFunction = (value, queryText, item): boolean => {
  const query = queryText?.toLowerCase?.().trim() ?? ''
  if (!query.length) {
    return true
  }

  const series = (item as { raw?: AssetSeries } | undefined)?.raw
  if (series) {
    const nameMatch = series.name?.toLowerCase?.().includes(query) ?? false
    const descriptionMatch = series.description ? series.description.toLowerCase().includes(query) : false
    return nameMatch || descriptionMatch
  }

  const normalizedValue = typeof value === 'string' ? value.toLowerCase() : ''
  return normalizedValue.includes(query)
}

const createDialog = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)
const createForm = reactive({
  name: '',
  description: '',
})

function openCreateDialog(): void {
  if (!allowCreate.value) {
    return
  }
  createForm.name = searchLabel.value
  createForm.description = ''
  createError.value = null
  createDialog.value = true
}

function closeCreateDialog(): void {
  if (creating.value) {
    return
  }
  createDialog.value = false
}

async function submitCreate(): Promise<void> {
  if (!props.createSeries) {
    closeCreateDialog()
    return
  }
  const name = createForm.name.trim()
  if (!name.length) {
    createError.value = '系列名称不能为空'
    return
  }
  creating.value = true
  createError.value = null
  try {
    const created = await props.createSeries({
      name,
      description: createForm.description.trim().length ? createForm.description.trim() : null,
    })
    emit('series-created', created)
    handleUpdate(created.id)
    search.value = ''
    createDialog.value = false
  } catch (error) {
    createError.value = (error as Error).message ?? '创建系列失败'
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.series-selector {
  width: 100%;
}

.series-item__title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.series-item__name {
  font-weight: 500;
  color: rgba(0, 0, 0, 0.87);
}

.series-item__description {
  color: rgba(0, 0, 0, 0.6);
}
</style>
