<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type {
  BehaviorEventType,
  BehaviorScriptType,
  SceneBehavior,
} from '@harmony/schema'
import type { BehaviorActionDefinition, BehaviorScriptDefinition } from '@schema/behaviors/definitions'
import {
  cloneBehavior,
  createBehaviorSequenceId,
  createBehaviorTemplate,
  ensureBehaviorParams,
  findBehaviorScript,
} from '@schema/behaviors/definitions'
import { generateUuid } from '@/utils/uuid'
import DelayParams from '@/components/inspector/behavior/DelayParams.vue'
import MoveToParams from '@/components/inspector/behavior/MoveToParams.vue'
import ShowAlertParams from '@/components/inspector/behavior/ShowAlertParams.vue'
import WatchParams from '@/components/inspector/behavior/WatchParams.vue'
import ShowParams from '@/components/inspector/behavior/ShowParams.vue'
import HideParams from '@/components/inspector/behavior/HideParams.vue'
import LanternParams from '@/components/inspector/behavior/LanternParams.vue'

type PanelMode = 'create' | 'edit'
type DragSource = 'palette' | 'sequence' | null

const props = defineProps<{
  visible: boolean
  mode: PanelMode
  action: BehaviorEventType | null
  sequence: SceneBehavior[] | null
  actions: BehaviorActionDefinition[]
  scripts: BehaviorScriptDefinition[]
  anchor: { top: number; left: number } | null
  nodeId: string | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'save', payload: { action: BehaviorEventType; sequence: SceneBehavior[] }): void
}>()

const localAction = ref<BehaviorEventType>('click')
const localSequence = ref<SceneBehavior[]>([])
const localSequenceId = ref<string>(createBehaviorSequenceId())
const selectedStepId = ref<string | null>(null)
const isPickingTarget = ref(false)
const parameterComponentRef = ref<{ cancelPicking?: () => void } | null>(null)
const defaultTargetApplied = new Set<string>()

const panelStyle = computed(() => {
  if (!props.anchor) {
    return {}
  }
  return {
    top: `${props.anchor.top + 70}px`,
    left: `${props.anchor.left}px`,
  }
})

const dragState = reactive({
  source: null as DragSource,
  scriptType: null as BehaviorScriptType | null,
  stepId: null as string | null,
  sourceIndex: -1,
  dropIndex: -1,
})

const PARAMETER_COMPONENTS: Partial<Record<BehaviorScriptType, unknown>> = {
  delay: DelayParams,
  moveTo: MoveToParams,
  showAlert: ShowAlertParams,
  watch: WatchParams,
  show: ShowParams,
  hide: HideParams,
  lantern: LanternParams,
}

function resolveScriptDefinition(type: BehaviorScriptType) {
  return findBehaviorScript(type)
}

function resolveScriptLabel(type: BehaviorScriptType): string {
  return resolveScriptDefinition(type)?.label ?? 'Unknown Script'
}

function resolveScriptIcon(type: BehaviorScriptType): string {
  return resolveScriptDefinition(type)?.icon ?? 'mdi-script-text-outline'
}

function resetDragState() {
  dragState.source = null
  dragState.scriptType = null
  dragState.stepId = null
  dragState.sourceIndex = -1
  dragState.dropIndex = -1
}

function cancelActivePicking() {
  parameterComponentRef.value?.cancelPicking?.()
  isPickingTarget.value = false
}

function applyDefaultTarget(step: SceneBehavior): void {
  if (!props.nodeId) {
    return
  }
  const scriptType = step.script.type
  if (scriptType !== 'show' && scriptType !== 'hide' && scriptType !== 'watch') {
    return
  }
  const identifier = step.id
  if (!identifier) {
    return
  }
  if (defaultTargetApplied.has(identifier)) {
    return
  }
  const params = step.script.params as { targetNodeId?: string | null } | undefined
  if (!params) {
    defaultTargetApplied.add(identifier)
    return
  }
  if (params.targetNodeId === null) {
    params.targetNodeId = props.nodeId
  }
  defaultTargetApplied.add(identifier)
}

function applyDefaultTargets(sequence: SceneBehavior[]): void {
  sequence.forEach((step) => applyDefaultTarget(step))
}

function ensureStep(step: SceneBehavior, action: BehaviorEventType, sequenceId: string): SceneBehavior {
  const normalized = cloneBehavior(step)
  normalized.id = normalized.id && normalized.id.trim().length ? normalized.id : generateUuid()
  normalized.action = action
  normalized.sequenceId = sequenceId
  normalized.script = ensureBehaviorParams(normalized.script)
  applyDefaultTarget(normalized)
  return normalized
}

function rebuildSequence(
  sequence: SceneBehavior[] | null | undefined,
  action: BehaviorEventType,
  sequenceId: string,
): SceneBehavior[] {
  const list = Array.isArray(sequence) && sequence.length ? sequence : []
  return list.map((step) => ensureStep(step, action, sequenceId))
}

function initializeState() {
  const fallbackAction = props.actions[0]?.id ?? localAction.value ?? 'click'
  const action = props.action ?? fallbackAction
  const sequenceId = props.sequence?.[0]?.sequenceId ?? createBehaviorSequenceId()
  localSequenceId.value = sequenceId
  localAction.value = action
  defaultTargetApplied.clear()
  localSequence.value = rebuildSequence(props.sequence, action, sequenceId)
  applyDefaultTargets(localSequence.value)
  selectedStepId.value = localSequence.value[0]?.id ?? null
  cancelActivePicking()
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      initializeState()
    } else {
      resetDragState()
      cancelActivePicking()
    }
  },
  { immediate: true },
)

watch(
  () => props.sequence,
  (sequence) => {
    if (!props.visible) {
      return
    }
    cancelActivePicking()
    const sequenceId = sequence?.[0]?.sequenceId ?? localSequenceId.value ?? createBehaviorSequenceId()
    localSequenceId.value = sequenceId
    defaultTargetApplied.clear()
    localSequence.value = rebuildSequence(sequence, localAction.value, sequenceId)
    applyDefaultTargets(localSequence.value)
    if (!localSequence.value.find((step) => step.id === selectedStepId.value)) {
      selectedStepId.value = localSequence.value[0]?.id ?? null
    }
  },
  { deep: true },
)

watch(
  () => props.actions,
  (actions) => {
    if (!actions?.length) {
      return
    }
    const hasCurrent = actions.some((entry) => entry.id === localAction.value)
    if (!hasCurrent) {
      const [firstAction] = actions
      if (firstAction) {
        localAction.value = firstAction.id
        localSequence.value = rebuildSequence(localSequence.value, localAction.value, localSequenceId.value)
      }
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => localAction.value,
  (action) => {
    cancelActivePicking()
    localSequence.value = localSequence.value.map((step) => ensureStep(step, action, localSequenceId.value))
  },
)

const selectedAction = computed<BehaviorEventType>({
  get() {
    return localAction.value
  },
  set(value) {
    localAction.value = value
  },
})

const selectedStep = computed<SceneBehavior | null>(() => {
  const id = selectedStepId.value
  if (!id) {
    return null
  }
  return localSequence.value.find((step) => step.id === id) ?? null
})

const parameterComponent = computed(() => {
  const step = selectedStep.value
  if (!step) {
    return null
  }
  return PARAMETER_COMPONENTS[step.script.type] ?? null
})

function handleParamsUpdate(value: unknown) {
  const step = selectedStep.value
  if (!step) {
    return
  }
  step.script.params = value as SceneBehavior['script']['params']
  step.script = ensureBehaviorParams(step.script)
}

function handlePickStateChange(active: boolean) {
  isPickingTarget.value = active
}

function selectStep(stepId: string) {
  selectedStepId.value = stepId
}

function createStep(scriptType: BehaviorScriptType): SceneBehavior {
  const template = createBehaviorTemplate(localAction.value, scriptType, localSequenceId.value)
  template.id = generateUuid()
  template.script = ensureBehaviorParams(template.script)
  applyDefaultTarget(template)
  return template
}

function insertStep(scriptType: BehaviorScriptType, index: number) {
  const step = createStep(scriptType)
  const normalizedIndex = Math.min(Math.max(index, 0), localSequence.value.length)
  localSequence.value.splice(normalizedIndex, 0, step)
  selectedStepId.value = step.id
}

function moveStep(stepId: string, targetIndex: number) {
  const currentIndex = localSequence.value.findIndex((step) => step.id === stepId)
  if (currentIndex === -1) {
    return
  }
  const clampedTarget = Math.min(Math.max(targetIndex, 0), localSequence.value.length)
  const [step] = localSequence.value.splice(currentIndex, 1)
  if (!step) {
    return
  }
  const adjustedIndex = currentIndex < clampedTarget ? clampedTarget - 1 : clampedTarget
  localSequence.value.splice(adjustedIndex, 0, step)
}

function removeStep(stepId: string) {
  const index = localSequence.value.findIndex((step) => step.id === stepId)
  if (index === -1) {
    return
  }
  const wasSelected = selectedStepId.value === stepId
  localSequence.value.splice(index, 1)
  if (!localSequence.value.length) {
    selectedStepId.value = null
    return
  }
  if (wasSelected) {
    const fallback = localSequence.value[index] ?? localSequence.value[index - 1]
    selectedStepId.value = fallback?.id ?? null
  }
}

function handlePaletteDragStart(script: BehaviorScriptDefinition, event: DragEvent) {
  resetDragState()
  dragState.source = 'palette'
  dragState.scriptType = script.id
  event.dataTransfer?.setData('text/plain', script.id)
  event.dataTransfer?.setDragImage?.((event.target as HTMLElement) ?? document.body, 12, 12)
  event.dataTransfer && (event.dataTransfer.effectAllowed = 'copyMove')
}

function handleSequenceDragStart(step: SceneBehavior, index: number, event: DragEvent) {
  resetDragState()
  dragState.source = 'sequence'
  dragState.stepId = step.id
  dragState.sourceIndex = index
  event.dataTransfer?.setData('text/plain', step.id)
  event.dataTransfer && (event.dataTransfer.effectAllowed = 'move')
}

function handleDragEnd() {
  resetDragState()
}

function handleSequenceDragOver(targetIndex: number, event: DragEvent) {
  event.preventDefault()
  dragState.dropIndex = targetIndex
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = dragState.source === 'palette' ? 'copy' : 'move'
  }
}

function handleSequenceDrop(targetIndex: number, event: DragEvent) {
  event.preventDefault()
  if (dragState.source === 'palette' && dragState.scriptType) {
    insertStep(dragState.scriptType, targetIndex)
  } else if (dragState.source === 'sequence' && dragState.stepId) {
    moveStep(dragState.stepId, targetIndex)
  }
  resetDragState()
}

function handlePaletteDrop(event: DragEvent) {
  event.preventDefault()
  if (dragState.source === 'sequence' && dragState.stepId) {
    removeStep(dragState.stepId)
  }
  resetDragState()
}

function handlePaletteItemClick(script: BehaviorScriptDefinition) {
  insertStep(script.id, localSequence.value.length)
}

function closePanel() {
  cancelActivePicking()
  emit('close')
}

function handleSave() {
  const action = localAction.value
  if (!action) {
    return
  }
  const normalized = localSequence.value.map((step) => ensureStep(step, action, localSequenceId.value))
  emit('save', {
    action,
    sequence: normalized,
  })
  cancelActivePicking()
}

const dialogTitle = computed(() => (props.mode === 'create' ? 'Add Behavior Sequence' : 'Edit Behavior Sequence'))
</script>

<template>
  <Teleport to="body">
    <transition name="behavior-details-panel">
      <div
        v-if="visible && anchor"
        :class="['behavior-details-panel', { 'behavior-details-panel--picking': isPickingTarget }]"
        :style="panelStyle"
      >
        <v-card v-show="!isPickingTarget" class="behavior-details">
          <v-toolbar density="compact" class="panel-toolbar" height="40px">
            <div class="toolbar-text">
              <div class="material-title">{{ dialogTitle }}</div>
            </div>
            <v-spacer />
            <v-btn
              class="toolbar-save"
              variant="text"
              size="small"
              title="Save"
              :disabled="isPickingTarget"
              @click="handleSave"
            >
              <v-icon size="16px">mdi-content-save</v-icon>
            </v-btn>
            <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="closePanel" />
          </v-toolbar>
          <v-divider />
          <v-card-text class="behavior-details__body">
            <div class="behavior-details__field">
              <v-select
                v-model="selectedAction"
                :items="actions"
                item-title="label"
                item-value="id"
                label="Action"
                density="compact"
                variant="underlined"
                hide-details
              />
            </div>
            <div
              class="behavior-details__palette"
              @dragover.prevent
              @drop.prevent="handlePaletteDrop"
            >
              <div
                v-for="script in scripts"
                :key="script.id"
                class="behavior-palette__item"
                draggable="true"
                @dragstart="handlePaletteDragStart(script, $event)"
                @dragend="handleDragEnd"
                @click="handlePaletteItemClick(script)"
              >
                <v-icon size="20">{{ script.icon }}</v-icon>
                <span>{{ script.label }}</span>
              </div>
            </div>
            <div class="behavior-details__sequence">
              <div class="behavior-sequence">
                <template v-if="localSequence.length">
                  <template v-for="(step, index) in localSequence" :key="step.id">
                    <div
                      class="behavior-sequence__drop-zone"
                      :class="{ 'is-active': dragState.dropIndex === index }"
                      @dragover.prevent="handleSequenceDragOver(index, $event)"
                      @drop.prevent="handleSequenceDrop(index, $event)"
                    />
                    <div class="behavior-sequence__item-group">
                      <div
                        class="behavior-sequence__item"
                        :class="{ 'is-selected': selectedStepId === step.id }"
                        draggable="true"
                        @dragstart="handleSequenceDragStart(step, index, $event)"
                        @dragend="handleDragEnd"
                        @click="selectStep(step.id)"
                      >
                        <v-icon size="18">{{ resolveScriptIcon(step.script.type) }}</v-icon>
                        <span>{{ resolveScriptLabel(step.script.type) }}</span>
                      </div>
                      <v-icon
                        v-if="index < localSequence.length - 1"
                        size="16"
                        class="behavior-sequence__arrow"
                      >
                        mdi-arrow-right
                      </v-icon>
                    </div>
                    <div
                      v-if="index === localSequence.length - 1"
                      class="behavior-sequence__drop-zone end"
                      :class="{ 'is-active': dragState.dropIndex === localSequence.length }"
                      @dragover.prevent="handleSequenceDragOver(localSequence.length, $event)"
                      @drop.prevent="handleSequenceDrop(localSequence.length, $event)"
                    />
                  </template>
                </template>
                <div
                  v-else
                  class="behavior-sequence__empty"
                  @dragover.prevent="handleSequenceDragOver(0, $event)"
                  @drop.prevent="handleSequenceDrop(0, $event)"
                >
                  Drag scripts here to build the sequence
                </div>
              </div>
            </div>
            <div class="behavior-details__params">
              <template v-if="selectedStep && parameterComponent">
                <component
                  :is="parameterComponent"
                  :model-value="selectedStep.script.params"
                  ref="parameterComponentRef"
                  @pick-state-change="handlePickStateChange"
                  @update:modelValue="handleParamsUpdate"
                />
              </template>
              <template v-else-if="selectedStep">
                <div class="behavior-details__no-params">This script has no configurable parameters.</div>
              </template>
              <template v-else>
                <div class="behavior-details__no-selection">Select a script to configure its parameters.</div>
              </template>
            </div>
          </v-card-text>
        </v-card>
        <div v-if="isPickingTarget" class="behavior-details__pick-overlay">
          <v-icon size="38" class="behavior-details__pick-icon">mdi-crosshairs-gps</v-icon>
          <div class="behavior-details__pick-text">
            Click a node in the scene to set this script's target.
            <span class="behavior-details__pick-hint">Right-click or press Esc to cancel.</span>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.behavior-details-panel-enter-active,
.behavior-details-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.behavior-details-panel-enter-from,
.behavior-details-panel-leave-to {
  opacity: 0;
  transform: translate(-105%, 10px);
}

.behavior-details-panel {
  position: fixed;
  top: 0;
  left: 0;
  transform: translateX(-100%);
  width: 720px;
  max-width: calc(100% - 48px);
  max-height: calc(100% - 200px);
  display: flex;
  flex-direction: column;
  z-index: 24;
}

.behavior-details-panel--picking {
  pointer-events: none;
}

.behavior-details {
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  position: relative;
  width: 100%;
}

.behavior-details__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  background-color: rgb(var(--v-theme-surface));
  margin: 4px;
}

.behavior-details__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.behavior-details__palette {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.6rem;
  border-radius: 6px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  background: rgba(10, 14, 20, 0.5);
}

.behavior-palette__item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  cursor: grab;
  background: rgba(255, 255, 255, 0.08);
  user-select: none;
  transition: background 120ms ease;
}

.behavior-palette__item:active {
  cursor: grabbing;
}

.behavior-palette__item:hover {
  background: rgba(255, 255, 255, 0.15);
}

.behavior-details__sequence {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.behavior-sequence {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-height: 60px;
  padding: 0.6rem;
  border-radius: 6px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  background: rgba(8, 12, 18, 0.55);
}

.behavior-sequence__item-group {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.behavior-sequence__item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.55rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  cursor: grab;
  user-select: none;
  transition: background 120ms ease, transform 120ms ease;
}

.behavior-sequence__item.is-selected {
  background: rgba(132, 202, 255, 0.28);
}

.behavior-sequence__item:active {
  cursor: grabbing;
  transform: scale(0.98);
}

.behavior-sequence__arrow {
  color: rgba(233, 236, 241, 0.6);
}

.behavior-sequence__drop-zone {
  width: 4px;
  height: 32px;
  border-radius: 3px;
  background: transparent;
  transition: background 120ms ease;
}

.behavior-sequence__drop-zone.is-active {
  background: rgba(132, 202, 255, 0.75);
}

.behavior-sequence__drop-zone.end {
  align-self: stretch;
}

.behavior-sequence__empty {
  color: rgba(233, 236, 241, 0.6);
  font-size: 0.85rem;
}

.behavior-details__params {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 12px;
  background: rgba(12, 16, 22, 0.55);
  min-height: 120px;
}

.behavior-details__no-selection,
.behavior-details__no-params {
  color: rgba(233, 236, 241, 0.68);
  font-size: 0.85rem;
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}

.toolbar-save {
  color: rgba(233, 236, 241, 0.82);
  font-weight: 500;
  text-transform: none;
}

.toolbar-save:disabled {
  color: rgba(233, 236, 241, 0.32) !important;
}

.material-title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.94);
}

.behavior-details :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

.behavior-details__pick-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px;
  min-height: 150px;
  max-width: calc(100% - 126px);
  background: linear-gradient(135deg, rgba(12, 16, 22, 0.85), rgba(20, 24, 32, 0.85));
  border-radius: 6px;
  border: 1px solid rgba(132, 202, 255, 0.4);
  color: rgba(233, 236, 241, 0.92);
  text-align: center;
  pointer-events: none;
}

.behavior-details__pick-icon {
  color: rgba(132, 202, 255, 0.85);
}

.behavior-details__pick-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.9rem;
}

.behavior-details__pick-hint {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}
</style>
