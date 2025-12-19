<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode, draggingAssetId } = storeToRefs(sceneStore)

const dropAreaRef = ref<HTMLElement | null>(null)
const dropActive = ref(false)
const dropProcessing = ref(false)
const feedbackMessage = ref<string | null>(null)

const ASSET_DRAG_MIME = 'application/x-harmony-asset'

const currentAsset = computed(() => {
  const node = selectedNode.value
  if (!node?.sourceAssetId) {
    return null
  }
  return sceneStore.getAsset(node.sourceAssetId)
})

watch(selectedNode, () => {
  dropActive.value = false
  dropProcessing.value = false
  feedbackMessage.value = null
})

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

const computedSubtitle = computed(() => {
  const asset = currentAsset.value
  if (!asset) {
    return ''
  }
  const typeLabel = asset.type === 'model' ? 'Model asset' : asset.type === 'mesh' ? 'Mesh asset' : 'Asset'
  const identifier = asset.id.slice(0, 8)
  return `${typeLabel} · ${identifier}`
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
        <div v-if="currentAsset" class="asset-summary">
          <div class="asset-thumbnail" :style="assetPreviewStyle" />
          <div class="asset-text">
            <div class="asset-name">{{ currentAsset.name }}</div>
            <div class="asset-subtitle">{{ computedSubtitle }}</div>
          </div>
        </div>
        <div v-else class="asset-summary empty">
          <div class="asset-thumbnail placeholder" />
          <div class="asset-text">
            <div class="asset-name">No external model assigned</div>
            <div class="asset-subtitle">Drag a model from the Asset Panel to bind it.</div>
          </div>
        </div>
        <p v-if="feedbackMessage" class="asset-feedback">{{ feedbackMessage }}</p>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
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
