import type { Context } from 'koa'
import { Types } from 'mongoose'
import { AppUserModel } from '@/models/AppUser'
import { hashPassword } from '@/utils/password'

function mapAppUser(user: any) {
  return {
    id: user._id.toString(),
    username: user.username ?? null,
    wxOpenId: user.wxOpenId ?? null,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    phone: user.phone ?? null,
    bio: user.bio ?? null,
    gender: user.gender ?? null,
    birthDate: user.birthDate ? new Date(user.birthDate).toISOString() : null,
    status: user.status,
    workShareCount: user.workShareCount ?? 0,
    exhibitionShareCount: user.exhibitionShareCount ?? 0,
    createdAt: user.createdAt?.toISOString?.() ?? new Date(user.createdAt).toISOString(),
    updatedAt: user.updatedAt?.toISOString?.() ?? new Date(user.updatedAt).toISOString(),
  }
}

export async function listAppUsers(ctx: Context): Promise<void> {
  const { page = 1, pageSize = 10, keyword, status } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.$or = [
      { username: new RegExp(keyword, 'i') },
      { email: new RegExp(keyword, 'i') },
      { displayName: new RegExp(keyword, 'i') },
      { phone: new RegExp(keyword, 'i') },
      { wxOpenId: new RegExp(keyword, 'i') },
    ]
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
  ctx.body = {
    data: users.map(mapAppUser),
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
  ctx.body = mapAppUser(user)
}

export async function createAppUser(ctx: Context): Promise<void> {
  const { username, password, email, displayName, avatarUrl, phone, bio, gender, birthDate, status = 'active' } = ctx.request.body as Record<string, unknown>
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
  const { email, displayName, avatarUrl, phone, bio, gender, birthDate, status } = ctx.request.body as Record<string, unknown>
  const update: Record<string, unknown> = {
    email,
    displayName,
    avatarUrl,
    phone,
    bio,
    status,
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
