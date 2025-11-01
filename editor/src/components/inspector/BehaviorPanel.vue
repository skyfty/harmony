<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  BehaviorEventType,
  BehaviorComponentProps,
  BehaviorScriptType,
  SceneBehavior,
  SceneNodeComponentState,
} from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { BEHAVIOR_COMPONENT_TYPE } from '@schema/components'
import {
  behaviorMapToList,
  cloneBehavior,
  cloneBehaviorList,
  createBehaviorSequenceId,
  createBehaviorTemplate,
  ensureBehaviorParams,
  findBehaviorAction,
  findBehaviorScript,
  type BehaviorActionDefinition,
  listBehaviorActions,
  listBehaviorScripts,
} from '@schema/behaviors/definitions'
import { generateUuid } from '@/utils/uuid'
import BehaviorDetailsPanel from '@/components/inspector/BehaviorDetailsPanel.vue'

interface BehaviorSequenceEntry {
  action: BehaviorEventType
  sequenceId: string
  sequence: SceneBehavior[]
}

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

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

const detailsVisible = ref(false)
const detailsMode = ref<'create' | 'edit'>('create')
const editingAction = ref<BehaviorEventType | null>(null)
const editingSequence = ref<SceneBehavior[] | null>(null)
const editingSequenceId = ref<string | null>(null)
const detailsActions = ref<BehaviorActionDefinition[]>(actionOptions)

function resetDetailsState(): void {
  detailsVisible.value = false
  editingAction.value = null
  editingSequence.value = null
  editingSequenceId.value = null
  detailsActions.value = actionOptions
}

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

function resolveScriptDefinition(script: BehaviorScriptType) {
  return findBehaviorScript(script)
}

function resolveScriptLabel(script: BehaviorScriptType): string {
  return resolveScriptDefinition(script)?.label ?? 'Unknown Script'
}

function resolveScriptIcon(script: BehaviorScriptType): string {
  return resolveScriptDefinition(script)?.icon ?? 'mdi-script-text-outline'
}

function openDetails(
  mode: 'create' | 'edit',
  action: BehaviorEventType,
  sequence: SceneBehavior[] | null,
  allowedActions: BehaviorActionDefinition[],
  sequenceId: string,
) {
  detailsMode.value = mode
  editingAction.value = action
  editingSequence.value = sequence ? cloneBehaviorList(sequence) : null
  editingSequenceId.value = sequenceId
  const uniqueActions = new Map<BehaviorEventType, BehaviorActionDefinition>()
  allowedActions.forEach((definition) => {
    uniqueActions.set(definition.id, definition)
  })
  const currentDefinition = findBehaviorAction(action)
  if (currentDefinition) {
    uniqueActions.set(currentDefinition.id, currentDefinition)
  }
  detailsActions.value = uniqueActions.size ? Array.from(uniqueActions.values()) : actionOptions
  detailsVisible.value = true
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

type BehaviorSequencePayload = {
  action: BehaviorEventType
  sequence: SceneBehavior[]
}

function handleSaveBehavior(payload: BehaviorSequencePayload) {
  const component = behaviorComponent.value
  if (!component) {
    return
  }
  const props = component.props as BehaviorComponentProps | undefined
  const source = props?.behaviors
  const currentList = cloneBehaviorList(Array.isArray(source) ? source : behaviorMapToList(source))
  const existingSequenceId = editingSequenceId.value
  const requestedSequenceId = payload.sequence[0]?.sequenceId
  const sequenceId = requestedSequenceId && requestedSequenceId.trim().length
    ? requestedSequenceId
    : existingSequenceId ?? createBehaviorSequenceId()

  if (payload.action !== 'perform') {
    const hasConflict = behaviorEntries.value.some(
      (entry) =>
        entry.action === payload.action &&
        entry.sequenceId !== sequenceId &&
        entry.sequenceId !== existingSequenceId,
    )
    if (hasConflict) {
      console.warn(`Behavior action "${payload.action}" already exists on this node.`)
      return
    }
  }

  const normalized = payload.sequence.map((step) => ({
    ...cloneBehavior(step),
    id: step.id && step.id.trim().length ? step.id : generateUuid(),
    action: payload.action,
    sequenceId,
    script: ensureBehaviorParams(step.script),
  }))

  const filtered = existingSequenceId
    ? currentList.filter((step) => step.sequenceId !== existingSequenceId)
    : currentList

  const insertionIndex = existingSequenceId
    ? currentList.findIndex((step) => step.sequenceId === existingSequenceId)
    : filtered.length
  const safeIndex = insertionIndex === -1 ? filtered.length : insertionIndex

  const nextList = filtered.slice()
  nextList.splice(safeIndex, 0, ...normalized)

  commitBehaviors(nextList)
  resetDetailsState()
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
      <div class="behavior-panel__body">
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
              <div class="behavior-item__sequence">
                <template v-if="entry.sequence.length">
                  <template v-for="(step, index) in entry.sequence" :key="step.id ?? `${entry.action}-${index}`">
                    <div class="behavior-item__step">
                      <v-icon size="18">{{ resolveScriptIcon(step.script.type) }}</v-icon>
                      <span>{{ resolveScriptLabel(step.script.type) }}</span>
                    </div>
                    <v-icon
                      v-if="index < entry.sequence.length - 1"
                      size="16"
                      class="behavior-item__arrow"
                    >
                      mdi-arrow-right
                    </v-icon>
                  </template>
                </template>
                <span v-else class="behavior-item__sequence-empty">No scripts configured</span>
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
  <BehaviorDetailsPanel
    :visible="detailsVisible"
    :mode="detailsMode"
    :action="editingAction"
    :sequence="editingSequence"
    :actions="detailsActions"
    :scripts="scriptOptions"
  @close="resetDetailsState()"
    @save="handleSaveBehavior"
  />
</template>

<style scoped>

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

.behavior-item__sequence {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.behavior-item__step {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.05);
  font-size: 0.8rem;
}

.behavior-item__arrow {
  color: rgba(233, 236, 241, 0.55);
}

.behavior-item__sequence-empty {
  color: rgba(233, 236, 241, 0.6);
  font-size: 0.8rem;
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
