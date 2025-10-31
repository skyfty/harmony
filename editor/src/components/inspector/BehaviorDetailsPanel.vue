<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type {
  BehaviorActionType,
  BehaviorScriptType,
  SceneBehavior,
  SceneBehaviorScriptBinding,
  ShowAlertBehaviorParams,
} from '@harmony/schema'
import type { BehaviorActionDefinition, BehaviorScriptDefinition } from '@schema/behaviors/definitions'
import {
  cloneBehavior,
  createBehaviorTemplate,
  findBehaviorScript,
} from '@schema/behaviors/definitions'
import ShowAlertParams from '@/components/inspector/behavior/ShowAlertParams.vue'

type PanelMode = 'create' | 'edit'

const props = defineProps<{
  visible: boolean
  mode: PanelMode
  behavior: SceneBehavior | null
  actions: BehaviorActionDefinition[]
  scripts: BehaviorScriptDefinition[]
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'save', behavior: SceneBehavior): void
}>()

const localBehavior = reactive<SceneBehavior>(createBehaviorTemplate('click', 'showAlert'))

const PARAMETER_COMPONENTS: Partial<Record<BehaviorScriptType, unknown>> = {
  showAlert: ShowAlertParams,
}

function resetToTemplate(): void {
  const template = props.behavior ? cloneBehavior(props.behavior) : createBehaviorTemplate('click', 'showAlert')
  localBehavior.id = template.id
  localBehavior.name = template.name
  localBehavior.action = template.action
  localBehavior.script.type = template.script.type
  localBehavior.script.params = structuredClone(template.script.params) as SceneBehaviorScriptBinding['params']
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      resetToTemplate()
    }
  },
  { immediate: true },
)

watch(
  () => props.behavior,
  (behavior) => {
    if (props.visible) {
      const template = behavior ? cloneBehavior(behavior) : createBehaviorTemplate('click', 'showAlert')
      localBehavior.id = template.id
      localBehavior.name = template.name
      localBehavior.action = template.action
      localBehavior.script.type = template.script.type
      localBehavior.script.params = structuredClone(template.script.params) as SceneBehaviorScriptBinding['params']
    }
  },
  { deep: true },
)

const selectedAction = computed<BehaviorActionType>({
  get() {
    return localBehavior.action
  },
  set(value) {
    localBehavior.action = value
  },
})

const selectedScript = computed<BehaviorScriptType>({
  get() {
    return localBehavior.script.type
  },
  set(value) {
    if (localBehavior.script.type === value) {
      return
    }
    const definition = findBehaviorScript<ShowAlertBehaviorParams>(value)
    localBehavior.script.type = value
    localBehavior.script.params = definition
      ? definition.createDefaultParams()
      : { title: '', message: '' }
  },
})

const parameterComponent = computed(() => PARAMETER_COMPONENTS[selectedScript.value] ?? null)

function handleParamsUpdate(value: ShowAlertBehaviorParams) {
  localBehavior.script.params = value
}

function closePanel() {
  emit('close')
}

function handleSave() {
  emit('save', cloneBehavior(localBehavior))
}

const dialogTitle = computed(() => (props.mode === 'create' ? 'Add Behavior' : 'Edit Behavior'))
</script>

<template>
  <v-dialog :model-value="visible" max-width="520" @update:modelValue="closePanel">
    <v-card class="behavior-details">
      <v-card-title class="behavior-details__title">
        {{ dialogTitle }}
      </v-card-title>
      <v-card-text class="behavior-details__body">
        <div class="behavior-details__field">
          <v-text-field
            v-model="localBehavior.name"
            label="Behavior Name"
            density="compact"
            variant="underlined"
            hide-details
          />
        </div>
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
        <div class="behavior-details__field">
          <v-select
            v-model="selectedScript"
            :items="scripts"
            item-title="label"
            item-value="id"
            label="Script"
            density="compact"
            variant="underlined"
            hide-details
          />
        </div>
        <div class="behavior-details__params" v-if="parameterComponent">
          <component
            :is="parameterComponent"
            :model-value="localBehavior.script.params"
            @update:modelValue="handleParamsUpdate"
          />
        </div>
      </v-card-text>
      <v-divider />
      <v-card-actions class="behavior-details__actions">
        <v-spacer />
        <v-btn variant="text" @click="closePanel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="handleSave">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.behavior-details__title {
  font-weight: 600;
}

.behavior-details__body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.behavior-details__field {
  display: flex;
  flex-direction: column;
}

.behavior-details__params {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 0.75rem;
  background-color: rgba(33, 38, 45, 0.45);
}

.behavior-details__actions {
  padding-inline: 1rem;
  padding-block: 0.5rem;
}
</style>
