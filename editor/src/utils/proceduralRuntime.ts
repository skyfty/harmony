import { Object3D } from 'three'
import { createPrimitiveMesh,isGeometryType, type SceneNode, type SceneNodeComponentState } from '@harmony/schema'
import {
  DISPLAY_BOARD_COMPONENT_TYPE,
  GUIDEBOARD_COMPONENT_TYPE,
  VIEW_POINT_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
} from '@schema/components'

/**
 * Procedural runtime 辅助模块
 *
 * 说明：编辑器中的大多数节点通过资源管线（例如通过 `sourceAssetId` 加载模型/贴图）来
 * 创建其运行时的 `Object3D`。但部分节点是“过程化”的（procedural），它们不依赖外部资
 * 源，因此通常没有 `sourceAssetId`，例如 WarpGate、Guideboard、ViewPoint、以及作为展示面
 * 板的 Plane。
 *
 * 本模块的职责是在运行时刷新（runtime refresh）期间为这些过程化节点创建轻量的 `Object3D`，
 * 以保证：
 * - 节点可被选中和射线检测（hit-test）
 * - 各类组件可以挂载到运行时对象上
 * - 场景图保持一致性，避免缺失占位对象导致边界情况
 *
 * 设计说明：此模块与 store 解耦。为了避免直接依赖 store 内部结构，
 * `rebuildProceduralRuntimeObjects` 接受一组小的回调（依赖注入）：
 * - 检查运行时对象是否已存在
 * - 注册新创建的运行时对象
 * - 给 `Object3D` 打上 `nodeId` 标记
 */

function hasEnabledComponent(node: SceneNode, componentType: string): boolean {
  // 组件映射中可能存在条目但被禁用（enabled === false），这种情况下视为未启用。
  const entry = node.components?.[componentType] as SceneNodeComponentState<unknown> | undefined
  return entry?.enabled !== false
}

/**
 * 判断一个节点是否需要创建过程化的 runtime 对象。
 *
 * 规则（当前编辑器实现）：
 * - 若节点有非空的 `sourceAssetId`，说明由资源管线负责 → 返回 false。
 * - 否则当满足下列任一条件时认为是过程化节点：
 *   - `nodeType` 为 `WarpGate` 或存在已启用的 WarpGate 组件
 *   - `nodeType` 为 `Guideboard` 或存在已启用的 Guideboard 组件
 *   - `nodeType` 为 `Plane` 且存在已启用的 DisplayBoard 组件
 *   - `nodeType` 为 `Sphere` 且存在已启用的 ViewPoint 组件
 */
export function shouldCreateProceduralRuntimeObject(node: SceneNode): boolean {
  if (!node || (node.sourceAssetId ?? '').trim().length) {
    return false
  }

  const nodeType = node.nodeType ?? (node.light ? 'Light' : 'Mesh')

  if (nodeType === 'WarpGate' || hasEnabledComponent(node, WARP_GATE_COMPONENT_TYPE)) {
    return true
  }
  if (nodeType === 'Guideboard' || hasEnabledComponent(node, GUIDEBOARD_COMPONENT_TYPE)) {
    return true
  }
  if (nodeType === 'Plane' && hasEnabledComponent(node, DISPLAY_BOARD_COMPONENT_TYPE)) {
    return true
  }
  if (nodeType === 'Sphere' && hasEnabledComponent(node, VIEW_POINT_COMPONENT_TYPE)) {
    return true
  }
  return isGeometryType(nodeType)
}

/**
 * 为过程化节点创建轻量的运行时 `Object3D`。
 *
 * - 对于 `WarpGate` / `Guideboard`，创建一个空的 `Object3D` 占位（组件会附加可视或行为）。
 * - 对于 `Plane` / `Sphere`，使用 `@harmony/schema` 提供的 `createPrimitiveMesh` 创建基础几何，
 *   使其可被选中并预览。
 * - 兜底情况下创建通用的空 `Object3D`。
 *
 * 创建后通过传入的 `tagObjectWithNodeId` 回调给对象打上 `nodeId` 标记（并传播到子对象）。
 */
export function createProceduralRuntimeObject(
  node: SceneNode,
  options: { tagObjectWithNodeId: (object: Object3D, nodeId: string) => void },
): Object3D {
  const nodeType = node.nodeType ?? (node.light ? 'Light' : 'Mesh')

  if (nodeType === 'WarpGate' || nodeType === 'Guideboard') {
    const object = new Object3D()
    object.name = node.name ?? nodeType
    object.visible = node.visible ?? true
    options.tagObjectWithNodeId(object, node.id)
    return object
  }

  if (isGeometryType(nodeType)) {
    const mesh = createPrimitiveMesh(nodeType)
    mesh.name = node.name ?? nodeType
    mesh.visible = node.visible ?? true
    options.tagObjectWithNodeId(mesh, node.id)
    return mesh
  }

  const fallback = new Object3D()
  fallback.name = node.name ?? nodeType
  fallback.visible = node.visible ?? true
  options.tagObjectWithNodeId(fallback, node.id)
  return fallback
}

/**
 * 遍历节点树，确保每个过程化节点都有对应的运行时 `Object3D`。
 *
 * 使用时机：在运行时刷新期间调用，通常在运行时注册表被清空且资源驱动的运行时对象
 * 已经重建之后。
 *
 * 行为：深度优先遍历节点树，对于每个满足过程化条件且当前不存在运行时对象的节点，
 * 会创建一个过程化运行时对象并通过回调注册它。
 *
 * 通过回调注入最小依赖，以保持此模块与具体 store 实现（例如 Pinia 或内存映射）解耦。
 */
export function rebuildProceduralRuntimeObjects(
  nodes: SceneNode[],
  options: {
    hasRuntimeObject: (nodeId: string) => boolean
    registerRuntimeObject: (nodeId: string, object: Object3D) => void
    tagObjectWithNodeId: (object: Object3D, nodeId: string) => void
  },
): void {
  const visit = (list: SceneNode[]) => {
    list.forEach((node) => {
      if (!node) {
        return
      }
      // Avoid replacing existing runtimes (asset-driven or already-created procedural ones).
      if (!options.hasRuntimeObject(node.id) && shouldCreateProceduralRuntimeObject(node)) {
        const object = createProceduralRuntimeObject(node, { tagObjectWithNodeId: options.tagObjectWithNodeId })
        options.registerRuntimeObject(node.id, object)
      }
      if (Array.isArray(node.children) && node.children.length) {
        visit(node.children)
      }
    })
  }

  visit(nodes)
}
