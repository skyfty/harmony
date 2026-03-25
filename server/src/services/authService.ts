import { Types } from 'mongoose'
import { appConfig } from '@/config/env'
import { PermissionModel } from '@/models/Permission'
import { RoleModel } from '@/models/Role'
import { UserModel } from '@/models/User'
import { signAuthToken } from '@/utils/jwt'
import { hashPassword, verifyPassword } from '@/utils/password'

type PermissionLean = {
  _id: Types.ObjectId
  code: string
  name: string
  group?: string
  description?: string
}

type RoleLean = {
  _id: Types.ObjectId
  name: string
  code: string
  description?: string
  permissions: Types.ObjectId[]
}

type UserLean = {
  _id: Types.ObjectId
  username: string
  password: string
  displayName?: string
  email?: string
  avatarUrl?: string
  status: 'active' | 'disabled'
  roles: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

type AuthPermissionSeed = {
  code: string
  name: string
  group: string
  description?: string
}

type AuthRoleSeed = {
  code: string
  name: string
  description?: string
  permissionCodes: string[]
}

const AUTH_PERMISSION_SEEDS: AuthPermissionSeed[] = [
  {
    code: 'resource:read',
    name: '资源查看',
    group: 'resource',
    description: '允许查看资源列表与资源详情',
  },
  {
    code: 'resource:write',
    name: '资源管理',
    group: 'resource',
    description: '允许上传、更新、删除资源与修改资源分类',
  },
]

const AUTH_ROLE_SEEDS: AuthRoleSeed[] = [
  {
    code: 'editor',
    name: '编辑账号',
    description: '编辑器账号，具备资源读写能力',
    permissionCodes: ['resource:read', 'resource:write'],
  },
]

export interface SessionUserRole {
  id: string
  code: string
  name: string
  description?: string
}

export interface SessionUser {
  id: string
  username: string
  displayName?: string
  email?: string
  avatarUrl?: string | null
  status: 'active' | 'disabled'
  roles: SessionUserRole[]
  createdAt: string
  updatedAt: string
}

export interface AuthSessionResponse {
  token?: string
  user: SessionUser
  permissions: string[]
}

function mapSessionUser(user: UserLean): SessionUser {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName ?? undefined,
    email: user.email ?? undefined,
    avatarUrl: user.avatarUrl ?? null,
    status: user.status,
    roles: [],
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

async function resolveRoleDetails(roleIds: Types.ObjectId[]): Promise<SessionUserRole[]> {
  if (!roleIds.length) {
    return []
  }
  const roles = (await RoleModel.find({ _id: { $in: roleIds } }).lean().exec()) as RoleLean[]
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

  const roles = (await RoleModel.find({ _id: { $in: roleIds } }).lean().exec()) as RoleLean[]
  const permissionIds = new Set<string>()
  roles.forEach((role) => {
    role.permissions.forEach((permissionId) => {
      permissionIds.add(permissionId.toString())
    })
  })

  if (!permissionIds.size) {
    return []
  }

  const permissions = (await PermissionModel.find({ _id: { $in: Array.from(permissionIds) } })
    .lean()
    .exec()) as PermissionLean[]
  return Array.from(new Set(permissions.map((permission) => permission.code)))
}

async function ensurePermissionsSeeded(): Promise<void> {
  for (const permissionSeed of AUTH_PERMISSION_SEEDS) {
    const existing = await PermissionModel.findOne({ code: permissionSeed.code }).exec()
    if (!existing) {
      await PermissionModel.create({
        code: permissionSeed.code,
        name: permissionSeed.name,
        group: permissionSeed.group,
        description: permissionSeed.description,
      })
      continue
    }

    let changed = false
    if (existing.name !== permissionSeed.name) {
      existing.name = permissionSeed.name
      changed = true
    }
    if (existing.group !== permissionSeed.group) {
      existing.group = permissionSeed.group
      changed = true
    }
    if ((existing.description ?? undefined) !== (permissionSeed.description ?? undefined)) {
      existing.description = permissionSeed.description
      changed = true
    }

    if (changed) {
      await existing.save()
    }
  }
}

async function ensureRolesSeeded(): Promise<void> {
  const permissionList = (await PermissionModel.find({
    code: { $in: AUTH_PERMISSION_SEEDS.map((item) => item.code) },
  })
    .lean()
    .exec()) as PermissionLean[]
  const permissionByCode = new Map(permissionList.map((permission) => [permission.code, permission]))

  for (const roleSeed of AUTH_ROLE_SEEDS) {
    const permissionIds = roleSeed.permissionCodes
      .map((code) => permissionByCode.get(code)?._id)
      .filter((value): value is Types.ObjectId => Boolean(value))

    if (!permissionIds.length) {
      continue
    }

    const existing = await RoleModel.findOne({ code: roleSeed.code }).exec()
    if (!existing) {
      await RoleModel.create({
        code: roleSeed.code,
        name: roleSeed.name,
        description: roleSeed.description,
        permissions: permissionIds,
      })
      continue
    }

    const existingPermissionSet = new Set(existing.permissions.map((item) => item.toString()))
    const targetPermissionSet = new Set(permissionIds.map((item) => item.toString()))
    const permissionsChanged =
      existingPermissionSet.size !== targetPermissionSet.size ||
      Array.from(targetPermissionSet).some((item) => !existingPermissionSet.has(item))

    let changed = false
    if (existing.name !== roleSeed.name) {
      existing.name = roleSeed.name
      changed = true
    }
    if ((existing.description ?? undefined) !== (roleSeed.description ?? undefined)) {
      existing.description = roleSeed.description
      changed = true
    }
    if (permissionsChanged) {
      existing.permissions = permissionIds
      changed = true
    }

    if (changed) {
      await existing.save()
    }
  }
}

async function resolveRoleIdsByCodes(codes: string[]): Promise<Types.ObjectId[]> {
  if (!codes.length) {
    return []
  }
  const roles = (await RoleModel.find({ code: { $in: codes } }).lean().exec()) as RoleLean[]
  return roles.map((role) => role._id)
}

async function ensureNamedUser(input: {
  username: string
  password: string
  displayName: string
  roleCodes: string[]
}): Promise<void> {
  const username = input.username.trim()
  if (!username || !input.password) {
    return
  }

  const roleIds = await resolveRoleIdsByCodes(input.roleCodes)
  const existing = await UserModel.findOne({ username }).exec()
  if (!existing) {
    await UserModel.create({
      username,
      password: await hashPassword(input.password),
      displayName: input.displayName || username,
      status: 'active',
      roles: roleIds,
    })
    return
  }

  let changed = false
  if (!existing.password) {
    existing.password = await hashPassword(input.password)
    changed = true
  } else {
    const matched = await verifyPassword(input.password, existing.password)
    if (!matched) {
      existing.password = await hashPassword(input.password)
      changed = true
    }
  }

  if (existing.status !== 'active') {
    existing.status = 'active'
    changed = true
  }

  if (input.displayName && existing.displayName !== input.displayName) {
    existing.displayName = input.displayName
    changed = true
  }

  const existingRoleSet = new Set((existing.roles ?? []).map((roleId) => roleId.toString()))
  const targetRoleSet = new Set(roleIds.map((roleId) => roleId.toString()))
  const rolesChanged =
    existingRoleSet.size !== targetRoleSet.size || Array.from(targetRoleSet).some((id) => !existingRoleSet.has(id))

  if (rolesChanged) {
    existing.roles = roleIds
    changed = true
  }

  if (changed) {
    await existing.save()
  }
}

export async function ensureEditorAuthBootstrap(): Promise<void> {
  await ensurePermissionsSeeded()
  await ensureRolesSeeded()

  await ensureNamedUser({
    username: appConfig.editorUser.username,
    password: appConfig.editorUser.password,
    displayName: appConfig.editorUser.displayName,
    roleCodes: ['editor'],
  })

}

export async function loginWithPassword(username: string, password: string): Promise<AuthSessionResponse> {
  const safeUsername = username.trim()
  const user = await UserModel.findOne({ username: safeUsername }).lean<UserLean>().exec()
  if (!user) {
    throw new Error('Invalid credentials')
  }
  if (user.status !== 'active') {
    throw new Error('Account disabled')
  }

  const ok = await verifyPassword(password, user.password)
  if (!ok) {
    throw new Error('Invalid credentials')
  }

  const roleIds = user.roles as Types.ObjectId[]
  const [roles, permissions] = await Promise.all([resolveRoleDetails(roleIds), resolvePermissionCodes(roleIds)])

  const sessionUser = mapSessionUser(user)
  sessionUser.roles = roles

  const token = signAuthToken({
    sub: sessionUser.id,
    username: sessionUser.username,
    roles: roles.map((role) => role.code),
    permissions,
    accountType: 'user',
  })

  return {
    token,
    user: sessionUser,
    permissions,
  }
}

export async function getProfile(userId: string): Promise<AuthSessionResponse> {
  const user = await UserModel.findById(userId).lean<UserLean>().exec()
  if (!user) {
    throw new Error('User not found')
  }

  const roleIds = user.roles as Types.ObjectId[]
  const [roles, permissions] = await Promise.all([resolveRoleDetails(roleIds), resolvePermissionCodes(roleIds)])

  const sessionUser = mapSessionUser(user)
  sessionUser.roles = roles

  return {
    user: sessionUser,
    permissions,
  }
}