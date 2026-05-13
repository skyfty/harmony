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
	function createRigidbodyBody(params: BackendRigidbodyCreateParams): BackendRigidbodyResult {
		const cannonBody = createCannonRigidbodyBody(params as unknown as Parameters<typeof createCannonRigidbodyBody>[0])
		return {
			body: cannonBody as unknown as PhysicsBodyLike,
		}
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
