---
name: editor
description: Use for Harmony editor work in `editor/`: Vue 3 scene editor UI, Three.js viewport tools, Pinia scene state, inspector and hierarchy panels, project and scene loading, asset catalog flows, export/import, and `@schema`-backed scene semantics. Keywords: scene editor, viewport, SceneViewport, sceneStore, inspector, hierarchy, prefab, wall, road, floor, ground, terrain, export.
---

# Editor Skill

Use this skill for work in `editor/`: scene editor UI, Three.js viewport behavior, Pinia scene state, project/scene loading, asset flows, export/import, and `@schema` integration.

Do not use it for `server/`, `admin/`, `uploader/`, `viewer/`, or `exhibition/` tasks.

## Core Model

- Bootstrap: `src/main.ts`, `src/App.vue`, `src/router/index.ts`
- Project and scene entry: `src/views/ProjectManagerView.vue`, `src/views/LoadView.vue`, `src/views/EditorView.vue`
- Main state hub: `src/stores/sceneStore.ts`
- Viewport runtime: `src/components/editor/SceneViewport.vue` and `src/components/editor/pointer/*`
- Shared semantics: `schema/`

Rule: if node/component data, runtime mesh generation, serialization, or export semantics are involved, inspect `schema/` before editing editor-only code.

## Read By Task

Boot or routing:

- `editor/src/main.ts`
- `editor/src/views/LoadView.vue`
- `editor/src/views/ProjectManagerView.vue`

Scene state or persistence:

- `editor/src/stores/sceneStore.ts`
- `editor/src/stores/scenesStore.ts`
- `editor/src/stores/projectsStore.ts`

Viewport interaction:

- `editor/src/components/editor/SceneViewport.vue`
- `editor/src/components/editor/pointer/*`
- matching build tool such as `WallBuildTool.ts`, `RoadBuildTool.ts`, `FloorBuildTool.ts`, `WaterBuildTool.ts`, `GroundEditor.ts`

Inspector or hierarchy:

- `editor/src/components/layout/InspectorPanel.vue`
- `editor/src/components/layout/HierarchyPanel.vue`
- target panel under `editor/src/components/inspector/`

Assets or resources:

- `editor/src/stores/assetCatalog.ts`
- `editor/src/stores/assetCacheStore.ts`
- `editor/src/resources/projectProviders/*`
- `editor/src/api/*`

Export or import:

- `editor/src/utils/sceneExport.ts`
- `editor/src/utils/scenePackageExport.ts`
- `editor/src/utils/scenePackageImport.ts`

## Task Patterns

Inspector field change:

1. Update shared type/default/clamp logic in `schema/` if needed.
2. Update store mutation or normalization path.
3. Update the specific inspector panel.
4. Update `InspectorPanel.vue` only if panel switching or visibility changes.

Viewport bug:

1. Trace from `SceneViewport.vue` into pointer handlers or tool files.
2. Check whether the bug is preview-only or persisted state.
3. Fix the commit path in store-backed data, not only the temporary Three.js preview.

Panel or toolbar feature:

1. Add UI in `components/layout/`, `components/editor/`, or `components/inspector/`.
2. Keep mutations centralized in `sceneStore`, `uiStore`, or the relevant support store.

Project/scene load bug:

1. Start with `LoadView.vue`.
2. Inspect `projectsStore`, `scenesStore`, and `sceneStore.selectScene(...)`.
3. Check `api/` when URLs, auth, or remote sync are involved.

Export/import bug:

1. Read the export/import utility.
2. Compare behavior with `schema/` helpers.
3. Validate asset references and generated runtime geometry.

## Working Rules

- Prefer existing store helpers and utilities over new one-off logic.
- Keep state Pinia-first; avoid duplicating scene state in local component refs.
- `@` maps to `editor/src`; `@schema` maps to local `schema/` source.
- The editor build depends on schema build: `pnpm --dir ../schema run build`.
- Runtime config is loaded from `/config/app-config.json` before app mount.

## High-Risk Files

- `editor/src/stores/sceneStore.ts`
- `editor/src/components/editor/SceneViewport.vue`
- `editor/src/views/EditorView.vue`
- `editor/src/components/layout/InspectorPanel.vue`
- `editor/src/components/layout/HierarchyPanel.vue`
- `editor/src/utils/sceneExport.ts`

Read surrounding code before editing these.

## Verification

- Run `cd editor && pnpm run build` for code changes.
- If `schema/` changed, ensure schema still builds because editor depends on it.
- For interaction work, verify the real route and user flow, not just type-checking.

Useful routes:

- project manager: `/#/`
- editor: `/#/editor?projectId=...`
- preview: `/#/preview`

## Expected Output

When using this skill, report:

- which subsystem was inspected
- which files changed or should change
- whether the fix belongs in `editor/` only or also in `schema/`
- what verification ran
- any residual risk around persistence, selection, serialization, or preview-state mismatch