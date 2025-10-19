import type { Context } from 'koa'
import { Types } from 'mongoose'
import { PermissionModel } from '@/models/Permission'

function mapPermission(permission: any) {
  return {
    id: permission._id.toString(),
    name: permission.name,
    code: permission.code,
    description: permission.description ?? null,
    group: permission.group ?? null,
    createdAt: permission.createdAt?.toISOString?.() ?? new Date(permission.createdAt).toISOString(),
    updatedAt: permission.updatedAt?.toISOString?.() ?? new Date(permission.updatedAt).toISOString(),
  }
}

export async function listPermissions(ctx: Context): Promise<void> {
  const { page = 1, pageSize = 10, keyword } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.$or = [{ name: new RegExp(keyword, 'i') }, { code: new RegExp(keyword, 'i') }]
  }
  const pageNumber = Number(page)
  const limit = Number(pageSize)
  const skip = (pageNumber - 1) * limit
  const [permissions, total] = await Promise.all([
    PermissionModel.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
    PermissionModel.countDocuments(filter),
  ])
  ctx.body = {
    data: permissions.map(mapPermission),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function createPermission(ctx: Context): Promise<void> {
  const { name, code, description, group } = ctx.request.body as Record<string, unknown>
  if (!name || !code) {
    ctx.throw(400, 'Permission name and code are required')
  }
  const exists = await PermissionModel.findOne({ code })
  if (exists) {
    ctx.throw(409, 'Permission code already exists')
  }
  const permission = await PermissionModel.create({ name, code, description, group })
  ctx.body = mapPermission(permission)
}

export async function updatePermission(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid permission id')
  }
  const { name, code, description, group } = ctx.request.body as Record<string, unknown>
  const permission = await PermissionModel.findByIdAndUpdate(id, { name, code, description, group }, { new: true })
  if (!permission) {
    ctx.throw(404, 'Permission not found')
  }
  ctx.body = mapPermission(permission)
}

export async function deletePermission(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid permission id')
  }
  await PermissionModel.findByIdAndDelete(id)
  ctx.status = 204
}
