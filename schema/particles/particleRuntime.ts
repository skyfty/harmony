import * as THREE from 'three'
// three-nebula ships without stable bundled typings in this build path.
// Keep the runtime import and rely on the local ambient declaration file.
// @ts-ignore
import System, { Alpha, Body, BoxZone, Color as NebulaColor, Emitter, Life, Mass, PointZone, Position, RadialVelocity, Radius, Rate, Scale, Span, SphereZone, SpriteRenderer, Vector3D, VectorVelocity } from 'three-nebula'
import type { ParticleBudgetDecision, ParticleBudgetRuntimeStats } from './particleBudget'
import { applyEmitterBudget, resolveParticleBudgetDecision } from './particleBudget'
import { getParticleTextureResolver } from './particleTextureResolver'
import {
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
  tick(delta: number, frameState?: { cameraWorldPosition: { x: number; y: number; z: number } | null }, runtimeStats?: ParticleBudgetRuntimeStats): void
  setPlaybackActive(active: boolean): void
  setExposedParams(patch: Partial<ParticleExposedParams>): void
  dispose(): void
}

export interface ParticleSystemRuntimeHandle extends ParticleRuntimeRegistryEntry {
  group: THREE.Group
}

const sharedTextureCache = new Map<string, THREE.Texture>()
const pendingTextureLoads = new Map<string, Promise<THREE.Texture | null>>()
const sharedTextureLoader = new THREE.TextureLoader()

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

function isWeatherParticlePreset(presetId: string): boolean {
  return presetId.includes('rain') || presetId.includes('snow')
}

function resolveWeatherGravityStrength(presetId: string): number {
  if (presetId.includes('rain')) {
    return presetId.includes('heavy') ? 15.5 : 12.5
  }
  if (presetId.includes('snow')) {
    return presetId.includes('blizzard') ? 4.1 : 3.2
  }
  return 0
}

function resolveWeatherGroundThreshold(presetId: string): number {
  if (presetId.includes('rain')) {
    return 0.12
  }
  if (presetId.includes('snow')) {
    return 0.2
  }
  return 0
}

function resolveWeatherFadeRange(presetId: string): number {
  if (presetId.includes('rain')) {
    return presetId.includes('heavy') ? 0.8 : 0.62
  }
  if (presetId.includes('snow')) {
    return presetId.includes('blizzard') ? 1.2 : 1
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
    const texture = await sharedTextureLoader.loadAsync(assetId)
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

function createEmissionRate(emissionRate: number): InstanceType<typeof Rate> {
  const particlesPerSecond = Math.max(0, emissionRate)
  if (particlesPerSecond <= 0) {
    return new Rate(new Span(0, 0), new Span(1, 1))
  }
  const baseInterval = 1 / particlesPerSecond
  const intervalJitter = baseInterval * 0.35
  const minInterval = Math.max(1 / 120, baseInterval - intervalJitter)
  const maxInterval = Math.max(minInterval, baseInterval + intervalJitter)
  return new Rate(new Span(1, 1), new Span(minInterval, maxInterval))
}

function buildEmitter(config: ParticleEmitterConfig, props: ParticleSystemComponentProps, texture: THREE.Texture | null): any {
  const emitter = new Emitter()
  const budgeted = applyEmitterBudget(config, props.budget)
  emitter.setRate(createEmissionRate(budgeted.emissionRate))
  emitter.setInitializers([
    new Body(createSpriteBody(props, texture)),
    new Position(createZone(budgeted)),
    new Mass(1),
    new Radius(Math.max(1, budgeted.particleSize * 18)),
    new Life(Math.max(0.05, budgeted.lifetime * 0.6), budgeted.lifetime),
    createVelocity(budgeted),
  ])
  emitter.setBehaviours([
    new Alpha(budgeted.alphaStart, budgeted.alphaEnd),
    new Scale(budgeted.scaleStart, budgeted.scaleEnd),
    new NebulaColor(budgeted.color, budgeted.color2),
  ])
  emitter.position.set(budgeted.position.x, budgeted.position.y, budgeted.position.z)
  return emitter
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

  private applyWeatherGravity(): void {
    if (!isWeatherParticlePreset(this.props.presetId)) {
      return
    }
    const gravityStrength = resolveWeatherGravityStrength(this.props.presetId)
    if (gravityStrength <= 0) {
      return
    }
    for (const entry of this.emitters) {
      const particles = entry.emitter?.particles
      if (!Array.isArray(particles) || !particles.length) {
        continue
      }
      for (const particle of particles as Array<{ dead?: boolean; sleep?: boolean; acceleration?: { y?: number } }>) {
        if (!particle || particle.dead || particle.sleep || !particle.acceleration) {
          continue
        }
        particle.acceleration.y = (particle.acceleration.y ?? 0) - gravityStrength
      }
    }
  }

  private cullWeatherParticlesBelowGround(): void {
    if (!isWeatherParticlePreset(this.props.presetId)) {
      return
    }
    const groundThreshold = resolveWeatherGroundThreshold(this.props.presetId)
    const fadeRange = resolveWeatherFadeRange(this.props.presetId)
    this.group.getWorldPosition(this.tempWorldPosition)
    const groundY = this.tempWorldPosition.y
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
    this.renderer = new SpriteRenderer(this.renderGroup, THREE)
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
    const target = emitterId ? this.emitters.find((entry) => entry.id === emitterId) : this.emitters[0]
    if (!target?.emitter) {
      return
    }
    const burstCount = Math.max(0, Math.min(count ?? this.props.exposedParams.burstCount, this.props.budget.maxParticles))
    const emitter = target.emitter as {
      particles?: Array<unknown>
      isEmitting?: boolean
      createParticle?: () => unknown
      emit?: (totalEmitTimes?: number, life?: number) => unknown
    }
    if (typeof emitter.isEmitting === 'boolean' && !emitter.isEmitting) {
      emitter.isEmitting = true
    }
    const currentParticles = Array.isArray(emitter.particles) ? emitter.particles.length : 0
    const availableParticles = Math.max(0, this.props.budget.maxParticles - currentParticles)
    const createCount = Math.min(burstCount, availableParticles)
    if (typeof emitter.createParticle === 'function') {
      let createdParticles = 0
      while (createdParticles < createCount) {
        emitter.createParticle()
        createdParticles += 1
      }
    } else if (typeof emitter.emit === 'function') {
      emitter.emit(Math.max(1, burstCount))
    } else if (this.system && typeof this.system.emit === 'function') {
      this.system.emit({
        totalTime: 0.05,
      })
    }
    this.active = true
    this.updateUserData()
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
    this.applyWeatherGravity()
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
