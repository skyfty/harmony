declare module 'koa-json-error' {
  import type { Middleware } from 'koa'

  export interface JsonErrorOptions {
    format?: (error: unknown, obj: Record<string, unknown>) => Record<string, unknown>
    postFormat?: (error: unknown, obj: Record<string, unknown>) => Record<string, unknown>
  }

  export default function jsonError(options?: JsonErrorOptions): Middleware
}
