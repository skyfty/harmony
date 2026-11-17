import * as THREE from 'three'
// three-nebula ships without stable bundled typings in this build path.
// Keep the runtime import and rely on the local ambient declaration file.
// @ts-ignore
import System, { Alpha, Body, BoxZone, Color as NebulaColor, Emitter, Force, Life, Mass, MeshRenderer, PointZone, Position, RadialVelocity, Radius, Rate, Scale, Span, SphereZone, SpriteRenderer, Vector3D, VectorVelocity } from 'three-nebula'
import type { ParticleBudgetDecision, ParticleBudgetRuntimeStats } from './particleBudget'
import { applyEmitterBudget, resolveParticleBudgetDecision } from './particleBudget'
import { getParticleTextureResolver } from './particleTextureResolver'
import { loadTextureFromSourceUrl } from '../textureSourceLoader'
import {
  DEFAULT_PARTICLE_EXPOSED_PARAMS,
  PARTICLE_SYSTEM_ACTIVE_FLAG,
  PARTICLE_SYSTEM_METADATA_KEY,
  PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY,
  clampParticleSystemComponentProps,
  cloneParticleSystemComponentProps,
  estimateParticleSystemCost,
  type ParticleEmitterConfig,
  type ParticleExposedParams,
  type ParticleSystemComponentProps,
} from './particleSchema'

export type ParticleRuntimeRegistryEntry = {
  props: ParticleSystemComponentProps
  play(): void
  stop(options?: { soft?: boolean }): void
  restart(): void
  burst(count?: number, emitterId?: string): void
  getParticleCount?(): number
  getParticleDiagnostics?(): ParticleRuntimeDiagnostics
  tick(delta: number, frameState?: { cameraWorldPosition: { x: number; y: number; z: number } | null }, runtimeStats?: ParticleBudgetRuntimeStats): void
  setPlaybackActive(active: boolean): void
  setExposedParams(patch: Partial<ParticleExposedParams>): void
  dispose(): void
}

export type ParticleRuntimeDiagnostics = {
  active: boolean
  particleCount: number
  groupVisible: boolean
  sample: {
    age: number
    position: { x: number; y: number; z: number }
    velocity: { x: number; y: number; z: number }
    alpha: number
    scale: number
    color: { r: number; g: number; b: number }
    targetVisible: boolean
  } | null
}

export interface ParticleSystemRuntimeHandle extends ParticleRuntimeRegistryEntry {
  group: THREE.Group
}

export function allocateParticleBurstCounts(
  totalCount: number,
  capacities: readonly number[],
): number[] {
  const normalizedTotal = Math.max(0, Math.trunc(Number(totalCount) || 0))
  const normalizedCapacities = capacities.map((capacity) =>
    Math.max(0, Math.trunc(Number(capacity) || 0)),
  )
  const allocation = normalizedCapacities.map(() => 0)
  let remaining = Math.min(
    normalizedTotal,
    normalizedCapacities.reduce((sum, capacity) => sum + capacity, 0),
  )
  while (remaining > 0) {
    let assigned = false
    for (let index = 0; index < allocation.length && remaining > 0; index += 1) {
      const capacity = normalizedCapacities[index] ?? 0
      const current = allocation[index] ?? 0
      if (current >= capacity) {
        continue
      }
      allocation[index] = current + 1
      remaining -= 1
      assigned = true
    }
    if (!assigned) {
      break
    }
  }
  return allocation
}

const sharedTextureCache = new Map<string, THREE.Texture>()
const pendingTextureLoads = new Map<string, Promise<THREE.Texture | null>>()

function createRadialSoftTexture(cacheKey: string): THREE.Texture {
  const cached = sharedTextureCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) * 0.5
  const radius = center
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const distance = Math.hypot(dx, dy)
      const alpha = Math.max(0, 1 - distance / Math.max(1e-6, radius))
      const smooth = alpha * alpha
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
  sharedTextureCache.set(cacheKey, texture)
  return texture
}

function createRainStreakTexture(): THREE.Texture {
  const cacheKey = 'fallback-rain-streak'
  const cached = sharedTextureCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const centerX = (size - 1) * 0.5
  for (let y = 0; y < size; y += 1) {
    const vertical = 1 - Math.abs((y / (size - 1)) - 0.5) * 2
    const streakStrength = Math.pow(Math.max(0, vertical), 1.35)
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - centerX)
      const horizontal = Math.max(0, 1 - dx / 3.2)
      const alpha = Math.max(0, streakStrength * horizontal)
      const offset = (y * size + x) * 4
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = Math.round(alpha * alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipMapLinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  sharedTextureCache.set(cacheKey, texture)
  return texture
}

function getPresetFallbackTexture(presetId: string): THREE.Texture {
  if (presetId.includes('rain')) {
    return createRainStreakTexture()
  }
  if (presetId.includes('snow')) {
    return createRadialSoftTexture('fallback-snow-soft')
  }
  return createRadialSoftTexture('fallback-soft-circle')
}

function getBlendMode(mode: ParticleSystemComponentProps['render']['blendMode']): THREE.Blending {
  if (mode === 'normal') {
    return THREE.NormalBlending
  }
  if (mode === 'alpha') {
    return THREE.NormalBlending
  }
  return THREE.AdditiveBlending
}

type PaperParticle = {
  target?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null
  radius?: number
  scale?: number
  alpha?: number
  age?: number
  color?: THREE.Color
  useAlpha?: boolean
  useColor?: boolean
  rotation?: THREE.Vector3
  __harmonyPaperSeed?: {
    x: number
    y: number
    z: number
    wobble: number
    direction: number
  }
}

class PaperRenderer extends MeshRenderer {
  private readonly paperProps: ParticleSystemComponentProps['render']

  constructor(
    container: THREE.Object3D,
    THREE_API: typeof THREE,
    props: ParticleSystemComponentProps,
  ) {
    super(container, THREE_API)
    this.paperProps = props.render
    const material = new THREE_API.MeshBasicMaterial({
      color: props.exposedParams.color,
      transparent: true,
      opacity: props.exposedParams.opacity,
      depthWrite: props.render.depthWrite,
      side: THREE_API.DoubleSide,
      blending: getBlendMode(props.render.blendMode),
    })
    const geometry = new THREE_API.PlaneGeometry(1, props.render.paper?.aspectRatio ?? 0.55)
    const body = new THREE_API.Mesh(geometry, material)
    body.renderOrder = props.render.sortOffset
    ;(this as unknown as { _body: THREE.Mesh })._body = body
  }

  onParticleCreated(particle: PaperParticle): void {
    super.onParticleCreated(particle)
    if (!particle.target) {
      return
    }
    particle.__harmonyPaperSeed = {
      x: Math.random() * Math.PI * 2,
      y: Math.random() * Math.PI * 2,
      z: Math.random() * Math.PI * 2,
      wobble: 0.45 + Math.random() * 0.75,
      direction: Math.random() < 0.5 ? -1 : 1,
    }
    particle.target.renderOrder = this.paperProps.sortOffset
    this.applyPaperTransform(particle)
  }

  onParticleUpdate(particle: PaperParticle): void {
    super.onParticleUpdate(particle)
    this.applyPaperTransform(particle)
  }

  scale(particle: PaperParticle): void {
    if (!particle.target) {
      return
    }
    const size = Math.max(0.001, Number(particle.radius) || 0.1)
    const scale = Math.max(0.001, Number(particle.scale) || 1)
    particle.target.scale.set(size * scale, size * scale, 1)
  }

  private applyPaperTransform(particle: PaperParticle): void {
    const target = particle.target
    const seed = particle.__harmonyPaperSeed
    if (!target || !seed) {
      return
    }
    const age = Math.max(0, Number(particle.age) || 0)
    const spin = age * (this.paperProps.paper?.tumbleCyclesPerSecond ?? 1.1) * Math.PI * 2
    const wobble = Math.sin(age * Math.PI * 2.4 + seed.wobble) * 0.55
    target.rotation.set(
      seed.x + wobble,
      seed.y + spin * seed.direction,
      seed.z + spin * 0.37 * seed.direction,
    )
    this.scale(particle)
    if (particle.useAlpha && typeof particle.alpha === 'number') {
      target.material.opacity = particle.alpha
      target.material.transparent = true
    }
    if (particle.useColor && particle.color) {
      target.material.color.copy(particle.color)
    }
  }

  destroy(): void {
    const materialPool = (this as unknown as { _materialPool?: { list?: Record<string, THREE.Material[]> } })._materialPool
    const targetPool = (this as unknown as { _targetPool?: { list?: Record<string, THREE.Mesh[]> } })._targetPool
    const materials = new Set<THREE.Material>()
    Object.values(materialPool?.list ?? {}).forEach((entries) => {
      entries.forEach((material) => materials.add(material))
    })
    Object.values(targetPool?.list ?? {}).forEach((entries) => {
      entries.forEach((target) => {
        const targetMaterial = (target as THREE.Mesh).material
        if (Array.isArray(targetMaterial)) {
          targetMaterial.forEach((material) => materials.add(material))
        } else if (targetMaterial) {
          materials.add(targetMaterial)
        }
      })
    })
    materials.forEach((material) => material.dispose())
    const body = (this as unknown as { _body?: THREE.Mesh })._body
    body?.geometry?.dispose()
    if (Array.isArray(body?.material)) {
      body.material.forEach((material) => material.dispose())
    } else {
      body?.material?.dispose()
    }
    materialPool?.list && Object.keys(materialPool.list).forEach((key) => delete materialPool.list?.[key])
    targetPool?.list && Object.keys(targetPool.list).forEach((key) => delete targetPool.list?.[key])
  }
}

function isWeatherParticlePreset(presetId: string): boolean {
  return presetId.includes('rain') || presetId.includes('snow')
}

function resolveWeatherGroundThreshold(presetId: string): number {
  if (presetId.includes('rain')) {
    return presetId.includes('heavy') ? 0.08 : 0.06
  }
  if (presetId.includes('snow')) {
    return presetId.includes('blizzard') ? 0.16 : 0.12
  }
  return 0
}

function resolveWeatherFadeRange(presetId: string): number {
  if (presetId.includes('rain')) {
    return presetId.includes('heavy') ? 0.56 : 0.46
  }
  if (presetId.includes('snow')) {
    return presetId.includes('blizzard') ? 1.35 : 1.05
  }
  return 0
}

function prepareParticleTexture(texture: THREE.Texture, cacheKey: string): THREE.Texture {
  texture.name = texture.name || cacheKey
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipMapLinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function isDirectTextureUrl(assetId: string): boolean {
  return assetId.startsWith('http://') || assetId.startsWith('https://') || assetId.startsWith('data:')
}

async function loadTextureFromDirectUrl(assetId: string): Promise<THREE.Texture | null> {
  try {
    const texture = await loadTextureFromSourceUrl(assetId)
    return prepareParticleTexture(texture, assetId)
  } catch (error) {
    return null
  }
}

async function resolveParticleTextureAsset(assetId: string): Promise<THREE.Texture | null> {
  const normalized = assetId.trim()
  if (!normalized.length) {
    return null
  }
  const cacheKey = `asset:${normalized}`
  const cached = sharedTextureCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const pending = pendingTextureLoads.get(cacheKey)
  if (pending) {
    return pending
  }

  const task = (async (): Promise<THREE.Texture | null> => {
    const resolver = getParticleTextureResolver()
    const resolved = resolver
      ? await resolver(normalized)
      : (isDirectTextureUrl(normalized) ? await loadTextureFromDirectUrl(normalized) : null)
    if (!resolved) {
      return null
    }
    const prepared = prepareParticleTexture(resolved, cacheKey)
    sharedTextureCache.set(cacheKey, prepared)
    return prepared
  })().finally(() => {
    pendingTextureLoads.delete(cacheKey)
  })

  pendingTextureLoads.set(cacheKey, task)
  return task
}

function createSpriteBody(props: ParticleSystemComponentProps, texture: THREE.Texture | null): THREE.Sprite {
  const resolvedTexture = texture ?? getPresetFallbackTexture(props.presetId)
  const material = new THREE.SpriteMaterial({
    map: resolvedTexture,
    color: props.exposedParams.color,
    transparent: true,
    opacity: props.exposedParams.opacity,
    depthWrite: props.render.depthWrite,
    blending: getBlendMode(props.render.blendMode),
  })
  const sprite = new THREE.Sprite(material)
  sprite.renderOrder = props.render.sortOffset
  return sprite
}

function createZone(config: ParticleEmitterConfig): unknown {
  if (config.shape === 'box') {
    return new BoxZone(config.size.x, config.size.y, config.size.z)
  }
  if (config.shape === 'sphere') {
    return new SphereZone(config.radius)
  }
  return new PointZone(config.position.x, config.position.y, config.position.z)
}

function createVelocity(config: ParticleEmitterConfig): unknown {
  if (config.velocityMode === 'vector') {
    return new VectorVelocity(
      new Vector3D(config.direction.x * config.speed, config.direction.y * config.speed, config.direction.z * config.speed),
      config.spread,
    )
  }
  return new RadialVelocity(config.speed, new Vector3D(config.direction.x, config.direction.y, config.direction.z), config.spread * 57.2958)
}

function createForceBehaviour(force: { x: number; y: number; z: number } | undefined): InstanceType<typeof Force> | null {
  const vector = force ?? { x: 0, y: 0, z: 0 }
  if (Math.abs(vector.x) <= 1e-6 && Math.abs(vector.y) <= 1e-6 && Math.abs(vector.z) <= 1e-6) {
    return null
  }
  return new Force(vector.x, vector.y, vector.z)
}

function createEmissionRate(emissionRate: number, updateHz: number): InstanceType<typeof Rate> {
  const particlesPerSecond = Math.max(0, emissionRate)
  if (particlesPerSecond <= 0) {
    return new Rate(new Span(0, 0), new Span(1, 1))
  }
  const updatesPerSecond = Math.max(1, Math.round(updateHz))
  const particlesPerEmission = Math.max(1, Math.min(8, Math.ceil(particlesPerSecond / updatesPerSecond)))
  const emissionInterval = particlesPerEmission / particlesPerSecond
  const intervalJitter = emissionInterval * 0.12
  const minInterval = Math.max(1 / 120, emissionInterval - intervalJitter)
  const maxInterval = Math.max(minInterval, emissionInterval + intervalJitter)
  return new Rate(new Span(Math.max(1, particlesPerEmission - 1), particlesPerEmission + 1), new Span(minInterval, maxInterval))
}

function buildEmitter(config: ParticleEmitterConfig, props: ParticleSystemComponentProps, texture: THREE.Texture | null): any {
  const emitter = new Emitter()
  const budgeted = applyEmitterBudget(config, props.budget)
  // three-nebula 的 ColorUtil 会在颜色为 null/undefined 时直接读取 `color.r`
  // （小程序上表现为 "null is not an object"），这里先做一次兜底校验。
  const colorA = sanitizeParticleColor(budgeted.color)
  const colorB = sanitizeParticleColor(budgeted.color2)
  emitter.setRate(createEmissionRate(budgeted.emissionRate, props.budget.updateHz))
  const initializers = [
    ...(props.render.renderMode === 'paper' ? [] : [new Body(createSpriteBody(props, texture))]),
    new Position(createZone(budgeted)),
    new Mass(1),
    new Radius(props.render.renderMode === 'paper'
      ? Math.max(0.01, budgeted.particleSize)
      : Math.max(1, budgeted.particleSize * 18)),
    new Life(Math.max(0.05, budgeted.lifetime * 0.6), budgeted.lifetime),
    createVelocity(budgeted),
  ]
  emitter.setInitializers(initializers)
  const behaviours = [
    new Alpha(budgeted.alphaStart, budgeted.alphaEnd),
    new Scale(budgeted.scaleStart, budgeted.scaleEnd),
    new NebulaColor(colorA, colorB),
  ]
  const forceBehaviour = createForceBehaviour(budgeted.physics?.force)
  if (forceBehaviour) {
    behaviours.push(forceBehaviour)
  }
  emitter.setBehaviours(behaviours)
  emitter.position.set(budgeted.position.x, budgeted.position.y, budgeted.position.z)
  return emitter
}

/** Colors must be parseable hex strings; three-nebula reads `.r` off the resolved value. */
function sanitizeParticleColor(value: unknown): string {
  if (typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
    return value.trim()
  }
  return DEFAULT_PARTICLE_EXPOSED_PARAMS.color
}

class ParticleSystemRuntimeController implements ParticleSystemRuntimeHandle {
  readonly group = new THREE.Group()
  props: ParticleSystemComponentProps
  private readonly renderGroup = new THREE.Group()
  private readonly tempWorldPosition = new THREE.Vector3()
  private readonly tempCameraPosition = new THREE.Vector3()
  private active = false
  private disposed = false
  private lowFpsAccumulator = 0
  private updateAccumulator = 0
  private currentTexture: THREE.Texture | null = null
  private currentTextureAssetId: string | null = null
  private textureLoadVersion = 0
  private system: any
  private renderer: any
  private emitters: Array<{ id: string; emitter: any }> = []

  constructor(initialProps: ParticleSystemComponentProps) {
    this.props = clampParticleSystemComponentProps(initialProps)
    this.group.name = 'Effect:ParticleSystem'
    this.renderGroup.name = 'Effect:ParticleRenderGroup'
    this.group.add(this.renderGroup)
    this.applyTransform()
    this.buildSystem()
    this.syncTextureAsset()
    if (this.props.playback.autoPlay && this.props.playback.startActive) {
      this.play()
    }
  }

  private applyTransform(): void {
    const { positionOffset, rotationOffset, scaleMultiplier } = this.props.transform
    this.group.position.set(positionOffset.x, positionOffset.y, positionOffset.z)
    this.group.rotation.set(rotationOffset.x, rotationOffset.y, rotationOffset.z)
    this.group.scale.setScalar(scaleMultiplier)
  }

  private cullWeatherParticlesBelowGround(): void {
    if (!isWeatherParticlePreset(this.props.presetId)) {
      return
    }
    const groundThreshold = resolveWeatherGroundThreshold(this.props.presetId)
    const fadeRange = resolveWeatherFadeRange(this.props.presetId)
    // Nebula keeps particle positions in the particle system's local space,
    // while the group position is in world space. Comparing the two made all
    // particles appear below ground as soon as the owning node was moved up
    // (for example, a high Empty Node with a snow effect). Weather effects are
    // grounded at the owning node's local origin, so keep this comparison in
    // the same local coordinate space as particle.position.
    const groundY = 0
    for (const entry of this.emitters) {
      const particles = entry.emitter?.particles
      if (!Array.isArray(particles) || !particles.length) {
        continue
      }
      for (const particle of particles as Array<{
        dead?: boolean
        sleep?: boolean
        position?: { y?: number }
        alpha?: number
        destroy?: () => void
        __harmonyBaseAlpha?: number
      }>) {
        if (!particle || particle.dead || particle.sleep || !particle.position) {
          continue
        }
        const particleY = particle.position.y ?? Number.POSITIVE_INFINITY
        const heightAboveGround = particleY - groundY
        const fadeFactor = fadeRange > 0
          ? Math.min(1, Math.max(0, heightAboveGround / Math.max(1e-6, fadeRange)))
          : 1
        if (typeof particle.alpha === 'number') {
          if (typeof particle.__harmonyBaseAlpha !== 'number') {
            particle.__harmonyBaseAlpha = particle.alpha
          }
          particle.alpha = particle.__harmonyBaseAlpha * fadeFactor
        }
        if (particleY <= groundY + groundThreshold) {
          if (typeof particle.destroy === 'function') {
            particle.destroy()
          } else {
            particle.dead = true
          }
        }
      }
    }
  }

  private buildSystem(): void {
    this.disposeSystemOnly()
    this.system = new System()
    this.renderer = this.props.render.renderMode === 'paper'
      ? new PaperRenderer(this.renderGroup, THREE, this.props)
      : new SpriteRenderer(this.renderGroup, THREE)
    this.emitters = this.props.emitters.map((entry) => ({
      id: entry.id,
      emitter: buildEmitter(entry, this.props, this.currentTexture),
    }))
    this.emitters.forEach((entry) => {
      this.system.addEmitter(entry.emitter)
    })
    this.system.addRenderer(this.renderer)
    if (this.props.playback.prewarmSeconds > 0) {
      const step = 1 / Math.max(1, this.props.budget.updateHz)
      const iterations = Math.min(180, Math.round(this.props.playback.prewarmSeconds / step))
      for (let index = 0; index < iterations; index += 1) {
        this.system.update(step)
      }
    }
    this.updateUserData()
  }

  private syncTextureAsset(): void {
    const nextAssetId = typeof this.props.render.textureAssetId === 'string'
      ? this.props.render.textureAssetId.trim()
      : ''
    if (!nextAssetId) {
      if (this.currentTextureAssetId !== null || this.currentTexture !== null) {
        this.currentTextureAssetId = null
        this.currentTexture = null
        this.buildSystem()
      }
      return
    }
    if (this.currentTextureAssetId === nextAssetId && this.currentTexture !== null) {
      return
    }

    this.currentTextureAssetId = nextAssetId
    this.currentTexture = null
    this.buildSystem()

    const version = ++this.textureLoadVersion
    void resolveParticleTextureAsset(nextAssetId).then((texture) => {
      if (this.disposed || version !== this.textureLoadVersion) {
        return
      }
      if ((this.props.render.textureAssetId?.trim() ?? '') !== nextAssetId) {
        return
      }
      this.currentTextureAssetId = nextAssetId
      this.currentTexture = texture
      this.buildSystem()
      if (this.active) {
        this.play()
      }
    })
  }

  private disposeSystemOnly(): void {
    if (this.system && typeof this.system.destroy === 'function') {
      this.system.destroy()
    }
    this.renderGroup.clear()
    this.system = null
    this.renderer = null
    this.emitters = []
  }

  private updateUserData(): void {
    const userData = this.group.userData ?? (this.group.userData = {})
    userData[PARTICLE_SYSTEM_METADATA_KEY] = cloneParticleSystemComponentProps(this.props)
    userData[PARTICLE_SYSTEM_ACTIVE_FLAG] = this.active
  }

  play(): void {
    if (this.disposed) {
      return
    }
    if (!this.system || !this.renderer || !this.emitters.length) {
      this.buildSystem()
    }
    this.active = true
    for (const entry of this.emitters) {
      const emitter = entry.emitter as {
        setTotalEmitTimes?: (totalEmitTimes?: number) => unknown
        setLife?: (life?: number) => unknown
        rate?: { init?: () => void }
        isEmitting?: boolean
      }
      if (typeof emitter.setTotalEmitTimes === 'function') {
        emitter.setTotalEmitTimes(Infinity)
      }
      if (typeof emitter.setLife === 'function') {
        emitter.setLife(Infinity)
      }
      if (typeof emitter.rate?.init === 'function') {
        emitter.rate.init()
      }
      if (typeof emitter.isEmitting === 'boolean') {
        emitter.isEmitting = true
      }
    }
    this.updateUserData()
  }

  stop(options: { soft?: boolean } = {}): void {
    this.active = false
    for (const entry of this.emitters) {
      const emitter = entry.emitter as {
        stopEmit?: () => unknown
        isEmitting?: boolean
      }
      if (typeof emitter.stopEmit === 'function') {
        emitter.stopEmit()
      } else if (typeof emitter.isEmitting === 'boolean') {
        emitter.isEmitting = false
      }
    }
    if (this.system && typeof this.system.stop === 'function') {
      this.system.stop(Boolean(options.soft))
    }
    if (!options.soft) {
      this.disposeSystemOnly()
    }
    this.updateUserData()
  }

  restart(): void {
    if (this.disposed) {
      return
    }
    this.stop({ soft: false })
    this.buildSystem()
  }

  burst(count?: number, emitterId?: string): void {
    if (!this.emitters.length) {
      return
    }
    const targetEntries = emitterId
      ? this.emitters.filter((entry) => entry.id === emitterId)
      : this.emitters
    if (!targetEntries.length) {
      return
    }
    const requestedTotal = Math.max(
      0,
      Math.min(
        count ?? this.props.exposedParams.burstCount,
        this.props.budget.maxParticles,
      ),
    )
    const currentParticles = this.emitters.reduce((sum, entry) => {
      const particles = (entry.emitter as { particles?: Array<unknown> }).particles
      return sum + (Array.isArray(particles) ? particles.length : 0)
    }, 0)
    const totalAvailableParticles = Math.max(0, this.props.budget.maxParticles - currentParticles)
    const capacities = targetEntries.map((entry) => {
      const particles = (entry.emitter as { particles?: Array<unknown> }).particles
      const current = Array.isArray(particles) ? particles.length : 0
      return Math.max(0, this.props.budget.maxParticles - current)
    })
    const totalCapacity = capacities.reduce((sum, capacity) => sum + capacity, 0)
    const totalToCreate = Math.min(requestedTotal, totalAvailableParticles, totalCapacity)
    if (totalToCreate <= 0) {
      return
    }
    const allocations = allocateParticleBurstCounts(totalToCreate, capacities)
    targetEntries.forEach((target, index) => {
      const emitterCreateCount = allocations[index] ?? 0
      if (emitterCreateCount <= 0) {
        return
      }
      const emitter = target.emitter as {
        particles?: Array<unknown>
        isEmitting?: boolean
        createParticle?: () => unknown
        emit?: (totalEmitTimes?: number, life?: number) => unknown
      }
      if (typeof emitter.isEmitting === 'boolean' && !emitter.isEmitting) {
        emitter.isEmitting = true
      }
      if (typeof emitter.createParticle === 'function') {
        let createdParticles = 0
        while (createdParticles < emitterCreateCount) {
          emitter.createParticle()
          createdParticles += 1
        }
      } else if (typeof emitter.emit === 'function') {
        emitter.emit(Math.max(1, emitterCreateCount))
      } else if (this.system && typeof this.system.emit === 'function') {
        this.system.emit({
          totalTime: 0.05,
        })
      }
    })
    this.active = true
    this.updateUserData()
  }

  getParticleCount(): number {
    return this.emitters.reduce((sum, entry) => {
      const particles = (entry.emitter as { particles?: Array<unknown> }).particles
      return sum + (Array.isArray(particles) ? particles.length : 0)
    }, 0)
  }

  getParticleDiagnostics(): ParticleRuntimeDiagnostics {
    const sample = this.emitters
      .flatMap((entry) => {
        const particles = (entry.emitter as { particles?: Array<{
          position?: { x: number; y: number; z: number }
          velocity?: { x: number; y: number; z: number }
          age?: number
          alpha?: number
          scale?: number
          color?: { r: number; g: number; b: number }
          target?: THREE.Object3D | null
        }> }).particles
        return Array.isArray(particles) ? particles : []
      })
      .find((particle) => particle.position)
    return {
      active: this.active,
      particleCount: this.getParticleCount(),
      groupVisible: this.group.visible,
      sample: sample?.position
        ? {
            age: sample.age ?? 0,
            position: {
              x: sample.position.x,
              y: sample.position.y,
              z: sample.position.z,
            },
            velocity: {
              x: sample.velocity?.x ?? 0,
              y: sample.velocity?.y ?? 0,
              z: sample.velocity?.z ?? 0,
            },
            alpha: sample.alpha ?? 0,
            scale: sample.scale ?? 0,
            color: {
              r: sample.color?.r ?? 0,
              g: sample.color?.g ?? 0,
              b: sample.color?.b ?? 0,
            },
            targetVisible: sample.target?.visible ?? false,
          }
        : null,
    }
  }

  setPlaybackActive(active: boolean): void {
    if (active) {
      this.play()
      return
    }
    this.stop({ soft: true })
  }

  setExposedParams(patch: Partial<ParticleExposedParams>): void {
    this.props = clampParticleSystemComponentProps({
      ...this.props,
      exposedParams: {
        ...this.props.exposedParams,
        ...patch,
      },
    })
    this.buildSystem()
    this.syncTextureAsset()
    if (this.active) {
      this.play()
    }
  }

  tick(
    delta: number,
    frameState: { cameraWorldPosition: { x: number; y: number; z: number } | null } = { cameraWorldPosition: null },
    runtimeStats: ParticleBudgetRuntimeStats = { activeSystems: 1, totalEstimatedParticles: estimateParticleSystemCost(this.props).estimatedParticles, lowFpsMode: false, isMiniProgram: false },
  ): void {
    if (this.disposed || !this.system || !Number.isFinite(delta) || delta <= 0) {
      return
    }
    this.lowFpsAccumulator = delta > 0.05 ? Math.min(this.lowFpsAccumulator + delta, 2) : Math.max(0, this.lowFpsAccumulator - delta)
    const lowFpsMode = runtimeStats.lowFpsMode || this.lowFpsAccumulator >= 0.5
    const distanceToCamera = frameState.cameraWorldPosition
      ? this.group.getWorldPosition(this.tempWorldPosition).distanceTo(this.tempCameraPosition.set(
        frameState.cameraWorldPosition.x,
        frameState.cameraWorldPosition.y,
        frameState.cameraWorldPosition.z,
      ))
      : null
    const decision: ParticleBudgetDecision = resolveParticleBudgetDecision({
      budget: this.props.budget,
      distanceToCamera,
      visible: this.group.visible,
      runtimeStats: {
        ...runtimeStats,
        lowFpsMode,
      },
    })
    if (!decision.enabled || !this.active) {
      return
    }
    this.updateAccumulator += delta
    if (this.updateAccumulator < decision.updateIntervalSeconds) {
      return
    }
    const step = this.updateAccumulator
    this.updateAccumulator = 0
    this.system.update(step)
    this.cullWeatherParticlesBelowGround()
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.stop({ soft: false })
    this.disposeSystemOnly()
    this.group.removeFromParent()
  }
}

export function createParticleSystemRuntime(props: ParticleSystemComponentProps): ParticleSystemRuntimeHandle {
  return new ParticleSystemRuntimeController(props)
}

export function registerParticleSystemRuntime(object: THREE.Object3D, componentId: string, runtime: ParticleRuntimeRegistryEntry): void {
  const userData = object.userData ?? (object.userData = {})
  let registry = userData[PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY] as Record<string, ParticleRuntimeRegistryEntry> | undefined
  if (!registry) {
    registry = {}
    userData[PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY] = registry
  }
  registry[componentId] = runtime
}

export function unregisterParticleSystemRuntime(object: THREE.Object3D, componentId: string): void {
  const registry = object.userData?.[PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY] as Record<string, ParticleRuntimeRegistryEntry> | undefined
  if (!registry) {
    return
  }
  delete registry[componentId]
  if (!Object.keys(registry).length) {
    delete object.userData[PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY]
  }
}
