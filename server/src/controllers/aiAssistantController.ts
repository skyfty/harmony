import type { Context } from 'koa'
import type {
  AssistantContextMessage,
  AssistantMessagePayload,
  AssistantResourceDescriptor,
  AssistantSceneSnapshot,
  AssistantToolDefinition,
} from '@/types/assistant'
import { processAssistantMessage } from '@/services/aiAssistantService'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeContext(entries: unknown): AssistantContextMessage[] | undefined {
  if (!Array.isArray(entries)) {
    return undefined
  }
  const validRoles = new Set<AssistantContextMessage['role']>(['user', 'assistant'])
  const normalized: AssistantContextMessage[] = []
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const roleCandidate = (entry as { role?: string }).role
    if (typeof roleCandidate !== 'string' || !validRoles.has(roleCandidate as AssistantContextMessage['role'])) {
      return
    }
    const textCandidate = (entry as { text?: unknown }).text
    const contextEntry: AssistantContextMessage = { role: roleCandidate as AssistantContextMessage['role'] }
    if (typeof textCandidate === 'string' && textCandidate.trim()) {
      contextEntry.text = textCandidate
    }
    normalized.push(contextEntry)
  })
  return normalized.length ? normalized : undefined
}

function normalizeToolbox(entries: unknown): AssistantToolDefinition[] | undefined {
  if (!Array.isArray(entries)) {
    return undefined
  }
  const normalized: AssistantToolDefinition[] = []
  entries.forEach((entry) => {
    if (!isRecord(entry)) {
      return
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name) {
      return
    }
    const description = typeof entry.description === 'string' ? entry.description.trim() : ''
    const parameters = isRecord(entry.parameters) ? entry.parameters : undefined
    const returns = typeof entry.returns === 'string' ? entry.returns : undefined
    normalized.push({ name, description, parameters, returns })
  })
  return normalized.length ? normalized : undefined
}

function normalizeSceneSnapshot(value: unknown): AssistantSceneSnapshot | null | undefined {
  if (value === null) {
    return null
  }
  if (!isRecord(value)) {
    return undefined
  }
  return value
}

function normalizeResources(value: unknown): AssistantResourceDescriptor | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const descriptor: AssistantResourceDescriptor = {}
  const library = value.modelLibrary
  if (isRecord(library)) {
    const searchEndpoint = typeof library.searchEndpoint === 'string' ? library.searchEndpoint : undefined
    const assetDetailEndpoint = typeof library.assetDetailEndpoint === 'string' ? library.assetDetailEndpoint : undefined
    const description = typeof library.description === 'string' ? library.description : undefined
    if (searchEndpoint) {
      descriptor.modelLibrary = {
        searchEndpoint,
        assetDetailEndpoint,
        description,
      }
    }
  }
  return Object.keys(descriptor).length ? descriptor : undefined
}

function normalizePayload(raw: unknown): AssistantMessagePayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('请求数据无效')
  }
  const candidate = raw as Partial<AssistantMessagePayload> & Record<string, unknown>
  const text = typeof candidate.text === 'string' ? candidate.text : undefined

  let image: AssistantMessagePayload['image']
  if (candidate.image && typeof candidate.image === 'object') {
    const imagePayload = candidate.image as Record<string, unknown>
    const base64 = typeof imagePayload.base64 === 'string' ? imagePayload.base64 : ''
    if (!base64.trim()) {
      throw new Error('图片数据缺失')
    }
    const mimeType = typeof imagePayload.mimeType === 'string' ? imagePayload.mimeType : 'image/png'
    const fileName = typeof imagePayload.fileName === 'string' ? imagePayload.fileName : undefined
    image = { base64, mimeType, fileName }
  }

  const context = normalizeContext(candidate.context)
  const toolbox = normalizeToolbox(candidate.toolbox)
  const scene = normalizeSceneSnapshot(candidate.scene)
  const resources = normalizeResources(candidate.resources)

  if ((!text || !text.trim()) && !image) {
    throw new Error('至少需要提供文本或截图信息')
  }

  return {
    text,
    image,
    context,
    toolbox,
    scene: scene ?? null,
    resources,
  }
}

export async function handleAssistantMessage(ctx: Context): Promise<void> {
  let payload: AssistantMessagePayload
  try {
    payload = normalizePayload(ctx.request.body)
  } catch (error) {
    ctx.status = 400
    ctx.body = { message: error instanceof Error ? error.message : '请求数据无效' }
    return
  }

  try {
    const data = await processAssistantMessage(payload)
    ctx.body = { data }
  } catch (error) {
    console.error('[Assistant] Failed to process request', error)
    ctx.status = 502
    ctx.body = { message: 'AI 助手服务暂不可用，请稍后再试。' }
  }
}
