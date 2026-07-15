import type { Context } from 'koa'
import { Types } from 'mongoose'
import { AppUserModel } from '@/models/AppUser'
import { MiniPlatformIdentityModel } from '@/models/MiniPlatformIdentity'
import { hashPassword } from '@/utils/password'

type AppUserView = {
  _id: { toString(): string }
  miniAppId?: string
  username?: string
  authProvider?: string
  wxOpenId?: string | null
  wxUnionId?: string | null
  email?: string
  displayName?: string
  avatarUrl?: string
  phone?: string
  phoneCountryCode?: string
  phoneBoundAt?: Date | string | null
  bio?: string
  gender?: string | null
  birthDate?: Date | string | null
  lastLoginAt?: Date | string | null
  lastLoginSource?: string
  wechatProfileSyncedAt?: Date | string | null
  wechatIdentitySyncedAt?: Date | string | null
  currentVehicleId?: { toString(): string } | null
  status?: string
  contractStatus?: string
  workShareCount?: number
  exhibitionShareCount?: number
  createdAt?: Date | string
  updatedAt?: Date | string
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null
  if (!date) {
    return null
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function mapAppUser(user: AppUserView, wxOpenId?: string | null) {
  return {
    id: user._id.toString(),
    miniAppId: user.miniAppId ?? null,
    username: user.username ?? null,
    authProvider: user.authProvider ?? null,
    wxOpenId: wxOpenId ?? null,
    wxUnionId: user.wxUnionId ?? null,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    phone: user.phone ?? null,
    phoneCountryCode: user.phoneCountryCode ?? null,
    phoneBoundAt: toIsoString(user.phoneBoundAt),
    bio: user.bio ?? null,
    gender: user.gender ?? null,
    birthDate: toIsoString(user.birthDate),
    lastLoginAt: toIsoString(user.lastLoginAt),
    lastLoginSource: user.lastLoginSource ?? null,
    wechatProfileSyncedAt: toIsoString(user.wechatProfileSyncedAt),
    wechatIdentitySyncedAt: toIsoString(user.wechatIdentitySyncedAt),
    currentVehicleId: user.currentVehicleId?.toString?.() ?? null,
    status: user.status,
    contractStatus: user.contractStatus === 'signed' ? 'signed' : 'unsigned',
    workShareCount: user.workShareCount ?? 0,
    exhibitionShareCount: user.exhibitionShareCount ?? 0,
    createdAt: toIsoString(user.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(user.updatedAt) ?? new Date().toISOString(),
  }
}

async function resolveUserWxOpenIds(users: AppUserView[]): Promise<Map<string, string>> {
  const userIds = users.map((user) => user._id.toString())
  if (!userIds.length) {
    return new Map()
  }

  const identities = await MiniPlatformIdentityModel.find({
    userId: { $in: userIds },
  })
    .sort({ lastLoginAt: -1, updatedAt: -1 })
    .lean()
    .exec()

  const openIdMap = new Map<string, string>()
  for (const identity of identities) {
    const userId = identity.userId?.toString?.()
    const openId = typeof identity.openId === 'string' ? identity.openId.trim() : ''
    if (!userId || !openId || openIdMap.has(userId)) {
      continue
    }
    openIdMap.set(userId, openId)
  }

  return openIdMap
}

export async function listAppUsers(ctx: Context): Promise<void> {
  const { page = 1, pageSize = 10, keyword, status } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> & { $or?: Array<Record<string, unknown>> } = {}
  if (keyword) {
    const identityMatches = await MiniPlatformIdentityModel.find({
      openId: new RegExp(keyword, 'i'),
    })
      .select({ userId: 1 })
      .lean()
      .exec()
    const matchedUserIds = identityMatches
      .map((identity) => identity.userId?.toString?.())
      .filter((userId): userId is string => Boolean(userId))

    filter.$or = [
      { username: new RegExp(keyword, 'i') },
      { email: new RegExp(keyword, 'i') },
      { displayName: new RegExp(keyword, 'i') },
      { phone: new RegExp(keyword, 'i') },
    ]
    if (matchedUserIds.length) {
      filter.$or.push({ _id: { $in: matchedUserIds } })
    }
  }
  if (status) {
    filter.status = status
  }
  const pageNumber = Number(page)
  const limit = Number(pageSize)
  const skip = (pageNumber - 1) * limit
  const [users, total] = await Promise.all([
    AppUserModel.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
    AppUserModel.countDocuments(filter),
  ])
  const openIdMap = await resolveUserWxOpenIds(users as AppUserView[])
  ctx.body = {
    data: (users as AppUserView[]).map((user) => mapAppUser(user, openIdMap.get(user._id.toString()))),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getAppUser(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  const user = await AppUserModel.findById(id).lean()
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  const openIdMap = await resolveUserWxOpenIds([user as AppUserView])
  ctx.body = mapAppUser(user as AppUserView, openIdMap.get(user._id.toString()))
}

export async function createAppUser(ctx: Context): Promise<void> {
  const { username, password, email, displayName, avatarUrl, phone, bio, gender, birthDate, status = 'active', contractStatus = 'unsigned' } = ctx.request.body as Record<string, unknown>
  if (!username || typeof username !== 'string') {
    ctx.throw(400, 'Username is required')
  }
  const safeUsername = username.trim()
  if (!safeUsername) {
    ctx.throw(400, 'Username is required')
  }
  const exists = await AppUserModel.findOne({ username: safeUsername }).lean().exec()
  if (exists) {
    ctx.throw(409, 'Username already exists')
  }

  const payload: Record<string, unknown> = {
    username: safeUsername,
    email,
    displayName,
    avatarUrl,
    phone,
    bio,
    status,
    contractStatus: contractStatus === 'signed' ? 'signed' : 'unsigned',
  }

  if (typeof password === 'string' && password.trim().length) {
    payload.password = await hashPassword(password)
  }
  if (typeof gender === 'string' && ['male', 'female', 'other'].includes(gender)) {
    payload.gender = gender
  }
  if (typeof birthDate === 'string' && birthDate.trim()) {
    const parsed = new Date(birthDate)
    if (!Number.isNaN(parsed.getTime())) {
      payload.birthDate = parsed
    }
  }

  const created = await AppUserModel.create(payload)
  ctx.body = mapAppUser(created)
}

export async function updateAppUser(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  const { username, email, displayName, avatarUrl, phone, bio, gender, birthDate, status, contractStatus } = ctx.request.body as Record<string, unknown>
  const update: Record<string, unknown> = {
    email,
    displayName,
    avatarUrl,
    phone,
    bio,
    status,
  }
  if (typeof username === 'string') {
    const safeUsername = username.trim()
    if (!safeUsername) {
      ctx.throw(400, 'Username is required')
    }
    const exists = await AppUserModel.findOne({ username: safeUsername, _id: { $ne: id } }).lean().exec()
    if (exists) {
      ctx.throw(409, 'Username already exists')
    }
    update.username = safeUsername
  }
  if (typeof contractStatus === 'string' && ['unsigned', 'signed'].includes(contractStatus)) {
    update.contractStatus = contractStatus
  }
  if (typeof gender === 'string' && ['male', 'female', 'other'].includes(gender)) {
    update.gender = gender
  }
  if (typeof birthDate === 'string' && birthDate.trim()) {
    const parsed = new Date(birthDate)
    if (!Number.isNaN(parsed.getTime())) {
      update.birthDate = parsed
    }
  }
  const user = await AppUserModel.findByIdAndUpdate(id, update, { new: true }).lean()
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  ctx.body = mapAppUser(user)
}

export async function deleteAppUser(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  await AppUserModel.findByIdAndDelete(id)
  ctx.status = 200
  ctx.body = {}
}

export async function updateAppUserStatus(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const { status } = ctx.request.body as { status?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  if (!status || !['active', 'disabled'].includes(status)) {
    ctx.throw(400, 'Invalid status value')
  }
  const user = await AppUserModel.findByIdAndUpdate(id, { status }, { new: true }).lean()
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  ctx.body = mapAppUser(user)
}
