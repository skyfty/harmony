import * as THREE from 'three'

export type CharacterNavigationTargetSource = 'pointer' | 'keyboard' | 'none'

export type CharacterNavigationControllerState = {
	targetWorld: THREE.Vector3
	hasTarget: boolean
	targetSource: CharacterNavigationTargetSource
	desiredYaw: number
	currentYaw: number
	currentSpeed: number
	targetSpeed: number
	turnDeltaRadians: number
	distanceToTarget: number
	initialized: boolean
}

export type CharacterNavigationControllerInput = {
	deltaSeconds: number
	characterPosition: THREE.Vector3
	characterYaw: number
	camera: THREE.Camera | null
	pointerTargetWorld: THREE.Vector3 | null
	pointerActive: boolean
	keyboardX?: number
	keyboardY?: number
	sprint?: boolean
	crouch?: boolean
	stopDistance?: number
	slowDistance?: number
	keyboardTargetDistance?: number
	yawTurnRateDegreesPerSecond?: number
	speedLerpPerSecond?: number
	sprintSpeedThreshold?: number
	walkIntentFloor?: number
}

export type CharacterNavigationControllerOutput = {
	targetWorld: THREE.Vector3 | null
	targetSource: CharacterNavigationTargetSource
	desiredYaw: number
	currentYaw: number
	moveX: number
	moveZ: number
	turn: number
	speed: number
	distanceToTarget: number
	movementMagnitude: number
	isMoving: boolean
	isTurning: boolean
}

const DEFAULT_STOP_DISTANCE = 0.35
const DEFAULT_SLOW_DISTANCE = 1.8
const DEFAULT_KEYBOARD_TARGET_DISTANCE = 4.5
const DEFAULT_YAW_TURN_RATE_DEG_PER_SEC = 360
const DEFAULT_SPEED_LERP_PER_SEC = 8.5
const DEFAULT_SPRINT_SPEED_THRESHOLD = 0.84
const DEFAULT_WALK_INTENT_FLOOR = 0.22
const EPSILON = 1e-6

const navigationCameraForwardScratch = new THREE.Vector3()
const navigationCameraRightScratch = new THREE.Vector3()
const navigationTargetDirectionScratch = new THREE.Vector3()
const navigationTargetWorldScratch = new THREE.Vector3()

export function createCharacterNavigationControllerState(initialYaw = 0): CharacterNavigationControllerState {
	return {
		targetWorld: new THREE.Vector3(),
		hasTarget: false,
		targetSource: 'none',
		desiredYaw: initialYaw,
		currentYaw: initialYaw,
		currentSpeed: 0,
		targetSpeed: 0,
		turnDeltaRadians: 0,
		distanceToTarget: 0,
		initialized: false,
	}
}

export function resetCharacterNavigationControllerState(
	state: CharacterNavigationControllerState,
	initialYaw = 0,
): void {
	state.targetWorld.set(0, 0, 0)
	state.hasTarget = false
	state.targetSource = 'none'
	state.desiredYaw = initialYaw
	state.currentYaw = initialYaw
	state.currentSpeed = 0
	state.targetSpeed = 0
	state.turnDeltaRadians = 0
	state.distanceToTarget = 0
	state.initialized = false
}

export function formatCharacterNavigationDebugLine(stage: string, payload: Record<string, string | number | boolean | null | undefined>): string {
	const entries = Object.entries(payload).map(([key, value]) => {
		if (value === null) {
			return `${key}=null`
		}
		if (value === undefined) {
			return `${key}=undefined`
		}
		if (typeof value === 'number') {
			return `${key}=${Number.isFinite(value) ? value.toFixed(3) : 'NaN'}`
		}
		if (typeof value === 'boolean') {
			return `${key}=${Number(value)}`
		}
		return `${key}=${value}`
	})
	return `[CharacterNavigation][${stage}] ${entries.join(' ')}`
}

export function normalizeCharacterNavigationAngle(value: number): number {
	return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI
}

export function approachCharacterNavigationScalar(current: number, target: number, speed: number, deltaSeconds: number): number {
	if (!Number.isFinite(current)) {
		return target
	}
	if (!Number.isFinite(target)) {
		return current
	}
	if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
		return target
	}
	const alpha = 1 - Math.exp(-speed * deltaSeconds)
	return THREE.MathUtils.lerp(current, target, alpha)
}

export function approachCharacterNavigationAngle(current: number, target: number, speed: number, deltaSeconds: number): number {
	const delta = normalizeCharacterNavigationAngle(target - current)
	if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
		return target
	}
	const maxStep = speed * deltaSeconds
	if (Math.abs(delta) <= maxStep) {
		return normalizeCharacterNavigationAngle(target)
	}
	return normalizeCharacterNavigationAngle(current + Math.sign(delta) * maxStep)
}

function resolveFlatCameraBasis(camera: THREE.Camera | null): {
	forward: THREE.Vector3
	right: THREE.Vector3
} {
	if (camera) {
		camera.getWorldDirection(navigationCameraForwardScratch)
	} else {
		navigationCameraForwardScratch.set(0, 0, -1)
	}
	navigationCameraForwardScratch.y = 0
	if (navigationCameraForwardScratch.lengthSq() <= EPSILON) {
		navigationCameraForwardScratch.set(0, 0, -1)
	}
	navigationCameraForwardScratch.normalize()
	navigationCameraRightScratch.copy(navigationCameraForwardScratch).cross(new THREE.Vector3(0, 1, 0))
	if (navigationCameraRightScratch.lengthSq() <= EPSILON) {
		navigationCameraRightScratch.set(1, 0, 0)
	} else {
		navigationCameraRightScratch.normalize()
	}
	return {
		forward: navigationCameraForwardScratch.clone(),
		right: navigationCameraRightScratch.clone(),
	}
}

function resolveKeyboardTargetWorld(
	characterPosition: THREE.Vector3,
	camera: THREE.Camera | null,
	keyboardX: number,
	keyboardY: number,
	keyboardTargetDistance: number,
): THREE.Vector3 | null {
	const magnitude = Math.hypot(keyboardX, keyboardY)
	if (!(magnitude > 0.001)) {
		return null
	}
	const basis = resolveFlatCameraBasis(camera)
	navigationTargetWorldScratch.copy(characterPosition)
	navigationTargetWorldScratch.addScaledVector(basis.forward, keyboardY * keyboardTargetDistance)
	navigationTargetWorldScratch.addScaledVector(basis.right, keyboardX * keyboardTargetDistance)
	return navigationTargetWorldScratch.clone()
}

export function updateCharacterNavigationController(params: CharacterNavigationControllerInput & {
	state: CharacterNavigationControllerState
}): CharacterNavigationControllerOutput {
	const {
		state,
		deltaSeconds,
		characterPosition,
		characterYaw,
		camera,
		pointerTargetWorld,
		pointerActive,
		keyboardX = 0,
		keyboardY = 0,
		sprint = false,
		crouch = false,
		stopDistance = DEFAULT_STOP_DISTANCE,
		slowDistance = DEFAULT_SLOW_DISTANCE,
		keyboardTargetDistance = DEFAULT_KEYBOARD_TARGET_DISTANCE,
		yawTurnRateDegreesPerSecond = DEFAULT_YAW_TURN_RATE_DEG_PER_SEC,
		speedLerpPerSecond = DEFAULT_SPEED_LERP_PER_SEC,
		sprintSpeedThreshold = DEFAULT_SPRINT_SPEED_THRESHOLD,
		walkIntentFloor = DEFAULT_WALK_INTENT_FLOOR,
	} = params

	if (!state.initialized) {
		state.currentYaw = characterYaw
		state.desiredYaw = characterYaw
		state.initialized = true
	}

	const hasPointerTarget = pointerActive && pointerTargetWorld && Number.isFinite(pointerTargetWorld.x)
	const hasKeyboardTarget = !hasPointerTarget && Math.hypot(keyboardX, keyboardY) > 0.001
	let targetWorld: THREE.Vector3 | null = null
	let targetSource: CharacterNavigationTargetSource = 'none'

	if (hasPointerTarget && pointerTargetWorld) {
		targetWorld = pointerTargetWorld.clone()
		targetSource = 'pointer'
	} else {
		targetWorld = resolveKeyboardTargetWorld(characterPosition, camera, keyboardX, keyboardY, keyboardTargetDistance)
		if (targetWorld) {
			targetSource = hasKeyboardTarget ? 'keyboard' : 'none'
		}
	}

	let movementMagnitude = 0
	let distanceToTarget = 0
	let desiredYaw = state.currentYaw
	let turnDeltaRadians = 0
	let targetSpeed = 0
	let currentYaw = state.currentYaw

	if (targetWorld) {
		navigationTargetDirectionScratch.copy(targetWorld).sub(characterPosition)
		navigationTargetDirectionScratch.y = 0
		distanceToTarget = navigationTargetDirectionScratch.length()
		if (distanceToTarget > EPSILON) {
			navigationTargetDirectionScratch.multiplyScalar(1 / distanceToTarget)
			desiredYaw = Math.atan2(navigationTargetDirectionScratch.x, navigationTargetDirectionScratch.z)
			turnDeltaRadians = normalizeCharacterNavigationAngle(desiredYaw - currentYaw)
			const stopThreshold = Math.max(0.05, stopDistance)
			const slowThreshold = Math.max(stopThreshold + 0.001, slowDistance)
			if (distanceToTarget <= stopThreshold) {
				targetSpeed = 0
			} else {
				const distanceBlend = THREE.MathUtils.clamp((distanceToTarget - stopThreshold) / (slowThreshold - stopThreshold), 0, 1)
				targetSpeed = THREE.MathUtils.lerp(walkIntentFloor, 1, distanceBlend)
				if (sprint || targetSpeed >= sprintSpeedThreshold) {
					targetSpeed = Math.max(targetSpeed, sprintSpeedThreshold)
				}
				if (crouch) {
					targetSpeed = Math.min(targetSpeed, 0.35)
				}
			}
			const turnRateRadiansPerSecond = THREE.MathUtils.degToRad(yawTurnRateDegreesPerSecond)
			currentYaw = approachCharacterNavigationAngle(currentYaw, desiredYaw, turnRateRadiansPerSecond, deltaSeconds)
			state.currentYaw = currentYaw
			state.desiredYaw = desiredYaw
			state.turnDeltaRadians = turnDeltaRadians
			state.targetSpeed = targetSpeed
			state.distanceToTarget = distanceToTarget
			state.targetWorld.copy(targetWorld)
			state.hasTarget = true
			state.targetSource = targetSource
			state.currentSpeed = approachCharacterNavigationScalar(state.currentSpeed, targetSpeed, speedLerpPerSecond, deltaSeconds)
			movementMagnitude = THREE.MathUtils.clamp(state.currentSpeed, 0, 1)
		} else {
			state.currentSpeed = approachCharacterNavigationScalar(state.currentSpeed, 0, speedLerpPerSecond, deltaSeconds)
			state.hasTarget = false
		}
	} else {
		state.hasTarget = false
		state.targetSource = 'none'
		state.targetSpeed = 0
		state.distanceToTarget = 0
		state.turnDeltaRadians = 0
		state.currentSpeed = approachCharacterNavigationScalar(state.currentSpeed, 0, speedLerpPerSecond, deltaSeconds)
		movementMagnitude = THREE.MathUtils.clamp(state.currentSpeed, 0, 1)
	}

	if (!state.hasTarget) {
		state.currentYaw = currentYaw
		state.desiredYaw = currentYaw
	}

	const moveZ = state.hasTarget ? movementMagnitude : 0
	const turn = state.hasTarget && Math.abs(turnDeltaRadians) > 0.001
		? THREE.MathUtils.clamp(turnDeltaRadians / Math.PI, -1, 1)
		: 0

	return {
		targetWorld: state.hasTarget ? state.targetWorld.clone() : null,
		targetSource: state.targetSource,
		desiredYaw: state.desiredYaw,
		currentYaw: state.currentYaw,
		moveX: 0,
		moveZ,
		turn,
		speed: state.currentSpeed,
		distanceToTarget: state.distanceToTarget,
		movementMagnitude,
		isMoving: movementMagnitude > 0.02,
		isTurning: Math.abs(turn) > 0.02,
	}
}
