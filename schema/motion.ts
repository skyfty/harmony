export { createPhysicsAwareAutoTourVehicleInstances, resolveAutoTourReferenceWorldPosition, resolveVehicleOrObjectWorldPosition, startTourAndFollow, stopTourAndUnfollow } from './autoTourHelpers'
export { createAutoTourRuntime } from './autoTourRuntime'
export type { AutoTourRuntime, AutoTourRuntimeDeps, AutoTourRouteSnapResult, AutoTourVehicleInstanceLike } from './autoTourRuntime'
export { AutoTourCameraAvoidanceController } from './autoTourCameraAvoidanceController'
export { CharacterAutoTourRuntimeManager } from './characterAutoTourRuntime'
export type {
  CharacterAutoTourInputState,
  CharacterAutoTourRuntimeEntry,
  CharacterAutoTourRuntimeHost,
} from './characterAutoTourRuntime'
export { syncAutoTourActiveNodesFromRuntime, resolveAutoTourFollowNodeId } from './autoTourSync'
export { createBridgeVehicleProxy } from './bridgeVehicleProxy'
export {
  FollowCameraController,
  DEFAULT_BACK_FOLLOW_CAMERA_DISTANCE_SCALE,
  DEFAULT_BACK_FOLLOW_CAMERA_TUNING,
  createBackFollowCameraTuning,
  computeFollowLerpAlpha,
  computeFollowPlacement,
  createCameraFollowState,
  createFollowCameraMotionState,
  getApproxDimensions,
  resolveBackFollowCameraLocalOffset,
  updateBackFollowCamera,
  resetCameraFollowState,
  resetFollowCameraMotionState,
  updateMotionAwareFollowCamera,
} from './followCameraController'
export type { FollowCameraMotionState } from './followCameraController'
export { holdVehicleBrakeSafe, updateVehicleSpeedAndApplyParkingHoldSafe, VEHICLE_PARKED_SPEED_EPSILON, VEHICLE_PARKING_HOLD_SPEED_EPSILON, applyPurePursuitVehicleControl, applyPurePursuitVehicleControlSafe } from './purePursuitRuntime'
export { createControlledNodeMotionRuntime, ControlledNodeMotionRuntime } from './controlledNodeMotionRuntime'
export type { ControlledNodeMotionTelemetry, ControlledNodeMotionSampleInput } from './controlledNodeMotionRuntime'
export * from './physicsBridgeVehicleInputSync'
export * from './polylineProgress'
export * from './pathFollowCommon'
export { VehicleDriveController } from './VehicleDriveController'
export type {
  VehicleDriveCameraFollowState,
  VehicleDriveCameraRestoreState,
  VehicleDriveControlFlags,
  VehicleDriveControllerBindings,
  VehicleDriveControllerDeps,
  VehicleDriveInputState,
  VehicleDriveRuntimeState,
  VehicleDriveVehicle,
  VehicleInstance,
  RefLike,
} from './VehicleDriveController'
export * from './vehicleSurfaceSampler'
export * from './characterControlRuntime'
