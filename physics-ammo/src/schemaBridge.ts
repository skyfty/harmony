import { createAmmoVector3, type AmmoApi } from './ammoHelpers'
import type {
  EnsurePhysicsWorldParams,
  PhysicsBackendBridge,
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

	return {
		id: 'ammo' as const,
		ensurePhysicsWorld,
	}
}

type AmmoBridgeBodyLike = PhysicsBodyLike & {
	__ammoBody?: unknown
}
