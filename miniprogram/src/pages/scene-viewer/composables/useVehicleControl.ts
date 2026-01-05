import { ref, reactive, computed, nextTick, watch, shallowRef, type Ref, type ComponentPublicInstance } from 'vue';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  VehicleDriveController,
  type VehicleDriveCameraFollowState,
  type VehicleDriveCameraMode,
  type VehicleDriveOrbitMode,
  type VehicleDriveCameraRestoreState,
  type VehicleDriveControlFlags,
  type VehicleDriveInputState,
} from '@schema/VehicleDriveController';
import type { BehaviorRuntimeEvent } from '@schema/behaviors/runtime';

// Constants
const JOYSTICK_INPUT_RADIUS = 64;
const VEHICLE_SPEED_GAUGE_MAX_MPS = 32;
const JOYSTICK_VISUAL_RANGE = 44;
const JOYSTICK_DEADZONE = 0.25;
const VEHICLE_SMOOTH_STOP_TRIGGER_SPEED = 0.6;
const VEHICLE_SMOOTH_STOP_MIN_THROTTLE = 0.05;
const STEERING_KEYBOARD_RETURN_SPEED = 7;
const STEERING_KEYBOARD_CATCH_SPEED = 18;
const DRIVE_PAD_FADE_MS = 220;
const DRIVE_PAD_MOUSE_POINTER_ID = -2;

export function useVehicleControl(deps: {
  vehicleInstances: Map<string, any>;
  rigidbodyInstances: Map<string, any>;
  nodeObjectMap: Map<string, any>;
  resolveNodeById: (id: string) => any;
  resolveRigidbodyComponent: (node: any) => any;
  resolveVehicleComponent: (node: any) => any;
  ensurePhysicsWorld: () => void;
  ensureVehicleBindingForNode: (nodeId: string) => void;
  normalizeNodeId: (id: any) => string | null;
  setCameraViewState: (mode: any, targetId?: string | null) => void;
  setCameraCaging: (enabled: boolean, options?: { force?: boolean }) => void;
  runWithProgrammaticCameraMutation: (fn: () => void) => void;
  withControlsVerticalFreedom: <T>(controls: any, callback: () => T) => T;
  lockControlsPitchToCurrent: (controls: any, camera: THREE.PerspectiveCamera) => void;
  syncLastFirstPersonStateFromCamera: () => void;
  onToast: (message: string) => void;
  onResolveBehaviorToken: (token: string, resolution: any) => void;
  getViewportHeight: () => number;
  purposeActiveMode: Ref<'watch' | 'level'>;
  getRenderContext: () => any;
}) {
  const vehicleDriveActive = ref(false);
  const vehicleDriveNodeId = ref<string | null>(null);
  const vehicleDriveToken = ref<string | null>(null);
  const activeVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
  const vehicleDriveSeatNodeId = ref<string | null>(null);
  const vehicleDriveUiOverride = ref<'auto' | 'show' | 'hide'>('auto');
  const vehicleDriveExitBusy = ref(false);
  let vehicleDriveSteerable: number[] = [];
  let vehicleDriveWheelCount = 0;
  const vehicleDriveVehicle = shallowRef<CANNON.RaycastVehicle | null>(null);
  
  const vehicleDriveInputFlags = reactive<VehicleDriveControlFlags>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
  });
  const vehicleDriveInput = reactive<VehicleDriveInputState>({
    throttle: 0,
    steering: 0,
    brake: 0,
  });
  const vehicleDriveCameraMode = ref<VehicleDriveCameraMode>('follow');
  const vehicleDriveOrbitMode = ref<VehicleDriveOrbitMode>('follow');
  const vehicleDriveCameraFollowState = reactive<VehicleDriveCameraFollowState>({
    desiredPosition: new THREE.Vector3(),
    currentPosition: new THREE.Vector3(),
    desiredTarget: new THREE.Vector3(),
    currentTarget: new THREE.Vector3(),
    desiredAnchor: new THREE.Vector3(),
    currentAnchor: new THREE.Vector3(),
    anchorHoldSeconds: 0,
    lastVelocityDirection: new THREE.Vector3(0, 0, 1),
    shouldHoldAnchorForReverse: false,
    heading: new THREE.Vector3(0, 0, 1),
    initialized: false,
    localOffset: new THREE.Vector3(),
    hasLocalOffset: false,
    motionDistanceBlend: 0,
    lookaheadOffset: new THREE.Vector3(),
  });
  const joystickRef = ref<ComponentPublicInstance | HTMLElement | null>(null);
  const joystickVector = reactive({ x: 0, y: 0 });
  const joystickOffset = reactive({ x: 0, y: 0 });
  const joystickState = reactive({
    active: false,
    pointerId: -1,
    centerX: 0,
    centerY: 0,
    ready: false,
  });
  
  const drivePadState = reactive({ visible: false, fading: false, x: 0, y: 0 });
  const drivePadStyle = computed(() => ({
    left: `${drivePadState.x}px`,
    top: `${drivePadState.y}px`,
  }));
  let drivePadFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let drivePadMouseTracking = false;
  const isBrowserEnvironment = typeof window !== 'undefined';
  const drivePadViewportRect = { top: 0, left: 0, height: deps.getViewportHeight() };
  const steeringKeyboardValue = ref(0);
  const steeringKeyboardTarget = ref(0);
  const joystickKnobStyle = computed(() => {
    const scale = joystickState.active ? 0.88 : 1;
    return {
      transform: `translate(calc(-50% + ${joystickOffset.x}px), calc(-50% + ${joystickOffset.y}px)) scale(${scale})`,
    };
  });

  const vehicleDriveResetBusy = ref(false);
  const vehicleDriveCameraRestoreState: VehicleDriveCameraRestoreState = {
    hasSnapshot: false,
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    up: new THREE.Vector3(),
    controlMode: null,
    viewMode: 'level',
    viewTargetId: null,
    isCameraCaged: false,
    purposeMode: deps.purposeActiveMode.value,
  };

  const vehicleSpeed = ref(0);
  const vehicleSpeedPercent = computed(() => Math.min(1, vehicleSpeed.value / VEHICLE_SPEED_GAUGE_MAX_MPS));
  const vehicleSpeedKmh = computed(() => Math.round(vehicleSpeed.value * 3.6));
  const vehicleSpeedGaugeStyle = computed(() => ({
    '--speed-angle': `${vehicleSpeedPercent.value * 360}deg`,
  }));

  const vehicleDriveStateBridge = {
    get active() { return vehicleDriveActive.value; },
    set active(value: boolean) { vehicleDriveActive.value = value; },
    get nodeId() { return vehicleDriveNodeId.value; },
    set nodeId(value: string | null) { vehicleDriveNodeId.value = value; },
    get token() { return vehicleDriveToken.value; },
    set token(value: string | null) { vehicleDriveToken.value = value; },
    get vehicle() { return vehicleDriveVehicle.value; },
    set vehicle(value: CANNON.RaycastVehicle | null) { vehicleDriveVehicle.value = value; },
    get steerableWheelIndices() { return vehicleDriveSteerable; },
    set steerableWheelIndices(value: number[]) { vehicleDriveSteerable = value; },
    get wheelCount() { return vehicleDriveWheelCount; },
    set wheelCount(value: number) { vehicleDriveWheelCount = value; },
    get seatNodeId() { return vehicleDriveSeatNodeId.value; },
    set seatNodeId(value: string | null) { vehicleDriveSeatNodeId.value = value; },
    get sourceEvent() { return activeVehicleDriveEvent.value; },
    set sourceEvent(value: any) { activeVehicleDriveEvent.value = value; },
  };

  const vehicleDriveUi = computed(() => {
    const active = vehicleDriveActive.value;
    const override = vehicleDriveUiOverride.value;
    const visible = override === 'show' || (active && override !== 'hide');
    return {
      visible,
      joystickActive: active && joystickState.active,
      accelerating: active && (vehicleDriveInputFlags.forward || vehicleDriveInput.throttle > 0.1),
      braking: active && vehicleDriveInputFlags.brake,
    } as const;
  });

  const pendingVehicleDriveEvent = ref<Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }> | null>(null);
  const vehicleDrivePromptBusy = ref(false);

  const vehicleDriveController = new VehicleDriveController(
    {
      vehicleInstances: deps.vehicleInstances,
      rigidbodyInstances: deps.rigidbodyInstances,
      nodeObjectMap: deps.nodeObjectMap,
      resolveNodeById: deps.resolveNodeById,
      resolveRigidbodyComponent: deps.resolveRigidbodyComponent,
      resolveVehicleComponent: deps.resolveVehicleComponent,
      ensurePhysicsWorld: deps.ensurePhysicsWorld,
      ensureVehicleBindingForNode: deps.ensureVehicleBindingForNode,
      normalizeNodeId: deps.normalizeNodeId,
      setCameraViewState: (mode, targetId) => deps.setCameraViewState(mode, targetId),
      setCameraCaging: deps.setCameraCaging,
      runWithProgrammaticCameraMutation: deps.runWithProgrammaticCameraMutation,
      withControlsVerticalFreedom: deps.withControlsVerticalFreedom,
      lockControlsPitchToCurrent: deps.lockControlsPitchToCurrent,
      syncLastFirstPersonStateFromCamera: deps.syncLastFirstPersonStateFromCamera,
      onToast: deps.onToast,
      onResolveBehaviorToken: deps.onResolveBehaviorToken,
    },
    {
      state: vehicleDriveStateBridge as any,
      inputFlags: vehicleDriveInputFlags,
      input: vehicleDriveInput,
      cameraMode: vehicleDriveCameraMode,
      orbitMode: vehicleDriveOrbitMode,
      uiOverride: vehicleDriveUiOverride,
      promptBusy: vehicleDrivePromptBusy,
      exitBusy: vehicleDriveExitBusy,
      cameraRestoreState: vehicleDriveCameraRestoreState,
      cameraFollowState: vehicleDriveCameraFollowState,
      steeringKeyboardValue,
    },
  );

  const vehicleDrivePrompt = computed(() => {
    const event = pendingVehicleDriveEvent.value;
    if (!event) {
      return { visible: false, busy: false };
    }
    return { visible: true, busy: vehicleDrivePromptBusy.value };
  });

  // Helper functions
  function clampAxisScalar(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(-1, Math.min(1, value));
  }

  function getTouchCoordinates(touch: Touch | null): { x: number; y: number } | null {
    if (!touch) {
      return null;
    }
    const clientX = 'clientX' in touch ? touch.clientX : (touch as unknown as { x?: number }).x ?? 0;
    const clientY = 'clientY' in touch ? touch.clientY : (touch as unknown as { y?: number }).y ?? 0;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }
    return { x: clientX, y: clientY };
  }

  function updateDrivePadViewportRect(target: EventTarget | null): void {
    const element = target as { getBoundingClientRect?: () => DOMRect | ClientRect } | null;
    if (element && typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      if (rect) {
        drivePadViewportRect.top = rect.top ?? 0;
        drivePadViewportRect.left = rect.left ?? 0;
        drivePadViewportRect.height = rect.height ?? deps.getViewportHeight();
        return;
      }
    }
    drivePadViewportRect.top = 0;
    drivePadViewportRect.left = 0;
    drivePadViewportRect.height = deps.getViewportHeight();
  }

  function shouldActivateDrivePad(clientY: number): boolean {
    const height = drivePadViewportRect.height > 0 ? drivePadViewportRect.height : deps.getViewportHeight();
    if (height <= 0) {
      return true;
    }
    return clientY >= drivePadViewportRect.top + height / 2;
  }

  function toDrivePadLocalCoords(x: number, y: number): { x: number; y: number } {
    return {
      x: x - drivePadViewportRect.left,
      y: y - drivePadViewportRect.top,
    };
  }

  function cancelDrivePadFade(): void {
    if (drivePadFadeTimer) {
      clearTimeout(drivePadFadeTimer);
      drivePadFadeTimer = null;
    }
  }

  function summonDrivePadAt(x: number, y: number): void {
    cancelDrivePadFade();
    drivePadState.x = x;
    drivePadState.y = y;
    drivePadState.visible = true;
    drivePadState.fading = false;
  }

  function scheduleDrivePadFade(): void {
    if (!drivePadState.visible) {
      return;
    }
    drivePadState.fading = true;
    cancelDrivePadFade();
    drivePadFadeTimer = setTimeout(() => {
      drivePadState.visible = false;
      drivePadState.fading = false;
      drivePadFadeTimer = null;
    }, DRIVE_PAD_FADE_MS);
  }

  function hideDrivePadImmediate(): void {
    if (!drivePadState.visible && !drivePadState.fading) {
      return;
    }
    cancelDrivePadFade();
    drivePadState.visible = false;
    drivePadState.fading = false;
  }

  function cancelVehicleSmoothStop(): void {
    vehicleDriveController.clearSmoothStop();
  }

  function requestVehicleSmoothStop(): void {
    if (!vehicleDriveActive.value) {
      return;
    }
    if (Math.abs(vehicleDriveInput.throttle) > VEHICLE_SMOOTH_STOP_MIN_THROTTLE) {
      return;
    }
    if (vehicleSpeed.value <= VEHICLE_SMOOTH_STOP_TRIGGER_SPEED) {
      return;
    }
    vehicleDriveController.requestSmoothStop({ initialSpeed: vehicleSpeed.value });
  }

  function recomputeVehicleDriveInputs(): void {
    const joystickInput = resolveJoystickDriveInput();
    const throttleFromJoystick = clampAxisScalar(joystickInput.throttle);
    const steeringFromJoystick = clampAxisScalar(joystickInput.steering);
    vehicleDriveInput.throttle = throttleFromJoystick;
    vehicleDriveInput.steering = -steeringFromJoystick;
    vehicleDriveInput.brake = vehicleDriveInputFlags.brake ? 1 : 0;
    vehicleDriveController.recomputeInputs();
  }

  function setJoystickVector(x: number, y: number): void {
    let nextX = clampAxisScalar(x);
    let nextY = clampAxisScalar(y);
    const length = Math.hypot(nextX, nextY);
    if (length > 1) {
      const scale = 1 / length;
      nextX *= scale;
      nextY *= scale;
    }
    joystickVector.x = nextX;
    joystickVector.y = nextY;
    joystickOffset.x = joystickVector.x * JOYSTICK_VISUAL_RANGE;
    joystickOffset.y = -joystickVector.y * JOYSTICK_VISUAL_RANGE;
    recomputeVehicleDriveInputs();
  }

  function deactivateJoystick(reset: boolean): void {
    joystickState.active = false;
    joystickState.pointerId = -1;
    joystickState.ready = false;
    if (reset) {
      setJoystickVector(0, 0);
    }
  }

  function resolveJoystickDriveInput(): { throttle: number; steering: number } {
    const x = joystickVector.x;
    const y = joystickVector.y;
    const length = Math.hypot(x, y);
    if (length <= JOYSTICK_DEADZONE) {
      return { throttle: 0, steering: 0 };
    }
    const effectiveLength = (length - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
    const scale = length > 0 ? effectiveLength / length : 0;
    return {
      throttle: y * scale,
      steering: x * scale,
    };
  }

  function refreshJoystickMetrics(): void {
    nextTick(() => {
      const query = uni.createSelectorQuery();
      query
        .select('#viewer-drive-joystick')
        .boundingClientRect((rect) => {
          const info = (rect || null) as UniApp.NodeInfo | null;
          if (!info) {
            joystickState.ready = false;
            return;
          }
          const left = info.left ?? 0;
          const top = info.top ?? 0;
          const width = info.width ?? 0;
          const height = info.height ?? 0;
          joystickState.centerX = left + width / 2;
          joystickState.centerY = top + height / 2;
          joystickState.ready = true;
        })
        .exec();
    });
  }

  function applyJoystickFromPoint(x: number, y: number): void {
    if (!joystickState.ready) {
      joystickState.centerX = x;
      joystickState.centerY = y;
      joystickState.ready = true;
      refreshJoystickMetrics();
    }
    const dx = x - joystickState.centerX;
    const dy = y - joystickState.centerY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return;
    }
    const normalizedX = clampAxisScalar(dx / JOYSTICK_INPUT_RADIUS);
    const normalizedY = clampAxisScalar(-dy / JOYSTICK_INPUT_RADIUS);
    let length = Math.hypot(normalizedX, normalizedY);
    if (length > 1) {
      const inv = 1 / length;
      setJoystickVector(normalizedX * inv, normalizedY * inv);
      return;
    }
    setJoystickVector(normalizedX, normalizedY);
  }

  function extractTouchById(event: TouchEvent, identifier: number): Touch | null {
    const touches: readonly Touch[] = [...Array.from(event.changedTouches || [])];
    for (const touch of touches) {
      if (touch.identifier === identifier) {
        return touch;
      }
    }
    const activeTouches: readonly Touch[] = [...Array.from(event.touches || [])];
    for (const touch of activeTouches) {
      if (touch.identifier === identifier) {
        return touch;
      }
    }
    return null;
  }

  // Handlers
  function handleJoystickTouchStart(event: TouchEvent): void {
    if (!vehicleDriveActive.value) {
      return;
    }
    const touch = event.changedTouches?.[0] ?? null;
    if (!touch) {
      return;
    }
    if (!joystickState.ready) {
      refreshJoystickMetrics();
    }
    const coords = getTouchCoordinates(touch);
    if (!coords) {
      return;
    }
    joystickState.pointerId = touch.identifier;
    joystickState.active = true;
    cancelVehicleSmoothStop();
    applyJoystickFromPoint(coords.x, coords.y);
  }

  function handleJoystickTouchMove(event: TouchEvent): void {
    if (!joystickState.active || joystickState.pointerId === -1) {
      return;
    }
    const touch = extractTouchById(event, joystickState.pointerId);
    if (!touch) {
      return;
    }
    const coords = getTouchCoordinates(touch);
    if (!coords) {
      return;
    }
    applyJoystickFromPoint(coords.x, coords.y);
  }

  function handleJoystickTouchEnd(event: TouchEvent): void {
    if (joystickState.pointerId === -1) {
      return;
    }
    const touch = extractTouchById(event, joystickState.pointerId);
    if (!touch) {
      return;
    }
    deactivateJoystick(true);
    requestVehicleSmoothStop();
  }

  function handleDrivePadTouchStart(event: TouchEvent): void {
    if (!vehicleDriveUi.value.visible) {
      return;
    }
    updateDrivePadViewportRect(event.currentTarget);
    const touch = event.changedTouches?.[0] ?? null;
    const coords = getTouchCoordinates(touch);
    if (!coords || !shouldActivateDrivePad(coords.y)) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const localCoords = toDrivePadLocalCoords(coords.x, coords.y);
    cancelVehicleSmoothStop();
    summonDrivePadAt(localCoords.x, localCoords.y);
    handleJoystickTouchStart(event);
  }

  function handleDrivePadTouchMove(event: TouchEvent): void {
    if (joystickState.pointerId === -1) {
      return;
    }
    const touch = extractTouchById(event, joystickState.pointerId);
    if (!touch) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    handleJoystickTouchMove(event);
  }

  function handleDrivePadTouchEnd(event: TouchEvent): void {
    if (joystickState.pointerId === -1) {
      return;
    }
    const touch = extractTouchById(event, joystickState.pointerId);
    if (!touch) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    handleJoystickTouchEnd(event);
    scheduleDrivePadFade();
  }

  function handleDrivePadMouseDown(event: MouseEvent): void {
    if (!vehicleDriveUi.value.visible || event.button !== 0) {
      return;
    }
    updateDrivePadViewportRect(event.currentTarget);
    const coords = { x: event.clientX, y: event.clientY };
    if (!shouldActivateDrivePad(coords.y)) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const localCoords = toDrivePadLocalCoords(coords.x, coords.y);
    cancelVehicleSmoothStop();
    summonDrivePadAt(localCoords.x, localCoords.y);
    joystickState.pointerId = DRIVE_PAD_MOUSE_POINTER_ID;
    joystickState.active = true;
    joystickState.ready = false;
    setJoystickVector(0, 0);
    applyJoystickFromPoint(coords.x, coords.y);
  }

  function resetActiveVehiclePose(): boolean {
    return vehicleDriveController.resetPose();
  }

  function updateVehicleDriveCamera(
    deltaSeconds = 0,
    options: { immediate?: boolean } = {},
  ): boolean {
    const ctx = deps.getRenderContext();
    return vehicleDriveController.updateCamera(deltaSeconds, ctx, options);
  }

  function handleVehicleDriveResetTap(): void {
    if (!vehicleDriveActive.value || vehicleDriveResetBusy.value) {
      return;
    }
    vehicleDriveResetBusy.value = true;
    try {
      const success = resetActiveVehiclePose();
      if (!success) {
        deps.onToast('无法重置车辆');
        return;
      }
      updateVehicleDriveCamera(0, { immediate: true });
    } finally {
      vehicleDriveResetBusy.value = false;
    }
  }

  function alignVehicleDriveExitCamera(): boolean {
    const ctx = deps.getRenderContext();
    return vehicleDriveController.alignExitCamera(ctx);
  }

  function handleHideVehicleCockpitEvent(): void {
    vehicleDriveUiOverride.value = 'hide';
  }
  
  function handleShowVehicleCockpitEvent(): void {
    vehicleDriveUiOverride.value = 'show';
  }

  function restoreVehicleDriveCameraState(): void {
    const ctx = deps.getRenderContext();
    vehicleDriveController.restoreCamera(ctx);
  }

  function handleVehicleDebusEvent(): void {
    if (pendingVehicleDriveEvent.value) {
      deps.onResolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
        type: 'abort',
        message: '驾驶请求已被终止。',
      });
      pendingVehicleDriveEvent.value = null;
      vehicleDrivePromptBusy.value = false;
      vehicleDriveUiOverride.value = 'hide';
    }
    if (!vehicleDriveActive.value) {
      restoreVehicleDriveCameraState();
      return;
    }
    const ctx = deps.getRenderContext();
    vehicleDriveController.stopDrive(
      { resolution: { type: 'continue' }, preserveCamera: false },
      ctx,
    );
    vehicleDriveUiOverride.value = 'hide';
    activeVehicleDriveEvent.value = null;
  }

  function handleVehicleDriveExitTap(): void {
    if (!vehicleDriveActive.value || vehicleDriveExitBusy.value) {
      return;
    }
    const event = activeVehicleDriveEvent.value;
    if (!event) {
      deps.onToast('缺少驾驶上下文');
      handleVehicleDebusEvent();
      return;
    }
    vehicleDriveExitBusy.value = true;
    try {
      const aligned = alignVehicleDriveExitCamera();
      if (!aligned) {
        deps.onToast('无法定位默认下车位置，已恢复默认视角');
      }
      handleHideVehicleCockpitEvent();
      handleVehicleDebusEvent();
    } finally {
      vehicleDriveExitBusy.value = false;
    }
  }

  function startVehicleDriveMode(
    event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>,
  ): { success: true } | { success: false; message: string } {
    const ctx = deps.getRenderContext();
    const result = vehicleDriveController.startDrive(event, ctx);
    if (result.success) {
      vehicleDriveCameraFollowState.initialized = false;
      deps.purposeActiveMode.value = 'watch';
      updateVehicleDriveCamera(0, { immediate: true });
    }
    return result;
  }

  async function handleVehicleDrivePromptTap(): Promise<void> {
    const event = pendingVehicleDriveEvent.value;
    if (!event || vehicleDrivePromptBusy.value) {
      return;
    }
    vehicleDrivePromptBusy.value = true;
    try {
      const result = startVehicleDriveMode(event);
      if (!result.success) {
        const message = result.message ?? '无法进入驾驶模式';
        deps.onToast(message);
        deps.onResolveBehaviorToken(event.token, { type: 'fail', message });
        pendingVehicleDriveEvent.value = null;
        return;
      }
      pendingVehicleDriveEvent.value = null;
      handleShowVehicleCockpitEvent();
    } finally {
      vehicleDrivePromptBusy.value = false;
    }
  }

  function updateVehiclePhysics(delta: number) {
    void delta;
    // Apply current inputs (throttle/steering/brake) to the physics vehicle each frame.
    // Without this, the joystick updates state but no forces are applied.
    vehicleDriveController.applyForces();
    const vehicle = vehicleDriveVehicle.value;
    const velocity = vehicle?.chassisBody?.velocity ?? null;
    if (!velocity) {
      vehicleSpeed.value = 0;
      return;
    }
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
    vehicleSpeed.value = Number.isFinite(speed) ? speed : 0;
  }

  function resetVehicleDriveInputs(): void {
    steeringKeyboardTarget.value = 0;
    deactivateJoystick(true);
    vehicleDriveController.resetInputs();
  }

  function handleVehicleDriveEvent(event: Extract<BehaviorRuntimeEvent, { type: 'vehicle-drive' }>): void {
    const targetNodeId = event.targetNodeId || event.nodeId || null;
    if (!targetNodeId) {
      deps.onToast('缺少驾驶目标');
      deps.onResolveBehaviorToken(event.token, { type: 'fail', message: '缺少驾驶目标' });
      return;
    }
    if (vehicleDriveActive.value) {
      restoreVehicleDriveCameraState();
      const ctx = deps.getRenderContext();
      vehicleDriveController.stopDrive(
        { resolution: { type: 'abort', message: '驾驶状态被新的脚本替换。' }, preserveCamera: true },
        ctx,
      );
    }
    if (pendingVehicleDriveEvent.value) {
      deps.onResolveBehaviorToken(pendingVehicleDriveEvent.value.token, {
        type: 'abort',
        message: '已有驾驶请求已取消。',
      });
    }
    pendingVehicleDriveEvent.value = event;
    vehicleDrivePromptBusy.value = false;
    vehicleDriveUiOverride.value = 'hide';
    resetVehicleDriveInputs();
    vehicleDriveExitBusy.value = false;
  }

  watch(
    () => vehicleDriveUi.value.visible,
    (visible) => {
      if (visible) {
        refreshJoystickMetrics();
      } else {
        hideDrivePadImmediate();
        deactivateJoystick(true);
      }
    },
  );

  watch(vehicleDriveCameraMode, (mode) => {
    vehicleDriveCameraFollowState.initialized = false;
    if (!vehicleDriveActive.value) {
      return;
    }
    if (mode === 'follow') {
      const nodeId = vehicleDriveNodeId.value ? deps.normalizeNodeId(vehicleDriveNodeId.value) : null;
      if (nodeId) {
        deps.setCameraViewState('watching', nodeId);
        deps.setCameraCaging(true);
      }
      vehicleDriveUiOverride.value = 'show';
      updateVehicleDriveCamera(0, { immediate: true });
    } else {
      vehicleDriveUiOverride.value = 'hide';
      updateVehicleDriveCamera(0, { immediate: true });
    }
  });

  watch(vehicleDriveActive, (active) => {
    if (!active) {
      vehicleDriveCameraMode.value = 'follow';
      vehicleDriveCameraFollowState.initialized = false;
      vehicleSpeed.value = 0;
    }
  });

  function resetVehicleControlState() {
    vehicleDriveActive.value = false;
    vehicleDriveNodeId.value = null;
    vehicleDriveToken.value = null;
    activeVehicleDriveEvent.value = null;
    pendingVehicleDriveEvent.value = null;
    vehicleDrivePromptBusy.value = false;
    vehicleDriveExitBusy.value = false;
    vehicleDriveResetBusy.value = false;
    resetVehicleDriveInputs();
    vehicleDriveCameraMode.value = 'follow';
    vehicleDriveCameraFollowState.initialized = false;
    deactivateJoystick(true);
    vehicleDriveUiOverride.value = 'hide';
  }

  return {
    vehicleDriveActive,
    vehicleDriveNodeId,
    vehicleDriveToken,
    activeVehicleDriveEvent,
    vehicleDriveSeatNodeId,
    vehicleDriveUiOverride,
    vehicleDriveExitBusy,
    vehicleDriveInputFlags,
    vehicleDriveInput,
    vehicleDriveCameraMode,
    vehicleDriveOrbitMode,
    vehicleDriveCameraFollowState,
    joystickRef,
    joystickVector,
    joystickOffset,
    joystickState,
    drivePadState,
    drivePadStyle,
    steeringKeyboardValue,
    steeringKeyboardTarget,
    joystickKnobStyle,
    vehicleDriveUi,
    vehicleDrivePrompt,
    vehicleDriveResetBusy,
    vehicleDriveVehicle,
    vehicleSpeedKmh,
    vehicleSpeedGaugeStyle,
    handleDrivePadTouchStart,
    handleDrivePadTouchMove,
    handleDrivePadTouchEnd,
    handleDrivePadMouseDown,
    handleJoystickTouchStart,
    handleJoystickTouchMove,
    handleJoystickTouchEnd,
    handleVehicleDriveResetTap,
    handleVehicleDriveExitTap,
    handleVehicleDrivePromptTap,
    updateVehiclePhysics,
    updateVehicleCamera: updateVehicleDriveCamera,
    handleVehicleDriveEvent,
    handleVehicleDebusEvent,
    handleShowVehicleCockpitEvent,
    handleHideVehicleCockpitEvent,
    resetVehicleControlState,
  };
}
