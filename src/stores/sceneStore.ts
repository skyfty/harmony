import { defineStore } from 'pinia'
import type { Object3D } from 'three'
import type { SceneNode, Vector3Like } from '@/types/scene'

export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale'

export interface ProjectAsset {
  id: string
  name: string
  type: 'model' | 'texture' | 'image'
  description?: string
  previewColor: string
}

export interface ProjectDirectory {
  id: string
  name: string
  children?: ProjectDirectory[]
  assets?: ProjectAsset[]
}

export interface HierarchyTreeItem {
  id: string
  name: string
  children?: HierarchyTreeItem[]
}

interface TransformUpdatePayload {
  id: string
  position?: Vector3Like
  rotation?: Vector3Like
  scale?: Vector3Like
}

export interface SceneCameraState {
  position: Vector3Like
  target: Vector3Like
  fov: number
}

export type EditorPanel = 'hierarchy' | 'inspector' | 'project'

export type HierarchyDropPosition = 'before' | 'after' | 'inside'

export interface PanelVisibilityState {
  hierarchy: boolean
  inspector: boolean
  project: boolean
}

interface SceneState {
  nodes: SceneNode[]
  selectedNodeId: string | null
  activeTool: EditorTool
  projectTree: ProjectDirectory[]
  activeDirectoryId: string | null
  selectedAssetId: string | null
  camera: SceneCameraState
  panelVisibility: PanelVisibilityState
}

const initialNodes: SceneNode[] = [
  {
    id: 'node-root-cube',
    name: 'Prototype Cube',
    geometry: 'box',
    material: { color: '#4DD0E1' },
    position: { x: 0, y: 0.75, z: 0 },
    rotation: { x: 0, y: Math.PI / 4, z: 0 },
    scale: { x: 1.5, y: 1, z: 1.5 },
    children: [
      {
        id: 'node-child-sphere',
        name: 'Detail Sphere',
        geometry: 'sphere',
        material: { color: '#FFB74D' },
        position: { x: 1.5, y: 1.2, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.65, y: 0.65, z: 0.65 },
      },
    ],
  },
  {
    id: 'node-ground-plane',
    name: 'Ground',
    geometry: 'plane',
    material: { color: '#37474F', opacity: 0.8 },
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 12, y: 12, z: 12 },
  },
]

const projectTree: ProjectDirectory[] = [
  {
    id: 'dir-assets',
    name: 'Assets',
    children: [
      {
        id: 'dir-assets-models',
        name: 'Models',
        assets: [
          { id: 'asset-crate', name: 'SciFi Crate', type: 'model', previewColor: '#26C6DA' },
          { id: 'asset-platform', name: 'Floating Platform', type: 'model', previewColor: '#FF7043' },
          { id: 'asset-light2', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light3', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light4', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light5', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light6', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light222', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light62', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light22', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light3', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light4', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light5', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light6', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light222', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light62', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
          { id: 'asset-light22', name: 'Neon Light', type: 'model', previewColor: '#AB47BC' },
        ],
      },
      {
        id: 'dir-assets-textures',
        name: 'Textures',
        assets: [
          { id: 'asset-grid', name: 'Grid Floor', type: 'texture', previewColor: '#546E7A' },
          { id: 'asset-carbon', name: 'Carbon Fiber', type: 'texture', previewColor: '#263238' },
          { id: 'asset-emissive', name: 'Emissive Strip', type: 'texture', previewColor: '#82B1FF' },
        ],
      },
      {
        id: 'dir-assets-materials',
        name: 'Materials',
        assets: [
          { id: 'asset-steel', name: 'Brushed Steel', type: 'image', previewColor: '#90A4AE' },
          { id: 'asset-holo', name: 'Holographic', type: 'image', previewColor: '#7E57C2' },
        ],
      },
    
    ],
  },
]

const defaultDirectoryId = projectTree[0]?.children?.[0]?.id ?? projectTree[0]?.id ?? null

const defaultCameraState: SceneCameraState = {
  position: { x: 12, y: 9, z: 12 },
  target: { x: 0, y: 1, z: 0 },
  fov: 60,
}

const defaultPanelVisibility: PanelVisibilityState = {
  hierarchy: true,
  inspector: true,
  project: true,
}

const runtimeObjectRegistry = new Map<string, Object3D>()

function registerRuntimeObject(id: string, object: Object3D) {
  runtimeObjectRegistry.set(id, object)
}

function unregisterRuntimeObject(id: string) {
  runtimeObjectRegistry.delete(id)
}

export function getRuntimeObject(id: string): Object3D | null {
  return runtimeObjectRegistry.get(id) ?? null
}

function cloneVector(vector: Vector3Like): Vector3Like {
  return { x: vector.x, y: vector.y, z: vector.z }
}

function cloneCameraState(camera: SceneCameraState): SceneCameraState {
  return {
    position: cloneVector(camera.position),
    target: cloneVector(camera.target),
    fov: camera.fov,
  }
}

function visitNode(nodes: SceneNode[], id: string, mutate: (node: SceneNode) => void): boolean {
  for (const node of nodes) {
    if (node.id === id) {
      mutate(node)
      return true
    }
    if (node.children && visitNode(node.children, id, mutate)) {
      return true
    }
  }
  return false
}

function toHierarchyItem(node: SceneNode): HierarchyTreeItem {
  return {
    id: node.id,
    name: node.name,
    children: node.children?.map(toHierarchyItem),
  }
}

function cloneNode(node: SceneNode): SceneNode {
  return {
    ...node,
    position: cloneVector(node.position),
    rotation: cloneVector(node.rotation),
    scale: cloneVector(node.scale),
    children: node.children ? node.children.map(cloneNode) : undefined,
  }
}

function releaseRuntimeTree(node: SceneNode) {
  unregisterRuntimeObject(node.id)
  if (node.resourceId && node.resourceId !== node.id) {
    unregisterRuntimeObject(node.resourceId)
  }
  node.children?.forEach(releaseRuntimeTree)
}

function pruneNodes(nodes: SceneNode[], idSet: Set<string>, removed: string[]): SceneNode[] {
  const result: SceneNode[] = []
  for (const node of nodes) {
    if (idSet.has(node.id)) {
      removed.push(node.id)
      releaseRuntimeTree(node)
      continue
    }
    const cloned = cloneNode(node)
    if (cloned.children) {
      cloned.children = pruneNodes(cloned.children, idSet, removed)
      if (cloned.children.length === 0) {
        delete cloned.children
      }
    }
    result.push(cloned)
  }
  return result
}

function findDirectory(directories: ProjectDirectory[], id: string): ProjectDirectory | null {
  for (const dir of directories) {
    if (dir.id === id) return dir
    if (dir.children) {
      const found = findDirectory(dir.children, id)
      if (found) return found
    }
  }
  return null
}

function findNodeById(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const match = findNodeById(node.children, id)
      if (match) return match
    }
  }
  return null
}

function nodeContainsId(node: SceneNode, maybeChildId: string): boolean {
  if (!node.children) return false
  for (const child of node.children) {
    if (child.id === maybeChildId) return true
    if (nodeContainsId(child, maybeChildId)) return true
  }
  return false
}

function isDescendantNode(nodes: SceneNode[], ancestorId: string, childId: string): boolean {
  const ancestor = findNodeById(nodes, ancestorId)
  if (!ancestor) return false
  return nodeContainsId(ancestor, childId)
}

interface DetachResult {
  tree: SceneNode[]
  node: SceneNode | null
}

function detachNodeImmutable(nodes: SceneNode[], targetId: string): DetachResult {
  const nextTree: SceneNode[] = []
  let removed: SceneNode | null = null

  for (const node of nodes) {
    if (node.id === targetId) {
      removed = cloneNode(node)
      continue
    }

    const cloned = cloneNode(node)
    if (node.children) {
      const { tree: childTree, node: childRemoved } = detachNodeImmutable(node.children, targetId)
      if (childRemoved) {
        removed = childRemoved
      }
      if (childTree.length > 0) {
        cloned.children = childTree
      } else {
        delete cloned.children
      }
    }

    nextTree.push(cloned)
  }

  return { tree: nextTree, node: removed }
}

function insertNodeMutable(
  nodes: SceneNode[],
  targetId: string | null,
  node: SceneNode,
  position: HierarchyDropPosition,
): boolean {
  if (targetId === null) {
    if (position === 'before') {
      nodes.unshift(node)
    } else {
      nodes.push(node)
    }
    return true
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index]!
    if (current.id === targetId) {
      if (position === 'inside') {
        const children = current.children ? [...current.children, node] : [node]
        current.children = children
      } else if (position === 'before') {
        nodes.splice(index, 0, node)
      } else {
        nodes.splice(index + 1, 0, node)
      }
      return true
    }

    if (current.children) {
      const inserted = insertNodeMutable(current.children, targetId, node, position)
      if (inserted) {
        current.children = [...current.children]
        return true
      }
    }
  }

  return false
}


export const useSceneStore = defineStore('scene', {
  state: (): SceneState => ({
    nodes: initialNodes as SceneNode[],
    selectedNodeId: initialNodes[0]?.id ?? null,
    activeTool: 'select',
    projectTree,
    activeDirectoryId: defaultDirectoryId,
    selectedAssetId: null,
    camera: cloneCameraState(defaultCameraState),
    panelVisibility: { ...defaultPanelVisibility },
  }),
  getters: {
    selectedNode(state): SceneNode | null {
      if (!state.selectedNodeId) return null
      let result: SceneNode | null = null
      visitNode(state.nodes, state.selectedNodeId, (node) => {
        result = node
      })
      return result
    },
    hierarchyItems(state): HierarchyTreeItem[] {
      return state.nodes.map(toHierarchyItem)
    },
    currentDirectory(state): ProjectDirectory | null {
      if (!state.activeDirectoryId) return state.projectTree[0] ?? null
      return findDirectory(state.projectTree, state.activeDirectoryId)
    },
    currentAssets(): ProjectAsset[] {
      return this.currentDirectory?.assets ?? []
    },
  },
  actions: {
    setActiveTool(tool: EditorTool) {
      this.activeTool = tool
    },
    selectNode(id: string | null) {
      this.selectedNodeId = id
    },
    updateNodeTransform(payload: { id: string; position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
      visitNode(this.nodes, payload.id, (node) => {
        node.position = cloneVector(payload.position)
        node.rotation = cloneVector(payload.rotation)
        node.scale = cloneVector(payload.scale)
      })
    },
    updateNodeProperties(payload: TransformUpdatePayload) {
      visitNode(this.nodes, payload.id, (node) => {
        if (payload.position) node.position = cloneVector(payload.position)
        if (payload.rotation) node.rotation = cloneVector(payload.rotation)
        if (payload.scale) node.scale = cloneVector(payload.scale)
      })
      // trigger reactivity for listeners relying on reference changes
      this.nodes = [...this.nodes]
    },
    renameNode(id: string, name: string) {
      visitNode(this.nodes, id, (node) => {
        node.name = name
      })
      this.nodes = [...this.nodes]
    },
    updateNodeMaterial(id: string, material: Partial<SceneNode['material']>) {
      visitNode(this.nodes, id, (node) => {
        node.material = { ...node.material, ...material }
      })
      this.nodes = [...this.nodes]
    },
    setActiveDirectory(id: string) {
      this.activeDirectoryId = id
    },
    selectAsset(id: string | null) {
      this.selectedAssetId = id
    },
    addNodeFromAsset(asset: ProjectAsset) {
      const id = crypto.randomUUID()
      const newNode: SceneNode = {
        id,
        name: asset.name,
        geometry: 'box',
        material: { color: asset.previewColor },
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }
      this.nodes = [...this.nodes, newNode]
      this.selectedNodeId = id
    },
    setCameraState(camera: SceneCameraState) {
      this.camera = cloneCameraState(camera)
    },
    resetCameraState() {
      this.camera = cloneCameraState(defaultCameraState)
    },
    setPanelVisibility(panel: EditorPanel, visible: boolean) {
      this.panelVisibility = {
        ...this.panelVisibility,
        [panel]: visible,
      }
    },
    togglePanelVisibility(panel: EditorPanel) {
      this.setPanelVisibility(panel, !this.panelVisibility[panel])
    },

    isDescendant(ancestorId: string, maybeChildId: string) {
      if (!ancestorId || !maybeChildId) return false
      if (ancestorId === maybeChildId) return true
      return isDescendantNode(this.nodes, ancestorId, maybeChildId)
    },

    moveNode(payload: { nodeId: string; targetId: string | null; position: HierarchyDropPosition }) {
      const { nodeId, targetId, position } = payload
      if (!nodeId) return false
      if (targetId && nodeId === targetId) return false

      if (targetId && isDescendantNode(this.nodes, nodeId, targetId)) {
        return false
      }

      const { tree, node } = detachNodeImmutable(this.nodes, nodeId)
      if (!node) return false

      const inserted = insertNodeMutable(tree, targetId, node, position)
      if (!inserted) return false

      this.nodes = tree
      return true
    },

    addSceneNode(payload: {
      object: Object3D
      name?: string
      position?: Vector3Like
      rotation?: Vector3Like
      scale?: Vector3Like
    }) {
      const id = crypto.randomUUID()
      const node: SceneNode = {
        id,
        name: payload.name ?? payload.object.name ?? 'Imported Mesh',
        geometry: 'external',
        material: { color: '#ffffff' },
        position: payload.position ?? { x: 0, y: 0, z: 0 },
        rotation: payload.rotation ?? { x: 0, y: 0, z: 0 },
        scale: payload.scale ?? { x: 1, y: 1, z: 1 },
        resourceId: id,
      }

      registerRuntimeObject(id, payload.object)
      payload.object.userData.nodeId = id

      this.nodes = [...this.nodes, node]
      this.selectedNodeId = id

      return node
    },
    hasRuntimeObject(id: string) {
      return runtimeObjectRegistry.has(id)
    },
    releaseRuntimeObject(id: string) {
      unregisterRuntimeObject(id)
    },
    removeSceneNodes(ids: string[]) {
      const idSet = new Set(ids)
      if (idSet.size === 0) return

      const removed: string[] = []
      this.nodes = pruneNodes(this.nodes, idSet, removed)

      if (this.nodes.length === 0) {
        this.selectedNodeId = null
      } else if (this.selectedNodeId && removed.includes(this.selectedNodeId)) {
        this.selectedNodeId = this.nodes[0]?.id ?? null
      }
    },
  },
  persist: {
    key: 'scene-store',
    storage: 'local',
    version: 4,
    pick: [
      'nodes',
      'selectedNodeId',
      'activeTool',
      'activeDirectoryId',
      'selectedAssetId',
      'camera',
      'panelVisibility',
    ],
    migrations: {
      2: (state) => ({
        ...state,
        activeTool: (state.activeTool as EditorTool | undefined) ?? 'select',
      }),
      3: (state) => {
        const cameraState = state.camera as Partial<SceneCameraState> | undefined
        const panelState = state.panelVisibility as Partial<PanelVisibilityState> | undefined

        return {
          ...state,
          camera: {
            position: cloneVector(cameraState?.position ?? defaultCameraState.position),
            target: cloneVector(cameraState?.target ?? defaultCameraState.target),
            fov: cameraState?.fov ?? defaultCameraState.fov,
          },
          panelVisibility: {
            hierarchy: panelState?.hierarchy ?? defaultPanelVisibility.hierarchy,
            inspector: panelState?.inspector ?? defaultPanelVisibility.inspector,
            project: panelState?.project ?? defaultPanelVisibility.project,
          },
        }
      },
      4: (state) => {
        const rawNodes = state.nodes as SceneNode[] | undefined
        return {
          ...state,
          nodes: Array.isArray(rawNodes)
            ? rawNodes.filter((node) => (node as SceneNode).geometry !== 'external')
            : rawNodes,
        }
      },
    },
  },
})
