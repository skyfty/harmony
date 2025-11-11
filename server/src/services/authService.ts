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

export async function ensureTestUser(): Promise<void> {
  const { username, password, displayName } = appConfig.testUser
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
