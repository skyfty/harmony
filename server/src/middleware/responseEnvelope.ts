import type { Context, Next } from 'koa'

type ApiEnvelope<T> = {
  code: number
  data: T
  message: string
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string'
}

function shouldSkipEnvelope(ctx: Context): boolean {
  if (!ctx.path.startsWith('/api')) {
    return true
  }
  if (ctx.status === 204 || ctx.status === 304) {
    return true
  }

  const body = ctx.body as unknown
  if (body === undefined) {
    return true
  }
  if (body === null) {
    return false
  }
  if (Buffer.isBuffer(body)) {
    return true
  }
  if (typeof body === 'object' && typeof (body as { pipe?: unknown }).pipe === 'function') {
    return true
  }
  const contentDisposition = ctx.response.get('Content-Disposition')
  if (contentDisposition) {
    return true
  }
  return false
}

export async function responseEnvelope(ctx: Context, next: Next): Promise<void> {
  await next()

  if (shouldSkipEnvelope(ctx)) {
    return
  }

  if (isApiEnvelope(ctx.body)) {
    return
  }

  ctx.body = {
    code: 0,
    data: ctx.body,
    message: 'ok',
  } satisfies ApiEnvelope<unknown>
}
