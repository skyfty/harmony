import { createAmmoVector3, type AmmoApi } from './ammoHelpers'
import { createAmmoSchemaRigidBody } from './schemaRigidBodyFactory'
import type {
  BackendRigidbodyCreateParams,
  EnsurePhysicsWorldParams,
  PhysicsBackendBridge,
  PhysicsBackendShapeScaleLike,
  PhysicsBodyLike,
  PhysicsWorldLike,
} from '@harmony/physics-bridge'

type AmmoSchemaBridge = PhysicsBackendBridge

export function createAmmoSchemaPhysicsBackendBridge(ammo: AmmoApi): AmmoSchemaBridge {
	const state: {
		world: any | null
		worldWrapper: { addBody: (body: any) => void; removeBody: (body: any) => void } | null
	} = {
		world: null,
		worldWrapper: null,
	}

	function normalizeShapeScale(scaleLike: PhysicsBackendShapeScaleLike): { x: number; y: number; z: number } {
		return {
			x: typeof scaleLike?.x === 'number' && Number.isFinite(scaleLike.x) && Math.abs(scaleLike.x) > 0 ? Math.abs(scaleLike.x) : 1,
			y: typeof scaleLike?.y === 'number' && Number.isFinite(scaleLike.y) && Math.abs(scaleLike.y) > 0 ? Math.abs(scaleLike.y) : 1,
			z: typeof scaleLike?.z === 'number' && Number.isFinite(scaleLike.z) && Math.abs(scaleLike.z) > 0 ? Math.abs(scaleLike.z) : 1,
		}
	}

	function ensurePhysicsWorld(params: EnsurePhysicsWorldParams): PhysicsWorldLike {
		if (state.worldWrapper) {
			return state.worldWrapper
		}
		const collisionConfiguration = new ammo.btDefaultCollisionConfiguration()
		const dispatcher = new ammo.btCollisionDispatcher(collisionConfiguration)
		const broadphase = new ammo.btDbvtBroadphase()
		const solver = new ammo.btSequentialImpulseConstraintSolver()
		const world = new ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, collisionConfiguration)
		const gravity = createAmmoVector3(ammo, params.gravity)
		world.setGravity(gravity)
		ammo.destroy(gravity)
		state.world = world
		state.worldWrapper = {
			addBody(body: PhysicsBodyLike) {
				world.addRigidBody((body as AmmoBridgeBodyLike).__ammoBody ?? (body as any))
			},
			removeBody(body: PhysicsBodyLike) {
				world.removeRigidBody((body as AmmoBridgeBodyLike).__ammoBody ?? (body as any))
			},
		}
		return state.worldWrapper
	}

	function createRigidbodyBody(params: BackendRigidbodyCreateParams): any {
		console.info('[AmmoSchemaBridge] createRigidbodyBody is using a default world. It is recommended to create a world first and pass it in the params for better performance.')
		const world = params.world ?? ensurePhysicsWorld({
			world: null,
			setWorld() {},
			gravity: [0, -9.81, 0],
			solverIterations: 10,
			solverTolerance: 0.0001,
			contactFriction: 0.3,
			contactRestitution: 0.2,
			contactSettings: params.contactSettings,
			rigidbodyMaterialCache: params.rigidbodyMaterialCache,
			rigidbodyContactMaterialKeys: params.rigidbodyContactMaterialKeys,
		})
		const assembly = createAmmoSchemaRigidBody(ammo, {
			world,
			mass: params.mass,
			bodyType: params.bodyType,
			shapes: params.shapes,
			shapeScale: normalizeShapeScale(params.shapeScale),
			rigidbodyMaterialCache: params.rigidbodyMaterialCache,
			rigidbodyContactMaterialKeys: params.rigidbodyContactMaterialKeys,
			friction: params.friction,
			restitution: params.restitution,
			contactSettings: params.contactSettings,
			name: params.name,
		})
		return {
			body: assembly.body,
			orientationAdjustment: null,
		}
	}

	return {
		id: 'ammo' as const,
		normalizeShapeScale,
		createRigidbodyBody,
		ensurePhysicsWorld,
	}
}

type AmmoBridgeBodyLike = PhysicsBodyLike & {
	__ammoBody?: unknown
}
