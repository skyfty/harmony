import { reactive } from 'vue'
import type { RuntimeMemoryGuardState } from '@harmony/schema/core'
import { resolveRuntimeMemoryGuardStateForWarning } from '@harmony/schema/core'

type MemoryWarningEvent = {
  level?: number
}

type WxLike = {
  onMemoryWarning?: (listener: (event: MemoryWarningEvent) => void) => void
  offMemoryWarning?: (listener: (event: MemoryWarningEvent) => void) => void
  getDeviceInfo?: () => {
    platform?: string
    model?: string
    system?: string
    memorySize?: string | number
    benchmarkLevel?: number
  }
  getDeviceBenchmarkInfo?: (options: {
    success?: (result: { benchmarkLevel?: number; modelLevel?: number }) => void
    fail?: () => void
  }) => void
  getRealtimeLogManager?: () => {
    warn: (...args: unknown[]) => void
    info: (...args: unknown[]) => void
  }
}

type UniLike = {
  getSystemInfoSync?: () => {
    platform?: string
    model?: string
    system?: string
    benchmarkLevel?: number
    memorySize?: string | number
  }
}

export interface RuntimeMemoryGuardOptions {
  onModerate?: () => void
  onCritical?: () => void
  onExtremeCritical?: () => void
  onRestoreModerate?: () => void
}

export interface RuntimeMemoryGuardStateRecord {
  enabled: boolean
  platform: string
  state: RuntimeMemoryGuardState
  extreme: boolean
  lastWarningAt: number
  warningCount: number
}

function getGlobalWx(): WxLike | null {
  const globalApp = globalThis as typeof globalThis & { wx?: WxLike }
  return globalApp.wx ?? null
}

function getGlobalUni(): UniLike | null {
  const globalApp = globalThis as typeof globalThis & { uni?: UniLike }
  return globalApp.uni ?? null
}

function resolvePlatform(wxLike: WxLike | null, uniLike: UniLike | null): string {
  const wxInfo = wxLike?.getDeviceInfo?.()
  if (typeof wxInfo?.platform === 'string') {
    return wxInfo.platform.toLowerCase()
  }
  const uniInfo = uniLike?.getSystemInfoSync?.()
  if (typeof uniInfo?.platform === 'string') {
    return uniInfo.platform.toLowerCase()
  }
  return ''
}

function logMemoryWarning(wxLike: WxLike | null, payload: Record<string, unknown>): void {
  const logger = wxLike?.getRealtimeLogManager?.()
  if (!logger) {
    return
  }
  try {
    logger.warn('[runtime-memory-guard]', payload)
  } catch {
    // best-effort telemetry
  }
}

export function useRuntimeMemoryGuard(options: RuntimeMemoryGuardOptions = {}) {
  const state = reactive<RuntimeMemoryGuardStateRecord>({
    enabled: false,
    platform: '',
    state: 'normal',
    extreme: false,
    lastWarningAt: 0,
    warningCount: 0,
  })

  let warningListener: ((event: MemoryWarningEvent) => void) | null = null
  let restoreTimer: ReturnType<typeof setTimeout> | null = null

  const applyState = (nextState: RuntimeMemoryGuardState, extreme: boolean): void => {
    if (state.state === nextState && state.extreme === extreme) {
      return
    }
    state.state = nextState
    state.extreme = extreme
    if (extreme) {
      options.onExtremeCritical?.()
      return
    }
    if (nextState === 'critical') {
      options.onCritical?.()
    } else if (nextState === 'moderate') {
      options.onModerate?.()
    }
  }

  const scheduleRestore = (): void => {
    if (restoreTimer) {
      clearTimeout(restoreTimer)
    }
    restoreTimer = setTimeout(() => {
      if (state.state === 'critical') {
        applyState('moderate', false)
        options.onRestoreModerate?.()
      }
      restoreTimer = null
    }, 30_000)
  }

  const handleWarning = (event: MemoryWarningEvent): void => {
    const now = Date.now()
    state.lastWarningAt = now
    state.warningCount += 1
    const extreme = state.platform === 'android' && typeof event.level === 'number' && event.level >= 15
    const nextState = resolveRuntimeMemoryGuardStateForWarning({
      platform: state.platform,
      level: event.level ?? null,
      previousState: state.state,
      warningCount: state.warningCount,
      now,
      lastWarningAt: state.state === 'normal' ? now : state.lastWarningAt,
    })
    applyState(nextState, extreme)
    logMemoryWarning(getGlobalWx(), {
      platform: state.platform,
      level: event.level ?? null,
      nextState,
      extreme,
      warningCount: state.warningCount,
    })
    if (nextState !== 'normal') {
      scheduleRestore()
    }
  }

  const start = (): void => {
    const wxLike = getGlobalWx()
    const uniLike = getGlobalUni()
    if (!wxLike || typeof wxLike.onMemoryWarning !== 'function') {
      state.enabled = false
      return
    }
    state.enabled = true
    state.platform = resolvePlatform(wxLike, uniLike)
    warningListener = (event) => handleWarning(event)
    wxLike.onMemoryWarning(warningListener)
  }

  const stop = (): void => {
    const wxLike = getGlobalWx()
    if (warningListener && wxLike && typeof wxLike.offMemoryWarning === 'function') {
      wxLike.offMemoryWarning(warningListener)
    }
    warningListener = null
    if (restoreTimer) {
      clearTimeout(restoreTimer)
      restoreTimer = null
    }
    state.enabled = false
    state.state = 'normal'
    state.extreme = false
    state.lastWarningAt = 0
    state.warningCount = 0
  }

  return {
    state,
    start,
    stop,
    handleWarning,
  }
}
