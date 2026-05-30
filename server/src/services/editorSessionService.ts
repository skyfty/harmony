import type { ServerResponse } from 'node:http'
import { nanoid } from 'nanoid'

type EditorSessionEvent =
  | { type: 'ready'; userId: string; editorSessionId: string }
  | { type: 'forced-logout'; reason: 'SESSION_REPLACED' }
  | {
      type: 'login-request'
      requestId: string
      username: string
      requestedAt: string
      expiresAt: string
    }

type EditorLoginApprovalResult = 'approved' | 'rejected' | 'timeout'

type EditorSessionConnection = {
  userId: string
  editorSessionId: string
  response: ServerResponse
  heartbeatTimer: NodeJS.Timeout | null
}

type PendingLoginRequest = {
  requestId: string
  userId: string
  editorSessionId: string
  timeoutTimer: NodeJS.Timeout
  resolve: (result: EditorLoginApprovalResult) => void
}

const LOGIN_REQUEST_TIMEOUT_MS = 30000

function writeEvent(response: ServerResponse, event: string, data: EditorSessionEvent): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

function writeComment(response: ServerResponse, comment: string): void {
  response.write(`: ${comment}\n\n`)
}

class EditorSessionService {
  private readonly connectionsByUserId = new Map<string, Set<EditorSessionConnection>>()
  private readonly pendingLoginRequestsByUserId = new Map<string, PendingLoginRequest>()
  private readonly pendingLoginRequestsById = new Map<string, PendingLoginRequest>()

  registerConnection(userId: string, editorSessionId: string, response: ServerResponse): () => void {
    const connection: EditorSessionConnection = {
      userId,
      editorSessionId,
      response,
      heartbeatTimer: null,
    }

    let connections = this.connectionsByUserId.get(userId)
    if (!connections) {
      connections = new Set<EditorSessionConnection>()
      this.connectionsByUserId.set(userId, connections)
    }
    connections.add(connection)

    connection.heartbeatTimer = setInterval(() => {
      try {
        writeComment(response, 'keep-alive')
      } catch (error) {
        console.warn('Failed to write editor session heartbeat', error)
        this.disposeConnection(connection)
      }
    }, 25000)

    writeEvent(response, 'ready', {
      type: 'ready',
      userId,
      editorSessionId,
    })

    return () => {
      this.disposeConnection(connection)
    }
  }

  async revokeEditorSessions(userId: string, activeEditorSessionId: string): Promise<void> {
    const connections = this.connectionsByUserId.get(userId)
    if (!connections || !connections.size) {
      return
    }

    const staleConnections = Array.from(connections).filter(
      (connection) => connection.editorSessionId !== activeEditorSessionId,
    )

    for (const connection of staleConnections) {
      try {
        writeEvent(connection.response, 'forced-logout', {
          type: 'forced-logout',
          reason: 'SESSION_REPLACED',
        })
      } catch (error) {
        console.warn('Failed to write editor forced logout event', error)
      } finally {
        try {
          connection.response.end()
        } catch (_error) {
          // noop
        }
        this.disposeConnection(connection)
      }
    }
  }

  hasActiveEditorSession(userId: string, editorSessionId: string | null | undefined): boolean {
    if (!editorSessionId) {
      return false
    }
    const connections = this.connectionsByUserId.get(userId)
    if (!connections || !connections.size) {
      return false
    }
    return Array.from(connections).some((connection) => connection.editorSessionId === editorSessionId)
  }

  requestLoginApproval(input: {
    userId: string
    editorSessionId: string
    username: string
  }): Promise<EditorLoginApprovalResult> {
    const connections = this.getActiveConnections(input.userId, input.editorSessionId)
    if (!connections.length) {
      return Promise.resolve('approved')
    }

    this.resolvePendingLoginRequest(input.userId, 'rejected')

    const requestId = nanoid()
    const requestedAt = new Date()
    const expiresAt = new Date(requestedAt.getTime() + LOGIN_REQUEST_TIMEOUT_MS)

    return new Promise<EditorLoginApprovalResult>((resolve) => {
      const pending: PendingLoginRequest = {
        requestId,
        userId: input.userId,
        editorSessionId: input.editorSessionId,
        timeoutTimer: setTimeout(() => {
          this.resolvePendingLoginRequest(input.userId, 'timeout')
        }, LOGIN_REQUEST_TIMEOUT_MS),
        resolve,
      }
      this.pendingLoginRequestsByUserId.set(input.userId, pending)
      this.pendingLoginRequestsById.set(requestId, pending)

      let delivered = false
      for (const connection of connections) {
        try {
          writeEvent(connection.response, 'login-request', {
            type: 'login-request',
            requestId,
            username: input.username,
            requestedAt: requestedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          })
          delivered = true
        } catch (error) {
          console.warn('Failed to write editor login request event', error)
          this.disposeConnection(connection)
        }
      }

      if (!delivered) {
        this.resolvePendingLoginRequest(input.userId, 'approved')
      }
    })
  }

  respondLoginRequest(input: {
    requestId: string
    userId: string
    editorSessionId: string | null | undefined
    approved: boolean
  }): boolean {
    const pending = this.pendingLoginRequestsById.get(input.requestId)
    if (!pending || pending.userId !== input.userId || pending.editorSessionId !== input.editorSessionId) {
      return false
    }
    this.resolvePendingLoginRequest(pending.userId, input.approved ? 'approved' : 'rejected')
    return true
  }

  private getActiveConnections(userId: string, editorSessionId: string): EditorSessionConnection[] {
    const connections = this.connectionsByUserId.get(userId)
    if (!connections || !connections.size) {
      return []
    }
    return Array.from(connections).filter((connection) => connection.editorSessionId === editorSessionId)
  }

  private resolvePendingLoginRequest(userId: string, result: EditorLoginApprovalResult): void {
    const pending = this.pendingLoginRequestsByUserId.get(userId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timeoutTimer)
    this.pendingLoginRequestsByUserId.delete(userId)
    this.pendingLoginRequestsById.delete(pending.requestId)
    pending.resolve(result)
  }

  private disposeConnection(connection: EditorSessionConnection): void {
    if (connection.heartbeatTimer) {
      clearInterval(connection.heartbeatTimer)
      connection.heartbeatTimer = null
    }

    const connections = this.connectionsByUserId.get(connection.userId)
    if (!connections) {
      return
    }
    connections.delete(connection)
    if (!connections.size) {
      this.connectionsByUserId.delete(connection.userId)
    }
  }
}

export const editorSessionService = new EditorSessionService()
