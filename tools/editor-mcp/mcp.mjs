#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, basename } from 'node:path'
import { z } from 'zod'
import {
  HARMONY_AGENT_MAX_ASSET_IMPORT_FILE_BYTES,
  HARMONY_AGENT_MAX_ASSET_IMPORT_FILES,
  HARMONY_AGENT_MAX_ASSET_IMPORT_TOTAL_BYTES,
  HARMONY_AGENT_OPERATING_POLICY,
  HARMONY_AGENT_PROTOCOL_VERSION,
  HARMONY_AGENT_TOOLS,
} from '../../schema/dist/editorAgentProtocol.js'
import { createOrConnectBridge, normalizeBridgeError } from './bridge.mjs'

const operation = z.record(z.string(), z.unknown())
const vector3 = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
})

function textResult(value) {
  return {
    content: [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  }
}

function errorResult(error) {
  const normalized = normalizeBridgeError(error)
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify(normalized, null, 2),
    }],
  }
}

function inferAssetMimeType(filename) {
  switch (extname(filename).slice(1).toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'gif': return 'image/gif'
    case 'ktx2': return 'image/ktx2'
    case 'glb': return 'model/gltf-binary'
    case 'gltf': return 'model/gltf+json'
    case 'fbx': return 'application/octet-stream'
    case 'json': return 'application/json'
    case 'zip': return 'application/zip'
    default: return 'application/octet-stream'
  }
}

function inferAssetType(filename, requestedType = 'auto') {
  if (requestedType && requestedType !== 'auto') return requestedType
  switch (extname(filename).slice(1).toLowerCase()) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'bmp':
    case 'gif':
      return 'image'
    case 'ktx2':
      return 'texture'
    case 'glb':
    case 'gltf':
    case 'fbx':
      return 'model'
    default:
      return 'file'
  }
}

async function readLocalAssetItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must contain at least one local file')
  }
  if (items.length > HARMONY_AGENT_MAX_ASSET_IMPORT_FILES) {
    throw new Error(`At most ${HARMONY_AGENT_MAX_ASSET_IMPORT_FILES} files may be imported at once`)
  }

  let totalBytes = 0
  const payloadItems = []
  for (const [index, item] of items.entries()) {
    if (!item || typeof item.path !== 'string' || !isAbsolute(item.path)) {
      throw new Error(`items[${index}].path must be an absolute local file path`)
    }
    const resolvedPath = await realpath(item.path)
    const fileStats = await stat(resolvedPath)
    if (!fileStats.isFile()) {
      throw new Error(`items[${index}].path does not point to a regular file`)
    }
    if (fileStats.size <= 0) {
      throw new Error(`items[${index}].path is empty`)
    }
    if (fileStats.size > HARMONY_AGENT_MAX_ASSET_IMPORT_FILE_BYTES) {
      throw new Error(`items[${index}] exceeds the per-file size limit`)
    }
    totalBytes += fileStats.size
    if (totalBytes > HARMONY_AGENT_MAX_ASSET_IMPORT_TOTAL_BYTES) {
      throw new Error('The selected files exceed the asset import batch size limit')
    }
    const sourceName = item.name?.trim() || basename(resolvedPath)
    const sourceExtension = extname(resolvedPath)
    const requestedExtension = extname(sourceName)
    const name = requestedExtension || !sourceExtension
      ? sourceName
      : `${sourceName}${sourceExtension}`
    const type = inferAssetType(name, item.type)
    const buffer = await readFile(resolvedPath)
    payloadItems.push({
      path: resolvedPath,
      name,
      type,
      mimeType: inferAssetMimeType(name),
      size: buffer.byteLength,
      base64: buffer.toString('base64'),
    })
  }
  return payloadItems
}

async function executeTool(action) {
  try {
    return textResult(await action())
  } catch (error) {
    return errorResult(error)
  }
}

async function main() {
  const connection = await createOrConnectBridge()
  const server = new McpServer(
    { name: 'harmony-editor', version: '1.0.0' },
    {
      maxToolInputElements: 20_000,
      instructions: HARMONY_AGENT_OPERATING_POLICY,
    },
  )

  const call = (method, params) => connection.client.call(method, params)

  server.registerTool(
    HARMONY_AGENT_TOOLS.status,
    {
      title: 'Harmony Editor status',
      description: 'Report the connected Harmony Editor, current scene, revision, save state, and Agent capabilities.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => executeTool(async () => {
      try {
        const editor = await call('editor.status', {})
        return {
          bridge: {
            protocolVersion: HARMONY_AGENT_PROTOCOL_VERSION,
            operatingPolicy: HARMONY_AGENT_OPERATING_POLICY,
            connected: true,
            ownsBridge: connection.ownsBridge,
            port: connection.port,
            tokenPath: connection.tokenPath,
          },
          editor,
        }
      } catch (error) {
        return {
          bridge: {
            protocolVersion: HARMONY_AGENT_PROTOCOL_VERSION,
            operatingPolicy: HARMONY_AGENT_OPERATING_POLICY,
            connected: false,
            ownsBridge: connection.ownsBridge,
            port: connection.port,
            tokenPath: connection.tokenPath,
          },
          error: normalizeBridgeError(error),
        }
      }
    }),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.wait,
    {
      title: 'Wait for Harmony Editor',
      description: 'Wait for the scene, pending asset placements, or auto-save to finish before taking the next action.',
      inputSchema: z.object({
        waitFor: z.enum(['idle', 'ready', 'assets', 'saved']).default('idle'),
        revision: z.number().int().nonnegative().optional(),
        timeoutMs: z.number().int().min(100).max(120000).default(30000),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => executeTool(() => call('editor.wait', args)),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.sceneQuery,
    {
      title: 'Query Harmony scene',
      description: 'Query scene nodes by ID, parent, type, component, asset, or text. Optional geometry returns serializable local/world bounds and Floor vertices.',
      inputSchema: z.object({
        text: z.string().optional(),
        parentId: z.string().nullable().optional(),
        nodeId: z.string().optional(),
        nodeType: z.string().optional(),
        componentType: z.string().optional(),
        assetId: z.string().optional(),
        includeComponents: z.boolean().default(false),
        includeMaterials: z.boolean().default(false),
        includeGeometry: z.boolean().default(false),
        depth: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => executeTool(() => call('scene.query', args)),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.catalogSearch,
    {
      title: 'Search Harmony asset catalog',
      description: 'Search the currently loaded project catalog. Only existing assets can be placed; uploads and generation are not supported.',
      inputSchema: z.object({
        text: z.string().optional(),
        type: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => executeTool(() => call('catalog.search', args)),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.assetImportLocal,
    {
      title: 'Import local assets into Harmony AssetsPanel',
      description: 'Import absolute local file paths into the current scene AssetsPanel library. Files are cached locally and become available to materials and scene nodes without uploading to the server.',
      inputSchema: z.object({
        expectedRevision: z.number().int().nonnegative().optional(),
        directoryId: z.string().min(1).optional(),
        select: z.boolean().default(true),
        items: z.array(z.object({
          path: z.string().min(1),
          name: z.string().min(1).optional(),
          type: z.enum(['auto', 'image', 'texture', 'model', 'mesh', 'prefab', 'file']).default('auto'),
        })).min(1).max(HARMONY_AGENT_MAX_ASSET_IMPORT_FILES),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ items, expectedRevision, directoryId, select }) => executeTool(async () => {
      const payloadItems = await readLocalAssetItems(items)
      return call('asset.import_local', {
        items: payloadItems,
        expectedRevision,
        directoryId,
        select,
      })
    }),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.componentSchema,
    {
      title: 'Inspect Harmony component schemas',
      description: 'List Agent edit modes, allowed generic fields, protected fields, and the required domain tool for each registered component.',
      inputSchema: z.object({
        componentType: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => executeTool(async () => {
      const result = await call('component.schema', {})
      if (!args.componentType) return result
      return {
        profiles: result.profiles.filter((profile) => profile.type === args.componentType),
      }
    }),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.apply,
    {
      title: 'Apply Harmony scene operations',
      description: 'Apply an ordered batch of node, simple component, asset, material, environment, and ground-setting operations. Use component schemas to discover domain-only fields.',
      inputSchema: z.object({
        expectedRevision: z.number().int().nonnegative().optional(),
        label: z.string().optional(),
        operations: z.array(operation).min(1).max(100),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ operations, expectedRevision, label }) => executeTool(() => call('scene.apply', {
      operations,
      expectedRevision,
      label,
      atomic: true,
    })),
  )

  const domainTool = (name, domain, title, description) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: z.object({
          expectedRevision: z.number().int().nonnegative().optional(),
          action: z.string().min(1),
          args: z.record(z.string(), z.unknown()).default({}),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
      async ({ expectedRevision, action, args }) => executeTool(() => call('scene.apply', {
        expectedRevision,
        atomic: true,
        operations: [{
          op: 'domain.apply',
          domain,
          action,
          args,
        }],
      })),
    )
  }

  domainTool(
    HARMONY_AGENT_TOOLS.builder,
    'builder',
    'Edit Harmony builders',
    'Create or configure walls, floors, roads, landforms, water, particle systems, and their presets through existing editor builders. Apply particle presets with componentType particleSystem and presetId, and trigger a transient animation with preview_particle. Floor polygons can be updated semantically with update_floor_geometry.',
  )
  domainTool(
    HARMONY_AGENT_TOOLS.behavior,
    'behavior',
    'Edit Harmony behaviors',
    'Replace or validate behavior event and action sequences without writing runtime internals.',
  )
  domainTool(
    HARMONY_AGENT_TOOLS.guideRoute,
    'guideRoute',
    'Edit Harmony guide routes',
    'Create routes and move or remove stops, anchors, waypoints, and branches through route topology APIs.',
  )
  domainTool(
    HARMONY_AGENT_TOOLS.terrain,
    'terrain',
    'Edit Harmony terrain',
    'Inspect terrain runtime state, analyze and fit Floor/Region transition slopes, apply terrain region edits, and wait for dependent ground compilation.',
  )
  domainTool(
    HARMONY_AGENT_TOOLS.actor,
    'actor',
    'Edit Harmony actors',
    'Add or configure character, vehicle, rigidbody, and related runtime-bound components.',
  )
  domainTool(
    HARMONY_AGENT_TOOLS.houseRig,
    'houseRig',
    'Edit Harmony House Rig',
    'Inspect, validate, version, resize, and assign per-part materials for a House Rig component through semantic model operations.',
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.camera,
    {
      title: 'Control Harmony camera',
      description: 'Read the real Editor camera or set position, target, fov, distance, orbit angles, projection, control mode, or a named view preset.',
      inputSchema: z.object({
        action: z.enum(['get', 'set']),
        position: vector3.optional(),
        target: vector3.optional(),
        fov: z.number().min(1).max(179).optional(),
        distance: z.number().positive().optional(),
        azimuthDeg: z.number().optional(),
        polarDeg: z.number().min(0.1).max(179.9).optional(),
        projection: z.enum(['perspective', 'orthographic']).optional(),
        controlMode: z.enum(['map', 'orbit']).optional(),
        preset: z.enum(['top', 'front', 'back', 'left', 'right', 'isometric']).optional(),
        expectedRevision: z.number().int().nonnegative().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ action, ...params }) => executeTool(() => (
      action === 'get'
        ? call('camera.get', {})
        : call('camera.set', params)
    )),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.tool,
    {
      title: 'Control Harmony viewport tool',
      description: 'Read the active transform/build tool or activate select, move, rotate, scale, transform, terrain, wall, floor, road, water, route, and other existing viewport tools.',
      inputSchema: z.object({
        action: z.enum(['get', 'set_active']),
        group: z.enum(['transform', 'build']).optional(),
        tool: z.string().nullable().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ action, group, tool }) => executeTool(() => {
      if (action === 'get') {
        return call('tool.get', {})
      }
      if (!group) {
        throw new Error('group is required when action is set_active')
      }
      return call('tool.set_active', { group, tool: tool ?? null })
    }),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.history,
    {
      title: 'Control Harmony history',
      description: 'Undo or redo the latest scene edit. Pass expectedRevision to fail instead of changing a scene edited after inspection.',
      inputSchema: z.object({
        action: z.enum(['undo', 'redo']),
        expectedRevision: z.number().int().nonnegative().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async (args) => executeTool(() => call('history.apply', args)),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.save,
    {
      title: 'Save Harmony scene',
      description: 'Flush the pending scene auto-save and return the saved revision.',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => executeTool(() => call('scene.save', {})),
  )

  server.registerTool(
    HARMONY_AGENT_TOOLS.screenshot,
    {
      title: 'Capture Harmony viewport',
      description: 'Capture the current editor viewport as an image for visual inspection and verification.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const screenshot = await call('viewport.screenshot', {})
        return {
          content: [
            {
              type: 'image',
              data: screenshot.base64,
              mimeType: screenshot.mimeType,
            },
            {
              type: 'text',
              text: JSON.stringify({
                sceneId: screenshot.sceneId,
                sceneRevision: screenshot.sceneRevision,
                width: screenshot.width,
                height: screenshot.height,
              }, null, 2),
            },
          ],
        }
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[harmony-editor-mcp] ${connection.ownsBridge ? 'bridge started' : 'connected to bridge'} on 127.0.0.1:${connection.port}`)

  const shutdown = async () => {
    await server.close().catch(() => undefined)
    await connection.client.close().catch(() => undefined)
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('[harmony-editor-mcp] Failed to start:', error)
  process.exit(1)
})
