import { generateUuid } from '@/utils/uuid'
import type {
  SceneNode,
  SceneNodeComponentMap,
  SceneNodeComponentState,
  NodeComponentType,
  WallDynamicMesh,
  FloorDynamicMesh,
  GuideRouteDynamicMesh,
} from '@harmony/schema'

import {
  WALL_COMPONENT_TYPE,
  resolveWallComponentPropsFromMesh,
  cloneWallComponentProps,
  clampWallProps,
  FLOOR_COMPONENT_TYPE,
  resolveFloorComponentPropsFromMesh,
  cloneFloorComponentProps,
  clampFloorComponentProps,
  GUIDE_ROUTE_COMPONENT_TYPE,
  resolveGuideRouteComponentPropsFromMesh,
  cloneGuideRouteComponentProps,
  clampGuideRouteComponentProps,
  DISPLAY_BOARD_COMPONENT_TYPE,
  clampDisplayBoardComponentProps,
  cloneDisplayBoardComponentProps,
  createDisplayBoardComponentState,
  GUIDEBOARD_COMPONENT_TYPE,
  clampGuideboardComponentProps,
  cloneGuideboardComponentProps,
  createGuideboardComponentState,
  VIEW_POINT_COMPONENT_TYPE,
  clampViewPointComponentProps,
  cloneViewPointComponentProps,
  createViewPointComponentState,
  WARP_GATE_COMPONENT_TYPE,
  clampWarpGateComponentProps,
  cloneWarpGateComponentProps,
  createWarpGateComponentState,
  EFFECT_COMPONENT_TYPE,
  clampEffectComponentProps,
  cloneEffectComponentProps,
} from '@schema/components'

const DISPLAY_BOARD_NAME_PATTERN = /^Display\s*Board(?:\b|$)/i

export function cloneComponentProps<T>(props: T): T {
  if (props === null || props === undefined) {
    return props
  }
  if (Array.isArray(props)) {
    return [...props] as unknown as T
  }
  if (typeof props === 'object') {
    return { ...(props as any) } as T
  }
  return props
}

export function cloneComponentState(state: SceneNodeComponentState<any>, typeOverride?: NodeComponentType): SceneNodeComponentState<any> {
  const resolvedType = (typeOverride ?? state.type) as NodeComponentType
  const resolvedId = typeof state.id === 'string' && state.id.trim().length ? state.id : generateUuid()

  const clonedMetadata: Record<string, unknown> | undefined = state.metadata

  return {
    id: resolvedId,
    type: resolvedType,
    enabled: state.enabled ?? true,
    props: cloneComponentProps(state.props),
    metadata: clonedMetadata,
  }
}

export function shouldAutoAttachDisplayBoard(node: SceneNode): boolean {
  const userData = node.userData as Record<string, unknown> | undefined
  if (userData) {
    const directFlag = userData['displayBoard'] === true || userData['isDisplayBoard'] === true
    if (directFlag) {
      return true
    }
  }
  const typeName = typeof node.nodeType === 'string' ? node.nodeType.trim().toLowerCase() : ''
  if (typeName === 'displayboard') {
    return true
  }
  const nodeName = typeof node.name === 'string' ? node.name.trim() : ''
  if (nodeName.length && DISPLAY_BOARD_NAME_PATTERN.test(nodeName)) {
    return true
  }
  return false
}

export function normalizeNodeComponents(
  node: SceneNode,
  components?: SceneNodeComponentMap,
  options: {
    attachDisplayBoard?: boolean
    attachGuideboard?: boolean
    attachViewPoint?: boolean
    attachWarpGate?: boolean
    viewPointOverrides?: Record<string, unknown>
  } = {},
): SceneNodeComponentMap | undefined {
  const normalized: SceneNodeComponentMap = {}

  if (components) {
    Object.entries(components).forEach(([rawType, state]) => {
      if (!state) return
      const type = (state.type ?? rawType) as NodeComponentType
      normalized[type] = cloneComponentState(state, type)
    })
  }

  if (node.dynamicMesh?.type === 'Wall') {
    const baseProps = resolveWallComponentPropsFromMesh(node.dynamicMesh as WallDynamicMesh)
    const existing = normalized[WALL_COMPONENT_TYPE]
    const existingProps = (existing?.props ?? {}) as Partial<any>
    const cornerModels = Array.isArray((existingProps as any).cornerModels)
      ? (existingProps as any).cornerModels
      : (Array.isArray((baseProps as any).cornerModels) ? (baseProps as any).cornerModels : [])

    const nextProps = cloneWallComponentProps(
      clampWallProps({
        height: (existing?.props as { height?: number })?.height ?? baseProps.height,
        width: (existing?.props as { width?: number })?.width ?? baseProps.width,
        thickness: (existing?.props as { thickness?: number })?.thickness ?? baseProps.thickness,
        smoothing: (existingProps as { smoothing?: number }).smoothing ?? baseProps.smoothing,
        jointTrimMode: (existingProps as any).jointTrimMode ?? (baseProps as any).jointTrimMode,
        jointTrimManual: (existingProps as any).jointTrimManual ?? (baseProps as any).jointTrimManual,
        isAirWall: (existingProps as { isAirWall?: boolean }).isAirWall ?? baseProps.isAirWall,
        bodyAssetId: (existingProps as { bodyAssetId?: string | null }).bodyAssetId ?? baseProps.bodyAssetId,
        headAssetId: (existingProps as { headAssetId?: string | null }).headAssetId ?? baseProps.headAssetId,
        bodyEndCapAssetId: (existingProps as { bodyEndCapAssetId?: string | null }).bodyEndCapAssetId ?? baseProps.bodyEndCapAssetId,
        headEndCapAssetId: (existingProps as { headEndCapAssetId?: string | null }).headEndCapAssetId ?? baseProps.headEndCapAssetId,
        bodyOrientation: (existingProps as { bodyOrientation?: unknown }).bodyOrientation ?? (baseProps as any).bodyOrientation,
        headOrientation: (existingProps as { headOrientation?: unknown }).headOrientation ?? (baseProps as any).headOrientation,
        bodyEndCapOrientation: (existingProps as { bodyEndCapOrientation?: unknown }).bodyEndCapOrientation ?? (baseProps as any).bodyEndCapOrientation,
        headEndCapOrientation: (existingProps as { headEndCapOrientation?: unknown }).headEndCapOrientation ?? (baseProps as any).headEndCapOrientation,
        cornerModels,
      }),
    )

    const clonedMetadata: Record<string, unknown> | undefined = existing?.metadata

    normalized[WALL_COMPONENT_TYPE] = {
      id: existing?.id && existing.id.trim().length ? existing.id : generateUuid(),
      type: WALL_COMPONENT_TYPE,
      enabled: existing?.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  }

  if (node.dynamicMesh?.type === 'Floor') {
    const baseProps = resolveFloorComponentPropsFromMesh(node.dynamicMesh as FloorDynamicMesh)
    const existing = normalized[FLOOR_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
    const existingProps = existing?.props as any | undefined
    const nextProps = cloneFloorComponentProps(
      clampFloorComponentProps({
        smooth: existingProps?.smooth ?? baseProps.smooth,
        thickness: existingProps?.thickness ?? baseProps.thickness,
        sideUvScale: existingProps?.sideUvScale ?? baseProps.sideUvScale,
      }),
    )

    const clonedMetadata: Record<string, unknown> | undefined = existing?.metadata

    normalized[FLOOR_COMPONENT_TYPE] = {
      id: existing?.id && existing.id.trim().length ? existing.id : generateUuid(),
      type: FLOOR_COMPONENT_TYPE,
      enabled: existing?.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  }

  if (node.dynamicMesh?.type === 'GuideRoute') {
    const baseProps = resolveGuideRouteComponentPropsFromMesh(node.dynamicMesh as GuideRouteDynamicMesh)
    const existing = normalized[GUIDE_ROUTE_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
    const existingProps = existing?.props as any | undefined
    const nextProps = cloneGuideRouteComponentProps(
      clampGuideRouteComponentProps({
        waypoints: existingProps?.waypoints ?? baseProps.waypoints,
      }),
    )

    const clonedMetadata: Record<string, unknown> | undefined = existing?.metadata

    normalized[GUIDE_ROUTE_COMPONENT_TYPE] = {
      id: existing?.id && existing.id.trim().length ? existing.id : generateUuid(),
      type: GUIDE_ROUTE_COMPONENT_TYPE,
      enabled: existing?.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  }

  const existingDisplayBoard = normalized[DISPLAY_BOARD_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
  const shouldAttachDisplayBoard = options.attachDisplayBoard ?? shouldAutoAttachDisplayBoard(node)
  if (existingDisplayBoard) {
    const nextProps = cloneDisplayBoardComponentProps(clampDisplayBoardComponentProps(existingDisplayBoard.props as any))
    const clonedMetadata: Record<string, unknown> | undefined = existingDisplayBoard.metadata
    normalized[DISPLAY_BOARD_COMPONENT_TYPE] = {
      id: existingDisplayBoard.id && existingDisplayBoard.id.trim().length ? existingDisplayBoard.id : generateUuid(),
      type: DISPLAY_BOARD_COMPONENT_TYPE,
      enabled: existingDisplayBoard.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if (shouldAttachDisplayBoard) {
    normalized[DISPLAY_BOARD_COMPONENT_TYPE] = {
      ...createDisplayBoardComponentState(node, undefined, { id: generateUuid(), enabled: true }),
    }
  }

  const existingGuideboard = normalized[GUIDEBOARD_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
  if (existingGuideboard) {
    const nextProps = cloneGuideboardComponentProps(clampGuideboardComponentProps(existingGuideboard.props as any))
    const clonedMetadata: Record<string, unknown> | undefined = existingGuideboard.metadata
    normalized[GUIDEBOARD_COMPONENT_TYPE] = {
      id: existingGuideboard.id && existingGuideboard.id.trim().length ? existingGuideboard.id : generateUuid(),
      type: GUIDEBOARD_COMPONENT_TYPE,
      enabled: existingGuideboard.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if ((options as any).attachGuideboard) {
    normalized[GUIDEBOARD_COMPONENT_TYPE] = {
      ...createGuideboardComponentState(node, undefined, { id: generateUuid(), enabled: true }),
    }
  }

  const existingViewPoint = normalized[VIEW_POINT_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
  if (existingViewPoint) {
    const nextProps = cloneViewPointComponentProps(clampViewPointComponentProps(existingViewPoint.props as any))
    const clonedMetadata: Record<string, unknown> | undefined = existingViewPoint.metadata
    normalized[VIEW_POINT_COMPONENT_TYPE] = {
      id: existingViewPoint.id && existingViewPoint.id.trim().length ? existingViewPoint.id : generateUuid(),
      type: VIEW_POINT_COMPONENT_TYPE,
      enabled: existingViewPoint.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if ((options as any).attachViewPoint) {
    normalized[VIEW_POINT_COMPONENT_TYPE] = {
      ...createViewPointComponentState(node, (options as any).viewPointOverrides as any, { id: generateUuid(), enabled: true }),
    }
  }

  const existingWarpGate = normalized[WARP_GATE_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
  if (existingWarpGate) {
    const nextProps = cloneWarpGateComponentProps(clampWarpGateComponentProps(existingWarpGate.props as any))
    const clonedMetadata: Record<string, unknown> | undefined = existingWarpGate.metadata
    normalized[WARP_GATE_COMPONENT_TYPE] = {
      id: existingWarpGate.id && existingWarpGate.id.trim().length ? existingWarpGate.id : generateUuid(),
      type: WARP_GATE_COMPONENT_TYPE,
      enabled: existingWarpGate.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  } else if ((options as any).attachWarpGate) {
    normalized[WARP_GATE_COMPONENT_TYPE] = {
      ...createWarpGateComponentState(node, undefined, { id: generateUuid(), enabled: true }),
    }
  }

  const existingEffect = normalized[EFFECT_COMPONENT_TYPE] as SceneNodeComponentState<any> | undefined
  if (existingEffect) {
    const nextProps = cloneEffectComponentProps(clampEffectComponentProps(existingEffect.props as any))
    const clonedMetadata: Record<string, unknown> | undefined = existingEffect.metadata
    normalized[EFFECT_COMPONENT_TYPE] = {
      id: existingEffect.id && existingEffect.id.trim().length ? existingEffect.id : generateUuid(),
      type: EFFECT_COMPONENT_TYPE,
      enabled: existingEffect.enabled ?? true,
      props: nextProps,
      metadata: clonedMetadata,
    }
  }

  return Object.keys(normalized).length ? normalized : undefined
}

export default {
  cloneComponentProps,
  cloneComponentState,
  shouldAutoAttachDisplayBoard,
  normalizeNodeComponents,
}
