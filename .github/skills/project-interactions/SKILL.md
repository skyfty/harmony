---
name: harmony-project-interactions
description: Base skill for designing and extending interaction flows in the Harmony monorepo.
---

# Harmony Project Interactions

Use this skill when adding or changing interaction-driven behavior in the Harmony workspace.

## Scope
- Applies to `editor/`, `admin/`, `uploader/`, `viewer/`, `exhibition/`, `server/`, `schema/`, and shared tooling.
- Prefer existing patterns before introducing new abstractions.
- Keep changes minimal, consistent, and aligned with repository conventions.

## Repo Anchors
- `schema/` owns shared data and asset type contracts.
- `server/` owns APIs, storage, and realtime services.
- `editor/`, `admin/`, `uploader/`, `viewer/`, and `exhibition/` are app-specific frontends.
- Frontend runtime config is loaded from `/config/app-config.json`.

## Interaction Workflow
1. Identify the user-facing action and the affected app or package.
2. Trace the data path: UI -> store or composable -> schema -> server -> persistence.
3. Reuse existing utilities, routes, and validation before adding new ones.
4. Update related previews, drag and drop behavior, permissions, and error handling together.
5. Verify with the smallest relevant build or test command.

## Common Commands
- `cd editor && pnpm run build`
- `cd admin && pnpm run build`
- `cd server && pnpm run build`
- `cd viewer && pnpm run dev:mp-weixin`
- `cd exhibition && pnpm run dev:mp-weixin`

## Future Interaction Slots
Add new interaction recipes here as the project grows:
- Trigger:
- Entry points:
- Related state:
- Required server changes:
- Validation:
- Risks:

## Editor Tool Usage Hints
Use this recipe when adding, removing, or changing build/ground tools in `editor/`.

- Goal: keep the lower-left usage hints in sync with the actual tool behavior and shortcut keys.
- Primary files:
	- `editor/src/components/editor/SceneViewport.vue` for the HUD rendering and active-tool state wiring.
	- `editor/src/components/editor/toolUsageHints.ts` for the centralized hint metadata and resolver.
	- Tool implementations such as `WallBuildTool.ts`, `FloorBuildTool.ts`, `LandformBuildTool.ts`, `RoadBuildTool.ts`, `RegionBuildTool.ts`, `GuideRouteBuildTool.ts`, `WaterBuildTool.ts`, `DisplayBoardBuildTool.ts`, `BoundaryWallBuildTool.ts`, and related pointer handlers.
- Update steps:
	1. Inspect the affected tool's pointer, cancel, double-click, drag, and modifier-key behavior.
	2. Update `toolUsageHints.ts` so the hint text matches the real interaction flow.
	3. If the tool exposes a new submode or state flag, pass it from `SceneViewport.vue` into the hint resolver.
	4. Keep the HUD controlled by the existing "镜头控制与导航快捷键" toggle unless the product requirement explicitly changes that behavior.
	5. Validate with the smallest relevant editor build or type-check command.
- Shortcut guidance:
	- Never invent keyboard shortcuts that do not exist in code.
	- Prefer wording that mirrors the real pointer flow: click, drag, double-click, right-click cancel, Escape cancel, Delete/Backspace delete, and modifier keys such as Shift/Ctrl/Cmd.
	- If a tool supports shape-specific behavior, include the shape name in the title or first hint row.
- Regression checks:
	- Confirm the HUD still collapses cleanly on narrow viewports.
	- Confirm the hint toggle affects both camera help and tool usage hints consistently.
	- Confirm newly added tools appear in the resolver with a sensible fallback instead of an empty panel.

## Output Rules
- Prefer concise, actionable responses.
- Mention exact file paths when proposing changes.
- Call out assumptions and missing context early.
