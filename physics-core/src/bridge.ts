import type {
  PhysicsBodyTransformCommand,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsSceneAsset,
  PhysicsVehicleInputCommand,
} from './types'
import type { PhysicsStepFrame } from './protocol'

export interface PhysicsBridge {
  init(options: PhysicsInitOptions): Promise<PhysicsBridgeInitResult>
  loadScene(asset: PhysicsSceneAsset): Promise<void>
  step(deltaMs: number): Promise<PhysicsStepFrame>
  setBodyTransform(command: PhysicsBodyTransformCommand): Promise<void>
  setVehicleInput(command: PhysicsVehicleInputCommand): Promise<void>
  raycast(command: PhysicsRaycastCommand): Promise<PhysicsRaycastHit | null>
  disposeScene(): Promise<void>
  destroy(): Promise<void>
}
