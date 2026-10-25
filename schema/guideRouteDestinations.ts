import type { SceneNode } from './core'
import {
  GUIDE_ROUTE_COMPONENT_TYPE,
  clampGuideRouteComponentProps,
  type GuideRouteComponentProps,
  type GuideRouteLeg,
  type GuideRouteStop,
  type GuideRouteTravelMode,
} from './components/definitions/guideRouteComponent'

export type GuideRouteDestination = {
  routeNodeId: string
  routeName: string
  stopId: string
  stopName: string
  thumbnailAssetId: string
  travelMode: GuideRouteTravelMode
  legId: string
}

function resolveLeg(
  props: GuideRouteComponentProps,
  legId: string,
): GuideRouteLeg | null {
  return props.legs.find((leg) => leg.id === legId) ?? null
}

export function resolveGuideRouteStopTravelMode(
  props: Partial<GuideRouteComponentProps> | null | undefined,
  stop: Partial<GuideRouteStop> | null | undefined,
): GuideRouteTravelMode | null {
  const normalized = clampGuideRouteComponentProps(props)
  const normalizedStop = stop?.id
    ? normalized.stops.find((entry) => entry.id === stop.id) ?? null
    : null
  if (!normalizedStop) {
    return null
  }
  return resolveLeg(normalized, normalizedStop.legId)?.travelMode ?? null
}

/**
 * Builds the scene-wide destination catalog used by Preview and SceneryViewer.
 * Scene order and per-route stop order are preserved for deterministic UI.
 */
export function collectGuideRouteDestinations(
  nodes: Iterable<SceneNode>,
): GuideRouteDestination[] {
  const destinations: GuideRouteDestination[] = []
  for (const node of nodes) {
    if (node?.dynamicMesh?.type !== 'GuideRoute') {
      continue
    }
    const component = node.components?.[GUIDE_ROUTE_COMPONENT_TYPE]
    if (!component || component.enabled === false) {
      continue
    }
    const props = clampGuideRouteComponentProps(
      component.props as Partial<GuideRouteComponentProps> | null | undefined,
    )
    for (const stop of props.stops) {
      const thumbnailAssetId = stop.thumbnailAssetId?.trim() ?? ''
      const leg = resolveLeg(props, stop.legId)
      if (!thumbnailAssetId || !leg) {
        continue
      }
      destinations.push({
        routeNodeId: node.id,
        routeName: node.name?.trim() || node.id,
        stopId: stop.id,
        stopName: stop.name.trim() || stop.id,
        thumbnailAssetId,
        travelMode: leg.travelMode,
        legId: leg.id,
      })
    }
  }
  return destinations
}
