<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  BehaviorEventType,
  BehaviorComponentProps,
  SceneBehavior,
  SceneNodeComponentState,
} from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { BEHAVIOR_COMPONENT_TYPE } from '@schema/components'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'
import {
  behaviorMapToList,
  cloneBehaviorList,
  createBehaviorSequenceId,
  createBehaviorTemplate,
  findBehaviorAction,
  type BehaviorActionDefinition,
  listBehaviorActions,
  listBehaviorScripts,
} from '@schema/behaviors/definitions'
import { generateUuid } from '@/utils/uuid'

interface BehaviorSequenceEntry {
  action: BehaviorEventType
  sequenceId: string
  sequence: SceneBehavior[]
}

type BehaviorDetailsContext = {
  mode: 'create' | 'edit'
  action: BehaviorEventType
  sequence: SceneBehavior[]
  actions: BehaviorActionDefinition[]
  sequenceId: string
  nodeId: string | null
}

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)
const isPrefabDragActive = ref(false)
const isApplyingPrefab = ref(false)

const emit = defineEmits<{
  (event: 'open-details', payload: BehaviorDetailsContext): void
}>()

const behaviorComponent = computed(() =>
  selectedNode.value?.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<BehaviorComponentProps>
    | undefined,
)

const behaviorList = computed<SceneBehavior[]>(() => {
  const component = behaviorComponent.value
  if (!component) {
    return []
  }
  const props = component.props as BehaviorComponentProps | undefined
  const behaviors = props?.behaviors
  if (Array.isArray(behaviors)) {
    return cloneBehaviorList(behaviors)
  }
  return cloneBehaviorList(behaviorMapToList(behaviors))
})

const behaviorEntries = computed<BehaviorSequenceEntry[]>(() => {
  const groups = new Map<string, BehaviorSequenceEntry>()
  behaviorList.value.forEach((step) => {
    if (!step) {
      return
    }
    const key = step.sequenceId
    let entry = groups.get(key)
    if (!entry) {
      entry = {
        action: step.action,
        sequenceId: key,
        sequence: [],
      }
      groups.set(key, entry)
    }
    entry.sequence.push(step)
  })
  return Array.from(groups.values())
})

const actionOptions = listBehaviorActions()
const scriptOptions = listBehaviorScripts()

function listUnusedActions(excluded?: { action: BehaviorEventType | null; sequenceId: string | null }): BehaviorActionDefinition[] {
  const usedCounts = new Map<BehaviorEventType, number>()
  behaviorEntries.value.forEach((entry) => {
    if (excluded && entry.sequenceId === excluded.sequenceId) {
      return
    }
    usedCounts.set(entry.action, (usedCounts.get(entry.action) ?? 0) + 1)
  })
  return actionOptions.filter((option) => option.id === 'perform' || (usedCounts.get(option.id) ?? 0) === 0)
}

const canAddBehavior = computed(() => listUnusedActions().length > 0)

function resolveActionLabel(action: BehaviorEventType): string {
  return findBehaviorAction(action)?.label ?? 'Unknown Action'
}

function resolveBehaviorName(entry: BehaviorSequenceEntry): string {
  if (!entry.sequence.length) {
    return 'No scripts configured'
  }
  for (const step of entry.sequence) {
    const candidate = typeof step?.name === 'string' ? step.name.trim() : ''
    if (candidate) {
      return candidate
    }
  }
  return 'Untitled Behavior'
}

function openDetails(
  mode: 'create' | 'edit',
  action: BehaviorEventType,
  sequence: SceneBehavior[] | null,
  allowedActions: BehaviorActionDefinition[],
  sequenceId: string,
) {
  const uniqueActions = new Map<BehaviorEventType, BehaviorActionDefinition>()
  allowedActions.forEach((definition) => {
    uniqueActions.set(definition.id, definition)
  })
  const currentDefinition = findBehaviorAction(action)
  if (currentDefinition) {
    uniqueActions.set(currentDefinition.id, currentDefinition)
  }
  const actionsList = uniqueActions.size ? Array.from(uniqueActions.values()) : actionOptions
  const sequenceCopy = sequence ? cloneBehaviorList(sequence) : null
  emit('open-details', {
    mode,
    action,
    sequence: sequenceCopy ?? [],
    actions: actionsList,
    sequenceId,
    nodeId: selectedNodeId.value ?? null,
  })
}

function handleAddBehavior() {
  if (!behaviorComponent.value) {
    return
  }
  const availableActions = listUnusedActions()
  if (!availableActions.length) {
    console.warn('All behavior actions are already in use for this node.')
    return
  }
  const templateAction = availableActions[0]?.id ?? 'click'
  const defaultScript = scriptOptions[0]?.id ?? 'showAlert'
  const sequenceId = createBehaviorSequenceId()
  const template = createBehaviorTemplate(templateAction, defaultScript, sequenceId)
  template.id = generateUuid()
  openDetails('create', templateAction, [template], availableActions, sequenceId)
}

function handleEditBehavior(entry: BehaviorSequenceEntry) {
  const availableActions = listUnusedActions({ action: entry.action, sequenceId: entry.sequenceId })
  openDetails('edit', entry.action, cloneBehaviorList(entry.sequence), availableActions, entry.sequenceId)
}

function commitBehaviors(nextList: SceneBehavior[]): void {
  const component = behaviorComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, {
    behaviors: cloneBehaviorList(nextList),
  })
}

function handleDeleteBehavior(entry: BehaviorSequenceEntry) {
  const component = behaviorComponent.value
  if (!component) {
    return
  }
  const props = component.props as BehaviorComponentProps | undefined
  const source = props?.behaviors
  const currentList = cloneBehaviorList(Array.isArray(source) ? source : behaviorMapToList(source))
  const nextList = currentList.filter((step) => step.sequenceId !== entry.sequenceId)
  commitBehaviors(nextList)
}

function handleToggleComponent() {
  const component = behaviorComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent() {
  const component = behaviorComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function parseAssetDragPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.assetId && typeof parsed.assetId === 'string') {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse behavior prefab drag payload', error)
      }
    }
  }
  if (sceneStore.draggingAssetId) {
    return { assetId: sceneStore.draggingAssetId }
  }
  return null
}

function resolveBehaviorAssetId(event: DragEvent): string | null {
  const payload = parseAssetDragPayload(event)
  if (!payload) {
    return null
  }
  const asset = sceneStore.getAsset(payload.assetId)
  if (!asset || asset.type !== 'behavior') {
    return null
  }
  return asset.id
}

async function applyBehaviorPrefabAsset(assetId: string): Promise<void> {
  if (!selectedNodeId.value || isApplyingPrefab.value) {
    return
  }
  isApplyingPrefab.value = true
  try {
    const result = await sceneStore.applyBehaviorPrefabToNode(selectedNodeId.value, assetId)
    if (result) {
      await nextTick()
      const entry = behaviorEntries.value.find((item) => item.sequenceId === result.sequenceId)
      if (entry) {
        handleEditBehavior(entry)
      }
    }
  } catch (error) {
    console.warn('Failed to apply behavior prefab to node', error)
  } finally {
    isApplyingPrefab.value = false
  }
}

function handlePrefabDragEnter(event: DragEvent) {
  if (!selectedNodeId.value) {
    return
  }
  const assetId = resolveBehaviorAssetId(event)
  if (!assetId) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isPrefabDragActive.value = true
}

function handlePrefabDragOver(event: DragEvent) {
  if (!selectedNodeId.value) {
    return
  }
  const assetId = resolveBehaviorAssetId(event)
  if (!assetId) {
    if (isPrefabDragActive.value) {
      isPrefabDragActive.value = false
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  isPrefabDragActive.value = true
}

function handlePrefabDragLeave(event: DragEvent) {
  if (!isPrefabDragActive.value) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  isPrefabDragActive.value = false
}

async function handlePrefabDrop(event: DragEvent) {
  if (!selectedNodeId.value) {
    return
  }
  const assetId = resolveBehaviorAssetId(event)
  isPrefabDragActive.value = false
  if (!assetId) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  await applyBehaviorPrefabAsset(assetId)
}
</script>

<template>
  <v-expansion-panel value="behavior">

    <v-expansion-panel-title >
      <span class="behavior-panel__header">Behavior</span>
        <v-spacer />
            <v-btn
            icon="mdi-plus"
            size="small"
            variant="text"
            :disabled="!canAddBehavior"
            @click.stop="handleAddBehavior()"
          >
          </v-btn>

        <v-btn
          v-if="behaviorComponent"
          icon
          size="small"
          variant="text"
          class="behavior-panel__menu"
        >
          <v-menu activator="parent" location="bottom end" origin="auto">
            <v-list density="compact">
              <v-list-item @click.stop="handleToggleComponent()">
                <v-list-item-title>{{ behaviorComponent.enabled ? 'Disable' : 'Enable' }}</v-list-item-title>
              </v-list-item>
              <v-divider class="behavior-panel__divider" inset />
              <v-list-item @click.stop="handleRemoveComponent()">
                <v-list-item-title>Remove</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
          <v-icon size="18">mdi-dots-vertical</v-icon>
        </v-btn>
    </v-expansion-panel-title>

    <v-expansion-panel-text>
      <div
        class="behavior-panel__body"
        :class="{ 'behavior-panel__body--prefab-drop': isPrefabDragActive }"
        @dragenter="handlePrefabDragEnter"
        @dragover="handlePrefabDragOver"
        @dragleave="handlePrefabDragLeave"
        @drop="handlePrefabDrop"
      >
        <div v-if="behaviorEntries.length" class="behavior-list">
          <div
            v-for="entry in behaviorEntries"
            :key="entry.sequenceId"
            class="behavior-item"
          >
            <div class="behavior-item__info">
              <div class="behavior-item__meta">
                <v-chip size="x-small" variant="tonal" color="primary" class="behavior-item__chip">
                  {{ resolveActionLabel(entry.action) }}
                </v-chip>
              </div>
              <div class="behavior-item__name">
                {{ resolveBehaviorName(entry) }}
              </div>
            </div>
            <div class="behavior-item__actions">
              <v-btn
                icon
                size="small"
                variant="text"
                @click.stop="handleEditBehavior(entry)"
              >
                <v-icon size="18">mdi-pencil</v-icon>
              </v-btn>
              <v-btn
                icon
                size="small"
                variant="text"
                color="error"
                @click.stop="handleDeleteBehavior(entry)"
              >
                <v-icon size="18">mdi-delete-outline</v-icon>
              </v-btn>
            </div>
          </div>
        </div>
        <div v-else class="behavior-panel__empty">No behaviors configured for this node.</div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>

.v-expansion-panel {
      border-radius: 0px;
}

.behavior-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.behavior-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.behavior-panel__menu {
  color: rgba(233, 236, 241, 0.82);
}

.behavior-panel__divider {
  margin-inline: 0.6rem;
}

.behavior-panel__body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-inline: 0.25rem;
}

.behavior-panel__body--prefab-drop {
  box-shadow: inset 0 0 0 2px rgba(77, 182, 172, 0.35);
  border-radius: 8px;
}

.behavior-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.behavior-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  background-color: rgba(33, 38, 45, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.behavior-item__meta {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
}

.behavior-item__info {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.behavior-item__name {
  color: rgba(233, 236, 241, 0.85);
  font-size: 0.85rem;
  font-weight: 500;
}

.behavior-item__chip {
  font-size: 0.75rem;
  height: 20px;
}

.behavior-item__actions {
  display: flex;
  gap: 0.15rem;
}

.behavior-panel__empty {
  padding: 0.6rem 0.4rem;
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.85rem;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 6px;
}

.behavior-panel__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
