import type { SceneNode, SceneNodeComponentState, SceneNodeMaterial } from '@harmony/schema'
import { WALL_COMPONENT_TYPE, type WallComponentProps } from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import { useAssetCacheStore } from './assetCacheStore'
import { determineAssetCategoryId } from './assetCatalog'
import { extractExtension } from '@/utils/blob'
import {
  WALL_PRESET_FORMAT_VERSION,
  buildWallPresetFilename,
  isWallPresetFilename,
  type StrictWallPresetWallProps,
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

function normalizeOptionalAssetId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw.length ? raw : null
}

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
    if (row.bodyAssetId !== null && bodyAssetId === null) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: bodyAssetId`)
    }
    if (row.headAssetId !== null && headAssetId === null) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: headAssetId`)
    }
    const angle = typeof row.angle === 'number' && Number.isFinite(row.angle) ? row.angle : Number.NaN
    const tolerance = typeof row.tolerance === 'number' && Number.isFinite(row.tolerance) ? row.tolerance : Number.NaN
    if (!Number.isFinite(angle)) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: angle`)
    }
    if (!Number.isFinite(tolerance)) {
      throw new Error(`墙体预设 wallProps.cornerModels[${index}] 缺少或无效字段: tolerance`)
    }
    return { bodyAssetId: bodyAssetId ?? null, headAssetId: headAssetId ?? null, angle, tolerance }
  })

  return {
    height: requiredNumber('height'),
    width: requiredNumber('width'),
    thickness: requiredNumber('thickness'),
    smoothing: requiredNumber('smoothing'),
    isAirWall: requiredBoolean('isAirWall'),
    bodyAssetId: requiredAssetIdOrNull('bodyAssetId'),
    headAssetId: requiredAssetIdOrNull('headAssetId'),
    bodyEndCapAssetId: requiredAssetIdOrNull('bodyEndCapAssetId'),
    headEndCapAssetId: requiredAssetIdOrNull('headEndCapAssetId'),
    cornerModels,
  }
}

function parseWallPresetData(text: string): WallPresetData {
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

      const dependencyAssetIds = Array.from(
        new Set(
          [
            wallProps.bodyAssetId,
            wallProps.headAssetId,
            wallProps.bodyEndCapAssetId,
            wallProps.headEndCapAssetId,
            ...(((wallProps as any).cornerModels ?? []) as any[])
              .flatMap((rule) => [rule?.bodyAssetId, rule?.headAssetId])
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
        wallProps,
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
            wallProps.bodyEndCapAssetId,
            wallProps.headEndCapAssetId,
            ...(((wallProps as any).cornerModels ?? []) as any[])
              .flatMap((rule) => [rule?.bodyAssetId, rule?.headAssetId])
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

      store.updateNodeComponentProps(nodeId, wallComponent.id, {
        height: wallProps.height,
        width: wallProps.width,
        thickness: wallProps.thickness,
        smoothing: wallProps.smoothing,
        isAirWall: wallProps.isAirWall,
        bodyAssetId: wallProps.bodyAssetId ?? null,
        headAssetId: wallProps.headAssetId ?? null,
        bodyEndCapAssetId: wallProps.bodyEndCapAssetId ?? null,
        headEndCapAssetId: wallProps.headEndCapAssetId ?? null,
        cornerModels: wallProps.cornerModels ?? [],
      } as unknown as Partial<Record<string, unknown>>)

      // Apply node material patches (match by SceneNodeMaterial.id; preserve existing tail slots).
      const target = deps.findNodeById(store.nodes, nodeId)
      if (target && deps.nodeSupportsMaterials(target)) {
        const existing = Array.isArray(target.materials) ? (target.materials as SceneNodeMaterial[]) : []
        const existingById = new Map(existing.map((entry) => [entry.id, entry]))
        const order = Array.isArray(preset.materialOrder) ? preset.materialOrder : []
        const orderSet = new Set(order)

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

        // Preserve existing tail slots not mentioned in the preset.
        for (const entry of existing) {
          if (!orderSet.has(entry.id)) {
            nextMaterials.push(entry)
          }
        }

        if (nextMaterials.length) {
          store.setNodeMaterials(nodeId, nextMaterials)
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
