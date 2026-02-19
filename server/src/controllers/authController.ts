import type { Context } from 'koa'
import { getProfile, loginWithCredentials } from '@/services/authService'
import { recordLogin } from '@/services/loginAuditService'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }
  return 'login failed'
}

export async function login(ctx: Context): Promise<void> {
  const { username, password } = ctx.request.body as { username?: string; password?: string }
  if (!username || !password) {
    ctx.throw(400, 'Username and password are required')
  }
  try {
    const session = await loginWithCredentials(username, password)
    // record successful login
    await recordLogin({
      userId: session.user.id,
      username: session.user.username,
      action: 'login',
      success: true,
      ip: ctx.ip || ctx.request.ip,
      userAgent: ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent'],
      device: undefined,
    })
    ctx.body = session
  } catch (error) {
    // record failed login attempt
    await recordLogin({
      username,
      action: 'login',
      success: false,
      ip: ctx.ip || ctx.request.ip,
      userAgent: ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent'],
      note: getErrorMessage(error),
    })
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
