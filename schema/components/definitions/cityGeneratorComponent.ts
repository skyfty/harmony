/**
 * A self-contained procedural city: the three r180 block generator ( skyscraper
 * geometry, road with lane markings and crosswalks, raised sidewalks, cobra-head
 * streetlights and a parked car fleet ), built on the CPU and dressed in the
 * engine's WebGL city materials.
 *
 * Unlike `proceduralCity`, which fills an attached Floor / Region / Road /
 * Landform footprint, this component ignores the host's shape and builds a
 * rectangular block grid centred on the node it is attached to — the same way the
 * upstream `CityGenerator` lays a city out.
 */

import * as THREE from 'three'
import type { Object3D } from 'three'

import { Component, type ComponentRuntimeContext } from '../Component'
import {
	COMPONENT_ARTIFACT_COMPONENT_ID_KEY,
	COMPONENT_ARTIFACT_KEY,
	COMPONENT_ARTIFACT_NODE_ID_KEY,
	componentManager,
	type ComponentDefinition
} from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import {
	PROCEDURAL_CITY_HOST_USER_DATA_KEY,
	isPointInsidePolygon,
	resolveLongestEdgeAngle,
	resolvePolygonSurfaceHeight,
	resolveProceduralCityFootprint,
	rotate2,
	type ProceduralCityFootprint,
	type ProceduralCityHostSnapshot,
} from './proceduralCityComponent'
import {
	buildProceduralCityBlockGroup,
	disposeProceduralCityBlockGroup,
	resolveProceduralCityReserveRect,
	resolveProceduralCityBlockLayout,
	type ProceduralCityBlockGroupUserData,
	type ProceduralCityBlockLayout,
	type ProceduralCityBuildingPreset,
	type ProceduralCityReservePlacement,
	type ProceduralCityTowerBox
} from './proceduralCityBlock'
import { pickBuildingColor } from './proceduralCitySkyscraper'
import { getWallMaterial } from './proceduralCityMaterials'
import { applySkyscraperPartColors } from './proceduralCityPartColors'

export const CITY_GENERATOR_COMPONENT_TYPE = 'cityGenerator'

const CITY_GENERATOR_RUNTIME_GROUP_KEY = '__harmonyCityGeneratorRuntimeGroup'

/**
 * The building geometry the grid is drawn with. `skyscraper` is the detailed r180
 * facade generator ( one merged mesh per tower ); every other value is the cheap
 * instanced preset that shares twelve archetypes across the whole city, which is
 * what keeps a city affordable on a mini program.
 */
export const CITY_GENERATOR_BUILDING_PRESETS: ProceduralCityBuildingPreset[] = [
	'skyscraper',
	'solid',
	'office',
	'bright',
	'classic',
	'warm',
	'cool'
]

/** Alias so panels can name the preset type without reaching past the components barrel. */
export type CityGeneratorBuildingPreset = ProceduralCityBuildingPreset

export interface CityGeneratorComponentProps {
	seed: number
	/** Building geometry preset — see {@link CITY_GENERATOR_BUILDING_PRESETS}. */
	buildingPreset: ProceduralCityBuildingPreset
	/** Lot ( block cell ) size in metres; a block is `lot × lots`. */
	lot: number
	lotsX: number
	lotsZ: number
	blocksX: number
	blocksZ: number
	/** Street width between blocks. */
	streetWidth: number
	/** Walking strip between the street wall and the curb. */
	sidewalkWidth: number
	curbHeight: number
	curbRadius: number
	minTowerHeight: number
	maxTowerHeight: number
	includeRoad: boolean
	includeSidewalks: boolean
	includeStreetlights: boolean
	includeCars: boolean
	/**
	 * How much of the kerbside to keep, as a percentage of the full layout. The
	 * streetlights and the cars thin independently, so one can stay dense while the
	 * other is cleared out. 100 keeps every placement — the layout the city had before
	 * this existed, and so the default — while 0 keeps none at all, which is the same
	 * as switching that generator off.
	 *
	 * The kept placements are an evenly spaced subset of the full layout: dropping the
	 * count never moves a streetlight or a car that is still there, and never brings
	 * two of them closer together. See {@link thinProceduralCityPlacements}.
	 */
	streetlightDensity: number
	carDensity: number
	/**
	 * Keep one block of the grid free of buildings — a reserve for hand-placed scene
	 * nodes, typically a theme building. The procedural city keeps ringing it, paving
	 * and street furniture included.
	 */
	reserveEnabled: boolean
	/** Reserved area width in metres along the grid's own X axis; 0 takes the block's own width. */
	reserveWidth: number
	/** Reserved area depth in metres along the grid's own Z axis; 0 takes the block's own depth. */
	reserveDepth: number
	/** How many blocks the reserved block moves off the centre block, along the grid's X axis. */
	reserveBlockX: number
	/** How many blocks the reserved block moves off the centre block, along the grid's Z axis. */
	reserveBlockZ: number
}

// the upstream `CityGenerator.defaults` grid, which is also the city-lab default
export const CITY_GENERATOR_DEFAULT_PROPS: CityGeneratorComponentProps = {
	seed: 1,
	// the instanced solid preset is the default so a city is affordable out of the
	// box — on a mini program especially; the detailed r180 facade generator is one
	// dropdown entry away
	buildingPreset: 'solid',
	lot: 30,
	lotsX: 3,
	lotsZ: 2,
	blocksX: 0,
	blocksZ: 0,
	streetWidth: 22,
	sidewalkWidth: 5,
	curbHeight: 0.15,
	curbRadius: 5,
	minTowerHeight: 38,
	maxTowerHeight: 152,
	includeRoad: true,
	includeSidewalks: true,
	includeStreetlights: true,
	includeCars: true,
	// full kerbside by default, so a scene built before the density existed renders
	// exactly as it did — the installed base of saved cities is the reason both of
	// these start at 100 rather than at some quieter default
	streetlightDensity: 100,
	carDensity: 100,
	// off by default, so a scene built before the reserve existed renders unchanged
	reserveEnabled: false,
	// 0 means "the reserved block's own size" — one city block, which is the natural
	// footprint for a theme building standing where a procedural block would have been
	reserveWidth: 0,
	reserveDepth: 0,
	reserveBlockX: 0,
	reserveBlockZ: 0
}

/**
 * Cost guards for a region-fitted grid.
 *
 * `CITY_GENERATOR_TOWER_VERTEX_ESTIMATE` is measured from the default grid: one
 * r180 tower bakes ~50.7k vertices. The budget only warns — a grid over it is
 * still built, it just may take seconds and a lot of video memory, so switching
 * to an instanced preset (or a larger lot) is the way out. The instanced presets
 * cost almost nothing per building, so they only carry a sanity cap on how many
 * instances a pathological region may ask for.
 */
export const CITY_GENERATOR_TOWER_VERTEX_ESTIMATE = 51000
export const CITY_GENERATOR_LOWPOLY_VERTEX_ESTIMATE = 1200
export const CITY_GENERATOR_VERTEX_BUDGET = 6_000_000
export const CITY_GENERATOR_MAX_INSTANCES = 4000

/** The grid a no-outline host falls back to when the block counts are left on auto. */
const CITY_GENERATOR_FREE_GRID_BLOCKS = 2

function finiteNumber(value: unknown, fallback: number): number {
	const numeric = Number(value)
	return Number.isFinite(numeric) ? numeric : fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, finiteNumber(value, fallback)))
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	return Math.round(clampNumber(value, fallback, min, max))
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback
}

function clampBuildingPreset(value: unknown): ProceduralCityBuildingPreset {
	return CITY_GENERATOR_BUILDING_PRESETS.includes( value as ProceduralCityBuildingPreset )
		? value as ProceduralCityBuildingPreset
		: CITY_GENERATOR_DEFAULT_PROPS.buildingPreset
}

/**
 * Clamps the props to ranges a single component can actually carry: one tower is
 * ~50k vertices, so the lot and block counts are the two that have to stay
 * bounded ( the defaults build 24 towers / ~1.2M vertices ).
 */
export function clampCityGeneratorComponentProps(props?: Partial<CityGeneratorComponentProps> | null): CityGeneratorComponentProps {
	const source = props ?? {}
	const minTowerHeight = clampNumber(source.minTowerHeight, CITY_GENERATOR_DEFAULT_PROPS.minTowerHeight, 1, 400)
	const maxTowerHeight = Math.max(
		minTowerHeight,
		clampNumber(source.maxTowerHeight, CITY_GENERATOR_DEFAULT_PROPS.maxTowerHeight, 1, 400),
	)

	return {
		seed: clampInteger(source.seed, CITY_GENERATOR_DEFAULT_PROPS.seed, 0, 999999),
		buildingPreset: clampBuildingPreset(source.buildingPreset),
		lot: clampNumber(source.lot, CITY_GENERATOR_DEFAULT_PROPS.lot, 8, 90),
		lotsX: clampInteger(source.lotsX, CITY_GENERATOR_DEFAULT_PROPS.lotsX, 1, 4),
		lotsZ: clampInteger(source.lotsZ, CITY_GENERATOR_DEFAULT_PROPS.lotsZ, 1, 4),
		// 0 means "auto": the grid is sized to the region. A positive value caps it.
		blocksX: clampInteger(source.blocksX, CITY_GENERATOR_DEFAULT_PROPS.blocksX, 0, 24),
		blocksZ: clampInteger(source.blocksZ, CITY_GENERATOR_DEFAULT_PROPS.blocksZ, 0, 24),
		streetWidth: clampNumber(source.streetWidth, CITY_GENERATOR_DEFAULT_PROPS.streetWidth, 6, 60),
		sidewalkWidth: clampNumber(source.sidewalkWidth, CITY_GENERATOR_DEFAULT_PROPS.sidewalkWidth, 1, 15),
		curbHeight: clampNumber(source.curbHeight, CITY_GENERATOR_DEFAULT_PROPS.curbHeight, 0, 1.5),
		curbRadius: clampNumber(source.curbRadius, CITY_GENERATOR_DEFAULT_PROPS.curbRadius, 0, 30),
		minTowerHeight,
		maxTowerHeight,
		includeRoad: clampBoolean(source.includeRoad, CITY_GENERATOR_DEFAULT_PROPS.includeRoad),
		includeSidewalks: clampBoolean(source.includeSidewalks, CITY_GENERATOR_DEFAULT_PROPS.includeSidewalks),
		includeStreetlights: clampBoolean(source.includeStreetlights, CITY_GENERATOR_DEFAULT_PROPS.includeStreetlights),
		includeCars: clampBoolean(source.includeCars, CITY_GENERATOR_DEFAULT_PROPS.includeCars),
		streetlightDensity: clampInteger(source.streetlightDensity, CITY_GENERATOR_DEFAULT_PROPS.streetlightDensity, 0, 100),
		carDensity: clampInteger(source.carDensity, CITY_GENERATOR_DEFAULT_PROPS.carDensity, 0, 100),
		reserveEnabled: clampBoolean(source.reserveEnabled, CITY_GENERATOR_DEFAULT_PROPS.reserveEnabled),
		reserveWidth: clampNumber(source.reserveWidth, CITY_GENERATOR_DEFAULT_PROPS.reserveWidth, 0, 2000),
		reserveDepth: clampNumber(source.reserveDepth, CITY_GENERATOR_DEFAULT_PROPS.reserveDepth, 0, 2000),
		reserveBlockX: clampInteger(source.reserveBlockX, CITY_GENERATOR_DEFAULT_PROPS.reserveBlockX, -5, 5),
		reserveBlockZ: clampInteger(source.reserveBlockZ, CITY_GENERATOR_DEFAULT_PROPS.reserveBlockZ, -5, 5)
	}
}

export function cloneCityGeneratorComponentProps(props?: Partial<CityGeneratorComponentProps> | null): CityGeneratorComponentProps {
	return { ...clampCityGeneratorComponentProps(props) }
}

/**
 * How many towers a grid of the given props holds when there is no host outline
 * to fit ( the block counts then fall back to {@link CITY_GENERATOR_FREE_GRID_BLOCKS}
 * when left on auto ). Region-attached grids are sized from the outline instead —
 * see {@link resolveCityGeneratorGridPlan}. The reserve is not subtracted here; the
 * plan reports the towers a reserve actually dropped.
 */
export function countCityGeneratorTowers(props: CityGeneratorComponentProps): number {

	const blocksX = props.blocksX > 0 ? props.blocksX : CITY_GENERATOR_FREE_GRID_BLOCKS
	const blocksZ = props.blocksZ > 0 ? props.blocksZ : CITY_GENERATOR_FREE_GRID_BLOCKS
	return blocksX * blocksZ * props.lotsX * props.lotsZ

}

function tagCityGeneratorArtifact(object: Object3D, nodeId: string, componentId: string): void {
	object.traverse((child) => {
		child.userData = child.userData ?? {}
		child.userData[COMPONENT_ARTIFACT_KEY] = true
		child.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = nodeId
		child.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = componentId
		// The city dresses itself: every surface ( road, crosswalk, sidewalk, kerb,
		// streetlight, car, tower ) owns its material, and the lit ones draw their
		// whole look from an `onBeforeCompile` injection. The artifacts are parented
		// to the host node, so a host material config would otherwise reach them
		// through `applyMaterialOverrides` — which clones each material before
		// repainting it, and a clone loses the injection ( and the facade bake ),
		// leaving white surfaces. Same guard the road shoulders / lane lines use.
		child.userData.overrideMaterial = true
	})
}

class CityGeneratorComponent extends Component<CityGeneratorComponentProps> {
	private cityObject: THREE.Group | null = null

	constructor(context: ComponentRuntimeContext<CityGeneratorComponentProps>) {
		super(context)
	}

	onInit(): void {
		this.rebuild()
	}

	onRuntimeAttached(_object: Object3D | null): void {
		this.rebuild()
	}

	onPropsUpdated(): void {
		this.rebuild()
	}

	onEnabledChanged(enabled: boolean): void {
		if (enabled) {
			this.rebuild()
		} else {
			this.clear()
		}
	}

	onDestroy(): void {
		this.clear()
	}

	private clear(): void {
		const host = this.context.getRuntimeObject()
		const stored = host?.userData?.[CITY_GENERATOR_RUNTIME_GROUP_KEY] as THREE.Object3D | null | undefined
		const target = stored ?? this.cityObject

		if (target) {
			target.parent?.remove(target)
			disposeProceduralCityBlockGroup(target as THREE.Group)
		}
		if (host?.userData) {
			delete host.userData[CITY_GENERATOR_RUNTIME_GROUP_KEY]
		}

		this.cityObject = null
	}

	private rebuild(): void {
		const host = this.context.getRuntimeObject()
		this.clear()
		if (!this.context.isEnabled() || !host) {
			return
		}

		const props = clampCityGeneratorComponentProps(this.context.getProps())
		const snapshot = host.userData?.[PROCEDURAL_CITY_HOST_USER_DATA_KEY] as ProceduralCityHostSnapshot | undefined
		const footprint = resolveProceduralCityFootprint(snapshot)
		const surfaceY = snapshot ? resolvePolygonSurfaceHeight( snapshot ) : 0

		// the same grid resolution the panel predicts from: auto block counts that
		// cover the region, capped by the props when the user set one
		const grid = resolveCityGeneratorGrid( props, footprint, surfaceY )
		const regionFrame = grid.frame

		const group = buildProceduralCityBlockGroup({
			...buildOptionsFor( props, grid ),
			blocksX: grid.blocksX,
			blocksZ: grid.blocksZ
		})
		group.name = 'CityGenerator'

		// the r180 generators tag each zone with a partId and the wall material reads a
		// per-vertex colour instead, so bake the palette into the towers — the cheap
		// presets draw shared archetypes and carry their own colours, per instance
		if ( props.buildingPreset === 'skyscraper' ) {

			for (const child of group.children) {
				const tower = child.userData.tower as ProceduralCityTowerBox | undefined
				if (!tower) {
					continue
				}
				const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>
				applySkyscraperPartColors(mesh.geometry, new THREE.Color(pickBuildingColor(tower.seed)), 'project')
			}

		}

		tagCityGeneratorArtifact(group, this.context.nodeId, this.context.componentId)

		if (regionFrame && snapshot) {

			// the outline's points are in the host's own space, so the city is parented to
			// the host and only carries the grid frame: the node's transform ( position,
			// rotation, scale ) then applies to the whole city for free
			group.position.set(regionFrame.center.x, regionFrame.surfaceY, regionFrame.center.y)
			group.rotation.y = - regionFrame.angle
			host.add(group)

		} else {

			host.add(group)

		}

		const userData = host.userData ?? (host.userData = {})
		userData[CITY_GENERATOR_RUNTIME_GROUP_KEY] = group
		this.cityObject = group

		// the numbers that actually came out, so a panel or a log can line them up
		// with the prediction instead of recomputing the derivation
		const blockUserData = group.userData as ProceduralCityBlockGroupUserData
		blockUserData.blocksX = grid.blocksX
		blockUserData.blocksZ = grid.blocksZ
		blockUserData.vertices = countProceduralCityGroupVertices( group )
	}
}

const _clipPoint = new THREE.Vector2()

// the vertex total of a built city, counting shared archetype geometries once
function countProceduralCityGroupVertices( group: THREE.Group ): number {

	const counted = new Set< THREE.BufferGeometry >()
	let vertices = 0

	group.traverse( ( object ) => {

		const mesh = object as THREE.Mesh< THREE.BufferGeometry, THREE.Material >
		const geometry = mesh.geometry
		if ( geometry === undefined || counted.has( geometry ) ) return

		counted.add( geometry )
		vertices += geometry.getAttribute( 'position' )?.count ?? 0

	} )

	return vertices

}

type RegionFrame = {
	/** The outline rotated into the grid's own frame and centred on it. */
	polygon: THREE.Vector2[]
	/** The grid's centre, back in the host's local space. */
	center: THREE.Vector2
	angle: number
	surfaceY: number
	blocksX: number
	blocksZ: number
	/** How far the grid was slid off the region's centre to fill it. */
	offset: THREE.Vector2
}

/** How many blocks a region needs, before any cap, and the outline's box in its own frame. */
function resolveRegionBlockCounts(
	points: THREE.Vector2[],
	layout: ProceduralCityBlockLayout
): { blocksX: number; blocksZ: number; width: number; depth: number; rotated: THREE.Vector2[]; localCenter: THREE.Vector2; angle: number } | null {

	if ( points.length < 3 ) {
		return null
	}

	const angle = resolveLongestEdgeAngle( points )
	const rotated = points.map( ( point ) => rotate2( point, - angle ) )

	let minX = Infinity, minZ = Infinity, maxX = - Infinity, maxZ = - Infinity
	for ( const point of rotated ) {

		minX = Math.min( minX, point.x )
		minZ = Math.min( minZ, point.y )
		maxX = Math.max( maxX, point.x )
		maxZ = Math.max( maxZ, point.y )

	}

	const width = Math.max( 1, maxX - minX )
	const depth = Math.max( 1, maxZ - minZ )

	return {
		blocksX: Math.max( 1, Math.ceil( ( width + layout.street ) / ( layout.blockW + layout.street ) ) ),
		blocksZ: Math.max( 1, Math.ceil( ( depth + layout.street ) / ( layout.blockD + layout.street ) ) ),
		width,
		depth,
		rotated,
		localCenter: new THREE.Vector2( ( minX + maxX ) * 0.5, ( minZ + maxZ ) * 0.5 ),
		angle
	}

}

// fits the block grid to the host outline the same way `proceduralCity`'s grid style
// does: the grid turns to the outline's longest edge, covers its bounding box, and is
// then clipped back to the outline itself
function resolveRegionFrame(
	points: THREE.Vector2[],
	layout: ProceduralCityBlockLayout,
	blocksX: number,
	blocksZ: number,
	surfaceY: number
): RegionFrame | null {

	const counts = resolveRegionBlockCounts( points, layout )
	if ( counts === null ) return null

	const { angle, rotated, localCenter, width, depth } = counts
	const centeredPolygon = rotated.map( ( point ) => new THREE.Vector2( point.x - localCenter.x, point.y - localCenter.y ) )

	const gridW = blocksX * layout.blockW + ( blocksX - 1 ) * layout.street
	const gridD = blocksZ * layout.blockD + ( blocksZ - 1 ) * layout.street

	// A centred grid regularly leaves blocks straddling the outline ( or, when the
	// region is barely one block deep, all of them outside it ). Sliding the grid
	// flush with each edge of the region's box and keeping whichever alignment lands
	// the most block centres inside is enough to fill an odd-shaped region.
	const offset = resolveBestGridOffset( centeredPolygon, layout, blocksX, blocksZ, gridW, gridD, width, depth )
	const frameCenter = rotate2( new THREE.Vector2( localCenter.x + offset.x, localCenter.y + offset.y ), angle )
	// once the frame is offset, the outline has to be expressed in the grid's own
	// frame again — that is the space the block and tower filters test in
	const polygon = centeredPolygon.map( ( point ) => new THREE.Vector2( point.x - offset.x, point.y - offset.y ) )

	return {
		polygon,
		center: frameCenter,
		angle,
		surfaceY,
		blocksX,
		blocksZ,
		// the block builder tests its blocks against the outline directly, so the
		// chosen alignment is carried by the frame's own offset
		offset
	}

}

function resolveBestGridOffset(
	polygon: THREE.Vector2[],
	layout: ProceduralCityBlockLayout,
	blocksX: number,
	blocksZ: number,
	gridW: number,
	gridD: number,
	width: number,
	depth: number
): THREE.Vector2 {

	const candidatesX = [ 0, ( gridW - width ) * 0.5, ( width - gridW ) * 0.5 ]
	const candidatesZ = [ 0, ( gridD - depth ) * 0.5, ( depth - gridD ) * 0.5 ]
	const blockPitchX = layout.blockW + layout.street
	const blockPitchZ = layout.blockD + layout.street
	const probe = new THREE.Vector2()

	let bestScore = - 1
	let bestX = 0
	let bestZ = 0

	for ( const offsetX of candidatesX ) {

		for ( const offsetZ of candidatesZ ) {

			let score = 0

			for ( let bx = 0; bx < blocksX; bx ++ ) {

				const centerX = - gridW / 2 + bx * blockPitchX + layout.blockW / 2 + offsetX

				for ( let bz = 0; bz < blocksZ; bz ++ ) {

					const centerZ = - gridD / 2 + bz * blockPitchZ + layout.blockD / 2 + offsetZ
					if ( isPointInsidePolygon( probe.set( centerX, centerZ ), polygon ) ) score ++

				}

			}

			if ( score > bestScore ) {

				bestScore = score
				bestX = offsetX
				bestZ = offsetZ

			}

		}

	}

	return new THREE.Vector2( bestX, bestZ )

}

type ResolvedCityGrid = {
	/** The grid frame the builder mounts the city with ( region hosts only ). */
	frame: RegionFrame | null
	blocksX: number
	blocksZ: number
	requiredBlocksX: number
	requiredBlocksZ: number
	cappedByProps: boolean
	limitedByInstances: boolean
	layout: ProceduralCityBlockLayout
}

function resolveCityGeneratorGrid(
	props: CityGeneratorComponentProps,
	footprint: ProceduralCityFootprint | null | undefined,
	surfaceY: number
): ResolvedCityGrid {

	const layout = resolveProceduralCityBlockLayout({
		lot: props.lot,
		lotsX: props.lotsX,
		lotsZ: props.lotsZ,
		street: props.streetWidth,
		sidewalkWidth: props.sidewalkWidth
	})
	const points = footprint && footprint.kind !== 'road' ? footprint.points : null
	const counts = points ? resolveRegionBlockCounts( points, layout ) : null

	const requiredBlocksX = counts?.blocksX ?? CITY_GENERATOR_FREE_GRID_BLOCKS
	const requiredBlocksZ = counts?.blocksZ ?? CITY_GENERATOR_FREE_GRID_BLOCKS

	// 0 means auto ( cover the region ); a positive value caps how far the grid grows
	let blocksX = props.blocksX > 0 ? Math.min( props.blocksX, requiredBlocksX ) : requiredBlocksX
	let blocksZ = props.blocksZ > 0 ? Math.min( props.blocksZ, requiredBlocksZ ) : requiredBlocksZ
	const cappedByProps = blocksX < requiredBlocksX || blocksZ < requiredBlocksZ

	// the instanced presets cost almost nothing per building, so they only carry a
	// sanity cap: shrink the longer axis until the instance count fits
	let limitedByInstances = false
	if ( props.buildingPreset !== 'skyscraper' ) {

		while ( blocksX * blocksZ * props.lotsX * props.lotsZ > CITY_GENERATOR_MAX_INSTANCES && ( blocksX > 1 || blocksZ > 1 ) ) {

			if ( blocksX >= blocksZ && blocksX > 1 ) blocksX --
			else if ( blocksZ > 1 ) blocksZ --
			else break
			limitedByInstances = true

		}

	}

	const frame = points ? resolveRegionFrame( points, layout, blocksX, blocksZ, surfaceY ) : null

	return { frame, blocksX, blocksZ, requiredBlocksX, requiredBlocksZ, cappedByProps, limitedByInstances, layout }

}

/**
 * The block the grid keeps free of towers, in the built city's own frame — the space
 * the block and tower coordinates live in — or `null` when the reserve is off.
 *
 * The reserve is anchored to a block, never to the grid's own origin: with an even
 * block count the origin is the crossing between four blocks, which is street and
 * holds no building. The default block is the one whose centre sits nearest the host
 * region's centre — the outline's centre lands at `- frame.offset` in the grid's
 * frame, because the grid is slid off it to fill an odd-shaped region; a host with no
 * outline keeps the grid's origin. `reserveBlockX/Z` then walks off that block, and
 * an over-sized reserve grows symmetrically about the block's centre.
 */
export function resolveCityGeneratorReserveRect(
	props: CityGeneratorComponentProps,
	grid: ResolvedCityGrid
): ProceduralCityReservePlacement | null {

	if ( ! props.reserveEnabled ) return null

	return resolveProceduralCityReserveRect({
		layout: grid.layout,
		blocksX: grid.blocksX,
		blocksZ: grid.blocksZ,
		anchorX: grid.frame ? - grid.frame.offset.x : 0,
		anchorZ: grid.frame ? - grid.frame.offset.y : 0,
		blockOffsetX: props.reserveBlockX,
		blockOffsetZ: props.reserveBlockZ,
		width: props.reserveWidth,
		depth: props.reserveDepth
	})

}

/** Everything the panel needs to describe a grid before it is built. */
export type CityGeneratorGridPlan = {
	blocksX: number
	blocksZ: number
	requiredBlocksX: number
	requiredBlocksZ: number
	/** How many blocks the props allowed, as opposed to what the region needs. */
	cappedByProps: boolean
	/** True when the instanced instance cap stopped the grid growing. */
	limitedByInstances: boolean
	towers: number
	cars: number
	streetlights: number
	/** How many towers the reserve dropped — always 0 when it is off. */
	reserveTowers: number
	/** Where the reserved area sits, or `null` when no reserve is active. */
	reserve: CityGeneratorReservePlan | null
	estimatedVertices: number
	overBudget: boolean
}

/** The reserved area a plan resolved to, in the host node's own local space. */
export type CityGeneratorReservePlan = {
	/** Centre of the reserved area along the host's X axis. */
	centerX: number
	/** Centre of the reserved area along the host's Z axis. */
	centerZ: number
	/** The walking surface the reserved block is paved at, on the host's Y axis. */
	padTopY: number
	width: number
	depth: number
	/** The reserved block, in the grid's own 0-based block indices. */
	blockX: number
	blockZ: number
	/** How many blocks the grid has, per axis — the range those indices live in. */
	blockCountX: number
	blockCountZ: number
	/** The reserved block's building line: the inner zone its towers would have stood on. */
	buildingWidth: number
	buildingDepth: number
}

/**
 * Predicts a city's grid and cost from its props alone — no geometry is built, so a
 * panel can show what a region will produce before paying for it. The counts come
 * from the same builder the component uses ( in its `dryRun` mode ), which keeps the
 * prediction and the built city from drifting apart.
 */
export function resolveCityGeneratorGridPlan(
	props: CityGeneratorComponentProps,
	footprint: ProceduralCityFootprint | null | undefined,
	surfaceY = 0
): CityGeneratorGridPlan {

	const clamped = clampCityGeneratorComponentProps( props )
	const grid = resolveCityGeneratorGrid( clamped, footprint, surfaceY )

	const preview = buildProceduralCityBlockGroup( {
		...buildOptionsFor( clamped, grid ),
		blocksX: grid.blocksX,
		blocksZ: grid.blocksZ,
		dryRun: true
	} )
	const towers = preview.userData.towers.length
	const streetlights = preview.userData.streetlights ?? 0
	const cars = preview.userData.cars ?? 0
	const reserveTowers = preview.userData.reservedTowers ?? 0

	// the reserve is resolved in the city's frame; the panel reads it back in the
	// host's own space, where a theme node's transform is written
	const rect = resolveCityGeneratorReserveRect( clamped, grid )
	const sidewalkTop = clamped.includeSidewalks ? clamped.curbHeight : 0
	let reserve: CityGeneratorReservePlan | null = null
	if ( rect !== null ) {

		const block = {
			blockX: rect.blockX,
			blockZ: rect.blockZ,
			blockCountX: grid.blocksX,
			blockCountZ: grid.blocksZ,
			// the lots are set back from the block edge by the sidewalk strip, so this
			// is the footprint a theme building should stay inside
			buildingWidth: Math.max( 0, grid.layout.blockW - 2 * grid.layout.sidewalkWidth ),
			buildingDepth: Math.max( 0, grid.layout.blockD - 2 * grid.layout.sidewalkWidth )
		}

		if ( grid.frame === null ) {

			// no outline: the city sits on the host's origin unturned, so both frames agree
			reserve = { centerX: rect.x, centerZ: rect.z, padTopY: sidewalkTop, width: rect.width, depth: rect.depth, ...block }

		} else {

			const frame = grid.frame
			const center = rotate2( new THREE.Vector2( rect.x, rect.z ), frame.angle )
			reserve = {
				centerX: frame.center.x + center.x,
				centerZ: frame.center.y + center.y,
				padTopY: frame.surfaceY + sidewalkTop,
				width: rect.width,
				depth: rect.depth,
				...block
			}

		}

	}

	const estimatedVertices = clamped.buildingPreset === 'skyscraper'
		? towers * CITY_GENERATOR_TOWER_VERTEX_ESTIMATE
		: CITY_GENERATOR_LOWPOLY_VERTEX_ESTIMATE

	return {
		blocksX: grid.blocksX,
		blocksZ: grid.blocksZ,
		requiredBlocksX: grid.requiredBlocksX,
		requiredBlocksZ: grid.requiredBlocksZ,
		cappedByProps: grid.cappedByProps,
		limitedByInstances: grid.limitedByInstances,
		towers,
		cars,
		streetlights,
		reserveTowers,
		reserve,
		estimatedVertices,
		overBudget: clamped.buildingPreset === 'skyscraper' && estimatedVertices > CITY_GENERATOR_VERTEX_BUDGET
	}

}

// the single option set both the prediction and the real build are made from
function buildOptionsFor( props: CityGeneratorComponentProps, grid: ResolvedCityGrid ) {

	const frame = grid.frame

	return {
		seed: props.seed,
		buildings: props.buildingPreset,
		lot: props.lot,
		lotsX: props.lotsX,
		lotsZ: props.lotsZ,
		street: props.streetWidth,
		sidewalkWidth: props.sidewalkWidth,
		minTowerHeight: props.minTowerHeight,
		maxTowerHeight: props.maxTowerHeight,
		includeRoad: props.includeRoad,
		includeSidewalks: props.includeSidewalks,
		includeStreetlights: props.includeStreetlights,
		includeCars: props.includeCars,
		streetlightDensity: props.streetlightDensity,
		carDensity: props.carDensity,
		sidewalk: { curbHeight: props.curbHeight, curbRadius: props.curbRadius },
		// the engine's own city wall material: vertex colours plus its baked
		// directional light, the same instance the procedural city uses
		material: getWallMaterial( 'solid' ),
		blockFilter: frame ? ( block: { x: number; z: number } ) => isPointInsidePolygon( _clipPoint.set( block.x, block.z ), frame.polygon ) : undefined,
		towerFilter: frame ? ( tower: ProceduralCityTowerBox ) => isPointInsidePolygon( _clipPoint.set( tower.x, tower.z ), frame.polygon ) : undefined,
		placementFilter: frame ? ( position: { x: number; z: number } ) => isPointInsidePolygon( _clipPoint.set( position.x, position.z ), frame.polygon ) : undefined,
		roadPolygon: frame?.polygon,
		// the reserved block: only the towers go, so the block keeps its paving, its
		// kerbs, its streetlights and the cars parked along it
		reserveRect: resolveCityGeneratorReserveRect( props, grid ) ?? undefined
	}

}

const cityGeneratorComponentDefinition: ComponentDefinition<CityGeneratorComponentProps> = {
	type: CITY_GENERATOR_COMPONENT_TYPE,
	label: 'City Generator',
	icon: 'mdi-city-variant',
	order: 55,
	recreateOnPropsChange: false,
	canAttach(node: SceneNode) {
		const nodeType = node.nodeType?.toLowerCase?.() ?? ''
		return nodeType !== 'light' && nodeType !== 'environment'
	},
	createDefaultProps() {
		return cloneCityGeneratorComponentProps(CITY_GENERATOR_DEFAULT_PROPS)
	},
	createInstance(context) {
		return new CityGeneratorComponent(context)
	},
}

componentManager.registerDefinition(cityGeneratorComponentDefinition)

export function createCityGeneratorComponentState(
	overrides?: Partial<CityGeneratorComponentProps>,
	options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<CityGeneratorComponentProps> {
	return {
		id: options.id ?? '',
		type: CITY_GENERATOR_COMPONENT_TYPE,
		enabled: options.enabled ?? true,
		props: clampCityGeneratorComponentProps({
			...CITY_GENERATOR_DEFAULT_PROPS,
			...overrides,
		}),
	}
}

export { cityGeneratorComponentDefinition }

/** The tower and furniture counts a built city reported, for callers that inspect the runtime. */
export type CityGeneratorRuntimeStats = Pick<ProceduralCityBlockGroupUserData, 'towers' | 'streetlights' | 'cars' | 'seed'>
