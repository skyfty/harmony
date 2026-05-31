# Multiuser Scene Validation

This guide verifies the scene-level multi-user flow after the `Multiuser` node, `server`, `tour`, and `scenery` changes.

## What To Check

- A scene only enters multi-user mode when it contains a `Multiuser` node with an enabled `online` component.
- Two logged-in users entering the same scene receive each other's snapshots.
- The active subject is the driven vehicle when the user is driving, otherwise the character/protagonist.
- Remote peers are visual-only and do not participate in physics or control.

## Local Setup

1. Start the `server` package.
2. Start the `tour` package.
3. Open the same scene in two separate clients.
4. Use two different logged-in users if possible.

## Manual Test Cases

### 1. Scene Without Multiuser

- Open a scene that does not contain a `Multiuser` node.
- Confirm no websocket connection is created for multi-user sync.
- Confirm the scene behaves exactly like the single-player flow.

### 2. Scene With Multiuser Enabled

- Open a scene that contains a `Multiuser` node with a reachable server endpoint.
- Confirm the scene joins a room keyed by `sceneId`.
- Confirm the first client receives a `welcome` message and starts sending `state` updates.

### 3. Two Clients In One Scene

- Join the same scene from client A and client B.
- Confirm client B receives client A as a remote peer.
- Confirm client A receives client B as a remote peer.
- Confirm the remote peer is rendered as a proxy object and does not react to local physics.

### 4. Vehicle Versus Character Sync

- Put client A into driving mode.
- Move the driven vehicle and confirm client B sees the vehicle transform update.
- Stop driving or switch back to the character.
- Confirm the subject type changes to character on the next state update.

### 5. Scene Switch And Disconnect

- Leave the scene or close one client.
- Confirm the other client receives `peer-left`.
- Open a different scene.
- Confirm the previous room is cleaned up and no remote peer remains visible.

## Notes

- `vehicleIdentifier` is the preferred stable hint for matching remote vehicle prefabs.
- If a remote vehicle prefab cannot be resolved, the viewer falls back to a visual placeholder.
- The server does not simulate physics. It only stores room membership and relays snapshots.
