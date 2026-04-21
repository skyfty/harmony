<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema'
import {
  MODEL_COLLISION_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  clampRigidbodyComponentProps,
  resolveModelCollisionComponentPropsFromNode,
  type ModelCollisionComponentProps,
  type RigidbodyComponentProps,
} from '@schema/components'
import { useSceneStore } from '@/stores/sceneStore'
import { useBuildToolsStore } from '@/stores/buildToolsStore'

const DEFAULT_THICKNESS = 0.05

const sceneStore = useSceneStore()
const buildToolsStore = useBuildToolsStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)
const { activeBuildTool } = storeToRefs(buildToolsStore)

const localDefaultThickness = ref(DEFAULT_THICKNESS)

const modelCollisionComponent = computed(
  () => selectedNode.value?.components?.[MODEL_COLLISION_COMPONENT_TYPE] as
    | SceneNodeComponentState<ModelCollisionComponentProps>
    | undefined,
)

const rigidbodyComponent = computed(
  () => selectedNode.value?.components?.[RIGIDBODY_COMPONENT_TYPE] as SceneNodeComponentState<RigidbodyComponentProps> | undefined,
)

const modelCollisionProps = computed<ModelCollisionComponentProps | null>(() => {
  return resolveModelCollisionComponentPropsFromNode(selectedNode.value) ?? null
})

const isDrawActive = computed(() => activeBuildTool.value === 'modelCollision')
const faceCount = computed(() => Array.isArray(modelCollisionProps.value?.faces) ? modelCollisionProps.value!.faces.length : 0)

watch(
  modelCollisionProps,
  (props) => {
    localDefaultThickness.value = typeof props?.defaultThickness === 'number' && Number.isFinite(props.defaultThickness)
      ? props.defaultThickness
      : DEFAULT_THICKNESS
  },
  { immediate: true },
)

function ensureStaticRigidbody(): void {
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return
  }
  const existing = rigidbodyComponent.value
  if (existing) {
    return
  }
  const result = sceneStore.addNodeComponent<typeof RIGIDBODY_COMPONENT_TYPE>(nodeId, RIGIDBODY_COMPONENT_TYPE)
  if (!result) {
    return
  }
  const patch = clampRigidbodyComponentProps({
    ...result.component.props,
    bodyType: 'STATIC',
    targetNodeId: nodeId,
  })
  sceneStore.updateNodeComponentProps(nodeId, result.component.id, patch as unknown as Partial<Record<string, unknown>>)
}

function ensureModelCollisionComponent(): SceneNodeComponentState<ModelCollisionComponentProps> | null {
  const node = selectedNode.value
  const nodeId = selectedNodeId.value
  if (!node || !nodeId) {
    return null
  }
  const existing = modelCollisionComponent.value
  if (existing) {
    return existing
  }
  const result = sceneStore.addNodeComponent<typeof MODEL_COLLISION_COMPONENT_TYPE>(nodeId, MODEL_COLLISION_COMPONENT_TYPE)
  if (!result) {
    return null
  }
  return result.component as unknown as SceneNodeComponentState<ModelCollisionComponentProps>
}

function syncLegacyRuntimeData(props: ModelCollisionComponentProps): void {
  const node = selectedNode.value
  const nodeId = selectedNodeId.value
  if (!node || !nodeId) {
    return
  }
  sceneStore.updateNodeUserData(nodeId, {
    ...(node.userData ?? {}),
    modelCollision: {
      type: 'ModelCollision',
      defaultThickness: typeof props.defaultThickness === 'number' && Number.isFinite(props.defaultThickness)
        ? props.defaultThickness
        : DEFAULT_THICKNESS,
      faces: props.faces.map((face) => ({
        id: face.id,
        thickness: face.thickness,
        vertices: face.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z })),
      })),
    },
  })
}

function updateComponent(patch: Partial<ModelCollisionComponentProps>): void {
  const component = ensureModelCollisionComponent()
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const nextProps = {
    ...component.props,
    ...patch,
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, nextProps)
  syncLegacyRuntimeData(nextProps)
}

function handleStartEdit(): void {
  const component = ensureModelCollisionComponent()
  if (!component) {
    return
  }
  syncLegacyRuntimeData(component.props)
  ensureStaticRigidbody()
  buildToolsStore.setActiveBuildTool('modelCollision')
}

function handleStopEdit(): void {
  if (activeBuildTool.value === 'modelCollision') {
    buildToolsStore.setActiveBuildTool(null)
  }
}

function applyDefaultThickness(): void {
  const thickness = Number.isFinite(localDefaultThickness.value)
    ? Math.max(0.01, localDefaultThickness.value)
    : DEFAULT_THICKNESS
  localDefaultThickness.value = thickness
  updateComponent({ defaultThickness: thickness })
}

function handleClearFaces(): void {
  updateComponent({
    faces: [],
    defaultThickness: localDefaultThickness.value,
  })
  if (activeBuildTool.value === 'modelCollision') {
    buildToolsStore.setActiveBuildTool(null)
  }
}
</script>

<template>
  <v-expansion-panel value="modelCollision">
    <v-expansion-panel-title>
      <div class="model-collision-panel-header">
        <span class="model-collision-panel-title">Model Collision Faces</span>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="model-collision-settings">
        <v-text-field
          v-model.number="localDefaultThickness"
          label="Default Thickness (m)"
          type="number"
          density="comfortable"
          variant="underlined"
          min="0.01"
          step="0.01"
          @blur="applyDefaultThickness"
          @keydown.enter.prevent="applyDefaultThickness"
        />
        <div class="model-collision-stats">
          <span>Faces: {{ faceCount }}</span>
          <span>Rigidbody: {{ rigidbodyComponent ? 'enabled' : 'auto-add on edit' }}</span>
        </div>
        <div class="model-collision-actions">
          <v-btn
            size="small"
            color="primary"
            variant="flat"
            @click="handleStartEdit"
          >
            {{ isDrawActive ? 'Editing...' : 'Edit Faces' }}
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            :disabled="!isDrawActive"
            @click="handleStopEdit"
          >
            Stop
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :disabled="faceCount === 0"
            @click="handleClearFaces"
          >
            Clear Faces
          </v-btn>
        </div>
        <p class="model-collision-hint">
          左键按模型表面逐点描面，双击结束当前面。已保存的半透明面仅在编辑器中显示。
        </p>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.model-collision-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-collision-stats {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}

.model-collision-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.model-collision-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.68);
}
</style>