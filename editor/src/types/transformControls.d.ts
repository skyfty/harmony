declare module '@/utils/transformControls.js' {
  import type { Camera, Event, Object3D, Object3DEventMap } from 'three'

  export type TransformControlMode = 'translate' | 'rotate' | 'scale' | 'transform'
  export type TransformControlFamily = 'translate' | 'rotate' | 'scale'

  type TransformControlsEventMap = Object3DEventMap & {
    change: Event
    mouseDown: Event & { pointerInfo?: unknown }
    mouseUp: Event & { pointerInfo?: unknown }
    objectChange: Event & { target?: Object3D }
    'dragging-changed': Event & { value: boolean }
  }

  export class TransformControls extends Object3D<TransformControlsEventMap> {
    object: Object3D | undefined
    axis: string | null
    dragging: boolean
    camera: Camera
    enabled: boolean

    constructor(camera: Camera, domElement?: HTMLElement | null)
    attach(object: Object3D): this
    detach(): this
    dispose(): void
    setMode(mode: TransformControlMode): void
    getMode(): TransformControlMode
    /** Handle family currently being dragged (`transform` mode resolves to the picked family). */
    getInteractionMode(): TransformControlFamily
    /** Restricts which handle families the combined `transform` mode renders. */
    setTransformFamilies(families: TransformControlFamily[]): void
    setSpace(space: 'world' | 'local'): void
    getHelper(): Object3D
  }
}
