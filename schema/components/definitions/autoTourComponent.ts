import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const AUTO_TOUR_COMPONENT_TYPE = 'autoTour'

export const DEFAULT_AUTO_TOUR_SPEED_MPS = 3
export const MIN_AUTO_TOUR_SPEED_MPS = 0
export const MAX_AUTO_TOUR_SPEED_MPS = 50

export interface AutoTourComponentProps {
  routeNodeId: string | null
  speedMps: number
  loop: boolean
  alignToPath: boolean
}

function normalizeNodeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false
  }
  return fallback
}

export function clampAutoTourComponentProps(
  props: Partial<AutoTourComponentProps> | null | undefined,
): AutoTourComponentProps {
  const raw = (props ?? {}) as Partial<AutoTourComponentProps>
  return {
    routeNodeId: normalizeNodeId(raw.routeNodeId),
    speedMps: clampNumber(raw.speedMps, DEFAULT_AUTO_TOUR_SPEED_MPS, MIN_AUTO_TOUR_SPEED_MPS, MAX_AUTO_TOUR_SPEED_MPS),
    loop: clampBoolean(raw.loop, false),
    alignToPath: clampBoolean(raw.alignToPath, true),
  }
}

export function cloneAutoTourComponentProps(props: AutoTourComponentProps): AutoTourComponentProps {
  return {
    routeNodeId: props.routeNodeId ?? null,
    speedMps: props.speedMps,
    loop: props.loop,
    alignToPath: props.alignToPath,
  }
}

class AutoTourComponent extends Component<AutoTourComponentProps> {
  constructor(context: ComponentRuntimeContext<AutoTourComponentProps>) {
    super(context)
  }
}

const autoTourComponentDefinition: ComponentDefinition<AutoTourComponentProps> = {
  type: AUTO_TOUR_COMPONENT_TYPE,
  label: 'Auto Tour',
  icon: 'mdi-map-marker-play',
  order: 170,
  inspector: [],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType?.toLowerCase?.() ?? ''
    if (nodeType === 'light' || nodeType === 'sky' || nodeType === 'environment') {
      return false
    }
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return clampAutoTourComponentProps(null)
  },
  createInstance(context) {
    return new AutoTourComponent(context)
  },
}

componentManager.registerDefinition(autoTourComponentDefinition)

export function createAutoTourComponentState(
  node: SceneNode,
  overrides?: Partial<AutoTourComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<AutoTourComponentProps> {
  const defaults = autoTourComponentDefinition.createDefaultProps(node)
  const props = clampAutoTourComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: AUTO_TOUR_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { autoTourComponentDefinition }
