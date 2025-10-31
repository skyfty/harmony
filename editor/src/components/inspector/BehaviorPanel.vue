<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  BehaviorActionType,
  BehaviorComponentProps,
  BehaviorScriptType,
  SceneBehavior,
  SceneNodeComponentState,
} from '@harmony/schema'
import { useSceneStore } from '@/stores/sceneStore'
import { BEHAVIOR_COMPONENT_TYPE } from '@schema/components'
import {
  cloneBehavior,
  cloneBehaviorList,
  createBehaviorTemplate,
  findBehaviorAction,
  findBehaviorScript,
  listBehaviorActions,
  listBehaviorScripts,
} from '@schema/behaviors/definitions'
import { generateUuid } from '@/utils/uuid'
import BehaviorDetailsPanel from '@/components/inspector/BehaviorDetailsPanel.vue'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const behaviorComponent = computed(() => {
  const node = selectedNode.value
  if (!node?.components?.length) {
    return undefined
  }
  return node.components.find((entry) => entry.type === BEHAVIOR_COMPONENT_TYPE) as
    | SceneNodeComponentState<BehaviorComponentProps>
    | undefined
})

const behaviors = computed<SceneBehavior[]>(() => {
  const component = behaviorComponent.value
  if (!component) {
    return []
  }
  const props = component.props as BehaviorComponentProps | undefined
  return props?.behaviors ?? []
})

const actionOptions = listBehaviorActions()
const scriptOptions = listBehaviorScripts()

const detailsVisible = ref(false)
const detailsMode = ref<'create' | 'edit'>('create')
const editingBehavior = ref<SceneBehavior | null>(null)
const editingBehaviorId = ref<string | null>(null)

function resolveActionLabel(action: BehaviorActionType): string {
  return findBehaviorAction(action)?.label ?? 'Unknown Action'
}

function resolveScriptLabel(script: BehaviorScriptType): string {
  return findBehaviorScript(script)?.label ?? 'Unknown Script'
}

function openDetails(mode: 'create' | 'edit', behavior: SceneBehavior) {
  detailsMode.value = mode
  editingBehavior.value = cloneBehavior(behavior)
  editingBehaviorId.value = behavior.id || null
  detailsVisible.value = true
}

function handleAddBehavior() {
  if (!behaviorComponent.value) {
    return
  }
  const template = createBehaviorTemplate('click', 'showAlert')
  openDetails('create', template)
}

function handleEditBehavior(behavior: SceneBehavior) {
  openDetails('edit', behavior)
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

function handleSaveBehavior(behavior: SceneBehavior) {
  const component = behaviorComponent.value
  if (!component) {
    return
  }
  const current = cloneBehaviorList(behaviors.value)
  if (detailsMode.value === 'create') {
    const id = generateUuid()
    current.push({
      ...cloneBehavior(behavior),
      id,
    })
  } else if (editingBehaviorId.value) {
    const index = current.findIndex((entry) => entry.id === editingBehaviorId.value)
    if (index !== -1) {
      current[index] = {
        ...cloneBehavior(behavior),
        id: editingBehaviorId.value,
      }
    }
  }
  commitBehaviors(current)
  detailsVisible.value = false
  editingBehavior.value = null
  editingBehaviorId.value = null
}

function handleDeleteBehavior(id: string) {
  const current = cloneBehaviorList(behaviors.value)
  const next = current.filter((entry) => entry.id !== id)
  commitBehaviors(next)
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
        <div v-if="behaviors.length" class="behavior-list">
          <div
            v-for="behavior in behaviors"
            :key="behavior.id"
            class="behavior-item"
          >
            <div class="behavior-item__info">
              <div class="behavior-item__name">
                {{ behavior.name?.trim() || 'Untitled Behavior' }}
              </div>
              <div class="behavior-item__meta">
                <v-chip size="x-small" variant="tonal" color="primary" class="behavior-item__chip">
                  {{ resolveActionLabel(behavior.action) }}
                </v-chip>
                <v-chip size="x-small" variant="outlined" class="behavior-item__chip">
                  {{ resolveScriptLabel(behavior.script.type) }}
                </v-chip>
              </div>
            </div>
            <div class="behavior-item__actions">
              <v-btn
                icon
                size="small"
                variant="text"
                @click.stop="handleEditBehavior(behavior)"
              >
                <v-icon size="18">mdi-pencil</v-icon>
              </v-btn>
              <v-btn
                icon
                size="small"
                variant="text"
                color="error"
                @click.stop="handleDeleteBehavior(behavior.id)"
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
    :behavior="editingBehavior"
    :actions="actionOptions"
    :scripts="scriptOptions"
    @close="detailsVisible = false"
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

.behavior-item__info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.behavior-item__name {
  font-weight: 600;
  font-size: 0.95rem;
}

.behavior-item__meta {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
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
