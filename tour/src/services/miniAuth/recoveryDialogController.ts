import type {
  MiniAuthRecoveryDialogState,
  MiniAuthRecoveryOptions,
  MiniAuthRecoveryResult,
} from './types'

type RecoveryDialogListener = (state: MiniAuthRecoveryDialogState) => void
const MINI_AUTH_DIALOG_LOG_PREFIX = '[mini-auth-dialog]'

function logMiniAuthDialog(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${MINI_AUTH_DIALOG_LOG_PREFIX} ${message}`)
    return
  }
  console.info(`${MINI_AUTH_DIALOG_LOG_PREFIX} ${message}`, details)
}

function createDefaultState(): MiniAuthRecoveryDialogState {
  return {
    visible: false,
    options: {},
    activeHostId: null,
  }
}

class MiniAuthRecoveryDialogController {
  private state: MiniAuthRecoveryDialogState = createDefaultState()
  private listeners = new Set<RecoveryDialogListener>()
  private resolver: ((result: MiniAuthRecoveryResult) => void) | null = null
  private hostIds = new Set<number>()
  private nextHostId = 1

  registerHost(): number {
    const hostId = this.nextHostId++
    this.hostIds.add(hostId)
    if (this.state.activeHostId === null) {
      this.state = {
        ...this.state,
        activeHostId: hostId,
      }
      this.emit()
    }
    logMiniAuthDialog('host registered', {
      hostId,
      activeHostId: this.state.activeHostId,
      hostCount: this.hostIds.size,
    })
    return hostId
  }

  unregisterHost(hostId: number): void {
    if (!this.hostIds.delete(hostId)) {
      return
    }

    if (this.state.activeHostId === hostId) {
      const nextActiveHostId = this.hostIds.values().next().value ?? null
      this.state = {
        ...this.state,
        activeHostId: nextActiveHostId,
      }
      this.emit()
    }

    logMiniAuthDialog('host unregistered', {
      hostId,
      activeHostId: this.state.activeHostId,
      hostCount: this.hostIds.size,
    })
  }

  subscribe(listener: RecoveryDialogListener): () => void {
    this.listeners.add(listener)
    logMiniAuthDialog('listener subscribed', { listenerCount: this.listeners.size })
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
      logMiniAuthDialog('listener unsubscribed', { listenerCount: this.listeners.size })
    }
  }

  getSnapshot(): MiniAuthRecoveryDialogState {
    return this.state
  }

  async open(options: MiniAuthRecoveryOptions = {}): Promise<MiniAuthRecoveryResult> {
    logMiniAuthDialog('open requested', {
      title: options.title || '(empty)',
      hasPendingResolver: Boolean(this.resolver),
      listenerCount: this.listeners.size,
    })
    if (this.resolver) {
      this.resolve({ action: 'skip' })
    }

    this.state = {
      visible: true,
      options: { ...options },
      activeHostId: this.state.activeHostId,
    }
    this.emit()

    return await new Promise<MiniAuthRecoveryResult>((resolve) => {
      this.resolver = resolve
      logMiniAuthDialog('resolver registered')
    })
  }

  resolve(result: MiniAuthRecoveryResult): void {
    logMiniAuthDialog('resolve called', { action: result.action, listenerCount: this.listeners.size })
    const activeResolver = this.resolver
    this.resolver = null
    this.state = {
      visible: false,
      options: {},
      activeHostId: this.state.activeHostId,
    }
    this.emit()
    if (activeResolver) {
      activeResolver(result)
    }
  }

  dismiss(): void {
    this.resolve({ action: 'skip' })
  }

  private emit(): void {
    logMiniAuthDialog('emit state', {
      visible: this.state.visible,
      title: this.state.options.title || '(empty)',
      listenerCount: this.listeners.size,
      activeHostId: this.state.activeHostId,
    })
    this.listeners.forEach((listener) => {
      listener(this.state)
    })
  }
}

export const miniAuthRecoveryDialogController = new MiniAuthRecoveryDialogController()