import type { Context } from 'koa'
import { Types } from 'mongoose'
import { MenuModel } from '@/models/Menu'

interface MenuNode {
  id: string
  name: string
  icon?: string
  routeName?: string
  order?: number
  permission?: string
  children?: MenuNode[]
}

function buildTree(menus: Array<{
  _id: Types.ObjectId
  name: string
  icon?: string
  routeName?: string
  order?: number
  permission?: string
  parentId?: Types.ObjectId | null
}>): MenuNode[] {
  const map = new Map<string, MenuNode & { parentId: string | null }>()
  menus
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((menu) => {
      map.set(menu._id.toString(), {
        id: menu._id.toString(),
        name: menu.name,
        icon: menu.icon ?? undefined,
        routeName: menu.routeName ?? undefined,
        order: menu.order,
        permission: menu.permission ?? undefined,
        parentId: menu.parentId ? menu.parentId.toString() : null,
        children: [],
      })
    })
  const roots: MenuNode[] = []
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      const parent = map.get(node.parentId)
      parent?.children?.push(node)
    } else {
      roots.push(node)
    }
  })
  const prune = (nodes: MenuNode[]): MenuNode[] =>
    nodes.map((node) => ({
      id: node.id,
      name: node.name,
      icon: node.icon,
      routeName: node.routeName,
      order: node.order,
      permission: node.permission,
      children: node.children?.length ? prune(node.children) : undefined,
    }))
  return prune(roots)
}

export async function listMenus(ctx: Context): Promise<void> {
  const menus = await MenuModel.find().sort({ order: 1 }).lean<Array<{
    _id: Types.ObjectId
    name: string
    icon?: string
    routeName?: string
    order?: number
    permission?: string
    parentId?: Types.ObjectId | null
  }>>()
  ctx.body = buildTree(menus)
}

export async function createMenu(ctx: Context): Promise<void> {
  const { name, icon, routeName, order = 0, permission, parentId } = ctx.request.body as Record<string, unknown>
  if (!name) {
    ctx.throw(400, 'Menu name is required')
  }
  const menu = await MenuModel.create({
    name,
    icon,
    routeName,
    order,
    permission,
    parentId: parentId || null,
  })
  ctx.body = menu
}

export async function updateMenu(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid menu id')
  }
  const { name, icon, routeName, order, permission, parentId } = ctx.request.body as Record<string, unknown>
  const update: Record<string, unknown> = { name, icon, routeName, order, permission }
  if (parentId === undefined) {
    update.parentId = undefined
  } else {
    update.parentId = parentId || null
  }
  const menu = await MenuModel.findByIdAndUpdate(id, update, { new: true }).lean()
  if (!menu) {
    ctx.throw(404, 'Menu not found')
  }
  ctx.body = menu
}

export async function deleteMenu(ctx: Context): Promise<void> {
  const { id } = ctx.params
  if (!Types.ObjectId.isValid(id)) {
    ctx.throw(400, 'Invalid menu id')
  }
  await MenuModel.deleteMany({ $or: [{ _id: id }, { parentId: id }] })
  ctx.status = 204
}
