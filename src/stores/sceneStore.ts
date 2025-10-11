import { defineStore } from 'pinia'
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

interface SceneState {
  nodes: SceneNode[]
  selectedNodeId: string | null
  activeTool: EditorTool
  projectTree: ProjectDirectory[]
  activeDirectoryId: string | null
  selectedAssetId: string | null
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
      {
        id: 'dir-assets-materials2',
        name: 'Materials',
        assets: [
          { id: 'asset-steel', name: 'Brushed Steel', type: 'image', previewColor: '#90A4AE' },
          { id: 'asset-holo', name: 'Holographic', type: 'image', previewColor: '#7E57C2' },
        ],
      },
      {
        id: 'dir-assets-materials3',
        name: 'Materials',
        assets: [
          { id: 'asset-steel', name: 'Brushed Steel', type: 'image', previewColor: '#90A4AE' },
          { id: 'asset-holo', name: 'Holographic', type: 'image', previewColor: '#7E57C2' },
        ],
      },
      {
        id: 'dir-assets-materials4',
        name: 'Materials',
        assets: [
          { id: 'asset-steel', name: 'Brushed Steel', type: 'image', previewColor: '#90A4AE' },
          { id: 'asset-holo', name: 'Holographic', type: 'image', previewColor: '#7E57C2' },
        ],
      },
      {
        id: 'dir-assets-materials5',
        name: 'Materials',
        assets: [
          { id: 'asset-steel', name: 'Brushed Steel', type: 'image', previewColor: '#90A4AE' },
          { id: 'asset-holo', name: 'Holographic', type: 'image', previewColor: '#7E57C2' },
        ],
      },
      {
        id: 'dir-assets-materials6',
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

function cloneVector(vector: Vector3Like): Vector3Like {
  return { x: vector.x, y: vector.y, z: vector.z }
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


export const useSceneStore = defineStore('scene', {
  state: (): SceneState => ({
    nodes: initialNodes as SceneNode[],
    selectedNodeId: initialNodes[0]?.id ?? null,
    activeTool: 'select',
    projectTree,
    activeDirectoryId: defaultDirectoryId,
    selectedAssetId: null,
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
  },
  persist: {
    key: 'scene-store',
    storage: 'local',
    version: 2,
    pick: ['nodes', 'selectedNodeId', 'activeTool', 'activeDirectoryId', 'selectedAssetId'],
    migrations: {
      2: (state) => ({
        ...state,
        activeTool: (state.activeTool as EditorTool | undefined) ?? 'select',
      }),
    },
  },
})
