import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const GUIDEBOARD_COMPONENT_TYPE = 'guideboard'
export const GUIDEBOARD_DEFAULT_INITIAL_VISIBILITY = false

export const GUIDEBOARD_DEFAULT_GLOW_COLOR = '#ffd54f'
export const GUIDEBOARD_DEFAULT_GLOW_INTENSITY = 1.4
export const GUIDEBOARD_DEFAULT_GLOW_RADIUS = 0.85
export const GUIDEBOARD_DEFAULT_PULSE_SPEED = 1
export const GUIDEBOARD_DEFAULT_PULSE_STRENGTH = 0.25

export const GUIDEBOARD_GLOW_INTENSITY_MIN = 0
export const GUIDEBOARD_GLOW_INTENSITY_MAX = 6
export const GUIDEBOARD_GLOW_RADIUS_MIN = 0.1
export const GUIDEBOARD_GLOW_RADIUS_MAX = 6
export const GUIDEBOARD_PULSE_SPEED_MIN = 0
export const GUIDEBOARD_PULSE_SPEED_MAX = 10
export const GUIDEBOARD_PULSE_STRENGTH_MIN = 0
export const GUIDEBOARD_PULSE_STRENGTH_MAX = 1

export const GUIDEBOARD_RUNTIME_REGISTRY_KEY = '__harmonyGuideboardRuntime'
export const GUIDEBOARD_EFFECT_METADATA_KEY = '__harmonyGuideboardEffect'
export const GUIDEBOARD_EFFECT_ACTIVE_FLAG = '__harmonyGuideboardEffectActive'

const GUIDEBOARD_EFFECT_GROUP_NAME = 'Effect:GuideboardGlow'
const GUIDEBOARD_GLOW_TEXTURE_SIZE = 128

export interface GuideboardEffectProps {
  glowColor: string
  glowIntensity: number
  glowRadius: number
  pulseSpeed: number
  pulseStrength: number
}

export interface GuideboardComponentProps extends GuideboardEffectProps {
  initiallyVisible: boolean
}

type GuideboardRuntimeEntry = {
  getProps(): GuideboardComponentProps
  setProps(patch: Partial<GuideboardComponentProps> | null | undefined): void
  tick(delta: number): void
  props: GuideboardComponentProps
  setPlaybackActive?(active: boolean): void
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const clamped = Math.min(Math.max(value, min), max)
  return Number.isFinite(clamped) ? clamped : fallback
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!trimmed.length) {
    return fallback
  }
  const prefixed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(prefixed)
  if (!match) {
    return fallback
  }
  const hex = match[1] ?? ''
  if (hex.length === 3) {
    const [r, g, b] = hex.toLowerCase().split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return `#${hex.toLowerCase()}`
}

export function clampGuideboardComponentProps(
  props: Partial<GuideboardComponentProps> | null | undefined,
): GuideboardComponentProps {
  const source = props ?? {}
  const initiallyVisible = source.initiallyVisible === true
  const glowColor = normalizeHexColor((source as { glowColor?: string }).glowColor, GUIDEBOARD_DEFAULT_GLOW_COLOR)
  const glowIntensity = clampNumber(
    (source as { glowIntensity?: number }).glowIntensity,
    GUIDEBOARD_GLOW_INTENSITY_MIN,
    GUIDEBOARD_GLOW_INTENSITY_MAX,
    GUIDEBOARD_DEFAULT_GLOW_INTENSITY,
  )
  const glowRadius = clampNumber(
    (source as { glowRadius?: number }).glowRadius,
    GUIDEBOARD_GLOW_RADIUS_MIN,
    GUIDEBOARD_GLOW_RADIUS_MAX,
    GUIDEBOARD_DEFAULT_GLOW_RADIUS,
  )
  const pulseSpeed = clampNumber(
    (source as { pulseSpeed?: number }).pulseSpeed,
    GUIDEBOARD_PULSE_SPEED_MIN,
    GUIDEBOARD_PULSE_SPEED_MAX,
    GUIDEBOARD_DEFAULT_PULSE_SPEED,
  )
  const pulseStrength = clampNumber(
    (source as { pulseStrength?: number }).pulseStrength,
    GUIDEBOARD_PULSE_STRENGTH_MIN,
    GUIDEBOARD_PULSE_STRENGTH_MAX,
    GUIDEBOARD_DEFAULT_PULSE_STRENGTH,
  )
  return {
    initiallyVisible,
    glowColor,
    glowIntensity,
    glowRadius,
    pulseSpeed,
    pulseStrength,
  }
}

export function cloneGuideboardComponentProps(props: GuideboardComponentProps): GuideboardComponentProps {
  return {
    initiallyVisible: props.initiallyVisible,
    glowColor: props.glowColor,
    glowIntensity: props.glowIntensity,
    glowRadius: props.glowRadius,
    pulseSpeed: props.pulseSpeed,
    pulseStrength: props.pulseStrength,
  }
}

export function computeGuideboardEffectActive(props: GuideboardComponentProps): boolean {
  return props.glowIntensity > GUIDEBOARD_GLOW_INTENSITY_MIN
}

let sharedGuideboardGlowTexture: THREE.DataTexture | null = null

function getGuideboardGlowTexture(): THREE.DataTexture {
  if (sharedGuideboardGlowTexture) {
    return sharedGuideboardGlowTexture
  }
  const size = GUIDEBOARD_GLOW_TEXTURE_SIZE
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) / 2
  const radius = center
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const distance = Math.hypot(dx, dy)
      const normalized = Math.max(0, 1 - distance / Math.max(radius, 1e-6))
      const intensity = normalized ** 2.4
      const offset = (y * size + x) * 4
      const alpha = Math.round(intensity * 255)
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = alpha
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipMapLinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  sharedGuideboardGlowTexture = texture
  return texture
}

class GuideboardGlowEffectController {
  readonly group: THREE.Group
  private readonly halo: THREE.Sprite
  private readonly haloMaterial: THREE.SpriteMaterial
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private readonly ringMaterial: THREE.MeshBasicMaterial
  private readonly color = new THREE.Color(GUIDEBOARD_DEFAULT_GLOW_COLOR)
  private glowIntensity = GUIDEBOARD_DEFAULT_GLOW_INTENSITY
  private glowRadius = GUIDEBOARD_DEFAULT_GLOW_RADIUS
  private pulseSpeed = GUIDEBOARD_DEFAULT_PULSE_SPEED
  private pulseStrength = GUIDEBOARD_DEFAULT_PULSE_STRENGTH
  private elapsed = 0
  private flickerTime = 0
  private readonly flickerSeed = Math.random() * Math.PI * 2
  private disposed = false

  constructor(initial: GuideboardComponentProps) {
    this.group = new THREE.Group()
    this.group.name = GUIDEBOARD_EFFECT_GROUP_NAME
    this.group.matrixAutoUpdate = true

    this.haloMaterial = new THREE.SpriteMaterial({
      color: this.color,
      map: getGuideboardGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.halo = new THREE.Sprite(this.haloMaterial)
    this.halo.name = `${GUIDEBOARD_EFFECT_GROUP_NAME}:Halo`
    this.halo.renderOrder = 5
    this.group.add(this.halo)

    const ringGeometry = new THREE.RingGeometry(0.36, 0.54, 64)
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    this.ring = new THREE.Mesh(ringGeometry, this.ringMaterial)
    this.ring.name = `${GUIDEBOARD_EFFECT_GROUP_NAME}:Ring`
    this.ring.rotation.x = -Math.PI / 2
    this.ring.renderOrder = 6
    this.group.add(this.ring)

    this.applyProps(initial)
  }

  update(props: GuideboardComponentProps): void {
    this.applyProps(props)
  }

  tick(delta: number): void {
    if (this.disposed) {
      return
    }
    if (!Number.isFinite(delta) || delta <= 0) {
      return
    }
    this.elapsed += delta * Math.max(this.pulseSpeed, 0)
    this.flickerTime += delta
    const pulsePhase = this.elapsed * Math.PI * 2
    const flicker = this.computeFlicker(this.flickerTime)
    this.updateVisuals(pulsePhase, flicker)
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.group.remove(this.halo)
    this.group.remove(this.ring)
    this.haloMaterial.dispose()
    this.ring.geometry.dispose()
    this.ringMaterial.dispose()
  }

  private applyProps(props: GuideboardComponentProps): void {
    this.color.set(props.glowColor)
    this.haloMaterial.color.copy(this.color)
    this.ringMaterial.color.copy(this.color)
    this.glowIntensity = props.glowIntensity
    this.glowRadius = props.glowRadius
    this.pulseSpeed = props.pulseSpeed
    this.pulseStrength = props.pulseStrength
    this.elapsed = 0
    this.flickerTime = 0
    this.updateVisuals(0, 0)
  }

  private computeFlicker(time: number): number {
    const slow = Math.sin(time * 6 + this.flickerSeed) * 0.12
    const fast = Math.sin(time * 12.7 + this.flickerSeed * 1.618) * 0.08
    return slow + fast
  }

  private updateVisuals(phase: number, flicker: number): void {
    const maxIntensity = Math.max(GUIDEBOARD_GLOW_INTENSITY_MAX, 1)
    const intensity = Math.max(this.glowIntensity, 0)
    const normalizedIntensity = Math.min(intensity / maxIntensity, 1)
    const pulseAmount = Math.max(this.pulseStrength, 0)
    const pulse =
      pulseAmount > 0
        ? (Math.sin(phase) * 0.5 + 0.5) * Math.min(pulseAmount, GUIDEBOARD_PULSE_STRENGTH_MAX)
        : 0
    const baseRadius = Math.max(this.glowRadius, GUIDEBOARD_GLOW_RADIUS_MIN)
    const flickerScale = 1 + flicker * (0.1 + Math.min(pulseAmount, 0.6) * 0.4)
    const scale = baseRadius * (1 + pulse * 0.25) * flickerScale
    this.halo.scale.setScalar(scale * 2.1)
    this.ring.scale.setScalar(scale * 1.2)
    const haloOpacity = (normalizedIntensity * 0.8 + pulse * 0.35) * (1 + flicker * 0.4)
    const ringOpacity = (normalizedIntensity * 0.6 + pulse * 0.28) * (1 + flicker * 0.35)
    this.haloMaterial.opacity = Math.min(1, Math.max(0, haloOpacity))
    this.ringMaterial.opacity = Math.min(1, Math.max(0, ringOpacity))
  }
}

export type GuideboardEffectInstance = {
  group: THREE.Group
  update(props: GuideboardComponentProps): void
  tick(delta: number): void
  dispose(): void
}

export function createGuideboardEffectInstance(initial: GuideboardComponentProps): GuideboardEffectInstance {
  return new GuideboardGlowEffectController(initial)
}

class GuideboardComponent extends Component<GuideboardComponentProps> {
  private controller: GuideboardEffectInstance | null = null
  private runtimeObject: Object3D | null = null
  private currentProps: GuideboardComponentProps
  private playbackActive = true

  constructor(context: ComponentRuntimeContext<GuideboardComponentProps>) {
    super(context)
    this.currentProps = clampGuideboardComponentProps(context.getProps())
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.applyRuntime(object)
  }

  onPropsUpdated(): void {
    this.applyRuntime(this.context.getRuntimeObject())
  }

  onEnabledChanged(_enabled: boolean): void {
    this.applyRuntime(this.context.getRuntimeObject())
  }

  onUpdate(deltaTime: number): void {
    if (!this.playbackActive) {
      return
    }
    this.controller?.tick(deltaTime)
  }

  onDestroy(): void {
    this.disposeEffect()
    this.updateUserData(this.runtimeObject, null)
    this.unregisterRuntimeInterface(this.runtimeObject)
    this.runtimeObject = null
    this.playbackActive = true
  }

  private applyRuntime(object: Object3D | null, provided?: GuideboardComponentProps, options: { alreadyClamped?: boolean } = {}): void {
    const previous = this.runtimeObject
    if (!object) {
      this.disposeEffect()
      this.updateUserData(previous, null)
      this.unregisterRuntimeInterface(previous)
      this.runtimeObject = null
      this.playbackActive = true
      return
    }

    if (previous && previous !== object) {
      this.disposeEffect()
      this.updateUserData(previous, null)
      this.unregisterRuntimeInterface(previous)
    }

    const effectiveProps = options.alreadyClamped && provided
      ? cloneGuideboardComponentProps(provided)
      : clampGuideboardComponentProps(provided ?? this.context.getProps())

    this.currentProps = cloneGuideboardComponentProps(effectiveProps)
    this.runtimeObject = object

    if (!this.context.isEnabled()) {
      object.visible = false
      this.disposeEffect()
      this.updateUserData(object, null)
      this.unregisterRuntimeInterface(object)
      return
    }

    object.visible = effectiveProps.initiallyVisible === true

    if (!this.controller) {
      this.controller = createGuideboardEffectInstance(effectiveProps)
      object.add(this.controller.group)
    } else if (this.controller.group.parent !== object) {
      this.controller.group.removeFromParent()
      object.add(this.controller.group)
    }

    this.controller.update(effectiveProps)

    this.updateUserData(object, effectiveProps)
    this.registerRuntimeInterface(object, effectiveProps)
  }

  private disposeEffect(): void {
    if (!this.controller) {
      return
    }
    this.controller.group.parent?.remove(this.controller.group)
    this.controller.dispose()
    this.controller = null
  }

  private setPlaybackActive(active: boolean): void {
    if (this.playbackActive === active) {
      return
    }
    this.playbackActive = active
    if (!active) {
      this.controller?.update(this.currentProps)
    }
  }

  private updateUserData(object: Object3D | null, props: GuideboardComponentProps | null): void {
    if (!object) {
      return
    }
    const userData = object.userData ?? (object.userData = {})
    if (!props) {
      delete userData.guideboard
      delete userData[GUIDEBOARD_EFFECT_METADATA_KEY]
      if (Object.prototype.hasOwnProperty.call(userData, GUIDEBOARD_EFFECT_ACTIVE_FLAG)) {
        delete userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG]
      }
      return
    }
    userData.guideboard = true
    userData[GUIDEBOARD_EFFECT_METADATA_KEY] = cloneGuideboardComponentProps(props)
    userData[GUIDEBOARD_EFFECT_ACTIVE_FLAG] = computeGuideboardEffectActive(props)
  }

  private registerRuntimeInterface(object: Object3D, props: GuideboardComponentProps): void {
    const userData = object.userData ?? (object.userData = {})
    let registry = userData[GUIDEBOARD_RUNTIME_REGISTRY_KEY] as Record<string, GuideboardRuntimeEntry> | undefined
    if (!registry) {
      registry = {}
      userData[GUIDEBOARD_RUNTIME_REGISTRY_KEY] = registry
    }
    const self = this
    const entry: GuideboardRuntimeEntry = {
      getProps(): GuideboardComponentProps {
        return cloneGuideboardComponentProps(self.currentProps)
      },
      setProps(patch: Partial<GuideboardComponentProps> | null | undefined) {
        if (!patch) {
          return
        }
        const nextProps = clampGuideboardComponentProps({
          ...self.currentProps,
          ...patch,
        })
        self.applyRuntime(self.runtimeObject, nextProps, { alreadyClamped: true })
        entry.props = cloneGuideboardComponentProps(self.currentProps)
      },
      tick(delta: number) {
        if (!self.playbackActive) {
          return
        }
        self.controller?.tick(delta)
      },
      props: cloneGuideboardComponentProps(props),
      setPlaybackActive(active: boolean) {
        self.setPlaybackActive(active)
      },
    }
    registry[this.context.componentId] = entry
  }

  private unregisterRuntimeInterface(object: Object3D | null | undefined): void {
    if (!object?.userData) {
      return
    }
    const registry = object.userData[GUIDEBOARD_RUNTIME_REGISTRY_KEY] as Record<string, GuideboardRuntimeEntry> | undefined
    if (!registry) {
      return
    }
    delete registry[this.context.componentId]
    if (!Object.keys(registry).length) {
      delete object.userData[GUIDEBOARD_RUNTIME_REGISTRY_KEY]
    }
  }
}

const guideboardComponentDefinition: ComponentDefinition<GuideboardComponentProps> = {
  type: GUIDEBOARD_COMPONENT_TYPE,
  label: 'Guideboard',
  icon: 'mdi-sign-direction',
  order: 40,
  inspector: [
    {
      id: 'visibility',
      label: 'Visibility',
      fields: [
        {
          kind: 'boolean',
          key: 'initiallyVisible',
          label: 'Initially Visible',
        },
      ],
    },
    {
      id: 'glow',
      label: 'Glow Highlight',
      fields: [
        {
          kind: 'text',
          key: 'glowColor',
          label: 'Glow Color',
          placeholder: '#ffd54f',
        },
        {
          kind: 'number',
          key: 'glowIntensity',
          label: 'Glow Intensity',
          min: GUIDEBOARD_GLOW_INTENSITY_MIN,
          max: GUIDEBOARD_GLOW_INTENSITY_MAX,
          step: 0.1,
        },
        {
          kind: 'number',
          key: 'glowRadius',
          label: 'Glow Radius (m)',
          min: GUIDEBOARD_GLOW_RADIUS_MIN,
          max: GUIDEBOARD_GLOW_RADIUS_MAX,
          step: 0.05,
        },
        {
          kind: 'number',
          key: 'pulseSpeed',
          label: 'Pulse Speed',
          min: GUIDEBOARD_PULSE_SPEED_MIN,
          max: GUIDEBOARD_PULSE_SPEED_MAX,
          step: 0.1,
        },
        {
          kind: 'number',
          key: 'pulseStrength',
          label: 'Pulse Strength',
          min: GUIDEBOARD_PULSE_STRENGTH_MIN,
          max: GUIDEBOARD_PULSE_STRENGTH_MAX,
          step: 0.05,
        },
      ],
    },
  ],
  canAttach(_node: SceneNode) {
    const type = (typeof _node.nodeType === 'string' ? _node.nodeType : '').trim().toLowerCase()
    if (type === 'guideboard') {
      return true
    }
    return !type
  },
  createDefaultProps(_node: SceneNode) {
    return clampGuideboardComponentProps({
      initiallyVisible: GUIDEBOARD_DEFAULT_INITIAL_VISIBILITY,
      glowColor: GUIDEBOARD_DEFAULT_GLOW_COLOR,
      glowIntensity: GUIDEBOARD_DEFAULT_GLOW_INTENSITY,
      glowRadius: GUIDEBOARD_DEFAULT_GLOW_RADIUS,
      pulseSpeed: GUIDEBOARD_DEFAULT_PULSE_SPEED,
      pulseStrength: GUIDEBOARD_DEFAULT_PULSE_STRENGTH,
    })
  },
  createInstance(context) {
    return new GuideboardComponent(context)
  },
}

componentManager.registerDefinition(guideboardComponentDefinition)

export function createGuideboardComponentState(
  node: SceneNode,
  overrides?: Partial<GuideboardComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<GuideboardComponentProps> {
  const defaults = guideboardComponentDefinition.createDefaultProps(node)
  const merged = clampGuideboardComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: GUIDEBOARD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { guideboardComponentDefinition }
