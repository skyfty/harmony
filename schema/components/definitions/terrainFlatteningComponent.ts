import type { Object3D } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../core'
import {
  clampTerrainFlatteningComponentProps,
  cloneTerrainFlatteningComponentProps,
  isTerrainFlatteningOwnerNode,
  registerLandscapeTerrainFlattening,
  unregisterLandscapeTerrainFlattening,
  updateLandscapeTerrainFlattening,
  type TerrainFlatteningComponentProps,
} from '../../proceduralLandscape/terrainFlattening'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

export const TERRAIN_FLATTENING_COMPONENT_TYPE = 'terrainFlattening'

export function createDefaultTerrainFlatteningComponentProps(
  node: SceneNode,
): TerrainFlatteningComponentProps {
  const wallThickness = node.dynamicMesh?.type === 'Wall'
    ? Math.max(0, Number(node.dynamicMesh.dimensions?.thickness) || 0)
    : 0
  return clampTerrainFlatteningComponentProps({
    heightMode: 'owner',
    manualHeight: Number(node.position?.y) || 0,
    edgeMode: 'slope',
    edgeBlendWidth: 8,
    corridorWidth: Math.max(4, wallThickness + 2),
    autoClearVegetation: true,
  })
}

class TerrainFlatteningComponent extends Component<TerrainFlatteningComponentProps> {
  private object: Object3D | null = null
  private propsValue: TerrainFlatteningComponentProps
  private enabled = true

  constructor(context: ComponentRuntimeContext<TerrainFlatteningComponentProps>) {
    super(context)
    this.propsValue = clampTerrainFlatteningComponentProps(context.getProps())
    this.enabled = context.isEnabled()
    this.register()
  }

  private get registrationId(): string {
    return `${this.context.nodeId}:${this.context.componentId}`
  }

  private register(): void {
    registerLandscapeTerrainFlattening({
      id: this.registrationId,
      ownerNodeId: this.context.nodeId,
      componentId: this.context.componentId,
      resolveNode: () => this.context.getNode(),
      object: this.object,
      props: this.propsValue,
      enabled: this.enabled,
    })
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.object = object
    this.register()
    this.context.markDirty()
  }

  onPropsUpdated(next: Readonly<TerrainFlatteningComponentProps>): void {
    this.propsValue = clampTerrainFlatteningComponentProps(next)
    updateLandscapeTerrainFlattening(this.registrationId, {
      props: this.propsValue,
      enabled: this.enabled,
    })
    this.context.markDirty()
  }

  onEnabledChanged(enabled: boolean): void {
    this.enabled = enabled
    updateLandscapeTerrainFlattening(this.registrationId, { enabled })
    this.context.markDirty()
  }

  onDestroy(): void {
    unregisterLandscapeTerrainFlattening(this.registrationId)
  }
}

const terrainFlatteningComponentDefinition: ComponentDefinition<TerrainFlatteningComponentProps> = {
  type: TERRAIN_FLATTENING_COMPONENT_TYPE,
  label: 'Terrain Flattening',
  icon: 'mdi-layers-edit',
  order: 95,
  description: 'Flatten DEM terrain beneath a Floor or Region polygon, or along a Wall corridor.',
  canAttach(node: SceneNode) {
    return isTerrainFlatteningOwnerNode(node)
  },
  createDefaultProps(node) {
    return createDefaultTerrainFlatteningComponentProps(node)
  },
  createInstance(context) {
    return new TerrainFlatteningComponent(context)
  },
}

componentManager.registerDefinition(terrainFlatteningComponentDefinition)

export function createTerrainFlatteningComponentState(
  node: SceneNode,
  overrides?: Partial<TerrainFlatteningComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<TerrainFlatteningComponentProps> {
  const defaults = createDefaultTerrainFlatteningComponentProps(node)
  return {
    id: options.id ?? '',
    type: TERRAIN_FLATTENING_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: cloneTerrainFlatteningComponentProps(clampTerrainFlatteningComponentProps({
      ...defaults,
      ...overrides,
    })),
  }
}

export {
  terrainFlatteningComponentDefinition,
  clampTerrainFlatteningComponentProps,
  cloneTerrainFlatteningComponentProps,
  type TerrainFlatteningComponentProps,
}
