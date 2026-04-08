<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

type AssetReferenceDialogResult = {
  key: string
  assetId: string
  assetName: string
  assetType: string | null
  sourceType: string | null
  sourceLabel: string | null
  category: string
  path: string
  nodeId: string | null
  nodeName: string | null
  componentType: string | null
  note: string | null
  totalReferences: number
}

const props = defineProps<{
  modelValue: boolean
  query: string
  summary: string
  results: AssetReferenceDialogResult[]
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'update:query', value: string): void
  (event: 'select', result: AssetReferenceDialogResult): void
}>()

const searchFieldRef = ref<unknown>(null)

const dialogModel = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const queryModel = computed({
  get: () => props.query,
  set: (value: string) => emit('update:query', value),
})

const hasResults = computed(() => props.results.length > 0)
const emptyText = computed(() => {
  if (props.query.trim()) {
    return '没有找到匹配的资产引用。'
  }
  return '输入资产名称或资产 ID，定位节点、组件、材质、环境、地面或规划中的引用。'
})

function focusSearchField() {
  nextTick(() => {
    const instance = searchFieldRef.value as any
    if (instance?.focus && typeof instance.focus === 'function') {
      instance.focus()
      return
    }
    const el = instance?.$el as HTMLElement | undefined
    const input = el?.querySelector?.('input') as HTMLInputElement | null
    input?.focus()
  })
}

watch(
  () => props.modelValue,
  (open: boolean) => {
    if (open) {
      focusSearchField()
    }
  },
)

function handleClose() {
  emit('update:modelValue', false)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    handleClose()
  }
}

function handleSelect(result: AssetReferenceDialogResult) {
  emit('select', result)
}
</script>

<template>
  <v-dialog
    v-model="dialogModel"
    content-class="asset-reference-dialog-overlay"
    scrim="rgba(4, 10, 18, 0.42)"
    scrollable
    max-width="980"
  >
    <v-card class="asset-reference-dialog-card">
      <v-toolbar density="compact" class="panel-toolbar" height="40px">
        <div class="toolbar-text">
          <div class="toolbar-caption">Asset Reference Lookup</div>
        </div>
        <v-spacer />
        <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleClose" />
      </v-toolbar>
      <v-card-text class="asset-reference-dialog-content">
 
        <section class="asset-reference-search-section">
          <v-text-field
            ref="searchFieldRef"
            v-model="queryModel"
            density="comfortable"
            variant="outlined"
            hide-details
            clearable
            single-line
            prepend-inner-icon="mdi-magnify"
            placeholder="Search asset references by name or id"
            @keydown="handleKeydown"
          />
          <div v-if="summary" class="asset-reference-summary">{{ summary }}</div>
        </section>

        <section class="asset-reference-results-panel">
          <div v-if="!hasResults" class="asset-reference-empty-state">
            {{ emptyText }}
          </div>
          <template v-else>
            <button
              v-for="result in props.results"
              :key="result.key"
              type="button"
              class="asset-reference-result"
              @click="handleSelect(result)"
            >
              <div class="asset-reference-result__title">
                <span>{{ result.assetName }}</span>
                <span class="asset-reference-result__id">{{ result.assetId }}</span>
              </div>
              <div class="asset-reference-result__meta">
                <span v-if="result.assetType">类型 {{ result.assetType }}</span>
                <span v-if="result.sourceType">来源 {{ result.sourceType }}</span>
                <span>{{ result.category }}</span>
                <span v-if="result.componentType">组件 {{ result.componentType }}</span>
                <span>引用 {{ result.totalReferences }}</span>
              </div>
              <div class="asset-reference-result__path">{{ result.path }}</div>
              <div v-if="result.nodeName || result.nodeId || result.sourceLabel" class="asset-reference-result__location">
                <span v-if="result.nodeName || result.nodeId">定位 {{ result.nodeName || result.nodeId }}</span>
                <span v-if="result.sourceLabel">资源 {{ result.sourceLabel }}</span>
              </div>
            </button>
          </template>
        </section>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 10px 12px 0;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toolbar-caption {
  font-size: 0.76rem;
  color: rgba(214, 228, 249, 0.58);
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}

.asset-reference-dialog-card {
  width: min(100vw - 28px, 980px);
  height: min(100vh - 40px, 820px);
  color: #e7eefb;
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(194, 219, 255, 0.1);
  background:
    radial-gradient(circle at top left, rgba(90, 147, 229, 0.2), transparent 28%),
    radial-gradient(circle at 85% 12%, rgba(45, 176, 141, 0.14), transparent 24%),
    radial-gradient(circle at bottom right, rgba(129, 93, 214, 0.12), transparent 26%),
    linear-gradient(180deg, rgba(24, 31, 43, 0.72), rgba(12, 17, 25, 0.78));
  backdrop-filter: blur(24px) saturate(120%);
  box-shadow: 0 32px 96px rgba(0, 0, 0, 0.48);
}

.asset-reference-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
  padding: 16px 18px 18px;
}

.asset-reference-dialog-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  padding: 18px 20px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(20, 28, 40, 0.5), rgba(14, 20, 30, 0.34));
  backdrop-filter: blur(18px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.overview-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.overview-eyebrow {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(168, 201, 246, 0.72);
}

.overview-title {
  margin-top: 6px;
  font-size: 1.5rem;
  font-weight: 700;
  color: #f7fbff;
}

.overview-subtitle {
  margin-top: 6px;
  max-width: 52ch;
  font-size: 0.9rem;
  line-height: 1.5;
  color: rgba(214, 228, 248, 0.72);
}

.asset-reference-search-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.asset-reference-summary {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.72);
}

.asset-reference-results-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(16, 23, 34, 0.62), rgba(8, 12, 19, 0.56));
  color: #eef3fb;
  backdrop-filter: blur(18px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.asset-reference-empty-state {
  height: 100%;
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  border-radius: 14px;
  border: 1px dashed rgba(255, 255, 255, 0.14);
  color: rgba(233, 240, 252, 0.72);
}

.asset-reference-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 14px 16px;
  text-align: left;
  color: rgba(233, 236, 241, 0.88);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.04);
}

.asset-reference-result:hover {
  background: rgba(77, 208, 225, 0.1);
  border-color: rgba(77, 208, 225, 0.24);
}

.asset-reference-result__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.88rem;
  font-weight: 600;
}

.asset-reference-result__id,
.asset-reference-result__path,
.asset-reference-result__location,
.asset-reference-result__meta {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.68);
}

.asset-reference-result__id,
.asset-reference-result__path,
.asset-reference-result__location {
  word-break: break-word;
}

.asset-reference-result__meta,
.asset-reference-result__location {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}
</style>