<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSceneStore } from '@/stores/sceneStore'
import * as THREE from 'three'
import { applyGroundGeneration, createGroundMesh } from '@schema/groundMesh'
import type { GroundDynamicMesh, GroundGenerationSettings, GroundRuntimeDynamicMesh } from '@schema'
import {
  DEFAULT_RIGIDBODY_FRICTION,
  DEFAULT_RIGIDBODY_RESTITUTION,
  NOMINATE_COMPONENT_TYPE,
  ONLINE_COMPONENT_TYPE,
} from '@schema/components'
import { GROUND_NODE_ID, MULTIUSER_NODE_ID, type SceneNode, type Vector3Like } from '@schema'
import { resolveGroundCreationProfile } from '@/stores/groundUtils'

const sceneStore = useSceneStore()

const tempGroupCameraPosition = new THREE.Vector3()
const tempGroupCameraTarget = new THREE.Vector3()
const tempGroupDirection = new THREE.Vector3()
const tempGroupSpawn = new THREE.Vector3()

const GROUP_SPAWN_DISTANCE = 6



function collectGroupIndices(nodes: SceneNode[] | undefined, used: Set<number>) {
  if (!nodes?.length) {
    return
  }
  nodes.forEach((node) => {
    const name = node.name?.trim()
    if (name) {
      const match = /^Group(?:\s+(\d+))?$/i.exec(name)
      if (match) {
        const index = match[1] ? Number.parseInt(match[1], 10) : 1
        if (Number.isFinite(index)) {
          used.add(index)
        }
      }
    }
    if (node.children?.length) {
      collectGroupIndices(node.children, used)
    }
  })
}

function getNextGroupName(): string {
  const usedIndices = new Set<number>()
  collectGroupIndices(sceneStore.nodes, usedIndices)
  let candidate = 1
  while (usedIndices.has(candidate)) {
    candidate += 1
  }
  return `Group ${candidate}`
}

function resolveEffectiveParentId(input: SceneNode | string | null | undefined): string | null {
  if (!input) {
    return null
  }

  let targetNode: SceneNode | null = null
  let parentNode: SceneNode | null = null

  if (typeof input === 'string') {
    const located = findNodeWithParent(sceneStore.nodes, input)
    targetNode = located?.node ?? null
    parentNode = located?.parent ?? null
  } else {
    targetNode = input
    const located = findNodeWithParent(sceneStore.nodes, input.id)
    parentNode = located?.parent ?? null
  }

  if (!targetNode) {
    return null
  }

  const isPlaceholder = (targetNode as { isPlaceholder?: boolean }).isPlaceholder
  if (isPlaceholder) {
    return null
  }

  if (sceneStore.nodeAllowsChildCreation(targetNode.id)) {
    return targetNode.id
  }

  if (!parentNode) {
    return null
  }

  const parentPlaceholder = (parentNode as { isPlaceholder?: boolean }).isPlaceholder
  if (parentPlaceholder) {
    return null
  }

  return sceneStore.nodeAllowsChildCreation(parentNode.id) ? parentNode.id : null
}

function handleAddGroup() {
  const groupName = getNextGroupName()
  const group = new THREE.Group()
  group.name = groupName
  const selectedNode = sceneStore.selectedNode
  const parentId = resolveEffectiveParentId(selectedNode ?? null)
  const spawnPosition = computeGroupSpawnPosition(parentId)
  sceneStore.captureHistorySnapshot()
  sceneStore.addSceneNode({
    nodeType: 'Group',
    object: group,
    name: groupName,
    ...(spawnPosition ? { position: spawnPosition } : {}),
    parentId: parentId ?? undefined,
  })
}

function computeGroupSpawnPosition(parentId: string | null): Vector3Like | null {
  if (parentId) {
    return { x: 0, y: 0, z: 0 }
  }
  const camera = sceneStore.camera
  if (!camera) {
    return null
  }

  tempGroupCameraPosition.set(camera.position.x, camera.position.y, camera.position.z)
  tempGroupCameraTarget.set(camera.target.x, camera.target.y, camera.target.z)

  if (camera.forward) {
    tempGroupDirection.set(camera.forward.x, camera.forward.y, camera.forward.z)
  } else {
    tempGroupDirection.copy(tempGroupCameraTarget).sub(tempGroupCameraPosition)
  }

  if (tempGroupDirection.lengthSq() < 1e-6) {
    tempGroupDirection.set(0, 0, -1)
  }

  if (Math.abs(tempGroupDirection.y) > 0.95) {
    tempGroupDirection.y = 0
    if (tempGroupDirection.lengthSq() < 1e-6) {
      tempGroupDirection.set(0, 0, -1)
    }
  }

  tempGroupDirection.normalize()
  tempGroupSpawn.copy(tempGroupCameraPosition).addScaledVector(tempGroupDirection, GROUP_SPAWN_DISTANCE)
  tempGroupSpawn.y = tempGroupCameraTarget.y

  return {
    x: tempGroupSpawn.x,
    y: tempGroupSpawn.y,
    z: tempGroupSpawn.z,
  }
}

function collectNodeNames(nodes: SceneNode[] | undefined, bucket: Set<string>) {
  if (!nodes?.length) {
    return
  }
  nodes.forEach((node) => {
    if (node.name) {
      bucket.add(node.name)
    }
    if (node.children?.length) {
      collectNodeNames(node.children, bucket)
    }
  })
}



function getNextNominateName(): string {
  const names = new Set<string>()
  collectNodeNames(sceneStore.nodes, names)
  const base = 'Nominate'
  if (!names.has(base)) {
    return base
  }
  let index = 1
  while (names.has(`${base} ${index}`)) {
    index += 1
  }
  return `${base} ${index}`
}


function findNodeWithParent(
  nodes: SceneNode[] | undefined,
  nodeId: string,
  parent: SceneNode | null = null,
): { node: SceneNode; parent: SceneNode | null } | null {
  if (!nodes?.length) {
    return null
  }
  for (const candidate of nodes) {
    if (!candidate) {
      continue
    }
    if (candidate.id === nodeId) {
      return { node: candidate, parent }
    }
    if (candidate.children?.length) {
      const nested = findNodeWithParent(candidate.children, nodeId, candidate)
      if (nested) {
        return nested
      }
    }
  }
  return null
}


function handleCreateNominateNode() {
  const nominateObject = new THREE.Object3D()
  const name = getNextNominateName()
  nominateObject.name = name
  const parentId = resolveEffectiveParentId(sceneStore.selectedNode ?? null)
  sceneStore.captureHistorySnapshot()
  const created = sceneStore.addSceneNode({
    nodeType: 'Empty',
    object: nominateObject,
    name,
    parentId: parentId ?? undefined,
  })
  if (!created) {
    return
  }
  sceneStore.addNodeComponent<typeof NOMINATE_COMPONENT_TYPE>(created.id, NOMINATE_COMPONENT_TYPE)
}




const groundDialogOpen = ref(false)

type GroundPreset = {
  id: string
  name: string
  description: string
  width: number
  depth: number
  generation: GroundGenerationSettings
  physics: {
    friction: number
    restitution: number
  }
}

const groundPresets: [GroundPreset, ...GroundPreset[]] = [
  {
    id: 'flat',
    name: 'Empty Ground',
    description: '平整基础场景，适合自定义雕刻',
    width: 100,
    depth: 100,
    generation: {
      mode: 'flat',
      noiseScale: 80,
      noiseAmplitude: 0,
      edgeFalloff: 1,
    },
    physics: {
      friction: 0.65,
      restitution: 0.05,
    },
  },
  {
    id: 'rolling',
    name: 'Rolling Hills',
    description: '柔和起伏的丘陵，用于自然环境',
    width: 160,
    depth: 160,
    generation: {
      mode: 'perlin',
      seed: 2401,
      noiseScale: 120,
      noiseAmplitude: 6,
      detailScale: 28,
      detailAmplitude: 2,
      edgeFalloff: 1.4,
    },
    physics: {
      friction: 0.55,
      restitution: 0.08,
    },
  },
  {
    id: 'mountain',
    name: 'Highlands',
    description: '陡峭的山脊和峡谷，营造戏剧性景观',
    width: 200,
    depth: 200,
    generation: {
      mode: 'perlin',
      seed: 913,
      noiseScale: 70,
      noiseAmplitude: 14,
      detailScale: 18,
      detailAmplitude: 4,
      edgeFalloff: 2.2,
    },
    physics: {
      friction: 0.45,
      restitution: 0.12,
    },
  },
]

const DEFAULT_GROUND_PRESET_ID = groundPresets[0].id
const selectedGroundPresetId = ref<string>(DEFAULT_GROUND_PRESET_ID)
const groundWidth = ref(groundPresets[0].width)
const groundDepth = ref(groundPresets[0].depth)

const MIN_GROUND_SIZE = 10

const selectedGroundPreset = computed(() => {
  return groundPresets.find((preset) => preset.id === selectedGroundPresetId.value) ?? groundPresets[0]
})

const groundCreationProfile = computed(() => {
  return resolveGroundCreationProfile(groundWidth.value, groundDepth.value)
})

const groundCreationWarning = computed(() => groundCreationProfile.value.warningMessage)

watch(selectedGroundPresetId, (presetId) => {
  const preset = groundPresets.find((entry) => entry.id === presetId)
  if (preset) {
    groundWidth.value = preset.width
    groundDepth.value = preset.depth
  }
})

function clampGroundDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  const rounded = Math.round(Math.abs(value))
  return Math.max(MIN_GROUND_SIZE, rounded)
}

function resetGroundDialogState() {
  selectedGroundPresetId.value = DEFAULT_GROUND_PRESET_ID
  groundWidth.value = groundPresets[0].width
  groundDepth.value = groundPresets[0].depth
}

const canAddGround = computed(() => {
  return !sceneStore.nodes.some(n => n.dynamicMesh?.type === 'Ground')
})


function hasOnlineComponentNode(nodes: SceneNode[] | null | undefined): boolean {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return false
  }
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.components?.[ONLINE_COMPONENT_TYPE]) {
      return true
    }
    if (node.children?.length) {
      stack.push(...node.children)
    }
  }
  return false
}

function findSceneNodeById(nodes: SceneNode[] | null | undefined, targetId: string): SceneNode | null {
  if (!Array.isArray(nodes) || !nodes.length || !targetId.length) {
    return null
  }
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.id === targetId) {
      return node
    }
    if (node.children?.length) {
      stack.push(...node.children)
    }
  }
  return null
}

const hasMultiuserNode = computed(() => Boolean(findSceneNodeById(sceneStore.nodes, MULTIUSER_NODE_ID)))
const canAddMultiuser = computed(
  () => !hasOnlineComponentNode(sceneStore.nodes) && !hasMultiuserNode.value,
)



async function handleCreateMultiuserNode(): Promise<void> {
  if (!canAddMultiuser.value) {
    return
  }
  const name = 'Multiuser'
  const helperObject = new THREE.Object3D()
  helperObject.name = name
  helperObject.userData = {
    ...(helperObject.userData ?? {}),
    editorOnly: true,
    ignoreGridSnapping: true,
    multiuser: true,
  }

  const created = await sceneStore.addModelNode({
    nodeId: MULTIUSER_NODE_ID,
    object: helperObject,
    nodeType: 'Empty',
    name,
    baseY: 0,
    position: new THREE.Vector3(0, 0, 0),
    parentId: undefined,
    snapToGrid: false,
    editorFlags: {
      editorOnly: true,
      ignoreGridSnapping: true,
    },
  })

  if (!created) {
    return
  }

  const result = sceneStore.addNodeComponent<typeof ONLINE_COMPONENT_TYPE>(created.id, ONLINE_COMPONENT_TYPE)
  if (result?.component && result.created) {
    sceneStore.updateNodeComponentProps(created.id, result.component.id, {
      enabled: true,
      maxUsers: 10,
      syncInterval: 100,
      server: 'ws://localhost',
      port: 7645,
    })
  }

  sceneStore.selectNode(created.id)
}

function handleAddGround() {
  if (!canAddGround.value) return
  resetGroundDialogState()
  groundDialogOpen.value = true
}

async function handleConfirmGround() {
  if (!canAddGround.value) {
    groundDialogOpen.value = false
    return
  }
  groundDialogOpen.value = false
  const preset = selectedGroundPreset.value
  const width = clampGroundDimension(groundWidth.value, preset?.width ?? 100)
  const depth = clampGroundDimension(groundDepth.value, preset?.depth ?? 100)
  const creationProfile = resolveGroundCreationProfile(width, depth)
  const targetFriction = Math.min(1, Math.max(0, preset?.physics?.friction ?? DEFAULT_RIGIDBODY_FRICTION))
  const targetRestitution = Math.min(1, Math.max(0, preset?.physics?.restitution ?? DEFAULT_RIGIDBODY_RESTITUTION))
  const cellSize = creationProfile.cellSize
  const rows = Math.max(1, Math.ceil(depth / cellSize))
  const columns = Math.max(1, Math.ceil(width / cellSize))

  const definition: GroundDynamicMesh = {
    type: 'Ground',
    width,
    depth,
    rows,
    columns,
    cellSize,
    storageMode: creationProfile.storageMode,
    tileSizeMeters: creationProfile.tileSizeMeters,
    tileResolution: creationProfile.tileResolution,
    globalLodCellSize: creationProfile.globalLodCellSize,
    activeEditWindowRadius: creationProfile.activeEditWindowRadius,
    editTileSizeMeters: creationProfile.editTileSizeMeters,
    editTileResolution: creationProfile.editTileResolution,
    collisionMode: creationProfile.collisionMode,
    chunkStreamingEnabled: creationProfile.storageMode === 'tiled',
    heightComposition: { mode: 'planning_plus_manual' },
    planningMetadata: null,
    terrainScatterInstancesUpdatedAt: Date.now(),
    generation: preset?.generation ? { ...preset.generation } : { mode: 'flat', noiseScale: 80, noiseAmplitude: 0 },
  }

  if (definition.generation) {
    definition.generation.worldWidth = width
    definition.generation.worldDepth = depth
    applyGroundGeneration(definition as GroundRuntimeDynamicMesh, definition.generation)
  }

  const mesh = createGroundMesh(definition)
  mesh.name = 'Ground'

  const created = await sceneStore.addModelNode({
    nodeId: GROUND_NODE_ID,
    object: mesh,
    nodeType: 'Mesh',
    name: 'Ground',
    position: new THREE.Vector3(0, 0, 0),
    baseY: 0
  })

  if (created) {
    const rigidbodyComponent = sceneStore.ensureStaticRigidbodyComponent(created.id)
    sceneStore.updateGroundNodeDynamicMesh(created.id, definition)
    sceneStore.setNodeSelectionLock(created.id, true)
    sceneStore.selectNode(created.id)
    if (rigidbodyComponent) {
      sceneStore.updateNodeComponentProps(created.id, rigidbodyComponent.id, {
        friction: targetFriction,
        restitution: targetRestitution,
      })
    }
  }
}

function handleAddLight(type: string) {
  sceneStore.addLightNode(type as any)
}

</script>

<template>
  <v-menu  transition="none">
    <template #activator="{ props }">
      <slot name="activator" :props="props">
        <v-btn icon="mdi-plus" variant="text" density="compact" v-bind="props" />
      </slot>
    </template>
    <v-list class="add-menu-list">
      <v-list-item title="Group" @click="handleAddGroup()" />
      <v-list-item title="Nominate" @click="handleCreateNominateNode()" />
      <v-list-item title="Multiuser" @click="handleCreateMultiuserNode()" :disabled="!canAddMultiuser" />
      <v-list-item
        title="Ground"
        @click="handleAddGround()"
        :disabled="!canAddGround"
      />
      <v-menu  transition="none" location="end" offset="8">
        <template #activator="{ props: lightMenuProps }">
          <v-list-item title="Light" append-icon="mdi-chevron-right" v-bind="lightMenuProps" />
        </template>
        <v-list class="add-submenu-list">
          <v-list-item title="Ambient Light" @click="handleAddLight('Ambient')" />
          <v-list-item title="Directional Light" @click="handleAddLight('Directional')" />
          <v-list-item title="Point Light" @click="handleAddLight('Point')" />
          <v-list-item title="Spot Light" @click="handleAddLight('Spot')" />
          <v-list-item title="Hemisphere Light" @click="handleAddLight('Hemisphere')" />
          <!-- RectArea Light removed -->
        </v-list>
      </v-menu>
    </v-list>
  </v-menu>
  <v-dialog v-model="groundDialogOpen" max-width="520">
    <v-card title="Ground">
      <v-card-text class="ground-dialog-body">
        <div class="ground-dialog-section">
          <div class="ground-dialog-label">选择地面预设</div>
          <v-item-group v-model="selectedGroundPresetId" class="ground-preset-group">
            <v-item
              v-for="preset in groundPresets"
              :key="preset.id"
              :value="preset.id"
              v-slot="{ isSelected, toggle }"
            >
              <v-card
                flat
                border
                class="ground-preset-card"
                :class="{ 'ground-preset-card--selected': isSelected }"
                @click="toggle"
              >
                <div class="ground-preset-card__header">
                  <span class="ground-preset-card__title">{{ preset.name }}</span>
                  <v-icon
                    v-if="isSelected"
                    icon="mdi-check-circle"
                    size="18"
                    color="primary"
                  />
                </div>
                <div class="ground-preset-card__meta">{{ preset.width }}m × {{ preset.depth }}m</div>
                <div class="ground-preset-card__desc">{{ preset.description }}</div>
              </v-card>
            </v-item>
          </v-item-group>
        </div>
        <v-alert
          v-if="groundCreationWarning"
          :type="groundCreationProfile.warningLevel === 'severe' ? 'warning' : 'info'"
          variant="tonal"
          density="compact"
          class="ground-dialog-hint"
        >
          {{ groundCreationWarning }}
          <span v-if="groundCreationProfile.storageMode === 'tiled'">
            推荐显示单元尺寸：{{ groundCreationProfile.cellSize }}m，局部编辑精度约 {{ groundCreationProfile.editCellSize.toFixed(2) }}m，预计瓦片数：{{ groundCreationProfile.estimatedTileCount }}。
          </span>
        </v-alert>
        <v-divider class="ground-dialog-divider" />
        <div class="ground-dialog-section">
          <div class="ground-dialog-label">尺寸（米）</div>
          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model.number="groundWidth"
                label="宽度"
                type="number"
                min="10"
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model.number="groundDepth"
                label="深度"
                type="number"
                min="10"
              />
            </v-col>
          </v-row>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn text="Cancel" @click="groundDialogOpen = false" />
        <v-btn color="primary" text="Create" @click="handleConfirmGround" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.add-menu-list {
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.add-menu-list :deep(.v-list-item) {
  min-height: 26px;
  border-radius: 8px;
  padding-inline: 12px;
  transition: background-color 160ms ease;
}

.add-menu-list :deep(.v-list-item:hover) {
  background-color: rgba(255, 255, 255, 0.08);
}

.add-menu-divider {
  align-self: stretch;
  margin: 4px 0;
  opacity: 0.2;
}

.add-submenu-list {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.add-submenu-list :deep(.v-list-item) {
  min-height: 26px;
  border-radius: 8px;
  padding-inline: 12px;
}

.ground-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ground-dialog-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ground-dialog-label {
  font-size: 0.85rem;
  opacity: 0.8;
}

.ground-preset-group {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 6px;
}
.ground-preset-group :deep(.v-item) {
  height: 100%;
}
.ground-preset-card {
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  border-color: rgba(255, 255, 255, 0.16) !important;
  transition: border-color 160ms ease, background-color 160ms ease;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.ground-preset-card {
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  border-color: rgba(255, 255, 255, 0.16) !important;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.ground-preset-card--selected {
  border-color: rgb(120, 174, 255) !important;
  background-color: rgba(112, 162, 255, 0.12);
}

.ground-preset-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.ground-preset-card__title {
  font-weight: 600;
}

.ground-preset-card__meta {
  font-size: 0.78rem;
  opacity: 0.75;
  margin-bottom: 4px;
}

.ground-preset-card__desc {
  font-size: 0.82rem;
  opacity: 0.85;
}

.ground-dialog-divider {
  opacity: 0.15;
}

.ground-dialog-hint {
  font-size: 0.78rem;
  opacity: 0.65;
  margin: 2px 0 0;
}
</style>
