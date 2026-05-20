# Physics Platform Architecture Plan

## Goal

Build a reusable physics platform for the Harmony scene runtime that:

1. decouples scene rendering and gameplay runtime from any specific physics engine
2. supports multiple engines such as `cannon-es`, adapter-backed Ammo, and future engines
3. works across multiple consumers, including:
   - WeChat mini programs
   - other mini program platforms
   - H5
   - future app runtimes
4. allows each host app to choose packaging and loading strategy per platform
5. solves current WeChat subpackage size issues as one result of the refactor, not as the only target

## Core Principle

Do not design physics delivery around a single app such as `tour`.

Instead:

- put engine-agnostic contracts and orchestration in shared layers under `schema`
- keep `scenery` focused on viewer/runtime composition
- let each consumer app decide how to package and load engine adapters

That means the primary refactor target is the shared architecture, not `tour` alone.

## Current Problem

Today, the physics runtime is deeply coupled to `cannon-es` in shared code.

Confirmed direct `cannon-es` imports exist in:

- `schema/physicsEngine.ts`
- `schema/autoTourRuntime.ts`
- `schema/compiledGroundCollisionRuntime.ts`
- `schema/infiniteGroundChunkCollisions.ts`
- `schema/VehicleDriveController.ts`
- `schema/purePursuitRuntime.ts`
- `schema/scenePreviewPerf.ts`
- `schema/airWall.ts`
- `schema/boundaryWall.ts`
- `schema/roadHeightfield.ts`
- `scenery/components/SceneryViewer.vue`

This creates three problems:

1. viewer runtime and engine runtime are packaged together
2. shared code cannot switch engines cleanly
3. any host app that consumes `scenery` is forced to inherit the current Cannon packaging model

## Target Architecture

Split the current runtime into five layers.

### 1. Scene Runtime Core

Location:

- `scenery/*`
- parts of `schema/*` that are not physics-specific

Responsibility:

- scene loading
- object graph registration
- rendering
- UI overlays
- input
- camera
- behavior orchestration

Rule:

- must not import any concrete physics engine package

### 2. Physics Contract Layer

Location:

- `schema/physics/contract/*`

Responsibility:

- shared types
- engine-neutral handles
- capabilities
- adapter interfaces
- loader contracts

Rule:

- no `cannon-es`
- no legacy Ammo package
- no platform-specific packaging logic

### 3. Physics Runtime Core

Location:

- `schema/physics/runtime/*`

Responsibility:

- rigidbody lifecycle orchestration
- world lifecycle orchestration
- transform synchronization
- interpolation state
- vehicle runtime orchestration
- compiled ground collider orchestration
- infinite ground collider orchestration

Rule:

- may depend on `contract`
- must not depend on concrete engine packages

### 4. Engine Adapters

Location:

- `schema/physics/engines/cannon/*`
- `schema/physics/engines/ammo/*`
- `schema/physics/engines/noop/*`

Responsibility:

- concrete engine bindings
- shape creation
- world creation
- body creation
- stepping
- vehicle implementation
- debug snapshots

Rule:

- all `cannon-es` and Ammo imports must be isolated here

### 5. Host Integration Layer

Location depends on host app:

- `tour/src/physics/*`
- future `viewer/src/physics/*`
- future miniapp app roots
- H5 host entrypoints

Responsibility:

- select engine by platform and capability
- choose loading strategy
- choose packaging strategy
- preload engine bundles if needed

Rule:

- this is where mini program subpackage logic belongs
- not in `schema`

## Recommended Directory Structure

```text
schema/
  physics/
    contract/
      adapter.ts
      capabilities.ts
      handles.ts
      loader.ts
      types.ts
    runtime/
      physicsHost.ts
      worldRuntime.ts
      rigidbodyRuntime.ts
      interpolationRuntime.ts
      vehicleRuntime.ts
      compiledGroundRuntime.ts
      infiniteGroundRuntime.ts
    engines/
      noop/
        adapter.ts
      cannon/
        adapter.ts
        world.ts
        body.ts
        shapes.ts
        vehicle.ts
        debug.ts
      ammo/
        adapter.ts
        world.ts
        body.ts
        shapes.ts
        vehicle.ts
        debug.ts

scenery/
  composables/
    usePhysicsHost.ts
  components/
    SceneryViewer.vue

tour/
  src/
    physics/
      engineSelector.ts
      engineLoader.wechat.ts
      engineLoader.h5.ts

viewer/
  src/
    physics/
      engineSelector.ts
      engineLoader.ts
```

## Adapter Contract

Suggested minimum contract:

```ts
export type PhysicsEngineId = 'none' | 'cannon' | 'ammo'

export interface PhysicsAdapter {
  readonly id: PhysicsEngineId
  readonly capabilities: PhysicsCapabilities

  createWorld(options: PhysicsWorldOptions): PhysicsWorldHandle
  disposeWorld(world: PhysicsWorldHandle): void

  createBody(input: PhysicsBodyCreateInput): PhysicsBodyHandle | null
  removeBody(world: PhysicsWorldHandle, body: PhysicsBodyHandle): void

  step(world: PhysicsWorldHandle, deltaSeconds: number, options: PhysicsStepOptions): PhysicsStepResult

  syncBodyFromObject(
    body: PhysicsBodyHandle,
    object: THREE.Object3D,
    orientation?: PhysicsOrientationAdjustment | null,
  ): void

  syncObjectFromBody(
    body: PhysicsBodyHandle,
    object: THREE.Object3D,
    orientation?: PhysicsOrientationAdjustment | null,
  ): void

  createVehicle?(input: PhysicsVehicleCreateInput): PhysicsVehicleHandle | null
  removeVehicle?(world: PhysicsWorldHandle, vehicle: PhysicsVehicleHandle): void

  createDebugSnapshot?(world: PhysicsWorldHandle): PhysicsDebugSnapshot | null
}
```

Important rule:

- outside engine adapter files, do not expose `CANNON.World`, `CANNON.Body`, `CANNON.RaycastVehicle`, `Ammo.btRigidBody`, or any other engine-native class

## Engine-Neutral Shared Runtime

The following logic should move out of engine-specific files and into runtime-core modules:

- when to create a world
- when to remove/reset the world
- when to create/remove rigidbodies based on scene document changes
- when to sync render object transforms to/from physics
- interpolation bookkeeping
- host-visible debug toggles
- vehicle feature gating
- collider source orchestration for:
  - compiled ground
  - runtime ground chunks
  - roads
  - boundary walls

The following logic should stay engine-specific:

- actual shape construction
- actual world stepping
- engine material/contact configuration
- engine vehicle setup
- engine-native debug inspection

## Scenery Integration

`SceneryViewer.vue` should depend on a physics host, not on Cannon.

Target pattern:

```ts
const physicsHost = await ensurePhysicsHost()

physicsHost.configure({
  environment,
  interpolation,
})

physicsHost.syncDocument({
  document,
  nodeObjectMap,
})

physicsHost.step(deltaSeconds)
```

The viewer should not know whether the active implementation is:

- no-op
- Cannon
- Ammo

## Platform Integration Model

Each host app provides its own engine selection and loading policy.

### Shared Selection Contract

```ts
export type PhysicsPlatform = 'mp-weixin' | 'mp-alipay' | 'mp-douyin' | 'h5' | 'app'

export type PhysicsSelectionContext = {
  platform: PhysicsPlatform
  wasmSupported: boolean
  workerSupported: boolean
  lowMemoryMode: boolean
  sceneHints?: {
    requiresVehicle?: boolean
    requiresHeightfield?: boolean
  }
}

export function selectPhysicsEngine(ctx: PhysicsSelectionContext): PhysicsEngineId
```

### Example Policy

- WeChat mini program: default to `cannon`
- H5 desktop: prefer `ammo`
- weak mobile H5: fallback to `cannon` or `none`
- unsupported platforms: `none`

This policy should live in each host app, or in a small shared host helper, not in core `schema`.

## Packaging Strategy By Environment

### WeChat Mini Program

Use async engine loading and subpackage separation if package size requires it.

Important constraint:

- ordinary subpackages cannot keep static synchronous cross-subpackage JS dependencies
- therefore the viewer subpackage must not statically import engine code

Recommended approach:

- keep viewer core in the scene subpackage
- keep engine adapter code in engine subpackages
- load engine adapter asynchronously through host loader

### Other Mini Programs

Do not assume the same packaging model as WeChat.

Some platforms may support:

- different package size rules
- different async loading capabilities
- different WASM behavior

Therefore:

- abstract the loader contract
- implement one loader per platform

### H5

H5 does not need subpackages, but still benefits from code splitting.

Recommended approach:

- load engine adapters via dynamic `import()`
- use route-level or scene-level lazy loading
- optionally preload selected engine when entering a viewer route

### Native/App Future

Keep the same host contract.

The native host can:

- bundle one default engine eagerly
- lazy load secondary engines
- override engine selection via config

## Migration Plan

### Phase 1. Extract Contracts

Create:

- `schema/physics/contract/*`
- `schema/physics/engines/noop/adapter.ts`

Then:

- define adapter and handle interfaces
- define capability flags
- add no-op implementation

Exit criteria:

- shared physics contracts compile
- no-op engine can be used by viewer runtime

### Phase 2. Introduce Physics Host

Create:

- `schema/physics/runtime/physicsHost.ts`
- `scenery/composables/usePhysicsHost.ts`

Then:

- make `SceneryViewer.vue` use the host
- keep behavior unchanged by temporarily wrapping Cannon behind the host

Exit criteria:

- `SceneryViewer.vue` no longer imports `cannon-es`

### Phase 3. Move Cannon Into Adapter

Refactor:

- `schema/physicsEngine.ts`
- `schema/autoTourRuntime.ts`
- `schema/compiledGroundCollisionRuntime.ts`
- `schema/infiniteGroundChunkCollisions.ts`
- `schema/VehicleDriveController.ts`
- `schema/purePursuitRuntime.ts`
- `schema/scenePreviewPerf.ts`

Goal:

- shared runtime depends on interfaces only
- Cannon-specific logic lives only in `schema/physics/engines/cannon/*`

Exit criteria:

- `rg "cannon-es" schema scenery` only matches Cannon adapter files

### Phase 4. Add Host-Specific Loaders

Per host app, add:

- engine selector
- engine loader
- preload policy

For `tour`, this is where WeChat subpackage logic belongs.
For H5 consumers, this is where dynamic import logic belongs.

Exit criteria:

- one shared runtime
- multiple host-specific loading strategies

### Phase 5. Add Ammo Adapter

Implement:

- `schema/physics/engines/ammo/*`

Expose capabilities honestly:

- if a feature is not yet supported, report it and let runtime degrade gracefully

Exit criteria:

- platform can select Cannon or Ammo without changing viewer business logic

## Compatibility Strategy

Do not force every engine to emulate every advanced feature immediately.

Instead, define capability flags such as:

- `rigidbody`
- `heightfield`
- `convex`
- `raycastVehicle`
- `sleep`
- `debugSnapshot`
- `interpolation`

The runtime should:

- enable features when supported
- degrade cleanly when unsupported

Example:

- if `raycastVehicle` is unsupported, vehicle drive can be disabled with a host-visible reason

## Refactor Boundaries

### Keep In Shared Core

- scene node scanning
- rigidbody component resolution
- shape descriptor generation from scene data
- runtime synchronization policy
- physics lifecycle orchestration

### Move Out To Engine Adapters

- `instanceof CANNON.*` logic
- Cannon world creation
- Cannon shape creation
- Cannon contact material setup
- Cannon vehicle creation
- Cannon body stepping

### Move Out To Host Apps

- WeChat subpackage declarations
- `require.async` path conventions
- H5 dynamic import policy
- per-platform preload behavior
- bundle chunk routing

## Risks

1. Several shared modules use Cannon native types directly and will need signature changes.
2. Current interpolation caches are keyed by `CANNON.Body`, which must become adapter body handles.
3. Vehicle behavior is Cannon-oriented today and will need a capability-based abstraction.
4. Debug rendering currently relies on engine-native shape inspection in places.
5. Host packaging logic may vary significantly across mini program platforms.

## What This Means For `tour`

`tour` remains an important first consumer, but it should not own the architecture.

`tour` should become:

- the first host implementation of the shared platform contract
- the first place where WeChat subpackage loading is applied
- not the location where engine abstractions are invented

## Success Criteria

1. `schema` and `scenery` can run without hardwiring a specific physics engine.
2. Any host app can choose its engine and loading strategy.
3. WeChat mini program package size can be reduced by moving engine code out of the viewer package.
4. H5 can lazy load physics independently from the viewer core.
5. Adding a new engine does not require changing viewer business logic.

## Recommended Next Step

Start from shared code, not from `tour` build config.

The best first implementation step is:

1. add `schema/physics/contract/*`
2. add `schema/physics/runtime/physicsHost.ts`
3. refactor `scenery/components/SceneryViewer.vue` to consume a host interface
4. only after that, implement host-specific loaders in `tour`, H5, and future miniapps
