import { Types } from 'mongoose'
import { PermissionModel } from '@/models/Permission'
import { RoleModel } from '@/models/Role'
import { UserModel } from '@/models/User'
import { appConfig } from '@/config/env'
import { hashPassword, verifyPassword } from '@/utils/password'
import { signAuthToken } from '@/utils/jwt'

type RoleLean = {
  _id: Types.ObjectId
  name: string
  code: string
  description?: string
  permissions: Types.ObjectId[]
}

type PermissionLean = {
  _id: Types.ObjectId
  name: string
  code: string
  description?: string
  group?: string
}

type UserLean = {
  _id: Types.ObjectId
  username: string
  password: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: Date
  status: 'active' | 'disabled'
  roles: Types.ObjectId[]
  workShareCount?: number
  exhibitionShareCount?: number
  createdAt: Date
  updatedAt: Date
}

interface SessionUser {
  id: string
  username: string
  displayName?: string
  email?: string
  avatarUrl?: string
  phone?: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
  status: 'active' | 'disabled'
  accountType: 'admin' | 'super' | 'user'
  workShareCount?: number
  exhibitionShareCount?: number
  roles: Array<{
    id: string
    name: string
    code: string
    description?: string
  }>
  createdAt: string
  updatedAt: string
}

export interface AuthSessionResponse {
  token?: string
  user: SessionUser
  permissions: string[]
}

const SUPER_PERMISSION = 'admin:super'
const SUPER_ROLE_CODES = new Set(['admin', 'super'])

const MANAGEMENT_PERMISSION_SEEDS = [
  { code: 'scenic:read', name: '景区查看', group: 'scenic' },
  { code: 'scenic:write', name: '景区管理', group: 'scenic' },
  { code: 'product:read', name: '道具查看', group: 'product' },
  { code: 'product:write', name: '道具管理', group: 'product' },
  { code: 'coupon:read', name: '卡券查看', group: 'coupon' },
  { code: 'coupon:write', name: '卡券管理', group: 'coupon' },
  { code: 'order:read', name: '订单查看', group: 'order' },
  { code: 'order:write', name: '订单管理', group: 'order' },
  { code: 'user:read', name: '用户查看', group: 'user' },
  { code: 'user:write', name: '用户管理', group: 'user' },
  { code: 'role:read', name: '角色查看', group: 'role' },
  { code: 'role:write', name: '角色管理', group: 'role' },
  { code: 'permission:read', name: '权限查看', group: 'permission' },
  { code: 'permission:write', name: '权限管理', group: 'permission' },
  { code: 'resource:read', name: '资源查看', group: 'resource' },
  { code: 'resource:write', name: '资源管理', group: 'resource' },
  { code: 'category:read', name: '分类查看', group: 'category' },
  { code: 'category:write', name: '分类管理', group: 'category' },
  { code: 'project:read', name: '项目查看', group: 'project' },
  { code: 'project:write', name: '项目管理', group: 'project' },
  { code: 'projectCategory:read', name: '项目分类查看', group: 'projectCategory' },
  { code: 'projectCategory:write', name: '项目分类管理', group: 'projectCategory' },
  { code: 'auth:read', name: '登录日志查看', group: 'auth' },
  { code: 'auth:delete', name: '登录日志删除', group: 'auth' },
  { code: 'auth:export', name: '登录日志导出', group: 'auth' },
] as const

async function resolveRoleDetails(roleIds: Types.ObjectId[]): Promise<SessionUser['roles']> {
  if (!roleIds.length) {
    return []
  }
  const roles = (await RoleModel.find({ _id: { $in: roleIds } }).lean().exec()) as RoleLean[]
  return roles.map((role) => ({
    id: role._id.toString(),
    name: role.name,
    code: role.code,
    description: role.description ?? undefined,
  }))
}

async function resolvePermissionCodes(roleIds: Types.ObjectId[]): Promise<string[]> {
  if (!roleIds.length) {
    return []
  }
  const roles = (await RoleModel.find({ _id: { $in: roleIds } }).lean().exec()) as RoleLean[]
  const permissionIds = new Set<string>()
  roles.forEach((role) => {
    role.permissions.forEach((permission) => {
      permissionIds.add(permission.toString())
    })
  })
  if (!permissionIds.size) {
    return []
  }
  const permissions = (await PermissionModel.find({ _id: { $in: Array.from(permissionIds) } }).lean().exec()) as PermissionLean[]
  return permissions.map((permission) => permission.code)
}

function deriveAccountType(roles: SessionUser['roles']): SessionUser['accountType'] {
  if (roles.some((role) => role.code === 'super')) {
    return 'super'
  }
  if (roles.some((role) => role.code === 'admin')) {
    return 'admin'
  }
  return 'user'
}

function mergePermissions(roles: SessionUser['roles'], permissions: string[]): string[] {
  const permissionSet = new Set(permissions)
  if (roles.some((role) => SUPER_ROLE_CODES.has(role.code))) {
    permissionSet.add(SUPER_PERMISSION)
  }
  return Array.from(permissionSet)
}

function buildSessionUser(user: UserLean): SessionUser {
  if (!user) {
    throw new Error('User not found')
  }
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName ?? undefined,
    email: user.email ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    phone: user.phone ?? undefined,
    gender: user.gender ?? undefined,
    birthDate: user.birthDate?.toISOString() ?? undefined,
    status: user.status,
    accountType: 'user',
    workShareCount: user.workShareCount ?? 0,
    exhibitionShareCount: user.exhibitionShareCount ?? 0,
    roles: [],
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

export async function loginWithCredentials(username: string, password: string): Promise<AuthSessionResponse> {
  const user = await UserModel.findOne({ username }).lean<UserLean>()
  if (!user) {
    throw new Error('Invalid credentials')
  }
  if (user.status === 'disabled') {
    throw new Error('Account disabled')
  }
  const passwordOk = await verifyPassword(password, user.password)
  if (!passwordOk) {
    throw new Error('Invalid credentials')
  }
  const roleIds = user.roles as Types.ObjectId[]
  const [roles, permissions] = await Promise.all([
    resolveRoleDetails(roleIds),
    resolvePermissionCodes(roleIds),
  ])
  const mergedPermissions = mergePermissions(roles, permissions)
  const sessionUser = buildSessionUser({ ...user, _id: user._id })
  sessionUser.roles = roles
  sessionUser.accountType = deriveAccountType(roles)
  const token = signAuthToken({
    sub: user._id.toString(),
    username: user.username,
    roles: roles.map((role) => role.code),
    permissions: mergedPermissions,
    accountType: sessionUser.accountType,
  })
  return {
    token,
    user: sessionUser,
    permissions: mergedPermissions,
  }
}

export async function getProfile(userId: string): Promise<AuthSessionResponse> {
  const user = await UserModel.findById(userId).lean<UserLean>()
  if (!user) {
    throw new Error('User not found')
  }
  const roleIds = user.roles as Types.ObjectId[]
  const [roles, permissions] = await Promise.all([
    resolveRoleDetails(roleIds),
    resolvePermissionCodes(roleIds),
  ])
  const mergedPermissions = mergePermissions(roles, permissions)
  const sessionUser = buildSessionUser({ ...user, _id: user._id })
  sessionUser.roles = roles
  sessionUser.accountType = deriveAccountType(roles)
  return {
    user: sessionUser,
    permissions: mergedPermissions,
  }
}

export async function createInitialAdmin(): Promise<void> {
  const permission = await PermissionModel.findOne({ code: SUPER_PERMISSION })
  const superPermission = permission ?? (await PermissionModel.create({ name: 'Super Admin', code: 'admin:super' }))
  let adminRole = await RoleModel.findOne({ code: 'admin' })
  if (!adminRole) {
    adminRole = await RoleModel.create({
      name: 'Administrator',
      code: 'admin',
      permissions: [superPermission._id],
    })
  }
  const existingSuperRole = await RoleModel.findOne({ code: 'super' })
  if (!existingSuperRole) {
    await RoleModel.create({
      name: 'Super Administrator',
      code: 'super',
      permissions: [superPermission._id],
    })
  }
  const existingAdmin = await UserModel.findOne({ username: 'admin' })
  if (existingAdmin) {
    return
  }
  const hashed = await hashPassword('admin123')
  await UserModel.create({
    username: 'admin',
    password: hashed,
    status: 'active',
    roles: [adminRole._id],
    displayName: '系统管理员',
  })
}

export async function ensureManagementPermissions(): Promise<void> {
  for (const seed of MANAGEMENT_PERMISSION_SEEDS) {
    const exists = await PermissionModel.findOne({ code: seed.code }).exec()
    if (exists) {
      if (exists.name !== seed.name || exists.group !== seed.group) {
        exists.name = seed.name
        exists.group = seed.group
        await exists.save()
      }
      continue
    }
    await PermissionModel.create({
      code: seed.code,
      name: seed.name,
      group: seed.group,
      description: `${seed.name}权限`,
    })
  }
}

async function ensureUserWithCredentials(credentials: {
  username?: string | null
  password?: string | null
  displayName?: string | null
}): Promise<void> {
  const { username, password, displayName } = credentials
  if (!username || !password) {
    return
  }

  const existing = await UserModel.findOne({ username }).exec()
  if (!existing) {
    const hashed = await hashPassword(password)
    await UserModel.create({
      username,
      password: hashed,
      status: 'active',
      displayName: displayName || username,
    })
    return
  }

  let shouldSave = false

  const passwordMatches = await verifyPassword(password, existing.password)
  if (!passwordMatches) {
    existing.password = await hashPassword(password)
    shouldSave = true
  }

  if (existing.status !== 'active') {
    existing.status = 'active'
    shouldSave = true
  }

  if (displayName && existing.displayName !== displayName) {
    existing.displayName = displayName
    shouldSave = true
  }

  if (shouldSave) {
    await existing.save()
  }
}

export async function ensureEditorUser(): Promise<void> {
  await ensureUserWithCredentials(appConfig.editorUser)
}

export async function ensureUploaderUser(): Promise<void> {
  await ensureUserWithCredentials(appConfig.uploaderUser)
}

export async function ensureMiniProgramTestUser(): Promise<void> {
  await ensureUserWithCredentials(appConfig.miniProgramTestUser)
}
