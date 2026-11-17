import type { PunchCelebrationEffectId } from '../core'

export type PunchCelebrationPlayableEffectId = Exclude<PunchCelebrationEffectId, 'none'>

export interface PunchCelebrationEffectDefinition {
  id: PunchCelebrationPlayableEffectId
  label: string
  particlePresetId: string
}

export const DEFAULT_PUNCH_CELEBRATION_EFFECT_ID: PunchCelebrationPlayableEffectId = 'confettiBurst'

const PUNCH_CELEBRATION_EFFECTS: readonly PunchCelebrationEffectDefinition[] = [
  {
    id: 'confettiBurst',
    label: '彩纸爆炸',
    particlePresetId: 'celebrationConfettiLite',
  },
]

export function listPunchCelebrationEffects(): PunchCelebrationEffectDefinition[] {
  return PUNCH_CELEBRATION_EFFECTS.map((entry) => ({ ...entry }))
}

export function getPunchCelebrationEffect(
  id: PunchCelebrationEffectId | string | null | undefined,
): PunchCelebrationEffectDefinition | null {
  if (id === 'none') {
    return null
  }
  return PUNCH_CELEBRATION_EFFECTS.find((entry) => entry.id === id) ?? null
}

export function normalizePunchCelebrationEffectId(value: unknown): PunchCelebrationEffectId {
  return value === 'none' ? 'none' : DEFAULT_PUNCH_CELEBRATION_EFFECT_ID
}

export function listPunchCelebrationOptions(): Array<{
  title: string
  value: PunchCelebrationEffectId
}> {
  return [
    {
      title: '不播放动画',
      value: 'none',
    },
    ...PUNCH_CELEBRATION_EFFECTS.map((entry) => ({
      title: entry.label,
      value: entry.id,
    })),
  ]
}

export function shouldPlayPunchCelebration(
  effectId: PunchCelebrationEffectId | string | null | undefined,
  onlyFirst: boolean,
  alreadyPunched: boolean,
): boolean {
  if (!getPunchCelebrationEffect(effectId)) {
    return false
  }
  return !onlyFirst || !alreadyPunched
}
