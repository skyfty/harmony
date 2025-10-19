import { Types } from 'mongoose'
import { MenuModel } from '@/models/Menu'
import { PermissionModel } from '@/models/Permission'
import { RoleModel } from '@/models/Role'
import { UserModel } from '@/models/User'
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

type MenuLean = {
  _id: Types.ObjectId
  name: string
  icon?: string
  routeName?: string
  order?: number
  permission?: string
  parentId?: Types.ObjectId | null
}

type UserLean = {
  _id: Types.ObjectId
  username: string
  password: string
  displayName?: string
  email?: string
  status: 'active' | 'disabled'
  roles: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

interface MenuNode {
  id: string
  name: string
  icon?: string
  routeName?: string
  order?: number
  permission?: string
  children?: MenuNode[]
}

interface SessionUser {
  id: string
  username: string
  displayName?: string
  email?: string
  status: 'active' | 'disabled'
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
  menus: MenuNode[]
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

function buildMenuTree(
  menus: Array<{
    _id: Types.ObjectId
    name: string
    icon?: string
    routeName?: string
    order?: number
    permission?: string
    parentId?: Types.ObjectId | null
  }>,
): MenuNode[] {
  const nodeMap = new Map<string, MenuNode & { parentId: string | null }>()
  menus
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((menu) => {
      nodeMap.set(menu._id.toString(), {
        id: menu._id.toString(),
        parentId: menu.parentId ? menu.parentId.toString() : null,
        name: menu.name,
        icon: menu.icon ?? undefined,
        routeName: menu.routeName ?? undefined,
        order: menu.order,
        permission: menu.permission ?? undefined,
        children: [],
      })
    })

  const roots: MenuNode[] = []
  nodeMap.forEach((node) => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId)
      parent?.children?.push(node)
    } else {
      roots.push(node)
    }
  })

  const pruneParentId = (nodes: MenuNode[]): MenuNode[] =>
    nodes.map((node) => ({
      id: node.id,
      name: node.name,
      icon: node.icon,
      routeName: node.routeName,
      order: node.order,
      permission: node.permission,
      children: node.children?.length ? pruneParentId(node.children) : undefined,
    }))

  return pruneParentId(roots)
}

async function resolveMenus(): Promise<MenuNode[]> {
  const menus = (await MenuModel.find().lean().exec()) as MenuLean[]
  return buildMenuTree(menus)
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
    status: user.status,
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
  const [roles, permissions, menus] = await Promise.all([
    resolveRoleDetails(roleIds),
    resolvePermissionCodes(roleIds),
    resolveMenus(),
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
    menus,
  }
}

export async function getProfile(userId: string): Promise<AuthSessionResponse> {
  const user = await UserModel.findById(userId).lean<UserLean>()
  if (!user) {
    throw new Error('User not found')
  }
  const roleIds = user.roles as Types.ObjectId[]
  const [roles, permissions, menus] = await Promise.all([
    resolveRoleDetails(roleIds),
    resolvePermissionCodes(roleIds),
    resolveMenus(),
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
    menus,
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
