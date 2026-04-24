import * as THREE from 'three'
import type { CharacterControllerComponentProps } from './components'

export type CharacterControlMoveVectorScratch = {
	facingScratch: THREE.Vector3
	rightScratch: THREE.Vector3
	moveScratch: THREE.Vector3
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

export function resolveCharacterControlSpeed(props: CharacterControllerComponentProps, movementMagnitude: number): number {
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
): string | null {
	if (movementMagnitude <= 0.05) {
		return props.animationBindings.find((binding) => binding.slot === 'idle')?.clipName ?? null
	}
	if (movementMagnitude >= 0.85) {
		return props.animationBindings.find((binding) => binding.slot === 'sprint')?.clipName
			?? props.animationBindings.find((binding) => binding.slot === 'run')?.clipName
			?? props.animationBindings.find((binding) => binding.slot === 'walk')?.clipName
			?? null
	}
	if (movementMagnitude >= 0.5) {
		return props.animationBindings.find((binding) => binding.slot === 'run')?.clipName
			?? props.animationBindings.find((binding) => binding.slot === 'walk')?.clipName
			?? null
	}
	return props.animationBindings.find((binding) => binding.slot === 'walk')?.clipName
		?? props.animationBindings.find((binding) => binding.slot === 'run')?.clipName
		?? null
}