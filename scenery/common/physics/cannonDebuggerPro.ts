import * as THREE from 'three'
import type * as CANNON from 'cannon-es'

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

let physicsCannonSubpackageLoadPromise: Promise<void> | null = null

function loadPhysicsCannonSubpackage(): Promise<void> {
  const wxAny = typeof wx !== 'undefined'
    ? (wx as typeof wx & { loadSubpackage?: (options: { name: string; success?: () => void; fail?: (error: unknown) => void }) => { onError?: (callback: (error: unknown) => void) => void } | undefined })
    : null
  if (!wxAny || typeof wxAny.loadSubpackage !== 'function') {
    return Promise.resolve()
  }
  physicsCannonSubpackageLoadPromise ??= new Promise<void>((resolve, reject) => {
    const task = wxAny.loadSubpackage({
      name: 'physics-cannon',
      success: () => resolve(),
      fail: (error: unknown) => reject(error),
    })
    task?.onError?.((error: unknown) => reject(error))
  })
  return physicsCannonSubpackageLoadPromise
}

export async function loadCannonDebuggerPro(): Promise<CannonDebuggerConstructor | null> {
  await loadPhysicsCannonSubpackage()
  const module = await import('@harmony/physics-cannon/debuggerPro')
  return (module as unknown as { loadCannonDebuggerPro?: () => Promise<CannonDebuggerConstructor | null> }).loadCannonDebuggerPro?.() ?? null
}
