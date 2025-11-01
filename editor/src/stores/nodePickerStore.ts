import { defineStore } from 'pinia'

export type NodePickerOwner = 'behavior-target'

type NodePickerHandlers = {
  onPick: (nodeId: string) => void
  onCancel?: () => void
}

type CancelReason = 'user' | 'replaced'

let nextRequestId = 1
const handlerRegistry = new Map<number, NodePickerHandlers>()

function applyBodyCursor(active: boolean) {
  if (typeof document === 'undefined') {
    return
  }
  document.body.classList.toggle('is-node-picking', active)
}

export const useNodePickerStore = defineStore('nodePicker', {
  state: () => ({
    activeRequestId: null as number | null,
    owner: null as NodePickerOwner | null,
    hint: '' as string,
    cursor: 'crosshair' as string,
  }),
  getters: {
    isActive: (state) => state.activeRequestId !== null,
  },
  actions: {
    beginPick(options: { owner: NodePickerOwner; hint?: string; cursor?: string; handlers: NodePickerHandlers }): number {
      if (this.activeRequestId) {
        this.cancelActivePick('replaced')
      }
      const requestId = nextRequestId++
      this.activeRequestId = requestId
      this.owner = options.owner
      this.hint = options.hint ?? ''
      this.cursor = options.cursor ?? 'crosshair'
      handlerRegistry.set(requestId, options.handlers)
      applyBodyCursor(true)
      return requestId
    },
    completePick(nodeId: string) {
      const requestId = this.activeRequestId
      if (!requestId) {
        return
      }
      const handlers = handlerRegistry.get(requestId)
      handlerRegistry.delete(requestId)
      this.reset()
      handlers?.onPick(nodeId)
    },
    cancelActivePick(reason: CancelReason = 'user') {
      const requestId = this.activeRequestId
      if (!requestId) {
        return
      }
      const handlers = handlerRegistry.get(requestId)
      handlerRegistry.delete(requestId)
      this.reset()
      if (reason !== 'replaced') {
        handlers?.onCancel?.()
      }
    },
    reset() {
      this.activeRequestId = null
      this.owner = null
      this.hint = ''
      this.cursor = 'crosshair'
      applyBodyCursor(false)
    },
  },
})
