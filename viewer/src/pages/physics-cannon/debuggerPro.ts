// import type * as CANNON from 'cannon-es'

declare const __HARMONY_SCENERY_CANNON_DEBUGGER_ENABLED__: boolean | undefined

type CannonDebuggerLike = {
  update?: () => void
  clear?: () => void
  destroy?: () => void
  setVisible?: (visible: boolean) => void
}

export type CannonDebuggerConstructor = new (
  root: object,
  world: any,
  color?: string | number,
  offset?: number,
) => CannonDebuggerLike

// type CannonDebuggerModule = {
//   CannonEsDebuggerPro?: CannonDebuggerConstructor
//   default?: CannonDebuggerConstructor
// }

// let cannonDebuggerModulePromise: Promise<CannonDebuggerModule> | null = null

export async function loadCannonDebuggerPro(): Promise<CannonDebuggerConstructor | null> {
  return null
  // if (typeof __HARMONY_SCENERY_CANNON_DEBUGGER_ENABLED__ === 'undefined' || !__HARMONY_SCENERY_CANNON_DEBUGGER_ENABLED__) {
  //   return null
  // }
  // cannonDebuggerModulePromise ??= import('@vladkrutenyuk/cannon-es-debugger-pro') as unknown as Promise<CannonDebuggerModule>
  // const module = await cannonDebuggerModulePromise
  // return module?.CannonEsDebuggerPro ?? module?.default ?? null
}
