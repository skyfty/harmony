/**
 * Skyscraper geometry generator.
 *
 * Vendored from three.js `examples/jsm/generators/city/SkyscraperGenerator.js`
 * (three r186, MIT License, https://github.com/mrdoob/three.js), with the
 * TSL / WebGPU material section removed so the generator runs on the classic
 * WebGL renderer. The geometry code below stays as close to upstream as
 * possible (including its tab indentation) so a future upstream sync remains a
 * readable diff; only the type annotations, the import paths and the
 * `includeGlassInteriors` switch are local changes.
 *
 * Dropped from upstream: the `interior` / `shopInterior` node functions, the
 * `valueNoise` / `valueFractal` helpers, `createSkyscraperMaterial`, and the two
 * node-material imports ( the WebGPU build and the TSL function library ).
 *
 * The generator is material agnostic — it only produces geometry. Pass a single
 * material to dress it; the look is driven by the baked `partId` attribute.
 */

import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	ExtrudeGeometry,
	LatheGeometry,
	Matrix3,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	Path,
	PlaneGeometry,
	ShapeGeometry,
	Shape,
	Sphere,
	Vector2,
	Vector3
} from 'three'

import type { Material } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const _scale = /*@__PURE__*/ new Vector3()
const _point = /*@__PURE__*/ new Vector3()
const _normalMatrix = /*@__PURE__*/ new Matrix3()
const _identity = /*@__PURE__*/ new Matrix4()

// material-zone codes baked per vertex into the merged geometry, so one material can
// branch on partId and shade every zone
const PartId = { WALL: 0, PIER: 1, FRAME: 2, ORNAMENT: 3, GLASS: 4, AC: 5, SHOPGLASS: 6, STORE: 7, AWNING: 8 }
const { WALL, PIER, FRAME, ORNAMENT, GLASS, AC, SHOPGLASS, STORE, AWNING } = PartId

/** The per-vertex material zones baked into a tower's merged geometry. */
export const SKYSCRAPER_PART = PartId

/** A part-id value from {@link SKYSCRAPER_PART}. */
export type SkyscraperPartId = ( typeof PartId )[ keyof typeof PartId ]

// fraction of a floor's height taken by the glazed opening; the remainder is
// the spandrel band. shared by the window module and the spandrels so they tile.
const WINDOW_HEIGHT_RATIO = 0.62

// width of the flat window-frame band around the glazing; shared by the frame module
// and the glass pane so the pane always tucks inside the frame
const WINDOW_BORDER = 0.1

// the masonry course module ( brick height × length ). the generator snaps floor and
// bay dimensions to it, and the material's coursing reads the same values, so the
// procedural brickwork lines up with the geometry
const BRICK = { height: 0.3, length: 0.6 }

/** The masonry course module the tower's floor and bay dimensions snap to. */
export const SKYSCRAPER_BRICK = BRICK

// merging requires all-indexed or all-non-indexed inputs; extrusions are
// non-indexed while boxes/planes are indexed, so normalize before merging

function merge( geometries: BufferGeometry[] ): BufferGeometry {

	return mergeGeometries( geometries.map( ( g ) => g.index ? g.toNonIndexed() : g ) )

}

function nonIndexed( geometry: BufferGeometry ): BufferGeometry {

	return geometry.index ? geometry.toNonIndexed() : geometry

}

// the unit box is identical for every building's shell boxes — build it once
const _unitBox = /*@__PURE__*/ nonIndexed( new BoxGeometry( 1, 1, 1 ) )

// a unit quad ( facing +Z ), scaled per placement for the storefront display glazing
const _unitPlane = /*@__PURE__*/ nonIndexed( new PlaneGeometry( 1, 1 ) )

/** The interior-mapping room a glass pane looks into ( centre in world space + size ). */
type SkyscraperRoom = { center: Vector3; size: Vector2 }

/** One baked batch: a base geometry instanced onto `matrices`, tagged with a part id. */
type SkyscraperBakeGroup = {
	geometry: BufferGeometry
	matrices: Matrix4[]
	partId: number
	rooms?: SkyscraperRoom[] | null
	rigid?: boolean
}

/**
 * Bakes a list of instance groups into one non-indexed BufferGeometry. Each group is a
 * base geometry ( position + normal + uv ), an array of Matrix4 placements and a `partId`
 * written to a per-vertex attribute. Transforming straight into preallocated typed arrays
 * avoids mergeGeometries' per-instance allocations; the result is one geometry, ready for
 * a single draw call.
 *
 * `includeGlassInteriors` additionally bakes `roomCenter` / `roomSize`, which only the
 * dropped TSL material reads. Leaving them off saves 36% of the vertex data.
 */
function bakeGroups( groups: SkyscraperBakeGroup[], includeGlassInteriors: boolean ): BufferGeometry {

	let total = 0
	for ( const group of groups ) total += group.geometry.getAttribute( 'position' ).count * group.matrices.length

	const position = new Float32Array( total * 3 )
	const normal = new Float32Array( total * 3 )
	const uv = new Float32Array( total * 2 )
	const partId = new Float32Array( total )
	// per-window interior-mapping room ( centre + size ) the glass pane looks into; only
	// the glass group writes it, every other vertex stays zero. baked per vertex so the
	// material reads each building's own room sizes without a global uniform.
	const roomCenter = includeGlassInteriors ? new Float32Array( total * 3 ) : null
	const roomSize = includeGlassInteriors ? new Float32Array( total * 2 ) : null

	let w = 0

	// the bounding sphere falls out of the AABB gathered while transforming, sparing a
	// second full pass over the positions ( computeBoundingSphere )
	let minX = Infinity, minY = Infinity, minZ = Infinity
	let maxX = - Infinity, maxY = - Infinity, maxZ = - Infinity

	for ( const group of groups ) {

		const geometry = group.geometry
		const P = geometry.getAttribute( 'position' ).array
		const N = geometry.getAttribute( 'normal' ).array
		const U = geometry.getAttribute( 'uv' ).array
		const count = geometry.getAttribute( 'position' ).count
		const id = group.partId
		const rooms = group.rooms // per-instance { center, size }, glass only
		const rigid = group.rigid === true // pure rotation ( + translation ): the normal matrix is the rotation itself

		for ( let i = 0; i < group.matrices.length; i ++ ) {

			const room = includeGlassInteriors && rooms ? ( rooms[ i ] ?? null ) : null

			const matrix = group.matrices[ i ]!
			const e = matrix.elements
			const e0 = e[ 0 ], e1 = e[ 1 ], e2 = e[ 2 ], e4 = e[ 4 ], e5 = e[ 5 ], e6 = e[ 6 ], e8 = e[ 8 ], e9 = e[ 9 ], e10 = e[ 10 ], e12 = e[ 12 ], e13 = e[ 13 ], e14 = e[ 14 ]

			// for a rigid frame the inverse-transpose equals the rotation, so its columns
			// are read straight from the matrix and the per-instance 3×3 inverse is skipped
			let n0, n1, n2, n3, n4, n5, n6, n7, n8

			if ( rigid ) {

				n0 = e0; n1 = e1; n2 = e2; n3 = e4; n4 = e5; n5 = e6; n6 = e8; n7 = e9; n8 = e10

			} else {

				const ne = _normalMatrix.getNormalMatrix( matrix ).elements
				n0 = ne[ 0 ], n1 = ne[ 1 ], n2 = ne[ 2 ], n3 = ne[ 3 ], n4 = ne[ 4 ], n5 = ne[ 5 ], n6 = ne[ 6 ], n7 = ne[ 7 ], n8 = ne[ 8 ]

			}

			for ( let v = 0; v < count; v ++ ) {

				const v3 = v * 3, w3 = w * 3
				const x = P[ v3 ]!, y = P[ v3 + 1 ]!, z = P[ v3 + 2 ]!
				const wx = e0 * x + e4 * y + e8 * z + e12
				const wy = e1 * x + e5 * y + e9 * z + e13
				const wz = e2 * x + e6 * y + e10 * z + e14
				position[ w3 ] = wx; position[ w3 + 1 ] = wy; position[ w3 + 2 ] = wz
				if ( wx < minX ) minX = wx; if ( wx > maxX ) maxX = wx
				if ( wy < minY ) minY = wy; if ( wy > maxY ) maxY = wy
				if ( wz < minZ ) minZ = wz; if ( wz > maxZ ) maxZ = wz

				const nx = N[ v3 ]!, ny = N[ v3 + 1 ]!, nz = N[ v3 + 2 ]!
				const tx = n0 * nx + n3 * ny + n6 * nz, ty = n1 * nx + n4 * ny + n7 * nz, tz = n2 * nx + n5 * ny + n8 * nz
				const inv = 1 / ( Math.sqrt( tx * tx + ty * ty + tz * tz ) || 1 )
				normal[ w3 ] = tx * inv; normal[ w3 + 1 ] = ty * inv; normal[ w3 + 2 ] = tz * inv

				uv[ w * 2 ] = U[ v * 2 ]!; uv[ w * 2 + 1 ] = U[ v * 2 + 1 ]!
				partId[ w ] = id

				if ( room !== null && roomCenter !== null && roomSize !== null ) {

					roomCenter[ w3 ] = room.center.x; roomCenter[ w3 + 1 ] = room.center.y; roomCenter[ w3 + 2 ] = room.center.z
					roomSize[ w * 2 ] = room.size.x; roomSize[ w * 2 + 1 ] = room.size.y

				}

				w ++

			}

		}

	}

	const geometry = new BufferGeometry()
	geometry.setAttribute( 'position', new BufferAttribute( position, 3 ) )
	geometry.setAttribute( 'normal', new BufferAttribute( normal, 3 ) )
	geometry.setAttribute( 'uv', new BufferAttribute( uv, 2 ) )
	geometry.setAttribute( 'partId', new BufferAttribute( partId, 1 ) )
	if ( roomCenter !== null ) geometry.setAttribute( 'roomCenter', new BufferAttribute( roomCenter, 3 ) )
	if ( roomSize !== null ) geometry.setAttribute( 'roomSize', new BufferAttribute( roomSize, 2 ) )

	geometry.boundingSphere = new Sphere(
		new Vector3( ( minX + maxX ) / 2, ( minY + maxY ) / 2, ( minZ + maxZ ) / 2 ),
		Math.hypot( maxX - minX, maxY - minY, maxZ - minZ ) / 2
	)

	return geometry

}

// deterministic PRNG (mulberry32) so a given seed always yields the same tower

function createRandom( seed: number ): () => number {

	let s = ( seed >>> 0 ) || 1

	return function () {

		s = ( s + 0x6D2B79F5 ) | 0
		let t = Math.imul( s ^ ( s >>> 15 ), 1 | s )
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296

	}

}

// a stable per-floor hash ( from the floor index and the face origin ) used to pick the
// interior-mapping room module per floor without allocating a closure each floor
function floorHash( f: number, frame: FaceFrame, k: number ): number {

	const s = Math.sin( f * 12.9898 + frame.origin.x * 0.07 + frame.origin.z * 0.131 + k ) * 43758.5453
	return s - Math.floor( s )

}

// the seed-driven "style" of a tower: footprint proportions, tier split and the
// shaping of piers and base arches. these sit between the fixed defaults and the
// caller's parameters, so any parameter passed in still overrides its seeded value.

type SkyscraperSeededStyle = {
	footprint: { width: number; depth: number }
	tierFractions: { base: number; crown: number }
	pierWidth: number
	pierDepth: number
	windowReveal: number
	stringCourseHeight: number
	archBayWidthRatio: number
	archRise: number
	baseStyle: 'arcade' | 'storefront'
}

function randomStyle( random: () => number ): SkyscraperSeededStyle {

	const base = 0.10 + random() * 0.07
	const crown = 0.08 + random() * 0.08

	return {
		footprint: { width: 26 + random() * 18, depth: 20 + random() * 14 },
		tierFractions: { base, crown },
		pierWidth: 0.4 + random() * 0.4,
		pierDepth: 0.3 + random() * 0.3,
		windowReveal: 0.12 + random() * 0.1,
		stringCourseHeight: 0.5 + random() * 0.5,
		archBayWidthRatio: Math.round( 1.5 + random() * 1.5 ),
		archRise: 0.4 + random() * 0.5,
		baseStyle: random() < 0.22 ? 'arcade' : 'storefront' // most towers get retail storefronts; a few take a grand arcade
	}

}

// fixed baseline. the remaining parameters (footprint, tierFractions, pierWidth,
// pierDepth, windowReveal, stringCourseHeight, archBayWidthRatio, archRise) are
// derived from the seed by randomStyle() unless the caller provides them.

/** The fixed baseline a tower starts from before the seeded style and the caller's overrides. */
export interface SkyscraperGeneratorDefaults {
	seed: number
	totalHeight: number
	floorHeight: number
	bayWidth: number
	stringCourseEvery: number
	chamferWidth: number
	chamferCornerX: number
	chamferCornerZ: number
	setbackDepth: number
	acChance: number
}

/** What a caller may pass to {@link SkyscraperGenerator}. */
export type SkyscraperParameters = Partial<SkyscraperGeneratorDefaults> & Partial<SkyscraperSeededStyle> & {
	/**
	 * Bake the glass panes' interior-mapping attributes (`roomCenter` / `roomSize`).
	 * Default `false` — only the dropped TSL material reads them, and they cost 36%
	 * of the tower's vertex data.
	 */
	includeGlassInteriors?: boolean
}

type ResolvedSkyscraperParameters = SkyscraperGeneratorDefaults & SkyscraperSeededStyle & {
	windowHeight: number
	includeGlassInteriors: boolean
}

const SKYSCRAPER_GENERATOR_DEFAULTS: SkyscraperGeneratorDefaults = {
	seed: 35,
	totalHeight: 140,
	floorHeight: 4,
	bayWidth: 2.6,
	stringCourseEvery: 6,
	chamferWidth: 4,
	chamferCornerX: 1,
	chamferCornerZ: 1,
	setbackDepth: 1.5,
	acChance: 0.12
}

// upstream builds the tower with `Object.assign( {}, defaults, randomStyle( random ), parameters )`;
// the seeded style is drawn from the same PRNG stream in the same order, so the result is identical
function resolveSkyscraperParameters( parameters: SkyscraperParameters ): ResolvedSkyscraperParameters {

	const seed = parameters.seed ?? SKYSCRAPER_GENERATOR_DEFAULTS.seed
	const style = randomStyle( createRandom( seed ) )

	return {
		seed,
		totalHeight: parameters.totalHeight ?? SKYSCRAPER_GENERATOR_DEFAULTS.totalHeight,
		floorHeight: parameters.floorHeight ?? SKYSCRAPER_GENERATOR_DEFAULTS.floorHeight,
		bayWidth: parameters.bayWidth ?? SKYSCRAPER_GENERATOR_DEFAULTS.bayWidth,
		stringCourseEvery: parameters.stringCourseEvery ?? SKYSCRAPER_GENERATOR_DEFAULTS.stringCourseEvery,
		chamferWidth: parameters.chamferWidth ?? SKYSCRAPER_GENERATOR_DEFAULTS.chamferWidth,
		chamferCornerX: parameters.chamferCornerX ?? SKYSCRAPER_GENERATOR_DEFAULTS.chamferCornerX,
		chamferCornerZ: parameters.chamferCornerZ ?? SKYSCRAPER_GENERATOR_DEFAULTS.chamferCornerZ,
		setbackDepth: parameters.setbackDepth ?? SKYSCRAPER_GENERATOR_DEFAULTS.setbackDepth,
		acChance: parameters.acChance ?? SKYSCRAPER_GENERATOR_DEFAULTS.acChance,
		footprint: parameters.footprint ?? style.footprint,
		tierFractions: parameters.tierFractions ?? style.tierFractions,
		pierWidth: parameters.pierWidth ?? style.pierWidth,
		pierDepth: parameters.pierDepth ?? style.pierDepth,
		windowReveal: parameters.windowReveal ?? style.windowReveal,
		stringCourseHeight: parameters.stringCourseHeight ?? style.stringCourseHeight,
		archBayWidthRatio: parameters.archBayWidthRatio ?? style.archBayWidthRatio,
		archRise: parameters.archRise ?? style.archRise,
		baseStyle: parameters.baseStyle ?? style.baseStyle,
		windowHeight: 0, // snapped to the brick module inside build()
		includeGlassInteriors: parameters.includeGlassInteriors ?? false
	}

}

/**
 * Generates intricate, tripartite "Beaux-Arts / Neo-Gothic" terracotta
 * skyscrapers from a small set of parameters.
 *
 * The mass is read as a footprint polygon (a rectangle with one chamfered
 * corner) split into vertical faces, each split into three tiers — a tall
 * arcaded base, a repeating shaft and an ornate crown — then into floors and
 * bays. A handful of authored pieces (a pier, a window, a cornice profile, a
 * gothic arch) are instanced across the whole tower, then baked — together with
 * the bespoke base arcade — into a single non-indexed BufferGeometry tagged with
 * a per-vertex `partId` ({@link SKYSCRAPER_PART}) so one material can shade every zone.
 *
 * The generator is material agnostic — it only produces geometry. Pass a single
 * material to dress it.
 *
 * ```ts
 * const generator = new SkyscraperGenerator( { seed: 35, totalHeight: 140 } );
 * scene.add( generator.build() ); // a single Mesh
 * ```
 */
export class SkyscraperGenerator {

	static defaults = SKYSCRAPER_GENERATOR_DEFAULTS

	private parameters: SkyscraperParameters

	private material: Material | null

	private mesh: Mesh<BufferGeometry, Material> | null

	constructor( parameters: SkyscraperParameters = {}, material: Material | null = null ) {

		this.parameters = parameters // caller overrides; defaults + seed fill the rest at build time
		this.material = material // a single material; the look is driven by the baked `partId` attribute

		this.mesh = null

	}

	setParameters( parameters: SkyscraperParameters ): this {

		Object.assign( this.parameters, parameters )

		return this

	}

	build(): Mesh<BufferGeometry, Material> {

		// precedence: fixed defaults < seed-driven style < caller parameters

		const p = resolveSkyscraperParameters( this.parameters )

		// snap the masonry-driving dimensions to the brick module so the procedural
		// brickwork ( courses up local Y, columns along each face ) lines up with the
		// geometry: a whole number of courses per floor and bricks per bay
		const vModule = BRICK.height * 2 // a course pair, so floor / window halves still land on a joint
		p.floorHeight = Math.max( vModule * 3, Math.round( p.floorHeight / vModule ) * vModule )
		p.windowHeight = Math.round( p.floorHeight * WINDOW_HEIGHT_RATIO / vModule ) * vModule
		p.bayWidth = Math.max( BRICK.length * 3, Math.round( p.bayWidth / BRICK.length ) * BRICK.length )
		p.pierWidth = Math.max( BRICK.length, Math.round( p.pierWidth / BRICK.length ) * BRICK.length )

		// vertical layout: base / shaft / crown as whole floor counts, so every floor
		// line sits on a course ( the requested total height is rounded to suit )
		const floors = Math.max( 3, Math.round( p.totalHeight / p.floorHeight ) )
		const baseFloors = Math.max( 1, Math.round( floors * p.tierFractions.base ) )
		const crownFloors = Math.max( 1, Math.round( floors * p.tierFractions.crown ) )
		const shaftFloors = Math.max( 1, floors - baseFloors - crownFloors )

		const baseHeight = baseFloors * p.floorHeight
		const crownHeight = crownFloors * p.floorHeight
		const shaftHeight = shaftFloors * p.floorHeight
		p.totalHeight = baseHeight + shaftHeight + crownHeight

		const baseTop = baseHeight
		const shaftTop = baseHeight + shaftHeight

		// one accumulator per kind of part, mostly instance matrices. kept separate so the
		// bake below can order them by draw order ( which controls overdraw ), not build order.

		const windows: Matrix4[] = []
		const glass: Matrix4[] = []
		const glassRooms: SkyscraperRoom[] = [] // per-glass interior-mapping room ( centre + size ), aligned with `glass`
		const backWalls: Matrix4[] = [] // the thin wall closing the volume behind the glass
		const bands: Matrix4[] = [] // spandrel bands, one at each floor line
		const shopGlass: Matrix4[] = [] // ground-floor display glazing ( scaled unit quads )
		const shopRooms: SkyscraperRoom[] = [] // interior-mapping room per shop, aligned with shopGlass
		const mullions: Matrix4[] = [] // slim shopfront dividers
		const storeBands: Matrix4[] = [] // storefront bulkhead and signboard fascia
		const awnings: Matrix4[] = [] // projecting shop awnings
		const piers = new Map<number, Matrix4[]>() // pier height -> matrices, so each tier's continuous piers share one geometry
		const trim: Matrix4[] = [] // cornices and parapets ( axis-aligned unit boxes )
		const acUnits: Matrix4[] = [] // window air-conditioner boxes on a random subset of shaft windows
		const finials: Matrix4[] = [] // pinnacles along the crown
		const extras: BufferGeometry[] = [] // bespoke geometry: the base arcade and the setback / roof slabs

		const addPier = ( frame: FaceFrame, u: number, vBottom: number, height: number ): void => {

			const key = Math.round( height * 1000 ) // bucket equal pier heights ( a number key, no string )
			const bucket = piers.get( key )
			const matrix = frame.matrix( u, vBottom, 0 )
			if ( bucket === undefined ) piers.set( key, [ matrix ] )
			else bucket.push( matrix )

		}

		// footprints: full mass, and the inset crown after the setback

		const footprint = buildFootprint( p.footprint.width, p.footprint.depth, p.chamferWidth, p.chamferCornerX, p.chamferCornerZ )
		const faces = buildFaces( footprint )

		const inset = p.setbackDepth * p.bayWidth
		const crownFootprint = buildFootprint(
			Math.max( p.bayWidth * 2, p.footprint.width - inset * 2 ),
			Math.max( p.bayWidth * 2, p.footprint.depth - inset * 2 ),
			Math.max( 0, p.chamferWidth - inset ),
			p.chamferCornerX,
			p.chamferCornerZ
		)
		const crownFaces = buildFaces( crownFootprint )

		// --- generate the parts -----------------------------------------------

		const crownCornice = p.stringCourseHeight * 1.6 // the crown's heavy cap; its piers stop below it

		// the street-level retail floor; a few larger towers take a grand arcade instead
		const groundHeight = p.floorHeight
		const useArcade = p.baseStyle === 'arcade' && baseHeight > groundHeight * 1.5

		// shaft and crown are the same facade over different faces, spans and pier heights;
		// the masonry base above the storefront is that facade again
		const tiers: { faces: FaceFrame[]; bottom: number; height: number; pierHeight: number; ac: Matrix4[] | null }[] = [
			{ faces, bottom: baseTop, height: shaftHeight, pierHeight: shaftHeight, ac: acUnits },
			{ faces: crownFaces, bottom: shaftTop, height: crownHeight, pierHeight: crownHeight - crownCornice, ac: null }
		]

		if ( ! useArcade && baseHeight > groundHeight + 0.1 ) {

			tiers.push( { faces, bottom: groundHeight, height: baseHeight - groundHeight, pierHeight: baseHeight - groundHeight, ac: null } )

		}

		for ( const t of tiers ) {

			for ( const frame of t.faces ) {

				addWindows( frame, windows, glass, glassRooms, t.ac, t.bottom, t.height, p )
				addWall( backWalls, frame, t.bottom, t.bottom + t.height, 0.8, - 0.6 )
				addSpandrelBands( bands, frame, t.bottom, t.height, p )
				addPiers( frame, t.bottom, t.pierHeight, p, addPier )

			}

		}

		// the ground floor: NYC retail storefronts, or a grand gothic arcade. either is
		// capped by the base string course
		const storefront: StorefrontParts = { glass: shopGlass, glassRooms: shopRooms, mullions, storeBands, backWalls, awnings, addPier }
		for ( const frame of faces ) {

			if ( useArcade ) addArcade( extras, frame, baseHeight, p )
			else addStorefront( frame, groundHeight, p, storefront )

			addCornice( trim, frame, baseTop - p.stringCourseHeight, p.stringCourseHeight, 0.5 )

		}

		// periodic string courses banding the shaft
		if ( p.stringCourseEvery > 0 ) {

			for ( let f = p.stringCourseEvery; f < shaftFloors; f += p.stringCourseEvery ) {

				for ( const frame of faces ) addCornice( trim, frame, baseTop + f * p.floorHeight - p.stringCourseHeight * 0.5, p.stringCourseHeight, 0.3 )

			}

		}

		// the crown's heavy cornice, its parapet and the finials along the top
		for ( const frame of crownFaces ) {

			addCornice( trim, frame, p.totalHeight - crownCornice, crownCornice, 0.9 )
			addParapet( trim, frame, p.totalHeight, p )
			addFinials( frame, finials, shaftTop, crownHeight, p )

		}

		// thin slabs capping the setback ledge and the roof
		extras.push( slab( footprint, shaftTop, 0.6 ) )
		extras.push( slab( crownFootprint, p.totalHeight, 0.6 ) )

		// --- bake every part into one geometry ---------------------------------

		// one mesh = one draw the renderer can't sort, so bake order is draw order: the
		// facade front-to-back, the backing wall last so its hidden fragments never shade.

		const groups: SkyscraperBakeGroup[] = [
			{ geometry: buildWindowGeometry( p ), matrices: windows, partId: FRAME, rigid: true },
			{ geometry: nonIndexed( buildGlassGeometry( p ) ), matrices: glass, partId: GLASS, rooms: glassRooms, rigid: true },
			{ geometry: _unitPlane, matrices: shopGlass, partId: SHOPGLASS, rooms: shopRooms }, // scaled per shop, so not rigid
			{ geometry: _unitBox, matrices: mullions, partId: FRAME },
			{ geometry: _unitBox, matrices: storeBands, partId: STORE },
			{ geometry: _unitBox, matrices: awnings, partId: AWNING },
			{ geometry: _unitBox, matrices: bands, partId: WALL }
		]

		for ( const [ key, matrices ] of piers ) groups.push( { geometry: buildPierGeometry( p, key / 1000 ), matrices, partId: PIER, rigid: true } )

		groups.push( { geometry: _unitBox, matrices: trim, partId: WALL } ) // cornices, parapets
		groups.push( { geometry: _unitBox, matrices: acUnits, partId: AC } )
		groups.push( { geometry: nonIndexed( buildFinialGeometry( p ) ), matrices: finials, partId: ORNAMENT, rigid: true } )

		for ( const geometry of extras ) groups.push( { geometry: nonIndexed( geometry ), matrices: [ _identity ], partId: WALL, rigid: true } ) // base arcade + slabs, in building-local space

		groups.push( { geometry: _unitBox, matrices: backWalls, partId: WALL } ) // last — hidden behind the facade

		const geometry = bakeGroups( groups, p.includeGlassInteriors )

		const mesh: Mesh<BufferGeometry, Material> = new Mesh( geometry, this.material || new MeshStandardMaterial( { color: 0xddccaa, roughness: 0.9 } ) )
		mesh.name = 'Skyscraper'

		this.dispose()
		this.mesh = mesh

		return mesh

	}

	rebuild(): Mesh<BufferGeometry, Material> {

		return this.build()

	}

	dispose(): void {

		if ( this.mesh === null ) return

		this.mesh.geometry.dispose()
		this.mesh.dispose()
		if ( this.material === null ) this.mesh.material.dispose()

		this.mesh = null

	}

}

// --- footprint & faces ---------------------------------------------------

/**
 * A rectangle (centred at the origin in the XZ plane) with one corner cut at
 * 45 degrees, returned as an ordered list of `Vector2( x, z )`. `cornerX` /
 * `cornerZ` ( each ±1 ) pick which corner is cut, so the chamfer can be aimed
 * outward to a block corner.
 */
function buildFootprint( width: number, depth: number, chamfer: number, cornerX = 1, cornerZ = 1 ): Vector2[] {

	const hw = width / 2
	const hd = depth / 2
	const c = Math.min( chamfer, hw, hd )

	// the four corners, counter-clockwise
	const corners = [
		new Vector2( hw, hd ),
		new Vector2( - hw, hd ),
		new Vector2( - hw, - hd ),
		new Vector2( hw, - hd )
	]

	const points: Vector2[] = []

	for ( let i = 0; i < corners.length; i ++ ) {

		const corner = corners[ i ]!

		// cut the requested corner: replace it with two points pulled back along
		// each adjacent edge, leaving a 45° face that points out to that corner
		if ( c > 0 && Math.sign( corner.x ) === cornerX && Math.sign( corner.y ) === cornerZ ) {

			const prev = corners[ ( i + 3 ) % 4 ]!
			const next = corners[ ( i + 1 ) % 4 ]!
			points.push( corner.clone().lerp( prev, c / corner.distanceTo( prev ) ) )
			points.push( corner.clone().lerp( next, c / corner.distanceTo( next ) ) )

		} else {

			points.push( corner.clone() )

		}

	}

	return points

}

/**
 * Builds a face frame per footprint edge. Each frame is an orthonormal basis
 * ( u along the edge, v up, n outward ) plus an origin and length, so all
 * facade layout can happen in flat ( u, v ) space and bake to world with one
 * matrix — the same authored piece then instances onto every face, including
 * the diagonal chamfer.
 */
function buildFaces( points: Vector2[] ): FaceFrame[] {

	const faces: FaceFrame[] = []
	const up = new Vector3( 0, 1, 0 )

	for ( let i = 0; i < points.length; i ++ ) {

		const a = points[ i ]!
		const b = points[ ( i + 1 ) % points.length ]!

		// outward normal: perpendicular to the edge, pointing away from the
		// origin (the footprint is centred there)

		const n = new Vector3( b.y - a.y, 0, - ( b.x - a.x ) ).normalize()
		const mid = new Vector3( ( a.x + b.x ) / 2, 0, ( a.y + b.y ) / 2 )
		if ( n.dot( mid ) < 0 ) n.negate()

		// right-handed basis: u = v × n, so makeBasis( u, v, n ) is a pure rotation

		const u = new Vector3().crossVectors( up, n ).normalize()

		const pa = new Vector3( a.x, 0, a.y )
		const pb = new Vector3( b.x, 0, b.y )
		const length = pa.distanceTo( pb )

		// the edge end that u points away from becomes the origin

		const origin = pb.clone().sub( pa ).dot( u ) > 0 ? pa : pb

		faces.push( new FaceFrame( origin, u, up.clone(), n, length ) )

	}

	return faces

}

/** A face's local ( u along edge, v up, n outward ) frame in world space. */
class FaceFrame {

	readonly origin: Vector3

	readonly u: Vector3

	readonly v: Vector3

	readonly n: Vector3

	readonly length: number

	constructor( origin: Vector3, u: Vector3, v: Vector3, n: Vector3, length: number ) {

		this.origin = origin
		this.u = u
		this.v = v
		this.n = n
		this.length = length

	}

	point( u: number, v: number, w: number, target = new Vector3() ): Vector3 {

		return target
			.copy( this.origin )
			.addScaledVector( this.u, u )
			.addScaledVector( this.v, v )
			.addScaledVector( this.n, w )

	}

	/** Places a piece authored in the canonical local frame ( x across, y up, z outward ). */
	matrix( u: number, v: number, w: number ): Matrix4 {

		return new Matrix4()
			.makeBasis( this.u, this.v, this.n )
			.setPosition( this.point( u, v, w, _point ) )

	}

	/** How many bays of `bayWidth` fit, with the remainder split into end margins. */
	bays( bayWidth: number ): { count: number; margin: number; width: number } {

		const count = Math.max( 1, Math.floor( this.length / bayWidth ) )
		const margin = ( this.length - count * bayWidth ) / 2

		return { count, margin, width: bayWidth }

	}

}

// --- shell pieces --------------------------------------------------------

// a Matrix4 mapping the shared unit box ( 1×1×1, centred ) onto a face-aligned
// box of the given size, centred at the given face-local point.
function boxMatrix( frame: FaceFrame, u: number, v: number, w: number, sizeU: number, sizeV: number, sizeN: number ): Matrix4 {

	return new Matrix4()
		.makeBasis( frame.u, frame.v, frame.n )
		.scale( _scale.set( sizeU, sizeV, sizeN ) )
		.setPosition( frame.point( u, v, w, _point ) )

}

function addWall( target: Matrix4[], frame: FaceFrame, vBottom: number, vTop: number, thickness = 0.8, front = 0 ): void {

	const h = vTop - vBottom
	target.push( boxMatrix( frame, frame.length / 2, vBottom + h / 2, front - thickness / 2, frame.length + thickness * 2, h, thickness ) )

}

/**
 * Horizontal terracotta bands at every floor line. Together with the projecting
 * piers they form the facade grid; the gaps between them are the window
 * openings, with glass set behind.
 */
function addSpandrelBands( target: Matrix4[], frame: FaceFrame, vBottom: number, height: number, p: ResolvedSkyscraperParameters ): void {

	const floors = Math.max( 1, Math.round( height / p.floorHeight ) )
	const fh = height / floors
	const bandHeight = p.floorHeight - p.windowHeight // whole courses: floor minus the glazed opening

	// pull the ends in by the band depth so a band doesn't poke its end-cap
	// into the plane of the perpendicular face at the corners ( overdraw )
	const bandLength = Math.max( 0.2, frame.length - 0.6 )

	const vTop = vBottom + height

	for ( let f = 0; f <= floors; f ++ ) {

		// the end bands ( f = 0 / f = floors ) are centred on the tier boundary; clamp
		// them so they don't extend into the neighbouring tier
		const center = vBottom + f * fh
		const top = Math.min( center + bandHeight / 2, vTop )
		const bottom = Math.max( center - bandHeight / 2, vBottom )
		const h = top - bottom
		if ( h <= 0 ) continue

		// front flush at w = 0, meeting the backing wall behind
		target.push( boxMatrix( frame, frame.length / 2, ( top + bottom ) / 2, - 0.3, bandLength, h, 0.6 ) )

	}

}

/**
 * A thin horizontal cap over a footprint's bounding box at height `y`. Its
 * sides are pulled in behind the facade plane ( into the backing-wall shell )
 * so they never sit coplanar with the walls, spandrels or piers and z-fight.
 */
function slab( footprint: Vector2[], y: number, thickness: number ): BufferGeometry {

	// a thin cap following the footprint OUTLINE ( so the chamfered corner is cut, not
	// left overhanging as a rectangular box ), inset a little so its edge tucks just
	// behind the facade and the wall top reads as a lip around it

	const inset = 0.8
	let cx = 0, cz = 0
	for ( const p of footprint ) {

		cx += p.x; cz += p.y

	}

	cx /= footprint.length; cz /= footprint.length

	// consistent ( CCW ) winding so the extrude caps face up / down correctly
	let area = 0
	for ( let i = 0; i < footprint.length; i ++ ) {

		const a = footprint[ i ]!, b = footprint[ ( i + 1 ) % footprint.length ]!
		area += a.x * b.y - b.x * a.y

	}

	const pts = area < 0 ? footprint.slice().reverse() : footprint

	const shape = new Shape()
	pts.forEach( ( p, i ) => {

		const dx = cx - p.x, dz = cz - p.y
		const d = Math.hypot( dx, dz ) || 1
		const x = p.x + dx / d * inset
		const z = p.y + dz / d * inset
		if ( i === 0 ) shape.moveTo( x, z ); else shape.lineTo( x, z )

	} )

	// extrude the XZ outline downward by the thickness, the top dropped just below height y:
	// the inset cap would otherwise sit coplanar with the surrounding wall top faces and
	// z-fight, and the parapet / spandrel bands around the edge hide the shallow recess
	const drop = 0.2
	const geometry = new ExtrudeGeometry( shape, { depth: thickness, bevelEnabled: false } )
	geometry.rotateX( Math.PI / 2 )
	geometry.translate( 0, y - drop, 0 )
	return geometry

}

/** A two-step projecting cornice / string-course band wrapping a face. */
function addCornice( target: Matrix4[], frame: FaceFrame, vBottom: number, height: number, depth: number ): void {

	target.push( boxMatrix( frame, frame.length / 2, vBottom + height * 0.275, depth / 2, frame.length, height * 0.55, depth ) )
	target.push( boxMatrix( frame, frame.length / 2, vBottom + height * 0.775, depth * 0.85, frame.length, height * 0.45, depth * 1.7 ) )

}

/** A low parapet wall capping the crown. */
function addParapet( target: Matrix4[], frame: FaceFrame, vTop: number, p: ResolvedSkyscraperParameters ): void {

	const height = 1.4
	target.push( boxMatrix( frame, frame.length / 2, vTop + height / 2, p.pierDepth * 0.4, frame.length, height, p.pierDepth * 0.8 ) )

}

// the arch openings' inner reveal walls, each hole outline swept back to the wall
// thickness; holes wind clockwise, so an edge's inward normal is ( dy, -dx )
function buildArchReveals( holes: Path[], depth: number, curveSegments: number ): BufferGeometry {

	const positions: number[] = [], normals: number[] = [], uvs: number[] = []

	for ( const hole of holes ) {

		const points = hole.getPoints( curveSegments )

		for ( let i = 0; i < points.length - 1; i ++ ) {

			const a = points[ i ]!, b = points[ i + 1 ]!
			const dx = b.x - a.x, dy = b.y - a.y
			const inv = 1 / ( Math.hypot( dx, dy ) || 1 )
			const nx = dy * inv, ny = - dx * inv

			// the two triangles of the quad a → b, both facing into the opening
			positions.push( a.x, a.y, 0, a.x, a.y, - depth, b.x, b.y, - depth )
			positions.push( a.x, a.y, 0, b.x, b.y, - depth, b.x, b.y, 0 )

			for ( let v = 0; v < 6; v ++ ) {

				normals.push( nx, ny, 0 )
				uvs.push( 0, 0 )

			}

		}

	}

	const geometry = new BufferGeometry()
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( positions ), 3 ) )
	geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( normals ), 3 ) )
	geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( uvs ), 2 ) )
	return geometry

}

/**
 * The base storey: a wall pierced by tall pointed-arch openings, built as a flat front
 * face and the openings' reveals so they read as deep recesses.
 */
function addArcade( target: BufferGeometry[], frame: FaceFrame, height: number, p: ResolvedSkyscraperParameters ): void {

	const archWidth = p.bayWidth * p.archBayWidthRatio
	const { count, margin } = frame.bays( archWidth )

	const sill = height * 0.04
	const spring = height * 0.55
	const apex = Math.min( height * 0.96, spring + ( archWidth / 2 ) * ( 0.8 + p.archRise ) )

	const shape = new Shape()
	shape.moveTo( 0, 0 )
	shape.lineTo( frame.length, 0 )
	shape.lineTo( frame.length, height )
	shape.lineTo( 0, height )
	shape.lineTo( 0, 0 )

	for ( let i = 0; i < count; i ++ ) {

		const cx = margin + ( i + 0.5 ) * archWidth
		const hw = archWidth * 0.34

		const hole = new Path()
		hole.moveTo( cx - hw, sill )
		hole.lineTo( cx - hw, spring )
		hole.quadraticCurveTo( cx - hw, apex, cx, apex )
		hole.quadraticCurveTo( cx + hw, apex, cx + hw, spring )
		hole.lineTo( cx + hw, sill )
		hole.lineTo( cx - hw, sill )
		shape.holes.push( hole )

	}

	const thickness = 1.1
	const curveSegments = 8

	// flat front face plus the swept reveals; the openings show through to the dark plane behind
	const front = new ShapeGeometry( shape, curveSegments )
	const reveals = buildArchReveals( shape.holes, thickness, curveSegments )
	const geometry = merge( [ front, reveals ] )
	geometry.applyMatrix4( frame.matrix( 0, 0, 0 ) )

	target.push( geometry )

	// a dark plane set behind the openings so the recesses read

	const back = new PlaneGeometry( frame.length, height )
	back.applyMatrix4( frame.matrix( frame.length / 2, height / 2, - thickness - 0.4 ) )
	target.push( back )

}

/** The part accumulators {@link addStorefront} writes its pieces into. */
type StorefrontParts = {
	glass: Matrix4[]
	glassRooms: SkyscraperRoom[]
	mullions: Matrix4[]
	storeBands: Matrix4[]
	backWalls: Matrix4[]
	awnings: Matrix4[]
	addPier: ( frame: FaceFrame, u: number, vBottom: number, height: number ) => void
}

/**
 * The street-level retail front: glazed shopfronts on a low bulkhead, under a
 * signboard fascia, framed by the building's ground-floor piers and split by slim
 * mullions, with a projecting awning over some shops. Reads as a row of NYC
 * storefronts. All pieces are pushed into the caller's `parts` accumulators.
 */
function addStorefront( frame: FaceFrame, height: number, p: ResolvedSkyscraperParameters, parts: StorefrontParts ): void {

	const bulkhead = 0.5 // the solid kickplate the glazing stands on
	const fascia = Math.min( 0.9, height * 0.22 ) // the signboard band above the glass
	const glassBottom = bulkhead
	const glassHeight = height - fascia - bulkhead

	const len = frame.length

	// a stone bulkhead and a projecting signboard band run the full face
	parts.storeBands.push( boxMatrix( frame, len / 2, bulkhead / 2, 0, len, bulkhead, 0.55 ) )
	parts.storeBands.push( boxMatrix( frame, len / 2, height - fascia / 2, 0.08, len, fascia, 0.72 ) )

	// the shop interior wall behind the glazing
	addWall( parts.backWalls, frame, 0, height, 0.8, - 0.6 )

	// shopfronts are wider than the window bays above, so group bays into ~4 m shops
	const shopWidth = Math.max( 4, p.bayWidth * 2 )
	const { count, margin, width } = frame.bays( shopWidth )

	for ( let i = 0; i < count; i ++ ) {

		const x0 = margin + i * width
		const cx = x0 + width / 2

		// a structural pier at each shopfront edge, full ground-floor height ( the far
		// end is the shared corner the next face piers, like addPiers )
		parts.addPier( frame, x0, 0, height )

		// the display glazing for this shop, set back behind the frame, with the
		// interior-mapping room it looks into ( one shop-wide, ground-floor-tall box )
		const reveal = 0.18
		const gw = width - p.pierWidth - 0.12
		const cy = glassBottom + glassHeight / 2
		parts.glass.push( boxMatrix( frame, cx, cy, - reveal, gw, glassHeight, 1 ) )
		parts.glassRooms.push( { center: frame.point( cx, cy, - reveal ), size: new Vector2( gw, glassHeight ) } )

		// two slim mullions dividing the shopfront into three lights
		parts.mullions.push( boxMatrix( frame, x0 + width / 3, glassBottom + glassHeight / 2, 0, 0.08, glassHeight, 0.16 ) )
		parts.mullions.push( boxMatrix( frame, x0 + width * 2 / 3, glassBottom + glassHeight / 2, 0, 0.08, glassHeight, 0.16 ) )

		// an awning over roughly half the shops, projecting from below the signboard
		const r = Math.sin( i * 23.7 + frame.origin.x * 0.21 + frame.origin.z * 0.11 ) * 43758.5453
		if ( r - Math.floor( r ) < 0.5 ) {

			const depth = 1.3
			parts.awnings.push( boxMatrix( frame, cx, height - fascia - 0.12, depth / 2 + 0.05, width - 0.3, 0.14, depth ) )

		}

	}

}

// --- repeating field -----------------------------------------------------

function addPiers(
	frame: FaceFrame,
	vBottom: number,
	height: number,
	p: ResolvedSkyscraperParameters,
	addPier: ( frame: FaceFrame, u: number, vBottom: number, height: number ) => void
): void {

	const { count, margin, width } = frame.bays( p.bayWidth )

	// a pier on every bay edge except the far end: that corner is shared with
	// the next face, which places its own pier there, so emitting both would
	// stack two piers at each corner

	for ( let i = 0; i < count; i ++ ) {

		addPier( frame, margin + i * width, vBottom, height )

	}

}

function addWindows(
	frame: FaceFrame,
	windows: Matrix4[],
	glass: Matrix4[],
	glassRooms: SkyscraperRoom[],
	acUnits: Matrix4[] | null,
	vBottom: number,
	height: number,
	p: ResolvedSkyscraperParameters
): void {

	const { count, margin, width } = frame.bays( p.bayWidth )
	const floors = Math.max( 1, Math.round( height / p.floorHeight ) )
	const fh = height / floors

	// a window AC unit sitting on the sill, protruding from the facade. about half the window
	// width, capped at a real unit's size ( ~0.66 m ) and kept wider than tall, sticking out
	// about half its width
	const acW = Math.min( ( p.bayWidth - p.pierWidth ) * 0.55, 0.66 )
	const acH = acW * 0.6
	const acD = acW * 0.5
	const acV = - p.windowHeight / 2 + acH / 2 + WINDOW_BORDER // bottom rests on the sill ( the top of the window's bottom frame rail )

	// a real ~0.66 m unit looks lost in a wide opening, so only fit ACs where it still spans a
	// fair share of the window — in practice, the narrower ( older-style ) windows
	const acFits = acW >= ( width - p.pierWidth ) * 0.34

	for ( let f = 0; f < floors; f ++ ) {

		const cy = vBottom + ( f + 0.5 ) * fh

		// the interior-mapping room module: one floor tall, a run of two or three bays
		// wide, chosen per floor so neighbouring windows share an interior. the choice
		// is deterministic ( seeded by the floor and the face ) so it is stable, and the
		// run is recorded per window so the material can ray-march the right box.
		const roomBays = floorHash( f, frame, 0 ) > 0.5 ? 3 : 2
		const roomPhase = Math.floor( floorHash( f, frame, 1 ) * roomBays )

		for ( let b = 0; b < count; b ++ ) {

			const cx = margin + ( b + 0.5 ) * width

			windows.push( frame.matrix( cx, cy, 0 ) )
			glass.push( frame.matrix( cx, cy, - p.windowReveal ) )

			// the run of bays this window's room spans, clamped at the face ends, recorded
			// as the room's centre on the facade and its width × height in metres
			const room = Math.floor( ( b + roomPhase ) / roomBays )
			const bStart = Math.max( 0, room * roomBays - roomPhase )
			const bEnd = Math.min( count, ( room + 1 ) * roomBays - roomPhase )
			const span = bEnd - bStart
			glassRooms.push( { center: frame.point( margin + ( bStart + span / 2 ) * width, cy, - p.windowReveal ), size: new Vector2( span * width, fh - 1 ) } ) // centred on the glass plane, so the interior is anchored to the pane it is drawn on

			if ( acUnits && acFits ) {

				// deterministic per-window hash ( varies per face via the frame origin )
				const r = Math.sin( f * 41.3 + b * 12.7 + frame.origin.x * 0.13 + frame.origin.z * 0.31 ) * 43758.5453
				// the back tucks into the window reveal ( just in front of the glass ) so the unit sits
				// in the opening instead of floating on the facade
				const acW0 = acD / 2 - p.windowReveal + 0.04
				if ( r - Math.floor( r ) < p.acChance ) acUnits.push( boxMatrix( frame, cx, cy + acV, acW0, acW, acH, acD ) )

			}

		}

	}

}

function addFinials( frame: FaceFrame, finials: Matrix4[], vBottom: number, height: number, p: ResolvedSkyscraperParameters ): void {

	const { count, margin, width } = frame.bays( p.bayWidth )
	const top = vBottom + height

	// skip the far-end bay edge: it is the shared corner the next face also
	// caps, so emitting both would stack two finials at each corner

	for ( let i = 0; i < count; i ++ ) {

		finials.push( new Matrix4().setPosition( frame.point( margin + i * width, top, p.pierDepth * 0.5, _point ) ) )

	}

}

// --- authored modules ----------------------------------------------------

function buildPierGeometry( p: ResolvedSkyscraperParameters, height: number ): BufferGeometry {

	// a wide pier with a slimmer pilaster raised on its face, giving the
	// continuous vertical rib a stepped, terracotta profile

	const back = new BoxGeometry( p.pierWidth, height, p.pierDepth * 0.6 )
	back.translate( 0, height / 2, p.pierDepth * 0.3 )

	// the pilaster stops just short of the pier top so that where a pier is left
	// exposed ( at a setback ) the cap reads as one clean block rather than the
	// back box and the pilaster stacked into a T
	const pilasterHeight = Math.max( 1, height - 0.6 )
	const front = new BoxGeometry( p.pierWidth * 0.55, pilasterHeight, p.pierDepth * 0.45 )
	front.translate( 0, pilasterHeight / 2, p.pierDepth * 0.6 + p.pierDepth * 0.225 )

	return merge( [ back, front ] )

}

function buildWindowGeometry( p: ResolvedSkyscraperParameters ): BufferGeometry {

	// the flat frame face ( a rectangle with the glazing hole ), the four reveal walls
	// of the opening and the glazing bars, merged into one instanced module. a full
	// extrusion would also emit a hidden back cap and outer side walls; windows are by
	// far the heaviest part of a building, so those are skipped.

	const w = p.bayWidth - p.pierWidth
	const h = p.windowHeight
	const border = WINDOW_BORDER
	const depth = p.windowReveal // reveal walls run all the way back to the glass ( placed at -windowReveal ), so no gap opens between them and the pane
	const iw = w / 2 - border
	const ih = h / 2 - border

	const shape = new Shape()
	shape.moveTo( - w / 2, - h / 2 )
	shape.lineTo( w / 2, - h / 2 )
	shape.lineTo( w / 2, h / 2 )
	shape.lineTo( - w / 2, h / 2 )
	shape.lineTo( - w / 2, - h / 2 )

	const hole = new Path()
	hole.moveTo( - iw, - ih )
	hole.lineTo( - iw, ih )
	hole.lineTo( iw, ih )
	hole.lineTo( iw, - ih )
	hole.lineTo( - iw, - ih )
	shape.holes.push( hole )

	const front = new ShapeGeometry( shape ) // visible frame face, flush with the facade

	// the four reveal walls of the opening, set back to the glazing
	const wall = ( x: number, y: number, rx: number, ry: number, sw: number, sh: number ): PlaneGeometry => {

		const pl = new PlaneGeometry( sw, sh )
		pl.rotateX( rx )
		pl.rotateY( ry )
		pl.translate( x, y, - depth / 2 )
		return pl

	}

	const left = wall( - iw, 0, 0, Math.PI / 2, depth, ih * 2 )
	const right = wall( iw, 0, 0, - Math.PI / 2, depth, ih * 2 )
	const sill = wall( 0, - ih, - Math.PI / 2, 0, iw * 2, depth )
	const head = wall( 0, ih, Math.PI / 2, 0, iw * 2, depth )

	// a single horizontal glazing bar ( transom ), flat, just in front of the glass —
	// a thin box would triple the window's triangle count for sub-pixel thickness
	const transom = new PlaneGeometry( iw * 2, 0.05 )
	transom.translate( 0, h * 0.04, - depth + 0.02 ) // meeting rail, just above centre

	return merge( [ front, left, right, sill, head, transom ] )

}

function buildGlassGeometry( p: ResolvedSkyscraperParameters ): PlaneGeometry {

	const w = p.bayWidth - p.pierWidth - WINDOW_BORDER * 2
	const h = p.windowHeight - WINDOW_BORDER * 2

	return new PlaneGeometry( w, h )

}

function buildFinialGeometry( p: ResolvedSkyscraperParameters ): LatheGeometry {

	// a tapering pinnacle revolved around its axis

	const s = p.pierWidth
	const profile = [
		new Vector2( 0.0, 0 ),
		new Vector2( s * 0.9, 0 ),
		new Vector2( s * 0.9, s * 0.4 ),
		new Vector2( s * 0.55, s * 1.0 ),
		new Vector2( 0.0, s * 3.2 )
	]

	return new LatheGeometry( profile, 8 ) // round enough to read as a smooth pinnacle, still light

}

// --- per-tower palette ---------------------------------------------------

/** The per-tower masonry palette ( the same list the upstream TSL material samples ). */
export const buildingPalette = [
	0xa8553c, 0x9c4a34, // terracotta & red brick ( occasional accent )
	0x8a6a52, 0x7d6450, // warm brick / brownstone ( muted )
	0xc4a370, 0xb89a6f, 0xc2b183, // buff / tan
	0xc6c0b2, 0xc6c0b2, 0xbdb7a8, 0xd1ccbe, 0xb4afa1, // limestone / pale dressed stone — the common default
	0x9a988f, 0x8b8983, 0xa5a39a, // grey granite / concrete
	0xdbd6cb, // pale glazed ( accent )
	0x7c868d // steel / glass ( cool accent )
]

/** Picks one {@link buildingPalette} colour ( a hex number ) for a tower from its seed. */
export function pickBuildingColor( seed: number ): number {

	const h = Math.abs( Math.sin( seed * 12.9898 ) * 43758.5453 )
	return buildingPalette[ Math.floor( ( h - Math.floor( h ) ) * buildingPalette.length ) ]!

}
