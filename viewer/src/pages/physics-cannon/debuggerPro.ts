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
  color?: THREE.ColorRepresentation,
  offset?: number,
) => CannonDebuggerLike

type CannonDebuggerModule = {
  CannonEsDebuggerPro?: CannonDebuggerConstructor
  default?: CannonDebuggerConstructor
}

let cannonDebuggerModulePromise: Promise<CannonDebuggerModule> | null = null

export async function loadCannonDebuggerPro(): Promise<CannonDebuggerConstructor | null> {
  cannonDebuggerModulePromise ??= import('@vladkrutenyuk/cannon-es-debugger-pro')
  const module = await cannonDebuggerModulePromise
  return module.CannonEsDebuggerPro ?? module.default ?? null
}
