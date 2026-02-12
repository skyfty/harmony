import type { Context, Next } from 'koa'

const SUPER_PERMISSION = 'admin:super'

function getPermissionSet(ctx: Context): Set<string> {
  const permissions = ctx.state.user?.permissions ?? []
  return new Set(Array.isArray(permissions) ? permissions : [])
}

export function hasPermission(ctx: Context, permission: string): boolean {
  const set = getPermissionSet(ctx)
  return set.has(SUPER_PERMISSION) || set.has(permission)
}

export function requireAnyPermission(requiredPermissions: string[]) {
  const normalized = requiredPermissions.filter((item) => typeof item === 'string' && item.trim().length > 0)
  return async (ctx: Context, next: Next): Promise<void> => {
    if (!normalized.length) {
      await next()
      return
    }
    const set = getPermissionSet(ctx)
    if (set.has(SUPER_PERMISSION) || normalized.some((permission) => set.has(permission))) {
      await next()
      return
    }
    ctx.throw(403, 'Forbidden')
  }
}

export function requireAllPermissions(requiredPermissions: string[]) {
  const normalized = requiredPermissions.filter((item) => typeof item === 'string' && item.trim().length > 0)
  return async (ctx: Context, next: Next): Promise<void> => {
    if (!normalized.length) {
      await next()
      return
    }
    const set = getPermissionSet(ctx)
    if (set.has(SUPER_PERMISSION) || normalized.every((permission) => set.has(permission))) {
      await next()
      return
    }
    ctx.throw(403, 'Forbidden')
  }
}
