import { defineStore } from 'pinia'

type LoadingMode = 'indeterminate' | 'determinate'

export interface LoadingOverlayOptions {
  mode?: LoadingMode
  progress?: number
  title?: string
  message?: string
  closable?: boolean
  autoClose?: boolean
  autoCloseDelay?: number
}

interface LoadingOverlayState {
  visible: boolean
  mode: LoadingMode
  progress: number
  title: string
  message: string
  closable: boolean
  autoClose: boolean
  autoCloseDelay: number
}

interface UiState {
  loadingOverlay: LoadingOverlayState
  autoCloseTimer: number | null
}

const defaultOverlayState: LoadingOverlayState = {
  visible: false,
  mode: 'indeterminate',
  progress: 0,
  title: '正在加载',
  message: '请稍候…',
  closable: false,
  autoClose: true,
  autoCloseDelay: 600,
}

export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    loadingOverlay: { ...defaultOverlayState },
    autoCloseTimer: null,
  }),
  actions: {
    showLoadingOverlay(options: LoadingOverlayOptions = {}) {
      this.clearAutoCloseTimer()
      const progress = options.mode === 'determinate' ? options.progress ?? 0 : 0
      this.loadingOverlay = {
        ...this.loadingOverlay,
        ...options,
        mode: options.mode ?? 'indeterminate',
        visible: true,
        progress: this.normalizeProgress(progress),
        title: options.title ?? defaultOverlayState.title,
        message: options.message ?? defaultOverlayState.message,
        closable: options.closable ?? defaultOverlayState.closable,
        autoClose: options.autoClose ?? defaultOverlayState.autoClose,
        autoCloseDelay: options.autoCloseDelay ?? defaultOverlayState.autoCloseDelay,
      }
    },
    updateLoadingOverlay(options: Partial<LoadingOverlayOptions>) {
      this.loadingOverlay = {
        ...this.loadingOverlay,
        ...options,
        mode: options.mode ?? this.loadingOverlay.mode,
        progress: this.loadingOverlay.mode === 'determinate'
          ? this.normalizeProgress(options.progress ?? this.loadingOverlay.progress)
          : this.loadingOverlay.progress,
        title: options.title ?? this.loadingOverlay.title,
        message: options.message ?? this.loadingOverlay.message,
        closable: options.closable ?? this.loadingOverlay.closable,
        autoClose: options.autoClose ?? this.loadingOverlay.autoClose,
        autoCloseDelay: options.autoCloseDelay ?? this.loadingOverlay.autoCloseDelay,
      }

      if (this.loadingOverlay.mode === 'determinate') {
        this.handleAutoClose()
      }
    },
    updateLoadingProgress(progress: number, options: { autoClose?: boolean; autoCloseDelay?: number } = {}) {
      this.loadingOverlay.mode = 'determinate'
      this.loadingOverlay.progress = this.normalizeProgress(progress)
      if (typeof options.autoClose === 'boolean') {
        this.loadingOverlay.autoClose = options.autoClose
      }
      if (typeof options.autoCloseDelay === 'number') {
        this.loadingOverlay.autoCloseDelay = options.autoCloseDelay
      }
      this.handleAutoClose()
    },
    startIndeterminateLoading(options: Omit<LoadingOverlayOptions, 'mode' | 'progress'> = {}) {
      this.showLoadingOverlay({ ...options, mode: 'indeterminate', progress: 0 })
    },
    hideLoadingOverlay(immediate = false) {
      this.clearAutoCloseTimer()
      if (immediate) {
        this.loadingOverlay = { ...defaultOverlayState }
        return
      }
      this.loadingOverlay = {
        ...defaultOverlayState,
        title: this.loadingOverlay.title,
        message: this.loadingOverlay.message,
      }
    },
    requestClose() {
      if (!this.loadingOverlay.closable) return
      this.hideLoadingOverlay(true)
    },
    handleAutoClose() {
      if (!this.loadingOverlay.autoClose) {
        this.clearAutoCloseTimer()
        return
      }

      if (this.loadingOverlay.progress < 100) {
        this.clearAutoCloseTimer()
        return
      }

      this.scheduleAutoClose(this.loadingOverlay.autoCloseDelay)
    },
    scheduleAutoClose(delay: number) {
      this.clearAutoCloseTimer()
      this.autoCloseTimer = window.setTimeout(() => {
        this.hideLoadingOverlay(true)
      }, Math.max(delay, 0))
    },
    clearAutoCloseTimer() {
      if (this.autoCloseTimer !== null) {
        window.clearTimeout(this.autoCloseTimer)
        this.autoCloseTimer = null
      }
    },
    normalizeProgress(value: number) {
      if (!Number.isFinite(value)) return 0
      return Math.min(Math.max(Math.round(value), 0), 100)
    },
  },
})
