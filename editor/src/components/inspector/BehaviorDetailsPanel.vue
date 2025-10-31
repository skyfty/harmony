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

watch(
  () => props.actions,
  (actions) => {
    if (!actions?.length) {
      return
    }
    if (!actions.find((entry) => entry.id === localBehavior.action)) {
      const first = actions[0]
      if (first) {
        localBehavior.action = first.id
      }
    }
  },
  { immediate: true, deep: true },
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
          @click="handleSave"
        >
          <v-icon size="16px">mdi-content-save</v-icon>
        </v-btn>
        <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="closePanel" />
      </v-toolbar>
      <v-divider />
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
    </v-card>
  </v-dialog>
</template>

<style scoped>
.behavior-details {
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
}

.behavior-details__title {
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.94);
}

.behavior-details__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  background-color: rgb(var(--v-theme-surface));
  margin: 4px;
}

.behavior-details__field {
  display: flex;
  flex-direction: column;
}

.behavior-details__params {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 8px;
  background: rgba(12, 16, 22, 0.55);
}

.behavior-details__actions {
  padding-inline: 1rem;
  padding-block: 0.5rem;
}

/* Unify input label styles with material panel */
.behavior-details :deep(.v-field-label) {
  font-size: 0.82rem;
  font-weight: 600;
}

/* Toolbar styles aligned with MaterialDetailsPanel */
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
</style>
