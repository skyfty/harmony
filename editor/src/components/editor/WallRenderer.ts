import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState, WallDynamicMesh } from '@schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import {
  getCachedModelObject,
  getOrCreateModelObjectRepeatVariant,
  getOrLoadModelObject,
  releaseModelInstancesForNode,
} from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { useSceneStore } from '@/stores/sceneStore'
import {
  createWallGroup,
  updateWallGroup,
  type WallRenderAssetObjects,
  type WallRenderOptions,
} from '@schema/wallMesh'
import {
  WALL_COMPONENT_TYPE,
  clampWallProps,
  resolveWallBodyMaterialConfigIdForRender,
  resolveWallComponentPropsFromMesh,
  type WallComponentProps,
} from '@schema/components'
import {
  applyWallInstancedBindings,
  buildWallInstancedRenderPlan,
  clearWallInstancedBindingsOnObject,
  setWallInstancedBindingsOnObject,
  syncWallDragBindingMatrices,
} from '@schema/wallInstancing'

const AIR_WALL_OPACITY = 0.35
const AIR_WALL_MATERIAL_ORIGINAL_KEY = '__harmonyAirWallOriginal'

type AirWallMaterialOriginalState = {
  transparent?: boolean
  opacity?: number
  depthWrite?: boolean
}

function applyAirWallMaterialOverride(material: THREE.Material, isAirWall: boolean): void {
  const mat = material as THREE.Material & {
    transparent?: boolean
    opacity?: number
    depthWrite?: boolean
    userData?: Record<string, unknown>
  }
  const userData = (mat.userData ??= {})

  if (isAirWall) {
    if (!userData[AIR_WALL_MATERIAL_ORIGINAL_KEY]) {
      const snapshot: AirWallMaterialOriginalState = {
        transparent: Boolean(mat.transparent),
        opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
        depthWrite: typeof mat.depthWrite === 'boolean' ? mat.depthWrite : true,
      }
      userData[AIR_WALL_MATERIAL_ORIGINAL_KEY] = snapshot
    }
    mat.opacity = AIR_WALL_OPACITY
    mat.depthWrite = false
    mat.needsUpdate = true
    
    return
  }

  const original = userData[AIR_WALL_MATERIAL_ORIGINAL_KEY] as AirWallMaterialOriginalState | undefined
  if (!original) {
    return
  }
  mat.transparent = Boolean(original.transparent)
  mat.opacity = typeof original.opacity === 'number' ? original.opacity : 1
  mat.depthWrite = typeof original.depthWrite === 'boolean' ? original.depthWrite : true
  delete userData[AIR_WALL_MATERIAL_ORIGINAL_KEY]
}

export function applyAirWallVisualToWallGroup(group: THREE.Group, isAirWall: boolean): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return
    }
    const tag = (mesh.userData as any)?.dynamicMeshType
    if (tag !== 'Wall') {
      return
    }
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] | null }).material
    if (!material) {
      return
    }
    if (Array.isArray(material)) {
      material.forEach((entry) => entry && applyAirWallMaterialOverride(entry, isAirWall))
      return
    }
    applyAirWallMaterialOverride(material, isAirWall)
  })
}

export function computeWallDynamicMeshSignature(
  definition: WallDynamicMesh,
  options: { wallRenderMode?: 'stretch' | 'repeatInstances' } = {},
): string {
  const serialized = stableSerialize({
    chains: definition.chains ?? [],
    openings: definition.openings ?? [],
    dimensions: definition.dimensions ?? { height: 3, width: 0.2, thickness: 0.1 },
    wallRenderMode: options.wallRenderMode === 'repeatInstances' ? 'repeatInstances' : 'stretch',
  })
  return hashString(serialized)
}

type WallRendererOptions = {
  assetCacheStore: {
    createFileFromCache: (assetId: string) => File | null
    loadFromIndexedDb: (assetId: string) => Promise<unknown>
    releaseInMemoryBlob: (assetId: string) => void
  }
  getNodeById: (nodeId: string) => SceneNode | null
  getObjectById: (nodeId: string) => THREE.Object3D | null
  ensureInstancedPickProxy: (container: THREE.Object3D, node: SceneNode) => void
  removeInstancedPickProxy: (container: THREE.Object3D) => void
}

export type WallPreviewRenderData = {
  assets: WallRenderAssetObjects
  renderOptions: WallRenderOptions
  isAirWall: boolean
  wantsInstancing: boolean
  hasMissingAssets: boolean
  signatureData: string
}

function disposeWallGroupResources(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return
    }
    const geometry = (mesh as unknown as { geometry?: THREE.BufferGeometry | null }).geometry
    if (geometry) {
      geometry.dispose()
    }
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] | null }).material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose())
    } else if (material) {
      material.dispose()
    }
  })
}

function resolveWallEffectiveDefinition(
  definition: WallDynamicMesh,
  props: WallComponentProps | null,
): WallDynamicMesh {
  if (!props || !definition.chains?.length) {
    return definition
  }

  const { height, width, thickness } = props
  const d = definition.dimensions
  if (d.height === height && d.width === width && d.thickness === thickness) {
    return definition
  }

  return { ...definition, dimensions: { height, width, thickness } }
}

export function createWallRenderer(options: WallRendererOptions) {
  const wallModelRequestCache = new Map<string, Promise<void>>()
  const wallAssetWaiters = new Map<string, Set<string>>()
  const resyncSignatureKeyByNodeId = new Map<string, string>()
  const suppressedCommittedWallNodeIds = new Set<string>()
  const previewNodeById = new Map<string, SceneNode>()
  const previewObjectById = new Map<string, THREE.Object3D>()

  // Keep editor drag and committed wall placement on the exact same schema-side path.
  const getWallAssetBounds = (assetId: string): THREE.Box3 | null => getCachedModelObject(assetId)?.boundingBox ?? null

  type WallDragBindingEntry = {
    assetId: string
    localMatrices: THREE.Matrix4[]
    bindingIdPrefix: string
    useNodeIdForIndex0: boolean
  }

  type WallDragCacheEntry = {
    nodeId: string
    bindings: WallDragBindingEntry[]
  }

  const wallDragCacheByNodeId = new Map<string, WallDragCacheEntry>()
  let activeWallDragNodeId: string | null = null

  const pendingResyncNodeIds = new Set<string>()
  let wallResyncRafHandle: number | null = null

  const FALLBACK_SIGNATURE_KEY = '__harmonyDynamicMeshSignature'
  const PREVIEW_SIGNATURE_KEY = '__harmonyWallPreviewSignature'

  function isPreviewNodeId(nodeId: string | null | undefined): boolean {
    return typeof nodeId === 'string' && nodeId.startsWith('__wall-preview__:')
  }

  function getRenderableNodeById(nodeId: string): SceneNode | null {
    return previewNodeById.get(nodeId) ?? options.getNodeById(nodeId)
  }

  function getRenderableObjectById(nodeId: string): THREE.Object3D | null {
    return previewObjectById.get(nodeId) ?? options.getObjectById(nodeId)
  }

  function buildPreviewNodeId(previewKey: string): string {
    const key = previewKey.trim()
    return `__wall-preview__:${key || 'default'}`
  }

  function isWallDragActive(nodeId: string): boolean {
    return activeWallDragNodeId === nodeId && wallDragCacheByNodeId.has(nodeId)
  }

  function isCommittedWallRenderSuppressed(nodeId: string): boolean {
    return suppressedCommittedWallNodeIds.has(nodeId)
  }

  function suppressCommittedWallRender(nodeId: string): void {
    const object = getRenderableObjectById(nodeId)
    if (!object) {
      return
    }

    const userData = object.userData ?? (object.userData = {})
    const wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup) {
      wallGroup.visible = false
    }

    releaseModelInstancesForNode(nodeId)
    clearWallInstancedBindingsOnObject(object)
    delete userData.instancedAssetId
    delete userData.instancedBounds
    options.removeInstancedPickProxy(object)
  }

  function buildWallDragCache(nodeId: string): WallDragCacheEntry | null {
    const node = getRenderableNodeById(nodeId)
    if (!node || node.dynamicMesh?.type !== 'Wall') {
      return null
    }

    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined

    const wallProps = wallComponent
      ? clampWallProps(wallComponent.props as Partial<WallComponentProps> | null | undefined)
      : null

    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const headAssetId = wallComponent?.props?.headAssetId ?? null
    const footAssetId = wallComponent?.props?.footAssetId ?? null
    const bodyEndCapAssetId = wallComponent?.props?.bodyEndCapAssetId ?? null
    const headEndCapAssetId = wallComponent?.props?.headEndCapAssetId ?? null
    const footEndCapAssetId = wallComponent?.props?.footEndCapAssetId ?? null
    const cornerModels = wallProps?.cornerModels ?? []
    const hasBodyCornerAssets = cornerModels.some((entry) => typeof (entry as any)?.bodyAssetId === 'string' && (entry as any).bodyAssetId.trim().length)
    const hasHeadCornerAssets = cornerModels.some((entry) => typeof (entry as any)?.headAssetId === 'string' && (entry as any).headAssetId.trim().length)
    const hasFootCornerAssets = cornerModels.some((entry) => typeof (entry as any)?.footAssetId === 'string' && (entry as any).footAssetId.trim().length)
    const definition = node.dynamicMesh as WallDynamicMesh
    const effectiveDefinition = resolveWallEffectiveDefinition(definition, wallProps)
    const canHaveCornerJoints = (hasBodyCornerAssets || hasHeadCornerAssets || hasFootCornerAssets) && (effectiveDefinition.chains?.some(c => (c.points?.length ?? 0) >= 3) ?? false)
    const wantsInstancing = Boolean(bodyAssetId || headAssetId || footAssetId || bodyEndCapAssetId || headEndCapAssetId || footEndCapAssetId || canHaveCornerJoints)
    if (!wantsInstancing) {
      return null
    }
    const plan = wallProps
      ? buildWallInstancedRenderPlan({
          nodeId,
          definition,
          wallProps,
          getAssetBounds: getWallAssetBounds,
        })
      : null

    const bindings: WallDragBindingEntry[] = []
    for (const binding of plan?.bindings ?? []) {
      if (binding.sourceAssetId && binding.repeatScaleU && binding.sourceAssetId !== binding.assetId) {
        const variant = getOrCreateModelObjectRepeatVariant(binding.sourceAssetId, binding.assetId, binding.repeatScaleU)
        if (!variant) {
          continue
        }
      }
      if (!binding.localMatrices.length) {
        continue
      }
      bindings.push({
        assetId: binding.assetId,
        localMatrices: binding.localMatrices,
        bindingIdPrefix: binding.bindingIdPrefix,
        useNodeIdForIndex0: binding.useNodeIdForIndex0,
      })
    }

    if (!bindings.length) {
      return null
    }

    return { nodeId, bindings }
  }

  function beginWallDrag(nodeId: string, dragOptions: { suppressCommittedRender?: boolean } = {}): boolean {
    const shouldSuppressCommittedRender = dragOptions.suppressCommittedRender === true
    const cache = buildWallDragCache(nodeId)
    if (!cache) {
      if (activeWallDragNodeId === nodeId) {
        wallDragCacheByNodeId.delete(nodeId)
        activeWallDragNodeId = null
      }
      if (!shouldSuppressCommittedRender) {
        return false
      }
    } else {
      wallDragCacheByNodeId.set(nodeId, cache)
      activeWallDragNodeId = nodeId
    }

    if (shouldSuppressCommittedRender) {
      suppressedCommittedWallNodeIds.add(nodeId)
      suppressCommittedWallRender(nodeId)
    }

    return true
  }

  function endWallDrag(nodeId: string | null | undefined): void {
    if (!nodeId) {
      return
    }
    if (activeWallDragNodeId === nodeId) {
      activeWallDragNodeId = null
    }
    wallDragCacheByNodeId.delete(nodeId)
    suppressedCommittedWallNodeIds.delete(nodeId)

    const node = getRenderableNodeById(nodeId)
    const object = getRenderableObjectById(nodeId)
    if (!node || !object) {
      return
    }
    const signatureKey = resyncSignatureKeyByNodeId.get(nodeId) ?? FALLBACK_SIGNATURE_KEY
    syncWallContainer(object, node, signatureKey)
  }

  function syncWallDragInstancedMatrices(nodeId: string, baseMatrix: THREE.Matrix4): boolean {
    if (!isWallDragActive(nodeId)) {
      return false
    }
    const cache = wallDragCacheByNodeId.get(nodeId)
    if (!cache) {
      return false
    }

    return syncWallDragBindingMatrices({
      nodeId,
      baseMatrix,
      bindings: cache.bindings,
    })
  }

  function scheduleWallResync(nodeId: string): void {
    pendingResyncNodeIds.add(nodeId)

    if (wallResyncRafHandle !== null) {
      return
    }

    const raf =
      typeof globalThis !== 'undefined' && typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null

    const schedule = (callback: () => void) => {
      if (raf) {
        wallResyncRafHandle = raf(callback)
        return
      }
      // Fallback: microtask flush (shouldn't happen in the editor runtime).
      wallResyncRafHandle = 1
      void Promise.resolve().then(callback)
    }

    schedule(() => {
      wallResyncRafHandle = null
      const nodeIds = Array.from(pendingResyncNodeIds)
      pendingResyncNodeIds.clear()

      nodeIds.forEach((id) => {
        const node = getRenderableNodeById(id)
        const object = getRenderableObjectById(id)
        if (!node || !object) {
          return
        }
        const signatureKey = resyncSignatureKeyByNodeId.get(id) ?? FALLBACK_SIGNATURE_KEY
        syncWallContainer(object, node, signatureKey)
      })
    })
  }

  function scheduleWallAssetLoad(assetId: string, nodeId: string, signatureKey: string) {
    // Track all wall nodes waiting on this asset so we can resync them once.
    resyncSignatureKeyByNodeId.set(nodeId, signatureKey)
    const waiters = wallAssetWaiters.get(assetId) ?? new Set<string>()
    waiters.add(nodeId)
    wallAssetWaiters.set(assetId, waiters)

    if (wallModelRequestCache.has(assetId)) {
      return
    }

    const promise = (async () => {
      try {
        let group = getCachedModelObject(assetId)
          if (!group) {
          let file = options.assetCacheStore.createFileFromCache(assetId)
          if (!file) {
            await options.assetCacheStore.loadFromIndexedDb(assetId)
            file = options.assetCacheStore.createFileFromCache(assetId)
          }
          if (!file) {
            return
          }
          const ext = useSceneStore().getAsset(assetId)?.extension ?? undefined
          group = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file, ext))
          options.assetCacheStore.releaseInMemoryBlob(assetId)
        }

        // Resync all nodes that were waiting on this asset in a single frame.
        const waitingIds = wallAssetWaiters.get(assetId)
        if (waitingIds && waitingIds.size) {
          waitingIds.forEach((id) => scheduleWallResync(id))
          wallAssetWaiters.delete(assetId)
        } else {
          scheduleWallResync(nodeId)
        }
      } catch {
      } finally {
        wallModelRequestCache.delete(assetId)
      }
    })()

    wallModelRequestCache.set(assetId, promise)
  }

  function resolveWallPreviewRenderData(params: {
    definition: WallDynamicMesh
    wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined
    nodeId?: string | null
    previewKey: string
  }): WallPreviewRenderData {
    const normalizedProps = normalizeWallPreviewProps(params.definition, params.wallProps)

    const cornerModels = Array.isArray(normalizedProps?.cornerModels)
      ? normalizedProps.cornerModels
      : []
    const bodyCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.bodyAssetId === 'string' ? (entry as any).bodyAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    const headCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.headAssetId === 'string' ? (entry as any).headAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    const footCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.footAssetId === 'string' ? (entry as any).footAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()

    const canHaveCornerJoints =
      (bodyCornerAssetIds.length > 0 || headCornerAssetIds.length > 0 || footCornerAssetIds.length > 0)
      && (params.definition.chains?.some(c => (c.points?.length ?? 0) >= 3) ?? false)

    const bodyAssetId = normalizedProps?.bodyAssetId ?? null
    const headAssetId = normalizedProps?.headAssetId ?? null
    const footAssetId = normalizedProps?.footAssetId ?? null
    const bodyEndCapAssetId = normalizedProps?.bodyEndCapAssetId ?? null
    const headEndCapAssetId = normalizedProps?.headEndCapAssetId ?? null
    const footEndCapAssetId = normalizedProps?.footEndCapAssetId ?? null

    const wantsInstancing = Boolean(
      bodyAssetId || headAssetId || footAssetId || bodyEndCapAssetId || headEndCapAssetId || footEndCapAssetId || canHaveCornerJoints,
    )

    const renderOptions: WallRenderOptions = normalizedProps
      ? {
        bodyMaterialConfigId: resolveWallBodyMaterialConfigIdForRender(params.definition, normalizedProps),
        cornerModels,
        wallRenderMode: normalizedProps.wallRenderMode,
        repeatInstanceStep: normalizedProps.repeatInstanceStep,
        bodyUvAxis: normalizedProps.bodyUvAxis,
        headUvAxis: normalizedProps.headUvAxis,
        footUvAxis: normalizedProps.footUvAxis,
        bodyOrientation: normalizedProps.bodyOrientation,
        headOrientation: normalizedProps.headOrientation,
        footOrientation: normalizedProps.footOrientation,
        bodyEndCapOffsetLocal: normalizedProps.bodyEndCapOffsetLocal,
        bodyEndCapOrientation: normalizedProps.bodyEndCapOrientation,
        headEndCapOffsetLocal: normalizedProps.headEndCapOffsetLocal,
        headEndCapOrientation: normalizedProps.headEndCapOrientation,
        footEndCapOffsetLocal: normalizedProps.footEndCapOffsetLocal,
        footEndCapOrientation: normalizedProps.footEndCapOrientation,
      }
      : {}

    const assets: WallRenderAssetObjects = {}
    const syntheticNodeId = buildPreviewNodeId(typeof params.previewKey === 'string' ? params.previewKey : '')
    let hasMissingAssets = false

    const resolvePreviewAsset = (assetId: string | null | undefined): THREE.Object3D | null => {
      const id = typeof assetId === 'string' ? assetId.trim() : ''
      if (!id) {
        return null
      }
      const cached = getCachedModelObject(id)
      if (cached) {
        return cached.object
      }
      hasMissingAssets = true
      scheduleWallAssetLoad(id, syntheticNodeId, PREVIEW_SIGNATURE_KEY)
      return null
    }

    const bodyObject = resolvePreviewAsset(bodyAssetId)
    if (bodyObject) {
      assets.bodyObject = bodyObject
    }
    const headObject = resolvePreviewAsset(headAssetId)
    if (headObject) {
      assets.headObject = headObject
    }
    const footObject = resolvePreviewAsset(footAssetId)
    if (footObject) {
      assets.footObject = footObject
    }

    const bodyEndCapObject = resolvePreviewAsset(bodyEndCapAssetId)
    if (bodyEndCapObject) {
      assets.bodyEndCapObject = bodyEndCapObject
    }
    const headEndCapObject = resolvePreviewAsset(headEndCapAssetId)
    if (headEndCapObject) {
      assets.headEndCapObject = headEndCapObject
    }
    const footEndCapObject = resolvePreviewAsset(footEndCapAssetId)
    if (footEndCapObject) {
      assets.footEndCapObject = footEndCapObject
    }

    const resolveCornerAssetMap = (assetIds: string[]): Record<string, THREE.Object3D | null> | null => {
      if (!assetIds.length) {
        return null
      }
      const map: Record<string, THREE.Object3D | null> = {}
      for (const assetId of assetIds) {
        const resolved = resolvePreviewAsset(assetId)
        if (resolved) {
          map[assetId] = resolved
        }
      }
      return Object.keys(map).length ? map : null
    }

    const bodyCornerObjectsByAssetId = resolveCornerAssetMap(bodyCornerAssetIds)
    if (bodyCornerObjectsByAssetId) {
      assets.bodyCornerObjectsByAssetId = bodyCornerObjectsByAssetId
    }
    const headCornerObjectsByAssetId = resolveCornerAssetMap(headCornerAssetIds)
    if (headCornerObjectsByAssetId) {
      assets.headCornerObjectsByAssetId = headCornerObjectsByAssetId
    }
    const footCornerObjectsByAssetId = resolveCornerAssetMap(footCornerAssetIds)
    if (footCornerObjectsByAssetId) {
      assets.footCornerObjectsByAssetId = footCornerObjectsByAssetId
    }

    return {
      assets,
      renderOptions,
      isAirWall: Boolean(normalizedProps?.isAirWall),
      wantsInstancing,
      hasMissingAssets,
      signatureData: stableSerialize({
        normalizedProps,
        renderOptions,
        isAirWall: Boolean(normalizedProps?.isAirWall),
        wantsInstancing,
        hasMissingAssets,
        availableAssets: {
          body: Boolean(bodyObject),
          head: Boolean(headObject),
          foot: Boolean(footObject),
          bodyEndCap: Boolean(bodyEndCapObject),
          headEndCap: Boolean(headEndCapObject),
          footEndCap: Boolean(footEndCapObject),
          bodyCorners: bodyCornerAssetIds.filter((assetId) => Boolean(bodyCornerObjectsByAssetId?.[assetId])),
          headCorners: headCornerAssetIds.filter((assetId) => Boolean(headCornerObjectsByAssetId?.[assetId])),
          footCorners: footCornerAssetIds.filter((assetId) => Boolean(footCornerObjectsByAssetId?.[assetId])),
        },
      }),
    }
  }

  function normalizeWallPreviewProps(
    definition: WallDynamicMesh,
    wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined,
  ): WallComponentProps | null {
    if (!wallProps) {
      return null
    }

    const baseProps = resolveWallComponentPropsFromMesh(definition)
    const source = wallProps as Partial<WallComponentProps>
    const sourceAny = source as Record<string, unknown>

    return clampWallProps({
      height: source.height ?? baseProps.height,
      width: source.width ?? baseProps.width,
      thickness: source.thickness ?? baseProps.thickness,
      bodyMaterialConfigId: source.bodyMaterialConfigId ?? baseProps.bodyMaterialConfigId,
      isAirWall: source.isAirWall ?? baseProps.isAirWall,
      wallRenderMode: source.wallRenderMode ?? baseProps.wallRenderMode,
      repeatInstanceStep: source.repeatInstanceStep ?? baseProps.repeatInstanceStep,
      bodyAssetId: source.bodyAssetId ?? baseProps.bodyAssetId,
      headAssetId: source.headAssetId ?? baseProps.headAssetId,
      footAssetId: source.footAssetId ?? baseProps.footAssetId,
      bodyUvAxis: source.bodyUvAxis ?? baseProps.bodyUvAxis,
      headUvAxis: source.headUvAxis ?? baseProps.headUvAxis,
      footUvAxis: source.footUvAxis ?? baseProps.footUvAxis,
      bodyEndCapAssetId: source.bodyEndCapAssetId ?? baseProps.bodyEndCapAssetId,
      bodyEndCapOffsetLocal: source.bodyEndCapOffsetLocal ?? baseProps.bodyEndCapOffsetLocal,
      headEndCapAssetId: source.headEndCapAssetId ?? baseProps.headEndCapAssetId,
      headEndCapOffsetLocal: source.headEndCapOffsetLocal ?? baseProps.headEndCapOffsetLocal,
      footEndCapAssetId: source.footEndCapAssetId ?? baseProps.footEndCapAssetId,
      footEndCapOffsetLocal: source.footEndCapOffsetLocal ?? baseProps.footEndCapOffsetLocal,
      bodyOrientation: source.bodyOrientation ?? baseProps.bodyOrientation,
      headOrientation: source.headOrientation ?? baseProps.headOrientation,
      footOrientation: source.footOrientation ?? baseProps.footOrientation,
      bodyEndCapOrientation: source.bodyEndCapOrientation ?? baseProps.bodyEndCapOrientation,
      headEndCapOrientation: source.headEndCapOrientation ?? baseProps.headEndCapOrientation,
      footEndCapOrientation: source.footEndCapOrientation ?? baseProps.footEndCapOrientation,
      cornerModels: Array.isArray(sourceAny.cornerModels) ? sourceAny.cornerModels as any[] : baseProps.cornerModels,
    })
  }

  function releasePreviewNodeRuntimeState(previewNodeId: string): void {
    previewNodeById.delete(previewNodeId)
    previewObjectById.delete(previewNodeId)
    resyncSignatureKeyByNodeId.delete(previewNodeId)
    pendingResyncNodeIds.delete(previewNodeId)
    wallDragCacheByNodeId.delete(previewNodeId)
    suppressedCommittedWallNodeIds.delete(previewNodeId)
    if (activeWallDragNodeId === previewNodeId) {
      activeWallDragNodeId = null
    }
    releaseModelInstancesForNode(previewNodeId)
  }

  function syncWallPreviewContainer(params: {
    container: THREE.Object3D
    definition: WallDynamicMesh
    wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined
    previewKey: string
  }): void {
    const previewNodeId = buildPreviewNodeId(params.previewKey)
    const userData = params.container.userData ?? (params.container.userData = {})
    const previousPreviewNodeId = typeof userData.wallPreviewNodeId === 'string'
      ? userData.wallPreviewNodeId
      : null

    // Reusing the same preview container across different keys (e.g. draft -> committed node)
    // must release old instanced bindings, otherwise stale first-segment ghosts can persist.
    if (previousPreviewNodeId && previousPreviewNodeId !== previewNodeId) {
      releasePreviewNodeRuntimeState(previousPreviewNodeId)
    }

    const normalizedProps = normalizeWallPreviewProps(params.definition, params.wallProps)
    const previewNode: SceneNode = {
      id: previewNodeId,
      name: 'WallPreview',
      nodeType: 'Mesh',
      position: { x: params.container.position.x, y: params.container.position.y, z: params.container.position.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      dynamicMesh: params.definition,
      components: normalizedProps
        ? {
            [WALL_COMPONENT_TYPE]: {
              id: previewNodeId,
              type: WALL_COMPONENT_TYPE,
              enabled: true,
              props: normalizedProps,
            },
          }
        : undefined,
      userData,
    }

    previewNodeById.set(previewNodeId, previewNode)
    previewObjectById.set(previewNodeId, params.container)
    params.container.userData = {
      ...userData,
      isWallPreview: true,
      wallPreviewNodeId: previewNodeId,
    }

    syncWallContainer(params.container, previewNode, PREVIEW_SIGNATURE_KEY)
  }

  function disposeWallPreviewContainer(container: THREE.Object3D | null | undefined): void {
    if (!container) {
      return
    }

    const userData = container.userData ?? (container.userData = {})
    const previewNodeId = typeof userData.wallPreviewNodeId === 'string' ? userData.wallPreviewNodeId : null
    if (previewNodeId) {
      releasePreviewNodeRuntimeState(previewNodeId)
    }

    clearWallInstancedBindingsOnObject(container)
    delete userData.instancedAssetId
    delete userData.instancedBounds
    delete userData.wallPreviewNodeId
    options.removeInstancedPickProxy(container)
    removeWallGroup(container)
  }

  function ensureWallGroup(
    container: THREE.Object3D,
    node: SceneNode,
    signatureKey: string,
    wallDefinition: WallDynamicMesh,
    renderOptions: WallRenderOptions,
  ): THREE.Group {
    const userData = container.userData ?? (container.userData = {})
    let wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup) {
      return wallGroup
    }

    wallGroup = createWallGroup(wallDefinition, renderOptions)
    wallGroup.userData.nodeId = node.id
    wallGroup.userData[signatureKey] = computeWallDynamicMeshSignature(wallDefinition, {
      wallRenderMode: renderOptions.wallRenderMode,
    })
    wallGroup.userData.__harmonyWallBodyMaterialConfigId = renderOptions.bodyMaterialConfigId ?? null
    container.add(wallGroup)
    userData.wallGroup = wallGroup
    userData.dynamicMeshType = 'Wall'
    return wallGroup
  }

  function updateWallGroupIfNeeded(
    wallGroup: THREE.Group,
    definition: WallDynamicMesh,
    signatureKey: string,
    options: WallRenderOptions = {},
  ): void {
    const groupData = wallGroup.userData ?? (wallGroup.userData = {})
    const nextSignature = computeWallDynamicMeshSignature(definition, {
      wallRenderMode: options.wallRenderMode,
    })
    const nextBodyMaterialConfigId = options.bodyMaterialConfigId ?? null
    if (
      groupData[signatureKey] !== nextSignature
      || groupData.__harmonyWallBodyMaterialConfigId !== nextBodyMaterialConfigId
    ) {
      updateWallGroup(wallGroup, definition, options)
      groupData[signatureKey] = nextSignature
      groupData.__harmonyWallBodyMaterialConfigId = nextBodyMaterialConfigId
    }
  }

  function removeWallGroup(container: THREE.Object3D): void {
    const userData = container.userData ?? (container.userData = {})

    // Be defensive: remove any procedural wall nodes that might have been left behind.
    // This includes legacy direct WallMesh children created by older update paths.
    const candidateGroups = container.children.filter((child) => {
      const group = child as THREE.Group
      return Boolean(group?.isGroup && group.name === 'WallGroup' && (group.userData as any)?.dynamicMeshType === 'Wall')
    }) as THREE.Group[]

    const candidateMeshes = container.children.filter((child) => {
      const mesh = child as THREE.Mesh
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
        return false
      }
      const userData = (mesh.userData ?? {}) as Record<string, unknown>
      const name = typeof mesh.name === 'string' ? mesh.name : ''
      return userData.dynamicMeshType === 'Wall' && name.startsWith('WallMesh')
    }) as THREE.Mesh[]

    const wallGroup = userData.wallGroup as THREE.Group | undefined
    if (wallGroup && !candidateGroups.includes(wallGroup)) {
      candidateGroups.push(wallGroup)
    }

    if (!candidateGroups.length && !candidateMeshes.length) {
      return
    }

    for (const group of candidateGroups) {
      disposeWallGroupResources(group)
      group.removeFromParent()
    }

    for (const mesh of candidateMeshes) {
      const geometry = (mesh as unknown as { geometry?: THREE.BufferGeometry | null }).geometry
      if (geometry) {
        geometry.dispose()
      }
      const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] | null }).material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry?.dispose())
      } else if (material) {
        material.dispose()
      }
      mesh.removeFromParent()
    }

    delete userData.wallGroup
  }

  function syncWallContainer(container: THREE.Object3D, node: SceneNode, signatureKey: string): void {
    // ============================
    // 该函数职责（重要）：
    // - 根据 SceneNode 上的 wall 组件配置、动态网格数据、以及模型资源是否已就绪，
    //   决定当前 wall 的渲染方式：
    //   1) 纯程序生成的墙体（procedural wallGroup）
    //   2) 基于模型资源的实例化渲染（instanced models: body/head/corner/caps）
    // - 在资源未加载完成时，使用程序墙体作为“可视回退”，避免编辑器里出现空白。
    // - 维护与拾取（pick）相关的代理对象：实例化模式下启用 pick proxy；否则移除。
    // - 同步 / 清理 instanced 实例与 bounds 缓存（用于拾取/框选等）。
    // ============================
    if (node.dynamicMesh?.type !== 'Wall') {
      return
    }

    if (isWallDragActive(node.id) || isCommittedWallRenderSuppressed(node.id)) {
      // 拖拽过程中会走一套“临时实例矩阵”的实时更新逻辑（见 syncWallDragInstancedMatrices）。
      // 手柄编辑时还会显式压掉 committed wall 渲染，只保留编辑结果预览。
      return
    }

    // 实例化矩阵提交依赖 container.matrixWorld；确保其在本次同步前已更新。
    // 这对“首次进入场景 / 刚挂载到父节点”的场景尤其关键。
    container.updateMatrixWorld(true)

    const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as
      | SceneNodeComponentState<WallComponentProps>
      | undefined

    // 空气墙（AirWall）：编辑器里通常需要“可区分、半透明”的视觉提示。
    // 同时它不应该实例化加载/渲染各种模型资源（否则会变成实心墙体的模型）。
    const isAirWall = Boolean(wallComponent?.props?.isAirWall)

    // 统一规整 wall props（clampWallProps 会负责缺省值/范围约束）。
    const wallProps = wallComponent
      ? clampWallProps(wallComponent.props as Partial<WallComponentProps> | null | undefined)
      : null
    const wallRenderMode = wallProps?.wallRenderMode ?? 'stretch'

    // 各类实例化模型资源：
    // - body/head：沿墙段平铺的主体模型（可以按段高度进行 Y 方向缩放）。
    // - endCaps：首尾端盖（仅非闭合路径时才会放置）。
    const bodyAssetId = wallComponent?.props?.bodyAssetId ?? null
    const headAssetId = wallComponent?.props?.headAssetId ?? null
    const footAssetId = wallComponent?.props?.footAssetId ?? null
    const bodyEndCapAssetId = wallComponent?.props?.bodyEndCapAssetId ?? null
    const headEndCapAssetId = wallComponent?.props?.headEndCapAssetId ?? null
    const footEndCapAssetId = wallComponent?.props?.footEndCapAssetId ?? null
    // 拐角模型规则：根据相邻墙段形成的“内角”在规则表中匹配对应模型。
    // 规则既可以配置 body 的拐角模型，也可以配置 head 的拐角模型。
    const cornerModels = Array.isArray(wallComponent?.props?.cornerModels)
      ? wallComponent!.props!.cornerModels!
      : []
    const bodyCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.bodyAssetId === 'string' ? (entry as any).bodyAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    const headCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.headAssetId === 'string' ? (entry as any).headAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    const footCornerAssetIds = Array.from(
      new Set(
        cornerModels
          .map((entry) => (typeof (entry as any)?.footAssetId === 'string' ? (entry as any).footAssetId.trim() : ''))
          .filter((id) => Boolean(id)),
      ),
    ).sort()
    // definition：节点当前的 wall 动态网格（由用户编辑/运行时生成）。
    // effectiveDefinition：在渲染前，将 wall props（width/height/thickness）覆盖到每段 segment 上，
    // 以保证程序墙体与实例化计算使用一致的尺寸数据。
    const definition = node.dynamicMesh as WallDynamicMesh
    const effectiveDefinition = resolveWallEffectiveDefinition(definition, wallProps)

    // 拐角 joint 需要至少两段才可能存在。
    const canHaveCornerJoints =
      (bodyCornerAssetIds.length > 0 || headCornerAssetIds.length > 0 || footCornerAssetIds.length > 0) && (effectiveDefinition.chains?.some(c => (c.points?.length ?? 0) >= 3) ?? false)

    // wantsInstancing：只要配置了任何一种实例化相关资源（body/head/caps/corners），
    // 就尝试走实例化渲染（资源未就绪时会回退到程序墙体）。
    const wantsInstancing = Boolean(
      bodyAssetId || headAssetId || footAssetId || bodyEndCapAssetId || headEndCapAssetId || footEndCapAssetId || canHaveCornerJoints,
    )
    const hasProceduralBodyFallback = !bodyAssetId

    const resolveCachedWallAssetHeight = (assetId: string | null | undefined): number | undefined => {
      const id = typeof assetId === 'string' ? assetId.trim() : ''
      if (!id) {
        return undefined
      }
      const bounds = getWallAssetBounds(id)
      if (!bounds) {
        return undefined
      }
      const height = bounds.max.y - bounds.min.y
      return Number.isFinite(height) && height > 0 ? height : undefined
    }

    const buildProceduralWallRenderOptions = (): WallRenderOptions => ({
      wallRenderMode,
      repeatInstanceStep: wallProps?.repeatInstanceStep,
      bodyMaterialConfigId: resolveWallBodyMaterialConfigIdForRender(definition, wallProps),
      headAssetHeight: resolveCachedWallAssetHeight(headAssetId),
      footAssetHeight: resolveCachedWallAssetHeight(footAssetId),
    })

    const userData = container.userData ?? (container.userData = {})

    // ============================
    // 1) 空气墙：强制使用程序墙体（并应用半透明材质覆盖）
    // ============================
    // 设计意图：空气墙用于“碰撞/导航/逻辑”而非真实墙体外观。
    // 因此：
    // - 不渲染任何实例化模型
    // - 始终保留程序墙体，且以半透明方式显示
    // ============================
    // 2) 完全不需要实例化：使用程序墙体
    // ============================
    if (!wantsInstancing || isAirWall) {
      releaseModelInstancesForNode(node.id)
      clearWallInstancedBindingsOnObject(container)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallRenderOptions = buildProceduralWallRenderOptions()
      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, wallRenderOptions)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        wallRenderOptions,
      )

      // Editor-only visual: air walls are semi-transparent so they can be distinguished.
      applyAirWallVisualToWallGroup(wallGroup, isAirWall)
      return
    }

    // ============================
    // 3) 需要实例化：先检查资源是否就绪
    // ============================
    // Instanced rendering is enabled, but we may need to fall back to the procedural wall while assets load.
    const needsBodyLoad = Boolean(bodyAssetId && !getCachedModelObject(bodyAssetId))
    const needsHeadLoad = Boolean(headAssetId && !getCachedModelObject(headAssetId))
    const needsFootLoad = Boolean(footAssetId && !getCachedModelObject(footAssetId))
    const needsBodyCornerLoad = bodyCornerAssetIds.some((id) => !getCachedModelObject(id))
    const needsHeadCornerLoad = headCornerAssetIds.some((id) => !getCachedModelObject(id))
    const needsFootCornerLoad = footCornerAssetIds.some((id) => !getCachedModelObject(id))
    const needsBodyCapLoad = Boolean(bodyEndCapAssetId && !getCachedModelObject(bodyEndCapAssetId))
    const needsHeadCapLoad = Boolean(headEndCapAssetId && !getCachedModelObject(headEndCapAssetId))
    const needsFootCapLoad = Boolean(footEndCapAssetId && !getCachedModelObject(footEndCapAssetId))

    if (needsBodyLoad && bodyAssetId) {
      scheduleWallAssetLoad(bodyAssetId, node.id, signatureKey)
    }
    if (needsHeadLoad && headAssetId) {
      scheduleWallAssetLoad(headAssetId, node.id, signatureKey)
    }
    if (needsFootLoad && footAssetId) {
      scheduleWallAssetLoad(footAssetId, node.id, signatureKey)
    }
    if (needsBodyCornerLoad) {
      bodyCornerAssetIds.forEach((assetId) => {
        if (!getCachedModelObject(assetId)) {
          scheduleWallAssetLoad(assetId, node.id, signatureKey)
        }
      })
    }
    if (needsHeadCornerLoad) {
      headCornerAssetIds.forEach((assetId) => {
        if (!getCachedModelObject(assetId)) {
          scheduleWallAssetLoad(assetId, node.id, signatureKey)
        }
      })
    }
    if (needsFootCornerLoad) {
      footCornerAssetIds.forEach((assetId) => {
        if (!getCachedModelObject(assetId)) {
          scheduleWallAssetLoad(assetId, node.id, signatureKey)
        }
      })
    }
    if (needsBodyCapLoad && bodyEndCapAssetId) {
      scheduleWallAssetLoad(bodyEndCapAssetId, node.id, signatureKey)
    }
    if (needsHeadCapLoad && headEndCapAssetId) {
      scheduleWallAssetLoad(headEndCapAssetId, node.id, signatureKey)
    }
    if (needsFootCapLoad && footEndCapAssetId) {
      scheduleWallAssetLoad(footEndCapAssetId, node.id, signatureKey)
    }

    // 任何一种资源还没进入缓存（getCachedModelObject 为空）就认为“未就绪”。
    // 这里的策略是：
    // - 触发对应资源的异步加载（scheduleWallAssetLoad）
    // - 立即回退到程序墙体，让用户可见并可继续编辑
    // - 等加载完成后由 scheduleWallResync 在同一帧批量刷新等待的 node
    if (needsBodyLoad || needsHeadLoad || needsFootLoad || needsBodyCornerLoad || needsHeadCornerLoad || needsFootCornerLoad || needsBodyCapLoad || needsHeadCapLoad || needsFootCapLoad) {
      releaseModelInstancesForNode(node.id)
      clearWallInstancedBindingsOnObject(container)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallRenderOptions = buildProceduralWallRenderOptions()
      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, wallRenderOptions)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        wallRenderOptions,
      )
      applyAirWallVisualToWallGroup(wallGroup, false)
      return
    }

    // ============================
    // 4) 资源已就绪：进入实例化渲染
    // ============================
    // primaryAssetId 用于标记“本节点当前的实例化主资源”，便于调试/拾取代理/缓存。
    const primaryAssetId = bodyAssetId
      ?? headAssetId
      ?? footAssetId
      ?? (bodyCornerAssetIds[0] ?? null)
      ?? (headCornerAssetIds[0] ?? null)
      ?? (footCornerAssetIds[0] ?? null)
      ?? bodyEndCapAssetId
      ?? headEndCapAssetId
      ?? footEndCapAssetId
    userData.instancedAssetId = primaryAssetId
    userData.dynamicMeshType = 'Wall'

    // Rebuild committed wall instances from scratch so bucket/variant changes never leave stale bindings.
    releaseModelInstancesForNode(node.id)
    const plan = wallProps
      ? buildWallInstancedRenderPlan({
          nodeId: node.id,
          definition,
          wallProps,
          getAssetBounds: getWallAssetBounds,
        })
      : null
    const hasBindings = Boolean(plan?.hasBindings)

    // ============================
    // 5) 没有任何绑定：实例化不适用 → 回退程序墙体
    // ============================
    // 例如：
    // - 只有 cornerModels 但规则未命中/段数不足
    // - 动态网格退化（段长度≈0 导致矩阵为空）
    if (!hasBindings || !plan) {
      // No instanced geometry applicable (e.g. single segment w/ only corner models): keep procedural wall visible.
      releaseModelInstancesForNode(node.id)
      clearWallInstancedBindingsOnObject(container)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallRenderOptions = buildProceduralWallRenderOptions()
      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, wallRenderOptions)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        wallRenderOptions,
      )
      applyAirWallVisualToWallGroup(wallGroup, false)
      return
    }

    // ============================
    // 6) 实例化生效：有 body 资产时移除程序墙体；否则保留程序 body 作为回退显示。
    // ============================
    const applied = applyWallInstancedBindings({
      nodeId: node.id,
      object: container,
      bindings: plan.bindings,
    })
    if (!applied) {
      releaseModelInstancesForNode(node.id)
      clearWallInstancedBindingsOnObject(container)
      delete userData.instancedAssetId
      delete userData.instancedBounds
      options.removeInstancedPickProxy(container)

      const wallRenderOptions = buildProceduralWallRenderOptions()
      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, wallRenderOptions)
      wallGroup.visible = true
      updateWallGroupIfNeeded(wallGroup, effectiveDefinition, signatureKey, wallRenderOptions)
      applyAirWallVisualToWallGroup(wallGroup, false)
      return
    }

    setWallInstancedBindingsOnObject(container, plan)
    userData.instancedAssetId = plan.primaryAssetId
    if (plan.instancedBounds) {
      userData.instancedBounds = plan.instancedBounds
    } else {
      delete userData.instancedBounds
    }

    if (hasProceduralBodyFallback) {
      const wallRenderOptions = buildProceduralWallRenderOptions()
      const wallGroup = ensureWallGroup(container, node, signatureKey, effectiveDefinition, wallRenderOptions)
      wallGroup.visible = true
      updateWallGroupIfNeeded(
        wallGroup,
        effectiveDefinition,
        signatureKey,
        wallRenderOptions,
      )
      applyAirWallVisualToWallGroup(wallGroup, false)
    } else {
      // 注意：这里移除的是“程序生成的 wallGroup”，不是模型资源实例。
      removeWallGroup(container)
    }

    if (hasBindings && !isPreviewNodeId(node.id)) {
      // 有实例化绑定时，确保 pick proxy 存在（用于命中测试/选中）。
      options.ensureInstancedPickProxy(container, node)
    } else {
      options.removeInstancedPickProxy(container)
    }
  }

  return {
    syncWallContainer,
    syncWallPreviewContainer,
    disposeWallPreviewContainer,
    beginWallDrag,
    endWallDrag,
    syncWallDragInstancedMatrices,
    isWallDragActive,
    resolveWallPreviewRenderData,
  }
}
