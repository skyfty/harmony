/**
 * The block / lot layout half of three.js' r180 `CityGenerator` ( MIT License,
 * https://github.com/mrdoob/three.js ), vendored without the street furniture and
 * the GI proxy — those sub-generators are TSL-only. The road and the sidewalks are
 * included, ported to CPU geometry plus WebGL materials ( see `proceduralCityRoad`
 * and `proceduralCitySidewalk` ).
 *
 * The tower placement math ( and, critically, the order of the PRNG draws ) is
 * copied from upstream `cityLayout` / `createRandom` / `build()`, so a given
 * seed lays out exactly the same city as the upstream generator.
 */

import { Color, Group, Matrix4, Vector3 } from 'three'

import type { Material, Mesh, Vector2 } from 'three'
import { SkyscraperGenerator } from './proceduralCitySkyscraper'
import { pickBuildingColor } from './proceduralCitySkyscraper'
import {
	BUILDING_VARIANT_COUNT,
	createMesh,
	getArchetypes,
	resolveProceduralCitySolidVariantIndex,
} from './proceduralCityComponent'
import { configureSolidOutlineMesh, getSolidOutlineMaterial, getWallMaterial } from './proceduralCityMaterials'
import { createProceduralCityRoadMesh } from './proceduralCityRoad'
import { buildProceduralCityCarGroup } from './proceduralCityCar'
import { buildProceduralCityStreetlightGroup, type ProceduralCityStreetlightOptions } from './proceduralCityStreetlight'
import { planProceduralCityStreetFurniture } from './proceduralCityStreetFurniture'
import {
	PROCEDURAL_CITY_SIDEWALK_DEFAULTS,
	buildProceduralCitySidewalkGroup,
	type ProceduralCitySidewalkOptions
} from './proceduralCitySidewalk'

const _placementPosition = new Vector3()

/**
 * The building geometry a block layout is drawn with:
 *
 * - `skyscraper` — the upstream r180 facade generator, one merged mesh per tower
 *   (~50k vertices each). The detailed option.
 * - every other value — the cheap instanced presets: twelve unit-sized
 *   archetypes shared by the whole city, one `InstancedMesh` per variant with a
 *   per-instance colour, so a building costs an instance matrix instead of
 *   geometry. `solid` adds the screen-space outline `proceduralCity` uses.
 *
 * The layout is identical either way, so switching presets keeps the same
 * skyline footprint and only changes how the towers are drawn.
 */
export type ProceduralCityBuildingPreset = 'skyscraper' | 'solid' | 'office' | 'bright' | 'classic' | 'warm' | 'cool'

/** The fixed grid a block layout starts from ( upstream `CityGenerator.defaults` ). */
export const SKYSCRAPER_BLOCK_DEFAULTS = {
	seed: 1,
	street: 22,
	lot: 30,
	lotsX: 3,
	lotsZ: 2,
	blocksX: 2,
	blocksZ: 2,
	sidewalkWidth: 5
}

/** The derived block / city dimensions a layout resolves to. */
export type ProceduralCityBlockLayout = {
	street: number
	lot: number
	lotsX: number
	lotsZ: number
	blocksX: number
	blocksZ: number
	blockW: number
	blockD: number
	sidewalkWidth: number
	innerLotX: number
	innerLotZ: number
	cityW: number
	cityD: number
}

/** What a caller may pass to {@link resolveProceduralCityBlockLayout} / {@link buildProceduralCityBlockGroup}. */
export type ProceduralCityBlockOptions = {
	seed?: number
	street?: number
	lot?: number
	lotsX?: number
	lotsZ?: number
	blocksX?: number
	blocksZ?: number
	sidewalkWidth?: number
	/** The tallest and shortest tower the seed may produce. Defaults mirror upstream's 38 – 152. */
	minTowerHeight?: number
	maxTowerHeight?: number
	/** Lift every tower off the ground plane, in metres. */
	groundOffset?: number
	/** Bake the glass panes' interior-mapping attributes ( see {@link SkyscraperGenerator} ). */
	includeGlassInteriors?: boolean
	/** The material every tower is dressed with. Falls back to the generator's own. */
	material?: Material | null
	/** Build the road surface ( wet asphalt, lane lines, crosswalks ). Default `true`. */
	includeRoad?: boolean
	/** Build the raised sidewalk slabs and curbs. Default `true`. */
	includeSidewalks?: boolean
	/** Dress the curbs with cobra-head streetlights. Default `true`. */
	includeStreetlights?: boolean
	/** Park the car fleet along the kerbs and in the travel lanes. Default `true`. */
	includeCars?: boolean
	/** The sidewalk profile — also the height the towers stand at. */
	sidewalk?: ProceduralCitySidewalkOptions
	/** The streetlight profile ( mast height, arm reach, mast radius ). */
	streetlight?: ProceduralCityStreetlightOptions
	/**
	 * Clip the grid to a city-local outline: a block whose centre fails the test is
	 * skipped along with its towers and sidewalk slab. Used to fit a city to the
	 * host region it is attached to.
	 */
	blockFilter?: ( block: { x: number; z: number; width: number; depth: number } ) => boolean
	/** Skip a tower before it is generated — the cheap half of the same clipping. */
	towerFilter?: ( tower: ProceduralCityTowerBox ) => boolean
	/** Skip a streetlight or car placement ( tested at its ground position ). */
	placementFilter?: ( position: { x: number; z: number } ) => boolean
	/** Lay the road surface over this city-local outline instead of a rectangle. */
	roadPolygon?: Vector2[]
	/** The building geometry to draw the towers with. Default `'skyscraper'`. */
	buildings?: ProceduralCityBuildingPreset
	/**
	 * Run the layout and the placement filters but build no geometry at all: the
	 * returned group carries only `userData`, so a caller can predict what a set of
	 * options would cost before paying for it.
	 */
	dryRun?: boolean
}

/** One tower's box, sized and placed — kept for stats and future GI proxies. */
export type ProceduralCityTowerBox = {
	x: number
	y: number
	z: number
	width: number
	height: number
	depth: number
	/** The tower's own generator seed — also the source of its palette colour. */
	seed: number
	/** The footprint's chamfered corner, so a proxy can reproduce the massing. */
	chamferWidth: number
	chamferCornerX: number
	chamferCornerZ: number
}

/** The layout a {@link buildProceduralCityBlockGroup} result carries on `userData`. */
export type ProceduralCityBlockGroupUserData = {
	layout: ProceduralCityBlockLayout
	towers: ProceduralCityTowerBox[]
	/** How many streetlight placements the walk produced. */
	streetlights: number
	/** How many car placements the walk produced. */
	cars: number
	/** The grid this build resolved to, per axis. */
	blocksX?: number
	blocksZ?: number
	/** The built geometry's vertex total, counting shared archetypes once. */
	vertices?: number
	seed: number
}

// deterministic PRNG (mulberry32) so a seed always lays out the same city
export function createProceduralCityRandom( seed: number ): () => number {

	let s = ( seed >>> 0 ) || 1

	return function () {

		s = ( s + 0x6D2B79F5 ) | 0
		let t = Math.imul( s ^ ( s >>> 15 ), 1 | s )
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296

	}

}

// derives the block / street dimensions from the parameters
export function resolveProceduralCityBlockLayout( options: ProceduralCityBlockOptions = {} ): ProceduralCityBlockLayout {

	const street = options.street ?? SKYSCRAPER_BLOCK_DEFAULTS.street
	const lot = options.lot ?? SKYSCRAPER_BLOCK_DEFAULTS.lot
	const lotsX = options.lotsX ?? SKYSCRAPER_BLOCK_DEFAULTS.lotsX
	const lotsZ = options.lotsZ ?? SKYSCRAPER_BLOCK_DEFAULTS.lotsZ
	const blocksX = options.blocksX ?? SKYSCRAPER_BLOCK_DEFAULTS.blocksX
	const blocksZ = options.blocksZ ?? SKYSCRAPER_BLOCK_DEFAULTS.blocksZ
	const sidewalkWidth = options.sidewalkWidth ?? SKYSCRAPER_BLOCK_DEFAULTS.sidewalkWidth

	const blockW = lotsX * lot
	const blockD = lotsZ * lot

	// the lots tile the inner zone left after the sidewalk strip is taken from
	// every edge; buildings front onto its perimeter ( the building line )
	const innerLotX = ( blockW - 2 * sidewalkWidth ) / lotsX
	const innerLotZ = ( blockD - 2 * sidewalkWidth ) / lotsZ

	return {
		street, lot, lotsX, lotsZ, blocksX, blocksZ, blockW, blockD, sidewalkWidth, innerLotX, innerLotZ,
		cityW: blocksX * blockW + ( blocksX - 1 ) * street,
		cityD: blocksZ * blockD + ( blocksZ - 1 ) * street
	}

}

/**
 * Lays out a grid of city blocks and fills each lot with its own
 * {@link SkyscraperGenerator} tower, over a road surface and the raised sidewalks
 * the towers front onto — the same three layers upstream's `build()` assembles (
 * minus the street furniture and the GI proxy ).
 *
 * The layout and the tower boxes are exposed on `userData`, and every tower mesh
 * carries its own box on `userData.tower`, so a caller can align scatter, camera
 * or proxy geometry to the same grid.
 */
export function buildProceduralCityBlockGroup( options: ProceduralCityBlockOptions = {} ): Group {

	const seed = options.seed ?? SKYSCRAPER_BLOCK_DEFAULTS.seed
	const L = resolveProceduralCityBlockLayout( options )
	const minHeight = options.minTowerHeight ?? 38
	const maxHeight = Math.max( minHeight, options.maxTowerHeight ?? 152 )
	const material = options.material ?? null
	const includeRoad = options.includeRoad ?? true
	const includeSidewalks = options.includeSidewalks ?? true
	const includeStreetlights = options.includeStreetlights ?? true
	const includeCars = options.includeCars ?? true
	const buildings: ProceduralCityBuildingPreset = options.buildings ?? 'skyscraper'
	const instancedBuildings = buildings !== 'skyscraper'
	const dryRun = options.dryRun === true
	const curbHeight = options.sidewalk?.curbHeight ?? PROCEDURAL_CITY_SIDEWALK_DEFAULTS.curbHeight
	// upstream stands every tower on the sidewalk; without sidewalks it stands on the road
	const groundOffset = options.groundOffset ?? ( includeSidewalks ? curbHeight : 0 )

	const group = new Group()
	group.name = 'City'

	const towers: ProceduralCityTowerBox[] = []
	const sidewalkPlacements: Matrix4[] = []
	// the cheap presets collect this tower's placement per archetype variant and
	// build one instanced mesh per variant once the layout is known
	const buildingBuckets = new Map< number, InstancedBuilding[] >()
	const random = createProceduralCityRandom( seed )
	const sw = L.sidewalkWidth

	for ( let bx = 0; bx < L.blocksX; bx ++ ) {

		for ( let bz = 0; bz < L.blocksZ; bz ++ ) {

			const blockX = - L.cityW / 2 + bx * ( L.blockW + L.street )
			const blockZ = - L.cityD / 2 + bz * ( L.blockD + L.street )

			// a block whose centre falls outside the host outline is dropped whole:
			// no towers, no sidewalk slab, no furniture along its kerbs
			const blockCenterX = blockX + L.blockW / 2
			const blockCenterZ = blockZ + L.blockD / 2
			if ( options.blockFilter && ! options.blockFilter( { x: blockCenterX, z: blockCenterZ, width: L.blockW, depth: L.blockD } ) ) {
				continue
			}

			// one sidewalk slab centred on each block
			sidewalkPlacements.push( new Matrix4().makeTranslation( blockCenterX, 0, blockCenterZ ) )

			// the lots sit in an inner zone set back from the block edge by the
			// sidewalk width, so a real walking strip is left between the street
			// wall and the curb. buildings front onto that building line.
			const zoneX = blockX + sw, zoneZ = blockZ + sw

			for ( let lx = 0; lx < L.lotsX; lx ++ ) {

				for ( let lz = 0; lz < L.lotsZ; lz ++ ) {

					// a chamfered corner only reads as architecture when it faces the
					// block's corner ( the street intersection ), so only the four corner
					// lots are cut, each toward its own outward corner; the rest stay square
					const cornerX = lx === 0 ? - 1 : ( lx === L.lotsX - 1 ? 1 : 0 )
					const cornerZ = lz === 0 ? - 1 : ( lz === L.lotsZ - 1 ? 1 : 0 )
					const onCorner = cornerX !== 0 && cornerZ !== 0

					const tall = random()

					// nearly fill the lot so neighbours abut into a continuous street
					// wall; the small slack goes to the interior side ( a light well )
					const fw = L.innerLotX - ( 0.4 + random() * 1 )
					const fd = L.innerLotZ - ( 0.4 + random() * 1 )

					const totalHeight = minHeight + tall * tall * ( maxHeight - minHeight )

					// drawn here, one line per upstream object property and in the same order,
					// so this shares the exact PRNG sequence with `CityGenerator.build()` while
					// still letting the tower box record the values the generator was built with
					const towerSeed = Math.floor( random() * 100000 )
					const floorHeight = 3.4 + random() * 1.8
					const bayWidth = 1.9 + random() * 2.1
					const pierWidth = 0.4 + random() * 0.5
					const pierDepth = 0.3 + random() * 0.4
					const chamferWidth = onCorner ? 3 + random() * 4 : 0
					const setbackDepth = random() < 0.4 ? 0.8 + random() * 2 : 0 // only some towers step back at the crown; the rest rise flat
					const stringCourseEvery = random() < 0.85 ? 3 + Math.floor( random() * 6 ) : 0

					// place within the lot, fronted toward the streets it borders so its
					// outer faces land on the building line; interior columns stay centred
					const lotLeft = zoneX + lx * L.innerLotX, lotNear = zoneZ + lz * L.innerLotZ
					const cx = cornerX === - 1 ? lotLeft + fw / 2 : ( cornerX === 1 ? lotLeft + L.innerLotX - fw / 2 : lotLeft + L.innerLotX / 2 )
					const cz = cornerZ === - 1 ? lotNear + fd / 2 : ( cornerZ === 1 ? lotNear + L.innerLotZ - fd / 2 : lotNear + L.innerLotZ / 2 )

					// record a plain box matching this tower for stats, the GI proxy and clipping
					const towerBox: ProceduralCityTowerBox = {
						x: cx,
						y: groundOffset + totalHeight / 2,
						z: cz,
						width: fw,
						height: totalHeight,
						depth: fd,
						seed: towerSeed,
						chamferWidth,
						chamferCornerX: cornerX,
						chamferCornerZ: cornerZ
					}

					// a clipped tower is never generated — worth it, since one tower bakes
					// ~50k vertices and this is the hot path when fitting a city to a region
					if ( options.towerFilter && ! options.towerFilter( towerBox ) ) {
						continue
					}

					if ( instancedBuildings ) {

						// the cheap presets skip the facade generator entirely: the tower
						// becomes one instance of a shared archetype
						const roll = towerRoll( towerSeed )
						const heightT = maxHeight > minHeight ? ( totalHeight - minHeight ) / ( maxHeight - minHeight ) : 0.5
						const variant = buildings === 'solid'
							? resolveProceduralCitySolidVariantIndex( roll, Math.min( 1, Math.max( 0, heightT ) ), fw, fd, towerSeed )
							: Math.floor( roll * BUILDING_VARIANT_COUNT )
						const bucket = buildingBuckets.get( variant )
						const entry: InstancedBuilding = { tower: towerBox, color: pickBuildingColor( towerSeed ) }
						if ( bucket === undefined ) buildingBuckets.set( variant, [ entry ] )
						else bucket.push( entry )

						towers.push( towerBox )
						continue

					}

					// a dry run stops here: the tower box is placed and counted, but the
					// facade geometry it would bake is what the caller is trying to predict
					towers.push( towerBox )
					if ( dryRun ) continue

					const generator = new SkyscraperGenerator( {
						seed: towerSeed,
						totalHeight,
						footprint: { width: fw, depth: fd },
						floorHeight,
						bayWidth,
						pierWidth,
						pierDepth,
						chamferWidth,
						chamferCornerX: cornerX,
						chamferCornerZ: cornerZ,
						setbackDepth,
						stringCourseEvery,
						includeGlassInteriors: options.includeGlassInteriors ?? false
					}, material )

					const building = generator.build()

					building.position.set( cx, groundOffset, cz )
					building.castShadow = building.receiveShadow = true

					group.add( building )

					// keep the box on the mesh too, so a consumer never has to rely on
					// the group's child order to line the two up
					building.userData.tower = towerBox

				}

			}

		}

	}

	// the road first, so the sidewalks and towers draw over it
	if ( ! dryRun ) {

		if ( includeRoad ) group.add( createProceduralCityRoadMesh( L, options.roadPolygon ) )
		if ( includeSidewalks ) group.add( buildProceduralCitySidewalkGroup( L, sidewalkPlacements, options.sidewalk ) )
		// an empty spread would call `add()` with no argument, which three warns about —
		// a fully clipped grid legitimately builds no instanced mesh at all
		if ( instancedBuildings ) {
			const buildingMeshes = buildInstancedBuildings( buildings, buildingBuckets )
			if ( buildingMeshes.length ) group.add( ...buildingMeshes )
		}

	}

	// the street furniture: the walk consumes the same PRNG stream upstream's
	// `buildFurniture` does, right after the towers, so the kerbside comes out the same
	let streetlights = 0
	let cars = 0
	if ( includeStreetlights || includeCars ) {

		const planned = planProceduralCityStreetFurniture( L, random, {
			sidewalkTop: includeSidewalks ? curbHeight : 0
		} )
		const keepPlacement = ( matrix: Matrix4 ): boolean => {

			if ( ! options.placementFilter ) return true

			_placementPosition.setFromMatrixPosition( matrix )
			return options.placementFilter( { x: _placementPosition.x, z: _placementPosition.z } )

		}
		const furniture = {
			streetlights: planned.streetlights.filter( keepPlacement ),
			cars: planned.cars.filter( ( car ) => keepPlacement( car.matrix ) )
		}
		streetlights = furniture.streetlights.length
		cars = furniture.cars.length

		if ( ! dryRun ) {

			if ( includeStreetlights && streetlights > 0 ) group.add( buildProceduralCityStreetlightGroup( furniture.streetlights, options.streetlight ) )
			if ( includeCars && cars > 0 ) group.add( buildProceduralCityCarGroup( furniture.cars ) )

		}

	}

	const userData: ProceduralCityBlockGroupUserData = { layout: L, towers, streetlights, cars, seed }
	group.userData = { ...group.userData, ...userData }

	return group

}

type InstancedBuilding = {
	tower: ProceduralCityTowerBox
	/** The tower's palette colour, written to the instance buffer. */
	color: number
}

// a stable 0..1 roll derived from the tower's own seed — the archetype choice must
// not consume the layout PRNG, or the city would stop matching upstream
function towerRoll( seed: number ): number {

	const h = Math.abs( Math.sin( seed * 12.9898 ) * 43758.5453 )
	return h - Math.floor( h )

}

const _instancedBuildingMatrix = new Matrix4()
const _instancedBuildingColor = new Color()

/**
 * Turns the bucketed towers into the instanced draw: one `InstancedMesh` per
 * archetype variant, plus a matching silhouette for the `solid` style. The
 * archetype geometries are the shared, cached ones, so they are tagged and left
 * for the module that owns them — see {@link disposeProceduralCityBlockGroup}.
 */
function buildInstancedBuildings( preset: ProceduralCityBuildingPreset, buckets: Map< number, InstancedBuilding[] > ): Mesh[] {

	if ( ! buckets.size ) {
		return []
	}

	const archetypes = getArchetypes( preset )
	const material = getWallMaterial( preset )
	const meshes: Mesh[] = []

	for ( const [ variant, entries ] of buckets ) {

		const archetype = archetypes[ variant % archetypes.length ]
		if ( archetype === undefined ) continue

		const geometry = archetype.geometry
		geometry.userData.proceduralCityShared = true

		const mesh = createMesh( geometry, material, entries.length, `CityBuildings_${preset}_${variant}` )

		for ( let index = 0; index < entries.length; index ++ ) {

			const tower = entries[ index ]!.tower
			_instancedBuildingMatrix.makeScale( tower.width, tower.height, tower.depth )
			_instancedBuildingMatrix.setPosition( tower.x, tower.y - tower.height / 2, tower.z )
			mesh.setMatrixAt( index, _instancedBuildingMatrix )
			mesh.setColorAt( index, _instancedBuildingColor.setHex( entries[ index ]!.color ) )

		}

		mesh.instanceMatrix.needsUpdate = true
		if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true
		mesh.computeBoundingSphere()
		meshes.push( mesh )

		if ( preset !== 'solid' ) continue

		const outline = createMesh( geometry, getSolidOutlineMaterial(), entries.length, `CityBuildings_${preset}_${variant}_outline` )
		outline.renderOrder = 1
		configureSolidOutlineMesh( outline )

		for ( let index = 0; index < entries.length; index ++ ) {

			const tower = entries[ index ]!.tower
			_instancedBuildingMatrix.makeScale( tower.width, tower.height, tower.depth )
			_instancedBuildingMatrix.setPosition( tower.x, tower.y - tower.height / 2, tower.z )
			outline.setMatrixAt( index, _instancedBuildingMatrix )

		}

		outline.instanceMatrix.needsUpdate = true
		outline.computeBoundingSphere()
		meshes.push( outline )

	}

	return meshes

}

/**
 * Builds a lightweight stand-in for the city: one instanced box per tower,
 * sized to match, in a single draw call. Intended for cheap global-illumination
 * bakes, where the detailed facades and street furniture are unnecessary and the
 * boxes still cast the same street shadows.
 *
 * The matrix list is returned rather than a mesh so the caller owns the geometry
 * and the material ( the upstream version hard-codes a TSL node material ).
 * Call after {@link buildProceduralCityBlockGroup}, which records the tower boxes.
 */
export function collectProceduralCityTowerMatrices( group: Group ): Matrix4[] {

	const userData = group.userData as Partial<ProceduralCityBlockGroupUserData>
	const towers = userData.towers ?? []

	return towers.map( ( tower ) => new Matrix4()
		.makeScale( tower.width, tower.height, tower.depth )
		.setPosition( tower.x, tower.y, tower.z ) )

}

/**
 * Disposes a {@link buildProceduralCityBlockGroup} result: every geometry it
 * created, plus any material it owns. Materials handed in by the caller ( the
 * tower material ) and the module-level sidewalk materials are left alone.
 */
export function disposeProceduralCityBlockGroup( group: Group ): void {

	group.traverse( ( object ) => {

		const mesh = object as Mesh
		// the instanced building presets draw with archetype geometries owned by the
		// procedural city module; only geometries this build created are freed here
		if ( mesh.geometry?.userData?.proceduralCityShared !== true ) mesh.geometry?.dispose()

		const materials = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ]
		for ( const material of materials ) {

			if ( material !== undefined && material !== null && material.userData?.proceduralCityOwned === true ) material.dispose()

		}

	} )

	group.clear()

}
