import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const WARP_GATE_COMPONENT_TYPE = 'warpGate'

export const DEFAULT_GROUND_LIGHT_COLOR = '#00ffff'
export const DEFAULT_GROUND_LIGHT_INTENSITY = 1
export const DEFAULT_GROUND_LIGHT_SCALE = 1
export const DEFAULT_GROUND_LIGHT_PARTICLE_SIZE = 0.12
export const DEFAULT_GROUND_LIGHT_PARTICLE_COUNT = 160
export const DEFAULT_GROUND_LIGHT_SHOW_PARTICLES = false
export const DEFAULT_GROUND_LIGHT_SHOW_BEAMS = true
export const DEFAULT_GROUND_LIGHT_SHOW_RINGS = true
export const GROUND_LIGHT_INTENSITY_MIN = 0
export const GROUND_LIGHT_INTENSITY_MAX = 5
export const GROUND_LIGHT_PARTICLE_SIZE_MIN = 0.02
export const GROUND_LIGHT_PARTICLE_SIZE_MAX = 0.4
export const GROUND_LIGHT_PARTICLE_COUNT_MIN = 0
export const GROUND_LIGHT_PARTICLE_COUNT_MAX = 600

export const WARP_GATE_RUNTIME_REGISTRY_KEY = '__harmonyWarpGateRuntime'
export const WARP_GATE_EFFECT_METADATA_KEY = '__harmonyWarpGateEffect'
export const WARP_GATE_EFFECT_ACTIVE_FLAG = '__harmonyWarpGateEffectActive'

const WARP_GATE_EFFECT_GROUP_NAME = 'Effect:WarpGate'
const WARP_GATE_BEAM_COUNT = 16
const WARP_GATE_BEAM_HEIGHT = 2
const WARP_GATE_BEAM_RADIUS = 0.5
const WARP_GATE_RING_COUNT = 3
const WARP_GATE_RING_WIDTH = 0.22
const WARP_GATE_PARTICLE_TEXTURE_RESOLUTION = 64

const WARP_GATE_BEAM_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const WARP_GATE_BEAM_FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;

  float remap(float value, float inMin, float inMax, float outMin, float outMax) {
    return outMin + (outMax - outMin) * clamp((value - inMin) / max(inMax - inMin, 0.0001), 0.0, 1.0);
  }

  void main() {
    float radial = abs(vUv.x - 0.5) * 2.0;
    float vertical = clamp(vUv.y, 0.0, 1.0);
    float edgeFade = smoothstep(1.0, 0.0, radial);
    float heightFade = smoothstep(1.0, 0.0, vertical);
    float swirl = sin(uTime * 3.2 + radial * 14.0);
    float wave = sin(uTime * 4.0 + vertical * 9.0);
    float flicker = 0.65 + 0.35 * sin(uTime * 5.0 + radial * 6.0);
    float intensityScale = remap(clamp(uIntensity, 0.0, ${GROUND_LIGHT_INTENSITY_MAX}.0), 0.0, ${GROUND_LIGHT_INTENSITY_MAX}.0, 0.0, 1.4);
    float alpha = edgeFade * heightFade * (0.55 + 0.25 * swirl + 0.2 * wave) * flicker * intensityScale;
    if (alpha <= 0.02) {
      discard;
    }
    gl_FragColor = vec4(uColor, alpha);
  }
`

type WarpGateRuntimeEntry = {
  getProps(): WarpGateComponentProps
  setProps(patch: Partial<WarpGateComponentProps> | null | undefined): void
  tick(delta: number): void
  props: WarpGateComponentProps
}

export interface WarpGateEffectProps {
  color: string
  intensity: number
  particleSize: number
  particleCount: number
  showParticles: boolean
  showBeams: boolean
  showRings: boolean
}

export type WarpGateComponentProps = WarpGateEffectProps
export type GroundLightEffectProps = WarpGateEffectProps

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

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fallback
    }
    if (value === 1) {
      return true
    }
    if (value === 0) {
      return false
    }
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

export function computeWarpGateEffectActive(props: WarpGateComponentProps): boolean {
  const particlesVisible = props.showParticles && props.particleCount > 0
  return particlesVisible || props.showBeams || props.showRings
}

export function clampWarpGateComponentProps(
  props: Partial<WarpGateComponentProps> | null | undefined,
): WarpGateComponentProps {
  const source = props ?? {}
  const color = normalizeHexColor((source as { color?: string }).color, DEFAULT_GROUND_LIGHT_COLOR)
  const intensity = clampNumber(
    (source as { intensity?: number }).intensity,
    GROUND_LIGHT_INTENSITY_MIN,
    GROUND_LIGHT_INTENSITY_MAX,
    DEFAULT_GROUND_LIGHT_INTENSITY,
  )
  const particleSize = clampNumber(
    (source as { particleSize?: number }).particleSize,
    GROUND_LIGHT_PARTICLE_SIZE_MIN,
    GROUND_LIGHT_PARTICLE_SIZE_MAX,
    DEFAULT_GROUND_LIGHT_PARTICLE_SIZE,
  )
  const normalizedCount = clampNumber(
    (source as { particleCount?: number }).particleCount,
    GROUND_LIGHT_PARTICLE_COUNT_MIN,
    GROUND_LIGHT_PARTICLE_COUNT_MAX,
    DEFAULT_GROUND_LIGHT_PARTICLE_COUNT,
  )
  const particleCount = Math.min(
    GROUND_LIGHT_PARTICLE_COUNT_MAX,
    Math.max(GROUND_LIGHT_PARTICLE_COUNT_MIN, Math.round(normalizedCount)),
  )
  const showParticles = normalizeBoolean((source as { showParticles?: unknown }).showParticles, DEFAULT_GROUND_LIGHT_SHOW_PARTICLES)
  const showBeams = normalizeBoolean((source as { showBeams?: unknown }).showBeams, DEFAULT_GROUND_LIGHT_SHOW_BEAMS)
  const showRings = normalizeBoolean((source as { showRings?: unknown }).showRings, DEFAULT_GROUND_LIGHT_SHOW_RINGS)
  return {
    color,
    intensity,
    particleSize,
    particleCount,
    showParticles,
    showBeams,
    showRings,
  }
}

export function cloneWarpGateComponentProps(props: WarpGateComponentProps): WarpGateComponentProps {
  return {
    color: props.color,
    intensity: props.intensity,
    particleSize: props.particleSize,
    particleCount: props.particleCount,
    showParticles: props.showParticles,
    showBeams: props.showBeams,
    showRings: props.showRings,
  }
}

let sharedWarpGateParticleTexture: THREE.DataTexture | null = null

function getWarpGateParticleTexture(): THREE.DataTexture {
  if (sharedWarpGateParticleTexture) {
    return sharedWarpGateParticleTexture
  }
  const size = WARP_GATE_PARTICLE_TEXTURE_RESOLUTION
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) / 2
  const radius = center
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const distance = Math.hypot(dx, dy)
      const normalized = Math.min(1, Math.max(0, 1 - distance / radius))
      const smooth = normalized * normalized
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(smooth * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipMapLinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  sharedWarpGateParticleTexture = texture
  return texture
}

type BeamEntry = {
  material: THREE.ShaderMaterial
  uniforms: {
    uTime: { value: number }
    uColor: { value: THREE.Color }
    uIntensity: { value: number }
  }
}

type RingEntry = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  baseOpacity: number
  rotationSpeed: number
  pulseOffset: number
}

type ParticleState = {
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  velocities: Float32Array
  count: number
}

export interface WarpGateEffectInstance {
  group: THREE.Group
  update(props: WarpGateComponentProps): void
  tick(delta: number): void
  dispose(): void
}

class WarpGateEffectController implements WarpGateEffectInstance {
  readonly group: THREE.Group
  private readonly beams: BeamEntry[] = []
  private readonly beamGeometry: THREE.PlaneGeometry
  private readonly beamGroup: THREE.Group
  private readonly ringEntries: RingEntry[] = []
  private readonly rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly centerDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>
  private readonly particleState: ParticleState
  private readonly particleSystem: THREE.Points
  private readonly color = new THREE.Color(DEFAULT_GROUND_LIGHT_COLOR)
  private intensity = DEFAULT_GROUND_LIGHT_INTENSITY
  private intensityFactor = 1
  private particleSize = DEFAULT_GROUND_LIGHT_PARTICLE_SIZE
  private showParticles = DEFAULT_GROUND_LIGHT_SHOW_PARTICLES
  private showBeams = DEFAULT_GROUND_LIGHT_SHOW_BEAMS
  private showRings = DEFAULT_GROUND_LIGHT_SHOW_RINGS
  private disposed = false
  private elapsed = 0

  constructor(initial: WarpGateComponentProps) {
    this.group = new THREE.Group()
    this.group.name = WARP_GATE_EFFECT_GROUP_NAME
    this.group.matrixAutoUpdate = true
    this.group.scale.setScalar(DEFAULT_GROUND_LIGHT_SCALE)

    this.beamGeometry = new THREE.PlaneGeometry(0.26, WARP_GATE_BEAM_HEIGHT, 1, 1)
    this.beamGeometry.translate(0, WARP_GATE_BEAM_HEIGHT * 0.5, 0)

    this.beamGroup = new THREE.Group()
    this.beamGroup.name = `${WARP_GATE_EFFECT_GROUP_NAME}:Beams`
    this.group.add(this.beamGroup)

    for (let index = 0; index < WARP_GATE_BEAM_COUNT; index += 1) {
      const angle = (index / WARP_GATE_BEAM_COUNT) * Math.PI * 2
      const uniforms = {
        uTime: { value: 0 },
        uColor: { value: this.color.clone() },
        uIntensity: { value: this.intensity },
      }
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: WARP_GATE_BEAM_VERTEX_SHADER,
        fragmentShader: WARP_GATE_BEAM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.beamGeometry, material)
      const radius = WARP_GATE_BEAM_RADIUS * 0.75
      mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      mesh.rotation.y = angle
      this.beamGroup.add(mesh)
      this.beams.push({ material, uniforms })
    }

    for (let index = 0; index < WARP_GATE_RING_COUNT; index += 1) {
      const innerRadius = WARP_GATE_BEAM_RADIUS * (0.45 + index * 0.22)
      const outerRadius = innerRadius + WARP_GATE_RING_WIDTH
      const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64)
      const material = new THREE.MeshBasicMaterial({
        color: this.color,
        transparent: true,
        opacity: 0.28 - index * 0.06,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.01 + index * 0.008
      this.group.add(mesh)
      this.rings.push(mesh)
      this.ringEntries.push({
        mesh,
        baseOpacity: material.opacity,
        rotationSpeed: 0.25 + index * 0.08,
        pulseOffset: index * 0.9,
      })
    }

    const discGeometry = new THREE.CircleGeometry(WARP_GATE_BEAM_RADIUS * 0.28, 48)
    const discMaterial = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.centerDisc = new THREE.Mesh(discGeometry, discMaterial)
    this.centerDisc.rotation.x = -Math.PI / 2
    this.centerDisc.position.y = 0.015
    this.group.add(this.centerDisc)

    const particleGeometry = new THREE.BufferGeometry()
    const particleMaterial = new THREE.PointsMaterial({
      color: this.color,
      size: DEFAULT_GROUND_LIGHT_PARTICLE_SIZE,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: getWarpGateParticleTexture(),
      alphaTest: 0.15,
    })
    particleMaterial.sizeAttenuation = true
    this.particleState = {
      geometry: particleGeometry,
      material: particleMaterial,
      velocities: new Float32Array(0),
      count: 0,
    }
    this.particleSystem = new THREE.Points(particleGeometry, particleMaterial)
    this.group.add(this.particleSystem)
    this.applySettings(initial)
  }

  update(props: WarpGateComponentProps): void {
    this.applySettings(props)
  }

  tick(delta: number): void {
    if (this.disposed) {
      return
    }
    if (!Number.isFinite(delta) || delta <= 0) {
      return
    }
    const step = Math.max(delta, 0)
    this.elapsed += step

    this.beams.forEach((entry) => {
      entry.uniforms.uTime.value = this.elapsed
      entry.uniforms.uIntensity.value = this.intensity
      entry.uniforms.uColor.value.copy(this.color)
    })
    if (this.showBeams) {
      this.beamGroup.rotation.y += step * 0.35 * (0.8 + this.intensityFactor * 0.4)
    }

    if (this.showRings) {
      this.ringEntries.forEach((entry, index) => {
        const oscillation = 0.75 + 0.25 * Math.sin(this.elapsed * 2.2 + entry.pulseOffset)
        entry.mesh.material.opacity = entry.baseOpacity * oscillation * this.intensityFactor
        entry.mesh.rotation.z += entry.rotationSpeed * step
        if (index === 0) {
          const scalePulse = 1 + Math.sin(this.elapsed * 1.8) * 0.05 * this.intensityFactor
          entry.mesh.scale.setScalar(scalePulse)
        }
      })
      this.centerDisc.material.opacity = 0.55 * this.intensityFactor
    }

    const positionAttribute = this.particleState.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const particleCount = this.particleState.count
    if (this.showParticles && particleCount > 0 && positionAttribute) {
      const positions = positionAttribute.array as Float32Array | undefined
      if (positions) {
        const velocities = this.particleState.velocities
        const riseSpeed = 0.8 + this.intensityFactor * 1.1
        for (let i = 0; i < particleCount; i += 1) {
          const offset = i * 3 + 1
          const currentValue = positions[offset] ?? 0
          const velocity = velocities[i] ?? 0
          let nextValue = currentValue + velocity * riseSpeed * step
          if (nextValue > WARP_GATE_BEAM_HEIGHT) {
            nextValue = 0
          }
          positions[offset] = nextValue
        }
        positionAttribute.needsUpdate = true
      }
    }
    this.particleState.material.opacity = 0.4 + 0.4 * this.intensityFactor
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.beams.forEach((entry) => {
      entry.material.dispose()
    })
    this.beamGeometry.dispose()
    this.rings.forEach((mesh) => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    this.centerDisc.geometry.dispose()
    this.centerDisc.material.dispose()
    this.particleState.geometry.dispose()
    this.particleState.material.dispose()
  }

  private applySettings(settings: WarpGateComponentProps): void {
    this.setColor(settings.color)
    this.setIntensity(settings.intensity)
    this.setParticleCount(settings.particleCount)
    this.setParticleSize(settings.particleSize)
    this.setVisibilityOptions({
      showParticles: settings.showParticles,
      showBeams: settings.showBeams,
      showRings: settings.showRings,
    })
  }

  private setColor(color: string): void {
    this.color.set(color)
    this.rings.forEach((mesh) => {
      mesh.material.color.copy(this.color)
    })
    this.centerDisc.material.color.copy(this.color)
    this.particleState.material.color.copy(this.color)
  }

  private setIntensity(intensity: number): void {
    this.intensity = Math.min(Math.max(intensity, GROUND_LIGHT_INTENSITY_MIN), GROUND_LIGHT_INTENSITY_MAX)
    const normalized = this.intensity
    const factor = normalized <= 0 ? 0 : 0.35 + (normalized / GROUND_LIGHT_INTENSITY_MAX) * 0.9
    this.intensityFactor = factor
  }

  private setParticleSize(size: number): void {
    const clamped = Math.min(Math.max(size, GROUND_LIGHT_PARTICLE_SIZE_MIN), GROUND_LIGHT_PARTICLE_SIZE_MAX)
    if (Math.abs(clamped - this.particleSize) <= 1e-4) {
      return
    }
    this.particleSize = clamped
    this.particleState.material.size = this.particleSize
    this.particleState.material.needsUpdate = true
  }

  private setParticleCount(count: number): void {
    const normalized = Math.max(GROUND_LIGHT_PARTICLE_COUNT_MIN, Math.min(GROUND_LIGHT_PARTICLE_COUNT_MAX, Math.floor(count)))
    if (normalized === this.particleState.count) {
      return
    }
    this.rebuildParticles(normalized)
    this.refreshVisibility()
  }

  private rebuildParticles(count: number): void {
    const geometry = this.particleState.geometry
    const nextCount = Math.max(0, count)
    const positions = new Float32Array(nextCount * 3)
    const velocities = new Float32Array(nextCount)
    for (let index = 0; index < nextCount; index += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * (WARP_GATE_BEAM_RADIUS * 0.7)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const y = Math.random() * WARP_GATE_BEAM_HEIGHT
      const baseOffset = index * 3
      positions[baseOffset] = x
      positions[baseOffset + 1] = y
      positions[baseOffset + 2] = z
      velocities[index] = 0.5 + Math.random() * 1.4
    }
    const attribute = new THREE.BufferAttribute(positions, 3)
    attribute.setUsage(THREE.DynamicDrawUsage)
    attribute.needsUpdate = true
    geometry.setAttribute('position', attribute)
    this.particleState.velocities = velocities
    this.particleState.count = nextCount
  }

  private setVisibilityOptions(options: { showParticles: boolean; showBeams: boolean; showRings: boolean }): void {
    this.showParticles = Boolean(options.showParticles)
    this.showBeams = Boolean(options.showBeams)
    this.showRings = Boolean(options.showRings)
    this.refreshVisibility()
  }

  private refreshVisibility(): void {
    this.particleSystem.visible = this.showParticles && this.particleState.count > 0
    this.beamGroup.visible = this.showBeams
    this.rings.forEach((mesh) => {
      mesh.visible = this.showRings
    })
    this.centerDisc.visible = this.showRings
  }
}

export function createWarpGateEffectInstance(initial: WarpGateComponentProps): WarpGateEffectInstance {
  return new WarpGateEffectController(initial)
}

class WarpGateComponent extends Component<WarpGateComponentProps> {
  private controller: WarpGateEffectInstance | null = null
  private runtimeObject: Object3D | null = null
  private currentProps: WarpGateComponentProps

  constructor(context: ComponentRuntimeContext<WarpGateComponentProps>) {
    super(context)
    this.currentProps = clampWarpGateComponentProps(context.getProps())
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.applyEffect(object)
  }

  onPropsUpdated(next: Readonly<WarpGateComponentProps>): void {
    void next
    this.applyEffect(this.runtimeObject)
  }

  onEnabledChanged(_enabled: boolean): void {
    this.applyEffect(this.runtimeObject)
  }

  onUpdate(delta: number): void {
    this.controller?.tick(delta)
  }

  onDestroy(): void {
    this.disposeEffect()
    this.updateUserData(this.runtimeObject, null)
    this.unregisterRuntimeInterface(this.runtimeObject)
    this.runtimeObject = null
  }

  private applyEffect(object: Object3D | null, provided?: WarpGateComponentProps, options: { alreadyClamped?: boolean } = {}): void {
    const isEnabled = this.context.isEnabled()
    const previous = this.runtimeObject

    if (!object || !isEnabled) {
      this.disposeEffect()
      if (previous) {
        this.updateUserData(previous, null)
        this.unregisterRuntimeInterface(previous)
      }
      this.runtimeObject = object
      return
    }

    if (previous && previous !== object) {
      this.disposeEffect()
      this.updateUserData(previous, null)
      this.unregisterRuntimeInterface(previous)
    }

    const effectiveProps = options.alreadyClamped && provided
      ? cloneWarpGateComponentProps(provided)
      : clampWarpGateComponentProps(provided ?? this.context.getProps())

    this.currentProps = cloneWarpGateComponentProps(effectiveProps)
    this.runtimeObject = object

    if (!this.controller) {
      this.controller = createWarpGateEffectInstance(effectiveProps)
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

  private updateUserData(object: Object3D | null, props: WarpGateComponentProps | null): void {
    if (!object) {
      return
    }
    const userData = object.userData ?? (object.userData = {})
    if (!this.context.isEnabled() || !props) {
      delete userData.warpGate
      delete userData[WARP_GATE_EFFECT_METADATA_KEY]
      if (Object.prototype.hasOwnProperty.call(userData, WARP_GATE_EFFECT_ACTIVE_FLAG)) {
        delete userData[WARP_GATE_EFFECT_ACTIVE_FLAG]
      }
      return
    }
    userData.warpGate = true
    userData[WARP_GATE_EFFECT_METADATA_KEY] = cloneWarpGateComponentProps(props)
    userData[WARP_GATE_EFFECT_ACTIVE_FLAG] = computeWarpGateEffectActive(props)
  }

  private registerRuntimeInterface(object: Object3D, props: WarpGateComponentProps): void {
    const userData = object.userData ?? (object.userData = {})
    let registry = userData[WARP_GATE_RUNTIME_REGISTRY_KEY] as Record<string, WarpGateRuntimeEntry> | undefined
    if (!registry) {
      registry = {}
      userData[WARP_GATE_RUNTIME_REGISTRY_KEY] = registry
    }
    const self = this
    registry[this.context.componentId] = {
      getProps(): WarpGateComponentProps {
        return cloneWarpGateComponentProps(self.currentProps)
      },
      setProps(patch: Partial<WarpGateComponentProps> | null | undefined) {
        if (!patch) {
          return
        }
        const nextProps = clampWarpGateComponentProps({
          ...self.currentProps,
          ...patch,
        })
        self.applyEffect(self.runtimeObject, nextProps, { alreadyClamped: true })
      },
      tick(delta: number) {
        self.controller?.tick(delta)
      },
      props: cloneWarpGateComponentProps(props),
    }
  }

  private unregisterRuntimeInterface(object: Object3D | null | undefined): void {
    if (!object?.userData) {
      return
    }
    const registry = object.userData[WARP_GATE_RUNTIME_REGISTRY_KEY] as Record<string, WarpGateRuntimeEntry> | undefined
    if (!registry) {
      return
    }
    delete registry[this.context.componentId]
    if (!Object.keys(registry).length) {
      delete object.userData[WARP_GATE_RUNTIME_REGISTRY_KEY]
    }
  }
}

const warpGateComponentDefinition: ComponentDefinition<WarpGateComponentProps> = {
  type: WARP_GATE_COMPONENT_TYPE,
  label: 'Warp Gate',
  icon: 'mdi-vector-circle',
  order: 50,
  inspector: [],
  canAttach(_node: SceneNode) {
    return true
  },
  createDefaultProps(_node: SceneNode) {
    return clampWarpGateComponentProps(null)
  },
  createInstance(context) {
    return new WarpGateComponent(context)
  },
}

componentManager.registerDefinition(warpGateComponentDefinition)

export function createWarpGateComponentState(
  node: SceneNode,
  overrides?: Partial<WarpGateComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<WarpGateComponentProps> {
  const defaults = warpGateComponentDefinition.createDefaultProps(node)
  const merged = clampWarpGateComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: WARP_GATE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { warpGateComponentDefinition }
