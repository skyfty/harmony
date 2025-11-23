import type { Object3D } from 'three'

export type EffectTypeId = 'groundLight'

export interface GroundLightEffectProps {
  color: string
  intensity: number
  scale: number
  particleSize: number
  particleCount: number
  showParticles: boolean
  showBeams: boolean
  showRings: boolean
}

export interface EffectComponentProps {
  effectType: EffectTypeId
  groundLight: GroundLightEffectProps
}

export interface EffectController {
  readonly group: Object3D
  update(props: EffectComponentProps): void
  tick(delta: number): void
  dispose(): void
}
