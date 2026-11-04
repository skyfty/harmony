# Harmony Editor MCP Bridge

The bridge lets Codex and other local agents inspect and edit the currently open Harmony Editor scene through semantic operations instead of mouse automation.

## MCP-first policy

All Harmony-related Agent work must use the semantic MCP tools first:

- Do not use mouse or coordinate automation when an MCP operation can perform the change.
- Do not bypass the bridge by editing persisted scene JSON, running arbitrary page JavaScript, or submitting raw JSON Patch.
- If the required operation is missing, first extend the typed MCP/editor command and add validation, transaction/undo behavior, and tests.
- UI automation is a last resort for an external blocker or an explicit user request, and the reason must be explained.

The same policy is delivered in the MCP server initialization instructions, the Editor bridge capabilities, and the repository [AGENTS.md](../../AGENTS.md). Codex through the MCP bridge is the supported Agent editing path.

## Start

Build the shared protocol and the v2 editor once:

```powershell
pnpm --dir D:\harmony\schema build
pnpm --dir D:\harmony\editor exec vue-tsc -b
pnpm --dir D:\harmony\tools mcp:editor
```

Register the MCP server with Codex:

```powershell
codex mcp add harmonyEditor -- node D:\harmony\tools\editor-mcp\mcp.mjs
```

Restart or open a new Codex task after registering the server. Start the Editor at `http://localhost:8088`. The bottom-right Editor badge shows `Agent connected` when the WebSocket bridge is ready.

## Local JSON-RPC

The bridge listens only on `127.0.0.1:8790`.

```powershell
$token = pnpm --dir D:\harmony\tools mcp:editor:token
$body = @{
  jsonrpc = "2.0"
  id = "status"
  method = "editor.status"
  params = @{}
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8790/rpc `
  -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
  -Body $body
```

## Tools

Read and verification:

- `harmony_editor_status`
- `harmony_editor_wait`
- `harmony_scene_query`
- `harmony_catalog_search`
- `harmony_component_schema`
- `harmony_viewport_screenshot`
- `harmony_camera_control`
- `harmony_tool_control`

Generic writes:

- `harmony_apply_operations`
- `harmony_history`
- `harmony_save_scene`

Domain writes:

- `harmony_builder_edit`
- `harmony_behavior_edit`
- `harmony_guide_route_edit`
- `harmony_terrain_edit`
- `harmony_actor_edit`

Component schemas report whether a component uses generic or domain editing. Generic writes reject protected complex fields with `FIELD_REQUIRES_DOMAIN_TOOL`.

`harmony_camera_control` can read the live Three.js camera or set position, target, FOV, distance, orbit angles, projection, navigation mode, and named presets. `harmony_tool_control` reads and activates the same transform and viewport build tools exposed by the Editor UI.

Examples:

```json
{
  "action": "set",
  "target": { "x": 0, "y": 0, "z": 0 },
  "preset": "isometric",
  "distance": 25,
  "fov": 55
}
```

```json
{
  "action": "set_active",
  "group": "build",
  "tool": "wall"
}
```

Build tool activation uses the Editor's normal cancellation and selection-context path. `tool.set_active` with group `build` and tool `null` deactivates the current build tool and returns to selection.

## Terrain Transition Fitting

`harmony_terrain_edit` supports a deterministic Floor/Region-to-DEM transition workflow:

1. `runtime_stats` checks whether the Procedural Landscape runtime is ready.
2. `analyze_transition` samples the original DEM around the owner polygon and simulates the current smoothstep profile.
3. `fit_transition` widens `edgeBlendWidth` to the smallest candidate that keeps the peak grade within the requested limit.
4. Wait for terrain compilation, read back `runtime_stats`, and capture the viewport.

Example:

```json
{
  "action": "analyze_transition",
  "args": {
    "ownerNodeId": "floor-or-region-node-id",
    "landscapeNodeId": "procedural-landscape-node-id",
    "maxGradeDegrees": 10
  }
}
```

Use the returned `analysis.recommendedBlendWidth` as evidence before calling `fit_transition` with the same arguments and the latest `expectedRevision`. The fit only changes the transition width; it does not move the owner or change its elevation mode.

## Verification

Read-only MCP smoke test:

```powershell
pnpm --dir D:\harmony\tools mcp:editor:smoke
```

The write smoke test creates a temporary group, reads it back, captures the viewport, undoes it, and saves:

```powershell
$env:HARMONY_EDITOR_MCP_SMOKE_WRITE = "1"
pnpm --dir D:\harmony\tools mcp:editor:smoke
```

## Security Defaults

- The bridge binds to `127.0.0.1` only.
- Editor WebSocket origins are allowlisted.
- JSON-RPC requests require the token stored under `%USERPROFILE%\.harmony-editor-agent\token`.
- Only one Editor session and one Agent write lease are active at a time.
- The Editor badge can pause Agent writes without disconnecting read access.
- Project/scene lifecycle, asset upload, and asset generation are not exposed.
