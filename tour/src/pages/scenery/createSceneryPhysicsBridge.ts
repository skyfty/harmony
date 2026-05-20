import type { PhysicsBackendPreference, PhysicsBridge } from '@harmony/physics-core';
import type { PhysicsBackendBridge } from '@harmony/physics-bridge';
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime';
import { initializePhysicsBackendBridge } from '@harmony/schema/physicsBackendBridge';
import { createInMemoryWechatPhysicsWorker, createWechatPhysicsBridge } from '@harmony/physics-bridge/wechat';

type LoadedPhysicsBackend = LoadedAmmoPhysicsBackend | LoadedCannonPhysicsBackend;
type LoadedAmmoPhysicsBackend = {
  subpackageName: 'physics-ammo';
  schemaBridge: PhysicsBackendBridge;
  createController: () => PhysicsWorkerController;
};
type LoadedCannonPhysicsBackend = {
  subpackageName: 'physics-cannon';
  schemaBridge: PhysicsBackendBridge;
  createController: () => PhysicsWorkerController;
};

export async function createSceneryPhysicsBridge(engine?: PhysicsBackendPreference): Promise<PhysicsBridge> {
  const resolvedEngine = resolvePhysicsBackendId(engine);
  const backend = await loadPhysicsBackend(resolvedEngine);
  initializePhysicsBackendBridge(backend.schemaBridge);

  return createWechatPhysicsBridge({
    subpackageName: backend.subpackageName,
    loadSubpackage: loadWechatSubpackage,
    createWorker: () => createInMemoryWechatPhysicsWorker(backend.createController()),
  });
}

function resolvePhysicsBackendId(engine: PhysicsBackendPreference | undefined): Extract<PhysicsBackendPreference, 'ammo' | 'cannon'> {
  return engine === 'ammo' ? 'ammo' : 'cannon';
}

function loadWechatSubpackage(name: string): Promise<void> {
  const wxAny = typeof wx !== 'undefined' ? (wx as typeof wx & { loadSubpackage?: (...args: any[]) => any }) : null;
  if (!wxAny || typeof wxAny.loadSubpackage !== 'function') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const task = wxAny.loadSubpackage({
      name,
      success: () => resolve(),
      fail: (error: unknown) => reject(error),
    });
    task?.onError?.((error: unknown) => reject(error));
  });
}

async function loadPhysicsBackend(
  engine: Extract<PhysicsBackendPreference, 'ammo' | 'cannon'>,
): Promise<LoadedPhysicsBackend> {
  if (engine === 'ammo') {
    const ammoSource = await import('../physics-ammo/runtime');
    const backend = await ammoSource.createAmmoPhysicsBackend();
    return {
      subpackageName: 'physics-ammo',
      schemaBridge: backend.schemaBridge,
      createController: backend.createController,
    };
  }

  const cannonSource = await import('../physics-cannon/runtime');
  const backend = await cannonSource.createCannonPhysicsBackend();
  return {
    subpackageName: 'physics-cannon',
    schemaBridge: backend.schemaBridge,
    createController: backend.createController,
  };
}
