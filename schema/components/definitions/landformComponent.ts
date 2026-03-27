import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { LandformDynamicMesh, SceneNodeComponentState, SceneNode, Vector2Like } from '../../index'

export const LANDFORM_COMPONENT_TYPE = 'landform'
export const LANDFORM_DEFAULT_FEATHER = 1
export const LANDFORM_MIN_FEATHER = 0
export const LANDFORM_MAX_FEATHER = 50
export const LANDFORM_DEFAULT_UV_SCALE: { x: number; y: number } = { x: 1, y: 1 }

export interface LandformComponentProps {
  feather: number
  uvScale: { x: number; y: number }
}

export function clampLandformComponentProps(props: Partial<LandformComponentProps> | null | undefined): LandformComponentProps {
  const featherRaw = typeof props?.feather === 'number' && Number.isFinite(props.feather)
    ? props.feather
    : LANDFORM_DEFAULT_FEATHER
  const feather = Math.min(LANDFORM_MAX_FEATHER, Math.max(LANDFORM_MIN_FEATHER, featherRaw))

  const uvScaleRaw = props?.uvScale as Vector2Like | null | undefined
  const scaleX = typeof (uvScaleRaw as any)?.x === 'number' ? Number((uvScaleRaw as any).x) : Number.NaN
  const scaleY = typeof (uvScaleRaw as any)?.y === 'number' ? Number((uvScaleRaw as any).y) : Number.NaN
  const uvScale = {
    x: Number.isFinite(scaleX) ? Math.max(1e-3, scaleX) : LANDFORM_DEFAULT_UV_SCALE.x,
    y: Number.isFinite(scaleY) ? Math.max(1e-3, scaleY) : LANDFORM_DEFAULT_UV_SCALE.y,
  }

  return { feather, uvScale }
}

export function resolveLandformComponentPropsFromMesh(mesh: LandformDynamicMesh | undefined | null): LandformComponentProps {
  if (!mesh) {
    return clampLandformComponentProps(null)
  }
  return clampLandformComponentProps({
    feather: mesh.feather,
    uvScale: (mesh.uvScale ?? undefined) as Vector2Like | undefined,
  })
}

export function cloneLandformComponentProps(props: LandformComponentProps): LandformComponentProps {
  return {
    feather: props.feather,
    uvScale: { x: props.uvScale.x, y: props.uvScale.y },
  }
}

class LandformComponent extends Component<LandformComponentProps> {
  constructor(context: ComponentRuntimeContext<LandformComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const landformComponentDefinition: ComponentDefinition<LandformComponentProps> = {
  type: LANDFORM_COMPONENT_TYPE,
  label: 'Landform',
  icon: 'mdi-terrain',
  order: 53,
  inspector: [
    {
      id: 'surface',
      label: 'Surface',
      fields: [
        {
          kind: 'number',
          key: 'feather',
          label: 'Feather (m)',
          min: LANDFORM_MIN_FEATHER,
          max: LANDFORM_MAX_FEATHER,
          step: 0.1,
        },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'Landform'
  },
  createDefaultProps(node: SceneNode) {
    return resolveLandformComponentPropsFromMesh(node.dynamicMesh?.type === 'Landform' ? node.dynamicMesh : null)
  },
  createInstance(context) {
    return new LandformComponent(context)
  },
}

componentManager.registerDefinition(landformComponentDefinition)

export function createLandformComponentState(
  node: SceneNode,
  overrides?: Partial<LandformComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<LandformComponentProps> {
  const defaults = resolveLandformComponentPropsFromMesh(node.dynamicMesh?.type === 'Landform' ? node.dynamicMesh : null)
  const merged = clampLandformComponentProps({
    feather: overrides?.feather ?? defaults.feather,
    uvScale: overrides?.uvScale ?? defaults.uvScale,
  })
  return {
    id: options.id ?? '',
    type: LANDFORM_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { landformComponentDefinition }