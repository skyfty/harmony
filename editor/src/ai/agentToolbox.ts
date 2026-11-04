import { useSceneStore } from '@/stores/sceneStore'
import type { AiAssistantToolDefinition, AiAssistantToolInvocation } from '@/types/ai-assistant'
import type { Vector3Like } from '@schema/core'
import type {
  HarmonyCameraSetRequest,
  HarmonyOperation,
  HarmonyToolSetRequest,
} from '@schema/editorAgentProtocol'
import { applySceneOperations } from '@/agent/operations'
import { normalizeAiModelMeshInput } from '@/utils/aiModelMesh'

type SceneEditorStore = ReturnType<typeof useSceneStore>

type SceneAgentTool = {
  definition: AiAssistantToolDefinition
  execute?: (store: SceneEditorStore, args?: Record<string, unknown>) => Promise<void> | void
  toOperations?: (args?: Record<string, unknown>) => HarmonyOperation[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  }
  return undefined
}

function parseVector3(value: unknown): Vector3Like | undefined {
  if (!isRecord(value)) return undefined
  const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : undefined
  const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : undefined
  const z = typeof value.z === 'number' && Number.isFinite(value.z) ? value.z : undefined
  if (x === undefined || y === undefined || z === undefined) return undefined
  return { x, y, z }
}

function ensureNodeId(args: Record<string, unknown> | undefined, message: string): string {
  const candidate = typeof args?.nodeId === 'string' ? args.nodeId.trim() : ''
  if (!candidate.length) throw new Error(message)
  return candidate
}

function ensureArrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const collected = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
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
          vertices: { type: 'array', items: { type: 'number' } },
          indices: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    execute: (store, args) => {
      if (!isRecord(args)) throw new Error('需要提供包含名称、顶点和索引的参数对象。')
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
      description: '更新指定节点的局部位置、旋转或缩放属性。',
      parameters: {
        type: 'object',
        required: ['nodeId'],
        properties: {
          nodeId: { type: 'string' },
          position: { type: 'object' },
          rotation: { type: 'object' },
          scale: { type: 'object' },
        },
      },
    },
    toOperations: (args) => {
      const nodeId = ensureNodeId(args, '需要提供有效的节点 ID。')
      const position = parseVector3(args?.position)
      const rotation = parseVector3(args?.rotation)
      const scale = parseVector3(args?.scale)
      const local = {
        ...(position ? { position } : {}),
        ...(rotation ? { rotation } : {}),
        ...(scale ? { scale } : {}),
      }
      if (!Object.keys(local).length) throw new Error('未提供任何可应用的变换参数。')
      return [{ op: 'node.update', nodeId, local }]
    },
  },
  {
    definition: {
      name: 'focus_on_node',
      description: '选中并聚焦摄像机至指定节点。',
      parameters: {
        type: 'object',
        required: ['nodeId'],
        properties: { nodeId: { type: 'string' } },
      },
    },
    toOperations: (args) => [{
      op: 'camera.focus',
      nodeId: ensureNodeId(args, '需要提供要聚焦的节点 ID。'),
    }],
  },
  {
    definition: {
      name: 'set_viewport_shadows_enabled',
      description: '启用或禁用视口阴影。',
      parameters: {
        type: 'object',
        required: ['enabled'],
        properties: { enabled: { type: 'boolean' } },
      },
    },
    execute: (store, args) => {
      const value = parseBoolean(args?.enabled)
      if (value === undefined) throw new Error('需要提供布尔值以设置阴影开关。')
      store.setShadowsEnabled(value)
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
          ids: { type: 'array', items: { type: 'string' } },
          primaryId: { type: 'string' },
        },
      },
    },
    toOperations: (args) => {
      const nodeIds = ensureArrayOfStrings(args?.ids)
      if (!nodeIds?.length) throw new Error('需要提供至少一个节点 ID。')
      const primaryId = typeof args?.primaryId === 'string' ? args.primaryId.trim() : null
      return [{ op: 'node.select', nodeIds, primaryId }]
    },
  },
  {
    definition: {
      name: 'add_node_component',
      description: '向节点添加一个组件；复杂组件后续属性应使用对应领域能力。',
      parameters: {
        type: 'object',
        required: ['nodeId', 'componentType'],
        properties: {
          nodeId: { type: 'string' },
          componentType: { type: 'string' },
        },
      },
    },
    toOperations: (args) => [{
      op: 'component.add',
      nodeId: ensureNodeId(args, '需要提供节点 ID。'),
      componentType: typeof args?.componentType === 'string' ? args.componentType.trim() : '',
    }],
  },
  {
    definition: {
      name: 'remove_node_component',
      description: '从节点移除指定组件。',
      parameters: {
        type: 'object',
        required: ['nodeId', 'componentId'],
        properties: {
          nodeId: { type: 'string' },
          componentId: { type: 'string' },
        },
      },
    },
    toOperations: (args) => [{
      op: 'component.remove',
      nodeId: ensureNodeId(args, '需要提供节点 ID。'),
      componentId: typeof args?.componentId === 'string' ? args.componentId.trim() : '',
    }],
  },
  {
    definition: {
      name: 'update_simple_component_props',
      description: '更新组件的简单标量或向量字段；复杂集合、引用和运行时绑定会被拒绝。',
      parameters: {
        type: 'object',
        required: ['nodeId', 'componentId', 'patch'],
        properties: {
          nodeId: { type: 'string' },
          componentId: { type: 'string' },
          patch: { type: 'object' },
        },
      },
    },
    toOperations: (args) => {
      if (!isRecord(args?.patch)) throw new Error('patch 必须是对象。')
      return [{
        op: 'component.patch_simple',
        nodeId: ensureNodeId(args, '需要提供节点 ID。'),
        componentId: typeof args?.componentId === 'string' ? args.componentId.trim() : '',
        patch: args.patch,
      }]
    },
  },
  {
    definition: {
      name: 'control_scene_camera',
      description: '读取操作无法返回数据；用于设置真实场景相机的位置、目标、FOV、距离、环绕角度、投影和预设。',
      parameters: {
        type: 'object',
        properties: {
          position: { type: 'object' },
          target: { type: 'object' },
          fov: { type: 'number' },
          distance: { type: 'number' },
          azimuthDeg: { type: 'number' },
          polarDeg: { type: 'number' },
          projection: { type: 'string', enum: ['perspective', 'orthographic'] },
          controlMode: { type: 'string', enum: ['map', 'orbit'] },
          preset: { type: 'string', enum: ['top', 'front', 'back', 'left', 'right', 'isometric'] },
        },
      },
    },
    toOperations: (args) => {
      const request: HarmonyCameraSetRequest = {}
      const position = parseVector3(args?.position)
      const target = parseVector3(args?.target)
      if (position) request.position = position
      if (target) request.target = target
      if (typeof args?.fov === 'number') request.fov = args.fov
      if (typeof args?.distance === 'number') request.distance = args.distance
      if (typeof args?.azimuthDeg === 'number') request.azimuthDeg = args.azimuthDeg
      if (typeof args?.polarDeg === 'number') request.polarDeg = args.polarDeg
      if (args?.projection === 'perspective' || args?.projection === 'orthographic') {
        request.projection = args.projection
      }
      if (args?.controlMode === 'map' || args?.controlMode === 'orbit') {
        request.controlMode = args.controlMode
      }
      if (
        args?.preset === 'top'
        || args?.preset === 'front'
        || args?.preset === 'back'
        || args?.preset === 'left'
        || args?.preset === 'right'
        || args?.preset === 'isometric'
      ) {
        request.preset = args.preset
      }
      if (!Object.keys(request).length) throw new Error('未提供任何相机参数。')
      return [{ op: 'camera.set', request }]
    },
  },
  {
    definition: {
      name: 'set_active_viewport_tool',
      description: '激活选择、移动、旋转、缩放、变换或墙体、地面、道路、水域等现有视口工具。',
      parameters: {
        type: 'object',
        required: ['group', 'tool'],
        properties: {
          group: { type: 'string', enum: ['transform', 'build'] },
          tool: { type: ['string', 'null'] },
        },
      },
    },
    toOperations: (args) => {
      if (args?.group !== 'transform' && args?.group !== 'build') {
        throw new Error('group 必须是 transform 或 build。')
      }
      if (args?.tool !== null && typeof args?.tool !== 'string') {
        throw new Error('tool 必须是字符串或 null。')
      }
      return [{
        op: 'tool.set_active',
        request: {
          group: args.group,
          tool: args.tool,
        } as HarmonyToolSetRequest,
      }]
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
  if (!Array.isArray(invocations) || !invocations.length) return
  const operations: HarmonyOperation[] = []
  for (const invocation of invocations) {
    const tool = tools.find((entry) => entry.definition.name === invocation.tool)
    if (!tool) throw new Error(`未知的 Agent 工具：${invocation.tool}`)
    const args = (invocation.args ?? undefined) as Record<string, unknown> | undefined
    if (tool.toOperations) {
      operations.push(...tool.toOperations(args))
    } else {
      await tool.execute?.(sceneStore, args)
    }
  }
  if (operations.length) {
    await applySceneOperations(sceneStore, { operations, atomic: true })
  }
}
