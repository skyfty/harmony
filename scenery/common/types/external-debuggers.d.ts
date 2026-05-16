declare module '@vladkrutenyuk/cannon-es-debugger-pro' {
  export class CannonEsDebuggerPro {
    constructor(root: object, world: unknown, color?: unknown, offset?: number)
    update(): void
    clear(): void
    destroy(): void
    setVisible(isVisible: boolean): this
    setColor(color: unknown): this
    setOffset(offset: number): this
  }
}

declare module 'ammo-debug-drawer'
