import { defineStore } from 'pinia'
import type { Object3D } from 'three'
import type { SceneNode, Vector3Like } from '@/types/scene'

export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale'

export interface ProjectAsset {
  id: string
  name: string
  type: 'model' | 'texture' | 'image' | 'audio' | 'file'
  description?: string
  previewColor: string
  thumbnail?: string | null
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

export interface StoredSceneDocument {
  id: string
  name: string
  thumbnail?: string | null
  nodes: SceneNode[]
  selectedNodeId: string | null
  camera: SceneCameraState
  resourceProviderId: string
}

export interface SceneSummary {
  id: string
  name: string
  thumbnail?: string | null
}

interface SceneState {
  scenes: StoredSceneDocument[]
  currentSceneId: string | null
  nodes: SceneNode[]
  selectedNodeId: string | null
  activeTool: EditorTool
  projectTree: ProjectDirectory[]
  activeDirectoryId: string | null
  selectedAssetId: string | null
  camera: SceneCameraState
  panelVisibility: PanelVisibilityState
  resourceProviderId: string
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

const builtinProjectTree: ProjectDirectory[] = [
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

function cloneProjectTree(tree: ProjectDirectory[]): ProjectDirectory[] {
  return tree.map((directory) => ({
    ...directory,
    children: directory.children ? cloneProjectTree(directory.children) : undefined,
    assets: directory.assets ? directory.assets.map((asset) => ({ ...asset })) : undefined,
  }))
}

function findFirstDirectoryId(tree: ProjectDirectory[]): string | null {
  for (const directory of tree) {
    if (directory.assets && directory.assets.length) {
      return directory.id
    }
    if (directory.children) {
      const nested = findFirstDirectoryId(directory.children)
      if (nested) {
        return nested
      }
    }
  }
  return tree[0]?.id ?? null
}

const defaultDirectoryId = findFirstDirectoryId(builtinProjectTree)

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

const initialSceneDocument = createSceneDocument('Sample Scene', {
  nodes: initialNodes,
  selectedNodeId: initialNodes[0]?.id ?? null,
  resourceProviderId: 'builtin',
})

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

function cloneSceneNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.map(cloneNode)
}

function createSceneDocument(
  name: string,
  options: {
    id?: string
    nodes?: SceneNode[]
    selectedNodeId?: string | null
    camera?: SceneCameraState
    thumbnail?: string | null
    resourceProviderId?: string
  } = {},
): StoredSceneDocument {
  const id = options.id ?? crypto.randomUUID()
  const nodes = options.nodes ? cloneSceneNodes(options.nodes) : []
  const camera = options.camera ? cloneCameraState(options.camera) : cloneCameraState(defaultCameraState)
  let selectedNodeId = options.selectedNodeId ?? (nodes[0]?.id ?? null)
  if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
    selectedNodeId = nodes[0]?.id ?? null
  }

  return {
    id,
    name,
    thumbnail: options.thumbnail ?? null,
    nodes,
    selectedNodeId,
    camera,
    resourceProviderId: options.resourceProviderId ?? 'builtin',
  }
}

function commitSceneSnapshot(
  store: SceneState,
  options: { updateNodes?: boolean; updateCamera?: boolean } = {},
) {
  if (!store.currentSceneId) return
  const index = store.scenes.findIndex((scene) => scene.id === store.currentSceneId)
  if (index === -1) return

  const updateNodes = options.updateNodes ?? true
  const updateCamera = options.updateCamera ?? true
  const current = store.scenes[index]!

  const updatedScene: StoredSceneDocument = {
    ...current,
    nodes: updateNodes ? cloneSceneNodes(store.nodes) : current.nodes,
    selectedNodeId: store.selectedNodeId,
    camera: updateCamera ? cloneCameraState(store.camera) : current.camera,
    resourceProviderId: store.resourceProviderId,
  }

  store.scenes = [
    ...store.scenes.slice(0, index),
    updatedScene,
    ...store.scenes.slice(index + 1),
  ]
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

function findAssetInTree(directories: ProjectDirectory[], assetId: string): ProjectAsset | null {
  for (const dir of directories) {
    if (dir.assets) {
      const asset = dir.assets.find((item) => item.id === assetId)
      if (asset) return asset
    }
    if (dir.children) {
      const found = findAssetInTree(dir.children, assetId)
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
    scenes: [initialSceneDocument],
    currentSceneId: initialSceneDocument.id,
    nodes: cloneSceneNodes(initialSceneDocument.nodes),
    selectedNodeId: initialSceneDocument.selectedNodeId,
    activeTool: 'select',
    projectTree: cloneProjectTree(builtinProjectTree),
    activeDirectoryId: defaultDirectoryId,
    selectedAssetId: null,
    camera: cloneCameraState(initialSceneDocument.camera),
    panelVisibility: { ...defaultPanelVisibility },
    resourceProviderId: initialSceneDocument.resourceProviderId,
  }),
  getters: {
    currentScene(state): StoredSceneDocument | null {
      if (!state.scenes.length) {
        return null
      }
      if (state.currentSceneId) {
        const current = state.scenes.find((scene) => scene.id === state.currentSceneId)
        if (current) {
          return current
        }
      }
      return state.scenes[0] ?? null
    },
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
    sceneSummaries(state): SceneSummary[] {
      return state.scenes.map((scene) => ({
        id: scene.id,
        name: scene.name,
        thumbnail: scene.thumbnail ?? null,
      }))
    },
    currentDirectory(state): ProjectDirectory | null {
      if (!state.activeDirectoryId) return state.projectTree[0] ?? null
      return findDirectory(state.projectTree, state.activeDirectoryId)
    },
    currentAssets(state): ProjectAsset[] {
      const directory = state.activeDirectoryId
        ? findDirectory(state.projectTree, state.activeDirectoryId)
        : state.projectTree[0] ?? null
      return directory?.assets ?? []
    },
  },
  actions: {
    setActiveTool(tool: EditorTool) {
      this.activeTool = tool
    },
    selectNode(id: string | null) {
      this.selectedNodeId = id
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
    },
    updateNodeTransform(payload: { id: string; position: Vector3Like; rotation: Vector3Like; scale: Vector3Like }) {
      visitNode(this.nodes, payload.id, (node) => {
        node.position = cloneVector(payload.position)
        node.rotation = cloneVector(payload.rotation)
        node.scale = cloneVector(payload.scale)
      })
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    updateNodeProperties(payload: TransformUpdatePayload) {
      visitNode(this.nodes, payload.id, (node) => {
        if (payload.position) node.position = cloneVector(payload.position)
        if (payload.rotation) node.rotation = cloneVector(payload.rotation)
        if (payload.scale) node.scale = cloneVector(payload.scale)
      })
      // trigger reactivity for listeners relying on reference changes
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    renameNode(id: string, name: string) {
      visitNode(this.nodes, id, (node) => {
        node.name = name
      })
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    updateNodeMaterial(id: string, material: Partial<SceneNode['material']>) {
      visitNode(this.nodes, id, (node) => {
        node.material = { ...node.material, ...material }
      })
      this.nodes = [...this.nodes]
      commitSceneSnapshot(this)
    },
    setActiveDirectory(id: string) {
      this.activeDirectoryId = id
    },
    selectAsset(id: string | null) {
      this.selectedAssetId = id
    },
    addNodeFromAsset(asset: ProjectAsset, position?: Vector3Like) {
      const id = crypto.randomUUID()
      const scale: Vector3Like = { x: 1, y: 1, z: 1 }

      const spawnPosition = position ? cloneVector(position) : { x: 0, y: 0, z: 0 }

      if (!position && asset.type !== 'model') {
        spawnPosition.y = 1
      }

      if (asset.type === 'model') {
        const baseHeight = Math.max(scale.y, 0)
        const offset = baseHeight / 2
        spawnPosition.y = (position?.y ?? spawnPosition.y) + offset
      }

      const newNode: SceneNode = {
        id,
        name: asset.name,
        geometry: 'box',
        material: { color: asset.previewColor },
        position: spawnPosition,
        rotation: { x: 0, y: 0, z: 0 },
        scale,
      }
      this.nodes = [...this.nodes, newNode]
      this.selectedNodeId = id
      commitSceneSnapshot(this)
    },
    spawnAssetAtPosition(assetId: string, position: Vector3Like) {
      const asset = findAssetInTree(this.projectTree, assetId)
      if (!asset) return null
      this.addNodeFromAsset(asset, position)
      return asset
    },
    resetProjectTree() {
      this.projectTree = cloneProjectTree(builtinProjectTree)
      this.activeDirectoryId = findFirstDirectoryId(this.projectTree)
      this.selectedAssetId = null
    },
    setProjectTree(directories: ProjectDirectory[]) {
      this.projectTree = cloneProjectTree(directories)
      this.activeDirectoryId = findFirstDirectoryId(this.projectTree)
      this.selectedAssetId = null
    },
    setResourceProviderId(providerId: string) {
      if (this.resourceProviderId === providerId) {
        return
      }
      this.resourceProviderId = providerId
      commitSceneSnapshot(this, { updateNodes: false, updateCamera: false })
    },
    setCameraState(camera: SceneCameraState) {
      this.camera = cloneCameraState(camera)
      commitSceneSnapshot(this, { updateNodes: false })
    },
    resetCameraState() {
      this.camera = cloneCameraState(defaultCameraState)
      commitSceneSnapshot(this, { updateNodes: false })
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
      commitSceneSnapshot(this)
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
      commitSceneSnapshot(this)

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
      commitSceneSnapshot(this)
    },
    createScene(name = 'Untitled Scene', thumbnail?: string | null) {
      commitSceneSnapshot(this)
      const displayName = name.trim() || 'Untitled Scene'
      const scene = createSceneDocument(displayName, {
        thumbnail: thumbnail ?? null,
        resourceProviderId: this.resourceProviderId,
      })
      this.scenes = [...this.scenes, scene]
      this.currentSceneId = scene.id
      this.nodes = cloneSceneNodes(scene.nodes)
      this.selectedNodeId = scene.selectedNodeId
      this.camera = cloneCameraState(scene.camera)
      this.resourceProviderId = scene.resourceProviderId
      return scene.id
    },
    selectScene(sceneId: string) {
      if (sceneId === this.currentSceneId) {
        return true
      }
      commitSceneSnapshot(this)
      const scene = this.scenes.find((item) => item.id === sceneId)
      if (!scene) {
        return false
      }
      this.currentSceneId = sceneId
      this.nodes = cloneSceneNodes(scene.nodes)
      this.selectedNodeId = scene.selectedNodeId
      this.camera = cloneCameraState(scene.camera)
      this.resourceProviderId = scene.resourceProviderId ?? 'builtin'
      return true
    },
    deleteScene(sceneId: string) {
      commitSceneSnapshot(this)
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }

      const target = this.scenes[index]!
      target.nodes.forEach((node) => releaseRuntimeTree(node))

      const remaining = this.scenes.filter((scene) => scene.id !== sceneId)

      if (remaining.length === 0) {
        const fallback = createSceneDocument('Untitled Scene', { resourceProviderId: 'builtin' })
        this.scenes = [fallback]
        this.currentSceneId = fallback.id
        this.nodes = cloneSceneNodes(fallback.nodes)
        this.selectedNodeId = fallback.selectedNodeId
        this.camera = cloneCameraState(fallback.camera)
        this.resourceProviderId = fallback.resourceProviderId
        return true
      }

      this.scenes = remaining

      if (this.currentSceneId === sceneId) {
        const next = remaining[0]!
        this.currentSceneId = next.id
        this.nodes = cloneSceneNodes(next.nodes)
        this.selectedNodeId = next.selectedNodeId
        this.camera = cloneCameraState(next.camera)
        this.resourceProviderId = next.resourceProviderId ?? 'builtin'
      }

      return true
    },
    renameScene(sceneId: string, name: string) {
      const trimmed = name.trim()
      if (!trimmed) {
        return false
      }
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }
      const scene = this.scenes[index]!
      const updated: StoredSceneDocument = {
        ...scene,
        name: trimmed,
      }
      this.scenes = [
        ...this.scenes.slice(0, index),
        updated,
        ...this.scenes.slice(index + 1),
      ]
      return true
    },
    updateSceneThumbnail(sceneId: string, thumbnail: string | null) {
      const index = this.scenes.findIndex((scene) => scene.id === sceneId)
      if (index === -1) {
        return false
      }
      const scene = this.scenes[index]!
      const updated: StoredSceneDocument = {
        ...scene,
        thumbnail,
      }
      this.scenes = [
        ...this.scenes.slice(0, index),
        updated,
        ...this.scenes.slice(index + 1),
      ]
      return true
    },
    ensureCurrentSceneLoaded() {
      if (!this.scenes.length) {
        const fallback = createSceneDocument('Untitled Scene', { resourceProviderId: 'builtin' })
        this.scenes = [fallback]
        this.currentSceneId = fallback.id
        this.nodes = cloneSceneNodes(fallback.nodes)
        this.selectedNodeId = fallback.selectedNodeId
        this.camera = cloneCameraState(fallback.camera)
        this.resourceProviderId = fallback.resourceProviderId
        return
      }
      if (!this.currentSceneId || !this.scenes.some((scene) => scene.id === this.currentSceneId)) {
        const first = this.scenes[0]!
        this.currentSceneId = first.id
        this.nodes = cloneSceneNodes(first.nodes)
        this.selectedNodeId = first.selectedNodeId
        this.camera = cloneCameraState(first.camera)
        this.resourceProviderId = first.resourceProviderId ?? 'builtin'
        return
      }
      const current = this.scenes.find((scene) => scene.id === this.currentSceneId)
      if (current) {
        this.nodes = cloneSceneNodes(current.nodes)
        this.selectedNodeId = current.selectedNodeId
        this.camera = cloneCameraState(current.camera)
        this.resourceProviderId = current.resourceProviderId ?? 'builtin'
      }
    },
  },
  persist: {
    key: 'scene-store',
    storage: 'local',
    version: 6,
    pick: [
      'scenes',
      'currentSceneId',
      'nodes',
      'selectedNodeId',
      'activeTool',
      'activeDirectoryId',
      'selectedAssetId',
      'camera',
      'panelVisibility',
      'resourceProviderId',
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
      5: (state) => {
        const existingScenes = state.scenes as StoredSceneDocument[] | undefined
        if (Array.isArray(existingScenes) && existingScenes.length > 0) {
          return state
        }

        const rawNodes = (state.nodes as SceneNode[] | undefined) ?? []
        const selectedNodeId = (state.selectedNodeId as string | null | undefined) ?? null
        const cameraState = state.camera as Partial<SceneCameraState> | undefined

        const camera: SceneCameraState = {
          position: cloneVector(cameraState?.position ?? defaultCameraState.position),
          target: cloneVector(cameraState?.target ?? defaultCameraState.target),
          fov: cameraState?.fov ?? defaultCameraState.fov,
        }

        const recoveredScene = createSceneDocument('Recovered Scene', {
          nodes: rawNodes,
          selectedNodeId,
          camera,
          resourceProviderId: (state.resourceProviderId as string | undefined) ?? 'builtin',
        })

        return {
          ...state,
          scenes: [recoveredScene],
          currentSceneId: recoveredScene.id,
          nodes: cloneSceneNodes(recoveredScene.nodes),
          selectedNodeId: recoveredScene.selectedNodeId,
          camera: cloneCameraState(recoveredScene.camera),
        }
      },
      6: (state) => {
        const scenes = state.scenes as StoredSceneDocument[] | undefined
        const updatedScenes = Array.isArray(scenes)
          ? scenes.map((scene) => ({
              ...scene,
              resourceProviderId: scene.resourceProviderId ?? 'builtin',
            }))
          : scenes

        return {
          ...state,
          scenes: updatedScenes,
          resourceProviderId: (state.resourceProviderId as string | undefined) ?? 'builtin',
        }
      },
    },
  },
})
