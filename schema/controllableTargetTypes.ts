export const CONTROLLABLE_TARGET_TYPES = ['vehicle', 'character', 'ship', 'aircraft'] as const

export type ControllableTargetType = (typeof CONTROLLABLE_TARGET_TYPES)[number]

export type SteerControllableTargetType = ControllableTargetType
