export type AlignMode = 'axis-x' | 'axis-y' | 'axis-z'

export const ALIGN_MODE_AXIS = {
  'axis-x': 'x',
  'axis-y': 'y',
  'axis-z': 'z',
} as const satisfies Record<AlignMode, 'x' | 'y' | 'z'>
