import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const COUPON_COMPONENT_TYPE = 'couponComponent'

export interface CouponComponentProps {
  couponJson: string
  hideExpired: boolean
  hideOwned: boolean
}

export interface CouponComponentSpec {
  id: string
  validUntil: string | null
  type: string | null
  name: string | null
  description: string | null
  raw: Record<string, unknown>
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }
  return fallback
}

export function clampCouponComponentProps(
  props: Partial<CouponComponentProps> | null | undefined,
): CouponComponentProps {
  return {
    couponJson: typeof props?.couponJson === 'string' ? props.couponJson : '',
    hideExpired: normalizeBoolean(props?.hideExpired, false),
    hideOwned: normalizeBoolean(props?.hideOwned, false),
  }
}

export function cloneCouponComponentProps(props: CouponComponentProps): CouponComponentProps {
  return {
    couponJson: props.couponJson,
    hideExpired: props.hideExpired,
    hideOwned: props.hideOwned,
  }
}

export function parseCouponComponentSpec(rawJson: string | null | undefined): CouponComponentSpec | null {
  const normalizedJson = typeof rawJson === 'string' ? rawJson.trim() : ''
  if (!normalizedJson) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(normalizedJson)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const record = parsed as Record<string, unknown>
  const id = normalizeText(record.id ?? record.couponId)
  if (!id) {
    return null
  }
  const validUntil = normalizeText(record.validUntil ?? record.expiresAt) || null
  const type = normalizeText(record.type) || null
  const name = normalizeText(record.name ?? record.title) || null
  const description = normalizeText(record.description) || null
  return {
    id,
    validUntil,
    type,
    name,
    description,
    raw: record,
  }
}

function writeRuntimeState(object: Object3D | null, props: CouponComponentProps): void {
  if (!object) {
    return
  }

  const userData = object.userData ?? (object.userData = {})
  if (!userData) {
    return
  }
  const spec = parseCouponComponentSpec(props.couponJson)
  if (!spec) {
    delete userData.couponComponent
    return
  }

  userData.couponComponent = {
    ...spec,
    hideExpired: props.hideExpired,
    hideOwned: props.hideOwned,
  }
}

class CouponComponent extends Component<CouponComponentProps> {
  constructor(context: ComponentRuntimeContext<CouponComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: Object3D | null): void {
    writeRuntimeState(object, this.context.getProps())
  }

  onPropsUpdated(next: Readonly<CouponComponentProps>): void {
    writeRuntimeState(this.context.getRuntimeObject(), next)
  }

  onEnabledChanged(_enabled: boolean): void {
    writeRuntimeState(this.context.getRuntimeObject(), this.context.getProps())
  }
}

const couponComponentDefinition: ComponentDefinition<CouponComponentProps> = {
  type: COUPON_COMPONENT_TYPE,
  label: 'Coupon',
  icon: 'mdi-gift-outline',
  order: 48,
  inspector: [
    {
      id: 'coupon',
      label: 'Coupon',
      fields: [
        {
          kind: 'text',
          key: 'couponJson',
          label: 'Coupon JSON',
          multiline: true,
          rows: 5,
          placeholder: '{"id":"coupon-id","validUntil":"2026-12-31","type":"reward"}',
        },
        {
          kind: 'boolean',
          key: 'hideExpired',
          label: 'Hide when expired',
        },
        {
          kind: 'boolean',
          key: 'hideOwned',
          label: 'Hide when already owned',
        },
      ],
    },
  ],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return {
      couponJson: '',
      hideExpired: false,
      hideOwned: false,
    }
  },
  createInstance(context) {
    return new CouponComponent(context)
  },
}

componentManager.registerDefinition(couponComponentDefinition)

export function createCouponComponentState(
  node: SceneNode,
  overrides?: Partial<CouponComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<CouponComponentProps> {
  const defaults = couponComponentDefinition.createDefaultProps(node)
  const props: CouponComponentProps = clampCouponComponentProps({
    couponJson: overrides?.couponJson ?? defaults.couponJson,
    hideExpired: overrides?.hideExpired ?? defaults.hideExpired,
    hideOwned: overrides?.hideOwned ?? defaults.hideOwned,
  })
  return {
    id: options.id ?? '',
    type: COUPON_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { couponComponentDefinition }
