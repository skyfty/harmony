import * as THREE from 'three'

type CannonDebuggerLike = {
  update?: () => void
  clear?: () => void
  destroy?: () => void
  setVisible?: (visible: boolean) => void
}

export type CannonDebuggerConstructor = new (
  root: THREE.Object3D,
  world: unknown,
  color?: THREE.ColorRepresentation,
  offset?: number,
) => CannonDebuggerLike

export async function loadCannonDebuggerPro(): Promise<CannonDebuggerConstructor | null> {
  // #ifdef H5
  const module = await import('@vladkrutenyuk/cannon-es-debugger-pro')
  return (module as unknown as { CannonEsDebuggerPro?: CannonDebuggerConstructor; default?: CannonDebuggerConstructor }).CannonEsDebuggerPro
    ?? (module as unknown as { CannonEsDebuggerPro?: CannonDebuggerConstructor; default?: CannonDebuggerConstructor }).default
    ?? null
  // #endif
  return null
}
