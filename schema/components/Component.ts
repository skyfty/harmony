import type { Object3D } from 'three'

export interface ComponentFrameState {
  cameraWorldPosition: { x: number; y: number; z: number } | null
  cameraWorldDirection?: { x: number; y: number; z: number } | null
  /**
   * Host camera is actively being dragged. Components may defer expensive
   * camera-driven streaming/LOD rebuilds while keeping camera-dependent
   * uniforms current.
   */
  cameraInteractionActive?: boolean
  /**
   * Slow Roads 环境状态（季节 × 时间 × 天气）。宿主每帧从
   * EnvironmentSettings.slowroads 注入，proceduralLandscape 等组件据此
   * 选择季节素材与调色板；缺省时组件回退到默认状态。
   */
  environment?: {
    season: 'spring' | 'summer' | 'autumn' | 'winter'
    timeOfDay: 'morning' | 'day' | 'evening' | 'night'
    weather: 'clear' | 'overcast'
  } | null
}

export interface ComponentRuntimeContext<TProps = Record<string, unknown>> {
  readonly nodeId: string
  readonly componentId: string
  getRuntimeObject(): Object3D | null
  getProps(): Readonly<TProps>
  isEnabled(): boolean
  getFrameState(): Readonly<ComponentFrameState>
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
