import type * as CANNON from 'cannon-es'
import * as THREE from 'three'

type CannonDebuggerLike = {
  update?: () => void
  clear?: () => void
  destroy?: () => void
  setVisible?: (visible: boolean) => void
}

export type CannonDebuggerConstructor = new (
  root: THREE.Object3D,
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
  const promise = cannonDebuggerModulePromise ??= import('@vladkrutenyuk/cannon-es-debugger-pro') as unknown as Promise<CannonDebuggerModule>
  const module = await promise
  return module?.CannonEsDebuggerPro ?? module?.default ?? null
}
