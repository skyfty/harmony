import koaBodyModule from 'koa-body'

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

export const koaBody = resolved as KoaBodyFn
