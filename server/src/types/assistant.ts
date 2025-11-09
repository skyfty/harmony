export type AssistantMessageRole = 'user' | 'assistant'

export type AssistantContextMessage = {
  role: AssistantMessageRole
  text?: string
}

export type AssistantImagePayload = {
  base64: string
  mimeType: string
  fileName?: string
}

export type JsonPatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown }

export type AssistantToolDefinition = {
  name: string
  description: string
  parameters?: Record<string, unknown>
  returns?: string
}

export type AssistantToolInvocation = {
  tool: string
  args?: Record<string, unknown>
}

export type AssistantSceneChange =
  | {
      id: string
      type: 'tool-invocations'
      title?: string
      description?: string
      toolInvocations: AssistantToolInvocation[]
      autoApply?: boolean
    }
  | {
      id: string
      type: 'json-patch'
      title?: string
      description?: string
      patch: JsonPatchOperation[]
      autoApply?: boolean
    }

export type AssistantResourceDescriptor = {
  modelLibrary?: {
    searchEndpoint: string
    assetDetailEndpoint?: string
    description?: string
  }
}

export type AssistantSceneSnapshot = Record<string, unknown>

export type AssistantMessageMetadata = {
  systemPrompt: string
  toolboxSize: number
  sceneNodeCount?: number
  model?: string
  latencyMs?: number
  promptTokenCount?: number
}

export type AssistantMessagePayload = {
  text?: string
  image?: AssistantImagePayload | null
  context?: AssistantContextMessage[]
  scene?: AssistantSceneSnapshot | null
  toolbox?: AssistantToolDefinition[]
  resources?: AssistantResourceDescriptor
}

export type AssistantReply = {
  text: string
  createdAt: string
  imageUrl?: string | null
}

export type AssistantResponse = {
  id: string
  reply: AssistantReply
  suggestions?: string[]
  change?: AssistantSceneChange | null
  metadata?: AssistantMessageMetadata
}
