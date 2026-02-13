import type { Context } from 'koa'
import { Types } from 'mongoose'
import { UserModel } from '@/models/User'
import { hashPassword } from '@/utils/password'

function mapUser(user: any) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    bio: user.bio ?? null,
    status: user.status,
    roles: (user.roles ?? []).map((role: any) => ({
      id: role._id ? role._id.toString() : role.id,
      name: role.name,
      code: role.code,
    })),
    createdAt: user.createdAt?.toISOString?.() ?? new Date(user.createdAt).toISOString(),
    updatedAt: user.updatedAt?.toISOString?.() ?? new Date(user.updatedAt).toISOString(),
  }
}

export async function listUsers(ctx: Context): Promise<void> {
  const { page = 1, pageSize = 10, keyword, status } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.$or = [
      { username: new RegExp(keyword, 'i') },
      { email: new RegExp(keyword, 'i') },
      { displayName: new RegExp(keyword, 'i') },
    ]
  }
  if (status) {
    filter.status = status
  }
  const pageNumber = Number(page)
  const limit = Number(pageSize)
  const skip = (pageNumber - 1) * limit
  const [users, total] = await Promise.all([
    UserModel.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).populate('roles').lean(),
    UserModel.countDocuments(filter),
  ])
  ctx.body = {
    data: users.map(mapUser),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getUser(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  const user = await UserModel.findById(id).populate('roles').lean()
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  ctx.body = mapUser(user)
}

export async function createUser(ctx: Context): Promise<void> {
  const { username, password, email, displayName, roleIds = [], status = 'active' } = ctx.request.body as Record<string, unknown>
  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    ctx.throw(400, 'Username and password are required')
  }
  const exists = await UserModel.findOne({ username })
  if (exists) {
    ctx.throw(409, 'Username already exists')
  }
  const hashed = await hashPassword(password)
  const roles = Array.isArray(roleIds) ? roleIds : []
  const user = await UserModel.create({
    username,
    password: hashed,
    email,
    displayName,
    status,
    roles,
  })
  const populated = await UserModel.findById(user._id).populate('roles').lean()
  ctx.body = mapUser(populated)
}

export async function updateUser(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  const { password, email, displayName, roleIds, status } = ctx.request.body as Record<string, unknown>
  const update: Record<string, unknown> = {
    email,
    displayName,
    status,
  }
  if (Array.isArray(roleIds)) {
    update.roles = roleIds
  }
  if (password && typeof password === 'string' && password.trim().length) {
    update.password = await hashPassword(password)
  }
  const user = await UserModel.findByIdAndUpdate(id, update, { new: true }).populate('roles').lean()
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  ctx.body = mapUser(user)
}

export async function deleteUser(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  await UserModel.findByIdAndDelete(id)
  ctx.status = 204
}

export async function updateUserStatus(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const { status } = ctx.request.body as { status?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid user id')
  }
  if (!status || !['active', 'disabled'].includes(status)) {
    ctx.throw(400, 'Invalid status value')
  }
  const user = await UserModel.findByIdAndUpdate(id, { status }, { new: true }).populate('roles').lean()
  if (!user) {
    ctx.throw(404, 'User not found')
  }
  ctx.body = mapUser(user)
}
