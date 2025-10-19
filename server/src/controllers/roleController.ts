import type { Context } from 'koa'
import { Types } from 'mongoose'
import { PermissionModel } from '@/models/Permission'
import { RoleModel } from '@/models/Role'

function mapRole(role: any) {
  return {
    id: role._id.toString(),
    name: role.name,
    code: role.code,
    description: role.description ?? null,
    permissions: (role.permissions ?? []).map((permission: any) =>
      typeof permission === 'string' ? permission : permission.code ?? permission._id?.toString(),
    ),
    createdAt: role.createdAt?.toISOString?.() ?? new Date(role.createdAt).toISOString(),
    updatedAt: role.updatedAt?.toISOString?.() ?? new Date(role.updatedAt).toISOString(),
  }
}

export async function listRoles(ctx: Context): Promise<void> {
  const { page = 1, pageSize = 10, keyword } = ctx.query as Record<string, string>
  const filter: Record<string, unknown> = {}
  if (keyword) {
    filter.$or = [{ name: new RegExp(keyword, 'i') }, { code: new RegExp(keyword, 'i') }]
  }
  const pageNumber = Number(page)
  const limit = Number(pageSize)
  const skip = (pageNumber - 1) * limit
  const [roles, total] = await Promise.all([
    RoleModel.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).populate('permissions').lean(),
    RoleModel.countDocuments(filter),
  ])
  ctx.body = {
    data: roles.map(mapRole),
    page: pageNumber,
    pageSize: limit,
    total,
  }
}

export async function getRole(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid role id')
  }
  const role = await RoleModel.findById(id).populate('permissions').lean()
  if (!role) {
    ctx.throw(404, 'Role not found')
  }
  ctx.body = mapRole(role)
}

export async function createRole(ctx: Context): Promise<void> {
  const { name, code, description, permissionIds = [] } = ctx.request.body as Record<string, unknown>
  if (!name || !code) {
    ctx.throw(400, 'Role name and code are required')
  }
  const existing = await RoleModel.findOne({ code })
  if (existing) {
    ctx.throw(409, 'Role code already exists')
  }
  const permissions = Array.isArray(permissionIds) ? permissionIds : []
  const role = await RoleModel.create({ name, code, description, permissions })
  const populated = await RoleModel.findById(role._id).populate('permissions').lean()
  ctx.body = mapRole(populated)
}

export async function updateRole(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid role id')
  }
  const { name, code, description, permissionIds } = ctx.request.body as Record<string, unknown>
  const update: Record<string, unknown> = { name, code, description }
  if (Array.isArray(permissionIds)) {
    update.permissions = permissionIds
  }
  const role = await RoleModel.findByIdAndUpdate(id, update, { new: true }).populate('permissions').lean()
  if (!role) {
    ctx.throw(404, 'Role not found')
  }
  ctx.body = mapRole(role)
}

export async function deleteRole(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid role id')
  }
  await RoleModel.findByIdAndDelete(id)
  ctx.status = 204
}

export async function listPermissionOptions(ctx: Context): Promise<void> {
  const permissions = await PermissionModel.find().sort({ group: 1, name: 1 }).lean<Array<{
    _id: Types.ObjectId
    code: string
    name: string
    group?: string
  }>>()
  ctx.body = permissions.map((permission: { _id: Types.ObjectId; code: string; name: string; group?: string }) => ({
    id: permission._id.toString(),
    code: permission.code,
    name: permission.name,
    group: permission.group ?? null,
  }))
}
