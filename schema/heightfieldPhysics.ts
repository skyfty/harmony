import * as CANNON from 'cannon-es'
import type * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '@harmony/schema'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { buildRoadHeightfieldBodies, isRoadDynamicMesh, type RoadHeightfieldBuildParams } from './roadHeightfield'
import type { RigidbodyInstance } from './physicsEngine'

function removeBodiesFromWorld(world: CANNON.World, bodies: CANNON.Body[]): void {
	bodies.forEach((body) => {
		if (!body) {
			return
		}
		try {
			world.removeBody(body)
		} catch (error) {
			// Ignore missing bodies; the world may have been reset.
		}
	})
}

export type RoadHeightfieldDebugSegment = {
	shape: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>
	position: [number, number, number]
	quaternion: [number, number, number, number]
}

export type RoadHeightfieldDebugSegmentsEntry = {
	signature: string
	segments: RoadHeightfieldDebugSegment[]
}

export type RoadHeightfieldDebugCache = Map<string, RoadHeightfieldDebugSegmentsEntry>

function extractHeightfieldShapeFromCannonShape(
	shape: CANNON.Shape | null | undefined,
): Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }> | null {
	if (!shape) {
		return null
	}
	const matrix = (shape as any)?.data as unknown
	const elementSize = (shape as any)?.elementSize as unknown
	if (!Array.isArray(matrix) || typeof elementSize !== 'number' || !Number.isFinite(elementSize) || elementSize <= 0) {
		return null
	}
	const columnCount = matrix.length
	const rowCount = Array.isArray(matrix[0]) ? (matrix[0] as any[]).length : 0
	if (columnCount < 2 || rowCount < 2) {
		return null
	}
	const width = (columnCount - 1) * elementSize
	const depth = (rowCount - 1) * elementSize
	return {
		kind: 'heightfield',
		matrix: matrix as number[][],
		elementSize,
		width,
		depth,
		scaleNormalized: false,
	}
}

export function buildRoadHeightfieldDebugSegmentsFromBodies(bodies: CANNON.Body[]): RoadHeightfieldDebugSegment[] {
	const segments: RoadHeightfieldDebugSegment[] = []
	bodies.forEach((body) => {
		if (!body) {
			return
		}
		const shape = extractHeightfieldShapeFromCannonShape(body.shapes?.[0] ?? null)
		if (!shape) {
			return
		}
		segments.push({
			shape,
			position: [body.position.x, body.position.y, body.position.z],
			quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
		})
	})
	return segments
}

export function resolveRoadHeightfieldDebugSegments(params: {
	nodeId: string
	signature: string
	bodies: CANNON.Body[]
	cache: RoadHeightfieldDebugCache
	debugEnabled: boolean
}): RoadHeightfieldDebugSegmentsEntry | null {
	const { nodeId, signature, bodies, cache, debugEnabled } = params
	if (!debugEnabled) {
		return null
	}
	const existing = cache.get(nodeId)
	if (existing?.signature === signature) {
		return existing
	}
	const segments = buildRoadHeightfieldDebugSegmentsFromBodies(bodies)
	const entry: RoadHeightfieldDebugSegmentsEntry = { signature, segments }
	cache.set(nodeId, entry)
	return entry
}

export type EnsureRoadHeightfieldRigidbodyInstanceParams = {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject: THREE.Object3D
	groundNode: SceneNode
	world: CANNON.World
	existingInstance: RigidbodyInstance | null
	createBody: RoadHeightfieldBuildParams['createBody']
	maxSegments?: number
	loggerTag?: string
}

export type EnsureRoadHeightfieldRigidbodyInstanceResult = {
	instance: RigidbodyInstance | null
	reused: boolean
	replaced: boolean
	shouldRemoveExisting: boolean
}

export function ensureRoadHeightfieldRigidbodyInstance(
	params: EnsureRoadHeightfieldRigidbodyInstanceParams,
): EnsureRoadHeightfieldRigidbodyInstanceResult {
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		groundNode,
		world,
		existingInstance,
		createBody,
		maxSegments,
		loggerTag = '[Physics]',
	} = params

	if (!isRoadDynamicMesh(roadNode.dynamicMesh)) {
		return { instance: null, reused: false, replaced: false, shouldRemoveExisting: Boolean(existingInstance) }
	}
	const entry = buildRoadHeightfieldBodies({
		roadNode,
		rigidbodyComponent,
		roadObject,
		groundNode,
		world,
		createBody,
		maxSegments,
	})
	if (!entry || !entry.bodies.length) {
		return { instance: null, reused: false, replaced: false, shouldRemoveExisting: Boolean(existingInstance) }
	}

	const existingSignature = existingInstance?.signature
	if (existingSignature && existingSignature === entry.signature) {
		entry.bodies.forEach((body) => {
			try {
				world.removeBody(body)
			} catch (error) {
				console.warn(`${loggerTag} Failed to rollback road heightfield body`, error)
			}
		})
		if (existingInstance) {
			existingInstance.object = roadObject
		}
		return { instance: existingInstance, reused: true, replaced: false, shouldRemoveExisting: false }
	}

	if (existingInstance) {
		removeBodiesFromWorld(world, existingInstance.bodies?.length ? existingInstance.bodies : [existingInstance.body])
	}

	const instance: RigidbodyInstance = {
		nodeId: roadNode.id,
		body: entry.bodies[0] as CANNON.Body,
		bodies: entry.bodies,
		object: roadObject,
		orientationAdjustment: null,
		signature: entry.signature,
		syncObjectFromBody: false,
	}

	return { instance, reused: false, replaced: Boolean(existingInstance), shouldRemoveExisting: false }
}
