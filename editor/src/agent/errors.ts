import type { HarmonyAgentError, HarmonyAgentErrorCode } from '@schema/editorAgentProtocol'

export class AgentBridgeError extends Error {
  readonly code: HarmonyAgentErrorCode
  readonly details?: unknown

  constructor(code: HarmonyAgentErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AgentBridgeError'
    this.code = code
    this.details = details
  }

  toJSON(): HarmonyAgentError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}

export function asAgentError(error: unknown): HarmonyAgentError {
  if (error instanceof AgentBridgeError) {
    return error.toJSON()
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
  }
}
