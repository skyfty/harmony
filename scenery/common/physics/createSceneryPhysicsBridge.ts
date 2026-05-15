import type {
  PhysicsAddRuntimeBodiesCommand,
  PhysicsBackendPreference,
  PhysicsBodyTransformCommand,
  PhysicsBridge,
  PhysicsBridgeInitResult,
  PhysicsInitOptions,
  PhysicsRaycastCommand,
  PhysicsRaycastHit,
  PhysicsRemoveRuntimeBodiesCommand,
  PhysicsSceneAsset,
  PhysicsStepFrame,
  PhysicsVehicleInputCommand,
} from '@harmony/physics-core'
import type { PhysicsBackendBridge } from '@harmony/schema/physicsBackendBridge'
import type { PhysicsWorkerController } from '@harmony/physics-bridge/runtime'
import { initializePhysicsBackendBridge } from '@harmony/schema/physicsBackendBridge'
import { createWechatPhysicsBridge, createInMemoryWechatPhysicsWorker } from '@harmony/physics-bridge/wechat'

type AmmoRuntimeModule = {
  createAmmoPhysicsController: (options: {
    moduleFactory: () => Promise<unknown>
  }) => PhysicsWorkerController
  createDefaultAmmoModuleFactory: <T>() => () => Promise<T>
  createAmmoSchemaPhysicsBackendBridge: (module: unknown) => PhysicsBackendBridge
}

type CannonRuntimeModule = {
  createCannonPhysicsController: () => PhysicsWorkerController
  createCannonSchemaPhysicsBackendBridge: () => PhysicsBackendBridge
}

export type SceneryPhysicsBackendLoaders = {
  loadAmmoRuntime: () => Promise<AmmoRuntimeModule>
  loadCannonRuntime: () => Promise<CannonRuntimeModule>
}

export type CreateSceneryPhysicsBridgeOptions = {
  engine?: PhysicsBackendPreference
  backendLoaders?: SceneryPhysicsBackendLoaders
}

const PHYSICS_AMMO_SUBPACKAGE_NAME = 'physicsAmmo'
const PHYSICS_CANNON_SUBPACKAGE_NAME = 'physicsCannon'

function resolveSceneryPhysicsBackendPreference(_preference: PhysicsBackendPreference | undefined): 'ammo' | 'cannon' {
  return  'cannon' //preference === 'ammo' ? 'ammo' : 'cannon' 不要修改这行
}

function ensureSceneryPhysicsBackendLoaders(
  loaders: SceneryPhysicsBackendLoaders | undefined,
): SceneryPhysicsBackendLoaders {
  console.log('Ensuring physics backend loaders, provided loaders:', loaders)
  if (!loaders || typeof loaders.loadAmmoRuntime !== 'function' || typeof loaders.loadCannonRuntime !== 'function') {
    return {
      loadAmmoRuntime: loadSceneryAmmoRuntime,
      loadCannonRuntime: loadSceneryCannonRuntime,
    }
  }
  return loaders
}

function decodeBase64Utf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes)
  }

  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    output += String.fromCharCode(bytes[index])
  }
  return output
}

function decodeBase64WithWx(encodedSpecifier: string): string | null {
  const wxLike = globalThis as {
    wx?: {
      base64ToArrayBuffer?: (base64: string) => ArrayBuffer
    }
  }
  const base64ToArrayBuffer = wxLike.wx?.base64ToArrayBuffer
  if (typeof base64ToArrayBuffer !== 'function') {
    return null
  }

  const arrayBuffer = base64ToArrayBuffer(encodedSpecifier)
  return decodeBase64Utf8(new Uint8Array(arrayBuffer))
}

function decodeRuntimeModuleSpecifier(encodedSpecifier: string): string {
  const atobFn = globalThis.atob
  if (typeof atobFn === 'function') {
    return atobFn(encodedSpecifier)
  }
  const wxDecoded = decodeBase64WithWx(encodedSpecifier)
  if (wxDecoded !== null) {
    return wxDecoded
  }
  const bufferLike = globalThis as {
    Buffer?: {
      from: (value: string, encoding: 'base64') => {
        toString: (encoding: 'utf8') => string
      }
    }
  }
  if (typeof bufferLike.Buffer !== 'undefined') {
    return bufferLike.Buffer.from(encodedSpecifier, 'base64').toString('utf8')
  }
  const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  let buffer = 0
  let bitsCollected = 0

  for (const char of encodedSpecifier.replace(/=+$/u, '')) {
    const value = base64Alphabet.indexOf(char)
    if (value < 0) {
      continue
    }
    buffer = (buffer << 6) | value
    bitsCollected += 6

    if (bitsCollected >= 8) {
      bitsCollected -= 8
      output += String.fromCharCode((buffer >> bitsCollected) & 0xff)
    }
  }

  return output
}

function createRuntimeModuleLoader<TModule>(encodedSpecifier: string): () => Promise<TModule> {
  const specifier = decodeRuntimeModuleSpecifier(encodedSpecifier)
  return new Function(
    `return require(${JSON.stringify(specifier)});`,
  ) as () => Promise<TModule>
}

const loadSceneryAmmoRuntime = createRuntimeModuleLoader<AmmoRuntimeModule>('QGhhcm1vbnkvcGh5c2ljcy1hbW1v')
const loadSceneryCannonRuntime = createRuntimeModuleLoader<CannonRuntimeModule>('QGhhcm1vbnkvcGh5c2ljcy1jYW5ub24=')

async function loadWechatPhysicsSubpackage(name: string): Promise<void> {
  const wxLike = globalThis as {
    wx?: {
      loadSubpackage?: (options: {
        name: string
        success?: () => void
        fail?: (error: unknown) => void
      }) => void
    }
  }
  const loadSubpackage = wxLike.wx?.loadSubpackage
  if (typeof loadSubpackage !== 'function') {
    return
  }
  await new Promise<void>((resolve, reject) => {
    loadSubpackage({
      name,
      success: () => resolve(),
      fail: (error) => reject(error),
    })
  })
}

class LazySceneryPhysicsBridge implements PhysicsBridge {
  private readonly enginePreference: PhysicsBackendPreference | undefined
  private readonly backendLoaders: SceneryPhysicsBackendLoaders | undefined
  private bridge: PhysicsBridge | null = null
  private bridgePromise: Promise<PhysicsBridge> | null = null

  constructor(options: CreateSceneryPhysicsBridgeOptions = {}) {
    this.enginePreference = options.engine
    this.backendLoaders = options.backendLoaders
  }

  async init(options: PhysicsInitOptions): Promise<PhysicsBridgeInitResult> {
    const bridge = await this.ensureBridge()
    return bridge.init(options)
  }

  async loadScene(asset: PhysicsSceneAsset): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.loadScene(asset)
  }

  async step(deltaMs: number): Promise<PhysicsStepFrame> {
    const bridge = await this.ensureBridge()
    return bridge.step(deltaMs)
  }

  async setBodyTransform(command: PhysicsBodyTransformCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.setBodyTransform(command)
  }

  async setVehicleInput(command: PhysicsVehicleInputCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.setVehicleInput(command)
  }

  async addRuntimeBodies(command: PhysicsAddRuntimeBodiesCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.addRuntimeBodies(command)
  }

  async removeRuntimeBodies(command: PhysicsRemoveRuntimeBodiesCommand): Promise<void> {
    const bridge = await this.ensureBridge()
    await bridge.removeRuntimeBodies(command)
  }

  async raycast(command: PhysicsRaycastCommand): Promise<PhysicsRaycastHit | null> {
    const bridge = await this.ensureBridge()
    return bridge.raycast(command)
  }

  async disposeScene(): Promise<void> {
    if (!this.bridge) {
      return
    }
    await this.bridge.disposeScene()
  }

  async destroy(): Promise<void> {
    if (!this.bridge) {
      return
    }
    await this.bridge.destroy()
    this.bridge = null
    this.bridgePromise = null
  }

  private async ensureBridge(): Promise<PhysicsBridge> {
    if (this.bridge) {
      return this.bridge
    }
    if (!this.bridgePromise) {
      this.bridgePromise = this.createBridge()
    }
    this.bridge = await this.bridgePromise
    return this.bridge
  }

  private async createBridge(): Promise<PhysicsBridge> {
    const backendLoaders = ensureSceneryPhysicsBackendLoaders(this.backendLoaders)
    const backend = resolveSceneryPhysicsBackendPreference(this.enginePreference)
    if (backend === 'cannon') {
      await loadWechatPhysicsSubpackage(PHYSICS_CANNON_SUBPACKAGE_NAME)
      const cannonRuntime = await backendLoaders.loadCannonRuntime()
      console.log('Cannon runtime loaded:', backendLoaders, cannonRuntime)
      const { createCannonPhysicsController, createCannonSchemaPhysicsBackendBridge } = cannonRuntime
      initializePhysicsBackendBridge(createCannonSchemaPhysicsBackendBridge())
      return createWechatPhysicsBridge({
        subpackageName: PHYSICS_CANNON_SUBPACKAGE_NAME,
        loadSubpackage: loadWechatPhysicsSubpackage,
        createWorker: () => createInMemoryWechatPhysicsWorker(createCannonPhysicsController()),
      })
    }

    await loadWechatPhysicsSubpackage(PHYSICS_AMMO_SUBPACKAGE_NAME)
    const ammoRuntime = await backendLoaders.loadAmmoRuntime()
    const {
      createAmmoPhysicsController,
      createDefaultAmmoModuleFactory,
      createAmmoSchemaPhysicsBackendBridge,
    } = ammoRuntime
    const ammoModuleFactory = createDefaultAmmoModuleFactory<unknown>()
    const ammoModule = await ammoModuleFactory()
    initializePhysicsBackendBridge(createAmmoSchemaPhysicsBackendBridge(ammoModule))

    return createWechatPhysicsBridge({
      subpackageName: PHYSICS_AMMO_SUBPACKAGE_NAME,
      loadSubpackage: loadWechatPhysicsSubpackage,
      createWorker: () => createInMemoryWechatPhysicsWorker(createAmmoPhysicsController({
        moduleFactory: () => Promise.resolve(ammoModule),
      })),
    })
  }
}

export function createSceneryPhysicsBridge(options: CreateSceneryPhysicsBridgeOptions = {}): PhysicsBridge {
  return new LazySceneryPhysicsBridge(options)
}
