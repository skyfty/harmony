import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import {
  HARMONY_AGENT_DEFAULT_PORT,
  HARMONY_AGENT_MAX_ITEM_BYTES,
  HARMONY_AGENT_PROTOCOL_VERSION,
} from '../../schema/dist/editorAgentProtocol.js'

const WRITE_METHODS = new Set([
  'scene.apply',
  'history.apply',
  'scene.save',
  'camera.set',
  'tool.set_active',
])
const REQUEST_TIMEOUT_MS = 120_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorPayload(code, message, details) {
  return {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  }
}

export class BridgeRpcError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'BridgeRpcError'
    this.code = code
    this.details = details
  }
}

export class EditorBridge {
  constructor(options = {}) {
    this.port = Number(options.port ?? process.env.HARMONY_EDITOR_BRIDGE_PORT ?? HARMONY_AGENT_DEFAULT_PORT)
    this.stateDir = options.stateDir ?? join(homedir(), '.harmony-editor-agent')
    this.tokenPath = join(this.stateDir, 'token')
    this.httpServer = null
    this.wsServer = null
    this.socket = null
    this.session = null
    this.pending = new Map()
    this.writeQueue = Promise.resolve()
    this.token = null
    this.allowedOrigins = new Set(
      String(process.env.HARMONY_EDITOR_AGENT_ORIGINS
        ?? 'http://localhost:8088,http://127.0.0.1:8088,http://localhost:5173,http://127.0.0.1:5173')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
  }

  async start() {
    await mkdir(this.stateDir, { recursive: true })
    this.token = await this.loadOrCreateToken()
    this.httpServer = createServer((request, response) => {
      void this.handleHttpRequest(request, response)
    })
    this.wsServer = new WebSocketServer({ noServer: true })

    this.httpServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      if (url.pathname !== '/editor') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }
      const origin = request.headers.origin
      if (!origin || !this.allowedOrigins.has(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      this.wsServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.wsServer.emit('connection', webSocket, request)
      })
    })

    this.wsServer.on('connection', (socket) => this.handleEditorConnection(socket))

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.httpServer?.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        this.httpServer?.off('error', onError)
        resolve()
      }
      this.httpServer.once('error', onError)
      this.httpServer.once('listening', onListening)
      this.httpServer.listen(this.port, '127.0.0.1')
    })
    return this
  }

  async loadOrCreateToken() {
    try {
      const existing = (await readFile(this.tokenPath, 'utf8')).trim()
      if (existing.length >= 32) {
        return existing
      }
    } catch {
      // First run.
    }
    const token = randomBytes(32).toString('base64url')
    await writeFile(this.tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
    return token
  }

  async handleHttpRequest(request, response) {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true, protocolVersion: HARMONY_AGENT_PROTOCOL_VERSION }))
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/rpc') {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: 'Not found' }))
      return
    }
    const authorization = request.headers.authorization ?? ''
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    if (!suppliedToken || !this.token || !safeTokenEqual(suppliedToken, this.token)) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: errorPayload('AUTH_REQUIRED', 'A valid local bridge token is required') }))
      return
    }

    const chunks = []
    let totalBytes = 0
    for await (const chunk of request) {
      totalBytes += chunk.length
      if (totalBytes > HARMONY_AGENT_MAX_ITEM_BYTES) {
        response.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: errorPayload('BAD_REQUEST', 'Request body is too large') }))
        return
      }
      chunks.push(chunk)
    }

    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: errorPayload('BAD_REQUEST', 'Malformed JSON request') }))
      return
    }

    try {
      const result = await this.call(String(payload.method ?? ''), payload.params ?? {})
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: payload.id ?? randomUUID(),
        result,
      }))
    } catch (error) {
      const status = error instanceof BridgeRpcError && error.code === 'SESSION_UNAVAILABLE' ? 503 : 200
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: payload.id ?? randomUUID(),
        error: normalizeBridgeError(error),
      }))
    }
  }

  handleEditorConnection(socket) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.close(4001, 'Replaced by a newer Editor session')
      } catch {
        // Ignore stale socket close failures.
      }
    }
    this.socket = socket
    socket.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message.type === 'hello') {
        const hello = message.payload ?? message
        this.session = {
          ...hello,
          connectedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        }
        return
      }
      if (message.type === 'status') {
        const status = message.payload ?? {}
        this.session = {
          ...(this.session ?? {}),
          ...status,
          lastSeenAt: new Date().toISOString(),
        }
        return
      }
      if (message.type === 'response') {
        this.handleEditorResponse(message.payload)
      }
    })
    socket.on('close', () => {
      if (this.socket !== socket) {
        return
      }
      this.socket = null
      this.session = null
      this.rejectPending('SESSION_UNAVAILABLE', 'Editor disconnected')
    })
    socket.on('error', () => {
      // The close handler performs cleanup.
    })
  }

  handleEditorResponse(payload) {
    if (!payload || typeof payload.id !== 'string') {
      return
    }
    const request = this.pending.get(payload.id)
    if (!request) {
      return
    }
    this.pending.delete(payload.id)
    clearTimeout(request.timeout)
    if (payload.error) {
      request.reject(new BridgeRpcError(
        payload.error.code ?? 'INTERNAL_ERROR',
        payload.error.message ?? 'Editor request failed',
        payload.error.details,
      ))
      return
    }
    request.resolve(payload.result)
  }

  rejectPending(code, message) {
    for (const [id, request] of this.pending.entries()) {
      clearTimeout(request.timeout)
      request.reject(new BridgeRpcError(code, message))
      this.pending.delete(id)
    }
  }

  getSessionSummary() {
    if (!this.session) {
      return null
    }
    const {
      capabilities: _capabilities,
      protocolVersion: _protocolVersion,
      type: _type,
      ...session
    } = this.session
    return session
  }

  async call(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.session) {
      throw new BridgeRpcError('SESSION_UNAVAILABLE', 'No Harmony Editor is connected to the local bridge')
    }
    if (this.session.protocolVersion !== HARMONY_AGENT_PROTOCOL_VERSION) {
      throw new BridgeRpcError(
        'BAD_REQUEST',
        `Editor protocol ${this.session.protocolVersion ?? 'unknown'} is incompatible with bridge protocol ${HARMONY_AGENT_PROTOCOL_VERSION}`,
      )
    }
    const isWrite = WRITE_METHODS.has(method)
    let releaseWrite = null
    if (isWrite) {
      if (this.session.paused) {
        throw new BridgeRpcError('WRITE_LEASE_DENIED', 'Agent writes are paused in the Editor')
      }
      const previousWrite = this.writeQueue
      this.writeQueue = new Promise((resolve) => {
        releaseWrite = resolve
      })
      await previousWrite
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.session) {
        releaseWrite()
        throw new BridgeRpcError('SESSION_UNAVAILABLE', 'Editor disconnected while waiting for the write lease')
      }
      if (this.session.paused) {
        releaseWrite()
        throw new BridgeRpcError('WRITE_LEASE_DENIED', 'Agent writes are paused in the Editor')
      }
    }

    try {
      return await new Promise((resolve, reject) => {
        const id = randomUUID()
        const timeout = setTimeout(() => {
          this.pending.delete(id)
          reject(new BridgeRpcError('TIMEOUT', `Editor request ${method} timed out`))
        }, REQUEST_TIMEOUT_MS)
        this.pending.set(id, { resolve, reject, timeout })
        this.socket.send(JSON.stringify({
          type: 'request',
          payload: { id, method, params },
        }))
      })
    } finally {
      releaseWrite?.()
    }
  }

  async close() {
    this.rejectPending('SESSION_UNAVAILABLE', 'Bridge is shutting down')
    for (const client of this.wsServer?.clients ?? []) {
      try {
        client.close()
      } catch {
        // Ignore shutdown close failures.
      }
    }
    await new Promise((resolve) => this.wsServer?.close(() => resolve()) ?? resolve())
    await new Promise((resolve) => this.httpServer?.close(() => resolve()) ?? resolve())
  }
}

export class RemoteBridgeClient {
  constructor({ port, token }) {
    this.endpoint = `http://127.0.0.1:${port}/rpc`
    this.token = token
  }

  async call(method, params = {}) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.error) {
      throw new BridgeRpcError(
        body?.error?.code ?? 'SESSION_UNAVAILABLE',
        body?.error?.message ?? `Bridge request failed with HTTP ${response.status}`,
        body?.error?.details,
      )
    }
    return body.result
  }

  async close() {
    // Remote clients do not own the bridge process.
  }
}

export async function createOrConnectBridge() {
  const port = Number(process.env.HARMONY_EDITOR_BRIDGE_PORT ?? HARMONY_AGENT_DEFAULT_PORT)
  const bridge = new EditorBridge({ port })
  try {
    await bridge.start()
    const token = await readFile(bridge.tokenPath, 'utf8')
    return {
      client: bridge,
      bridge,
      ownsBridge: true,
      port,
      token: token.trim(),
      tokenPath: bridge.tokenPath,
    }
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') {
      throw error
    }
  }

  const stateDir = join(homedir(), '.harmony-editor-agent')
  const tokenPath = join(stateDir, 'token')
  const token = (await readFile(tokenPath, 'utf8')).trim()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) {
        return {
          client: new RemoteBridgeClient({ port, token }),
          bridge: null,
          ownsBridge: false,
          port,
          token,
          tokenPath,
        }
      }
    } catch {
      // The owning process may still be starting.
    }
    await sleep(100)
  }
  throw new Error(`Port ${port} is in use, but no Harmony Editor bridge is responding`)
}

export function normalizeBridgeError(error) {
  if (error instanceof BridgeRpcError) {
    return errorPayload(error.code, error.message, error.details)
  }
  return errorPayload('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
}

function safeTokenEqual(left, right) {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return leftDigest.equals(rightDigest)
}
