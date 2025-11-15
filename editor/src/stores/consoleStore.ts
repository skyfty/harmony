import { defineStore } from 'pinia'
import { ref, type Ref } from 'vue'

export type ConsoleLogLevel = 'info' | 'warn' | 'error'

export interface ConsoleLogEntry {
  id: number
  level: ConsoleLogLevel
  timestamp: number
  message: string
}

const MAX_LOG_ENTRIES = 500
let nextEntryId = 0
const restoreConsoleFns: Array<() => void> = []
let isCapturing = false

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`
  }
  try {
    return JSON.stringify(arg)
  } catch (error) {
    return String(arg)
  }
}

function pushEntry(entries: Ref<ConsoleLogEntry[]>, level: ConsoleLogLevel, payload: unknown[]): void {
  const message = payload.map(formatArg).join(' ')
  const record: ConsoleLogEntry = {
    id: ++nextEntryId,
    level,
    timestamp: Date.now(),
    message,
  }
  entries.value = [...entries.value.slice(-MAX_LOG_ENTRIES + 1), record]
}

export const useConsoleStore = defineStore('console', () => {
  const entries = ref<ConsoleLogEntry[]>([])

  function clear(): void {
    entries.value = []
  }

  function startCapture(): void {
    if (isCapturing || typeof window === 'undefined') {
      return
    }
    const target = window.console
    const consoleMap = target as unknown as Record<string, (...values: unknown[]) => unknown>
    const patchers: Array<{ method: keyof Console; level: ConsoleLogLevel }> = [
      { method: 'debug', level: 'info' },
      { method: 'log', level: 'info' },
      { method: 'info', level: 'info' },
      { method: 'warn', level: 'warn' },
      { method: 'error', level: 'error' },
    ]

    patchers.forEach(({ method, level }) => {
      const methodName = method as string
      const original = consoleMap[methodName]
      if (typeof original !== 'function') {
        return
      }
      const patched = (...args: unknown[]) => {
        pushEntry(entries, level, args)
        return original.apply(target, args)
      }
      consoleMap[methodName] = patched
      restoreConsoleFns.push(() => {
        consoleMap[methodName] = original
      })
    })

    const originalClear = consoleMap.clear
    if (typeof originalClear === 'function') {
      const patchedClear = (...args: unknown[]) => {
        clear()
        return originalClear.apply(target, args)
      }
      consoleMap.clear = patchedClear
      restoreConsoleFns.push(() => {
        consoleMap.clear = originalClear
      })
    }

    isCapturing = true
  }

  function stopCapture(): void {
    if (!isCapturing) {
      return
    }
    restoreConsoleFns.splice(0).forEach((restore) => restore())
    isCapturing = false
  }

  return {
    entries,
    clear,
    startCapture,
    stopCapture,
  }
})
