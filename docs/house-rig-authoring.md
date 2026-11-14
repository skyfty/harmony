# House Rig Authoring

House Rig is a shared runtime component for imported static house white models. It applies a deterministic deformation plan from the GLB rest geometry. Deformed vertices are never persisted into the scene document.

## Blender Export Contract

- Export one root model with stable mesh names. Local axes after glTF import are `X=width`, `Y=height`, `Z=depth`.
- Canonical names use `<role>-<side>-<layer>`, for example `wall-front-inner` and `roof-back-outer`.
- Supported Chinese aliases include `墙-前-内`, `墙-后-外`, `墙-左-内`, and `墙-右-外`.
- `屋顶-*` and the legacy `墙-上-*` names map to roof parts.
- Optional glTF extras can override inference: `houseRigRole`, `houseRigSide`, and `houseRigLayer`.
- Unknown meshes stay rigid and generate a validation warning. Add an alias or a model-specific script for complex parts.

## Script Layout

Scripts are compiled into the shared schema and therefore work in Editor, Preview, and SceneryViewer.

```text
schema/houseRig/scripts/<script-id>/v<version>.ts
```

Each script implements `HouseRigScript`:

- `getCompatibility(asset)` checks asset/topology/part requirements.
- `buildPlan(rest, dimensions)` is a pure, deterministic calculation from the immutable rest snapshot.
- The returned plan contains root-local vertex positions, optional UVs, three handle anchors, bounds, and warnings.
- Scripts must not mutate scene nodes, materials, global state, or runtime objects.

Register every version explicitly in `schema/houseRig/registry.ts`. Existing prefabs pin `scriptId@scriptVersion`; publish a new version instead of changing an already-used version.

## Codex Workflow

1. Select the imported model node and call `harmony_house_rig_edit` with `action: "inspect"`.
2. Use the returned mesh names, object paths, roles, vertex counts, bounds, and material keys to plan the deformation.
3. Add or update a versioned script under the shared schema directory and add a regression fixture.
4. Build the schema and reload the Editor.
5. Call `validate`, then test width, depth, and wall-height values.
6. Capture the viewport and verify roof shape, wall thickness, seam alignment, and texture density.
7. Save the scene or prefab only after readback and visual verification.

## Default Behavior

- `basic-naming@1.0.0` deforms canonical walls and roofs. Wall bases stay fixed, wall tops follow height changes, and roof geometry keeps its shape while moving with the eave.
- Width and depth use one shared footprint mapping for every wall and roof part. Do not translate normal-facing walls separately from tangent walls; that opens corner seams under large expansions.
- `current-ten-part-house@1.0.0` pins compatibility to the current ten-plane Blender fixture.
- Dimension limits default to 35%-250% of the imported rest dimensions with 0.01 m steps.
