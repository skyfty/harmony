import * as THREE from 'three'
import type { CharacterControllerComponentProps } from './components'
import type { PhysicsCharacterGait } from '@harmony/physics-core'

export type CharacterGait = PhysicsCharacterGait
export type CharacterLocomotionSlot = 'walk' | 'run'

export type CharacterControlMoveVectorScratch = {
	facingScratch: THREE.Vector3
	rightScratch: THREE.Vector3
	moveScratch: THREE.Vector3
}

export type CharacterControlRuntimeState = {
	crouching?: boolean
	jumpPhase?: 'start' | 'loop' | 'land' | null
	interacting?: boolean
	turn?: number
	moveX?: number
	moveZ?: number
	gait?: CharacterGait
	previousLocomotionSlot?: CharacterLocomotionSlot | null
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

export function resolveKeyboardCharacterGait(params: {
	moving: boolean
	runHeld?: boolean
}): CharacterGait {
	if (!params.moving) {
		return 'analog'
	}
	return params.runHeld ? 'run' : 'walk'
}


export function resolveCharacterControlSpeed(
	props: CharacterControllerComponentProps,
	movementMagnitude: number,
	state: CharacterControlRuntimeState = {},
): number {
	if (movementMagnitude <= 0.05) {
		return 0
	}
	if (state.crouching) {
		return Math.max(0, props.walkSpeed * 0.4)
	}
	switch (state.gait) {
		case 'walk':
			return Math.max(0, props.walkSpeed)
		case 'run':
			return Math.max(0, props.runSpeed)
		default:
			break
	}
	const normalizedMagnitude = Math.min(1, Math.max(0, movementMagnitude))
	if (normalizedMagnitude <= 0.5) {
		return Math.max(0, props.walkSpeed * normalizedMagnitude / 0.5)
	}
	const blend = (normalizedMagnitude - 0.5) / 0.5
	return Math.max(0, props.walkSpeed + (props.runSpeed - props.walkSpeed) * blend)
}

export function resolveCharacterControlLocomotionSlot(
	movementMagnitude: number,
	state: CharacterControlRuntimeState = {},
): CharacterLocomotionSlot | null {
	if (movementMagnitude <= 0.05) {
		return null
	}
	switch (state.gait) {
		case 'walk':
			return 'walk'
		case 'run':
			return 'run'
		default:
			break
	}
	const previous = state.previousLocomotionSlot ?? null
	if (movementMagnitude >= (previous === 'run' ? 0.47 : 0.53)) {
		return 'run'
	}
	return 'walk'
}

export function resolveCharacterControlLocomotionClipSlot(
	props: CharacterControllerComponentProps,
	locomotionSlot: CharacterLocomotionSlot,
): CharacterLocomotionSlot | null {
	const candidates: CharacterLocomotionSlot[] = locomotionSlot === 'run'
		? ['run', 'walk']
		: ['walk', 'run']
	for (const slot of candidates) {
		if (resolveAnimationBindingClipName(props, slot)) {
			return slot
		}
	}
	return null
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
		return resolveAnimationBindingClipName(props, 'jump')
			?? resolveAnimationBindingClipName(props, 'fall')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (state.jumpPhase === 'loop') {
		return resolveAnimationBindingClipName(props, 'jump')
			?? resolveAnimationBindingClipName(props, 'fall')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (state.jumpPhase === 'land') {
		return resolveAnimationBindingClipName(props, 'jump')
			?? resolveAnimationBindingClipName(props, 'fall')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (state.crouching) {
		const moveX = Math.abs(state.moveX ?? 0)
		const moveZ = Math.abs(state.moveZ ?? 0)
		if (movementMagnitude <= 0.05) {
			return resolveAnimationBindingClipName(props, 'crouch')
				?? resolveAnimationBindingClipName(props, 'idle')
				?? null
		}
		if (moveX > 0.05 && moveZ <= 0.05) {
			return resolveAnimationBindingClipName(props, 'strafe')
				?? resolveAnimationBindingClipName(props, 'crouch')
				?? resolveAnimationBindingClipName(props, 'walk')
				?? resolveAnimationBindingClipName(props, 'idle')
				?? null
		}
		return resolveAnimationBindingClipName(props, 'crouch')
			?? resolveAnimationBindingClipName(props, 'walk')
			?? resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (movementMagnitude <= 0.05) {
		const turn = state.turn ?? 0
		if (Math.abs(turn) > 0.05) {
			return resolveAnimationBindingClipName(props, 'turn')
				?? resolveAnimationBindingClipName(props, 'idle')
				?? null
		}
		return resolveAnimationBindingClipName(props, 'idle')
			?? null
	}
	if (Math.abs(state.moveX ?? 0) > 0.05 && Math.abs(state.moveZ ?? 0) <= 0.05) {
		return resolveAnimationBindingClipName(props, 'strafe')
			?? resolveAnimationBindingClipName(props, 'walk')
			?? resolveAnimationBindingClipName(props, 'run')
			?? null
	}
	const locomotionSlot = resolveCharacterControlLocomotionSlot(movementMagnitude, state)
	if (locomotionSlot === 'run') {
		return resolveAnimationBindingClipName(
			props,
			resolveCharacterControlLocomotionClipSlot(props, locomotionSlot) ?? 'run',
		)
	}
	return resolveAnimationBindingClipName(
		props,
		resolveCharacterControlLocomotionClipSlot(props, 'walk') ?? 'walk',
	)
}
