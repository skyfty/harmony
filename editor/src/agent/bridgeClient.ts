import { onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import { componentManager } from '@schema/components'
import type {
  HarmonyAgentCapabilities,
  HarmonyAgentDomain,
  HarmonyAgentError,
  HarmonyCameraSetRequest,
  HarmonyEditorSessionHello,
  HarmonyHistoryRequest,
  HarmonyHistoryResult,
  HarmonySaveResult,
  HarmonySceneQuery,
  HarmonyScreenshotResult,
  HarmonyToolSetRequest,
} from '@schema/editorAgentProtocol'
import {
  HARMONY_AGENT_OPERATION_NAMES,
  HARMONY_AGENT_OPERATING_POLICY,
  HARMONY_AGENT_PROTOCOL_VERSION,
  HARMONY_AGENT_TOOLS,
  HARMONY_AGENT_MAX_ITEM_BYTES,
  HARMONY_AGENT_MAX_OPERATIONS,
} from '@schema/editorAgentProtocol'
import { useSceneStore } from '@/stores/sceneStore'
import { applySceneOperations } from '@/agent/operations'
import { AgentBridgeError, asAgentError } from '@/agent/errors'
import { queryScene, searchCatalog } from '@/agent/query'
import {
  getAgentCameraState,
  getAgentToolState,
  setAgentCameraState,
  setAgentTool,
} from '@/agent/viewportControl'

type AgentRequestPayload = {
  id: string
  method: string
  params?: Record<string, unknown>
}

type AgentServerMessage =
  | { type: 'request'; payload: AgentRequestPayload }
  | { type: 'paused'; payload?: { paused?: boolean } }

export type AgentBridgeConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected'

export type AgentBridgeAuditEntry = {
  id: string
  at: string
  method: string
  ok: boolean
  summary: string
}

type AgentBridgeState = {
  enabled: boolean
  status: AgentBridgeConnectionStatus
  paused: boolean
  sessionId: string | null
  lastError: string | null
  lastSeenAgent: string | null
  audit: AgentBridgeAuditEntry[]
}

const state = reactive<AgentBridgeState>({
  enabled: false,
  status: 'disabled',
  paused: false,
  sessionId: null,
  lastError: null,
  lastSeenAgent: null,
  audit: [],
})

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let started = false
let screenshotProvider: (() => Promise<Blob | null>) | null = null
let sessionId: string | null = null

function getBridgeUrl(): string {
  const configured = import.meta.env.VITE_EDITOR_AGENT_BRIDGE_URL as string | undefined
  if (configured?.trim()) {
    return configured.trim()
  }
  return 'ws://127.0.0.1:8790/editor'
}

function bridgeEnabled(): boolean {
  const configured = String(import.meta.env.VITE_EDITOR_AGENT_BRIDGE ?? '').trim().toLowerCase()
  if (['0', 'false', 'off', 'disabled'].includes(configured)) {
    return false
  }
  if (['1', 'true', 'on', 'enabled'].includes(configured)) {
    return true
  }
  return import.meta.env.DEV
}

function getSessionId(): string {
  sessionId ??= crypto.randomUUID()
  return sessionId
}

function buildCapabilities(): HarmonyAgentCapabilities {
  const domains: HarmonyAgentDomain[] = ['builder', 'behavior', 'guideRoute', 'terrain', 'actor']
  return {
    protocolVersion: HARMONY_AGENT_PROTOCOL_VERSION,
    operatingPolicy: HARMONY_AGENT_OPERATING_POLICY,
    operations: [...HARMONY_AGENT_OPERATION_NAMES],
    domains,
    tools: Object.values(HARMONY_AGENT_TOOLS),
    componentProfiles: componentManager.listAgentProfiles(),
    screenshots: Boolean(screenshotProvider),
    maxOperations: HARMONY_AGENT_MAX_OPERATIONS,
    maxRequestBytes: HARMONY_AGENT_MAX_ITEM_BYTES,
  }
}

function buildHello(store: ReturnType<typeof useSceneStore>): HarmonyEditorSessionHello {
  return {
    type: 'hello',
    protocolVersion: HARMONY_AGENT_PROTOCOL_VERSION,
    sessionId: getSessionId(),
    editorUrl: window.location.href,
    projectId: store.currentSceneMeta?.projectId ?? null,
    sceneId: store.currentSceneId,
    sceneName: store.currentSceneMeta?.name ?? null,
    sceneRevision: store.sceneRevision,
    sceneReady: store.isSceneReady,
    hasUnsavedChanges: store.hasUnsavedChanges,
    canUndo: store.undoStack.length > 0,
    canRedo: store.redoStack.length > 0,
    paused: state.paused,
    capabilities: buildCapabilities(),
  }
}

function send(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

function pushAudit(method: string, ok: boolean, summary: string): void {
  state.audit = [
    {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      method,
      ok,
      summary,
    },
    ...state.audit,
  ].slice(0, 30)
}

function encodeBlob(blob: Blob): Promise<{ base64: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new AgentBridgeError('INTERNAL_ERROR', 'Failed to read screenshot'))
    reader.onload = async () => {
      try {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result
        const bitmap = await createImageBitmap(blob)
        resolve({ base64, width: bitmap.width, height: bitmap.height })
        bitmap.close()
      } catch (error) {
        reject(error)
      }
    }
    reader.readAsDataURL(blob)
  })
}

async function waitForCondition(
  store: ReturnType<typeof useSceneStore>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const waitFor = typeof params.waitFor === 'string' ? params.waitFor : 'idle'
  const timeoutMs = Math.min(120_000, Math.max(100, Number(params.timeoutMs) || 30_000))
  const revision = typeof params.revision === 'number' ? params.revision : null
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const placeholdersPending = (() => {
      const stack = [...store.nodes]
      while (stack.length) {
        const node = stack.pop()
        if (!node) continue
        if (node.isPlaceholder || node.downloadStatus === 'downloading') return true
        if (node.children?.length) stack.push(...node.children)
      }
      return false
    })()
    const matches = (
      waitFor === 'ready'
        ? store.isSceneReady
        : waitFor === 'saved'
          ? !store.hasUnsavedChanges
          : waitFor === 'assets'
            ? !placeholdersPending
            : store.isSceneReady && !placeholdersPending
    ) && (revision === null || store.sceneRevision >= revision)
    if (matches) {
      return {
        matched: true,
        waitFor,
        sceneRevision: store.sceneRevision,
        sceneReady: store.isSceneReady,
        hasUnsavedChanges: store.hasUnsavedChanges,
        assetsPending: placeholdersPending,
        elapsedMs: Date.now() - startedAt,
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new AgentBridgeError(
    'TIMEOUT',
    `Timed out waiting for ${waitFor}`,
    { waitFor, revision, sceneRevision: store.sceneRevision },
  )
}

async function executeRequest(
  store: ReturnType<typeof useSceneStore>,
  request: AgentRequestPayload,
): Promise<unknown> {
  const params = request.params ?? {}
  switch (request.method) {
    case 'editor.status':
      return {
        connection: buildHello(store),
        capabilities: buildCapabilities(),
      }
    case 'editor.wait':
      return waitForCondition(store, params)
    case 'camera.get':
      return getAgentCameraState()
    case 'camera.set': {
      if (state.paused) {
        throw new AgentBridgeError('WRITE_LEASE_DENIED', 'Agent writes are paused in the editor')
      }
      return setAgentCameraState(params as HarmonyCameraSetRequest)
    }
    case 'tool.get':
      return getAgentToolState()
    case 'tool.set_active': {
      if (state.paused) {
        throw new AgentBridgeError('WRITE_LEASE_DENIED', 'Agent writes are paused in the editor')
      }
      return setAgentTool(params as unknown as HarmonyToolSetRequest)
    }
    case 'scene.query':
      return queryScene(store, params as HarmonySceneQuery)
    case 'catalog.search':
      return searchCatalog(store, params)
    case 'component.schema':
      return {
        profiles: componentManager.listAgentProfiles(),
      }
    case 'scene.apply': {
      if (state.paused) {
        throw new AgentBridgeError('WRITE_LEASE_DENIED', 'Agent writes are paused in the editor')
      }
      const result = await applySceneOperations(store, params as never, {
        captureScreenshot: screenshotProvider ?? undefined,
      })
      return { ...result, sessionId: getSessionId() }
    }
    case 'history.apply': {
      if (state.paused) {
        throw new AgentBridgeError('WRITE_LEASE_DENIED', 'Agent writes are paused in the editor')
      }
      const history = params as Partial<HarmonyHistoryRequest>
      if (
        typeof history.expectedRevision === 'number'
        && history.expectedRevision !== store.sceneRevision
      ) {
        throw new AgentBridgeError('STALE_REVISION', 'Scene revision changed before history action')
      }
      const beforeRevision = store.sceneRevision
      const changed = history.action === 'redo' ? await store.redo() : await store.undo()
      const result: HarmonyHistoryResult = {
        changed,
        beforeRevision,
        afterRevision: store.sceneRevision,
        canUndo: store.undoStack.length > 0,
        canRedo: store.redoStack.length > 0,
      }
      return result
    }
    case 'scene.save': {
      const document = await store.flushPendingSceneAutoSave({ force: true })
      const result: HarmonySaveResult = {
        saved: Boolean(document),
        sceneId: store.currentSceneId,
        sceneRevision: store.sceneRevision,
        updatedAt: document?.updatedAt ?? null,
      }
      return result
    }
    case 'viewport.screenshot': {
      if (!screenshotProvider) {
        throw new AgentBridgeError('OPERATION_NOT_SUPPORTED', 'Viewport screenshot provider is unavailable')
      }
      const blob = await screenshotProvider()
      if (!blob) {
        throw new AgentBridgeError('INTERNAL_ERROR', 'Viewport screenshot capture returned no image')
      }
      const encoded = await encodeBlob(blob)
      const result: HarmonyScreenshotResult = {
        mimeType: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        base64: encoded.base64,
        width: encoded.width,
        height: encoded.height,
        sceneId: store.currentSceneId,
        sceneRevision: store.sceneRevision,
      }
      return result
    }
    default:
      throw new AgentBridgeError('OPERATION_NOT_SUPPORTED', `Unknown bridge method ${request.method}`)
  }
}

function sendResponse(id: string, result: unknown): void {
  send({ type: 'response', payload: { jsonrpc: '2.0', id, result } })
}

function sendError(id: string, error: HarmonyAgentError): void {
  send({ type: 'response', payload: { jsonrpc: '2.0', id, error } })
}

async function handleServerMessage(message: AgentServerMessage): Promise<void> {
  if (message.type === 'paused') {
    state.paused = message.payload?.paused === true
    return
  }
  if (message.type !== 'request') {
    return
  }
  const { id, method } = message.payload
  const store = useSceneStore()
  try {
    const result = await executeRequest(store, message.payload)
    sendResponse(id, result)
    pushAudit(method, true, 'Completed')
  } catch (error) {
    const agentError = asAgentError(error)
    sendError(id, agentError)
    pushAudit(method, false, agentError.message)
  }
}

function updateConnectionStatus(): void {
  if (socket?.readyState === WebSocket.OPEN) {
    state.status = 'connected'
  } else if (socket?.readyState === WebSocket.CONNECTING) {
    state.status = 'connecting'
  } else if (state.enabled) {
    state.status = 'disconnected'
  }
}

function connect(): void {
  if (!state.enabled || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return
  }
  state.status = 'connecting'
  let nextSocket: WebSocket
  try {
    nextSocket = new WebSocket(getBridgeUrl())
    socket = nextSocket
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error)
    scheduleReconnect()
    return
  }
  nextSocket.addEventListener('open', () => {
    if (socket !== nextSocket) return
    reconnectAttempt = 0
    state.lastError = null
    state.sessionId = getSessionId()
    updateConnectionStatus()
    send(buildHello(useSceneStore()))
  })
  nextSocket.addEventListener('message', (event) => {
    if (socket !== nextSocket) return
    try {
      void handleServerMessage(JSON.parse(String(event.data)) as AgentServerMessage)
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
    }
  })
  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return
    socket = null
    updateConnectionStatus()
    scheduleReconnect()
  })
  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) return
    state.lastError = 'Unable to connect to the local Harmony Agent bridge'
  })
}

function scheduleReconnect(): void {
  if (!started || !state.enabled || reconnectTimer) {
    return
  }
  const delay = Math.min(10_000, 750 * 2 ** reconnectAttempt)
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (socket) {
    socket.close()
    socket = null
  }
  updateConnectionStatus()
}

export function setAgentBridgePaused(paused: boolean): void {
  state.paused = paused
  send({ type: 'status', payload: { paused } })
}

export function useAgentBridgeState(): AgentBridgeState {
  return state
}

export function useEditorAgentBridge(options: { captureScreenshot?: () => Promise<Blob | null> }): AgentBridgeState {
  screenshotProvider = options.captureScreenshot ?? null
  return state
}

export function startEditorAgentBridge(options: { captureScreenshot?: () => Promise<Blob | null> }): void {
  if (started) {
    screenshotProvider = options.captureScreenshot ?? screenshotProvider
    return
  }
  started = true
  screenshotProvider = options.captureScreenshot ?? null
  state.enabled = bridgeEnabled()
  state.sessionId = state.enabled ? getSessionId() : null
  if (!state.enabled) {
    state.status = 'disabled'
    return
  }
  const store = useSceneStore()
  if (!Number.isFinite((store as { sceneRevision?: number }).sceneRevision)) {
    store.sceneRevision = 0
  }
  watch(
    () => [
      store.currentSceneId,
      store.currentSceneMeta?.projectId,
      store.currentSceneMeta?.name,
      store.sceneRevision,
      store.isSceneReady,
      store.hasUnsavedChanges,
      store.undoStack.length,
      store.redoStack.length,
    ] as const,
    () => {
      if (socket?.readyState === WebSocket.OPEN) {
        send({ type: 'status', payload: buildHello(store) })
      }
    },
  )
  connect()
}

export function stopEditorAgentBridge(): void {
  state.enabled = false
  disconnect()
  state.status = 'disabled'
  started = false
}

export function useEditorAgentBridgeLifecycle(options: { captureScreenshot?: () => Promise<Blob | null> }): AgentBridgeState {
  onMounted(() => startEditorAgentBridge(options))
  onBeforeUnmount(() => stopEditorAgentBridge())
  return state
}
