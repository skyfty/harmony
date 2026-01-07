import { defineStore } from 'pinia'
import type { SceneClipboard } from '@harmony/schema'

async function writeSystemClipboard(serialized: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    return
  }
  try {
    await navigator.clipboard.writeText(serialized)
  } catch (error) {
    console.warn('Failed to write prefab data to clipboard', error)
  }
}

async function readSystemClipboardText(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
    return null
  }
  try {
    const text = await navigator.clipboard.readText()
    const normalized = text?.trim()
    return normalized && normalized.length ? normalized : null
  } catch (error) {
    console.warn('Failed to read prefab data from clipboard', error)
    return null
  }
}

export const useClipboardStore = defineStore('clipboard', {
  state: () => ({
    clipboard: null as SceneClipboard | null,
  }),
  actions: {
    setClipboard(payload: SceneClipboard | null) {
      this.clipboard = payload
    },
    clearClipboard() {
      this.clipboard = null
    },
    async writeSystem(serialized: string) {
      await writeSystemClipboard(serialized)
    },
    async readSystemText(): Promise<string | null> {
      return await readSystemClipboardText()
    },
  },
})

export default useClipboardStore
