<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { IMPORTED_MODEL_EXPAND_CONFIRM_THRESHOLD, useSceneStore } from '@/stores/sceneStore'
import { isLightweightImportNode } from '@schema/core'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId, draggingAssetId, sceneNodePropertyVersion } = storeToRefs(sceneStore)

const dropAreaRef = ref<HTMLElement | null>(null)
const dropActive = ref(false)
const dropProcessing = ref(false)
const feedbackMessage = ref<string | null>(null)
const expandBusy = ref(false)
const expandThresholdDialogVisible = ref(false)
const pendingExpandNodeCount = ref(0)
const collapseDialogVisible = ref(false)

const isLightweightNode = computed(() => isLightweightImportNode(selectedNode.value))
const isExpandedRoot = computed(() => selectedNode.value?.importChildrenExpanded === true)

const currentAsset = computed(() => {
  const node = selectedNode.value
  if (!node?.sourceAssetId) {
    return null
  }
  return sceneStore.getAsset(node.sourceAssetId)
})

/**
 * Expand state of an imported model root. Reading the store version keeps the
 * panel in sync when the source model finishes parsing.
 */
const treeInfo = computed(() => {
  void sceneNodePropertyVersion.value
  const id = selectedNodeId.value
  if (!id || isLightweightNode.value) {
    return null
  }
  return sceneStore.resolveImportedModelTreeInfo(id)
})

const isBusy = computed(() => expandBusy.value)

const expandDisabled = computed(() => {
  const info = treeInfo.value
  if (!info || isBusy.value) {
    return true
  }
  return info.status === 'expanded' || info.status === 'unsupported' || info.status === 'loading'
})

const expandTitle = computed(() => {
  const info = treeInfo.value
  if (!info) {
    return '展开全部子节点'
  }
  if (info.status === 'unsupported') {
    return info.reason ?? '该节点不支持展开'
  }
  if (info.status === 'loading') {
    return '正在加载模型…'
  }
  if (info.status === 'expanded') {
    return `已展开 ${info.nodeCount} 个轻量子节点`
  }
  return `展开全部子节点（${info.nodeCount}）`
})

const expandNote = computed(() => treeInfo.value?.reason ?? null)

const overrideCount = computed(() => {
  const id = selectedNodeId.value
  return id && isExpandedRoot.value ? sceneStore.countLightweightImportOverrides(id) : 0
})

watch(selectedNode, () => {
  dropActive.value = false
  dropProcessing.value = false
  feedbackMessage.value = null
  expandThresholdDialogVisible.value = false
  collapseDialogVisible.value = false
})

function handleExpandClick() {
  const id = selectedNodeId.value
  const info = treeInfo.value
  if (!id || !info || info.status !== 'expandable') {
    return
  }
  if (info.nodeCount > (info.confirmedNodeThreshold ?? IMPORTED_MODEL_EXPAND_CONFIRM_THRESHOLD)) {
    pendingExpandNodeCount.value = info.nodeCount
    expandThresholdDialogVisible.value = true
    return
  }
  void runExpand()
}

async function runExpand() {
  const id = selectedNodeId.value
  if (!id || expandBusy.value) {
    return
  }
  expandThresholdDialogVisible.value = false
  expandBusy.value = true
  try {
    const result = await sceneStore.expandImportedModelNode(id)
    if (!result.ok) {
      feedbackMessage.value = result.reason ?? '展开失败'
    }
  } finally {
    expandBusy.value = false
  }
}

function handleCollapseClick() {
  if (isExpandedRoot.value) {
    collapseDialogVisible.value = true
  }
}

function runCollapse() {
  const id = selectedNodeId.value
  if (!id) {
    return
  }
  collapseDialogVisible.value = false
  const result = sceneStore.collapseImportedModelNode(id)
  if (!result.ok) {
    feedbackMessage.value = result.reason ?? '收起失败'
  }
}

function serializeAssetDragPayload(raw: string | null): string | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { assetId?: string }
    if (parsed?.assetId) {
      return parsed.assetId
    }
  } catch (error) {
    console.warn('Unable to parse asset drag payload', error)
  }
  return null
}

function resolveDragAssetId(event: DragEvent): string | null {
  if (event.dataTransfer) {
    const payload = serializeAssetDragPayload(event.dataTransfer.getData(ASSET_DRAG_MIME))
    if (payload) {
      return payload
    }
  }
  return draggingAssetId.value ?? null
}

function handleDragEnter(event: DragEvent) {
  event.preventDefault()
  dropActive.value = true
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  dropActive.value = true
}

function handleDragLeave(event: DragEvent) {
  const related = event.relatedTarget as Node | null
  if (!dropAreaRef.value || (related && dropAreaRef.value.contains(related))) {
    return
  }
  dropActive.value = false
}

const handleDrop = async (event: DragEvent) => {
  event.preventDefault()
  dropActive.value = false
  feedbackMessage.value = null
  if (!selectedNode.value) {
    return
  }
  if (dropProcessing.value) {
    return
  }

  const assetId = resolveDragAssetId(event)
  if (!assetId) {
    feedbackMessage.value = 'Drag a model asset from the Asset Panel.'
    return
  }
  const asset = sceneStore.getAsset(assetId)
  if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
    feedbackMessage.value = 'Only model assets can be assigned here.'
    return
  }

  if (assetId === selectedNode.value.sourceAssetId) {
    feedbackMessage.value = 'This model is already assigned.'
    return
  }

  dropProcessing.value = true
  try {
    await sceneStore.replaceNodeModelAsset(selectedNode.value.id, assetId)
  } catch (error) {
    console.error('Failed to replace node model asset', error)
    feedbackMessage.value = (error as Error).message ?? 'Failed to replace the model asset.'
  } finally {
    dropProcessing.value = false
  }
}

const assetPreviewStyle = computed(() => {
  const asset = currentAsset.value
  if (!asset) {
    return undefined
  }
  if (asset.thumbnail?.trim()) {
    return { backgroundImage: `url(${asset.thumbnail})` }
  }
  if (asset.previewColor) {
    return { backgroundColor: asset.previewColor }
  }
  return undefined
})

</script>

<template>
  <v-expansion-panel value="asset-model">
    <v-expansion-panel-title>Model Asset</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div
        class="asset-model-panel"
        ref="dropAreaRef"
        :class="{ 'is-active': dropActive, 'is-processing': dropProcessing }"
        @dragenter="handleDragEnter"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <div class="asset-model-row">
          <div v-if="currentAsset" class="asset-summary">
            <div class="asset-thumbnail" :style="assetPreviewStyle" />
            <div class="asset-text">
              <div class="asset-name">{{ currentAsset.name }}</div>
            </div>
          </div>
          <div v-else class="asset-summary empty">
            <div class="asset-thumbnail placeholder" />
            <div class="asset-text">
              <div class="asset-name">No external model assigned</div>
              <div class="asset-subtitle">Drag a model from the Asset Panel to bind it.</div>
            </div>
          </div>

          <template v-if="treeInfo">
            <v-spacer />
            <v-btn
              v-if="!isExpandedRoot"
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-file-tree"
              :disabled="expandDisabled"
              :loading="expandBusy"
              :title="expandTitle"
              @click.stop="handleExpandClick"
            >
              展开全部子节点
            </v-btn>
            <v-btn
              v-else
              size="small"
              variant="tonal"
              prepend-icon="mdi-arrow-collapse"
              :title="expandTitle"
              @click.stop="handleCollapseClick"
            >
              收起为整体模型
            </v-btn>
          </template>
        </div>
        <p v-if="expandNote" class="asset-note">{{ expandNote }}</p>
        <p v-if="feedbackMessage" class="asset-feedback">{{ feedbackMessage }}</p>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>

  <v-dialog v-model="expandThresholdDialogVisible" max-width="420">
    <v-card title="展开子节点">
      <v-card-text>
        源模型包含 {{ pendingExpandNodeCount }} 个节点，超过建议上限
        {{ IMPORTED_MODEL_EXPAND_CONFIRM_THRESHOLD }} 个。展开后会生成同样数量的轻量子节点，
        可能影响层级面板与保存体积，是否继续？
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="expandThresholdDialogVisible = false">取消</v-btn>
        <v-btn color="primary" variant="tonal" @click="runExpand">继续展开</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="collapseDialogVisible" max-width="420">
    <v-card title="收起为整体模型">
      <v-card-text>
        收起后将删除全部轻量子节点{{ overrideCount > 0 ? `，并丢弃 ${overrideCount} 个子节点的材质/变换/可见性覆盖` : '' }}。
        是否继续？
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="collapseDialogVisible = false">取消</v-btn>
        <v-btn color="warning" variant="tonal" @click="runCollapse">确认收起</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.asset-model-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.75rem;
  transition: border-color 0.2s, background-color 0.2s;
}

.asset-model-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.asset-note {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: rgba(233, 236, 241, 0.75);
}

.asset-note--subtle {
  color: rgba(233, 236, 241, 0.6);
}

.asset-model-panel.is-active {
  border-color: rgba(110, 231, 183, 0.8);
  background-color: rgba(110, 231, 183, 0.08);
}

.asset-model-panel.is-processing {
  border-color: rgba(59, 130, 246, 0.9);
  background-color: rgba(59, 130, 246, 0.08);
}

.asset-summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.asset-summary.empty .asset-text .asset-name {
  font-size: 0.85rem;
}

.asset-thumbnail {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background-size: cover;
  background-position: center;
}

.asset-thumbnail.placeholder {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
}

.asset-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.asset-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.asset-subtitle {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.7);
}

.asset-id {
  font-size: 0.7rem;
  color: rgba(233, 236, 241, 0.5);
}

.drop-indicator {
  border-top: 1px dashed rgba(255, 255, 255, 0.2);
  padding-top: 0.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.drop-label {
  font-size: 0.8rem;
}

.drop-hint {
  font-size: 0.7rem;
  color: rgba(233, 236, 241, 0.55);
}

.asset-feedback {
  font-size: 0.75rem;
  color: #f97316;
}
</style>
