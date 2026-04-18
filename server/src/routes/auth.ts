import Router from 'koa-router'
import { login, logout, profile } from '@/controllers/authController'
import { UserModel } from '@/models/User'
import { authMiddleware } from '@/middleware/auth'
import { editorSessionService } from '@/services/editorSessionService'
import { verifyAuthToken } from '@/utils/jwt'

const authRouter = new Router({ prefix: '/api/auth' })

authRouter.post('/login', login)
authRouter.get('/profile', authMiddleware, profile)
authRouter.post('/logout', authMiddleware, logout)

authRouter.get('/editor-session/stream', async (ctx) => {
	const token = typeof ctx.query.token === 'string' ? ctx.query.token : ''
	if (!token) {
		ctx.throw(401, 'Unauthorized')
	}

	let payload: ReturnType<typeof verifyAuthToken>
	try {
		payload = verifyAuthToken(token)
	} catch (error) {
		ctx.throw(401, 'Invalid token')
		throw error instanceof Error ? error : new Error('Invalid token')
	}

	if (!payload.roles.includes('editor')) {
		ctx.throw(403, 'Forbidden')
	}

	const user = await UserModel.findById(payload.sub).lean<{ editorSessionId?: string | null }>().exec()
	if (!user || user.editorSessionId !== (payload.editorSessionId ?? null)) {
		ctx.throw(401, 'SESSION_REPLACED')
	}

	ctx.status = 200
	ctx.respond = false
	const response = ctx.res
	response.statusCode = 200
	response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
	response.setHeader('Cache-Control', 'no-cache, no-transform')
	response.setHeader('Connection', 'keep-alive')
	response.setHeader('X-Accel-Buffering', 'no')
	response.flushHeaders?.()

	const dispose = editorSessionService.registerConnection(payload.sub, payload.editorSessionId ?? '', response)
	response.on('close', () => {
		dispose()
	})
	response.on('error', () => {
		dispose()
	})
})

export default authRouter