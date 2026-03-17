import { defineStore } from 'pinia'

type LoadingMode = 'indeterminate' | 'determinate'

export interface LoadingOverlayDetailItem {
  label: string
  description: string
}

export interface LoadingOverlayOptions {
  mode?: LoadingMode
  progress?: number
  title?: string
  message?: string
  closable?: boolean
  cancelable?: boolean
  cancelText?: string
  autoClose?: boolean
  autoCloseDelay?: number
  interactionLock?: string | null
  detailsTitle?: string
  details?: LoadingOverlayDetailItem[]
  detailsExpanded?: boolean
}

interface LoadingOverlayState {
  visible: boolean
  mode: LoadingMode
  progress: number
  title: string
  message: string
  closable: boolean
  cancelable: boolean
  cancelText: string
  autoClose: boolean
  autoCloseDelay: number
  interactionLock: string | null
  detailsTitle: string
  details: LoadingOverlayDetailItem[]
  detailsExpanded: boolean
}

interface UiState {
  loadingOverlay: LoadingOverlayState
  autoCloseTimer: number | null
}

type ActiveSelectionContext = string | null


const defaultOverlayState: LoadingOverlayState = {
  visible: false,
  mode: 'indeterminate',
  progress: 0,
  title: '加载中…',
  message: '请稍候…',
  closable: false,
  cancelable: false,
  cancelText: '取消',
  autoClose: true,
  autoCloseDelay: 600,
  interactionLock: null,
  detailsTitle: '详情',
  details: [],
  detailsExpanded: false,
}

let loadingOverlayCancelHandler: (() => void) | null = null

export const useUiStore = defineStore('ui', {
  state: (): UiState & { activeSelectionContext: ActiveSelectionContext } => ({
    loadingOverlay: { ...defaultOverlayState },
    autoCloseTimer: null,
    activeSelectionContext: null,
  }),
  actions: {
    // Active selection context is a lightweight UI-level signal indicating which
    // module currently holds the user's "selection/activation" intent. Examples:
    // 'asset-panel', 'scatter', 'terrain-sculpt', 'build-tool:wall', etc.
    setActiveSelectionContext(context: ActiveSelectionContext) {
      if (this.activeSelectionContext === context) return
      // simply set the context; other stores/components should watch this
      // value and clear their own selections when appropriate to avoid
      // circular imports here.
      ;(this as any).activeSelectionContext = context
    },
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
        cancelable: options.cancelable ?? defaultOverlayState.cancelable,
        cancelText: options.cancelText ?? defaultOverlayState.cancelText,
        autoClose: options.autoClose ?? defaultOverlayState.autoClose,
        autoCloseDelay: options.autoCloseDelay ?? defaultOverlayState.autoCloseDelay,
        interactionLock: options.interactionLock ?? defaultOverlayState.interactionLock,
        detailsTitle: options.detailsTitle ?? defaultOverlayState.detailsTitle,
        details: Array.isArray(options.details) ? [...options.details] : defaultOverlayState.details,
        detailsExpanded: options.detailsExpanded ?? defaultOverlayState.detailsExpanded,
      }
    },
    updateLoadingOverlay(options: Partial<LoadingOverlayOptions>) {
      // Update mode if provided, otherwise keep current
      if (options.mode !== undefined) {
        this.loadingOverlay.mode = options.mode
      }
      
      // Update progress only if mode is determinate, and handle normalization
      if (this.loadingOverlay.mode === 'determinate' && options.progress !== undefined) {
        this.loadingOverlay.progress = this.normalizeProgress(options.progress)
      }
      
      // Update title if provided
      if (options.title !== undefined) {
        this.loadingOverlay.title = options.title
      }
      
      // Update message if provided
      if (options.message !== undefined) {
        this.loadingOverlay.message = options.message
      }
      
      // Update closable if provided
      if (options.closable !== undefined) {
        this.loadingOverlay.closable = options.closable
      }
      
      // Update cancelable if provided
      if (options.cancelable !== undefined) {
        this.loadingOverlay.cancelable = options.cancelable
      }
      
      // Update cancelText if provided
      if (options.cancelText !== undefined) {
        this.loadingOverlay.cancelText = options.cancelText
      }
      
      // Update autoClose if provided
      if (options.autoClose !== undefined) {
        this.loadingOverlay.autoClose = options.autoClose
      }
      
      // Update autoCloseDelay if provided
      if (options.autoCloseDelay !== undefined) {
        this.loadingOverlay.autoCloseDelay = options.autoCloseDelay
      }
      
      // Update interactionLock if provided
      if (options.interactionLock !== undefined) {
        this.loadingOverlay.interactionLock = options.interactionLock
      }
      
      // Update detailsTitle if provided
      if (options.detailsTitle !== undefined) {
        this.loadingOverlay.detailsTitle = options.detailsTitle
      }
      
      // Update details if provided (create new array to trigger reactivity)
      if (Array.isArray(options.details)) {
        this.loadingOverlay.details = [...options.details]
      }
      
      // Update detailsExpanded if provided
      if (options.detailsExpanded !== undefined) {
        this.loadingOverlay.detailsExpanded = options.detailsExpanded
      }

      if (this.loadingOverlay.mode === 'determinate') {
        this.handleAutoClose()
      }
    },
    updateLoadingProgress(progress: number, options: { autoClose?: boolean; autoCloseDelay?: number } = {}) {
      this.loadingOverlay.mode = 'determinate'
      const normalizedProgress = this.normalizeProgress(progress)
      // Only update if value actually changed to prevent unnecessary updates
      if (this.loadingOverlay.progress !== normalizedProgress) {
        this.loadingOverlay.progress = normalizedProgress
      }
      if (typeof options.autoClose === 'boolean' && this.loadingOverlay.autoClose !== options.autoClose) {
        this.loadingOverlay.autoClose = options.autoClose
      }
      if (typeof options.autoCloseDelay === 'number' && this.loadingOverlay.autoCloseDelay !== options.autoCloseDelay) {
        this.loadingOverlay.autoCloseDelay = options.autoCloseDelay
      }
      this.handleAutoClose()
    },
    startIndeterminateLoading(options: Omit<LoadingOverlayOptions, 'mode' | 'progress'> = {}) {
      this.showLoadingOverlay({ ...options, mode: 'indeterminate', progress: 0 })
    },
    hideLoadingOverlay(immediate = false) {
      this.clearAutoCloseTimer()
      loadingOverlayCancelHandler = null
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
    isInteractionLocked(lock?: string | null) {
      if (!this.loadingOverlay.visible) {
        return false
      }
      if (!this.loadingOverlay.interactionLock) {
        return false
      }
      if (!lock) {
        return true
      }
      return this.loadingOverlay.interactionLock === lock
    },
    requestClose() {
      if (!this.loadingOverlay.closable) return
      this.hideLoadingOverlay(true)
    },

    setLoadingOverlayCancelHandler(handler: (() => void) | null) {
      loadingOverlayCancelHandler = handler
    },

    requestCancelLoadingOverlay() {
      if (!this.loadingOverlay.cancelable) return

      // Idempotent: disable cancel immediately and clear handler to avoid races.
      this.loadingOverlay.cancelable = false
      if (this.loadingOverlay.visible) {
        this.loadingOverlay.closable = false
        this.loadingOverlay.autoClose = false
        this.loadingOverlay.message = '正在取消…'
      }

      const handler = loadingOverlayCancelHandler
      loadingOverlayCancelHandler = null
      try {
        handler?.()
      } catch {
        // noop
      }
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

