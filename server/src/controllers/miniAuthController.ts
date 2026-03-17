import type { Context } from 'koa'
import path from 'node:path'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import { AppUserModel } from '@/models/AppUser'
import { appConfig } from '@/config/env'
import {
  miniBindPhone,
  miniGetProfile,
  miniLoginWithOpenId,
  miniLoginWithPassword,
  miniRegisterWithPassword,
} from '@/services/miniAuthService'
import { exchangeMiniProgramCode } from '@/services/wechatMiniAuthService'
import { recordLogin } from '@/services/loginAuditService'
import { inferDeviceFromUserAgent, recordAnalyticsEvent } from '@/services/analyticsService'

interface UpdateProfileBody {
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  bio?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
}

type UploadedFilePayload = {
  filepath?: string
  path?: string
  originalFilename?: string | null
  newFilename?: string | null
  mimetype?: string | null
  size?: number
}

type RequestFilesMap = Record<string, unknown> | undefined

const MINI_AVATAR_STORAGE_PREFIX = 'mini-avatars'
const MAX_AVATAR_SIZE = 5 * 1024 * 1024

function sanitizeUploadedFilePayload(value: unknown): UploadedFilePayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const file = value as UploadedFilePayload
  const filepath = file.filepath ?? file.path
  if (!filepath) {
    return null
  }
  return {
    filepath,
    originalFilename: file.originalFilename ?? file.newFilename ?? null,
    newFilename: file.newFilename ?? null,
    mimetype: file.mimetype ?? null,
    size: file.size,
  }
}

function extractUploadedFile(files: RequestFilesMap, field: string): UploadedFilePayload | null {
  if (!files) {
    return null
  }
  const raw = files[field]
  const first = Array.isArray(raw) ? raw[0] : raw
  return sanitizeUploadedFilePayload(first)
}

function normalizeFileKey(input: string): string {
  return input.replace(/\\+/g, '/').replace(/^\/+/, '')
}

function buildPublicUrl(fileKey: string): string {
  const base = appConfig.assetPublicUrl.replace(/\/?$/, '')
  return `${base}/${normalizeFileKey(fileKey)}`
}

function resolveStorageAbsolutePath(fileKey: string): string {
  const root = path.resolve(appConfig.assetStoragePath)
  const absolutePath = path.resolve(root, normalizeFileKey(fileKey))
  if (!absolutePath.startsWith(root)) {
    throw new Error('Invalid file path')
  }
  return absolutePath
}

async function ensureMiniAvatarStorageDir(): Promise<void> {
  const root = path.resolve(appConfig.assetStoragePath)
  await fs.ensureDir(path.join(root, MINI_AVATAR_STORAGE_PREFIX))
}

function inferAvatarFileExtension(file: UploadedFilePayload): string {
  const originalName = typeof file.originalFilename === 'string' ? file.originalFilename.trim() : ''
  const byName = originalName ? path.extname(originalName).toLowerCase() : ''
  if (byName) {
    return byName
  }
  const mimeType = typeof file.mimetype === 'string' ? file.mimetype.toLowerCase() : ''
  if (mimeType === 'image/png') {
    return '.png'
  }
  if (mimeType === 'image/webp') {
    return '.webp'
  }
  return '.jpg'
}

function validateAvatarUpload(file: UploadedFilePayload): void {
  const mimeType = typeof file.mimetype === 'string' ? file.mimetype.trim().toLowerCase() : ''
  if (!mimeType || !mimeType.startsWith('image/')) {
    throw new Error('Avatar must be an image file')
  }
  if (typeof file.size === 'number' && file.size > MAX_AVATAR_SIZE) {
    throw new Error('Avatar exceeds 5MB size limit')
  }
}

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
  const { code, miniAppId, displayName, avatarUrl } = ctx.request.body as {
    code?: string
    miniAppId?: string
    displayName?: string
    avatarUrl?: string
  }
  if (!code) {
    ctx.throw(400, 'code is required')
  }
  try {
    const requestedMiniAppId =
      (typeof miniAppId === 'string' && miniAppId.trim()) ||
      (typeof ctx.get === 'function' ? ctx.get('X-Mini-App-Id') : '') ||
      undefined
    const identity = await exchangeMiniProgramCode(code, requestedMiniAppId)
    const session = await miniLoginWithOpenId({
      miniAppId: identity.miniAppId,
      openId: identity.openId,
      unionId: identity.unionId,
      displayName,
      avatarUrl,
    })
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
      metadata: { openId: identity.openId },
    })
    ctx.body = session
  } catch (error) {
    const requestedMiniAppId =
      (typeof miniAppId === 'string' && miniAppId.trim()) ||
      (typeof ctx.get === 'function' ? ctx.get('X-Mini-App-Id') : '') ||
      undefined
    const safeCodePreview = typeof code === 'string' ? `${code.slice(0, 6)}***` : undefined
    console.error('[mini-wechat-login] failed', {
      error,
      message: error instanceof Error ? error.message : String(error),
      requestedMiniAppId,
      codePreview: safeCodePreview,
      ip: ctx.ip || ctx.request.ip,
      userAgent: ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent'],
    })
    const userAgent = ctx.get?.('User-Agent') ?? ctx.request.headers['user-agent']
    await recordLogin({
      username: code,
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
      metadata: { code },
    })
    ctx.throw(400, error instanceof Error ? error.message : 'Wechat login failed')
  }
}

export async function miniBindWechatPhone(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }

  const { code, miniAppId } = ctx.request.body as {
    code?: string
    miniAppId?: string
  }
  if (!code) {
    ctx.throw(400, 'code is required')
  }

  const requestedMiniAppId =
    (typeof miniAppId === 'string' && miniAppId.trim()) ||
    (typeof ctx.get === 'function' ? ctx.get('X-Mini-App-Id') : '') ||
    ctx.state.miniAuthUser?.miniAppId ||
    undefined

  try {
    ctx.body = await miniBindPhone({
      userId,
      code,
      miniAppId: requestedMiniAppId,
    })
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Bind phone failed')
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

export async function miniUpdateProfile(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
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
    updatePayload.phoneBoundAt = phone.trim() ? new Date() : null
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
  const session = await miniGetProfile(userId)
  ctx.body = session
}

export async function miniUploadAvatar(ctx: Context): Promise<void> {
  const userId = ctx.state.miniAuthUser?.id
  if (!userId) {
    ctx.throw(401, 'Unauthorized')
  }

  const files = (ctx.request as { files?: RequestFilesMap }).files
  const uploadedAvatar = extractUploadedFile(files, 'avatar')
  if (!uploadedAvatar || !uploadedAvatar.filepath) {
    ctx.throw(400, 'avatar file is required')
    return
  }

  const avatar = {
    ...uploadedAvatar,
    filepath: uploadedAvatar.filepath,
  } as UploadedFilePayload & { filepath: string }

  try {
    validateAvatarUpload(avatar)
    await ensureMiniAvatarStorageDir()
    const extension = inferAvatarFileExtension(avatar)
    const fileKey = `${MINI_AVATAR_STORAGE_PREFIX}/${userId}-${nanoid(12)}${extension}`
    const targetPath = resolveStorageAbsolutePath(fileKey)
    await fs.copy(avatar.filepath, targetPath)
    await fs.remove(avatar.filepath).catch(() => undefined)
    ctx.body = {
      avatarUrl: buildPublicUrl(fileKey),
      fileKey,
    }
  } catch (error) {
    ctx.throw(400, error instanceof Error ? error.message : 'Avatar upload failed')
  }
}

export async function miniLogout(ctx: Context): Promise<void> {
  ctx.body = { success: true }
}
