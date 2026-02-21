import type { Context } from 'koa'
import { getProfile, loginWithPassword } from '@/services/authService'

export async function login(ctx: Context): Promise<void> {
  const { username, password } = ctx.request.body as { username?: string; password?: string }
  if (!username || !password) {
    ctx.throw(400, 'Username and password are required')
  }
  try {
    const session = await loginWithPassword(username, password)
    ctx.body = session
  } catch {
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