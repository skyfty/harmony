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

}

export function normalizeCharacterNavigationAngle(value: number): number {
	return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI
}

export function approachCharacterNavigationScalar(current: number, target: number, speed: number, deltaSeconds: number): number {

}

export function approachCharacterNavigationAngle(current: number, target: number, speed: number, deltaSeconds: number): number {

}


export function updateCharacterNavigationController(params: CharacterNavigationControllerInput & {
	state: CharacterNavigationControllerState
}): CharacterNavigationControllerOutput {
	
}
