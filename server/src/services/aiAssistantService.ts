import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
type ChatCompletionContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart
type ChatCompletionMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam
type ChatCompletionUserMessageParam = OpenAI.Chat.Completions.ChatCompletionUserMessageParam
import { appConfig } from '@/config/env'
import type {
  AssistantMessagePayload,
  AssistantResponse,
  AssistantSceneChange,
  AssistantSceneSnapshot,
  AssistantToolDefinition,
  JsonPatchOperation,
} from '@/types/assistant'

const ASSISTANT_UPLOAD_DIR = path.join(appConfig.assetStoragePath, 'assistant')
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const AGENT_SYSTEM_PROMPT = '你是一名 3D 场景设计助手，负责理解用户的需求并提供可以直接调用的编辑指令。你可以参考提供的场景数据、历史对话与工具箱说明，生成清晰、有依据的建议。'
const MODEL_RESPONSE_FORMAT_INSTRUCTIONS = `
你必须严格以 JSON 响应，结构示例如下：
{
  "reply": {
    "text": "针对用户问题的中文回答，逻辑清晰，可引用工具。"
  },
  "suggestions": ["最多三个可执行的后续建议"],
  "change": null | {
    "type": "tool-invocations" | "json-patch",
    "title": "可选标题",
    "description": "一句话总结变更内容",
    "toolInvocations": [{ "tool": "工具名称", "args": { "键": "值" } }]?
    "patch": [ { "op": "add", "path": "/nodes/0", "value": {} } ]?
    "autoApply": boolean?
  }
}
如无法给出具体变更，务必返回 "change": null。不要输出 Markdown，也不要添加额外文字。`

let cachedOpenAiClient: OpenAI | null = null

function getOpenAiClient(): OpenAI {
  if (!appConfig.openAi.apiKey) {
    throw new Error('OpenAI API key 未配置')
  }
  if (!cachedOpenAiClient) {
    cachedOpenAiClient = new OpenAI({
      apiKey: appConfig.openAi.apiKey,
      baseURL: appConfig.openAi.baseUrl,
      organization: appConfig.openAi.organization,
      project: appConfig.openAi.project,
    })
  }
  return cachedOpenAiClient
}

type SceneSnapshotSummary = {
  totalNodes: number
  firstNodeId?: string
  firstNodeName?: string
  selectedNodeId?: string
  groundWidth?: number
  groundDepth?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }
  }
  return undefined
}

function isGroundNode(node: Record<string, unknown>): boolean {
  const type = typeof node.type === 'string' ? node.type.toLowerCase() : ''
  const name = typeof node.name === 'string' ? node.name.toLowerCase() : ''
  return type === 'ground' || name.includes('ground')
}

function summarizeSceneSnapshot(scene: AssistantSceneSnapshot | null): SceneSnapshotSummary {
  const summary: SceneSnapshotSummary = { totalNodes: 0 }
  if (!scene) {
    return summary
  }

  if (isRecord(scene)) {
    if (typeof scene.selectedNodeId === 'string') {
      summary.selectedNodeId = scene.selectedNodeId
    } else if (Array.isArray(scene.selectedNodeIds) && scene.selectedNodeIds.length) {
      const candidate = scene.selectedNodeIds.find((id: unknown): id is string => typeof id === 'string')
      if (candidate) {
        summary.selectedNodeId = candidate
      }
    }

    if (isRecord(scene.groundSettings)) {
      summary.groundWidth = toNumber(scene.groundSettings.width)
      summary.groundDepth = toNumber(scene.groundSettings.depth)
    }
  }

  const rootNodes = isRecord(scene) && Array.isArray((scene as Record<string, unknown>).nodes)
    ? ((scene as { nodes: unknown[] }).nodes.filter((node) => isRecord(node)) as Record<string, unknown>[])
    : []
  if (!rootNodes.length) {
    return summary
  }

  const queue: Record<string, unknown>[] = [...rootNodes]
  while (queue.length) {
    const node = queue.shift()!
    summary.totalNodes += 1

    if (!summary.firstNodeId && !isGroundNode(node) && typeof node.id === 'string') {
      summary.firstNodeId = node.id
      if (typeof node.name === 'string') {
        summary.firstNodeName = node.name
      }
    }

    const children = Array.isArray(node.children)
      ? (node.children.filter((entry) => isRecord(entry)) as Record<string, unknown>[])
      : []
    queue.push(...children)
  }

  if (!summary.firstNodeId && typeof summary.selectedNodeId === 'string') {
    summary.firstNodeId = summary.selectedNodeId
  }

  return summary
}

function ensureBase64Payload(raw: string): string {
  const trimmed = raw.trim()
  const commaIndex = trimmed.indexOf(',')
  if (commaIndex >= 0) {
    return trimmed.slice(commaIndex + 1)
  }
  return trimmed
}

function resolveExtension(mime: string): string {
  const normalized = mime.toLowerCase()
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  return 'bin'
}

async function ensureUploadDirectory(): Promise<void> {
  await mkdir(ASSISTANT_UPLOAD_DIR, { recursive: true })
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return trimmed.length ? trimmed : 'attachment'
}

function buildPublicUrl(fileName: string): string {
  const base = appConfig.assetPublicUrl.endsWith('/') ? appConfig.assetPublicUrl.slice(0, -1) : appConfig.assetPublicUrl
  return `${base}/assistant/${fileName}`
}

async function persistImage(payload: NonNullable<AssistantMessagePayload['image']>): Promise<string | null> {
  if (!payload.base64) {
    return null
  }
  const base64 = ensureBase64Payload(payload.base64)
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.byteLength) {
    return null
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('上传的截图过大，请压缩后重试')
  }

  await ensureUploadDirectory()
  const extension = resolveExtension(payload.mimeType || 'image/png')
  const safeName = sanitizeFileName(payload.fileName ?? '')
  const fileName = `${Date.now()}-${randomUUID()}-${safeName || 'screenshot'}.${extension}`
  const filePath = path.join(ASSISTANT_UPLOAD_DIR, fileName)
  await writeFile(filePath, buffer)
  return buildPublicUrl(fileName)
}

function toolboxToPrompt(toolbox: AssistantToolDefinition[] | undefined): string {
  if (!toolbox?.length) {
    return '工具箱为空，可实现的操作需要代理自行规划。'
  }
  return toolbox
    .map((tool, index) => {
      const description = tool.description || '无描述'
      return `${index + 1}. ${tool.name} - ${description}`
    })
    .join('\n')
}

function formatSceneSnapshot(scene: AssistantSceneSnapshot | null): string {
  if (!scene) {
    return 'null'
  }
  const json = JSON.stringify(scene, null, 2)
  if (json.length <= 12000) {
    return json
  }
  return `${json.slice(0, 11950)}\n... (truncated)`
}

function composeModelPrompt(
  payload: AssistantMessagePayload,
  summary: SceneSnapshotSummary,
  screenshotUrl: string | null,
): string {
  const sections: string[] = []
  sections.push(`Available Tools:\n${toolboxToPrompt(payload.toolbox)}`)

  if (payload.resources?.modelLibrary) {
    const resource = payload.resources.modelLibrary
    const detail = resource.assetDetailEndpoint ? `\n- 资源详情: ${resource.assetDetailEndpoint}` : ''
    sections.push(
      `Model Library API:\n- 搜索模型: ${resource.searchEndpoint}${detail}\n描述: ${resource.description ?? '无'}`,
    )
  }

  sections.push(`Scene Summary:\n节点总数: ${summary.totalNodes} (首个节点: ${summary.firstNodeId ?? '无'})`)
  sections.push(`Scene Snapshot:\n${formatSceneSnapshot(payload.scene ?? null)}`)

  if (screenshotUrl) {
    sections.push(`Latest Screenshot URL:\n${screenshotUrl}`)
  } else if (payload.image) {
    sections.push('Latest Screenshot URL:\n用户提供了截图，但服务器未生成可访问链接。')
  }

  const historyEntries = payload.context?.map((entry) => `${entry.role}: ${entry.text ?? '(无文本)'}`) ?? []
  if (historyEntries.length) {
    sections.push(`Recent Conversation:\n${historyEntries.join('\n')}`)
  }

  const userMessage = payload.text?.trim() ?? '(用户未提供文字，仅提供截图)'
  sections.push(`User Prompt:\n${userMessage}`)

  return sections.join('\n\n')
}

function describeChange(change: AssistantSceneChange): string {
  if (change.description) {
    return change.description
  }
  if (change.type === 'tool-invocations') {
    const tools = change.toolInvocations.map((invocation) => invocation.tool).join(', ')
    return `将调用工具：${tools}。`
  }
  return '将根据建议更新场景。'
}

function buildReplyText(
  payload: AssistantMessagePayload,
  summary: SceneSnapshotSummary,
  change: AssistantSceneChange | null,
): string {
  const segments: string[] = []
  const text = payload.text?.trim()
  if (text) {
    segments.push(`我已阅读你的描述：“${text}”。`)
  } else {
    segments.push('我已收到你的请求。')
  }
  if (payload.image) {
    segments.push('最新截图已记录，我会结合画面评估场景。')
  }

  segments.push(`当前场景共检测到 ${summary.totalNodes} 个节点。`)
  if (summary.firstNodeName) {
    segments.push(`主要对象「${summary.firstNodeName}」可以作为后续调整的锚点。`)
  }

  if (change) {
    segments.push(describeChange(change))
  } else {
    segments.push('建议先梳理节点层级或调整相机视角，以便明确后续的编辑方向。')
  }

  if (payload.resources?.modelLibrary?.searchEndpoint) {
    segments.push(`需要新的模型时，可通过模型库 API (${payload.resources.modelLibrary.searchEndpoint}) 搜索现有资源。`)
  }

  return segments.join(' ')
}

function buildSuggestions(
  payload: AssistantMessagePayload,
  summary: SceneSnapshotSummary,
  change: AssistantSceneChange | null,
): string[] {
  const suggestions = new Set<string>()

  if (!change || change.type !== 'tool-invocations') {
    suggestions.add('尝试使用“聚焦节点”工具快速定位需要编辑的对象')
  }

  if ((summary.groundWidth ?? 0) * (summary.groundDepth ?? 0) < 1600) {
    suggestions.add('适当扩大地面尺寸，为布景留出更多空间')
  }

  if (!payload.image) {
    suggestions.add('捕获一张视口截图，以便 AI 更精准地理解布局')
  }

  if (payload.resources?.modelLibrary?.searchEndpoint) {
    suggestions.add('调用模型库 API 搜索树木或灯光类资源，丰富场景层次')
  }

  return Array.from(suggestions).slice(0, 3)
}

function determineSceneChange(
  payload: AssistantMessagePayload,
  summary: SceneSnapshotSummary,
): AssistantSceneChange | null {
  const text = payload.text ? payload.text.toLowerCase() : ''
  if (!text.trim()) {
    return null
  }

  if (/(light|lighting|亮|光|sun)/i.test(text)) {
    return {
      id: randomUUID(),
      type: 'tool-invocations',
      description: '开启视口阴影并切换暖色天空盒，以提升整体光照层次。',
      toolInvocations: [
        { tool: 'set_viewport_shadows_enabled', args: { enabled: true } },
        { tool: 'set_skybox_preset', args: { presetId: 'sunset' } },
      ],
    }
  }

  if (/(focus|聚焦|镜头|查看|定位)/i.test(text)) {
    const nodeId = summary.selectedNodeId ?? summary.firstNodeId
    if (!nodeId) {
      return null
    }
    return {
      id: randomUUID(),
      type: 'tool-invocations',
      description: `聚焦到节点 ${summary.firstNodeName ?? nodeId}，便于进一步调整。`,
      toolInvocations: [
        { tool: 'select_nodes', args: { ids: [nodeId], primaryId: nodeId } },
        { tool: 'focus_on_node', args: { nodeId } },
      ],
    }
  }

  if (/(grid|网格)/i.test(text)) {
    return {
      id: randomUUID(),
      type: 'tool-invocations',
      description: '隐藏地面网格，让预览画面更简洁。',
      toolInvocations: [{ tool: 'set_viewport_grid_visible', args: { visible: false } }],
    }
  }

  if (/(bigger|larger|扩大|放大|增大|scale up)/i.test(text)) {
    const width = summary.groundWidth ?? 40
    const depth = summary.groundDepth ?? 40
    const nextWidth = Math.round(width * 1.2 * 100) / 100
    const nextDepth = Math.round(depth * 1.2 * 100) / 100
    return {
      id: randomUUID(),
      type: 'tool-invocations',
      description: '增大地面尺寸，为场景布景留出更多空间。',
      toolInvocations: [{ tool: 'set_ground_dimensions', args: { width: nextWidth, depth: nextDepth } }],
    }
  }

  if (/(shadow|阴影)/i.test(text)) {
    return {
      id: randomUUID(),
      type: 'tool-invocations',
      description: '启用阴影渲染，让场景更具层次感。',
      toolInvocations: [{ tool: 'set_viewport_shadows_enabled', args: { enabled: true } }],
    }
  }

  return null
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }
  const firstLineBreak = trimmed.indexOf('\n')
  if (firstLineBreak === -1) {
    return trimmed
  }
  const closingIndex = trimmed.lastIndexOf('```')
  if (closingIndex <= firstLineBreak) {
    return trimmed
  }
  return trimmed.slice(firstLineBreak + 1, closingIndex).trim()
}

function parseModelJson(content: string): Record<string, unknown> | null {
  const trimmed = stripCodeFences(content)
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }
  const jsonSlice = trimmed.slice(start, end + 1)
  try {
    const parsed = JSON.parse(jsonSlice)
    return isRecord(parsed) ? parsed : null
  } catch (error) {
    console.warn('[Assistant] 无法解析模型返回内容为 JSON', error)
    return null
  }
}

function normalizeSuggestions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const entries = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
  return entries.length ? entries.slice(0, 5) : undefined
}

function normalizeJsonPatchOperation(candidate: unknown): JsonPatchOperation | null {
  if (!isRecord(candidate)) {
    return null
  }
  const op = typeof candidate.op === 'string' ? candidate.op : ''
  const path = typeof candidate.path === 'string' ? candidate.path : ''
  if (!op || !path) {
    return null
  }

  if (op === 'add' || op === 'replace' || op === 'test') {
    if (!('value' in candidate)) {
      return null
    }
    return { op, path, value: (candidate as { value: unknown }).value }
  }

  if (op === 'remove') {
    return { op, path }
  }

  if (op === 'move' || op === 'copy') {
    const from = typeof candidate.from === 'string' ? candidate.from : ''
    if (!from) {
      return null
    }
    return { op, path, from }
  }

  return null
}

function normalizeSceneChangeFromModel(raw: unknown): AssistantSceneChange | null | undefined {
  if (!isRecord(raw)) {
    return undefined
  }
  const type = typeof raw.type === 'string' ? raw.type : ''
  if (!type) {
    return undefined
  }
  const id = typeof raw.id === 'string' && raw.id.trim().length ? raw.id.trim() : randomUUID()
  const title = typeof raw.title === 'string' ? raw.title.trim() : undefined
  const description = typeof raw.description === 'string' ? raw.description.trim() : undefined
  const autoApply = typeof raw.autoApply === 'boolean' ? raw.autoApply : undefined

  if (type === 'tool-invocations') {
    const invocationSource = Array.isArray(raw.toolInvocations) ? raw.toolInvocations : []
    const toolInvocations = invocationSource
      .map((entry) => {
        if (!isRecord(entry)) {
          return null
        }
        const tool = typeof entry.tool === 'string' ? entry.tool.trim() : ''
        if (!tool) {
          return null
        }
        const args = isRecord(entry.args) ? (entry.args as Record<string, unknown>) : undefined
        return args ? { tool, args } : { tool }
      })
      .filter((entry): entry is { tool: string; args?: Record<string, unknown> } => Boolean(entry))

    if (!toolInvocations.length) {
      return null
    }

    const change: AssistantSceneChange = {
      id,
      type: 'tool-invocations',
      toolInvocations,
    }
    if (title) {
      change.title = title
    }
    if (description) {
      change.description = description
    }
    if (autoApply !== undefined) {
      change.autoApply = autoApply
    }
    return change
  }

  if (type === 'json-patch') {
    const patchSource = Array.isArray(raw.patch) ? raw.patch : []
    const patch = patchSource
      .map(normalizeJsonPatchOperation)
      .filter((operation): operation is JsonPatchOperation => Boolean(operation))
    if (!patch.length) {
      return null
    }
    const change: AssistantSceneChange = {
      id,
      type: 'json-patch',
      patch,
    }
    if (title) {
      change.title = title
    }
    if (description) {
      change.description = description
    }
    if (autoApply !== undefined) {
      change.autoApply = autoApply
    }
    return change
  }

  return undefined
}

type NormalizedModelPayload = {
  replyText?: string
  replyImageUrl?: string | null
  suggestions?: string[]
  change?: AssistantSceneChange | null
  hasChange: boolean
}

function normalizeModelResponse(parsed: Record<string, unknown> | null): NormalizedModelPayload {
  if (!parsed) {
    return { hasChange: false }
  }

  const reply = isRecord(parsed.reply) ? parsed.reply : undefined
  const replyText = typeof reply?.text === 'string' ? reply.text.trim() : undefined
  const replyImageUrl = typeof reply?.imageUrl === 'string' ? reply.imageUrl.trim() : undefined

  const suggestions = normalizeSuggestions(parsed.suggestions)

  let changeValue: AssistantSceneChange | null | undefined
  let hasChange = false
  if (Object.prototype.hasOwnProperty.call(parsed, 'change')) {
    hasChange = true
    changeValue = normalizeSceneChangeFromModel(parsed.change)
    if (changeValue === undefined) {
      changeValue = null
    }
  }

  return {
    replyText,
    replyImageUrl: replyImageUrl ?? undefined,
    suggestions,
    change: changeValue ?? undefined,
    hasChange,
  }
}

function approximateTokenCount(prompt: string): number {
  if (!prompt.length) {
    return 0
  }
  return Math.max(1, Math.round(prompt.length / 4))
}

export async function processAssistantMessage(payload: AssistantMessagePayload): Promise<AssistantResponse> {
  const replyId = randomUUID()
  const startedAt = Date.now()

  let screenshotUrl: string | null = null
  if (payload.image) {
    screenshotUrl = await persistImage(payload.image)
  }

  const sceneSummary = summarizeSceneSnapshot(payload.scene ?? null)
  const heuristicChange = determineSceneChange(payload, sceneSummary)
  const fallbackReply = buildReplyText(payload, sceneSummary, heuristicChange)
  const fallbackSuggestions = buildSuggestions(payload, sceneSummary, heuristicChange)
  const createdAt = new Date().toISOString()

  const prompt = composeModelPrompt(payload, sceneSummary, screenshotUrl)
  if (appConfig.isDevelopment) {
    console.debug('[Assistant] Prompt preview:\n', prompt)
  }

  let finalReplyText = fallbackReply
  let finalSuggestions = fallbackSuggestions
  let finalChange: AssistantSceneChange | null = heuristicChange ?? null
  let replyImageUrl: string | null = screenshotUrl
  let metadataModel = 'harmony-fallback'
  let promptTokenCount = approximateTokenCount(prompt)

  try {
    const client = getOpenAiClient()
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: `${AGENT_SYSTEM_PROMPT}\n\n${MODEL_RESPONSE_FORMAT_INSTRUCTIONS}` },
    ]

    const userContentParts: ChatCompletionContentPart[] = [{ type: 'text', text: prompt }]
    if (screenshotUrl) {
      userContentParts.push({ type: 'image_url', image_url: { url: screenshotUrl } })
    }

    const userMessage: ChatCompletionUserMessageParam = {
      role: 'user',
      content: userContentParts,
    }

    messages.push(userMessage)

    const completion = await client.chat.completions.create({
      model: appConfig.openAi.model,
      temperature: 0.6,
      messages,
    })

    metadataModel = completion.model ? `openai:${completion.model}` : `openai:${appConfig.openAi.model}`
    if (completion.usage?.total_tokens) {
      promptTokenCount = completion.usage.total_tokens
    }

    const content = completion.choices?.[0]?.message?.content ?? ''
    const parsed = parseModelJson(content)
    const normalized = normalizeModelResponse(parsed)

    if (normalized.replyText) {
      finalReplyText = normalized.replyText
    }
    if (normalized.replyImageUrl) {
      replyImageUrl = normalized.replyImageUrl
    }
    if (normalized.suggestions) {
      finalSuggestions = normalized.suggestions
    }
    if (normalized.hasChange) {
      finalChange = normalized.change ?? null
    } else {
      finalChange = heuristicChange ?? null
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('未配置')) {
      throw error
    }
    console.error('[Assistant] OpenAI 调用失败，采用降级逻辑', error)
    metadataModel = 'harmony-fallback'
  }

  const latencyMs = Date.now() - startedAt

  return {
    id: replyId,
    reply: {
      text: finalReplyText,
      createdAt,
      imageUrl: replyImageUrl,
    },
    suggestions: finalSuggestions,
    change: finalChange,
    metadata: {
      systemPrompt: AGENT_SYSTEM_PROMPT,
      toolboxSize: payload.toolbox?.length ?? 0,
      sceneNodeCount: sceneSummary.totalNodes,
      model: metadataModel,
      latencyMs,
      promptTokenCount,
    },
  }
}
