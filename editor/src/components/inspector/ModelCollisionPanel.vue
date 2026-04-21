<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { ModelCollisionDynamicMesh, SceneNodeComponentState } from '@schema'
import { useSceneStore } from '@/stores/sceneStore'
import { useBuildToolsStore } from '@/stores/buildToolsStore'
import {
  RIGIDBODY_COMPONENT_TYPE,
  clampRigidbodyComponentProps,
  type RigidbodyComponentProps,
} from '@schema/components'

const DEFAULT_THICKNESS = 0.05

const sceneStore = useSceneStore()
const buildToolsStore = useBuildToolsStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)
const { activeBuildTool } = storeToRefs(buildToolsStore)

const localDefaultThickness = ref(DEFAULT_THICKNESS)

const modelCollisionMesh = computed<ModelCollisionDynamicMesh | null>(() => readModelCollisionFromNode())

const rigidbodyComponent = computed(
  () => selectedNode.value?.components?.[RIGIDBODY_COMPONENT_TYPE] as SceneNodeComponentState<RigidbodyComponentProps> | undefined,
)

const isDrawActive = computed(() => activeBuildTool.value === 'modelCollision')
const faceCount = computed(() => Array.isArray(modelCollisionMesh.value?.faces) ? modelCollisionMesh.value!.faces.length : 0)

function readModelCollisionFromNode(): ModelCollisionDynamicMesh | null {
  const node = selectedNode.value
  if (!node) {
    return null
  }

  const userDataMesh = node.userData && typeof node.userData === 'object'
    ? (node.userData as Record<string, unknown>).modelCollision
    : null
  if (userDataMesh && typeof userDataMesh === 'object' && (userDataMesh as { type?: unknown }).type === 'ModelCollision') {
    return userDataMesh as ModelCollisionDynamicMesh
  }

  if (node.dynamicMesh?.type === 'ModelCollision') {
    return node.dynamicMesh as ModelCollisionDynamicMesh
  }

  return null
}

watch(
  modelCollisionMesh,
  (mesh) => {
    localDefaultThickness.value = typeof mesh?.defaultThickness === 'number' && Number.isFinite(mesh.defaultThickness)
      ? mesh.defaultThickness
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

function ensureMesh(): ModelCollisionDynamicMesh | null {
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return null
  }
  const current = readModelCollisionFromNode()
  if (current) {
    if (selectedNode.value?.dynamicMesh?.type === 'ModelCollision') {
      sceneStore.updateNodeDynamicMesh(nodeId, null)
    }
    return current
  }
  const nextMesh: ModelCollisionDynamicMesh = {
    type: 'ModelCollision',
    faces: [],
    defaultThickness: localDefaultThickness.value,
  }
  const nextUserData = {
    ...(selectedNode.value?.userData ?? {}),
    modelCollision: nextMesh,
  }
  sceneStore.updateNodeUserData(nodeId, nextUserData)
  return nextMesh
}

function applyDefaultThickness(): void {
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return
  }
  const mesh = ensureMesh()
  if (!mesh) {
    return
  }
  const thickness = Number.isFinite(localDefaultThickness.value)
    ? Math.max(0.01, localDefaultThickness.value)
    : DEFAULT_THICKNESS
  localDefaultThickness.value = thickness
  const nextMesh = {
    ...mesh,
    defaultThickness: thickness,
  }
  sceneStore.updateNodeUserData(nodeId, {
    ...(selectedNode.value?.userData ?? {}),
    modelCollision: nextMesh,
  })
}

function handleStartEdit(): void {
  ensureMesh()
  ensureStaticRigidbody()
  buildToolsStore.setActiveBuildTool('modelCollision')
}

function handleStopEdit(): void {
  if (activeBuildTool.value === 'modelCollision') {
    buildToolsStore.setActiveBuildTool(null)
  }
}

function handleClearFaces(): void {
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return
  }
  const nextMesh: ModelCollisionDynamicMesh = {
    type: 'ModelCollision',
    faces: [],
    defaultThickness: localDefaultThickness.value,
  }
  sceneStore.updateNodeUserData(nodeId, {
    ...(selectedNode.value?.userData ?? {}),
    modelCollision: nextMesh,
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