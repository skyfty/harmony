import type { SceneNode, SceneNodeComponentState, SceneNodeMaterial } from '@schema'
import {
  WALL_COMPONENT_TYPE,
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_REPEAT_INSTANCE_STEP,
  WALL_DEFAULT_SMOOTHING,
  WALL_DEFAULT_THICKNESS,
  WALL_DEFAULT_WIDTH,
  type WallComponentProps,
} from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from './assetCacheStore'
import { determineAssetCategoryId } from './assetCatalog'
import { extractExtension } from '@/utils/blob'
import {
  WALL_PRESET_FORMAT_VERSION,
  buildWallPresetFilename,
  isWallPresetFilename,
  type StrictWallPresetWallProps,
  type WallForwardAxis,
  type WallRenderMode,
  type WallUvAxis,
  type WallPresetData,
  type WallPresetMaterialPatch,
} from '@/utils/wallPreset'

export type WallPresetStoreLike = {
  nodes: SceneNode[]
  selectedNodeId: string | null
  assetCatalog: Record<string, ProjectAsset[]> | null
  assetIndex: Record<string, any>
  packageAssetMap: Record<string, any>
  materials: Array<{ id: string; name: string; type: string } & Record<string, any>>

  getAsset: (id: string) => ProjectAsset | null
  registerAsset: (asset: ProjectAsset, options: any) => ProjectAsset
  setActiveDirectory: (categoryId: string) => void
  selectAsset: (assetId: string) => void

  addNodeComponent: <T extends string>(nodeId: string, type: T) => any
  updateNodeComponentProps: (nodeId: string, componentId: string, patch: any) => boolean
  setNodeMaterials: (nodeId: string, materials: SceneNodeMaterial[]) => boolean
  ensurePrefabDependencies: (assetIds: string[], options: any) => Promise<void>
}

export type WallPresetActionsDeps = {
  WALL_PRESET_PREVIEW_COLOR: string

  generateUuid: () => string
  normalizePrefabName: (value: string | null | undefined) => string

  // Node helpers
  findNodeById: (nodes: SceneNode[], id: string) => SceneNode | null
  nodeSupportsMaterials: (node: SceneNode | null | undefined) => boolean

  // Material helpers
  extractMaterialProps: (material: SceneNodeMaterial | null | undefined) => any
  materialUpdateToProps: (update: any) => any
  mergeMaterialProps: (base: any, overrides?: any) => any
  createMaterialProps: (overrides?: any) => any
  createNodeMaterial: (materialId: string | null, props: any, options: { id?: string; name?: string; type?: any }) => SceneNodeMaterial
  DEFAULT_SCENE_MATERIAL_TYPE: string

  // Prefab dependency helpers
  buildAssetIndexSubsetForPrefab: (assetIndex: any, dependencyAssetIds: string[]) => any
  buildPackageAssetMapSubsetForPrefab: (packageAssetMap: any, dependencyAssetIds: string[]) => any
  mergeAssetIndexEntries: (existing: any, incoming: any, filter?: Set<string>) => { next: any; changed: boolean }
  mergePackageAssetMapEntries: (existing: any, incoming: any, filter?: Set<string>) => { next: any; changed: boolean }
  isAssetIndex: (value: unknown) => boolean
  isPackageAssetMap: (value: unknown) => boolean
}

export const BUILTIN_AIR_WALL_PRESET_ASSET_ID = 'builtin:wall-preset:air-wall'

const BUILTIN_AIR_WALL_PRESET_NAME = '空气墙'
const BUILTIN_AIR_WALL_PRESET_FILENAME = buildWallPresetFilename(BUILTIN_AIR_WALL_PRESET_NAME)
const BUILTIN_AIR_WALL_PRESET_PREVIEW_COLOR = '#7986CB'

export const BUILTIN_AIR_WALL_PRESET: WallPresetData = {
  kind: 'wall-preset',
  formatVersion: WALL_PRESET_FORMAT_VERSION,
  name: BUILTIN_AIR_WALL_PRESET_NAME,
  wallProps: {
    height: WALL_DEFAULT_HEIGHT,
    width: WALL_DEFAULT_WIDTH,
    thickness: WALL_DEFAULT_THICKNESS,
    wallBaseOffsetLocal: { x: 0, y: 0, z: 0 },
    smoothing: WALL_DEFAULT_SMOOTHING,
    bodyMaterialConfigId: null,
    wallRenderMode: 'stretch',
    repeatInstanceStep: WALL_DEFAULT_REPEAT_INSTANCE_STEP,
    isAirWall: true,
    bodyAssetId: null,
    bodyOrientation: { forwardAxis: '+z', yawDeg: 0 },
    bodyUvAxis: 'auto',
    headAssetId: null,
    headOrientation: { forwardAxis: '+z', yawDeg: 0 },
    headUvAxis: 'auto',
    footAssetId: null,
    footOrientation: { forwardAxis: '+z', yawDeg: 0 },
    footUvAxis: 'auto',
    bodyEndCapAssetId: null,
    bodyEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
    bodyEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    headEndCapAssetId: null,
    headEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
    headEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    footEndCapAssetId: null,
    footEndCapOffsetLocal: { x: 0, y: 0, z: 0 },
    footEndCapOrientation: { forwardAxis: '+z', yawDeg: 0 },
    cornerModels: [],
  },
  materialOrder: [],
  materialPatches: {},
}

export const BUILTIN_WALL_PRESET_ASSETS: ProjectAsset[] = [
  {
    id: BUILTIN_AIR_WALL_PRESET_ASSET_ID,
    name: BUILTIN_AIR_WALL_PRESET_NAME,
    type: 'prefab',
    downloadUrl: BUILTIN_AIR_WALL_PRESET_ASSET_ID,
    previewColor: BUILTIN_AIR_WALL_PRESET_PREVIEW_COLOR,
    thumbnail: null,
    description: BUILTIN_AIR_WALL_PRESET_FILENAME,
    gleaned: true,
    extension: 'wall',
  },
]

function normalizeOptionalAssetId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

function resolveWallBodyMaterialConfigId(materialIds: string[], preferredId: unknown): string | null {
  const normalizedPreferredId = normalizeOptionalAssetId(preferredId)
  if (normalizedPreferredId && materialIds.includes(normalizedPreferredId)) {
    return normalizedPreferredId
  }
  return materialIds[0] ?? null
}

function normalizeWallRenderMode(value: unknown, fallback: WallRenderMode = 'stretch'): WallRenderMode {
  return value === 'repeatInstances' ? 'repeatInstances' : fallback
}

function buildWallComponentPropsPatchFromPreset(wallProps: StrictWallPresetWallProps): Partial<WallComponentProps> {
  return {
    height: wallProps.height,
    width: wallProps.width,
    thickness: wallProps.thickness,
    wallBaseOffsetLocal: wallProps.wallBaseOffsetLocal,
    smoothing: wallProps.smoothing,
    bodyMaterialConfigId: wallProps.bodyMaterialConfigId ?? null,
    wallRenderMode: normalizeWallRenderMode(wallProps.wallRenderMode, 'stretch'),
    repeatInstanceStep: wallProps.repeatInstanceStep,
    isAirWall: wallProps.isAirWall,
    bodyAssetId: wallProps.bodyAssetId ?? null,
    bodyOrientation: wallProps.bodyOrientation,
    bodyUvAxis: wallProps.bodyUvAxis,
    headAssetId: wallProps.headAssetId ?? null,
    headOrientation: wallProps.headOrientation,
    headUvAxis: wallProps.headUvAxis,
    footAssetId: wallProps.footAssetId ?? null,
    footOrientation: wallProps.footOrientation,
    footUvAxis: wallProps.footUvAxis,
    bodyEndCapAssetId: wallProps.bodyEndCapAssetId ?? null,
    bodyEndCapOffsetLocal: wallProps.bodyEndCapOffsetLocal,
    bodyEndCapOrientation: wallProps.bodyEndCapOrientation,
    headEndCapAssetId: wallProps.headEndCapAssetId ?? null,
    headEndCapOffsetLocal: wallProps.headEndCapOffsetLocal,
    headEndCapOrientation: wallProps.headEndCapOrientation,
    footEndCapAssetId: wallProps.footEndCapAssetId ?? null,
    footEndCapOffsetLocal: wallProps.footEndCapOffsetLocal,
    footEndCapOrientation: wallProps.footEndCapOrientation,
    cornerModels: wallProps.cornerModels ?? [],
  }
}

export { buildWallComponentPropsPatchFromPreset }

function assertStrictWallPresetWallProps(value: unknown): StrictWallPresetWallProps {
  if (!value || typeof value !== 'object') {
    throw new Error('墙体预设 wallProps 格式无效')
  }
  const record = value as Record<string, unknown>
  const requiredNumber = (key: string): number => {
    const raw = record[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${key}`)
    }
    return raw
  }
  const requiredBoolean = (key: string): boolean => {
    const raw = record[key]
    if (typeof raw !== 'boolean') {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${key}`)
    }
    return raw
  }
  const optionalMaterialConfigId = (key: string): string | null => {
    const raw = record[key]
    if (raw == null) {
      return null
    }
    if (typeof raw !== 'string') {
      return null
    }
    const trimmed = raw.trim()
    return trimmed.length ? trimmed : null
  }
  const optionalRepeatInstanceStep = (): number => {
    const raw = record.repeatInstanceStep
    const num = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(num) || num <= 0) {
      return WALL_DEFAULT_REPEAT_INSTANCE_STEP
    }
    return num
  }

  const requiredJointTrim = (raw: unknown, label: string): { start: number; end: number } => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}`)
    }
    const obj = raw as Record<string, unknown>
    const start = typeof obj.start === 'number' ? obj.start : Number(obj.start)
    const end = typeof obj.end === 'number' ? obj.end : Number(obj.end)
    if (!Number.isFinite(start)) {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}.start`)
    }
    if (!Number.isFinite(end)) {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}.end`)
    }
    return {
      start: Math.max(0, start),
      end: Math.max(0, end),
    }
  }
  const requiredAssetIdOrNull = (key: string): string | null => {
    const raw = record[key]
    if (raw === null) {
      return null
    }
    const normalized = normalizeOptionalAssetId(raw)
    if (!normalized) {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${key}`)
    }
    return normalized
  }

  const requiredForwardAxis = (value: unknown, label: string): WallForwardAxis => {
    if (value === '+x' || value === '-x' || value === '+z' || value === '-z') {
      return value
    }
    throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}`)
  }

  const requiredYawDeg = (value: unknown, label: string): number => {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num)) {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}`)
    }
    return Math.max(-180, Math.min(180, num))
  }

  const requiredOrientation = (value: unknown, label: string): { forwardAxis: WallForwardAxis; yawDeg: number } => {
    if (!value || typeof value !== 'object') {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}`)
    }
    const obj = value as Record<string, unknown>
    return {
      forwardAxis: requiredForwardAxis(obj.forwardAxis, `${label}.forwardAxis`),
      yawDeg: requiredYawDeg(obj.yawDeg, `${label}.yawDeg`),
    }
  }

  const optionalUvAxis = (value: unknown, fallback: WallUvAxis = 'auto'): WallUvAxis => {
    return value === 'u' || value === 'v' || value === 'auto' ? value : fallback
  }

  const requiredOffsetLocal = (value: unknown, label: string): { x: number; y: number; z: number } => {
    if (!value || typeof value !== 'object') {
      throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}`)
    }
    const obj = value as Record<string, unknown>
    const requiredAxis = (axis: 'x' | 'y' | 'z'): number => {
      const raw = obj[axis]
      const num = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(num)) {
        throw new Error(`墙体预设 wallProps 缺少或无效字段: ${label}.${axis}`)
      }
      return num
    }
    return {
      x: requiredAxis('x'),
      y: requiredAxis('y'),
      z: requiredAxis('z'),
    }
  }

  const cornerModelsRaw = record.cornerModels
  if (!Array.isArray(cornerModelsRaw)) {
    throw new Error('墙体预设 wallProps 缺少或无效字段: cornerModels')
  }

  const cornerModels = cornerModelsRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 格式无效`)
    }
    const row = entry as Record<string, unknown>
    const bodyAssetId = row.bodyAssetId === null ? null : normalizeOptionalAssetId(row.bodyAssetId)
    const headAssetId = row.headAssetId === null ? null : normalizeOptionalAssetId(row.headAssetId)
    const footAssetId = row.footAssetId === null ? null : normalizeOptionalAssetId(row.footAssetId)
    if (row.bodyAssetId !== null && bodyAssetId === null) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: bodyAssetId`)
    }
    if (row.headAssetId !== null && headAssetId === null) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: headAssetId`)
    }
    if (row.footAssetId !== null && footAssetId === null) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: footAssetId`)
    }
    const angle = typeof row.angle === 'number' && Number.isFinite(row.angle) ? row.angle : Number.NaN
    const tolerance = typeof row.tolerance === 'number' && Number.isFinite(row.tolerance) ? row.tolerance : Number.NaN
    if (!Number.isFinite(angle)) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: angle`)
    }
    if (!Number.isFinite(tolerance)) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: tolerance`)
    }
    const bodyForwardAxis = requiredForwardAxis(row.bodyForwardAxis, `cornerModels[${index}].bodyForwardAxis`)
    const bodyYawDeg = requiredYawDeg(row.bodyYawDeg, `cornerModels[${index}].bodyYawDeg`)
    const headForwardAxis = requiredForwardAxis(row.headForwardAxis, `cornerModels[${index}].headForwardAxis`)
    const headYawDeg = requiredYawDeg(row.headYawDeg, `cornerModels[${index}].headYawDeg`)
    const footForwardAxis = requiredForwardAxis(row.footForwardAxis, `cornerModels[${index}].footForwardAxis`)
    const footYawDeg = requiredYawDeg(row.footYawDeg, `cornerModels[${index}].footYawDeg`)
    const bodyOffsetLocal = requiredOffsetLocal(row.bodyOffsetLocal, `cornerModels[${index}].bodyOffsetLocal`)
    const headOffsetLocal = requiredOffsetLocal(row.headOffsetLocal, `cornerModels[${index}].headOffsetLocal`)
    const footOffsetLocal = requiredOffsetLocal(row.footOffsetLocal, `cornerModels[${index}].footOffsetLocal`)
    return {
      bodyAssetId: bodyAssetId ?? null,
      headAssetId: headAssetId ?? null,
      footAssetId: footAssetId ?? null,
      bodyOffsetLocal,
      headOffsetLocal,
      footOffsetLocal,
      bodyForwardAxis,
      bodyYawDeg,
      headForwardAxis,
      headYawDeg,
      footForwardAxis,
      footYawDeg,
      angle,
      tolerance,
      jointTrim: requiredJointTrim(row.jointTrim, `cornerModels[${index}].jointTrim`),
    }
  })

  return {
    height: requiredNumber('height'),
    width: requiredNumber('width'),
    thickness: requiredNumber('thickness'),
    wallBaseOffsetLocal: record.wallBaseOffsetLocal
      ? requiredOffsetLocal(record.wallBaseOffsetLocal, 'wallBaseOffsetLocal')
      : { x: 0, y: 0, z: 0 },
    smoothing: requiredNumber('smoothing'),
    bodyMaterialConfigId: optionalMaterialConfigId('bodyMaterialConfigId'),
    wallRenderMode: normalizeWallRenderMode(record.wallRenderMode, 'stretch'),
    repeatInstanceStep: optionalRepeatInstanceStep(),
    isAirWall: requiredBoolean('isAirWall'),
    bodyAssetId: requiredAssetIdOrNull('bodyAssetId'),
    bodyOrientation: requiredOrientation(record.bodyOrientation, 'bodyOrientation') as any,
    bodyUvAxis: optionalUvAxis(record.bodyUvAxis, 'auto'),
    headAssetId: requiredAssetIdOrNull('headAssetId'),
    headOrientation: requiredOrientation(record.headOrientation, 'headOrientation') as any,
    headUvAxis: optionalUvAxis(record.headUvAxis, optionalUvAxis(record.bodyUvAxis, 'auto')),
    footAssetId: requiredAssetIdOrNull('footAssetId'),
    footOrientation: requiredOrientation(record.footOrientation, 'footOrientation') as any,
    footUvAxis: optionalUvAxis(record.footUvAxis, optionalUvAxis(record.bodyUvAxis, 'auto')),
    bodyEndCapAssetId: requiredAssetIdOrNull('bodyEndCapAssetId'),
    bodyEndCapOffsetLocal: record.bodyEndCapOffsetLocal
      ? requiredOffsetLocal(record.bodyEndCapOffsetLocal, 'bodyEndCapOffsetLocal')
      : { x: 0, y: 0, z: 0 },
    bodyEndCapOrientation: requiredOrientation(record.bodyEndCapOrientation, 'bodyEndCapOrientation') as any,
    headEndCapAssetId: requiredAssetIdOrNull('headEndCapAssetId'),
    headEndCapOffsetLocal: record.headEndCapOffsetLocal
      ? requiredOffsetLocal(record.headEndCapOffsetLocal, 'headEndCapOffsetLocal')
      : { x: 0, y: 0, z: 0 },
    headEndCapOrientation: requiredOrientation(record.headEndCapOrientation, 'headEndCapOrientation') as any,
    footEndCapAssetId: requiredAssetIdOrNull('footEndCapAssetId'),
    footEndCapOffsetLocal: record.footEndCapOffsetLocal
      ? requiredOffsetLocal(record.footEndCapOffsetLocal, 'footEndCapOffsetLocal')
      : { x: 0, y: 0, z: 0 },
    footEndCapOrientation: requiredOrientation(record.footEndCapOrientation, 'footEndCapOrientation') as any,
    cornerModels,
  }
}

export function parseWallPresetData(text: string): WallPresetData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('墙体预设数据损坏：无法解析 JSON')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('墙体预设格式无效')
  }

  const record = parsed as Record<string, unknown>
  if (record.kind !== 'wall-preset') {
    throw new Error('墙体预设格式不受支持')
  }
  if (record.formatVersion !== WALL_PRESET_FORMAT_VERSION) {
    throw new Error(`墙体预设版本不匹配 (expected ${WALL_PRESET_FORMAT_VERSION})`)
  }

  const name = typeof record.name === 'string' && record.name.trim().length ? record.name.trim() : ''
  if (!name) {
    throw new Error('墙体预设缺少名称')
  }

  const wallProps = assertStrictWallPresetWallProps(record.wallProps)

  const materialOrderRaw = record.materialOrder
  if (!Array.isArray(materialOrderRaw)) {
    throw new Error('墙体预设缺少或无效字段: materialOrder')
  }
  const materialOrder = materialOrderRaw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)

  const materialPatchesRaw = record.materialPatches
  if (!materialPatchesRaw || typeof materialPatchesRaw !== 'object') {
    throw new Error('墙体预设缺少或无效字段: materialPatches')
  }
  const materialPatches: Record<string, WallPresetMaterialPatch> = {}
  for (const [key, value] of Object.entries(materialPatchesRaw as Record<string, unknown>)) {
    const id = typeof key === 'string' ? key.trim() : ''
    if (!id) {
      continue
    }
    if (!value || typeof value !== 'object') {
      throw new Error(`墙体预设 materialPatches[${id}] 格式无效`)
    }
    const patch = value as Record<string, unknown>
    const materialId = patch.materialId === null ? null : normalizeOptionalAssetId(patch.materialId)
    if (patch.materialId !== null && materialId === null) {
      throw new Error(`墙体预设 materialPatches[${id}] 缺少或无效字段: materialId`)
    }
    const next: WallPresetMaterialPatch = {
      id,
      materialId: materialId,
    }
    if (typeof patch.name === 'string' && patch.name.trim().length) {
      next.name = patch.name.trim()
    }
    if (typeof patch.type === 'string' && patch.type.trim().length) {
      next.type = patch.type.trim()
    }
    if (patch.props !== undefined) {
      if (!patch.props || typeof patch.props !== 'object' || Array.isArray(patch.props)) {
        throw new Error(`墙体预设 materialPatches[${id}] 字段 props 格式无效`)
      }
      next.props = patch.props as Record<string, unknown>
    }
    materialPatches[id] = next
  }

  for (const id of materialOrder) {
    if (!materialPatches[id]) {
      throw new Error(`墙体预设缺少 materialPatches[${id}]`)
    }
  }

  return {
    kind: 'wall-preset',
    formatVersion: WALL_PRESET_FORMAT_VERSION,
    name,
    wallProps,
    materialOrder,
    materialPatches,
    assetIndex: record.assetIndex,
    packageAssetMap: record.packageAssetMap,
  }
}

export function createWallPresetActions(deps: WallPresetActionsDeps) {
  return {
    findWallPresetAssetByFilename(store: WallPresetStoreLike, filename: string): ProjectAsset | null {
      const normalized = typeof filename === 'string' ? filename.trim().toLowerCase() : ''
      if (!normalized || !isWallPresetFilename(normalized)) {
        return null
      }
      const categories = Object.values(store.assetCatalog ?? {})
      for (const list of categories) {
        if (!Array.isArray(list)) {
          continue
        }
        for (const asset of list) {
          if (!asset || asset.type !== 'prefab') {
            continue
          }
          const description = typeof asset.description === 'string' ? asset.description.trim().toLowerCase() : ''
          if (description && description === normalized && isWallPresetFilename(description)) {
            return asset
          }
        }
      }
      return null
    },

    async saveWallPreset(
      store: WallPresetStoreLike,
      payload: { name: string; nodeId?: string | null; assetId?: string | null; select?: boolean },
    ): Promise<ProjectAsset> {
      if (payload.assetId === BUILTIN_AIR_WALL_PRESET_ASSET_ID) {
        throw new Error('内置空气墙预设不可覆盖')
      }
      const nodeId = (payload.nodeId ?? store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择墙体节点')
      }
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('墙体节点不存在或已被移除')
      }
      const component = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
      if (!component) {
        throw new Error('墙体节点缺少 Wall 组件')
      }

      const name = typeof payload.name === 'string' ? payload.name : ''
      const sanitizedName = deps.normalizePrefabName(name) || 'Wall Preset'

      const wallProps = assertStrictWallPresetWallProps(component.props)

      const nodeMaterials = Array.isArray((node as any).materials) ? ((node as any).materials as SceneNodeMaterial[]) : []
      if (!nodeMaterials.length) {
        throw new Error('墙体节点缺少材质槽位')
      }

      const materialOrder = nodeMaterials
        .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
        .filter((value) => value.length > 0)
      if (!materialOrder.length) {
        throw new Error('墙体节点材质槽位 id 无效')
      }

      const materialPatches: Record<string, WallPresetMaterialPatch> = {}
      for (const entry of nodeMaterials) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
        if (!id) {
          continue
        }

        // Shared material assignment: persist only the shared material id.
        if (typeof (entry as any).materialId === 'string' && (entry as any).materialId.trim().length) {
          materialPatches[id] = {
            id,
            materialId: (entry as any).materialId.trim(),
          }
          continue
        }

        materialPatches[id] = {
          id,
          materialId: null,
          name:
            typeof (entry as any).name === 'string' && (entry as any).name.trim().length
              ? (entry as any).name.trim()
              : undefined,
          type:
            typeof (entry as any).type === 'string' && (entry as any).type.trim().length
              ? (entry as any).type.trim()
              : undefined,
          props: deps.extractMaterialProps(entry) as unknown as Record<string, unknown>,
        }
      }

      for (const id of materialOrder) {
        if (!materialPatches[id]) {
          throw new Error(`墙体节点材质槽位缺少 patch: ${id}`)
        }
      }

      const nodeBodyMaterialConfigId = node.dynamicMesh?.type === 'Wall'
        ? resolveWallBodyMaterialConfigId(materialOrder, node.dynamicMesh.bodyMaterialConfigId)
        : null
      const wallPropsWithMaterialBinding: StrictWallPresetWallProps = {
        ...wallProps,
        bodyMaterialConfigId: resolveWallBodyMaterialConfigId(
          materialOrder,
          nodeBodyMaterialConfigId ?? component.props.bodyMaterialConfigId,
        ),
      }

      const dependencyAssetIds = Array.from(
        new Set(
          [
            wallPropsWithMaterialBinding.bodyAssetId,
            wallPropsWithMaterialBinding.headAssetId,
            wallPropsWithMaterialBinding.footAssetId,
            wallPropsWithMaterialBinding.bodyEndCapAssetId,
            wallPropsWithMaterialBinding.headEndCapAssetId,
            wallPropsWithMaterialBinding.footEndCapAssetId,
            ...(((wallPropsWithMaterialBinding as any).cornerModels ?? []) as any[])
              .flatMap((rule) => [rule?.bodyAssetId, rule?.headAssetId, rule?.footAssetId])
              .map((value) => (typeof value === 'string' ? value.trim() : ''))
              .filter((value) => value.length > 0),
            ...nodeMaterials.flatMap((material) => {
              const textures = ((material as any).textures ?? null) as Record<string, any> | null
              if (!textures || typeof textures !== 'object') {
                return []
              }
              return Object.values(textures)
                .map((ref) => (typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''))
                .filter((value) => value.length > 0)
            }),
          ]
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0),
        ),
      )

      const presetData: WallPresetData = {
        kind: 'wall-preset',
        formatVersion: WALL_PRESET_FORMAT_VERSION,
        name: sanitizedName,
        wallProps: wallPropsWithMaterialBinding,
        materialOrder,
        materialPatches,
      }

      if (dependencyAssetIds.length) {
        const assetIndexSubset = deps.buildAssetIndexSubsetForPrefab(store.assetIndex, dependencyAssetIds)
        if (assetIndexSubset) {
          presetData.assetIndex = assetIndexSubset
        }
        const packageAssetMapSubset = deps.buildPackageAssetMapSubsetForPrefab(store.packageAssetMap, dependencyAssetIds)
        if (packageAssetMapSubset) {
          presetData.packageAssetMap = packageAssetMapSubset
        }
      }

      const serialized = JSON.stringify(presetData, null, 2)
      const fileName = buildWallPresetFilename(sanitizedName)
      const assetId = typeof payload.assetId === 'string' && payload.assetId.trim().length ? payload.assetId.trim() : deps.generateUuid()

      const blob = new Blob([serialized], { type: 'application/json' })
      const assetCache = useAssetCacheStore()
      await assetCache.storeAssetBlob(assetId, {
        blob,
        mimeType: 'application/json',
        filename: fileName,
      })

      if (payload.assetId) {
        const existing = store.getAsset(assetId)
        if (!existing) {
          throw new Error('墙体预设资源不存在')
        }
        if (existing.type !== 'prefab') {
          throw new Error('指定资源并非墙体预设')
        }
        const updated: ProjectAsset = {
          ...existing,
          name: sanitizedName,
          description: fileName,
          previewColor: deps.WALL_PRESET_PREVIEW_COLOR,
        }
        const categoryId = determineAssetCategoryId(updated)
        const sourceMeta = (store.assetIndex as any)[assetId]?.source
        return store.registerAsset(updated, {
          categoryId,
          source: sourceMeta,
          commitOptions: { updateNodes: false },
        })
      }

      const projectAsset: ProjectAsset = {
        id: assetId,
        name: sanitizedName,
        type: 'prefab',
        downloadUrl: assetId,
        previewColor: deps.WALL_PRESET_PREVIEW_COLOR,
        thumbnail: null,
        description: fileName,
        gleaned: true,
        extension: extractExtension(fileName) ?? null,
      }
      const categoryId = determineAssetCategoryId(projectAsset)
      const registered = store.registerAsset(projectAsset, {
        categoryId,
        source: { type: 'local' },
        commitOptions: { updateNodes: false },
      })

      if (payload.select !== false) {
        store.setActiveDirectory(categoryId)
        store.selectAsset(registered.id)
      }

      return registered
    },

    async loadWallPreset(store: WallPresetStoreLike, assetId: string): Promise<WallPresetData> {
      if (assetId === BUILTIN_AIR_WALL_PRESET_ASSET_ID) {
        return BUILTIN_AIR_WALL_PRESET
      }
      const asset = store.getAsset(assetId)
      if (!asset) {
        throw new Error('墙体预设资源不存在')
      }
      if (asset.type !== 'prefab') {
        throw new Error('指定资源并非墙体预设')
      }
      if (!isWallPresetFilename(asset.description ?? null)) {
        throw new Error('指定资源并非 .wall 墙体预设')
      }

      const assetCache = useAssetCacheStore()
      let entry: any = assetCache.getEntry(assetId)
      if (!entry || entry.status !== 'cached' || !entry.blob) {
        entry = await assetCache.loadFromIndexedDb(assetId)
      }
      if ((!entry || !entry.blob) && asset.downloadUrl && /^https?:\/\//i.test(asset.downloadUrl)) {
        await assetCache.downloaProjectAsset(asset)
        entry = assetCache.getEntry(assetId)
      }
      if (!entry || !entry.blob) {
        throw new Error('无法加载墙体预设数据')
      }

      assetCache.touch(assetId)
      const text = await entry.blob.text()
      const preset = parseWallPresetData(text)

      if (preset.assetIndex !== undefined && preset.assetIndex !== null && !deps.isAssetIndex(preset.assetIndex)) {
        throw new Error('墙体预设 assetIndex 格式无效')
      }
      if (preset.packageAssetMap !== undefined && preset.packageAssetMap !== null && !deps.isPackageAssetMap(preset.packageAssetMap)) {
        throw new Error('墙体预设 packageAssetMap 格式无效')
      }

      return preset
    },

    async applyWallPresetToNode(
      store: WallPresetStoreLike,
      nodeId: string,
      assetId: string,
      presetData?: WallPresetData | null,
    ): Promise<WallComponentProps> {
      const node = deps.findNodeById(store.nodes, nodeId)
      if (!node) {
        throw new Error('墙体节点不存在或已被移除')
      }

      const preset = presetData ?? (await this.loadWallPreset(store, assetId))
      const wallProps = preset.wallProps

      if (!node.components?.[WALL_COMPONENT_TYPE]) {
        const result = store.addNodeComponent<typeof WALL_COMPONENT_TYPE>(nodeId, WALL_COMPONENT_TYPE)
        if (!result) {
          throw new Error('无法为节点添加 Wall 组件')
        }
      }

      const refreshed = deps.findNodeById(store.nodes, nodeId)
      const wallComponent = refreshed?.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
      if (!wallComponent) {
        throw new Error('Wall 组件不可用')
      }

      const dependencyAssetIds = Array.from(
        new Set(
          [
            wallProps.bodyAssetId,
            wallProps.headAssetId,
            wallProps.footAssetId,
            wallProps.bodyEndCapAssetId,
            wallProps.headEndCapAssetId,
            wallProps.footEndCapAssetId,
            ...(((wallProps as any).cornerModels ?? []) as any[])
              .flatMap((rule) => [rule?.bodyAssetId, rule?.headAssetId, rule?.footAssetId])
              .map((value) => (typeof value === 'string' ? value.trim() : ''))
              .filter((value) => value.length > 0),
            ...Object.values(preset.materialPatches ?? {}).flatMap((patch) => {
              const textures = ((patch as any)?.props as any)?.textures as Record<string, any> | null | undefined
              if (!textures || typeof textures !== 'object') {
                return []
              }
              return Object.values(textures)
                .map((ref) => (typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''))
                .filter((value) => value.length > 0)
            }),
          ]
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0),
        ),
      )

      const dependencyFilter = dependencyAssetIds.length ? new Set(dependencyAssetIds) : undefined
      const presetAssetIndex = preset.assetIndex && deps.isAssetIndex(preset.assetIndex) ? preset.assetIndex : undefined
      const presetPackageAssetMap = preset.packageAssetMap && deps.isPackageAssetMap(preset.packageAssetMap) ? preset.packageAssetMap : undefined

      if (presetAssetIndex || presetPackageAssetMap) {
        const { next: mergedIndex, changed: assetIndexChanged } = deps.mergeAssetIndexEntries(
          store.assetIndex,
          presetAssetIndex,
          dependencyFilter,
        )
        if (assetIndexChanged) {
          store.assetIndex = mergedIndex
        }
        const { next: mergedPackageMap, changed: packageMapChanged } = deps.mergePackageAssetMapEntries(
          store.packageAssetMap,
          presetPackageAssetMap,
          dependencyFilter,
        )
        if (packageMapChanged) {
          store.packageAssetMap = mergedPackageMap
        }
      }

      if (dependencyAssetIds.length) {
        await store.ensurePrefabDependencies(dependencyAssetIds, {
          prefabAssetIdForDownloadProgress: assetId,
          prefabAssetIndex: presetAssetIndex ?? null,
          prefabPackageAssetMap: presetPackageAssetMap ?? null,
        })
      }

      store.updateNodeComponentProps(
        nodeId,
        wallComponent.id,
        buildWallComponentPropsPatchFromPreset(wallProps) as unknown as Partial<Record<string, unknown>>,
      )

      // Apply node material patches (match by SceneNodeMaterial.id; preserve existing tail slots).
      const target = deps.findNodeById(store.nodes, nodeId)
      if (target && deps.nodeSupportsMaterials(target)) {
        const existing = Array.isArray(target.materials) ? (target.materials as SceneNodeMaterial[]) : []
        const existingById = new Map(existing.map((entry) => [entry.id, entry]))
        const order = Array.isArray(preset.materialOrder) ? preset.materialOrder : []
        const slotIdsInPreset = new Set(order.map((value) => (typeof value === 'string' ? value.trim() : '')).filter((value) => value.length > 0))

        const nextMaterials: SceneNodeMaterial[] = []
        for (const materialSlotId of order) {
          const slotId = typeof materialSlotId === 'string' ? materialSlotId.trim() : ''
          if (!slotId) {
            continue
          }
          const patch = preset.materialPatches?.[slotId]
          if (!patch) {
            throw new Error(`墙体预设缺少材质槽 patch: ${slotId}`)
          }

          const base = existingById.get(slotId) ?? null
          const sharedMaterialId = patch.materialId === null ? null : normalizeOptionalAssetId(patch.materialId)

          if (sharedMaterialId) {
            const shared = store.materials.find((entry) => entry.id === sharedMaterialId) ?? null
            if (!shared) {
              throw new Error(`墙体预设引用的共享材质不存在: ${sharedMaterialId}`)
            }
            if (patch.props && Object.keys(patch.props).length) {
              throw new Error(`墙体预设试图修改共享材质 props: ${slotId}`)
            }
            nextMaterials.push(
              deps.createNodeMaterial(shared.id, shared, {
                id: slotId,
                name: typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : shared.name,
                type: (shared as any).type,
              }),
            )
            continue
          }

          const baseEntry = base
            ? base.materialId
              ? deps.createNodeMaterial(null, deps.extractMaterialProps(base), { id: base.id, name: base.name, type: (base as any).type })
              : base
            : deps.createNodeMaterial(null, deps.createMaterialProps(), {
                id: slotId,
                name: typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : `Material ${nextMaterials.length + 1}`,
                type: typeof patch.type === 'string' && patch.type.trim().length ? (patch.type as any) : deps.DEFAULT_SCENE_MATERIAL_TYPE,
              })

          const overrides = patch.props ? deps.materialUpdateToProps(patch.props as any) : {}
          const mergedProps = patch.props ? deps.mergeMaterialProps(baseEntry as any, overrides) : deps.extractMaterialProps(baseEntry as any)
          nextMaterials.push(
            deps.createNodeMaterial(null, mergedProps, {
              id: slotId,
              name:
                typeof patch.name === 'string' && patch.name.trim().length
                  ? patch.name.trim()
                  : typeof (baseEntry as any).name === 'string' && (baseEntry as any).name.trim().length
                    ? (baseEntry as any).name
                    : `Material ${nextMaterials.length + 1}`,
              type:
                typeof patch.type === 'string' && patch.type.trim().length
                  ? (patch.type as any)
                  : (baseEntry as any).type,
            }),
          )
        }

        for (const entry of existing) {
          const slotId = typeof entry?.id === 'string' ? entry.id.trim() : ''
          if (!slotId || slotIdsInPreset.has(slotId)) {
            continue
          }
          nextMaterials.push(entry)
        }

        if (nextMaterials.length) {
          store.setNodeMaterials(nodeId, nextMaterials)
          const resolvedBodyMaterialConfigId = resolveWallBodyMaterialConfigId(
            nextMaterials
              .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
              .filter((value) => value.length > 0),
            wallProps.bodyMaterialConfigId,
          )
          store.updateNodeComponentProps(nodeId, wallComponent.id, {
            bodyMaterialConfigId: resolvedBodyMaterialConfigId,
          })
        }

      }

      return wallProps as unknown as WallComponentProps
    },

    async applyWallPresetToSelectedWall(store: WallPresetStoreLike, assetId: string): Promise<void> {
      const nodeId = (store.selectedNodeId ?? '').trim()
      if (!nodeId) {
        throw new Error('未选择墙体节点')
      }
      await this.applyWallPresetToNode(store, nodeId, assetId)
    },

    // Expose validator for use by sceneStore if needed.
    assertStrictWallPresetWallProps,
  }
}
