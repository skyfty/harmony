import type { ParticleBudgetProps, ParticleEmitterConfig, ParticleQualityTier } from './particleSchema'
import {
  PARTICLE_COMPONENT_MAX_BURST,
  PARTICLE_COMPONENT_MAX_PARTICLES,
  PARTICLE_COMPONENT_MAX_SCENE_ACTIVE,
  PARTICLE_SCENE_SOFT_PARTICLE_LIMIT,
} from './particleSchema'

export interface ParticleBudgetRuntimeStats {
  activeSystems: number
  totalEstimatedParticles: number
  lowFpsMode: boolean
  isMiniProgram: boolean
}

export interface ParticleBudgetDecision {
  enabled: boolean
  updateIntervalSeconds: number
  spawnRateScale: number
  maxParticles: number
  clampedBurst: number
  effectiveQualityTier: ParticleQualityTier
}

export function applyEmitterBudget(
  emitter: ParticleEmitterConfig,
  budget: ParticleBudgetProps,
): ParticleEmitterConfig {
  const maxParticles = Math.min(PARTICLE_COMPONENT_MAX_PARTICLES, budget.maxParticles)
  return {
    ...emitter,
    maxParticles: Math.min(emitter.maxParticles, maxParticles),
    emissionBursts: Math.min(emitter.emissionBursts, PARTICLE_COMPONENT_MAX_BURST),
    emissionRate: emitter.emissionRate * budget.spawnRateScale,
  }
}

export function resolveParticleBudgetDecision(args: {
  budget: ParticleBudgetProps
  distanceToCamera: number | null
  visible: boolean
  runtimeStats: ParticleBudgetRuntimeStats
}): ParticleBudgetDecision {
  const { budget, distanceToCamera, visible, runtimeStats } = args
  const sceneOverloaded = runtimeStats.activeSystems > PARTICLE_COMPONENT_MAX_SCENE_ACTIVE
    || runtimeStats.totalEstimatedParticles > PARTICLE_SCENE_SOFT_PARTICLE_LIMIT
  const culledByDistance = distanceToCamera !== null && distanceToCamera > budget.cullDistance
  const enabled = visible && !culledByDistance
  let effectiveQualityTier: ParticleQualityTier = budget.qualityTier
  if (runtimeStats.isMiniProgram && effectiveQualityTier === 'desktop-rich') {
    effectiveQualityTier = 'balanced'
  }
  if (runtimeStats.lowFpsMode && effectiveQualityTier !== 'mini-safe') {
    effectiveQualityTier = 'mini-safe'
  }
  const intervalHz = runtimeStats.isMiniProgram
    ? Math.min(budget.updateHz, effectiveQualityTier === 'mini-safe' ? 24 : 30)
    : budget.updateHz
  const baseScale = runtimeStats.isMiniProgram && effectiveQualityTier === 'mini-safe' ? Math.min(0.85, budget.spawnRateScale) : budget.spawnRateScale
  const overloadScale = sceneOverloaded ? Math.min(baseScale, 0.6) : baseScale
  return {
    enabled,
    updateIntervalSeconds: 1 / Math.max(1, intervalHz),
    spawnRateScale: enabled ? overloadScale : 0,
    maxParticles: Math.min(
      PARTICLE_COMPONENT_MAX_PARTICLES,
      Math.max(1, Math.round(budget.maxParticles * (sceneOverloaded ? 0.75 : 1))),
    ),
    clampedBurst: Math.max(0, Math.min(PARTICLE_COMPONENT_MAX_BURST, Math.round((sceneOverloaded ? 0.75 : 1) * PARTICLE_COMPONENT_MAX_BURST))),
    effectiveQualityTier,
  }
}
