import * as THREE from 'three'
import type { WallDynamicMesh } from '@schema'
import { createWallRenderGroup, updateWallGroup } from '@schema/wallMesh'
import type { WallComponentProps } from '@schema/components'
import { stableSerialize } from '@schema/stableSerialize'
import { buildWallDynamicMeshFromWorldSegments } from '@/stores/wallUtils'
import type { WallPreviewRenderData } from './WallRenderer'
import { applyAirWallVisualToWallGroup } from './WallRenderer'
import type { WallPresetData } from '@/utils/wallPreset'

export type WallPreviewSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

export type WallPreviewSession = {
  dragStart: THREE.Vector3 | null
  dragEnd: THREE.Vector3 | null
  segments: WallPreviewSegment[]
  previewGroup: THREE.Group | null
  nodeId: string | null
  dimensions: { height: number; width: number; thickness: number }
  wallRenderProps: Partial<WallComponentProps> | WallComponentProps | null
}

export type WallPreviewRenderer = {
  markDirty: () => void
  flushIfNeeded: (scene: THREE.Scene | null, session: WallPreviewSession | null) => void
  flush: (scene: THREE.Scene | null, session: WallPreviewSession | null) => void
  clear: (session: WallPreviewSession | null) => void
  reset: () => void
  dispose: (session: WallPreviewSession | null) => void
}

const WALL_PREVIEW_SIGNATURE_PRECISION = 1000
const WALL_SKIP_GEOMETRY_DISPOSE_USERDATA_KEY = '__harmonySkipGeometryDispose'
const WALL_SKIP_MATERIAL_DISPOSE_USERDATA_KEY = '__harmonySkipMaterialDispose'
const WALL_OWNED_TEXTURES_USERDATA_KEY = '__harmonyOwnedTextures'

function encodeWallPreviewNumber(value: number): string {
  return `${Math.round(value * WALL_PREVIEW_SIGNATURE_PRECISION)}`
}

function computeWallPreviewSignature(
  segments: WallPreviewSegment[],
  dimensions: { height: number; width: number; thickness: number },
): string {
  if (!segments.length) {
    return 'empty'
  }

  const dimensionSignature = [
    encodeWallPreviewNumber(dimensions.height),
    encodeWallPreviewNumber(dimensions.width),
    encodeWallPreviewNumber(dimensions.thickness),
  ].join('|')

  const segmentSignature = segments
    .map(({ start, end }) =>
      [
        encodeWallPreviewNumber(start.x),
        encodeWallPreviewNumber(start.y),
        encodeWallPreviewNumber(start.z),
        encodeWallPreviewNumber(end.x),
        encodeWallPreviewNumber(end.y),
        encodeWallPreviewNumber(end.z),
      ].join(','),
    )
    .join(';')

  return `${dimensionSignature}|${segmentSignature}`
}

function disposeWallPreviewGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      const userData = (mesh.userData ?? {}) as Record<string, unknown>
      const geometry = mesh.geometry
      if (geometry && !userData[WALL_SKIP_GEOMETRY_DISPOSE_USERDATA_KEY]) {
        geometry.dispose()
      }
      const ownedTextures = userData[WALL_OWNED_TEXTURES_USERDATA_KEY]
      if (Array.isArray(ownedTextures)) {
        ownedTextures.forEach((entry) => {
          if ((entry as THREE.Texture | null | undefined)?.isTexture) {
            ;(entry as THREE.Texture).dispose()
          }
        })
      }
      if (userData[WALL_SKIP_MATERIAL_DISPOSE_USERDATA_KEY]) {
        return
      }
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else if (material) {
        material.dispose()
      }
    }
  })
}

function applyWallPreviewStyling(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material as THREE.Material & { opacity?: number; transparent?: boolean }
    if ('opacity' in material) {
      material.opacity = 0.9
      material.transparent = true
    }
    mesh.layers.enableAll()
    mesh.renderOrder = 999
  })
}

function normalizeWallBaseOffsetLocal(wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined): { x: number; y: number; z: number } {
  const raw = (wallProps as any)?.wallBaseOffsetLocal
  const x = Number(raw?.x)
  const y = Number(raw?.y)
  const z = Number(raw?.z)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    z: Number.isFinite(z) ? z : 0,
  }
}

function applyWallBaseOffsetToPreviewDefinition(
  definition: WallDynamicMesh,
  wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined,
): WallDynamicMesh {
  const offset = normalizeWallBaseOffsetLocal(wallProps)
  if (Math.abs(offset.x) <= 1e-6 && Math.abs(offset.y) <= 1e-6 && Math.abs(offset.z) <= 1e-6) {
    return definition
  }
  return {
    ...definition,
    chains: (definition.chains ?? []).map((chain) => ({
      ...chain,
      points: (chain.points ?? []).map((point) => ({
        x: Number(point?.x ?? 0) - offset.x,
        y: Number(point?.y ?? 0) - offset.y,
        z: Number(point?.z ?? 0) - offset.z,
      })),
    })),
  }
}

export function createWallPreviewRenderer(options: {
  rootGroup: THREE.Group
  getPreviewPresetData?: () => WallPresetData | null
  applyPreviewMaterials?: (group: THREE.Group, presetData: WallPresetData | null) => void
  normalizeWallDimensionsForViewport: (values: {
    height?: number
    width?: number
    thickness?: number
  }) => { height: number; width: number; thickness: number }
  resolveWallPreviewRenderData?: (params: {
    definition: WallDynamicMesh
    wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined
    nodeId?: string | null
    previewKey: string
  }) => WallPreviewRenderData
  syncExactWallPreview?: (params: {
    container: THREE.Object3D
    definition: WallDynamicMesh
    wallProps: Partial<WallComponentProps> | WallComponentProps | null | undefined
    previewKey: string
  }) => void
  disposeExactWallPreview?: (container: THREE.Object3D | null | undefined) => void
}): WallPreviewRenderer {
  let needsSync = false
  let signature: string | null = null

  const clear = (session: WallPreviewSession | null) => {
    if (session?.previewGroup) {
      const preview = session.previewGroup
      preview.removeFromParent()
      if (options.disposeExactWallPreview) {
        options.disposeExactWallPreview(preview)
      } else {
        disposeWallPreviewGroup(preview)
      }
      session.previewGroup = null
    }
    signature = null
  }

  const flush = (scene: THREE.Scene | null, session: WallPreviewSession | null) => {
    needsSync = false

    if (!scene || !session) {
      if (signature !== null) {
        clear(session)
        signature = null
      }
      return
    }

    const presetData = options.getPreviewPresetData?.() ?? null

    const hasCommittedNode = !!session.nodeId
    const hasActiveDrag = !!session.dragStart && !!session.dragEnd

    if (hasCommittedNode && !hasActiveDrag) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    // 编辑已有节点时，仅预览当前拖拽的新线段，不重复已提交的线段。
    // 已提交线段由 syncWallContainer 负责渲染（程序化或预置配置的实例化模型），
    // 若将 session.segments 也纳入预览，会与预置配置渲染出的模型网格产生重叠。
    const segments: WallPreviewSegment[] = hasCommittedNode ? [] : [...session.segments]
    if (session.dragStart && session.dragEnd) {
      segments.push({ start: session.dragStart.clone(), end: session.dragEnd.clone() })
    }

    if (!segments.length) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const normalizedDimensions = options.normalizeWallDimensionsForViewport(session.dimensions)
    const build = buildWallDynamicMeshFromWorldSegments(segments, normalizedDimensions)
    if (!build) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }
    const previewDefinition = hasCommittedNode
      ? build.definition
      : applyWallBaseOffsetToPreviewDefinition(build.definition, session.wallRenderProps)

    const previewKey = session.nodeId ?? 'wall-build-draft'
    const resolvedRender = options.syncExactWallPreview
      ? null
      : (options.resolveWallPreviewRenderData
        ? options.resolveWallPreviewRenderData({
          definition: previewDefinition,
          wallProps: session.wallRenderProps,
          nodeId: session.nodeId,
          previewKey,
        })
        : null)

    const renderSignature = options.syncExactWallPreview
      ? stableSerialize({ wallProps: session.wallRenderProps ?? null, previewKey, exact: true })
      : (resolvedRender
        ? resolvedRender.signatureData
        : stableSerialize({ wallProps: session.wallRenderProps ?? null }))

    const nextSignature = `${computeWallPreviewSignature(segments, session.dimensions)}|${renderSignature}`
    if (nextSignature === signature) {
      if (resolvedRender?.hasMissingAssets) {
        needsSync = true
      }
      return
    }
    signature = nextSignature

    if (options.syncExactWallPreview) {
      if (!session.previewGroup) {
        const preview = new THREE.Group()
        preview.name = 'WallPreview'
        preview.userData.isWallPreview = true
        session.previewGroup = preview
        options.rootGroup.add(preview)
      }
      session.previewGroup.position.copy(build.center)
      session.previewGroup.rotation.set(0, 0, 0)
      session.previewGroup.scale.set(1, 1, 1)
      options.syncExactWallPreview({
        container: session.previewGroup,
        definition: previewDefinition,
        wallProps: session.wallRenderProps,
        previewKey,
      })
      if (!options.rootGroup.children.includes(session.previewGroup)) {
        options.rootGroup.add(session.previewGroup)
      }
      options.applyPreviewMaterials?.(session.previewGroup, presetData)
    } else {
      if (!session.previewGroup) {
        const preview = createWallRenderGroup(previewDefinition, resolvedRender?.assets ?? {}, resolvedRender?.renderOptions ?? {})
        applyWallPreviewStyling(preview)
        applyAirWallVisualToWallGroup(preview, Boolean(resolvedRender?.isAirWall))
        preview.userData.isWallPreview = true
        session.previewGroup = preview
        options.rootGroup.add(preview)
      } else {
        if (resolvedRender) {
          session.previewGroup.userData.wallRenderAssets = resolvedRender.assets
        }
        updateWallGroup(session.previewGroup, previewDefinition, resolvedRender?.renderOptions ?? {})
        applyWallPreviewStyling(session.previewGroup)
        applyAirWallVisualToWallGroup(session.previewGroup, Boolean(resolvedRender?.isAirWall))
        if (!options.rootGroup.children.includes(session.previewGroup)) {
          options.rootGroup.add(session.previewGroup)
        }
      }
      session.previewGroup!.position.copy(build.center)
      options.applyPreviewMaterials?.(session.previewGroup!, presetData)
    }

    if (resolvedRender?.hasMissingAssets) {
      needsSync = true
    }
  }

  return {
    markDirty: () => {
      needsSync = true
    },
    flushIfNeeded: (scene: THREE.Scene | null, session: WallPreviewSession | null) => {
      if (!needsSync) {
        return
      }
      flush(scene, session)
    },
    flush,
    clear,
    reset: () => {
      needsSync = false
      signature = null
    },
    dispose: (session: WallPreviewSession | null) => {
      clear(session)
      needsSync = false
      signature = null
    },
  }
}
