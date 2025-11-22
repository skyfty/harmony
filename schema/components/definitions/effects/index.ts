import { createGroundLightEffectController } from './groundLight'
import type { EffectComponentProps, EffectController, EffectTypeId } from './types'

export type EffectControllerFactory = (props: EffectComponentProps) => EffectController | null

export const effectControllerFactories: Partial<Record<EffectTypeId, EffectControllerFactory>> = {
  groundLight: (props) => createGroundLightEffectController(props.groundLight),
}
