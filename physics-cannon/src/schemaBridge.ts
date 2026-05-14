import {
	createCannonRigidbodyBody,
	ensureCannonWorld,
	extractCannonRoadHeightfieldDebugSurfaces,
	normalizeCannonShapeScale,
} from './index'
import type {
	BackendRigidbodyCreateParams,
	EnsurePhysicsWorldParams,
	BackendRigidbodyResult,
	PhysicsBackendBridge,
	PhysicsBodyLike,
	PhysicsWorldLike,
	RoadHeightfieldDebugSurface,
} from '@harmony/physics-bridge'

export function createCannonSchemaPhysicsBackendBridge(): PhysicsBackendBridge {
	const heightfieldOrientationAdjustment = {
		three: { x: -0.7071067811865475, y: 0, z: 0, w: 0.7071067811865476 },
		threeInverse: { x: 0.7071067811865475, y: 0, z: 0, w: 0.7071067811865476 },
	}

	function createRigidbodyBody(params: BackendRigidbodyCreateParams): BackendRigidbodyResult {
		const cannonBody = createCannonRigidbodyBody(params as unknown as Parameters<typeof createCannonRigidbodyBody>[0])
		const hasHeightfield = params.shapes.some((binding) => binding.definition.kind === 'heightfield')
		return {
			body: cannonBody as unknown as PhysicsBodyLike,
			orientationAdjustment: hasHeightfield ? (heightfieldOrientationAdjustment as any) : null,
		} as BackendRigidbodyResult
	}

	function ensurePhysicsWorld(params: EnsurePhysicsWorldParams): PhysicsWorldLike {
		const cannonWorld = ensureCannonWorld(params as unknown as Parameters<typeof ensureCannonWorld>[0])
		return {
			addBody(body) {
				cannonWorld.addBody(body as unknown as Parameters<typeof cannonWorld.addBody>[0])
			},
			removeBody(body) {
				cannonWorld.removeBody?.(body as unknown as Parameters<typeof cannonWorld.removeBody>[0])
			},
			addContactMaterial(contactMaterial) {
				cannonWorld.addContactMaterial?.(
					contactMaterial as unknown as Parameters<typeof cannonWorld.addContactMaterial>[0],
				)
			},
			defaultMaterial: cannonWorld.defaultMaterial,
		}
	}

	function extractRoadHeightfieldDebugSurfaces(bodies: PhysicsBodyLike[]): RoadHeightfieldDebugSurface[] {
		return extractCannonRoadHeightfieldDebugSurfaces(
			bodies as unknown as Parameters<typeof extractCannonRoadHeightfieldDebugSurfaces>[0],
		) as RoadHeightfieldDebugSurface[]
	}

	return {
		id: 'cannon' as const,
		normalizeShapeScale: normalizeCannonShapeScale,
		createRigidbodyBody,
		ensurePhysicsWorld,
		extractRoadHeightfieldDebugSurfaces,
	}
}
