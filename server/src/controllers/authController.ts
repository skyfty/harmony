import type { Context } from 'koa'
import { AuthLoginError, getProfile, loginWithPassword } from '@/services/authService'
import { editorSessionService } from '@/services/editorSessionService'

export async function login(ctx: Context): Promise<void> {
  const { username, password } = ctx.request.body as { username?: string; password?: string }
  if (!username || !password) {
    ctx.throw(400, 'Username and password are required')
  }
  try {
    const session = await loginWithPassword(username, password)
    ctx.body = session
  } catch (error) {
    if (error instanceof AuthLoginError) {
      if (error.code === 'LOGIN_REQUEST_REJECTED') {
        ctx.throw(409, 'LOGIN_REQUEST_REJECTED')
      }
      if (error.code === 'LOGIN_REQUEST_TIMEOUT') {
        ctx.throw(408, 'LOGIN_REQUEST_TIMEOUT')
      }
      if (error.code === 'ACCOUNT_DISABLED') {
        ctx.throw(403, 'Account disabled')
      }
    }
    ctx.throw(401, 'Invalid credentials')
  }
}

export async function profile(ctx: Context): Promise<void> {
  const userId = ctx.state.user?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  const session = await getProfile(userId)
  ctx.body = session
}

export async function logout(ctx: Context): Promise<void> {
  ctx.body = { success: true }
}

export async function respondEditorLoginRequest(ctx: Context): Promise<void> {
  const userId = ctx.state.user?.id
  const editorSessionId = ctx.state.user?.editorSessionId
  const roles = ctx.state.user?.roles as string[] | undefined
  if (!userId || !roles?.includes('editor')) {
    ctx.throw(403, 'Forbidden')
  }

  const requestId = ctx.params.requestId
  const { approved } = ctx.request.body as { approved?: boolean }
  if (!requestId || typeof approved !== 'boolean') {
    ctx.throw(400, 'Invalid login request response')
  }

  const handled = editorSessionService.respondLoginRequest({
    requestId,
    userId,
    editorSessionId,
    approved,
  })
  if (!handled) {
    ctx.throw(404, 'LOGIN_REQUEST_NOT_FOUND')
  }

  ctx.body = { success: true }
}
