import { defineStore } from 'pinia'
import type { SceneClipboard } from '@harmony/schema'

const VIRTUAL_CLIPBOARD_STORAGE_KEY = 'harmony:virtualClipboardText'

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  } catch {
    return false
  }
}

function normalizeClipboardText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length ? normalized : null
}

function readVirtualClipboardFromStorage(): string | null {
  if (!canUseLocalStorage()) return null
  try {
    return normalizeClipboardText(window.localStorage.getItem(VIRTUAL_CLIPBOARD_STORAGE_KEY))
  } catch {
    return null
  }
}

function writeVirtualClipboardToStorage(value: string | null): void {
  if (!canUseLocalStorage()) return
  try {
    if (value) {
      window.localStorage.setItem(VIRTUAL_CLIPBOARD_STORAGE_KEY, value)
    } else {
      window.localStorage.removeItem(VIRTUAL_CLIPBOARD_STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

// Virtual clipboard (in-memory) to avoid browser clipboard permission issues.
let virtualClipboardText: string | null = readVirtualClipboardFromStorage()

export const useClipboardStore = defineStore('clipboard', {
  state: () => ({
    clipboard: null as SceneClipboard | null,
    clipboardText: readVirtualClipboardFromStorage() as string | null,
    persistClipboardText: false,
  }),
  actions: {
    setClipboard(payload: SceneClipboard | null) {
      this.clipboard = payload
    },
    clearClipboard() {
      this.clipboard = null
      this.clipboardText = null
      virtualClipboardText = null
      writeVirtualClipboardToStorage(null)
    },
    setPersistClipboardText(enabled: boolean) {
      this.persistClipboardText = Boolean(enabled)
      if (!this.persistClipboardText) {
        writeVirtualClipboardToStorage(null)
      } else {
        writeVirtualClipboardToStorage(virtualClipboardText ?? this.clipboardText)
      }
    },
    writeText(serialized: string | null) {
      const next = normalizeClipboardText(serialized)
      virtualClipboardText = next
      this.clipboardText = next
      if (this.persistClipboardText) writeVirtualClipboardToStorage(next)
    },
    readText(): string | null {
      return virtualClipboardText ?? this.clipboardText
    },

    // Backward-compatible aliases (no longer touch system clipboard).
    async writeSystem(serialized: string) {
      this.writeText(serialized)
    },
    async readSystemText(): Promise<string | null> {
      return this.readText()
    },
  },
})

export default useClipboardStore
