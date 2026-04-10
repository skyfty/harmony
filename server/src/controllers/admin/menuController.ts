import type { Context } from 'koa'

type MenuRoute = {
  name: string
  path: string
  component: string
  meta: {
    title: string
    icon?: string
    hideInMenu?: boolean
    order?: number
  }
  children?: MenuRoute[]
}

type MenuNode = MenuRoute & {
  requiredPermissions?: string[]
  children?: MenuNode[]
}

function hasAnyPermission(userPermissions: Set<string>, requiredPermissions?: string[]): boolean {
  if (!requiredPermissions?.length) {
    return true
  }
  if (userPermissions.has('admin:super')) {
    return true
  }
  return requiredPermissions.some((permission) => userPermissions.has(permission))
}

function pruneMenuTree(nodes: MenuNode[], userPermissions: Set<string>): MenuRoute[] {
  const output: MenuRoute[] = []

  for (const node of nodes) {
    if (!hasAnyPermission(userPermissions, node.requiredPermissions)) {
      continue
    }

    const children = Array.isArray(node.children) ? pruneMenuTree(node.children as MenuNode[], userPermissions) : undefined
    const nextNode: MenuRoute = {
      name: node.name,
      path: node.path,
      component: node.component,
      meta: node.meta,
      ...(children?.length ? { children } : {}),
    }
    output.push(nextNode)
  }

  return output
}

const BACKEND_MENU_TREE: MenuNode[] = [
  {
    name: 'Scenes',
    path: '/scenes',
    component: '/views/scenes/index.vue',
    requiredPermissions: ['scene:read'],
    meta: { icon: 'lucide:image', title: '场景管理' },
  },
  {
    name: 'SceneSpots',
    path: '/scene-spots',
    component: '/views/scene-spots/index.vue',
    requiredPermissions: ['sceneSpot:read'],
    meta: { icon: 'lucide:map-pinned', title: '景点管理' },
  },
  {
    name: 'Project',
    path: '/projects',
    component: 'BasicLayout',
    requiredPermissions: ['project:read'],
    meta: { icon: 'lucide:folder-kanban', title: '项目管理', order: 11 },
    children: [
      {
        name: 'ProjectIndex',
        path: '/projects',
        component: '/views/user-projects/index.vue',
        requiredPermissions: ['project:read'],
        meta: { icon: 'lucide:folder-kanban', title: '项目管理' },
      },
      {
        name: 'ProjectCategories',
        path: '/projects/categories',
        component: '/views/user-projects/categories.vue',
        requiredPermissions: ['projectCategory:read'],
        meta: { icon: 'lucide:folder-tree', title: '项目分类' },
      },
    ],
  },
  {
    name: 'Products',
    path: '/products',
    component: 'BasicLayout',
    requiredPermissions: ['product:read'],
    meta: { icon: 'lucide:shopping-cart', title: '商品管理' },
    children: [
      {
        name: 'ProductsIndex',
        path: '/products',
        component: '/views/products/index.vue',
        requiredPermissions: ['product:read'],
        meta: { icon: 'lucide:shopping-cart', title: '商品管理' },
      },
      {
        name: 'ProductsCategories',
        path: '/products/categories',
        component: '/views/products/categories.vue',
        requiredPermissions: ['product:read'],
        meta: { icon: 'lucide:tag', title: '商品分类' },
      },
    ],
  },
  {
    name: 'Vehicles',
    path: '/vehicles',
    component: 'BasicLayout',
    requiredPermissions: ['vehicle:read'],
    meta: { icon: 'lucide:car', title: '车辆管理' },
    children: [
      {
        name: 'VehiclesIndex',
        path: '/vehicles',
        component: '/views/vehicles/index.vue',
        requiredPermissions: ['vehicle:read'],
        meta: { icon: 'lucide:car', title: '车辆管理' },
      },
      {
        name: 'UserVehicles',
        path: '/vehicles/user-vehicles',
        component: '/views/vehicles/user-vehicles.vue',
        requiredPermissions: ['vehicle:read'],
        meta: { icon: 'lucide:car-front', title: '用户车辆' },
      },
    ],
  },
  {
    name: 'Coupons',
    path: '/coupons',
    component: 'BasicLayout',
    requiredPermissions: ['coupon:read'],
    meta: { icon: 'lucide:ticket', title: '卡券管理' },
    children: [
      {
        name: 'CouponsIndex',
        path: '/coupons',
        component: '/views/coupons/index.vue',
        requiredPermissions: ['coupon:read'],
        meta: { icon: 'lucide:ticket', title: '卡券管理' },
      },
      {
        name: 'UserCoupons',
        path: '/coupons/user-coupons',
        component: '/views/coupons/user-coupons.vue',
        requiredPermissions: ['coupon:read'],
        meta: { icon: 'lucide:ticket-check', title: '用户卡券' },
      },
      {
        name: 'CouponTypes',
        path: '/coupons/types',
        component: '/views/coupons/types.vue',
        requiredPermissions: ['coupon:read'],
        meta: { icon: 'lucide:tags', title: '卡券类型' },
      },
    ],
  },
  {
    name: 'Orders',
    path: '/orders',
    component: 'BasicLayout',
    requiredPermissions: ['order:read'],
    meta: { icon: 'lucide:package', title: '订单管理' },
    children: [
      {
        name: 'OrdersIndex',
        path: '/orders',
        component: '/views/orders/index.vue',
        requiredPermissions: ['order:read'],
        meta: { icon: 'lucide:package', title: '订单管理' },
      },
    ],
  },
  {
    name: 'BusinessOrders',
    path: '/business-orders',
    component: 'BasicLayout',
    requiredPermissions: ['order:read'],
    meta: { icon: 'lucide:briefcase-business', title: '商业管理' },
    children: [
      {
        name: 'BusinessOrdersIndex',
        path: '/business-orders',
        component: '/views/business-orders/index.vue',
        requiredPermissions: ['order:read'],
        meta: { icon: 'lucide:briefcase-business', title: '商业管理' },
      },
    ],
  },
  {
    name: 'Users',
    path: '/users',
    component: '/views/users/index.vue',
    requiredPermissions: ['user:read'],
    meta: { icon: 'lucide:users', title: '用户管理' },
  },
  {
    name: 'Resources',
    path: '/resources',
    component: 'BasicLayout',
    requiredPermissions: ['resource:read'],
    meta: { icon: 'lucide:database', title: '资源管理' },
    children: [
      {
        name: 'ResourcesIndex',
        path: '/resources',
        component: '/views/resources/index.vue',
        requiredPermissions: ['resource:read'],
        meta: { icon: 'lucide:database', title: '资源管理' },
      },
      {
        name: 'ResourcesTags',
        path: '/resources/tags',
        component: '/views/resources/tags.vue',
        requiredPermissions: ['resource:read'],
        meta: { icon: 'lucide:tag', title: '资源标签' },
      },
      {
        name: 'ResourcesSeries',
        path: '/resources/series',
        component: '/views/resources/series.vue',
        requiredPermissions: ['resource:read'],
        meta: { icon: 'lucide:archive', title: '资源系列' },
      },
      {
        name: 'ResourcesCategories',
        path: '/resources/categories',
        component: '/views/resources/categories.vue',
        requiredPermissions: ['category:read'],
        meta: { icon: 'lucide:folder-tree', title: '资源分类' },
      },
    ],
  },
  {
    name: 'LoginLogs',
    path: '/login-logs',
    component: '/views/login-logs/index.vue',
    requiredPermissions: ['auth:read'],
    meta: { icon: 'lucide:log-in', title: '登录日志' },
  },
  {
    name: 'PunchRecords',
    path: '/punch-records',
    component: '/views/punch-records/index.vue',
    requiredPermissions: ['punch:read'],
    meta: { icon: 'lucide:map-pin', title: '打卡记录' },
  },
  {
    name: 'TravelRecords',
    path: '/travel-records',
    component: '/views/travel-records/index.vue',
    requiredPermissions: ['travel:read'],
    meta: { icon: 'lucide:route', title: '游历记录' },
  },
  {
    name: 'Medals',
    path: '/medals',
    component: '/views/medals/index.vue',
    requiredPermissions: ['medal:read'],
    meta: { icon: 'lucide:medal', title: '勋章管理' },
  },
  {
    name: 'System',
    path: '/system',
    component: 'BasicLayout',
    requiredPermissions: ['admin:super'],
    meta: { icon: 'carbon:user-role', title: '系统管理', order: 9999 },
    children: [
      {
        name: 'SystemAdmins',
        path: '/system/admins',
        component: '/views/system/admins/index.vue',
        requiredPermissions: ['admin:super'],
        meta: { icon: 'lucide:user-cog', title: '管理员' },
      },
      {
        name: 'SystemRbac',
        path: '/system/rbac',
        component: '/views/system/roles-permissions/index.vue',
        requiredPermissions: ['admin:super'],
        meta: { icon: 'lucide:shield-check', title: '角色权限' },
      },
    ],
  },
]

export async function listBackendMenus(ctx: Context): Promise<void> {
  const permissions = Array.isArray(ctx.state.adminAuthUser?.permissions)
    ? ctx.state.adminAuthUser.permissions
    : []
  const permissionSet = new Set<string>(permissions)
  const menu = pruneMenuTree(BACKEND_MENU_TREE, permissionSet)
  ctx.body = menu
}
