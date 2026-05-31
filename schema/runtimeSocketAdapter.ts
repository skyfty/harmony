export interface RuntimeSocketAdapter {
  readonly readyState: number
  send(data: string): void
  close(): void
  onOpen(listener: () => void): void
  onMessage(listener: (data: unknown) => void): void
  onClose(listener: () => void): void
  onError(listener: (event: unknown) => void): void
}

export const SOCKET_READY_STATE_CONNECTING = 0
export const SOCKET_READY_STATE_OPEN = 1
export const SOCKET_READY_STATE_CLOSING = 2
export const SOCKET_READY_STATE_CLOSED = 3

type MiniProgramSocketTaskLike = {
  onOpen?: (listener: () => void) => void
  onMessage?: (listener: (event: { data?: unknown }) => void) => void
  onClose?: (listener: () => void) => void
  onError?: (listener: (event: unknown) => void) => void
  send?: (options: { data: string; success?: () => void; fail?: (error: unknown) => void }) => void
  close?: (options?: { code?: number; reason?: string; success?: () => void; fail?: (error: unknown) => void }) => void
}

type MiniProgramSocketApiLike = {
  connectSocket?: (options: { url: string }) => MiniProgramSocketTaskLike | null | undefined
  onSocketOpen?: (listener: (event?: unknown) => void) => void
  onSocketMessage?: (listener: (event: { data?: unknown }) => void) => void
  onSocketClose?: (listener: (event?: unknown) => void) => void
  onSocketError?: (listener: (event: unknown) => void) => void
  sendSocketMessage?: (options: { data: string; success?: () => void; fail?: (error: unknown) => void }) => void
  closeSocket?: (options?: { code?: number; reason?: string; success?: () => void; fail?: (error: unknown) => void }) => void
  getSystemInfoSync?: () => unknown
  getDeviceInfo?: () => unknown
  getWindowInfo?: () => unknown
  getAppBaseInfo?: () => unknown
}

function normalizeSocketUrl(input: unknown): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    return trimmed.length ? trimmed : null
  }
  if (input instanceof URL) {
    const value = input.toString().trim()
    return value.length ? value : null
  }
  if (input && typeof input === 'object') {
    const record = input as { url?: unknown; href?: unknown; toString?: () => string }
    if (typeof record.url === 'string' && record.url.trim()) {
      return record.url.trim()
    }
    if (typeof record.href === 'string' && record.href.trim()) {
      return record.href.trim()
    }
    if (typeof record.toString === 'function') {
      const value = record.toString().trim()
      if (value && value !== '[object Object]') {
        return value
      }
    }
  }
  return null
}

function resolveMiniProgramSocketApi(): MiniProgramSocketApiLike | null {
  const globalRef = globalThis as typeof globalThis & { uni?: MiniProgramSocketApiLike; wx?: MiniProgramSocketApiLike }
  const candidates = [globalRef.uni, globalRef.wx]
  for (const candidate of candidates) {
    if (
      candidate
      && (
        typeof candidate.connectSocket === 'function'
        || typeof candidate.sendSocketMessage === 'function'
        || typeof candidate.onSocketOpen === 'function'
      )
    ) {
      return candidate
    }
  }
  return null
}

export function isWeChatMiniProgramRuntime(): boolean {
  const wxApi = resolveMiniProgramSocketApi()
  return Boolean(
    wxApi
    && (
      typeof wxApi.getSystemInfoSync === 'function'
      || typeof wxApi.getDeviceInfo === 'function'
      || typeof wxApi.getWindowInfo === 'function'
      || typeof wxApi.getAppBaseInfo === 'function'
    ),
  )
}

class BrowserWebSocketAdapter implements RuntimeSocketAdapter {
  private readonly socket: WebSocket

  constructor(url: string) {
    this.socket = new WebSocket(url)
  }

  get readyState(): number {
    return this.socket.readyState
  }

  send(data: string): void {
    this.socket.send(data)
  }

  close(): void {
    this.socket.close()
  }

  onOpen(listener: () => void): void {
    this.socket.addEventListener('open', listener)
  }

  onMessage(listener: (data: unknown) => void): void {
    this.socket.addEventListener('message', (event) => listener(event.data))
  }

  onClose(listener: () => void): void {
    this.socket.addEventListener('close', listener)
  }

  onError(listener: (event: unknown) => void): void {
    this.socket.addEventListener('error', (event) => listener(event))
  }
}

class WeChatMiniProgramSocketAdapter implements RuntimeSocketAdapter {
  private readonly task: MiniProgramSocketTaskLike | null
  private readonly wxApi: MiniProgramSocketApiLike
  private readyStateValue = SOCKET_READY_STATE_CONNECTING
  private readonly openListeners = new Set<() => void>()
  private readonly messageListeners = new Set<(data: unknown) => void>()
  private readonly closeListeners = new Set<() => void>()
  private readonly errorListeners = new Set<(event: unknown) => void>()

  constructor(url: string) {
    const wxApi = resolveMiniProgramSocketApi()
    if (!wxApi) {
      throw new Error('微信小程序 SocketTask 不可用')
    }
    const normalizedUrl = normalizeSocketUrl(url)
    if (!normalizedUrl) {
      throw new Error('微信小程序多人在线连接地址无效')
    }
    this.wxApi = wxApi
    const task = wxApi.connectSocket?.({ url: normalizedUrl }) ?? null
    console.log('微信小程序多人在线连接初始化', { url: normalizedUrl, task })
    this.task = task
    if (task && typeof task.onOpen === 'function') {
      task.onOpen(() => {
        console.log('微信小程序多人在线连接已打开')
        this.readyStateValue = SOCKET_READY_STATE_OPEN
        this.emitOpen()
      })
      task.onMessage?.((event) => {
        console.log('微信小程序多人在线连接收到消息', event?.data)
        this.emitMessage(event?.data)
      })
      task.onClose?.(() => {
        console.log('微信小程序多人在线连接已关闭')
        this.readyStateValue = SOCKET_READY_STATE_CLOSED
        this.emitClose()
      })
      task.onError?.((event) => {
        console.error('微信小程序多人在线连接发生错误', event)
        this.emitError(event)
      })
      return
    }
    wxApi.onSocketOpen?.(() => {
      this.readyStateValue = SOCKET_READY_STATE_OPEN
      this.emitOpen()
    })
    wxApi.onSocketMessage?.((event) => {
      this.emitMessage(event?.data)
    })
    wxApi.onSocketClose?.(() => {
      this.readyStateValue = SOCKET_READY_STATE_CLOSED
      this.emitClose()
    })
    wxApi.onSocketError?.((event) => {
      this.emitError(event)
    })
  }

  private emitOpen(): void {
    this.openListeners.forEach((listener) => listener())
  }

  private emitMessage(data: unknown): void {
    this.messageListeners.forEach((listener) => listener(data))
  }

  private emitClose(): void {
    this.closeListeners.forEach((listener) => listener())
  }

  private emitError(event: unknown): void {
    this.errorListeners.forEach((listener) => listener(event))
  }

  get readyState(): number {
    return this.readyStateValue
  }

  send(data: string): void {
    if (this.readyStateValue !== SOCKET_READY_STATE_OPEN) {
      throw new Error('SocketTask is not open')
    }
    if (this.task && typeof this.task.send === 'function') {
      this.task.send({ data })
      return
    }
    this.wxApi.sendSocketMessage?.({ data })
  }

  close(): void {
    this.readyStateValue = SOCKET_READY_STATE_CLOSING
    if (this.task && typeof this.task.close === 'function') {
      this.task.close()
      return
    }
    this.wxApi.closeSocket?.()
  }

  onOpen(listener: () => void): void {
    this.openListeners.add(listener)
  }

  onMessage(listener: (data: unknown) => void): void {
    this.messageListeners.add(listener)
  }

  onClose(listener: () => void): void {
    this.closeListeners.add(listener)
  }

  onError(listener: (event: unknown) => void): void {
    this.errorListeners.add(listener)
  }
}

export function createRuntimeSocketAdapter(url: string): RuntimeSocketAdapter | null {
  if (isWeChatMiniProgramRuntime()) {
    try {
      return new WeChatMiniProgramSocketAdapter(url)
    } catch (error) {
      console.warn('微信小程序多人在线连接初始化失败', error)
      return null
    }
  }
  if (typeof WebSocket !== 'undefined') {
    return new BrowserWebSocketAdapter(url)
  }
  return null
}
