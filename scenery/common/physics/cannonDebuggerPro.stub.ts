import * as THREE from 'three'

type CannonDebuggerLike = {
  update?: () => void
  clear?: () => void
  destroy?: () => void
  setVisible?: (visible: boolean) => void
}

export class CannonEsDebuggerPro implements CannonDebuggerLike {
  constructor(
    _root: THREE.Object3D,
    _world: unknown,
    _color?: THREE.ColorRepresentation,
    _offset?: number,
  ) {}

  update(): void {}

  clear(): void {}

  destroy(): void {}

  setVisible(_visible: boolean): void {}
}

export default CannonEsDebuggerPro
