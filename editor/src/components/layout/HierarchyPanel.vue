<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  useSceneStore,
  type HierarchyDropPosition,
  PREFAB_SOURCE_METADATA_KEY,
  GROUND_NODE_ID,
  SKY_NODE_ID,
  ENVIRONMENT_NODE_ID,
} from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import type { HierarchyTreeItem } from '@/types/hierarchy-tree-item'
import type { ProjectAsset } from '@/types/project-asset'
import type { SceneNode } from '@harmony/schema'
import { getNodeIcon } from '@/types/node-icons'
import AddNodeMenu from '../common/AddNodeMenu.vue'
import { Group, Vector3 } from 'three'

const props = defineProps<{ floating?: boolean }>()

const emit = defineEmits<{
  (event: 'collapse'): void
  (event: 'toggle-placement'): void
}>()

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const { hierarchyItems, selectedNodeId, selectedNodeIds, draggingAssetId } = storeToRefs(sceneStore)

const ASSET_DRAG_MIME = 'application/x-harmony-asset'
const NODE_DRAG_LIST_MIME = 'application/x-harmony-node-list'

const selectionAnchorId = ref<string | null>(null)
const suppressSelectionSync = ref(false)
type DragState = {
  sourceIds: string[]
  primaryId: string | null
  targetId: string | null
  position: HierarchyDropPosition | null
}

const dragState = ref<DragState>({
  sourceIds: [],
  primaryId: null,
  targetId: null,
  position: null,
})
const panelRef = ref<HTMLDivElement | null>(null)
const materialDropTargetId = ref<string | null>(null)
const assetDropTargetId = ref<string | null>(null)
const assetRootDropActive = ref(false)
const isSavingPrefab = ref(false)
const isUpdatingPrefab = ref(false)

const floating = computed(() => props.floating ?? false)
const placementIcon = computed(() => (floating.value ? 'mdi-dock-left' : 'mdi-arrow-expand'))
const placementTitle = computed(() => (floating.value ? '停靠到左侧' : '浮动显示'))

const openedIds = computed({
  get: () => sceneStore.getExpandedGroupIds(),
  set: (next: string[]) => {
    sceneStore.syncGroupExpansionState(next, { captureHistory: false })
  },
})


const active = computed({
  get: () => (selectedNodeId.value ? [selectedNodeId.value] : []),
  set: (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (nextId !== selectedNodeId.value) {
      sceneStore.selectNode(nextId)
    }
  },
})

watch(draggingAssetId, (value) => {
  if (!value) {
    materialDropTargetId.value = null
    assetDropTargetId.value = null
    assetRootDropActive.value = false
  }
})

const flattenedHierarchyItems = computed(() => flattenHierarchyItems(hierarchyItems.value))
const allNodeIds = computed(() => flattenedHierarchyItems.value.map((item) => item.id))
const hasSelection = computed(() => selectedNodeIds.value.length > 0)
const hasHierarchyNodes = computed(() => flattenedHierarchyItems.value.length > 0)
const areAllNodesVisible = computed(() => flattenedHierarchyItems.value.every((item) => item.visible))
const anyNodeHidden = computed(() => flattenedHierarchyItems.value.some((item) => !item.visible))
const visibilityToggleIcon = computed(() => (areAllNodesVisible.value ? 'mdi-eye-off-outline' : 'mdi-eye-outline'))
const visibilityToggleTitle = computed(() => (areAllNodesVisible.value ? '隐藏所有节点' : '显示所有节点'))
const anyNodeLocked = computed(() => flattenedHierarchyItems.value.some((item) => item.locked))
const areAllNodesLocked = computed(
  () => hasHierarchyNodes.value && flattenedHierarchyItems.value.every((item) => item.locked),
)
const lockToggleIcon = computed(() => (areAllNodesLocked.value ? 'mdi-lock-open-variant-outline' : 'mdi-lock-outline'))
const lockToggleTitle = computed(() => (areAllNodesLocked.value ? '解除全部锁定' : '锁定全部节点'))

const activeSceneNode = computed<SceneNode | null>(() => {
  const id = selectedNodeId.value
  if (!id) {
    return null
  }
  return findSceneNodeById(sceneStore.nodes, id)
})

const selectedGroupId = computed(() => {
  const node = activeSceneNode.value
  return node?.nodeType === 'Group' ? node.id : null
})

const selectedGroupExpanded = computed(() => {
  const id = selectedGroupId.value
  if (!id) {
    return false
  }
  return sceneStore.isGroupExpanded(id)
})

const groupToggleIcon = computed(() => {
  if (!selectedGroupId.value) {
    return 'mdi-unfold-more-horizontal'
  }
  return selectedGroupExpanded.value ? 'mdi-unfold-less-horizontal' : 'mdi-unfold-more-horizontal'
})

const groupToggleTitle = computed(() => {
  if (!selectedGroupId.value) {
    return '展开/收起选中的组合'
  }
  return selectedGroupExpanded.value ? '收起组合' : '展开组合'
})

function handleToggleSelectedGroupExpansion() {
  const id = selectedGroupId.value
  if (!id) {
    return
  }
  sceneStore.toggleGroupExpansion(id, { captureHistory: false })
}

function resolvePrefabAssetId(node: SceneNode | null): string | null {
  if (!node || !node.userData || typeof node.userData !== 'object') {
    return null
  }
  const value = (node.userData as Record<string, unknown>)[PREFAB_SOURCE_METADATA_KEY]
  return typeof value === 'string' && value.trim().length ? value : null
}

function isNormalNodeType(node: SceneNode | null): boolean {
  if (!node) {
    return false
  }
  return node.id !== 'harmony:ground' && node.id !== 'harmony:sky' && node.id !== 'harmony:environment'
}

const canSavePrefab = computed(() => {
  if (selectedNodeIds.value.length !== 1) {
    return false
  }
  const node = activeSceneNode.value
  if (!node) {
    return false
  }
  return isNormalNodeType(node)
})

const canUpdatePrefab = computed(() => {
  if (!canSavePrefab.value) {
    return false
  }
  const node = activeSceneNode.value
  if (!node ) {
    return false
  }
  return isNormalNodeType(node) && resolvePrefabAssetId(node) !== null
})


watch(allNodeIds, (ids) => {
  if (selectionAnchorId.value && !ids.includes(selectionAnchorId.value)) {
    selectionAnchorId.value = selectedNodeIds.value[selectedNodeIds.value.length - 1] ?? null
  }
})

watch(
  selectedNodeIds,
  (ids) => {
    if (suppressSelectionSync.value) {
      suppressSelectionSync.value = false
    }
    if (ids.length === 0) {
      selectionAnchorId.value = null
      return
    }
    if (!selectionAnchorId.value || !ids.includes(selectionAnchorId.value)) {
      selectionAnchorId.value = ids[ids.length - 1] ?? null
    }
  },
  { immediate: true, deep: true },
)

const rootDropClasses = computed(() => {
  const isNodeDragActive =
    dragState.value.sourceIds.length > 0 &&
    dragState.value.targetId === null &&
    dragState.value.position !== null
  return {
    'root-drop-active': isNodeDragActive || assetRootDropActive.value,
    'root-drop-before': isNodeDragActive && dragState.value.position === 'before',
    'root-drop-after': isNodeDragActive && dragState.value.position === 'after',
  }
})

function flattenHierarchyItems(items: HierarchyTreeItem[]): HierarchyTreeItem[] {
  const result: HierarchyTreeItem[] = []
  for (const item of items) {
    result.push(item)
    if (Array.isArray(item.children) && item.children.length) {
      result.push(...flattenHierarchyItems(item.children))
    }
  }
  return result
}

function sortNodeIdsByHierarchyOrder(ids: string[]): string[] {
  if (!ids.length) {
    return []
  }
  const orderIndex = new Map(allNodeIds.value.map((id, index) => [id, index]))
  const uniqueIds = Array.from(new Set(ids)).filter((id) => orderIndex.has(id))
  uniqueIds.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))
  return uniqueIds
}

function filterNestedNodeIds(ids: string[]): string[] {
  if (ids.length <= 1) {
    return [...ids]
  }
  const unique = Array.from(new Set(ids))
  return unique.filter((id) => !unique.some((candidate) => candidate !== id && sceneStore.isDescendant(candidate, id)))
}

function resolveDragSources(nodeId: string): { primaryId: string | null; sourceIds: string[] } {
  const selected = selectedNodeIds.value.includes(nodeId) ? [...selectedNodeIds.value] : [nodeId]
  const filtered = filterNestedNodeIds(selected)
  const sorted = sortNodeIdsByHierarchyOrder(filtered)
  if (!sorted.length) {
    return { primaryId: null, sourceIds: [] }
  }
  if (sorted.includes(nodeId)) {
    return { primaryId: nodeId, sourceIds: sorted }
  }
  const ancestorMatch = sorted.find((candidate) => sceneStore.isDescendant(candidate, nodeId)) ?? sorted[0]
  return { primaryId: ancestorMatch ?? null, sourceIds: sorted }
}

type MaterialAsset = ProjectAsset & { type: 'material' }

function findSceneNodeById(nodes: SceneNode[] | undefined, id: string): SceneNode | null {
  if (!Array.isArray(nodes) || !id) {
    return null
  }
  for (const node of nodes) {
    if (!node) {
      continue
    }
    if (node.id === id) {
      return node
    }
    const child = findSceneNodeById(node.children, id)
    if (child) {
      return child
    }
  }
  return null
}

type ParentInfo = { parentId: string | null; parentNode: SceneNode | null }

function findParentInfo(nodeId: string): ParentInfo {
  if (!nodeId) {
    return { parentId: null, parentNode: null }
  }
  const stack: Array<{ list: SceneNode[]; parent: SceneNode | null }> = [{ list: sceneStore.nodes, parent: null }]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    for (const entry of current.list) {
      if (!entry) {
        continue
      }
      if (entry.id === nodeId) {
        return { parentId: current.parent?.id ?? null, parentNode: current.parent ?? null }
      }
      if (entry.children?.length) {
        stack.push({ list: entry.children, parent: entry })
      }
    }
  }
  return { parentId: null, parentNode: null }
}

function wrapNodeIntoNewGroup(targetId: string, adoptNodeId?: string | null): string | null {
  if (!targetId) {
    return null
  }
  const protectedIds = new Set([GROUND_NODE_ID, SKY_NODE_ID, ENVIRONMENT_NODE_ID])
  if (protectedIds.has(targetId)) {
    return null
  }
  if (adoptNodeId && protectedIds.has(adoptNodeId)) {
    return null
  }
  const targetNode = findSceneNodeById(sceneStore.nodes, targetId)
  if (!targetNode) {
    return null
  }
  const { parentId } = findParentInfo(targetId)
  const previousSelectionIds = [...sceneStore.selectedNodeIds]
  const previousPrimaryId = sceneStore.selectedNodeId ?? null
  const groupName = typeof sceneStore.generateGroupNodeName === 'function'
    ? sceneStore.generateGroupNodeName()
    : 'Group'
  const groupObject = new Group()
  groupObject.name = groupName
  const groupNode = sceneStore.addSceneNode({
    nodeType: 'Group',
    object: groupObject,
    name: groupName,
    parentId: parentId ?? undefined,
  })
  if (!groupNode) {
    sceneStore.setSelection(previousSelectionIds, { primaryId: previousPrimaryId })
    return null
  }

  const repositioned = sceneStore.moveNode({ nodeId: groupNode.id, targetId, position: 'before' })
  if (!repositioned) {
    console.warn('Failed to align new group before target node', groupNode.id, targetId)
  }

  const movedTarget = sceneStore.moveNode({ nodeId: targetId, targetId: groupNode.id, position: 'inside' })
  if (!movedTarget) {
    console.warn('Failed to move target node into new group', targetId, groupNode.id)
    sceneStore.setSelection(previousSelectionIds, { primaryId: previousPrimaryId })
    return null
  }

  if (adoptNodeId && adoptNodeId !== targetId) {
    const movedAdopted = sceneStore.moveNode({ nodeId: adoptNodeId, targetId: groupNode.id, position: 'inside' })
    if (!movedAdopted) {
      console.warn('Failed to move dragged node into new group', adoptNodeId, groupNode.id)
      sceneStore.setSelection(previousSelectionIds, { primaryId: previousPrimaryId })
      return null
    }
  }

  sceneStore.setGroupExpanded(groupNode.id, true, { captureHistory: false })
  sceneStore.setSelection(previousSelectionIds, { primaryId: previousPrimaryId })
  return groupNode.id
}

type NodeDropResolution =
  | { targetId: string | null; position: HierarchyDropPosition }
  | { handled: true; targetId: string | null; adoptedId: string | null }
  | null

function resolveNodeDropResolution(
  sourceIds: string[],
  primarySourceId: string | null,
  targetId: string,
): NodeDropResolution {
  if (!sourceIds.length || !targetId) {
    return null
  }
  const targetNode = findSceneNodeById(sceneStore.nodes, targetId)
  if (!targetNode) {
    return null
  }
  if (!sceneStore.nodeAllowsChildCreation(targetId)) {
    return null
  }
  if (targetNode.nodeType === 'Group') {
    return { targetId, position: 'inside' }
  }
  const { parentNode } = findParentInfo(targetId)
  if (parentNode && parentNode.nodeType === 'Group') {
    return { targetId, position: 'after' }
  }
  const activeSourceId = primarySourceId && sourceIds.includes(primarySourceId) ? primarySourceId : sourceIds[0]
  const newGroupId = wrapNodeIntoNewGroup(targetId, activeSourceId)
  if (!newGroupId) {
    return null
  }
  return { handled: true, targetId: newGroupId, adoptedId: activeSourceId ?? null }
}

function resolveAssetDropParentId(targetId: string): string | null {
  if (!targetId) {
    return null
  }
  const targetNode = findSceneNodeById(sceneStore.nodes, targetId)
  if (!targetNode) {
    return null
  }
  if (!sceneStore.nodeAllowsChildCreation(targetId)) {
    return null
  }
  if (targetNode.nodeType === 'Group') {
    return targetId
  }
  const { parentId, parentNode } = findParentInfo(targetId)
  if (parentNode && parentNode.nodeType === 'Group') {
    return parentId
  }
  return wrapNodeIntoNewGroup(targetId)
}

function nodeSupportsMaterials(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  const type = node.nodeType ?? 'Mesh'
  return isNormalNodeType(node) && type !== 'Light' && type !== 'Group'
}

function supportsMaterialDrop(targetId: string): boolean {
  if (!targetId) {
    return false
  }
  const item = flattenedHierarchyItems.value.find((entry) => entry.id === targetId) ?? null
  if (item?.nodeType) {
    return item.nodeType !== 'Light' && item.nodeType !== 'Group'
  }
  const node = findSceneNodeById(sceneStore.nodes, targetId)
  return isNormalNodeType(node) && nodeSupportsMaterials(node)
}

function parseAssetDragPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.assetId === 'string' && parsed.assetId.length) {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse asset drag payload', error)
      }
    }
  }
  const draggingId = draggingAssetId.value
  if (draggingId) {
    return { assetId: draggingId }
  }
  return null
}

function resolveMaterialAssetFromEvent(event: DragEvent): MaterialAsset | null {
  const payload = parseAssetDragPayload(event)
  if (!payload) {
    return null
  }
  const asset = sceneStore.getAsset(payload.assetId)
  if (!asset || asset.type !== 'material') {
    return null
  }
  return asset as MaterialAsset
}

function resolveHierarchyAssetFromEvent(event: DragEvent): ProjectAsset | null {
  const payload = parseAssetDragPayload(event)
  if (!payload) {
    return null
  }
  let asset = sceneStore.getAsset(payload.assetId)
  if (!asset) {
    return null
  }
  const meta = sceneStore.assetIndex?.[asset.id]
  if (meta?.source?.type === 'package' && meta.source.providerId) {
    asset = sceneStore.copyPackageAssetToAssets(meta.source.providerId, asset)
  }
  return asset.type === 'model' || asset.type === 'prefab' ? asset : null
}

async function ensureModelAssetCached(asset: ProjectAsset): Promise<void> {
  if (asset.type !== 'model') {
    return
  }
  if (assetCacheStore.hasCache(asset.id)) {
    return
  }
  await assetCacheStore.downloaProjectAsset(asset)
  if (!assetCacheStore.hasCache(asset.id)) {
    const reason = assetCacheStore.getError(asset.id)
    throw new Error(reason ?? '模型资源尚未准备就绪')
  }
}

async function handleAssetDropOnNode(asset: ProjectAsset, targetId: string): Promise<void> {
  let resolvedParentId: string | null = null
  try {
    resolvedParentId = resolveAssetDropParentId(targetId)
    if (!resolvedParentId) {
      console.warn('Unable to resolve valid group parent for asset drop', asset.id, targetId)
      return
    }
    const parentCenter = sceneStore.getNodeWorldCenter(resolvedParentId)
    const spawnCenter = parentCenter ? parentCenter.clone() : null
    if (asset.type === 'prefab') {
      const instantiated = await sceneStore.instantiateNodePrefabAsset(
        asset.id,
        spawnCenter ?? undefined,
      )
      const moved = sceneStore.moveNode({ nodeId: instantiated.id, targetId: resolvedParentId, position: 'inside' })
      if (moved) {
        sceneStore.setGroupExpanded(resolvedParentId, true, { captureHistory: false })
      }
      if (!moved) {
        console.warn('Failed to nest prefab under target node', asset.id, resolvedParentId)
      }
      return
    }

    if (asset.type === 'model') {
      await ensureModelAssetCached(asset)
      const payload: {
        asset: ProjectAsset
        parentId: string
        position?: Vector3
      } = {
        asset,
        parentId: resolvedParentId,
      }
      if (spawnCenter) {
        payload.position = spawnCenter.clone()
      }
      const node = await sceneStore.addModelNode(payload)
      if (!node) {
        console.warn('Failed to add model asset as child node', asset.id, resolvedParentId)
        return
      }
      sceneStore.setGroupExpanded(resolvedParentId, true, { captureHistory: false })
    }
  } catch (error) {
    console.error('Failed to drop asset onto hierarchy node', asset.id, resolvedParentId ?? targetId, error)
    assetCacheStore.setError(asset.id, (error as Error).message ?? 'Failed to place asset')
  }
}

async function handleAssetDropOnRoot(asset: ProjectAsset): Promise<void> {
  try {
    if (asset.type === 'prefab') {
      await sceneStore.instantiateNodePrefabAsset(asset.id)
      return
    }
    if (asset.type === 'model') {
      await ensureModelAssetCached(asset)
      const node = await sceneStore.addModelNode({ asset })
      if (!node) {
        console.warn('Failed to add model asset to hierarchy root', asset.id)
      }
    }
  } catch (error) {
    console.error('Failed to drop asset into hierarchy root', asset.id, error)
    assetCacheStore.setError(asset.id, (error as Error).message ?? 'Failed to place asset')
  }
}

function applyMaterialAssetToNode(nodeId: string, asset: MaterialAsset): boolean {
  if (!supportsMaterialDrop(nodeId)) {
    return false
  }
  const node = findSceneNodeById(sceneStore.nodes, nodeId)
  if (!node || !nodeSupportsMaterials(node)) {
    return false
  }
  const materials = Array.isArray(node.materials) ? node.materials : []
  if (materials.length > 0) {
    const primary = materials[0]
    if (!primary) {
      return false
    }
    return sceneStore.assignNodeMaterial(nodeId, primary.id, asset.id)
  }
  return Boolean(sceneStore.addNodeMaterial(nodeId, { materialId: asset.id }))
}

function isItemSelected(id: string) {
  return selectedNodeIds.value.includes(id)
}

function isItemActive(id: string) {
  return selectedNodeId.value === id
}

function toggleNodeVisibility(id: string) {
  sceneStore.toggleNodeVisibility(id)
}

function toggleNodeSelectionLock(id: string) {
  sceneStore.toggleNodeSelectionLock(id)
}

function isNodeSelectionLocked(id: string) {
  return sceneStore.isNodeSelectionLocked(id)
}

function setActiveNode(id: string | null) {
  selectionAnchorId.value = id
  suppressSelectionSync.value = true
  sceneStore.selectNode(id)
}

function handleDeleteSelected() {
  if (!selectedNodeIds.value.length) return
  const idsToRemove = [...selectedNodeIds.value]
  sceneStore.removeSceneNodes(idsToRemove)
  selectionAnchorId.value = selectedNodeIds.value[selectedNodeIds.value.length - 1] ?? null
}

async function handleSavePrefab() {
  if (!canSavePrefab.value || isSavingPrefab.value) {
    return
  }
  const node = activeSceneNode.value
  if (!node) {
    return
  }
  isSavingPrefab.value = true
  try {
    await sceneStore.saveNodePrefab(node.id)
  } catch (error) {
    console.error('保存预制件失败', error)
  } finally {
    isSavingPrefab.value = false
  }
}

async function handleUpdatePrefab() {
  if (!canUpdatePrefab.value || isUpdatingPrefab.value) {
    return
  }
  const node = activeSceneNode.value
  if (!node) {
    return
  }
  const assetId = resolvePrefabAssetId(node)
  if (!assetId) {
    return
  }
  isUpdatingPrefab.value = true
  try {
    await sceneStore.saveNodePrefab(node.id, { assetId })
  } catch (error) {
    console.error('更新预制件失败', error)
  } finally {
    isUpdatingPrefab.value = false
  }
}

function handleToggleAllVisibility() {
  const nextVisible = !areAllNodesVisible.value
  sceneStore.setAllNodesVisibility(nextVisible)
}

function handleToggleAllSelectionLock() {
  const nextLocked = !areAllNodesLocked.value
  sceneStore.setAllNodesSelectionLock(nextLocked)
}

function getNodeInteractionClasses(id: string) {
  return {
    ...getNodeDropClasses(id),
    'is-selected': isItemSelected(id),
    'is-active': isItemActive(id),
    'is-locked': isNodeSelectionLocked(id),
  }
}

function resolveNodeIcon(item: HierarchyTreeItem) {
  return getNodeIcon({
    nodeId: item.id,
    nodeType: item.nodeType,
    lightType: item.lightType,
    hasChildren: Boolean(item.children?.length),
    dynamicMeshType: item.dynamicMeshType,
  })
}

function handleNodeClick(event: MouseEvent, nodeId: string) {
  event.stopPropagation()
  event.preventDefault()
  if (event.button !== 0) return

  const isToggle = event.ctrlKey || event.metaKey
  const isRangeSelect = event.shiftKey && selectionAnchorId.value
  const currentlySelected = isItemSelected(nodeId)

  const currentSelection = [...selectedNodeIds.value]
  let nextSelection: string[] = currentSelection

  if (isRangeSelect) {
    const anchorId = selectionAnchorId.value
    const anchorIndex = anchorId ? allNodeIds.value.indexOf(anchorId) : -1
    const targetIndex = allNodeIds.value.indexOf(nodeId)
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
      const rangeIds = allNodeIds.value.slice(start, end + 1)
      const base = isToggle ? currentSelection : []
      nextSelection = Array.from(new Set([...base, ...rangeIds]))
    } else {
      nextSelection = [nodeId]
    }
  } else if (isToggle) {
    nextSelection = currentlySelected
      ? currentSelection.filter((id) => id !== nodeId)
      : [...currentSelection, nodeId]
  } else {
    if (currentSelection.length !== 1 || !currentlySelected) {
      nextSelection = [nodeId]
    }
  }

  if (!nextSelection.length) {
    suppressSelectionSync.value = true
    sceneStore.clearSelection()
    selectionAnchorId.value = null
    return
  }

  suppressSelectionSync.value = true
  sceneStore.setSelection(nextSelection)
  selectionAnchorId.value = nextSelection[nextSelection.length - 1] ?? null
}

function handleTreeBackgroundMouseDown(event: MouseEvent) {
  if (event.button !== 0) {
    return
  }
  const target = event.target as HTMLElement | null
  if (!target) {
    return
  }
  const container = event.currentTarget as HTMLElement | null
  if (container) {
    const rect = container.getBoundingClientRect()
    const onVerticalScrollbar =
      container.scrollHeight > container.clientHeight &&
      event.clientX >= rect.left + container.clientWidth
    const onHorizontalScrollbar =
      container.scrollWidth > container.clientWidth &&
      event.clientY >= rect.top + container.clientHeight
    if (onVerticalScrollbar || onHorizontalScrollbar) {
      return
    }
  }
  if (target.closest('.node-label') || target.closest('.tree-node-trailing') || target.closest('.v-btn')) {
    return
  }
  if (!selectedNodeIds.value.length) {
    return
  }
  sceneStore.clearSelection()
  selectionAnchorId.value = null
}

function resetDragState() {
  dragState.value = { sourceIds: [], primaryId: null, targetId: null, position: null }
  materialDropTargetId.value = null
  assetDropTargetId.value = null
  assetRootDropActive.value = false
}

function resolveDropPosition(event: DragEvent): HierarchyDropPosition {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return 'inside'
  const rect = target.getBoundingClientRect()
  if (rect.height === 0) return 'inside'
  const offset = event.clientY - rect.top
  const ratio = offset / rect.height
  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return 'inside'
}

function getNodeDropClasses(id: string) {
  const classes: Record<string, boolean> = {
    'material-drop-target': materialDropTargetId.value === id,
    'asset-drop-target': assetDropTargetId.value === id,
  }
  if (dragState.value.targetId !== id) {
    return classes
  }
  if (!dragState.value.position) {
    return { ...classes, 'drop-disabled': true }
  }
  return {
    ...classes,
    'drop-before': dragState.value.position === 'before',
    'drop-after': dragState.value.position === 'after',
    'drop-inside': dragState.value.position === 'inside',
  }
}

function handleDragStart(event: DragEvent, nodeId: string) {
  materialDropTargetId.value = null
  const { primaryId, sourceIds } = resolveDragSources(nodeId)
  if (!sourceIds.length) {
    dragState.value = { sourceIds: [], primaryId: null, targetId: null, position: null }
    return
  }
  const transferableId = primaryId ?? nodeId
  dragState.value = {
    sourceIds,
    primaryId: transferableId,
    targetId: null,
    position: null,
  }
  event.dataTransfer?.setData('text/plain', transferableId)
  event.dataTransfer?.setData('application/x-harmony-node', transferableId)
  event.dataTransfer?.setData(NODE_DRAG_LIST_MIME, JSON.stringify(sourceIds))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
  }
}

function handleDragEnd() {
  resetDragState()
}

function handleDragOver(event: DragEvent, targetId: string) {
  const materialAsset = resolveMaterialAssetFromEvent(event)
  if (materialAsset) {
    if (!supportsMaterialDrop(targetId)) {
      materialDropTargetId.value = null
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    materialDropTargetId.value = targetId
    return
  }
  const hierarchyAsset = resolveHierarchyAssetFromEvent(event)
  if (hierarchyAsset) {
    materialDropTargetId.value = null
    const isSupported = hierarchyAsset.type === 'model' || hierarchyAsset.type === 'prefab'
    if (!isSupported) {
      assetDropTargetId.value = null
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
      return
    }
    if (!sceneStore.nodeAllowsChildCreation(targetId)) {
      assetDropTargetId.value = null
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
      return
    }
    assetDropTargetId.value = targetId
    assetRootDropActive.value = false
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    return
  }
  materialDropTargetId.value = null
  if (assetDropTargetId.value === targetId) {
    assetDropTargetId.value = null
  }
  const { sourceIds, primaryId } = dragState.value
  if (!sourceIds.length || sourceIds.includes(targetId)) {
    return
  }

  const isInvalid = sourceIds.some((id) => sceneStore.isDescendant(id, targetId))
  if (isInvalid) {
    dragState.value = { sourceIds, primaryId, targetId, position: null }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none'
    }
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const position = resolveDropPosition(event)
  if (position === 'inside' && !sceneStore.nodeAllowsChildCreation(targetId)) {
    dragState.value = { sourceIds, primaryId, targetId, position: null }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none'
    }
    event.preventDefault()
    event.stopPropagation()
    return
  }
  dragState.value = { sourceIds, primaryId, targetId, position }
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleDragLeave(event: DragEvent, targetId: string) {
  const related = event.relatedTarget as Node | null
  const current = event.currentTarget as HTMLElement | null
  if (current && related && current.contains(related)) return
  if (materialDropTargetId.value === targetId) {
    materialDropTargetId.value = null
  }
  if (assetDropTargetId.value === targetId) {
    assetDropTargetId.value = null
  }
  if (!dragState.value.sourceIds.length) return
  if (dragState.value.targetId === targetId) {
    dragState.value = {
      sourceIds: [...dragState.value.sourceIds],
      primaryId: dragState.value.primaryId,
      targetId: null,
      position: null,
    }
  }
}

async function handleDrop(event: DragEvent, targetId: string) {
  const materialAsset = resolveMaterialAssetFromEvent(event)
  if (materialAsset) {
    materialDropTargetId.value = null
    if (!supportsMaterialDrop(targetId)) {
      event.preventDefault()
      event.stopPropagation()
      resetDragState()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const applied = applyMaterialAssetToNode(targetId, materialAsset)
    if (!applied) {
      console.warn('Failed to apply material asset to node', materialAsset.id, targetId)
    }
    resetDragState()
    return
  }
  materialDropTargetId.value = null
  const hierarchyAsset = resolveHierarchyAssetFromEvent(event)
  if (hierarchyAsset) {
    assetDropTargetId.value = null
    assetRootDropActive.value = false
    event.preventDefault()
    event.stopPropagation()
    if (!sceneStore.nodeAllowsChildCreation(targetId)) {
      resetDragState()
      return
    }
    if (hierarchyAsset.type === 'model' || hierarchyAsset.type === 'prefab') {
      await handleAssetDropOnNode(hierarchyAsset, targetId)
    } else {
      console.warn('Unsupported asset type for hierarchy drop', hierarchyAsset.type)
    }
    resetDragState()
    return
  }
  const { sourceIds, primaryId, position } = dragState.value
  if (!sourceIds.length || !position) {
    resetDragState()
    return
  }
  event.preventDefault()
  event.stopPropagation()
  let resolvedTargetId: string | null = targetId
  let resolvedPosition = position
  if (position === 'inside') {
    const resolution = resolveNodeDropResolution(sourceIds, primaryId, targetId)
    if (!resolution) {
      resetDragState()
      return
    }
    if ('handled' in resolution) {
      const remainingIds = resolution.adoptedId
        ? sourceIds.filter((id) => id !== resolution.adoptedId)
        : [...sourceIds]
      let movedAny = false
      if (resolution.targetId) {
        for (const nodeId of remainingIds) {
          if (nodeId === resolution.targetId) {
            continue
          }
          const moved = sceneStore.moveNode({ nodeId, targetId: resolution.targetId, position: 'inside' })
          movedAny = movedAny || moved
        }
        if (movedAny) {
          sceneStore.setGroupExpanded(resolution.targetId, true, { captureHistory: false })
        }
      }
      resetDragState()
      return
    }
    resolvedTargetId = resolution.targetId
    resolvedPosition = resolution.position
  }
  const moveOrder = [...sourceIds]
  let movedAny = false
  if (resolvedPosition === 'after') {
    let insertionTargetId = resolvedTargetId
    for (const nodeId of moveOrder) {
      if (!insertionTargetId || nodeId === insertionTargetId) {
        continue
      }
      const moved = sceneStore.moveNode({ nodeId, targetId: insertionTargetId, position: 'after' })
      if (moved) {
        insertionTargetId = nodeId
        movedAny = true
      }
    }
  } else if (resolvedPosition === 'before') {
    for (const nodeId of moveOrder.slice().reverse()) {
      if (!resolvedTargetId || nodeId === resolvedTargetId) {
        continue
      }
      const moved = sceneStore.moveNode({ nodeId, targetId: resolvedTargetId, position: 'before' })
      movedAny = movedAny || moved
    }
  } else if (resolvedPosition === 'inside' && resolvedTargetId) {
    for (const nodeId of moveOrder) {
      if (nodeId === resolvedTargetId) {
        continue
      }
      const moved = sceneStore.moveNode({ nodeId, targetId: resolvedTargetId, position: 'inside' })
      movedAny = movedAny || moved
    }
  }
  if (movedAny && resolvedPosition === 'inside' && resolvedTargetId) {
    sceneStore.setGroupExpanded(resolvedTargetId, true, { captureHistory: false })
  }
  resetDragState()
}

function handleNodeDoubleClick(nodeId: string) {
  const nextSelection = sceneStore.handleNodeDoubleClick(nodeId)
  if (Array.isArray(nextSelection) && nextSelection.length) {
    suppressSelectionSync.value = true
    sceneStore.setSelection(nextSelection, { primaryId: nextSelection[nextSelection.length - 1] })
    selectionAnchorId.value = nextSelection[nextSelection.length - 1] ?? null
  } else {
    setActiveNode(nodeId)
  }
  sceneStore.requestCameraFocus(nodeId)
}

function handleTreeDragOver(event: DragEvent) {
  if (resolveMaterialAssetFromEvent(event)) {
    materialDropTargetId.value = null
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none'
    }
    return
  }
  const hierarchyAsset = resolveHierarchyAssetFromEvent(event)
  if (hierarchyAsset) {
    materialDropTargetId.value = null
    const isSupported = hierarchyAsset.type === 'model' || hierarchyAsset.type === 'prefab'
    if (!isSupported) {
      assetRootDropActive.value = false
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
      return
    }
    assetDropTargetId.value = null
    assetRootDropActive.value = true
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    return
  }
  assetRootDropActive.value = false
  const { sourceIds, primaryId } = dragState.value
  if (!sourceIds.length) return
  const container = event.currentTarget as HTMLElement | null
  if (!container) return
  const rect = container.getBoundingClientRect()
  const offset = event.clientY - rect.top
  const position: HierarchyDropPosition = offset < rect.height / 2 ? 'before' : 'after'
  dragState.value = { sourceIds: [...sourceIds], primaryId, targetId: null, position }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

async function handleTreeDrop(event: DragEvent) {
  if (resolveMaterialAssetFromEvent(event)) {
    materialDropTargetId.value = null
    event.preventDefault()
    event.stopPropagation()
    resetDragState()
    return
  }
  const hierarchyAsset = resolveHierarchyAssetFromEvent(event)
  if (hierarchyAsset) {
    assetDropTargetId.value = null
    assetRootDropActive.value = false
    event.preventDefault()
    event.stopPropagation()
    if (hierarchyAsset.type === 'model' || hierarchyAsset.type === 'prefab') {
      await handleAssetDropOnRoot(hierarchyAsset)
    } else {
      console.warn('Unsupported asset type for hierarchy root drop', hierarchyAsset.type)
    }
    resetDragState()
    return
  }
  const { sourceIds, position } = dragState.value
  if (!sourceIds.length || !position) {
    event.preventDefault()
    resetDragState()
    return
  }
  event.preventDefault()
  const moveOrder = position === 'before' ? [...sourceIds].reverse() : [...sourceIds]
  for (const nodeId of moveOrder) {
    sceneStore.moveNode({ nodeId, targetId: null, position })
  }
  resetDragState()
}

function handleTreeDragLeave(event: DragEvent) {
  if (materialDropTargetId.value) {
    materialDropTargetId.value = null
  }
  if (assetDropTargetId.value) {
    assetDropTargetId.value = null
  }
  assetRootDropActive.value = false
  if (!dragState.value.sourceIds.length) return
  const container = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (container && related && container.contains(related)) return
  if (dragState.value.targetId === null) {
    dragState.value = {
      sourceIds: [...dragState.value.sourceIds],
      primaryId: dragState.value.primaryId,
      targetId: null,
      position: null,
    }
  }
}

</script>

<template>
  <v-card
    ref="panelRef"
    :class="['panel-card', { 'is-floating': floating } ]"
    :elevation="floating ? 12 : 4"
  >
    <v-toolbar density="compact" title="Hierarchy" class="panel-toolbar" height="40px">

      <v-spacer />
      <v-btn
        class="placement-toggle"
        variant="text"
        size="small"
        :icon="placementIcon"
        :title="placementTitle"
        @click="emit('toggle-placement')"
      />
      <v-btn icon="mdi-window-minimize" size="small" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="panel-body hierarchy-body">
      <v-toolbar density="compact" class="tree-toolbar" height="40px">
        <AddNodeMenu>
          <template #activator="{ props }">
            <v-btn
              icon="mdi-plus"
              variant="text"
              density="compact"
              color="primary"
              v-bind="props"
            />
          </template>
        </AddNodeMenu>
        <v-btn
          icon="mdi-cube"
          variant="text"
          density="compact"
          color="primary"
          :title="'保存为预制件'"
          :disabled="!canSavePrefab || isSavingPrefab"
          :loading="isSavingPrefab"
          @click="handleSavePrefab"
        />
        <v-btn
          icon="mdi-content-save-edit"
          variant="text"
          density="compact"
          color="primary"
          :title="'更新预制件'"
          :disabled="!canUpdatePrefab || isUpdatingPrefab"
          :loading="isUpdatingPrefab"
          @click="handleUpdatePrefab"
        />
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          density="compact"
          color="error"
          :disabled="!hasSelection "
          @click="handleDeleteSelected"
        />
        <v-btn
          :class="['global-toggle-btn', 'group-toggle-btn', { 'is-active': selectedGroupId && selectedGroupExpanded }]"
          :icon="groupToggleIcon"
          variant="text"
          density="compact"
          color="primary"
          :title="groupToggleTitle"
          :disabled="!selectedGroupId"
          @click="handleToggleSelectedGroupExpansion"
        />
        <v-spacer />
        <div class="tree-toolbar-right">
        <v-btn
          class="global-toggle-btn"
          :class="{ 'is-active': anyNodeHidden }"
          :icon="visibilityToggleIcon"
          variant="text"
          density="compact"
          size="small"
          :title="visibilityToggleTitle"
          :disabled="!hasHierarchyNodes"
          @click="handleToggleAllVisibility"
        />
        <v-btn
          class="global-toggle-btn"
          :class="{ 'is-active': anyNodeLocked }"
          :icon="lockToggleIcon"
          variant="text"
          density="compact"
          size="small"
          :title="lockToggleTitle"
          :disabled="!hasHierarchyNodes"
          @click="handleToggleAllSelectionLock"
        />
        </div>

      </v-toolbar>
      <div
        class="tree-container"
        :class="rootDropClasses"
        @dragover="handleTreeDragOver"
        @drop="handleTreeDrop"
        @dragleave="handleTreeDragLeave"
        @mousedown="handleTreeBackgroundMouseDown"
      >
        <v-treeview
          v-model:opened="openedIds"
          v-model:activated="active"
          density="compact"
          :items="hierarchyItems"
          item-title="name"
          item-value="id"
          color="primary"
          activatable
          class="hierarchy-tree"
        >
          <template #prepend="{ item }">
            <v-icon size="small" class="node-icon" :icon="resolveNodeIcon(item)" />
          </template>
          <template #title="{ item }">
            <div
              class="node-label"
              :class="getNodeInteractionClasses(item.id)"
              draggable="true"
              @dragstart="handleDragStart($event, item.id)"
              @dragend="handleDragEnd"
              @dragover="handleDragOver($event, item.id)"
              @dragleave="handleDragLeave($event, item.id)"
              @drop="handleDrop($event, item.id)"
              @click="handleNodeClick($event, item.id)"
              @dblclick.stop.prevent="handleNodeDoubleClick(item.id)"
            >
              <span class="node-label-text">{{ item.name }}</span>
            </div>
          </template>
          <template #append="{ item }">
            <div class="tree-node-trailing" @mousedown.stop @click.stop>
              <v-btn
                :icon="(item.visible ?? true) ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
                variant="text"
                density="compact"
                size="26"
                class="visibility-btn"
                :class="{ 'is-hidden': !(item.visible ?? true) }"
                :title="(item.visible ?? true) ? 'Hide' : 'Show'"
                @click.stop="toggleNodeVisibility(item.id)"
              />
              <v-btn
                :icon="item.locked ? 'mdi-lock-outline' : 'mdi-lock-open-variant-outline'"
                variant="text"
                density="compact"
                size="26"
                class="selection-lock-btn"
                :class="{ 'is-locked': item.locked }"
                
                :title="item.locked ? '解除禁止鼠标选择' : '禁止鼠标选择'"
                @click.stop="toggleNodeSelectionLock(item.id)"
              />
            </div>
          </template>
        </v-treeview>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}

.panel-card.is-floating {
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.placement-toggle {
  color: rgba(233, 236, 241, 0.72);
}

.panel-toolbar :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.panel-toolbar :deep(.v-btn) {
  width: 32px;
  height: 32px;
}

.tree-toolbar-right {
    grid-auto-flow: column;
    grid-gap: 10px;
    display: inline-grid;
    margin-right: 6px;
}

.panel-body {
  flex: 1;
  overflow: hidden;
  padding: 0;
}

.hierarchy-body {
  padding: 0.2rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tree-toolbar {
  background: rgba(255, 255, 255, 0.02);
  border-radius: 2px;
  padding-inline: 1px;
  gap: 2px;
}

.global-toggle-btn {
  color: rgba(233, 236, 241, 0.64);
  transition: color 120ms ease;
}

.global-toggle-btn.is-active {
  color: #4dd0e1;
}

.global-toggle-btn:disabled {
  color: rgba(233, 236, 241, 0.28);
}


.tree-toolbar-separator {
  margin: 0 4px;
  opacity: 0.12;
}

.tree-toolbar-divider {
  margin: 0px;
  opacity: 0.08;
}

.hierarchy-tree {
  flex: 1;
  overflow-y: auto;
}

.tree-container {
  position: relative;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 6px;
}

.hierarchy-tree :deep(.v-treeview-item__checkbox),
.hierarchy-tree :deep(.v-treeview-item__selection) {
  display: none !important;
}

.hierarchy-tree :deep(.v-treeview-item--active > .v-treeview-item__content) {
  background: transparent;
}


.hierarchy-tree :deep(.v-treeview-item__content) {
  padding-inline-end: 6px;
}

.tree-container.root-drop-before::before,
.tree-container.root-drop-after::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 2px;
  border-radius: 2px;
  background: rgba(77, 208, 225, 0.65);
  pointer-events: none;
  z-index: 1;
}

.tree-container.root-drop-before::before {
  top: 4px;
}

.tree-container.root-drop-after::before {
  bottom: 4px;
}

.tree-container.root-drop-active {
  background: rgba(77, 208, 225, 0.08);
}


.hierarchy-tree :deep(.v-treeview-item) {
  min-height: 30px;
  padding-inline: 10px 6px;
}


.hierarchy-tree :deep(.v-list-item-title) {
  font-size: 0.85rem;
}

.node-label {
  display: flex;
  align-items: center;
  position: relative;
  padding: 4px 8px 4px 1px;
  border-radius: 6px;
  cursor: grab;
  user-select: none;
  color: rgba(233, 236, 241, 0.8);
  transition: background-color 140ms ease, color 140ms ease;
  width: 100%;
}

.node-label:active {
  cursor: grabbing;
}

.node-label-text {
  flex: 1;
  min-width: 0;
  color: inherit;
}

.node-label.is-selected {
  color: #4dd0e1;
}

.node-label.is-active {
  color: #fafafa;
}

.node-label.drop-inside {
  background: rgba(77, 208, 225, 0.12);
}

.node-label.material-drop-target {
  background: rgba(90, 148, 255, 0.18);
  color: #fafafa;
}

.node-label.asset-drop-target {
  background: rgba(77, 208, 225, 0.12);
  color: #fafafa;
}

.node-label.drop-before::before,
.node-label.drop-after::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 2px;
  border-radius: 2px;
  background: rgba(77, 208, 225, 0.75);
  pointer-events: none;
}

.node-label.drop-before::before {
  top: 0;
}

.node-label.drop-after::after {
  bottom: 0;
}

.node-label.drop-disabled {
  background: rgba(244, 67, 54, 0.1);
}


.tree-node-trailing {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-width: 24px;
  transition: opacity 120ms ease;
}


.visibility-btn {
  margin-right: 0;
  color: rgba(233, 236, 241, 0.72);
  transition: color 120ms ease;

  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.hierarchy-tree :deep(.v-treeview-item:hover .tree-node-trailing) .visibility-btn,
.hierarchy-tree :deep(.v-treeview-item__append:hover .tree-node-trailing) .visibility-btn,
.hierarchy-tree :deep(.v-treeview-item__append:focus-within .tree-node-trailing) .visibility-btn {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.visibility-btn.is-hidden {
  color: rgba(233, 236, 241, 0.38);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.visibility-btn:disabled {
  color: rgba(233, 236, 241, 0.28);
  cursor: not-allowed;
}

.visibility-btn :deep(.v-icon) {
  font-size: 18px;
}

.selection-lock-btn {
  margin-right: 0;
  color: rgba(233, 236, 241, 0.58);
  transition: color 120ms ease;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.hierarchy-tree :deep(.v-treeview-item:hover .tree-node-trailing) .selection-lock-btn ,
.hierarchy-tree :deep(.v-treeview-item__append:hover .tree-node-trailing) .selection-lock-btn ,
.hierarchy-tree :deep(.v-treeview-item__append:focus-within .tree-node-trailing) .selection-lock-btn  {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}
.selection-lock-btn.is-locked {
  color: rgba(233, 236, 241, 0.9);
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.selection-lock-btn :deep(.v-icon) {
  font-size: 18px;
}

.node-icon {
  opacity: 0.7;
}

</style>
