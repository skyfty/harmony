import type { Context } from 'koa'
import {
  miniGetProfile,
  miniLoginWithOpenId,
  miniLoginWithPassword,
  miniRegisterWithPassword,
} from '@/services/miniAuthService'
import { recordLogin } from '@/services/loginAuditService'
import { inferDeviceFromUserAgent, recordAnalyticsEvent } from '@/services/analyticsService'

export async function miniRegister(ctx: Context): Promise<void> {
  const { username, password, displayName, email, phone } = ctx.request.body as {
    username?: string
    password?: string
    displayName?: string
    email?: string
    phone?: string
  }
  if (!username || !password) {
    ctx.throw(400, 'Username and password are required')
  }
  try {
    const session = await miniRegisterWithPassword({ username, password, displayName, email, phone })
    const userAgent = ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent']
    await recordLogin({
      userId: session.user.id,
      username: session.user.username,
      action: 'login',
      success: true,
      ip: ctx.ip || ctx.request.ip,
      userAgent,
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
    })
    await recordAnalyticsEvent({
      eventType: 'login_success',
      userId: session.user.id,
      source: 'mini-auth',
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      path: '/mini-auth/register',
      metadata: { username: session.user.username },
    })
    ctx.status = 201
    ctx.body = session
  } catch (error) {
    if (error instanceof Error && error.message === 'Username already exists') {
      ctx.throw(409, 'Username already exists')
    }
    ctx.throw(400, 'Register failed')
  }
}

export async function miniLogin(ctx: Context): Promise<void> {
  const { username, password } = ctx.request.body as { username?: string; password?: string }
  if (!username || !password) {
    ctx.throw(400, 'Username and password are required')
  }
  try {
    const session = await miniLoginWithPassword(username, password)
    const userAgent = ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent']
    await recordLogin({
      userId: session.user.id,
      username: session.user.username,
      action: 'login',
      success: true,
      ip: ctx.ip || ctx.request.ip,
      userAgent,
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
    })
    await recordAnalyticsEvent({
      eventType: 'login_success',
      userId: session.user.id,
      source: 'mini-auth',
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      path: '/mini-auth/login',
      metadata: { username: session.user.username },
    })
    ctx.body = session
  } catch {
    const userAgent = ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent']
    await recordLogin({
      username,
      action: 'login',
      success: false,
      ip: ctx.ip || ctx.request.ip,
      userAgent,
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      note: 'mini-auth login failed',
    })
    await recordAnalyticsEvent({
      eventType: 'login_fail',
      source: 'mini-auth',
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      path: '/mini-auth/login',
      metadata: { username },
    })
    ctx.throw(401, 'Invalid credentials')
  }
}

export async function miniWechatLogin(ctx: Context): Promise<void> {
  const { openId, displayName, avatarUrl } = ctx.request.body as {
    openId?: string
    displayName?: string
    avatarUrl?: string
  }
  if (!openId) {
    ctx.throw(400, 'openId is required')
  }
  try {
    const session = await miniLoginWithOpenId({ openId, displayName, avatarUrl })
    const userAgent = ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent']
    await recordLogin({
      userId: session.user.id,
      username: session.user.username,
      action: 'login',
      success: true,
      ip: ctx.ip || ctx.request.ip,
      userAgent,
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      note: 'wechat login',
    })
    await recordAnalyticsEvent({
      eventType: 'login_success',
      userId: session.user.id,
      source: 'mini-auth-wechat',
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      path: '/mini-auth/wechat-login',
      metadata: { openId },
    })
    ctx.body = session
  } catch {
    const userAgent = ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent']
    await recordLogin({
      username: openId,
      action: 'login',
      success: false,
      ip: ctx.ip || ctx.request.ip,
      userAgent,
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      note: 'wechat login failed',
    })
    await recordAnalyticsEvent({
      eventType: 'login_fail',
      source: 'mini-auth-wechat',
      device: inferDeviceFromUserAgent(typeof userAgent === 'string' ? userAgent : undefined),
      path: '/mini-auth/wechat-login',
      metadata: { openId },
    })
    ctx.throw(400, 'Wechat login failed')
  }
}

export async function miniProfile(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  const session = await miniGetProfile(userId)
  ctx.body = session
}

export async function miniLogout(ctx: Context): Promise<void> {
  ctx.body = { success: true }
}
