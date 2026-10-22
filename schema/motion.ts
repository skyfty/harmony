export { resolveVehicleOrObjectWorldPosition, startTourAndFollow, stopTourAndUnfollow } from './autoTourHelpers'
export { createAutoTourRuntime } from './autoTourRuntime'
export type { AutoTourRuntime, AutoTourRuntimeDeps, AutoTourRouteSnapResult } from './autoTourRuntime'
export { buildGuideRouteTravelWindow } from './guideRouteTourTarget'
export type { GuideRouteTourTargetOptions, GuideRouteTravelWindow } from './guideRouteTourTarget'
export {
  evaluateGuideRoute,
  sampleEvaluatedGuideRouteAtDistance,
  resolveCompiledGuideLegAtDistance,
  resolveGuideRoutePrimaryProviderNodeId,
} from './guideRouteRuntime'
export type {
  CompiledGuideLeg,
  CompiledGuideStop,
  CompiledGuideTransition,
  EvaluatedGuideRoute,
  EvaluatedGuideRouteStatus,
} from './guideRouteRuntime'
export { AutoTourCameraAvoidanceController } from './autoTourCameraAvoidanceController'
export { CharacterAutoTourRuntimeManager } from './characterAutoTourRuntime'
export type {
  CharacterAutoTourInputState,
  CharacterAutoTourRouteSnapResult,
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
  resolveFollowForwardPitch,
  resolveGroundAlignedFollowForward,
  updateBackFollowCamera,
  resetCameraFollowState,
  resetFollowCameraMotionState,
  updateMotionAwareFollowCamera,
} from './followCameraController'
export type { FollowCameraMotionState } from './followCameraController'
export { updateVehicleSpeedAndApplyParkingHoldSafe, VEHICLE_PARKED_SPEED_EPSILON, VEHICLE_PARKING_HOLD_SPEED_EPSILON } from './vehicleParkingHold'
export {
  createControlledNodeMotionRuntime,
  ControlledNodeMotionRuntime,
  isControlledNodeMotionPositionAligned,
} from './controlledNodeMotionRuntime'
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
