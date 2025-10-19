import Koa from 'koa'
import cors from '@koa/cors'
import logger from 'koa-logger'
import jsonError from 'koa-json-error'
import type { DefaultContext, DefaultState } from 'koa'
import type Router from 'koa-router'
import { appConfig } from '@/config/env'
import { connectDatabase, disconnectDatabase } from '@/config/database'
import { errorHandler } from '@/middleware/errorHandler'
import routes from '@/routes'
import { createInitialAdmin } from '@/services/authService'
import { koaBody } from '@/utils/bodyParser'

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

  registerRoutes(app)

  const server = app.listen(appConfig.port, () => {
    console.log(`Server listening on http://localhost:${appConfig.port}`)
  })

  const shutdown = async () => {
    server.close()
    await disconnectDatabase().catch(() => undefined)
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
