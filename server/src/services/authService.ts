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
  { code: 'resource:read', name: '资源查看', group: 'resource' },
  { code: 'resource:write', name: '资源管理', group: 'resource' },
  { code: 'category:read', name: '分类查看', group: 'category' },
  { code: 'category:write', name: '分类管理', group: 'category' },
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
  const permissionSet = new Set(permissions)
  if (roles.some((role) => role.code === 'admin')) {
    permissionSet.add('admin:super')
  }
  const sessionUser = buildSessionUser({ ...user, _id: user._id })
  sessionUser.roles = roles
  const token = signAuthToken({
    sub: user._id.toString(),
    username: user.username,
    roles: roles.map((role) => role.code),
    permissions: Array.from(permissionSet),
  })
  return {
    token,
    user: sessionUser,
    permissions: Array.from(permissionSet),
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
  const permissionSet = new Set(permissions)
  if (roles.some((role) => role.code === 'admin')) {
    permissionSet.add('admin:super')
  }
  const sessionUser = buildSessionUser({ ...user, _id: user._id })
  sessionUser.roles = roles
  return {
    user: sessionUser,
    permissions: Array.from(permissionSet),
  }
}

export async function createInitialAdmin(): Promise<void> {
  const existingAdmin = await UserModel.findOne({ username: 'admin' })
  if (existingAdmin) {
    return
  }
  const permission = await PermissionModel.findOne({ code: 'admin:super' })
  const superPermission = permission ?? (await PermissionModel.create({ name: 'Super Admin', code: 'admin:super' }))
  let adminRole = await RoleModel.findOne({ code: 'admin' })
  if (!adminRole) {
    adminRole = await RoleModel.create({
      name: 'Administrator',
      code: 'admin',
      permissions: [superPermission._id],
    })
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
