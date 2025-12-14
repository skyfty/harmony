import '@/utils/cjsCompat'
import Koa from 'koa'
import cors from '@koa/cors'
import logger from 'koa-logger'
import jsonError from 'koa-json-error'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { DefaultContext, DefaultState } from 'koa'
import type Router from 'koa-router'
import { appConfig } from '@/config/env'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { errorHandler } from '@/middleware/errorHandler'
import routes from '@/routes'
import { createInitialAdmin, ensureUploaderUser, ensureMiniProgramTestUser } from '@/services/authService'
import { koaBody } from '@/utils/bodyParser'
import { MultiuserService } from '@/services/multiuserService'

type HarmonyKoa = Koa<DefaultState, DefaultContext>

function registerRoutes(app: HarmonyKoa): void {
  routes.forEach((router: Router) => {
    app.use(router.routes())
    app.use(router.allowedMethods())
  })
}

async function bootstrap(): Promise<void> {
  await connectDatabase()
  await createInitialAdmin()
  await ensureUploaderUser()
  await ensureMiniProgramTestUser()

  const app: HarmonyKoa = new Koa()

  app.use(logger())
  app.use(
    cors({
      origin: (ctx) => ctx.get('Origin') || appConfig.editorPublicUrl,
      credentials: true,
    }),
  )
  app.use(
    jsonError({
      postFormat: (_error: unknown, obj: Record<string, unknown>) => {
        if (appConfig.isDevelopment) {
          return obj
        }
        const message = typeof obj.message === 'string' ? obj.message : 'Internal Server Error'
        return { message }
      },
    }),
  )
  app.use(errorHandler)
  app.use(
    koaBody({
      json: true,
      urlencoded: true,
      multipart: false,
      text: false,
    }),
  )

  const uploadsPrefix = (() => {
    try {
      const url = new URL(appConfig.assetPublicUrl)
      return url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
    } catch {
      return appConfig.assetPublicUrl.startsWith('/') ? appConfig.assetPublicUrl : '/uploads'
    }
  })()
  const uploadsRoot = path.resolve(appConfig.assetStoragePath)

  app.use(async (ctx, next) => {
    if (!ctx.path.startsWith(uploadsPrefix)) {
      return next()
    }

    const relativePath = ctx.path.slice(uploadsPrefix.length).replace(/^\/+/, '')
    if (!relativePath) {
      ctx.status = 404
      return
    }

    let decodedPath = relativePath
    try {
      decodedPath = decodeURIComponent(relativePath)
    } catch (error) {
      console.warn('Failed to decode asset path, falling back to raw path:', error)
    }

    const filePath = path.resolve(uploadsRoot, decodedPath)
    if (!filePath.startsWith(uploadsRoot)) {
      ctx.status = 403
      return
    }

    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        ctx.status = 404
        return
      }

      ctx.type = path.extname(filePath)
      ctx.length = fileStat.size
      ctx.set('Cache-Control', appConfig.isDevelopment ? 'no-store' : 'public, max-age=604800')
      ctx.body = createReadStream(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        ctx.status = 404
      } else {
        console.error('Failed to serve uploaded asset:', error)
        ctx.status = 500
      }
    }
  })

  registerRoutes(app)

  const multiuserService = new MultiuserService(appConfig.multiuserPort)
  multiuserService.start()

  const server = app.listen(appConfig.port, () => {
    console.log(`Server listening on http://localhost:${appConfig.port}`)
  })

  const shutdown = async () => {
    server.close()
    await disconnectDatabase().catch(() => undefined)
    await multiuserService.stop().catch(() => undefined)
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
