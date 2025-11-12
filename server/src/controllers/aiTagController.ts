import type { Context } from 'koa'
import { generateTags, type TagGenerationRequest } from '@/services/aiTagService'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function normalizeSource(value: unknown): TagGenerationRequest['source'] {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return undefined
  }
  const kind = value.kind as string
  if (kind === 'audio') {
    const base64 = typeof value.base64 === 'string' ? value.base64 : ''
    if (!base64.trim()) {
      return undefined
    }
    return {
      kind: 'audio',
      base64: base64.trim(),
      mimeType: normalizeString(value.mimeType),
      filename: normalizeString(value.filename),
    }
  }
  if (kind === 'image') {
    return { kind: 'image', promptHint: normalizeString(value.promptHint) ?? undefined }
  }
  return { kind: 'text' }
}

export async function handleGenerateTags(ctx: Context): Promise<void> {
  const body = ctx.request.body
  if (!isRecord(body)) {
    ctx.status = 400
    ctx.body = { message: '请求数据无效' }
    return
  }

  const name = normalizeString(body.name)
  const description = normalizeString(body.description)
  const assetType = normalizeString(body.assetType)
  const source = normalizeSource(body.source)
  const extraHints = Array.isArray(body.extraHints)
    ? body.extraHints.map((hint) => (typeof hint === 'string' ? hint.trim() : '')).filter((hint) => hint.length > 0)
    : undefined

  if (!name && !description) {
    ctx.status = 400
    ctx.body = { message: '请提供资源名称或描述' }
    return
  }

  try {
    const result = await generateTags({
      name,
      description,
      assetType,
      source,
      extraHints,
    })
    ctx.body = { data: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成标签失败'
    ctx.status = 502
    ctx.body = { message }
  }
}
