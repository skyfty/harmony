import { Types } from 'mongoose'
import { appConfig } from '@/config/env'
import { AdminModel } from '@/models/Admin'
import { AdminPermissionModel } from '@/models/AdminPermission'
import { AdminRoleModel } from '@/models/AdminRole'
import { signAdminAuthToken } from '@/utils/domainJwt'
import { hashPassword, verifyPassword } from '@/utils/password'

type AdminRoleLean = {
  _id: Types.ObjectId
  name: string
  code: string
  description?: string
  permissions: Types.ObjectId[]
}

type AdminPermissionLean = {
  _id: Types.ObjectId
  code: string
}

type AdminLean = {
  _id: Types.ObjectId
  username: string
  password: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  status: 'active' | 'disabled'
  roles: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

const SUPER_PERMISSION = 'admin:super'

const ADMIN_PERMISSION_SEEDS = [
  { code: 'admin:super', name: '超级管理员', group: 'admin' },
  { code: 'auth:read', name: '登录审计查看', group: 'auth' },
  { code: 'auth:delete', name: '登录审计删除', group: 'auth' },
  { code: 'auth:export', name: '登录审计导出', group: 'auth' },
  { code: 'punch:read', name: '打卡记录查看', group: 'scene' },
  { code: 'punch:delete', name: '打卡记录删除', group: 'scene' },
  { code: 'travel:read', name: '游历记录查看', group: 'scene' },
  { code: 'travel:delete', name: '游历记录删除', group: 'scene' },
  { code: 'user:read', name: '用户查看', group: 'user' },
  { code: 'user:write', name: '用户管理', group: 'user' },
  { code: 'order:read', name: '订单查看', group: 'order' },
  { code: 'order:write', name: '订单管理', group: 'order' },
  { code: 'product:read', name: '商品查看', group: 'product' },
  { code: 'product:write', name: '商品管理', group: 'product' },
  { code: 'vehicle:read', name: '车辆查看', group: 'vehicle' },
  { code: 'vehicle:write', name: '车辆管理', group: 'vehicle' },
  { code: 'coupon:read', name: '卡券查看', group: 'coupon' },
  { code: 'coupon:write', name: '卡券管理', group: 'coupon' },
  { code: 'scene:read', name: '场景查看', group: 'scene' },
  { code: 'scene:write', name: '场景管理', group: 'scene' },
  { code: 'sceneSpot:read', name: '点位查看', group: 'scene' },
  { code: 'sceneSpot:write', name: '点位管理', group: 'scene' },
  { code: 'comment:read', name: '留言查看', group: 'scene' },
  { code: 'comment:write', name: '留言管理', group: 'scene' },
  { code: 'resource:read', name: '资源查看', group: 'resource' },
  { code: 'resource:write', name: '资源管理', group: 'resource' },
  { code: 'category:read', name: '资源分类查看', group: 'resource' },
  { code: 'category:write', name: '资源分类管理', group: 'resource' },
  { code: 'project:read', name: '项目查看', group: 'project' },
  { code: 'project:write', name: '项目管理', group: 'project' },
  { code: 'projectCategory:read', name: '项目分类查看', group: 'project' },
  { code: 'projectCategory:write', name: '项目分类管理', group: 'project' },
  { code: 'achievement:read', name: '成就查看', group: 'achievement' },
  { code: 'achievement:write', name: '成就管理', group: 'achievement' },
  { code: 'rule:read', name: '规则查看', group: 'achievement' },
  { code: 'rule:write', name: '规则管理', group: 'achievement' },
  { code: 'medal:read', name: '勋章查看', group: 'achievement' },
  { code: 'medal:write', name: '勋章管理', group: 'achievement' },
] as const

export interface AdminSessionUser {
  id: string
  username: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  status: 'active' | 'disabled'
  roles: Array<{
    id: string
    code: string
    name: string
    description?: string
  }>
  createdAt: string
  updatedAt: string
}

export interface AdminSessionResponse {
  token?: string
  user: AdminSessionUser
  permissions: string[]
}

async function resolveRoleDetails(roleIds: Types.ObjectId[]): Promise<AdminSessionUser['roles']> {
  if (!roleIds.length) {
    return []
  }
  const roles = (await AdminRoleModel.find({ _id: { $in: roleIds } }).lean().exec()) as AdminRoleLean[]
  return roles.map((role) => ({
    id: role._id.toString(),
    code: role.code,
    name: role.name,
    description: role.description ?? undefined,
  }))
}

async function resolvePermissionCodes(roleIds: Types.ObjectId[]): Promise<string[]> {
  if (!roleIds.length) {
    return []
  }
  const roles = (await AdminRoleModel.find({ _id: { $in: roleIds } }).lean().exec()) as AdminRoleLean[]
  const permissionIds = new Set<string>()
  roles.forEach((role) => {
    role.permissions.forEach((permissionId) => {
      permissionIds.add(permissionId.toString())
    })
  })
  if (!permissionIds.size) {
    return []
  }
  const permissions = (await AdminPermissionModel.find({
    _id: { $in: Array.from(permissionIds) },
  })
    .lean()
    .exec()) as AdminPermissionLean[]
  return permissions.map((permission) => permission.code)
}

function mergePermissions(permissions: string[]): string[] {
  const set = new Set(permissions)
  if (permissions.includes(SUPER_PERMISSION)) {
    set.add(SUPER_PERMISSION)
  }
  return Array.from(set)
}

function buildSessionUser(admin: AdminLean): AdminSessionUser {
  return {
    id: admin._id.toString(),
    username: admin.username,
    displayName: admin.displayName ?? undefined,
    email: admin.email ?? undefined,
    avatarUrl: admin.avatarUrl ?? undefined,
    phone: admin.phone ?? undefined,
    status: admin.status,
    roles: [],
    createdAt: admin.createdAt.toISOString(),
    updatedAt: admin.updatedAt.toISOString(),
  }
}

export async function adminLoginWithPassword(username: string, password: string): Promise<AdminSessionResponse> {
  const admin = await AdminModel.findOne({ username }).lean<AdminLean>()
  if (!admin) {
    throw new Error('Invalid credentials')
  }
  if (admin.status !== 'active') {
    throw new Error('Account disabled')
  }
  const ok = await verifyPassword(password, admin.password)
  if (!ok) {
    throw new Error('Invalid credentials')
  }
  const roleIds = admin.roles as Types.ObjectId[]
  const [roles, permissions] = await Promise.all([
    resolveRoleDetails(roleIds),
    resolvePermissionCodes(roleIds),
  ])
  const mergedPermissions = mergePermissions(permissions)
  const sessionUser = buildSessionUser(admin)
  sessionUser.roles = roles
  const token = signAdminAuthToken({
    kind: 'admin',
    sub: sessionUser.id,
    username: sessionUser.username,
    roles: roles.map((role) => role.code),
    permissions: mergedPermissions,
  })
  return {
    token,
    user: sessionUser,
    permissions: mergedPermissions,
  }
}

export async function adminGetProfile(adminId: string): Promise<AdminSessionResponse> {
  const admin = await AdminModel.findById(adminId).lean<AdminLean>()
  if (!admin) {
    throw new Error('Admin not found')
  }
  const roleIds = admin.roles as Types.ObjectId[]
  const [roles, permissions] = await Promise.all([
    resolveRoleDetails(roleIds),
    resolvePermissionCodes(roleIds),
  ])
  const mergedPermissions = mergePermissions(permissions)
  const sessionUser = buildSessionUser(admin)
  sessionUser.roles = roles
  return {
    user: sessionUser,
    permissions: mergedPermissions,
  }
}

export async function ensureAdminPermissionsV2(): Promise<void> {
  for (const permissionSeed of ADMIN_PERMISSION_SEEDS) {
    const existing = await AdminPermissionModel.findOne({ code: permissionSeed.code }).exec()
    if (!existing) {
      await AdminPermissionModel.create({
        code: permissionSeed.code,
        name: permissionSeed.name,
        group: permissionSeed.group,
      })
      continue
    }
    if (existing.name !== permissionSeed.name || existing.group !== permissionSeed.group) {
      existing.name = permissionSeed.name
      existing.group = permissionSeed.group
      await existing.save()
    }
  }
}

export async function createInitialAdminV2(): Promise<void> {
  await ensureAdminPermissionsV2()

  const superPermission = await AdminPermissionModel.findOne({ code: SUPER_PERMISSION }).exec()
  if (!superPermission) {
    throw new Error('Missing admin:super permission')
  }

  const nonSuperPermissions = await AdminPermissionModel.find({ code: { $ne: SUPER_PERMISSION } }).exec()
  const nonSuperPermissionIds = nonSuperPermissions.map((item) => item._id.toString())

  let superRole = await AdminRoleModel.findOne({ code: 'super_admin' }).exec()
  if (!superRole) {
    superRole = await AdminRoleModel.create({
      code: 'super_admin',
      name: '超级管理员',
      permissions: [superPermission._id],
    })
  } else {
    const hasSuperPermission = superRole.permissions.some((permissionId) => permissionId.toString() === superPermission._id.toString())
    if (!hasSuperPermission) {
      superRole.permissions = [superPermission._id]
      await superRole.save()
    }
  }

  let adminRole = await AdminRoleModel.findOne({ code: 'admin' }).exec()
  if (!adminRole) {
    adminRole = await AdminRoleModel.create({
      code: 'admin',
      name: '普通管理员',
      permissions: nonSuperPermissions.map((item) => item._id),
    })
  } else {
    const currentIds = adminRole.permissions.map((permissionId) => permissionId.toString())
    const missingPermissionExists = nonSuperPermissionIds.some((permissionId) => !currentIds.includes(permissionId))
    const hasExtraPermission = currentIds.some((permissionId) => !nonSuperPermissionIds.includes(permissionId))
    if (missingPermissionExists || hasExtraPermission) {
      adminRole.permissions = nonSuperPermissions.map((item) => item._id)
      await adminRole.save()
    }
  }

  const existingAdmin = await AdminModel.findOne({ username: appConfig.adminAuth.seed.username }).exec()
  if (existingAdmin) {
    return
  }

  const hashed = await hashPassword(appConfig.adminAuth.seed.password)
  await AdminModel.create({
    username: appConfig.adminAuth.seed.username,
    password: hashed,
    displayName: appConfig.adminAuth.seed.displayName,
    status: 'active',
    roles: [superRole._id],
  })
}
