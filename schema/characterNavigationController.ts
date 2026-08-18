import * as THREE from 'three'

const characterNavigationForwardScratch = new THREE.Vector3()
const characterNavigationRightScratch = new THREE.Vector3()
const characterNavigationUpScratch = new THREE.Vector3(0, 1, 0)
const characterNavigationDirectionScratch = new THREE.Vector3()
const characterNavigationTargetScratch = new THREE.Vector3()

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
	const entries = Object.entries(payload)
		.map(([key, value]) => `${key}=${typeof value === 'number' ? value.toFixed(3) : String(value)}`)
		.join(' ')
	return entries.length ? `[${stage}] ${entries}` : `[${stage}]`
}

export function normalizeCharacterNavigationAngle(value: number): number {
	return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI
}

export function approachCharacterNavigationScalar(current: number, target: number, speed: number, deltaSeconds: number): number {
	const dt = Math.max(0, deltaSeconds)
	if (!(speed > 0) || dt <= 0) {
		return current
	}
	const amount = Math.max(0, speed) * dt
	if (current < target) {
		return Math.min(target, current + amount)
	}
	return Math.max(target, current - amount)
}

export function approachCharacterNavigationAngle(current: number, target: number, speed: number, deltaSeconds: number): number {
	const dt = Math.max(0, deltaSeconds)
	if (!(speed > 0) || dt <= 0) {
		return normalizeCharacterNavigationAngle(current)
	}
	const delta = normalizeCharacterNavigationAngle(target - current)
	const amount = Math.min(Math.abs(delta), Math.max(0, speed) * dt)
	return normalizeCharacterNavigationAngle(current + Math.sign(delta) * amount)
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
		stopDistance = 0.45,
		slowDistance = 2,
		keyboardTargetDistance = 1.6,
		yawTurnRateDegreesPerSecond = 210,
		speedLerpPerSecond = 8,
		sprintSpeedThreshold = 0.75,
		walkIntentFloor = 0.15,
	} = params

	const dt = Math.max(0, deltaSeconds)
	if (!state.initialized) {
		state.currentYaw = characterYaw
		state.desiredYaw = characterYaw
		state.currentSpeed = 0
		state.targetSpeed = 0
		state.initialized = true
	}

	let targetWorld: THREE.Vector3 | null = null
	let targetSource: CharacterNavigationTargetSource = 'none'
	const keyboardMagnitude = Math.hypot(keyboardX, keyboardY)
	if (pointerActive && pointerTargetWorld) {
		targetWorld = pointerTargetWorld.clone()
		targetSource = 'pointer'
	} else if (keyboardMagnitude > 1e-4) {
		const forward = characterNavigationForwardScratch.set(0, 0, -1)
		if (camera) {
			camera.getWorldDirection(forward)
		}
		forward.y = 0
		if (forward.lengthSq() <= 1e-8) {
			forward.set(0, 0, -1)
		} else {
			forward.normalize()
		}
		const right = characterNavigationRightScratch.crossVectors(forward, characterNavigationUpScratch).normalize()
		const direction = characterNavigationDirectionScratch
			.copy(forward)
			.multiplyScalar(keyboardY)
			.addScaledVector(right, keyboardX)
		if (direction.lengthSq() > 1e-8) {
			targetWorld = characterNavigationTargetScratch
				.copy(characterPosition)
				.addScaledVector(direction.normalize(), keyboardTargetDistance)
				.clone()
			targetSource = 'keyboard'
		}
	}

	state.hasTarget = Boolean(targetWorld)
	state.targetSource = targetSource
	if (targetWorld) {
		state.targetWorld.copy(targetWorld)
		const dx = targetWorld.x - characterPosition.x
		const dz = targetWorld.z - characterPosition.z
		state.distanceToTarget = Math.hypot(dx, dz)
		state.desiredYaw = Math.atan2(dx, dz)
	} else {
		state.distanceToTarget = 0
		state.desiredYaw = characterYaw
	}

	const yawTurnRate = THREE.MathUtils.degToRad(Math.max(0, yawTurnRateDegreesPerSecond))
	const nextYaw = approachCharacterNavigationAngle(state.currentYaw, state.desiredYaw, yawTurnRate, dt)
	state.turnDeltaRadians = normalizeCharacterNavigationAngle(nextYaw - state.currentYaw)
	state.currentYaw = nextYaw

	const shouldMove = state.hasTarget && state.distanceToTarget > stopDistance
	const slowRange = Math.max(1e-6, slowDistance - stopDistance)
	const distanceBlend = shouldMove
		? THREE.MathUtils.clamp((state.distanceToTarget - stopDistance) / slowRange, 0, 1)
		: 0
	state.targetSpeed = shouldMove
		? (sprint || distanceBlend > sprintSpeedThreshold ? 1 : distanceBlend)
		: 0
	state.currentSpeed = approachCharacterNavigationScalar(state.currentSpeed, state.targetSpeed, speedLerpPerSecond, dt)

	const movementMagnitude = THREE.MathUtils.clamp(state.currentSpeed, 0, 1)
	const speedCeiling = crouch ? 0.4 : 1
	const effectiveMagnitude = Math.min(movementMagnitude, speedCeiling)
	const isMoving = state.hasTarget && effectiveMagnitude > walkIntentFloor
	const isTurning = Math.abs(state.turnDeltaRadians) > 1e-4

	return {
		targetWorld,
		targetSource,
		desiredYaw: state.desiredYaw,
		currentYaw: state.currentYaw,
		moveX: 0,
		moveZ: isMoving ? effectiveMagnitude : 0,
		turn: 0,
		speed: effectiveMagnitude,
		distanceToTarget: state.distanceToTarget,
		movementMagnitude: effectiveMagnitude,
		isMoving,
		isTurning,
	}
}
