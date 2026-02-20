import type { Context } from 'koa'
import { Types } from 'mongoose'
import { AdminModel } from '@/models/Admin'
import { hashPassword } from '@/utils/password'

function mapAdmin(admin: any) {
  return {
    id: admin._id.toString(),
    username: admin.username,
    email: admin.email ?? null,
    displayName: admin.displayName ?? null,
    avatarUrl: admin.avatarUrl ?? null,
    phone: admin.phone ?? null,
    status: admin.status,
    roles: (admin.roles ?? []).map((role: any) => ({
      id: role._id ? role._id.toString() : role.id,
      name: role.name,
      code: role.code,
    })),
    createdAt: admin.createdAt?.toISOString?.() ?? new Date(admin.createdAt).toISOString(),
    updatedAt: admin.updatedAt?.toISOString?.() ?? new Date(admin.updatedAt).toISOString(),
  }
}

export async function listAdminAccounts(ctx: Context): Promise<void> {
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
  const [admins, total] = await Promise.all([
    AdminModel.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).populate('roles').lean(),
    AdminModel.countDocuments(filter),
  ])
  ctx.body = {
    data: admins.map(mapAdmin),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getAdminAccount(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid admin id')
  }
  const admin = await AdminModel.findById(id).populate('roles').lean()
  if (!admin) {
    ctx.throw(404, 'Admin not found')
  }
  ctx.body = mapAdmin(admin)
}

export async function createAdminAccount(ctx: Context): Promise<void> {
  const { username, password, email, displayName, roleIds = [], status = 'active' } = ctx.request.body as Record<string, unknown>
  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    ctx.throw(400, 'Username and password are required')
  }
  const exists = await AdminModel.findOne({ username })
  if (exists) {
    ctx.throw(409, 'Username already exists')
  }
  const hashed = await hashPassword(password)
  const roles = Array.isArray(roleIds) ? roleIds : []
  const admin = await AdminModel.create({
    username,
    password: hashed,
    email,
    displayName,
    status,
    roles,
  })
  const populated = await AdminModel.findById(admin._id).populate('roles').lean()
  ctx.body = mapAdmin(populated)
}

export async function updateAdminAccount(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid admin id')
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
  const admin = await AdminModel.findByIdAndUpdate(id, update, { new: true }).populate('roles').lean()
  if (!admin) {
    ctx.throw(404, 'Admin not found')
  }
  ctx.body = mapAdmin(admin)
}

export async function deleteAdminAccount(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid admin id')
  }
  await AdminModel.findByIdAndDelete(id)
  ctx.status = 200
  ctx.body = {}
}

export async function updateAdminAccountStatus(ctx: Context): Promise<void> {
  const { id } = ctx.params
  const { status } = ctx.request.body as { status?: string }
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid admin id')
  }
  if (!status || !['active', 'disabled'].includes(status)) {
    ctx.throw(400, 'Invalid status value')
  }
  const admin = await AdminModel.findByIdAndUpdate(id, { status }, { new: true }).populate('roles').lean()
  if (!admin) {
    ctx.throw(404, 'Admin not found')
  }
  ctx.body = mapAdmin(admin)
}
