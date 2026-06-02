import type {
  PhysicsAddRuntimeBodiesCommand,
  PhysicsBodyTransformCommand,
  PhysicsBodyVelocityCommand,
  PhysicsCharacterInputCommand,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsRemoveRuntimeBodiesCommand,
  PhysicsSceneAsset,
  PhysicsVehicleInputCommand,
} from './types'
import type { PhysicsStepFrame } from './protocol'

export interface PhysicsBridge {
  init(options: PhysicsInitOptions): Promise<PhysicsBridgeInitResult>
  loadScene(asset: PhysicsSceneAsset): Promise<void>
  step(deltaMs: number): Promise<PhysicsStepFrame>
  setBodyTransform(command: PhysicsBodyTransformCommand): Promise<void>
  setBodyVelocity(command: PhysicsBodyVelocityCommand): Promise<void>
  setVehicleInput(command: PhysicsVehicleInputCommand): Promise<void>
  setCharacterInput(command: PhysicsCharacterInputCommand): Promise<void>
  addRuntimeBodies(command: PhysicsAddRuntimeBodiesCommand): Promise<void>
  removeRuntimeBodies(command: PhysicsRemoveRuntimeBodiesCommand): Promise<void>
  raycast(command: PhysicsRaycastCommand): Promise<PhysicsRaycastHit | null>
  disposeScene(): Promise<void>
  destroy(): Promise<void>
}
