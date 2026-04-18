import type { ServerResponse } from 'node:http'

type EditorSessionEvent =
  | { type: 'ready'; userId: string; editorSessionId: string }
  | { type: 'forced-logout'; reason: 'SESSION_REPLACED' }

type EditorSessionConnection = {
  userId: string
  editorSessionId: string
  response: ServerResponse
  heartbeatTimer: NodeJS.Timeout | null
}

function writeEvent(response: ServerResponse, event: string, data: EditorSessionEvent): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

function writeComment(response: ServerResponse, comment: string): void {
  response.write(`: ${comment}\n\n`)
}

class EditorSessionService {
  private readonly connectionsByUserId = new Map<string, Set<EditorSessionConnection>>()

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