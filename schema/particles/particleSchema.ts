import type { Vector3Like } from '../core'

export const PARTICLE_SYSTEM_COMPONENT_TYPE = 'particleSystem'
export const PARTICLE_SYSTEM_RUNTIME_REGISTRY_KEY = '__harmonyParticleSystemRuntime'
export const PARTICLE_SYSTEM_METADATA_KEY = '__harmonyParticleSystem'
export const PARTICLE_SYSTEM_ACTIVE_FLAG = '__harmonyParticleSystemActive'

export type ParticleQualityTier = 'mini-safe' | 'balanced' | 'desktop-rich'
export type ParticleBlendMode = 'normal' | 'additive' | 'alpha'
export type ParticleRenderMode = 'sprite'
export type ParticleEmitterShape = 'point' | 'box' | 'sphere'
export type ParticleVelocityMode = 'radial' | 'vector'
export type ParticleSpace = 'local' | 'world'

export interface ParticlePlaybackProps {
  autoPlay: boolean
  loop: boolean
  startActive: boolean
  prewarmSeconds: number
  softStopSeconds: number
}

export interface ParticleBudgetProps {
  qualityTier: ParticleQualityTier
  maxParticles: number
  spawnRateScale: number
  cullDistance: number
  updateHz: number
}

export interface ParticleTransformProps {
  localSpace: ParticleSpace
  positionOffset: Vector3Like
  rotationOffset: Vector3Like
  scaleMultiplier: number
}

export interface ParticleRenderProps {
  textureAssetId: string | null
  blendMode: ParticleBlendMode
  depthWrite: boolean
  sortOffset: number
  renderMode: ParticleRenderMode
}

export interface ParticleExposedParams {
  color: string
  intensity: number
  particleSize: number
  lifetime: number
  emissionRate: number
  burstCount: number
  speed: number
  radius: number
  spread: number
  opacity: number
}

export interface ParticleEmitterConfig {
  id: string
  shape: ParticleEmitterShape
  position: Vector3Like
  size: Vector3Like
  radius: number
  emissionRate: number
  emissionBursts: number
  maxParticles: number
  particleSize: number
  lifetime: number
  speed: number
  velocityMode: ParticleVelocityMode
  direction: Vector3Like
  spread: number
  physics?: {
    force: Vector3Like
  }
  color: string
  color2: string
  alphaStart: number
  alphaEnd: number
  scaleStart: number
  scaleEnd: number
}

export interface ParticleSystemComponentProps {
  presetId: string
  playback: ParticlePlaybackProps
  budget: ParticleBudgetProps
  transform: ParticleTransformProps
  render: ParticleRenderProps
  exposedParams: ParticleExposedParams
  emitters: ParticleEmitterConfig[]
}

export const PARTICLE_COMPONENT_MAX_PARTICLES = 120
export const PARTICLE_COMPONENT_MAX_BURST = 48
export const PARTICLE_COMPONENT_MAX_SCENE_ACTIVE = 12
export const PARTICLE_SCENE_SOFT_PARTICLE_LIMIT = 800

export const DEFAULT_PARTICLE_PLAYBACK: ParticlePlaybackProps = {
  autoPlay: true,
  loop: true,
  startActive: true,
  prewarmSeconds: 0,
  softStopSeconds: 0.25,
}

export const DEFAULT_PARTICLE_BUDGET: ParticleBudgetProps = {
  qualityTier: 'mini-safe',
  maxParticles: 72,
  spawnRateScale: 1,
  cullDistance: 24,
  updateHz: 30,
}

export const DEFAULT_PARTICLE_TRANSFORM: ParticleTransformProps = {
  localSpace: 'local',
  positionOffset: { x: 0, y: 0, z: 0 },
  rotationOffset: { x: 0, y: 0, z: 0 },
  scaleMultiplier: 1,
}

export const DEFAULT_PARTICLE_RENDER: ParticleRenderProps = {
  textureAssetId: null,
  blendMode: 'additive',
  depthWrite: false,
  sortOffset: 0,
  renderMode: 'sprite',
}

export const DEFAULT_PARTICLE_EXPOSED_PARAMS: ParticleExposedParams = {
  color: '#46d9ff',
  intensity: 1,
  particleSize: 0.18,
  lifetime: 1.5,
  emissionRate: 14,
  burstCount: 18,
  speed: 1.6,
  radius: 0.75,
  spread: 0.6,
  opacity: 0.85,
}

export const DEFAULT_PARTICLE_EMITTER_FORCE: Vector3Like = {
  x: 0,
  y: 0,
  z: 0,
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, numeric))
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return fallback
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

function normalizeVector3Like(value: unknown, fallback: Vector3Like): Vector3Like {
  if (!value || typeof value !== 'object') {
    return { ...fallback }
  }
  const candidate = value as Partial<Vector3Like>
  return {
    x: clampNumber(candidate.x, -9999, 9999, fallback.x),
    y: clampNumber(candidate.y, -9999, 9999, fallback.y),
    z: clampNumber(candidate.z, -9999, 9999, fallback.z),
  }
}

function normalizeEmitterShape(value: unknown): ParticleEmitterShape {
  return value === 'box' || value === 'sphere' ? value : 'point'
}

function normalizeBlendMode(value: unknown): ParticleBlendMode {
  return value === 'normal' || value === 'alpha' ? value : 'additive'
}

function normalizeQualityTier(value: unknown): ParticleQualityTier {
  return value === 'balanced' || value === 'desktop-rich' ? value : 'mini-safe'
}

function normalizeVelocityMode(value: unknown): ParticleVelocityMode {
  return value === 'vector' ? 'vector' : 'radial'
}

function normalizeParticleEmitterConfig(
  value: Partial<ParticleEmitterConfig> | null | undefined,
  index: number,
): ParticleEmitterConfig {
  const source = value ?? {}
  return {
    id: typeof source.id === 'string' && source.id.trim().length ? source.id.trim() : `emitter_${index + 1}`,
    shape: normalizeEmitterShape(source.shape),
    position: normalizeVector3Like(source.position, { x: 0, y: 0, z: 0 }),
    size: normalizeVector3Like(source.size, { x: 1, y: 1, z: 1 }),
    radius: clampNumber(source.radius, 0, 32, DEFAULT_PARTICLE_EXPOSED_PARAMS.radius),
    emissionRate: clampNumber(source.emissionRate, 0, 120, DEFAULT_PARTICLE_EXPOSED_PARAMS.emissionRate),
    emissionBursts: Math.round(clampNumber(source.emissionBursts, 0, PARTICLE_COMPONENT_MAX_BURST, DEFAULT_PARTICLE_EXPOSED_PARAMS.burstCount)),
    maxParticles: Math.round(clampNumber(source.maxParticles, 1, PARTICLE_COMPONENT_MAX_PARTICLES, DEFAULT_PARTICLE_BUDGET.maxParticles)),
    particleSize: clampNumber(source.particleSize, 0.02, 2, DEFAULT_PARTICLE_EXPOSED_PARAMS.particleSize),
    lifetime: clampNumber(source.lifetime, 0.05, 12, DEFAULT_PARTICLE_EXPOSED_PARAMS.lifetime),
    speed: clampNumber(source.speed, 0, 24, DEFAULT_PARTICLE_EXPOSED_PARAMS.speed),
    velocityMode: normalizeVelocityMode(source.velocityMode),
    direction: normalizeVector3Like(source.direction, { x: 0, y: 1, z: 0 }),
    spread: clampNumber(source.spread, 0, 6.28318, DEFAULT_PARTICLE_EXPOSED_PARAMS.spread),
    physics: {
      force: normalizeVector3Like(source.physics?.force, DEFAULT_PARTICLE_EMITTER_FORCE),
    },
    color: normalizeHexColor(source.color, DEFAULT_PARTICLE_EXPOSED_PARAMS.color),
    color2: normalizeHexColor(source.color2, DEFAULT_PARTICLE_EXPOSED_PARAMS.color),
    alphaStart: clampNumber(source.alphaStart, 0, 1, DEFAULT_PARTICLE_EXPOSED_PARAMS.opacity),
    alphaEnd: clampNumber(source.alphaEnd, 0, 1, 0),
    scaleStart: clampNumber(source.scaleStart, 0.01, 4, 1),
    scaleEnd: clampNumber(source.scaleEnd, 0.01, 4, 0.2),
  }
}

export function clampParticleBudgetProps(value: Partial<ParticleBudgetProps> | null | undefined): ParticleBudgetProps {
  const source = value ?? {}
  return {
    qualityTier: normalizeQualityTier(source.qualityTier),
    maxParticles: Math.round(clampNumber(source.maxParticles, 1, PARTICLE_COMPONENT_MAX_PARTICLES, DEFAULT_PARTICLE_BUDGET.maxParticles)),
    spawnRateScale: clampNumber(source.spawnRateScale, 0, 1, DEFAULT_PARTICLE_BUDGET.spawnRateScale),
    cullDistance: clampNumber(source.cullDistance, 2, 200, DEFAULT_PARTICLE_BUDGET.cullDistance),
    updateHz: Math.round(clampNumber(source.updateHz, 10, 60, DEFAULT_PARTICLE_BUDGET.updateHz)),
  }
}

export function cloneParticleBudgetProps(props: ParticleBudgetProps): ParticleBudgetProps {
  return { ...props }
}

export function clampParticleSystemComponentProps(
  value: Partial<ParticleSystemComponentProps> | null | undefined,
): ParticleSystemComponentProps {
  const source = value ?? {}
  const playback: Partial<ParticlePlaybackProps> = source.playback ?? {}
  const transform: Partial<ParticleTransformProps> = source.transform ?? {}
  const render: Partial<ParticleRenderProps> = source.render ?? {}
  const exposedParams: Partial<ParticleExposedParams> = source.exposedParams ?? {}
  const budget = clampParticleBudgetProps(source.budget)
  const emittersSource = Array.isArray(source.emitters) ? source.emitters : []
  const emitters = emittersSource.length
    ? emittersSource.slice(0, 4).map((entry, index) => normalizeParticleEmitterConfig(entry, index))
    : [normalizeParticleEmitterConfig({
      emissionRate: DEFAULT_PARTICLE_EXPOSED_PARAMS.emissionRate,
      emissionBursts: DEFAULT_PARTICLE_EXPOSED_PARAMS.burstCount,
      maxParticles: budget.maxParticles,
      particleSize: DEFAULT_PARTICLE_EXPOSED_PARAMS.particleSize,
      lifetime: DEFAULT_PARTICLE_EXPOSED_PARAMS.lifetime,
      speed: DEFAULT_PARTICLE_EXPOSED_PARAMS.speed,
      radius: DEFAULT_PARTICLE_EXPOSED_PARAMS.radius,
      spread: DEFAULT_PARTICLE_EXPOSED_PARAMS.spread,
      color: DEFAULT_PARTICLE_EXPOSED_PARAMS.color,
      color2: DEFAULT_PARTICLE_EXPOSED_PARAMS.color,
      shape: 'point',
    }, 0)]
  return {
    presetId: typeof source.presetId === 'string' && source.presetId.trim().length ? source.presetId.trim() : 'groundAuraLite',
    playback: {
      autoPlay: normalizeBoolean(playback.autoPlay, DEFAULT_PARTICLE_PLAYBACK.autoPlay),
      loop: normalizeBoolean(playback.loop, DEFAULT_PARTICLE_PLAYBACK.loop),
      startActive: normalizeBoolean(playback.startActive, DEFAULT_PARTICLE_PLAYBACK.startActive),
      prewarmSeconds: clampNumber(playback.prewarmSeconds, 0, 5, DEFAULT_PARTICLE_PLAYBACK.prewarmSeconds),
      softStopSeconds: clampNumber(playback.softStopSeconds, 0, 5, DEFAULT_PARTICLE_PLAYBACK.softStopSeconds),
    },
    budget,
    transform: {
      localSpace: transform.localSpace === 'world' ? 'world' : 'local',
      positionOffset: normalizeVector3Like(transform.positionOffset, DEFAULT_PARTICLE_TRANSFORM.positionOffset),
      rotationOffset: normalizeVector3Like(transform.rotationOffset, DEFAULT_PARTICLE_TRANSFORM.rotationOffset),
      scaleMultiplier: clampNumber(transform.scaleMultiplier, 0.01, 10, DEFAULT_PARTICLE_TRANSFORM.scaleMultiplier),
    },
    render: {
      textureAssetId: typeof render.textureAssetId === 'string' && render.textureAssetId.trim().length ? render.textureAssetId.trim() : null,
      blendMode: normalizeBlendMode(render.blendMode),
      depthWrite: normalizeBoolean(render.depthWrite, DEFAULT_PARTICLE_RENDER.depthWrite),
      sortOffset: clampNumber(render.sortOffset, -100, 100, DEFAULT_PARTICLE_RENDER.sortOffset),
      renderMode: 'sprite',
    },
    exposedParams: {
      color: normalizeHexColor(exposedParams.color, DEFAULT_PARTICLE_EXPOSED_PARAMS.color),
      intensity: clampNumber(exposedParams.intensity, 0, 8, DEFAULT_PARTICLE_EXPOSED_PARAMS.intensity),
      particleSize: clampNumber(exposedParams.particleSize, 0.02, 2, DEFAULT_PARTICLE_EXPOSED_PARAMS.particleSize),
      lifetime: clampNumber(exposedParams.lifetime, 0.05, 12, DEFAULT_PARTICLE_EXPOSED_PARAMS.lifetime),
      emissionRate: clampNumber(exposedParams.emissionRate, 0, 120, DEFAULT_PARTICLE_EXPOSED_PARAMS.emissionRate),
      burstCount: Math.round(clampNumber(exposedParams.burstCount, 0, PARTICLE_COMPONENT_MAX_BURST, DEFAULT_PARTICLE_EXPOSED_PARAMS.burstCount)),
      speed: clampNumber(exposedParams.speed, 0, 24, DEFAULT_PARTICLE_EXPOSED_PARAMS.speed),
      radius: clampNumber(exposedParams.radius, 0, 32, DEFAULT_PARTICLE_EXPOSED_PARAMS.radius),
      spread: clampNumber(exposedParams.spread, 0, 6.28318, DEFAULT_PARTICLE_EXPOSED_PARAMS.spread),
      opacity: clampNumber(exposedParams.opacity, 0, 1, DEFAULT_PARTICLE_EXPOSED_PARAMS.opacity),
    },
    emitters: emitters.map((entry, index) => normalizeParticleEmitterConfig({
      ...entry,
      maxParticles: Math.min(entry.maxParticles, budget.maxParticles),
    }, index)),
  }
}

export function cloneParticleEmitterConfig(props: ParticleEmitterConfig): ParticleEmitterConfig {
  return {
    ...props,
    position: { ...props.position },
    size: { ...props.size },
    direction: { ...props.direction },
    physics: {
      force: { ...(props.physics?.force ?? DEFAULT_PARTICLE_EMITTER_FORCE) },
    },
  }
}

export function cloneParticleSystemComponentProps(props: ParticleSystemComponentProps): ParticleSystemComponentProps {
  return {
    presetId: props.presetId,
    playback: { ...props.playback },
    budget: { ...props.budget },
    transform: {
      localSpace: props.transform.localSpace,
      positionOffset: { ...props.transform.positionOffset },
      rotationOffset: { ...props.transform.rotationOffset },
      scaleMultiplier: props.transform.scaleMultiplier,
    },
    render: { ...props.render },
    exposedParams: { ...props.exposedParams },
    emitters: props.emitters.map(cloneParticleEmitterConfig),
  }
}

export function estimateParticleSystemCost(props: ParticleSystemComponentProps): {
  estimatedParticles: number
  exceedsMiniBudget: boolean
  exceedsSceneBudget: boolean
} {
  const estimatedParticles = props.emitters.reduce((sum, emitter) => sum + emitter.maxParticles, 0)
  return {
    estimatedParticles,
    exceedsMiniBudget: estimatedParticles > PARTICLE_COMPONENT_MAX_PARTICLES,
    exceedsSceneBudget: estimatedParticles > Math.min(PARTICLE_SCENE_SOFT_PARTICLE_LIMIT, PARTICLE_COMPONENT_MAX_PARTICLES * PARTICLE_COMPONENT_MAX_SCENE_ACTIVE),
  }
}
