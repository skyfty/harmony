import {
  clampParticleSystemComponentProps,
  cloneParticleSystemComponentProps,
  DEFAULT_PARTICLE_BUDGET,
  DEFAULT_PARTICLE_EXPOSED_PARAMS,
  type ParticleSystemComponentProps,
} from './particleSchema'

export type ParticlePresetDefinition = {
  id: string
  label: string
  description: string
  props: ParticleSystemComponentProps
}

const PRESETS: ParticlePresetDefinition[] = [
  {
    id: 'groundAuraLite',
    label: 'Ground Aura Lite',
    description: 'Low-cost ring aura for ground highlights.',
    props: clampParticleSystemComponentProps({
      presetId: 'groundAuraLite',
      budget: { ...DEFAULT_PARTICLE_BUDGET, maxParticles: 72, cullDistance: 20, updateHz: 30 },
      exposedParams: { ...DEFAULT_PARTICLE_EXPOSED_PARAMS, color: '#46d9ff', emissionRate: 12, burstCount: 16, radius: 0.9, speed: 1.2, lifetime: 1.4 },
      emitters: [
        {
          id: 'ground_ring',
          shape: 'sphere',
          radius: 0.85,
          emissionRate: 12,
          emissionBursts: 16,
          maxParticles: 72,
          particleSize: 0.16,
          lifetime: 1.4,
          speed: 1.2,
          velocityMode: 'radial',
          direction: { x: 0, y: 1, z: 0 },
          spread: 0.5,
          color: '#46d9ff',
          color2: '#a8f6ff',
          alphaStart: 0.8,
          alphaEnd: 0,
          scaleStart: 0.65,
          scaleEnd: 0.15,
          position: { x: 0, y: 0.05, z: 0 },
          size: { x: 0.1, y: 0.1, z: 0.1 },
        },
      ],
    }),
  },
  {
    id: 'warpColumnLite',
    label: 'Warp Column Lite',
    description: 'Vertical portal-style particle column with safe mobile limits.',
    props: clampParticleSystemComponentProps({
      presetId: 'warpColumnLite',
      budget: { qualityTier: 'balanced', maxParticles: 96, spawnRateScale: 1, cullDistance: 28, updateHz: 30 },
      exposedParams: { ...DEFAULT_PARTICLE_EXPOSED_PARAMS, color: '#74f5ff', emissionRate: 20, burstCount: 24, radius: 0.5, speed: 2.4, lifetime: 1.8, particleSize: 0.14 },
      emitters: [
        {
          id: 'column_core',
          shape: 'box',
          position: { x: 0, y: 0.8, z: 0 },
          size: { x: 0.32, y: 1.6, z: 0.32 },
          radius: 0.5,
          emissionRate: 20,
          emissionBursts: 24,
          maxParticles: 96,
          particleSize: 0.14,
          lifetime: 1.8,
          speed: 2.4,
          velocityMode: 'vector',
          direction: { x: 0, y: 1, z: 0 },
          spread: 0.35,
          color: '#74f5ff',
          color2: '#bafcff',
          alphaStart: 0.72,
          alphaEnd: 0,
          scaleStart: 0.85,
          scaleEnd: 0.3,
        },
      ],
    }),
  },
  {
    id: 'sparkBurstLite',
    label: 'Spark Burst Lite',
    description: 'One-shot spark burst with capped mobile burst counts.',
    props: clampParticleSystemComponentProps({
      presetId: 'sparkBurstLite',
      playback: { autoPlay: false, loop: false, startActive: false, prewarmSeconds: 0, softStopSeconds: 0.15 },
      budget: { qualityTier: 'mini-safe', maxParticles: 48, spawnRateScale: 1, cullDistance: 18, updateHz: 30 },
      exposedParams: { ...DEFAULT_PARTICLE_EXPOSED_PARAMS, color: '#ffd16a', emissionRate: 0, burstCount: 28, radius: 0.15, speed: 4.5, lifetime: 0.7, particleSize: 0.09 },
      emitters: [
        {
          id: 'spark_burst',
          shape: 'point',
          position: { x: 0, y: 0.2, z: 0 },
          size: { x: 0, y: 0, z: 0 },
          radius: 0.15,
          emissionRate: 0,
          emissionBursts: 28,
          maxParticles: 48,
          particleSize: 0.09,
          lifetime: 0.7,
          speed: 4.5,
          velocityMode: 'radial',
          direction: { x: 0, y: 1, z: 0 },
          spread: 2.4,
          color: '#ffd16a',
          color2: '#ff8f4f',
          alphaStart: 0.95,
          alphaEnd: 0,
          scaleStart: 1,
          scaleEnd: 0.2,
        },
      ],
    }),
  },
  {
    id: 'smokeLoopLite',
    label: 'Smoke Loop Lite',
    description: 'Slow drifting smoke tuned for low-frequency updates.',
    props: clampParticleSystemComponentProps({
      presetId: 'smokeLoopLite',
      budget: { qualityTier: 'mini-safe', maxParticles: 64, spawnRateScale: 1, cullDistance: 22, updateHz: 24 },
      exposedParams: { ...DEFAULT_PARTICLE_EXPOSED_PARAMS, color: '#c7d0d8', emissionRate: 8, burstCount: 10, radius: 0.45, speed: 0.8, lifetime: 2.2, particleSize: 0.26, opacity: 0.45 },
      render: { textureAssetId: null, blendMode: 'alpha', depthWrite: false, sortOffset: 0, renderMode: 'sprite' },
      emitters: [
        {
          id: 'smoke_loop',
          shape: 'box',
          position: { x: 0, y: 0.2, z: 0 },
          size: { x: 0.35, y: 0.2, z: 0.35 },
          radius: 0.45,
          emissionRate: 8,
          emissionBursts: 10,
          maxParticles: 64,
          particleSize: 0.26,
          lifetime: 2.2,
          speed: 0.8,
          velocityMode: 'vector',
          direction: { x: 0.1, y: 1, z: 0.1 },
          spread: 0.45,
          color: '#c7d0d8',
          color2: '#eef2f5',
          alphaStart: 0.45,
          alphaEnd: 0,
          scaleStart: 0.8,
          scaleEnd: 1.45,
        },
      ],
    }),
  },
]

const PRESET_MAP = new Map(PRESETS.map((entry) => [entry.id, entry]))

export function listParticlePresets(): ParticlePresetDefinition[] {
  return PRESETS.map((entry) => ({
    ...entry,
    props: cloneParticleSystemComponentProps(entry.props),
  }))
}

export function getParticlePresetDefinition(id: string | null | undefined): ParticlePresetDefinition | null {
  const normalized = typeof id === 'string' ? id.trim() : ''
  const found = normalized ? PRESET_MAP.get(normalized) ?? null : null
  if (!found) {
    return null
  }
  return {
    ...found,
    props: cloneParticleSystemComponentProps(found.props),
  }
}

export function createParticlePresetProps(id: string | null | undefined): ParticleSystemComponentProps {
  const found = getParticlePresetDefinition(id)
  return cloneParticleSystemComponentProps(found?.props ?? PRESETS[0]!.props)
}
