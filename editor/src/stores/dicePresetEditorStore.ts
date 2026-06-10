import { defineStore } from 'pinia'

export type DicePresetEditorMode = 'create' | 'edit'

export const useDicePresetEditorStore = defineStore('dicePresetEditor', {
  state: () => ({
    isOpen: false,
    mode: 'create' as DicePresetEditorMode,
    assetId: null as string | null,
  }),
  actions: {
    openCreate(): void {
      this.mode = 'create'
      this.assetId = null
      this.isOpen = true
    },
    openEdit(assetId: string): void {
      const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : ''
      if (!normalizedAssetId.length) {
        return
      }
      this.mode = 'edit'
      this.assetId = normalizedAssetId
      this.isOpen = true
    },
    close(): void {
      this.isOpen = false
    },
  },
})