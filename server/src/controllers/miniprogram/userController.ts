import type { Context } from 'koa'
import { AppUserModel } from '@/models/AppUser'
import {
  miniGetProfile,
  miniLoginWithPassword,
  miniRegisterWithPassword,
} from '@/services/miniAuthService'
import { recordLogin } from '@/services/loginAuditService'

interface RegisterBody {
  username?: string
  password?: string
  displayName?: string
  email?: string
  phone?: string
}

interface UpdateProfileBody {
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  bio?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
}

export async function register(ctx: Context): Promise<void> {
  const body = ctx.request.body as RegisterBody
  const { username, password, displayName, email, phone } = body
  if (typeof username !== 'string' || typeof password !== 'string') {
    ctx.throw(400, 'Username and password are required')
    return
  }
  const safeUsername = username.trim()
  let session: any
  try {
    session = await miniRegisterWithPassword({
      username: safeUsername,
      password,
      displayName,
      email,
      phone,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Username already exists') {
      ctx.throw(409, 'Username already exists')
    }
    ctx.throw(400, 'Register failed')
    return
  }
  // record successful registration-login
  await recordLogin({
    userId: session.user.id,
    username: session.user.username,
    action: 'login',
    success: true,
    ip: ctx.ip || ctx.request.ip,
    userAgent: ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent'],
  })
  ctx.status = 201
  ctx.body = session
}

export async function login(ctx: Context): Promise<void> {
  const { username, password } = ctx.request.body as { username?: string; password?: string }
  if (typeof username !== 'string' || typeof password !== 'string') {
    ctx.throw(400, 'Username and password are required')
    return
  }
  const safeUsername = username.trim()
  let session: any
  try {
    session = await miniLoginWithPassword(safeUsername, password)
  } catch (error) {
    // record failed login attempt for miniprogram
    await recordLogin({
      username: safeUsername,
      action: 'login',
      success: false,
      ip: ctx.ip || ctx.request.ip,
      userAgent: ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent'],
    })
    ctx.throw(401, 'Invalid credentials')
    return
  }
  // record successful login for miniprogram
  await recordLogin({
    userId: session.user.id,
    username: session.user.username,
    action: 'login',
    success: true,
    ip: ctx.ip || ctx.request.ip,
    userAgent: ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent'],
  })
  ctx.body = session
}

export async function getProfile(ctx: Context): Promise<void> {
  const userId = ctx.state.user?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  const profile = await miniGetProfile(userId)
  ctx.body = profile
}

export async function updateProfile(ctx: Context): Promise<void> {
  const userId = ctx.state.user?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }
  const { displayName, email, avatarUrl, phone, bio, gender, birthDate } = ctx.request.body as UpdateProfileBody
  const updatePayload: Record<string, unknown> = {}
  if (typeof displayName === 'string') {
    updatePayload.displayName = displayName
  }
  if (typeof email === 'string') {
    updatePayload.email = email
  }
  if (typeof avatarUrl === 'string') {
    updatePayload.avatarUrl = avatarUrl
  }
  if (typeof phone === 'string') {
    updatePayload.phone = phone
  }
  if (typeof bio === 'string') {
    updatePayload.bio = bio
  }
  if (typeof gender === 'string' && ['male', 'female', 'other'].includes(gender)) {
    updatePayload.gender = gender
  }
  if (typeof birthDate === 'string') {
    const date = new Date(birthDate)
    if (!isNaN(date.getTime())) {
      updatePayload.birthDate = date
    }
  }
  if (!Object.keys(updatePayload).length) {
    ctx.throw(400, 'No profile fields provided')
  }
  const updated = await AppUserModel.findByIdAndUpdate(userId, updatePayload, { new: true }).lean().exec()
  if (!updated) {
    ctx.throw(404, 'User not found')
  }
  const profile = await miniGetProfile(userId)
  ctx.body = profile
}
