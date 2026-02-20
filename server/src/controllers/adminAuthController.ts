import type { Context } from 'koa'
import { adminGetProfile, adminLoginWithPassword } from '@/services/adminAuthService'

export async function adminLogin(ctx: Context): Promise<void> {
  const { username, password } = ctx.request.body as { username?: string; password?: string }
  if (!username || !password) {
    ctx.throw(400, 'Username and password are required')
  }
  try {
    const session = await adminLoginWithPassword(username, password)
    ctx.body = session
  } catch {
    ctx.throw(401, 'Invalid credentials')
  }
}

export async function adminProfile(ctx: Context): Promise<void> {
  const adminId = ctx.state.adminAuthUser?.id
  if (!adminId) {
    ctx.throw(401, 'Unauthorized')
  }
  const session = await adminGetProfile(adminId)
  ctx.body = session
}

export async function adminLogout(ctx: Context): Promise<void> {
  ctx.body = { success: true }
}
