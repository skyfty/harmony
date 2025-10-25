import { defineStore } from 'pinia'

export type PrimitiveType = 'box' | 'sphere' | 'plane' | 'cylinder'
export type LightType = 'ambient' | 'directional' | 'hemisphere'
export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface TresSceneNodeBase {
  id: string
  name: string
  kind: 'primitive' | 'light'
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  visible: boolean
}

export interface TresPrimitiveNode extends TresSceneNodeBase {
  kind: 'primitive'
  primitive: PrimitiveType
  color: string
  metalness: number
  roughness: number
  castShadow: boolean
  receiveShadow: boolean
}

export interface TresLightNode extends TresSceneNodeBase {
  kind: 'light'
  light: LightType
  color: string
  intensity: number
  castShadow: boolean
}

export type TresSceneNode = TresPrimitiveNode | TresLightNode

export interface TresSceneState {
  nodes: TresSceneNode[]
  selectedNodeId: string | null
  transformMode: TransformMode
  showGrid: boolean
  showHelpers: boolean
  backgroundColor: string
  environmentIntensity: number
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  const random = Math.random().toString(16).slice(2)
  const timestamp = Date.now().toString(16)
  return `${prefix}-${timestamp}-${random}`
}

function createPrimitiveNode(partial: Partial<TresPrimitiveNode> & Pick<TresPrimitiveNode, 'primitive'>): TresPrimitiveNode {
  return {
    id: partial.id ?? generateId('node'),
    name: partial.name ?? 'Primitive',
    kind: 'primitive',
    primitive: partial.primitive,
    color: partial.color ?? '#9bbcf2',
    metalness: partial.metalness ?? 0.15,
    roughness: partial.roughness ?? 0.6,
    castShadow: partial.castShadow ?? true,
    receiveShadow: partial.receiveShadow ?? true,
    position: partial.position ?? [0, 0, 0],
    rotation: partial.rotation ?? [0, 0, 0],
    scale: partial.scale ?? [1, 1, 1],
    visible: partial.visible ?? true,
  }
}

function createLightNode(partial: Partial<TresLightNode> & Pick<TresLightNode, 'light'>): TresLightNode {
  return {
    id: partial.id ?? generateId('light'),
    name: partial.name ?? `${partial.light.charAt(0).toUpperCase()}${partial.light.slice(1)} Light`,
    kind: 'light',
    light: partial.light,
    color: partial.color ?? '#ffffff',
    intensity: partial.intensity ?? 1,
    castShadow: partial.castShadow ?? (partial.light === 'directional'),
    position: partial.position ?? [2, 2, 2],
    rotation: partial.rotation ?? [0, 0, 0],
    scale: partial.scale ?? [1, 1, 1],
    visible: partial.visible ?? true,
  }
}

function cloneNode(node: TresSceneNode): TresSceneNode {
  if (node.kind === 'primitive') {
    return {
      ...node,
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      scale: [...node.scale] as [number, number, number],
    }
  }
  return {
    ...node,
    position: [...node.position] as [number, number, number],
    rotation: [...node.rotation] as [number, number, number],
    scale: [...node.scale] as [number, number, number],
  }
}

export const useTresSceneStore = defineStore('tres-scene', {
  state: (): TresSceneState => ({
    nodes: [],
    selectedNodeId: null,
    transformMode: 'translate',
    showGrid: true,
    showHelpers: true,
    backgroundColor: '#1a1d24',
    environmentIntensity: 0.75,
  }),
  getters: {
    selectedNode(state): TresSceneNode | null {
      return state.nodes.find((node) => node.id === state.selectedNodeId) ?? null
    },
    primitiveNodes(state): TresPrimitiveNode[] {
      return state.nodes.filter((node): node is TresPrimitiveNode => node.kind === 'primitive')
    },
    lightNodes(state): TresLightNode[] {
      return state.nodes.filter((node): node is TresLightNode => node.kind === 'light')
    },
  },
  actions: {
    initializeDefaultScene() {
      if (this.nodes.length) {
        return
      }
      const ground = createPrimitiveNode({
        name: 'Ground',
        primitive: 'plane',
        color: '#2e3344',
        position: [0, -0.001, 0],
        rotation: [-Math.PI / 2, 0, 0],
        scale: [20, 20, 20],
        receiveShadow: true,
        castShadow: false,
      })
      const cube = createPrimitiveNode({
        name: 'Cube',
        primitive: 'box',
        position: [0, 0.5, 0],
        scale: [1, 1, 1],
        color: '#7fbdf0',
      })
      const sphere = createPrimitiveNode({
        name: 'Sphere',
        primitive: 'sphere',
        position: [2.5, 0.75, -1.5],
        scale: [0.75, 0.75, 0.75],
        color: '#f0a97f',
      })
      const ambient = createLightNode({
        light: 'ambient',
        intensity: 0.35,
        color: '#ffffff',
        position: [0, 3, 0],
        castShadow: false,
      })
      const directional = createLightNode({
        light: 'directional',
        intensity: 1.2,
        color: '#ffffff',
        position: [6, 8, 6],
        castShadow: true,
      })

      this.nodes = [ground, cube, sphere, ambient, directional]
      this.selectedNodeId = cube.id
    },
    selectNode(nodeId: string | null) {
      this.selectedNodeId = nodeId
    },
    addPrimitive(primitive: PrimitiveType) {
      const nameMap: Record<PrimitiveType, string> = {
        box: 'Box',
        sphere: 'Sphere',
        plane: 'Plane',
        cylinder: 'Cylinder',
      }
      const height = primitive === 'sphere' ? 0.75 : 0.5
      const node = createPrimitiveNode({
        primitive,
        name: nameMap[primitive],
        position: [Math.random() * 4 - 2, height, Math.random() * 4 - 2],
        scale: primitive === 'plane' ? [3, 3, 3] : [1, 1, 1],
        rotation: primitive === 'plane' ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
      })
      this.nodes.push(node)
      this.selectedNodeId = node.id
    },
    addLight(light: LightType) {
      const node = createLightNode({
        light,
        position: light === 'directional' ? [4, 6, 3] : [0, 3, 0],
        intensity: light === 'ambient' ? 0.3 : 1,
      })
      this.nodes.push(node)
      this.selectedNodeId = node.id
    },
    updateNode(nodeId: string, payload: Partial<TresSceneNode>) {
      const index = this.nodes.findIndex((node) => node.id === nodeId)
      if (index === -1) {
        return
      }
      const current = this.nodes[index]!
      let next: TresSceneNode
      if (current.kind === 'primitive') {
        const primitivePayload = payload as Partial<TresPrimitiveNode>
        next = {
          ...current,
          ...primitivePayload,
          kind: 'primitive',
          primitive: primitivePayload.primitive ?? current.primitive,
          position: primitivePayload.position ? [...primitivePayload.position] as [number, number, number] : current.position,
          rotation: primitivePayload.rotation ? [...primitivePayload.rotation] as [number, number, number] : current.rotation,
          scale: primitivePayload.scale ? [...primitivePayload.scale] as [number, number, number] : current.scale,
        }
      } else {
        const lightPayload = payload as Partial<TresLightNode>
        next = {
          ...current,
          ...lightPayload,
          kind: 'light',
          light: lightPayload.light ?? current.light,
          position: lightPayload.position ? [...lightPayload.position] as [number, number, number] : current.position,
          rotation: lightPayload.rotation ? [...lightPayload.rotation] as [number, number, number] : current.rotation,
          scale: lightPayload.scale ? [...lightPayload.scale] as [number, number, number] : current.scale,
        }
      }
      this.nodes.splice(index, 1, next)
    },
    updateNodeVector(nodeId: string, key: 'position' | 'rotation' | 'scale', axis: number, value: number) {
      const node = this.nodes.find((entry) => entry.id === nodeId)
      if (!node) {
        return
      }
      const nextTuple = [...node[key]] as [number, number, number]
      nextTuple[axis] = value
      this.updateNode(nodeId, { [key]: nextTuple } as Partial<TresSceneNode>)
    },
    updateNodeColor(nodeId: string, color: string) {
      const node = this.nodes.find((entry) => entry.id === nodeId)
      if (!node) {
        return
      }
      this.updateNode(nodeId, { color })
    },
    updateLightIntensity(nodeId: string, intensity: number) {
      const node = this.nodes.find((entry): entry is TresLightNode => entry.id === nodeId && entry.kind === 'light')
      if (!node) {
        return
      }
      this.updateNode(nodeId, { intensity })
    },
    removeNode(nodeId: string) {
      const index = this.nodes.findIndex((node) => node.id === nodeId)
      if (index === -1) {
        return
      }
      const [removed] = this.nodes.splice(index, 1)
      if (!removed) {
        return
      }
      if (removed.id === this.selectedNodeId) {
        const fallback = this.nodes.length ? this.nodes[Math.max(index - 1, 0)] ?? this.nodes[0] : null
        this.selectedNodeId = fallback ? fallback.id : null
      }
    },
    duplicateNode(nodeId: string) {
      const node = this.nodes.find((entry) => entry.id === nodeId)
      if (!node) {
        return
      }
      const clone = cloneNode(node)
      clone.id = generateId(clone.kind === 'primitive' ? 'node' : 'light')
      clone.name = `${node.name} Copy`
      clone.position = [node.position[0] + 0.25, node.position[1], node.position[2] + 0.25]
      this.nodes.push(clone)
      this.selectedNodeId = clone.id
    },
    clearScene() {
      this.nodes = []
      this.selectedNodeId = null
    },
    setTransformMode(mode: TransformMode) {
      this.transformMode = mode
    },
    toggleGrid() {
      this.showGrid = !this.showGrid
    },
    toggleHelpers() {
      this.showHelpers = !this.showHelpers
    },
    setBackgroundColor(color: string) {
      this.backgroundColor = color
    },
    setEnvironmentIntensity(intensity: number) {
      this.environmentIntensity = Math.max(0, intensity)
    },
  },
})
