import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState, Vector2Like } from '../../index'

export const LANDFORMS_COMPONENT_TYPE = 'landforms'
export const LANDFORMS_MAX_LAYER_COUNT = 4
export const LANDFORMS_DEFAULT_OPACITY = 1
export const LANDFORMS_DEFAULT_ROTATION_DEG = 0
export const LANDFORMS_DEFAULT_TILE_SCALE = { x: 1, y: 1 }
export const LANDFORMS_DEFAULT_OFFSET = { x: 0, y: 0 }
export const LANDFORMS_DEFAULT_WORLD_SPACE = true
export const LANDFORMS_DEFAULT_MASK_FEATHER = 0.15

export type LandformsBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay'
export type LandformsMaskShape = 'none' | 'circle' | 'rectangle'

export interface LandformsMask {
  shape: LandformsMaskShape
  center: { x: number; y: number }
  size: { x: number; y: number }
  feather: number
}

export interface LandformsLayer {
  id: string
  name: string
  assetId: string | null
  enabled: boolean
  opacity: number
  tileScale: { x: number; y: number }
  offset: { x: number; y: number }
  rotationDeg: number
  blendMode: LandformsBlendMode
  worldSpace: boolean
  mask: LandformsMask
}

export interface LandformsComponentProps {
  layers: LandformsLayer[]
}

function clampFinite(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clampString(value: unknown, fallback = ''): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length ? normalized : fallback
}

function clampVec2(value: Vector2Like | null | undefined, fallback: { x: number; y: number }, min?: number): { x: number; y: number } {
  const x = clampFinite(value?.x, fallback.x)
  const y = clampFinite(value?.y, fallback.y)
  return {
    x: min === undefined ? x : Math.max(min, x),
    y: min === undefined ? y : Math.max(min, y),
  }
}

function clampBlendMode(value: unknown): LandformsBlendMode {
  if (value === 'multiply' || value === 'screen' || value === 'overlay') {
    return value
  }
  return 'normal'
}

function clampMaskShape(value: unknown): LandformsMaskShape {
  if (value === 'circle' || value === 'rectangle') {
    return value
  }
  return 'none'
}

function clampMask(mask: Partial<LandformsMask> | null | undefined): LandformsMask {
  return {
    shape: clampMaskShape(mask?.shape),
    center: clampVec2(mask?.center as Vector2Like | null | undefined, { x: 0.5, y: 0.5 }),
    size: clampVec2(mask?.size as Vector2Like | null | undefined, { x: 1, y: 1 }, 0),
    feather: Math.min(1, Math.max(0, clampFinite(mask?.feather, LANDFORMS_DEFAULT_MASK_FEATHER))),
  }
}

function clampLayer(layer: Partial<LandformsLayer> | null | undefined, index: number): LandformsLayer {
  const fallbackName = `Layer ${index + 1}`
  const assetId = clampString(layer?.assetId, '')
  return {
    id: clampString(layer?.id, `landform-layer-${index + 1}`),
    name: clampString(layer?.name, fallbackName),
    assetId: assetId || null,
    enabled: clampBoolean(layer?.enabled, true),
    opacity: Math.min(1, Math.max(0, clampFinite(layer?.opacity, LANDFORMS_DEFAULT_OPACITY))),
    tileScale: clampVec2(layer?.tileScale as Vector2Like | null | undefined, LANDFORMS_DEFAULT_TILE_SCALE, 0.001),
    offset: clampVec2(layer?.offset as Vector2Like | null | undefined, LANDFORMS_DEFAULT_OFFSET),
    rotationDeg: Math.min(360, Math.max(-360, clampFinite(layer?.rotationDeg, LANDFORMS_DEFAULT_ROTATION_DEG))),
    blendMode: clampBlendMode(layer?.blendMode),
    worldSpace: clampBoolean(layer?.worldSpace, LANDFORMS_DEFAULT_WORLD_SPACE),
    mask: clampMask(layer?.mask),
  }
}

export function createDefaultLandformsLayer(index: number): LandformsLayer {
  return clampLayer(null, index)
}

export function clampLandformsComponentProps(
  props: Partial<LandformsComponentProps> | null | undefined,
): LandformsComponentProps {
  const rawLayers = Array.isArray(props?.layers) ? props.layers : []
  return {
    layers: rawLayers.slice(0, LANDFORMS_MAX_LAYER_COUNT).map((layer, index) => clampLayer(layer, index)),
  }
}

export function cloneLandformsMask(mask: LandformsMask): LandformsMask {
  return {
    shape: mask.shape,
    center: { x: mask.center.x, y: mask.center.y },
    size: { x: mask.size.x, y: mask.size.y },
    feather: mask.feather,
  }
}

export function cloneLandformsLayer(layer: LandformsLayer): LandformsLayer {
  return {
    id: layer.id,
    name: layer.name,
    assetId: layer.assetId,
    enabled: layer.enabled,
    opacity: layer.opacity,
    tileScale: { x: layer.tileScale.x, y: layer.tileScale.y },
    offset: { x: layer.offset.x, y: layer.offset.y },
    rotationDeg: layer.rotationDeg,
    blendMode: layer.blendMode,
    worldSpace: layer.worldSpace,
    mask: cloneLandformsMask(layer.mask),
  }
}

export function cloneLandformsComponentProps(props: LandformsComponentProps): LandformsComponentProps {
  return {
    layers: Array.isArray(props.layers) ? props.layers.map((layer) => cloneLandformsLayer(layer)) : [],
  }
}

class LandformsComponent extends Component<LandformsComponentProps> {
  constructor(context: ComponentRuntimeContext<LandformsComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
  }

  onPropsUpdated(): void {
    this.context.markDirty()
  }
}

const landformsComponentDefinition: ComponentDefinition<LandformsComponentProps> = {
  type: LANDFORMS_COMPONENT_TYPE,
  label: 'Landforms',
  icon: 'mdi-terrain',
  order: 61,
  inspector: [],
  canAttach(node: SceneNode) {
    return node.dynamicMesh?.type === 'Ground'
  },
  createDefaultProps() {
    return clampLandformsComponentProps({ layers: [] })
  },
  createInstance(context) {
    return new LandformsComponent(context)
  },
}

componentManager.registerDefinition(landformsComponentDefinition)

export function createLandformsComponentState(
  node: SceneNode,
  overrides?: Partial<LandformsComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<LandformsComponentProps> {
  const defaults = landformsComponentDefinition.createDefaultProps(node)
  const merged = clampLandformsComponentProps({
    layers: overrides?.layers ?? defaults.layers,
  })
  return {
    id: options.id ?? '',
    type: LANDFORMS_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { landformsComponentDefinition }