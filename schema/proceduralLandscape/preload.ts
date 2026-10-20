import {
  clampProceduralLandscapeProps,
  roadHalfWidth,
  type ProceduralLandscapeComponentProps,
} from './config'
import { isSingleTrackRoad } from './roadStyle'
import type {
  SceneNode,
  SceneNodeComponentState,
  SceneSlowroadsTexturePreload,
} from '../core'
import {
  collectLandscapeSharedTextureRefs,
  collectSeasonTextureRefs,
  type SeasonId,
  type SeasonTextureRef,
} from '../slowroads/core/seasonCatalog'

export interface ProceduralLandscapeTexturePreloadOptions {
  /** Whether a committed road route exists and will render a road band. */
  roadReady?: boolean
  /** Water textures are only useful when the water layer is enabled. */
  waterVisible?: boolean
}

export interface ProceduralLandscapeCoreTextureOptions {
  /** Terrain shader textures are visible. */
  surface?: boolean
  /** Any foliage layer will sample the shared detail and variation maps. */
  foliage?: boolean
}

/**
 * Textures required before the first useful landscape frame can render.
 *
 * This deliberately excludes road, wall, water and foliage atlases. Those are
 * visible later and can stream in without holding the whole scene behind one
 * all-or-nothing texture set.
 */
export function collectProceduralLandscapeCoreTextureRefs(
  season: SeasonId,
  options: ProceduralLandscapeCoreTextureOptions = {},
): SeasonTextureRef[] {
  const surface = options.surface === true
  const foliage = options.foliage === true
  const refs = [
    ...collectSeasonTextureRefs(season, {
      surface,
      forest: !surface && foliage,
      grass: false,
      bushes: false,
      roadSingle: false,
      roadWide: false,
      walls: false,
    }),
    ...collectLandscapeSharedTextureRefs({
      surface,
      forest: !surface && foliage,
      grass: false,
      bushes: false,
      water: false,
    }),
  ]
  const unique = new Map<string, SeasonTextureRef>()
  for (const ref of refs) {
    unique.set(ref.id, ref)
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function hasEnabledWallLayer(props: ProceduralLandscapeComponentProps): boolean {
  return Boolean(
    props.walls.drystone.enabled
    || props.walls.fence.enabled
    || props.walls.barrier.enabled
    || props.walls.seaWall.enabled,
  )
}

/**
 * Collect every Slow Roads texture that a procedural landscape may bind for
 * the configured season. The result intentionally errs on the side of loading
 * wall textures whenever any wall layer is enabled because wall placement is
 * terrain-dependent and only known after the runtime world is built.
 */
export function collectProceduralLandscapeTexturePreloadRefs(
  props: ProceduralLandscapeComponentProps,
  season: SeasonId,
  options: ProceduralLandscapeTexturePreloadOptions = {},
): SeasonTextureRef[] {
  const roadReady = options.roadReady ?? Boolean(props.road.generatedRoute)
  const waterVisible = options.waterVisible ?? props.water.enabled
  const singleTrack = isSingleTrackRoad(roadHalfWidth(props) * 2)
  const needs = {
    surface: props.surface.enabled && props.surface.textures,
    forest: props.forest.coverage > 0 && props.forest.density > 0,
    grass: props.grass.enabled,
    bushes: props.bushes.enabled,
    roadSingle: props.road.enabled && roadReady && singleTrack,
    roadWide: props.road.enabled && roadReady && !singleTrack,
    walls: hasEnabledWallLayer(props),
  }

  const refs = [
    ...collectSeasonTextureRefs(season, needs),
    ...collectLandscapeSharedTextureRefs({
      surface: needs.surface,
      forest: needs.forest,
      grass: needs.grass,
      bushes: needs.bushes,
      water: waterVisible,
    }),
  ]

  const unique = new Map<string, SeasonTextureRef>()
  for (const ref of refs) {
    unique.set(ref.id, ref)
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export function collectProceduralLandscapeTexturePreloadIds(
  props: ProceduralLandscapeComponentProps,
  season: SeasonId,
  options: ProceduralLandscapeTexturePreloadOptions = {},
): string[] {
  return collectProceduralLandscapeTexturePreloadRefs(props, season, options)
    .map((ref) => ref.id)
}

function collectActiveProceduralLandscapeNodes(
  nodes: SceneNode[] | null | undefined,
): Array<{
  node: SceneNode
  props: ProceduralLandscapeComponentProps
}> {
  const result: Array<{
    node: SceneNode
    props: ProceduralLandscapeComponentProps
  }> = []
  const stack: SceneNode[] = Array.isArray(nodes) ? [...nodes] : []
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.visible === false || node.editorFlags?.editorOnly) {
      continue
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
    const component = node.components?.proceduralLandscape as
      | SceneNodeComponentState<ProceduralLandscapeComponentProps>
      | undefined
    if (component && component.enabled !== false) {
      result.push({
        node,
        props: clampProceduralLandscapeProps(component.props, node.id),
      })
    }
  }
  return result
}

export function collectActiveProceduralLandscapeNodeIds(
  nodes: SceneNode[] | null | undefined,
): string[] {
  return [...new Set(
    collectActiveProceduralLandscapeNodes(nodes)
      .map(({ node }) => node.id)
      .filter(Boolean),
  )]
}

export function collectProceduralLandscapeTexturePreloadForNodes(
  nodes: SceneNode[] | null | undefined,
  season: SeasonId,
): SceneSlowroadsTexturePreload | undefined {
  const textureIds = new Set<string>()
  for (const { props } of collectActiveProceduralLandscapeNodes(nodes)) {
    collectProceduralLandscapeTexturePreloadIds(props, season)
      .forEach((id) => textureIds.add(id))
  }
  if (!textureIds.size) {
    return undefined
  }
  return {
    season,
    textureIds: [...textureIds].sort(),
  }
}

export function collectProceduralLandscapeCoreTexturePreloadForNodes(
  nodes: SceneNode[] | null | undefined,
  season: SeasonId,
): SceneSlowroadsTexturePreload | undefined {
  const textureIds = new Set<string>()
  for (const { props } of collectActiveProceduralLandscapeNodes(nodes)) {
    const foliage = (props.forest.coverage > 0 && props.forest.density > 0)
      || props.grass.enabled
      || props.bushes.enabled
    collectProceduralLandscapeCoreTextureRefs(season, {
      surface: props.surface.enabled && props.surface.textures,
      foliage,
    }).forEach((ref) => textureIds.add(ref.id))
  }
  if (!textureIds.size) {
    return undefined
  }
  return {
    season,
    textureIds: [...textureIds].sort(),
  }
}
