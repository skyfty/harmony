import { ensureCannonWorld } from './world'
import { normalizeCannonShapeScale } from './shapeFactory'
import type {
  EnsurePhysicsWorldParams,
  PhysicsBackendBridge,
  PhysicsWorldLike,
} from '@harmony/physics-bridge'

export function createCannonSchemaPhysicsBackendBridge(): PhysicsBackendBridge {



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

  return {
    id: 'cannon' as const,
    ensurePhysicsWorld,
  }
}
