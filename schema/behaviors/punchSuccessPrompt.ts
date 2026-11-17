export const DEFAULT_PUNCH_SUCCESS_PROMPT_ENABLED = true
export const DEFAULT_PUNCH_SUCCESS_PROMPT_DURATION_SECONDS = 2.5
export const DEFAULT_PUNCH_SUCCESS_PROMPT_EYEBROW = '完成'
export const DEFAULT_PUNCH_SUCCESS_PROMPT_STATUS = '打卡成功'
export const DEFAULT_PUNCH_SUCCESS_PROMPT_FALLBACK_TITLE = '本次打卡'

export interface PunchSuccessPromptContent {
  eyebrow: string
  title: string
  status: string
  message: string
}

export function normalizePunchSuccessPromptDuration(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PUNCH_SUCCESS_PROMPT_DURATION_SECONDS
  }
  return Math.max(0, numeric)
}

export function formatPunchSuccessPromptText(displayName: string | null | undefined): string {
  const name = typeof displayName === 'string' ? displayName.trim() : ''
  return name ? `${name}打卡成功` : '打卡成功'
}

export function resolvePunchSuccessPromptContent(
  displayName: string | null | undefined,
): PunchSuccessPromptContent {
  const name = typeof displayName === 'string' ? displayName.trim() : ''
  return {
    eyebrow: DEFAULT_PUNCH_SUCCESS_PROMPT_EYEBROW,
    title: name || DEFAULT_PUNCH_SUCCESS_PROMPT_FALLBACK_TITLE,
    status: DEFAULT_PUNCH_SUCCESS_PROMPT_STATUS,
    message: formatPunchSuccessPromptText(name),
  }
}
