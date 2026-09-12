<script setup lang="ts">
import { computed } from 'vue'
import {
  COLLIDER_SHAPE_OPTIONS,
  type ColliderShapeKind,
} from '@/utils/rigidbodyColliderEdit'
import type { ColliderTransformMode } from './useRigidbodyColliderSceneEditor'

const props = defineProps<{
  visible: boolean
  nodeLabel: string
  colliderKind: ColliderShapeKind
  transformMode: ColliderTransformMode
  ready: boolean
  error: string | null
  dimensions: { x: number; y: number; z: number }
  offset: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
}>()

const emit = defineEmits<{
  (event: 'update:collider-kind', kind: ColliderShapeKind | null): void
  (event: 'update:transform-mode', mode: ColliderTransformMode): void
  (event: 'auto-fit'): void
  (event: 'save'): void
  (event: 'cancel'): void
}>()

const canTransform = computed(() => props.colliderKind !== 'convex')
const canRotate = computed(() => canTransform.value && props.colliderKind !== 'sphere')

function selectTransformMode(mode: ColliderTransformMode): void {
  if (!canTransform.value) {
    return
  }
  if (mode === 'rotate' && !canRotate.value) {
    return
  }
  emit('update:transform-mode', mode)
}
</script>

<template>
  <v-card
    v-if="visible"
    class="rigidbody-collider-scene-editor"
    elevation="10"
  >
    <v-toolbar density="compact" height="38px" class="rigidbody-collider-scene-editor__toolbar">
      <div class="rigidbody-collider-scene-editor__title">
        Collider Edit · {{ nodeLabel }}
      </div>
      <v-spacer />
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        title="Cancel collider editing"
        @click="emit('cancel')"
      />
    </v-toolbar>

    <v-divider />

    <div class="rigidbody-collider-scene-editor__body">
      <div class="rigidbody-collider-scene-editor__controls">
        <v-select
          label="Collider Shape"
          density="compact"
          variant="outlined"
          hide-details
          :items="COLLIDER_SHAPE_OPTIONS"
          item-title="label"
          item-value="value"
          :model-value="colliderKind"
          :disabled="!ready"
          @update:modelValue="(value: ColliderShapeKind | null) => emit('update:collider-kind', value)"
        />
        <div class="rigidbody-collider-scene-editor__mode-buttons">
          <v-btn
            size="small"
            icon
            variant="tonal"
            :color="canTransform && transformMode === 'translate' ? 'primary' : undefined"
            :disabled="!ready || !canTransform"
            title="Move"
            aria-label="Move"
            @click="selectTransformMode('translate')"
          >
            <v-icon icon="mdi-axis-arrow" />
          </v-btn>
          <v-btn
            size="small"
            icon
            variant="tonal"
            :color="canRotate && transformMode === 'rotate' ? 'primary' : undefined"
            :disabled="!ready || !canRotate"
            title="Rotate"
            aria-label="Rotate"
            @click="selectTransformMode('rotate')"
          >
            <v-icon icon="mdi-rotate-3d-variant" />
          </v-btn>
          <v-btn
            size="small"
            icon
            variant="tonal"
            :color="canTransform && transformMode === 'scale' ? 'primary' : undefined"
            :disabled="!ready || !canTransform"
            title="Scale"
            aria-label="Scale"
            @click="selectTransformMode('scale')"
          >
            <v-icon icon="mdi-crop" />
          </v-btn>
          <v-btn
            size="small"
            icon
            variant="tonal"
            :disabled="!ready"
            title="Auto-fit"
            aria-label="Auto-fit"
            @click="emit('auto-fit')"
          >
            <v-icon icon="mdi-aspect-ratio" />
          </v-btn>
        </div>
      </div>

      <div v-if="error" class="rigidbody-collider-scene-editor__error">
        {{ error }}
      </div>
      <template v-else-if="ready">
        <div class="rigidbody-collider-scene-editor__stats-row">
          <span>Size</span>
          <span>{{ dimensions.x.toFixed(2) }} × {{ dimensions.y.toFixed(2) }} × {{ dimensions.z.toFixed(2) }} m</span>
        </div>
        <div class="rigidbody-collider-scene-editor__stats-row">
          <span>Offset</span>
          <span>{{ offset.x.toFixed(2) }}, {{ offset.y.toFixed(2) }}, {{ offset.z.toFixed(2) }} m</span>
        </div>
        <div class="rigidbody-collider-scene-editor__stats-row">
          <span>Rotation</span>
          <span>{{ rotation.x.toFixed(1) }}°, {{ rotation.y.toFixed(1) }}°, {{ rotation.z.toFixed(1) }}°</span>
        </div>
      </template>
      <div v-else class="rigidbody-collider-scene-editor__hint">
        Preparing collider preview…
      </div>
    </div>

    <v-divider />

    <div class="rigidbody-collider-scene-editor__actions">
      <v-btn variant="text" @click="emit('cancel')">
        Cancel
      </v-btn>
      <v-btn color="primary" :disabled="!ready || Boolean(error)" @click="emit('save')">
        Save Collider
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.rigidbody-collider-scene-editor {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 292px;
  z-index: 12;
  overflow: hidden;
  border: 1px solid rgba(77, 208, 225, 0.35);
  background: rgba(16, 19, 25, 0.94);
  backdrop-filter: blur(12px);
}

.rigidbody-collider-scene-editor__toolbar {
  background: rgba(22, 28, 37, 0.95);
}

.rigidbody-collider-scene-editor__title {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.94);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rigidbody-collider-scene-editor__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.rigidbody-collider-scene-editor__controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rigidbody-collider-scene-editor__mode-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.rigidbody-collider-scene-editor__note {
  font-size: 0.72rem;
  line-height: 1.35;
  color: rgba(255, 213, 128, 0.92);
}

.rigidbody-collider-scene-editor__stats-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.74rem;
  color: rgba(233, 236, 241, 0.68);
}

.rigidbody-collider-scene-editor__stats-row > span:last-child {
  color: rgba(233, 236, 241, 0.94);
  font-variant-numeric: tabular-nums;
}

.rigidbody-collider-scene-editor__error {
  font-size: 0.75rem;
  color: rgb(255, 138, 128);
}

.rigidbody-collider-scene-editor__hint {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.62);
}

.rigidbody-collider-scene-editor__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 10px;
}
</style>
