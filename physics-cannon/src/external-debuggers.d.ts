declare module '@vladkrutenyuk/cannon-es-debugger-pro' {
  const CannonEsDebuggerPro: new (
    root: object,
    world: unknown,
    color?: string | number,
    offset?: number,
  ) => {
    update?: () => void
    clear?: () => void
    destroy?: () => void
    setVisible?: (visible: boolean) => void
  }

  export { CannonEsDebuggerPro }
  export default CannonEsDebuggerPro
}
