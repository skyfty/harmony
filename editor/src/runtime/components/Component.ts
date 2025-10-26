import type { Object3D } from 'three'

export interface ComponentRuntimeContext<TProps = Record<string, unknown>> {
  readonly nodeId: string
  readonly componentId: string
  getRuntimeObject(): Object3D | null
  getProps(): Readonly<TProps>
  isEnabled(): boolean
  markDirty(): void
}

export abstract class Component<TProps = Record<string, unknown>> {
  protected readonly context: ComponentRuntimeContext<TProps>

  protected constructor(context: ComponentRuntimeContext<TProps>) {
    this.context = context
  }

  /** Called once when the component instance is created. */
  onInit(): void {}

  /** Called whenever the runtime object reference becomes available or changes. */
  onRuntimeAttached(_object: Object3D | null): void {}

  /** Called after the component props have been updated. */
  onPropsUpdated(_next: Readonly<TProps>, _previous: Readonly<TProps>): void {}

  /** Called when the component's enabled state changes. */
  onEnabledChanged(_enabled: boolean): void {}

  /** Called on every animation frame with the elapsed time in seconds. */
  onUpdate(_deltaTime: number): void {}

  /** Called before the component instance is discarded. */
  onDestroy(): void {}
}
