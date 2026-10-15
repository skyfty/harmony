import { Vector3, type Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../core'
import {
  clampProceduralLandscapeProps,
  cloneProceduralLandscapeProps,
  createDefaultProceduralLandscapeProps,
  type ProceduralLandscapeComponentProps,
} from '../../proceduralLandscape/config'
import {
  createProceduralLandscapeRuntime,
  type ProceduralLandscapeRuntime,
} from '../../proceduralLandscape/runtime'

export const PROCEDURAL_LANDSCAPE_COMPONENT_TYPE = 'proceduralLandscape'

/** Update filter used by the editor viewport to drive only this component. */
export const PROCEDURAL_LANDSCAPE_UPDATE_TYPES: ReadonlySet<string> = new Set([PROCEDURAL_LANDSCAPE_COMPONENT_TYPE])

const cameraWorldPositionScratch = new Vector3()

class ProceduralLandscapeComponent extends Component<ProceduralLandscapeComponentProps> {
  private readonly runtime: ProceduralLandscapeRuntime

  constructor(context: ComponentRuntimeContext<ProceduralLandscapeComponentProps>) {
    super(context)
    this.runtime = createProceduralLandscapeRuntime({
      nodeId: context.nodeId,
      componentId: context.componentId,
      getHostObject: () => this.context.getRuntimeObject(),
      getCameraWorldPosition: () => {
        const frameState = this.context.getFrameState()
        const position = frameState.cameraWorldPosition
        if (!position) {
          return null
        }
        cameraWorldPositionScratch.set(position.x, position.y, position.z)
        return cameraWorldPositionScratch
      },
      getSeasonState: () => {
        const frameState = this.context.getFrameState()
        const environment = frameState.environment
        if (!environment) {
          return null
        }
        return {
          season: environment.season,
          timeOfDay: environment.timeOfDay,
          weather: environment.weather,
        }
      },
    })
    // The context already carries the persisted props (for example when a saved
    // scene is loaded); seed the runtime with them instead of the bare defaults.
    this.runtime.setProps(clampProceduralLandscapeProps(context.getProps(), context.nodeId))
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.runtime.attach(object)
  }

  onPropsUpdated(next: Readonly<ProceduralLandscapeComponentProps>): void {
    this.runtime.setProps(clampProceduralLandscapeProps(next, this.context.nodeId))
  }

  onEnabledChanged(enabled: boolean): void {
    this.runtime.setEnabled(enabled)
  }

  onUpdate(deltaTime: number): void {
    this.runtime.update(deltaTime)
  }

  onDestroy(): void {
    this.runtime.dispose()
  }
}

const proceduralLandscapeComponentDefinition: ComponentDefinition<ProceduralLandscapeComponentProps> = {
  type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
  label: 'Procedural Landscape',
  icon: 'mdi-forest',
  order: 93,
  description: 'Runtime generated grass, forest and a slowroads-style road on an imported terrain mesh.',
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType
    if (nodeType !== 'Mesh' && nodeType !== 'Group') {
      return false
    }
    const sourceAssetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : ''
    if (sourceAssetId.length) {
      return true
    }
    const metadata = node.importMetadata
    return metadata?.lightweight === true
      && typeof metadata.assetId === 'string'
      && metadata.assetId.trim().length > 0
  },
  createDefaultProps(node: SceneNode) {
    return createDefaultProceduralLandscapeProps(node)
  },
  createInstance(context) {
    return new ProceduralLandscapeComponent(context)
  },
}

componentManager.registerDefinition(proceduralLandscapeComponentDefinition)

export function createProceduralLandscapeComponentState(
  node: SceneNode,
  overrides?: Partial<ProceduralLandscapeComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<ProceduralLandscapeComponentProps> {
  const defaults = proceduralLandscapeComponentDefinition.createDefaultProps(node)
  const merged: ProceduralLandscapeComponentProps = {
    ...defaults,
    ...overrides,
    sampling: { ...defaults.sampling, ...(overrides?.sampling ?? {}) },
    surface: { ...defaults.surface, ...(overrides?.surface ?? {}) },
    road: { ...defaults.road, ...(overrides?.road ?? {}) },
    forest: { ...defaults.forest, ...(overrides?.forest ?? {}) },
    grass: { ...defaults.grass, ...(overrides?.grass ?? {}) },
    bushes: { ...defaults.bushes, ...(overrides?.bushes ?? {}) },
    canopy: { ...defaults.canopy, ...(overrides?.canopy ?? {}) },
    water: { ...defaults.water, ...(overrides?.water ?? {}) },
    barrier: { ...defaults.barrier, ...(overrides?.barrier ?? {}) },
    wind: { ...defaults.wind, ...(overrides?.wind ?? {}) },
    debug: { ...defaults.debug, ...(overrides?.debug ?? {}) },
  }
  return {
    id: options.id ?? '',
    type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: cloneProceduralLandscapeProps(merged),
  }
}

export { proceduralLandscapeComponentDefinition }
export type {
  ProceduralLandscapeComponentProps,
  ProceduralLandscapeQuality,
} from '../../proceduralLandscape/config'
