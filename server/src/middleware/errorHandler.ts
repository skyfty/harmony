import type { Context, Next } from 'koa'

export async function errorHandler(ctx: Context, next: Next): Promise<void> {
  try {
    await next()
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    const message = (error as { message?: string }).message ?? 'Internal Server Error'
    ctx.status = status
    ctx.body = {
      code: status,
      data: null,
      message,
    }
  }
}
