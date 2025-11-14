import { useSceneStore } from '@/stores/sceneStore'
import type { AiAssistantToolDefinition, AiAssistantToolInvocation } from '@/types/ai-assistant'
import type { Vector3Like } from '@harmony/schema'
import { normalizeAiModelMeshInput } from '@/utils/aiModelMesh'

type SceneEditorStore = ReturnType<typeof useSceneStore>

type SceneAgentTool = {
  definition: AiAssistantToolDefinition
  execute: (store: SceneEditorStore, args?: Record<string, unknown>) => Promise<void> | void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }
  }
  return undefined
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized.length) {
      return undefined
    }
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
      return false
    }
  }
  return undefined
}

function parseVector3(value: unknown): Vector3Like | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const x = parseNumber(value.x)
  const y = parseNumber(value.y)
  const z = parseNumber(value.z)
  if (x === undefined || y === undefined || z === undefined) {
    return undefined
  }
  return { x, y, z }
}

function ensureNodeId(args: Record<string, unknown> | undefined, message: string): string {
  const candidate = typeof args?.nodeId === 'string' ? args.nodeId.trim() : ''
  if (!candidate.length) {
    throw new Error(message)
  }
  return candidate
}

function ensureArrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const collected: string[] = []
  value.forEach((entry) => {
    if (typeof entry === 'string' && entry.trim().length) {
      collected.push(entry.trim())
    }
  })
  return collected.length ? collected : undefined
}

const tools: SceneAgentTool[] = [
  {
    definition: {
      name: 'createModelMesh',
      description: '根据提供的顶点和索引数据创建一个可渲染的三维模型网格。',
      parameters: {
        type: 'object',
        required: ['name', 'vertices', 'indices'],
        properties: {
          name: { type: 'string', description: '要创建的模型名称。' },
          vertices: {
            type: 'array',
            description: '浮点数组，按照 x、y、z 顺序提供顶点坐标。',
            items: { type: 'number' },
          },
          indices: {
            type: 'array',
            description: '整数数组，按照三个索引一组描述三角形。',
            items: { type: 'integer' },
          },
        },
      },
    },
    execute: (store, args) => {
      if (!isRecord(args)) {
        throw new Error('需要提供包含名称、顶点和索引的参数对象。')
      }
      const metadata = normalizeAiModelMeshInput({
        name: args.name,
        vertices: args.vertices,
        indices: args.indices,
      })
      store.createAiGeneratedMeshNode(metadata)
    },
  },
  {
    definition: {
      name: 'update_node_properties',
      description: '更新指定节点的位置、旋转或缩放属性。',
      parameters: {
        type: 'object',
        required: ['nodeId'],
        properties: {
          nodeId: { type: 'string', description: '需要调整的节点 ID。' },
          position: {
            type: 'object',
            description: '新的世界坐标位置。',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          rotation: {
            type: 'object',
            description: '新的欧拉角（弧度）。',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          scale: {
            type: 'object',
            description: '新的缩放值。',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          offset: {
            type: 'object',
            description: '相对父节点的偏移量。',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
        },
      },
    },
    execute: (store, args) => {
      const nodeId = ensureNodeId(args, '需要提供有效的节点 ID。')
      const payload: Record<string, unknown> = { id: nodeId }
      const position = parseVector3(args?.position)
      const rotation = parseVector3(args?.rotation)
      const scale = parseVector3(args?.scale)
      const offset = parseVector3(args?.offset)
      if (position) payload.position = position
      if (rotation) payload.rotation = rotation
      if (scale) payload.scale = scale
      if (offset) payload.offset = offset
      if (Object.keys(payload).length === 1) {
        throw new Error('未提供任何可应用的变换参数。')
      }
      store.updateNodeProperties(payload as { id: string; position?: Vector3Like; rotation?: Vector3Like; scale?: Vector3Like; offset?: Vector3Like })
    },
  },
  {
    definition: {
      name: 'focus_on_node',
      description: '选中并聚焦摄像机至指定节点。',
      parameters: {
        type: 'object',
        required: ['nodeId'],
        properties: {
          nodeId: { type: 'string', description: '需要聚焦的节点 ID。' },
        },
      },
    },
    execute: (store, args) => {
      const nodeId = ensureNodeId(args, '需要提供要聚焦的节点 ID。')
      store.setSelection([nodeId], { primaryId: nodeId })
      store.requestCameraFocus(nodeId)
    },
  },
  {
    definition: {
      name: 'set_ground_dimensions',
      description: '调整场景地面的宽度与深度。',
      parameters: {
        type: 'object',
        properties: {
          width: { type: 'number', minimum: 0.01 },
          depth: { type: 'number', minimum: 0.01 },
        },
      },
    },
    execute: (store, args) => {
      const width = parseNumber(args?.width)
      const depth = parseNumber(args?.depth)
      if (width === undefined && depth === undefined) {
        throw new Error('需要提供新的宽度或深度。')
      }
      const payload: { width?: number; depth?: number } = {}
      if (width !== undefined && width > 0) {
        payload.width = width
      }
      if (depth !== undefined && depth > 0) {
        payload.depth = depth
      }
      if (!payload.width && !payload.depth) {
        throw new Error('地面尺寸必须为正数。')
      }
      store.setGroundDimensions(payload)
    },
  },
  {
    definition: {
      name: 'set_viewport_grid_visible',
      description: '控制视口网格线的显示状态。',
      parameters: {
        type: 'object',
        required: ['visible'],
        properties: {
          visible: { type: 'boolean' },
        },
      },
    },
    execute: (store, args) => {
      const value = parseBoolean(args?.visible)
      if (value === undefined) {
        throw new Error('需要提供布尔值以设置网格可见性。')
      }
      store.setViewportGridVisible(value)
    },
  },
  {
    definition: {
      name: 'set_viewport_shadows_enabled',
      description: '启用或禁用视口阴影。',
      parameters: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
        },
      },
    },
    execute: (store, args) => {
      const value = parseBoolean(args?.enabled)
      if (value === undefined) {
        throw new Error('需要提供布尔值以设置阴影开关。')
      }
  store.setShadowsEnabled(value)
    },
  },
  {
    definition: {
      name: 'set_skybox_preset',
      description: '将天空盒切换到指定的预设。',
      parameters: {
        type: 'object',
        required: ['presetId'],
        properties: {
          presetId: { type: 'string', description: '天空盒预设标识符。' },
        },
      },
    },
    execute: (store, args) => {
      const presetId = typeof args?.presetId === 'string' ? args.presetId.trim() : ''
      if (!presetId.length) {
        throw new Error('需要提供天空盒预设 ID。')
      }
      store.applySkyboxPreset(presetId)
    },
  },
  {
    definition: {
      name: 'select_nodes',
      description: '选择一个或多个节点。',
      parameters: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: '希望选择的节点 ID 列表。',
          },
          primaryId: {
            type: 'string',
            description: '可选的主选中节点 ID。',
          },
        },
      },
    },
    execute: (store, args) => {
      const ids = ensureArrayOfStrings(args?.ids)
      if (!ids?.length) {
        throw new Error('需要提供至少一个节点 ID。')
      }
      const primaryId = typeof args?.primaryId === 'string' ? args.primaryId.trim() : undefined
      store.setSelection(ids, { primaryId: primaryId && ids.includes(primaryId) ? primaryId : undefined })
    },
  },
]

export function getAgentToolboxDefinitions(): AiAssistantToolDefinition[] {
  return tools.map((tool) => ({ ...tool.definition }))
}

export async function executeToolInvocations(
  invocations: AiAssistantToolInvocation[] | undefined,
  sceneStore: SceneEditorStore,
): Promise<void> {
  if (!Array.isArray(invocations) || !invocations.length) {
    return
  }

  for (const invocation of invocations) {
    const tool = tools.find((entry) => entry.definition.name === invocation.tool)
    if (!tool) {
      throw new Error(`未知的 Agent 工具：${invocation.tool}`)
    }
    await tool.execute(sceneStore, (invocation.args ?? undefined) as Record<string, unknown> | undefined)
  }
}
