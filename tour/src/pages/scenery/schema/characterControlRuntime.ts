import * as THREE from 'three'
import type { CharacterControllerComponentProps } from './components'

export type CharacterControlMoveVectorScratch = {
	facingScratch: THREE.Vector3
	rightScratch: THREE.Vector3
	moveScratch: THREE.Vector3
}

export type CharacterControlRuntimeState = {
	sprinting?: boolean
	crouching?: boolean
	jumpPhase?: 'start' | 'loop' | 'land' | null
	interacting?: boolean
	moveX?: number
	moveZ?: number
}

function resolveAnimationBindingClipName(
	props: CharacterControllerComponentProps,
	slot: CharacterControllerComponentProps['animationBindings'][number]['slot'],
): string | null {
	return props.animationBindings.find((binding) => binding.slot === slot)?.clipName ?? null
}

export function resolveCharacterControlMovementMagnitude(moveX: number, moveZ: number): number {
	return Math.min(1, Math.hypot(moveX, moveZ))
}

export function resolveCharacterControlMoveVector(params: {
	camera: THREE.Camera
	moveX: number
	moveZ: number
	scratch: CharacterControlMoveVectorScratch
}): number {
	const { camera, moveX, moveZ, scratch } = params
	const movementMagnitude = resolveCharacterControlMovementMagnitude(moveX, moveZ)
	if (movementMagnitude <= 0.001) {
		scratch.moveScratch.set(0, 0, 0)
		return movementMagnitude
	}
	camera.getWorldDirection(scratch.facingScratch)
	scratch.facingScratch.y = 0
	if (scratch.facingScratch.lengthSq() < 1e-8) {
		scratch.facingScratch.set(1, 0, 0)
	} else {
		scratch.facingScratch.normalize()
	}
	scratch.rightScratch.copy(scratch.facingScratch).cross(camera.up)
	if (scratch.rightScratch.lengthSq() < 1e-8) {
		scratch.rightScratch.set(0, 0, 1)
	} else {
		scratch.rightScratch.normalize()
	}
	scratch.moveScratch
		.copy(scratch.facingScratch)
		.multiplyScalar(moveZ)
		.addScaledVector(scratch.rightScratch, moveX)
	if (scratch.moveScratch.lengthSq() > 1e-8) {
		scratch.moveScratch.normalize()
	} else {
		scratch.moveScratch.set(0, 0, 0)
	}
	return movementMagnitude
}

export function resolveCharacterControlSpeed(
	props: CharacterControllerComponentProps,
	movementMagnitude: number,
	state: CharacterControlRuntimeState = {},
): number {
	if (state.crouching) {
		return Math.max(0, props.walkSpeed * 0.4)
	}
	if (state.sprinting && movementMagnitude > 0.05) {
		return props.sprintSpeed
	}
	if (movementMagnitude >= 0.85) {
		return props.sprintSpeed
	}
	if (movementMagnitude >= 0.5) {
		return props.runSpeed
	}
	return props.walkSpeed
}

export function chooseCharacterControlClipName(
	props: CharacterControllerComponentProps,
	movementMagnitude: number,
 	state: CharacterControlRuntimeState = {},
): string | null {
	if (state.interacting) {
		return resolveAnimationBindingClipName(props, 'interact')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (state.jumpPhase === 'start') {
		return resolveAnimationBindingClipName(props, 'jumpStart')
			?? resolveAnimationBindingClipName(props, 'jumpLoop')
			?? resolveAnimationBindingClipName(props, 'jumpLand')
			?? resolveAnimationBindingClipName(props, 'fall')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (state.jumpPhase === 'loop') {
		return resolveAnimationBindingClipName(props, 'jumpLoop')
			?? resolveAnimationBindingClipName(props, 'fall')
			?? resolveAnimationBindingClipName(props, 'jumpStart')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (state.jumpPhase === 'land') {
		return resolveAnimationBindingClipName(props, 'jumpLand')
			?? resolveAnimationBindingClipName(props, 'fall')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (state.crouching) {
		const moveX = Math.abs(state.moveX ?? 0)
		const moveZ = Math.abs(state.moveZ ?? 0)
		if (moveX > 0.05 && moveZ <= 0.05) {
			return resolveAnimationBindingClipName(props, (state.moveX ?? 0) > 0 ? 'strafeRight' : 'strafeLeft')
				?? resolveAnimationBindingClipName(props, 'crouchWalk')
				?? resolveAnimationBindingClipName(props, 'walk')
				?? resolveAnimationBindingClipName(props, 'idle')
				?? null
		}
		if (movementMagnitude <= 0.05) {
			return resolveAnimationBindingClipName(props, 'crouchIdle')
				?? resolveAnimationBindingClipName(props, 'idle')
				?? null
		}
		return resolveAnimationBindingClipName(props, 'crouchWalk')
			?? resolveAnimationBindingClipName(props, 'walk')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (movementMagnitude <= 0.05) {
		return resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (Math.abs(state.moveX ?? 0) > 0.05 && Math.abs(state.moveZ ?? 0) <= 0.05) {
		return resolveAnimationBindingClipName(props, (state.moveX ?? 0) > 0 ? 'strafeRight' : 'strafeLeft')
			?? resolveAnimationBindingClipName(props, 'walk')
			?? resolveAnimationBindingClipName(props, 'run')
			?? null
	}
	if (movementMagnitude >= 0.85) {
		return resolveAnimationBindingClipName(props, 'sprint')
			?? resolveAnimationBindingClipName(props, 'run')
			?? resolveAnimationBindingClipName(props, 'walk')
			?? null
	}
	if (movementMagnitude >= 0.5) {
		return resolveAnimationBindingClipName(props, 'run')
			?? resolveAnimationBindingClipName(props, 'walk')
			?? null
	}
	return resolveAnimationBindingClipName(props, 'walk')
		?? resolveAnimationBindingClipName(props, 'run')
		?? null
}