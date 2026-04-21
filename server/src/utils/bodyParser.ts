import koaBodyModule from 'koa-body'
import type { Context, Next } from 'koa'

type KoaBodyFn = typeof koaBodyModule

type KoaBodyExports = {
  koaBody?: KoaBodyFn
  default?: KoaBodyFn
}

const moduleExports = koaBodyModule as unknown as KoaBodyExports
const resolved = moduleExports.koaBody ?? moduleExports.default

if (typeof resolved !== 'function') {
  throw new Error('Failed to load koa-body middleware')
}

function hasParsedBody(ctx: Context): boolean {
  return ctx.request.body !== undefined || ctx.request.files !== undefined
}

export const koaBody = ((...args: Parameters<KoaBodyFn>) => {
  const middleware = resolved(...args)
  return async (ctx: Context, next: Next): Promise<void> => {
    if (hasParsedBody(ctx)) {
      await next()
      return
    }
    await middleware(ctx, next)
  }
}) as KoaBodyFn
