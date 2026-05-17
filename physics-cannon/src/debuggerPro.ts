import type * as CANNON from 'cannon-es'

type CannonDebuggerLike = {
  update?: () => void
  clear?: () => void
  destroy?: () => void
  setVisible?: (visible: boolean) => void
}

export type CannonDebuggerConstructor = new (
  root: object,
  world: CANNON.World,
  color?: string | number,
  offset?: number,
) => CannonDebuggerLike

type CannonDebuggerModule = {
  CannonEsDebuggerPro?: CannonDebuggerConstructor
  default?: CannonDebuggerConstructor
}

let cannonDebuggerModulePromise: Promise<CannonDebuggerModule> | null = null

export async function loadCannonDebuggerPro(): Promise<CannonDebuggerConstructor | null> {
  cannonDebuggerModulePromise ??= import('@vladkrutenyuk/cannon-es-debugger-pro') as unknown as Promise<CannonDebuggerModule>
  const module = await cannonDebuggerModulePromise
  return module?.CannonEsDebuggerPro ?? module?.default ?? null
}
