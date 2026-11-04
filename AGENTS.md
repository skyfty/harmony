# Harmony Agent Instructions

## MCP-first scene editing

- For every read or modification of Harmony Editor scene data, use the `harmonyEditor` MCP semantic tools first.
- Do not replace an available MCP operation with mouse or coordinate automation, arbitrary browser JavaScript, direct edits to persisted scene files, or raw JSON Patch.
- If the required scene operation is unavailable or too weak, implement or extend the typed MCP/editor operation first. Add runtime validation, revision checks, transaction and undo behavior, and tests before using the new operation to complete the scene task.
- A source-code change needed to add a missing MCP capability is allowed and should follow the repository's existing editor, schema, bridge, and test patterns.
- Use UI automation only when the MCP operation cannot yet be implemented, is blocked by an external limitation, or the user explicitly requests UI automation. Explain the reason before doing so.

## Required scene-edit workflow

1. Call `harmony_editor_status` and confirm the correct project, scene, readiness, and revision.
2. Query only the nodes, components, schemas, or assets needed for the task.
3. Apply changes through semantic MCP operations with `expectedRevision` and one atomic batch where possible.
4. Wait for pending assets or terrain work, then read back the affected data.
5. Capture a viewport screenshot when visual appearance or placement matters.
6. Save explicitly after verified changes.
7. Undo temporary test changes and verify they are gone.

Use `harmony_camera_control` for camera state and presets, and `harmony_tool_control` for activating viewport transform or build tools. Read the current camera/tool state before changing it and restore temporary test state.

Never report a scene modification as complete if the MCP response failed or the intended change was not observed during readback.
