import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const serverPath = fileURLToPath(new URL('./mcp.mjs', import.meta.url))
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
})
const client = new Client({ name: 'harmony-editor-smoke-test', version: '1.0.0' })

try {
  console.error('[smoke] connecting')
  await client.connect(transport)
  const serverInstructions = client.getInstructions() ?? ''
  if (!serverInstructions.includes('MCP semantic tools first')) {
    throw new Error('Harmony MCP-first policy was not delivered during initialization')
  }
  console.error('[smoke] MCP-first policy received')
  console.error('[smoke] listing tools')
  const tools = await client.listTools()
  console.error(`[smoke] received ${tools.tools.length} tools`)
  const names = new Set(tools.tools.map((tool) => tool.name))
  const expected = [
    'harmony_editor_status',
    'harmony_editor_wait',
    'harmony_scene_query',
    'harmony_catalog_search',
    'harmony_component_schema',
    'harmony_apply_operations',
    'harmony_history',
    'harmony_save_scene',
    'harmony_viewport_screenshot',
    'harmony_camera_control',
    'harmony_tool_control',
    'harmony_builder_edit',
    'harmony_behavior_edit',
    'harmony_guide_route_edit',
    'harmony_terrain_edit',
    'harmony_actor_edit',
  ]
  for (const name of expected) {
    if (!names.has(name)) {
      throw new Error(`Missing MCP tool ${name}`)
    }
  }
  console.error('[smoke] waiting for Editor connection')
  let statusPayload = null
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await client.callTool({ name: 'harmony_editor_status', arguments: {} })
    const statusText = status.content?.find((entry) => entry.type === 'text')?.text ?? ''
    const payload = JSON.parse(statusText)
    if (payload.editor?.connection?.sceneId) {
      statusPayload = payload
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!statusPayload) {
    throw new Error('Editor did not connect to the Harmony Agent bridge within 15 seconds')
  }
  console.error('[smoke] Editor connected')
  const camera = await client.callTool({
    name: 'harmony_camera_control',
    arguments: { action: 'get' },
  })
  const cameraText = camera.content?.find((entry) => entry.type === 'text')?.text ?? ''
  const cameraPayload = JSON.parse(cameraText)
  if (!cameraPayload.position || !cameraPayload.target || typeof cameraPayload.fov !== 'number') {
    throw new Error(`Camera state is invalid: ${cameraText}`)
  }
  const toolState = await client.callTool({
    name: 'harmony_tool_control',
    arguments: { action: 'get' },
  })
  const toolStateText = toolState.content?.find((entry) => entry.type === 'text')?.text ?? ''
  const toolStatePayload = JSON.parse(toolStateText)
  if (!toolStatePayload.activeTransformTool || !Array.isArray(toolStatePayload.availableBuildTools)) {
    throw new Error(`Tool state is invalid: ${toolStateText}`)
  }
  console.error('[smoke] querying scene')
  const query = await client.callTool({
    name: 'harmony_scene_query',
    arguments: { limit: 1, includeComponents: false },
  })
  console.error('[smoke] received scene query')
  const queryText = query.content?.find((entry) => entry.type === 'text')?.text ?? ''
  const queryPayload = JSON.parse(queryText)
  if (!Array.isArray(queryPayload.nodes)) {
    throw new Error(`Unexpected scene query response: ${queryText}`)
  }
  console.error('[smoke] requesting component schemas')
  const schema = await client.callTool({
    name: 'harmony_component_schema',
    arguments: {},
  })
  const schemaText = schema.content?.find((entry) => entry.type === 'text')?.text ?? ''
  const schemaPayload = JSON.parse(schemaText)
  if (!Array.isArray(schemaPayload.profiles) || schemaPayload.profiles.length < 20) {
    throw new Error(`Component schema response is incomplete: ${schemaText}`)
  }
  console.error('[smoke] searching catalog')
  const catalog = await client.callTool({
    name: 'harmony_catalog_search',
    arguments: { limit: 5 },
  })
  const catalogText = catalog.content?.find((entry) => entry.type === 'text')?.text ?? ''
  const catalogPayload = JSON.parse(catalogText)
  if (!Array.isArray(catalogPayload.assets)) {
    throw new Error(`Catalog search response is invalid: ${catalogText}`)
  }
  let writeResult = null
  if (process.env.HARMONY_EDITOR_MCP_SMOKE_WRITE === '1') {
    const revision = statusPayload.editor.connection.sceneRevision
    let nodeId = null
    let appliedRevision = null
    let undoneRevision = null
    let screenshotBytes = 0
    let cameraChanged = false
    let toolChanged = false
    const originalCamera = cameraPayload
    const originalToolState = toolStatePayload
    try {
      const cameraResult = await client.callTool({
        name: 'harmony_camera_control',
        arguments: {
          action: 'set',
          expectedRevision: revision,
          distance: Math.max(1, originalCamera.distance),
          azimuthDeg: (originalCamera.azimuthDeg + 10) % 360,
          polarDeg: Math.min(179.9, Math.max(0.1, originalCamera.polarDeg + 2)),
          fov: originalCamera.fov >= 179 ? originalCamera.fov - 1 : originalCamera.fov + 1,
        },
      })
      const cameraResultText = cameraResult.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const cameraResultPayload = JSON.parse(cameraResultText)
      if (!cameraResultPayload.state || cameraResultPayload.afterRevision <= revision) {
        throw new Error(`Camera set failed: ${cameraResultText}`)
      }
      cameraChanged = true
      const presetResult = await client.callTool({
        name: 'harmony_camera_control',
        arguments: {
          action: 'set',
          expectedRevision: cameraResultPayload.afterRevision,
          preset: 'isometric',
          distance: Math.max(1, originalCamera.distance),
        },
      })
      const presetResultText = presetResult.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const presetResultPayload = JSON.parse(presetResultText)
      if (!presetResultPayload.state || presetResultPayload.afterRevision <= cameraResultPayload.afterRevision) {
        throw new Error(`Camera preset failed: ${presetResultText}`)
      }

      const nextTool = originalToolState.activeTransformTool === 'translate' ? 'select' : 'translate'
      const toolResult = await client.callTool({
        name: 'harmony_tool_control',
        arguments: {
          action: 'set_active',
          group: 'transform',
          tool: nextTool,
        },
      })
      const toolResultText = toolResult.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const toolResultPayload = JSON.parse(toolResultText)
      if (toolResultPayload.state?.activeTransformTool !== nextTool) {
        throw new Error(`Tool activation failed: ${toolResultText}`)
      }
      toolChanged = true
      const buildToolResult = await client.callTool({
        name: 'harmony_tool_control',
        arguments: {
          action: 'set_active',
          group: 'build',
          tool: 'wall',
        },
      })
      const buildToolResultText = buildToolResult.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const buildToolResultPayload = JSON.parse(buildToolResultText)
      if (buildToolResultPayload.state?.activeBuildTool !== 'wall') {
        throw new Error(`Build tool activation failed: ${buildToolResultText}`)
      }
      await client.callTool({
        name: 'harmony_tool_control',
        arguments: {
          action: 'set_active',
          group: 'transform',
          tool: nextTool,
        },
      })

      const apply = await client.callTool({
        name: 'harmony_apply_operations',
        arguments: {
          expectedRevision: presetResultPayload.afterRevision,
          label: 'MCP bridge smoke test',
          operations: [{
            op: 'node.create',
            nodeType: 'Group',
            name: 'Agent Bridge Smoke Test',
            local: {
              position: { x: 2, y: 0, z: 2 },
            },
          }],
        },
      })
      const applyText = apply.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const applyPayload = JSON.parse(applyText)
      if (!applyPayload.applied || applyPayload.afterRevision <= applyPayload.beforeRevision) {
        throw new Error(`Scene apply failed: ${applyText}`)
      }
      nodeId = applyPayload.results?.[0]?.nodeId
      appliedRevision = applyPayload.afterRevision
      if (!nodeId) {
        throw new Error(`Scene apply did not return a node id: ${applyText}`)
      }

      const screenshot = await client.callTool({
        name: 'harmony_viewport_screenshot',
        arguments: {},
      })
      const image = screenshot.content?.find((entry) => entry.type === 'image')
      if (!image || image.type !== 'image' || image.data.length < 100) {
        throw new Error('Viewport screenshot did not return image content')
      }
      screenshotBytes = Math.floor(image.data.length * 0.75)

      const readback = await client.callTool({
        name: 'harmony_scene_query',
        arguments: { nodeId, includeComponents: true },
      })
      const readbackText = readback.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const readbackPayload = JSON.parse(readbackText)
      if (readbackPayload.nodes?.length !== 1 || readbackPayload.nodes[0]?.name !== 'Agent Bridge Smoke Test') {
        throw new Error(`Created node was not readable: ${readbackText}`)
      }

      const undo = await client.callTool({
        name: 'harmony_history',
        arguments: {
          action: 'undo',
          expectedRevision: applyPayload.afterRevision,
        },
      })
      const undoText = undo.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const undoPayload = JSON.parse(undoText)
      if (!undoPayload.changed) {
        throw new Error(`Undo failed: ${undoText}`)
      }
      undoneRevision = undoPayload.afterRevision
      const cleanupReadback = await client.callTool({
        name: 'harmony_scene_query',
        arguments: { nodeId, includeComponents: false },
      })
      const cleanupReadbackText = cleanupReadback.content?.find((entry) => entry.type === 'text')?.text ?? ''
      const cleanupReadbackPayload = JSON.parse(cleanupReadbackText)
      if (cleanupReadbackPayload.totalMatched !== 0) {
        throw new Error(`Temporary test node still exists after undo: ${cleanupReadbackText}`)
      }
      writeResult = {
        nodeId,
        beforeRevision: applyPayload.beforeRevision,
        afterRevision: applyPayload.afterRevision,
        undoneRevision,
        screenshotBytes,
        cameraRevision: cameraResultPayload.afterRevision,
        presetRevision: presetResultPayload.afterRevision,
        activeTransformTool: nextTool,
        buildToolActivated: 'wall',
      }
    } finally {
      if (nodeId && undoneRevision === null && appliedRevision !== null) {
        await client.callTool({
          name: 'harmony_history',
          arguments: {
            action: 'undo',
            expectedRevision: appliedRevision,
          },
        }).catch(() => undefined)
      }
      if (toolChanged) {
        await client.callTool({
          name: 'harmony_tool_control',
          arguments: {
            action: 'set_active',
            group: 'transform',
            tool: originalToolState.activeTransformTool,
          },
        }).catch(() => undefined)
        if (originalToolState.activeBuildTool) {
          await client.callTool({
            name: 'harmony_tool_control',
            arguments: {
              action: 'set_active',
              group: 'build',
              tool: originalToolState.activeBuildTool,
            },
          }).catch(() => undefined)
        }
      }
      if (cameraChanged) {
        await client.callTool({
          name: 'harmony_camera_control',
          arguments: {
            action: 'set',
            position: originalCamera.position,
            target: originalCamera.target,
            fov: originalCamera.fov,
            projection: originalCamera.projection,
            controlMode: originalCamera.controlMode,
          },
        }).catch(() => undefined)
      }
      await client.callTool({ name: 'harmony_save_scene', arguments: {} }).catch(() => undefined)
    }
  }
  console.log(JSON.stringify({
    tools: names.size,
    sceneId: statusPayload.editor.connection.sceneId,
    sceneName: statusPayload.editor.connection.sceneName,
    sceneReady: statusPayload.editor.connection.sceneReady,
    matchedNodes: queryPayload.totalMatched,
    componentProfiles: schemaPayload.profiles.length,
    catalogAssets: catalogPayload.assets.length,
    cameraProjection: cameraPayload.projection,
    activeTransformTool: toolStatePayload.activeTransformTool,
    activeBuildTool: toolStatePayload.activeBuildTool,
    writeResult,
  }, null, 2))
} finally {
  await client.close().catch(() => undefined)
}
