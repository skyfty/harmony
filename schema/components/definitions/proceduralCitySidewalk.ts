/**
 * The raised sidewalk of each block: a rounded-corner concrete slab rimmed by a
 * granite kerbstone that stands proud of the walking surface and drops to the road.
 *
 * A WebGL port of `SidewalkGenerator` from three's r180 city generators ( MIT
 * License, https://github.com/mrdoob/three.js ). Upstream owns both the geometry
 * and a pair of TSL node materials; here the geometry is the same CPU
 * `ExtrudeGeometry` construction, the materials are the same look written as
 * GLSL over a stock `MeshStandardMaterial`. As with the road, the sub-centimetre
 * height-field normal term is the one part not ported.
 */

import * as THREE from 'three'
import type { ProceduralCityBlockLayout } from './proceduralCityBlock'
import { applyCitySurfaceShader, toGlslColor, toGlslFloat } from './proceduralCityGlsl'

const SIDEWALK_CONCRETE_DARK = 0x6f6f68
const SIDEWALK_CONCRETE_LIGHT = 0x8c8c82
const SIDEWALK_CURB_DARK = 0x46463f
const SIDEWALK_CURB_LIGHT = 0x5c5c54

/** The concrete flag size (~5 ft NYC sidewalk flags) and the scored joint width. */
const CONCRETE_PANEL = 1.5
const CONCRETE_JOINT_HALF_WIDTH = 0.045

/** The kerbstone segment length and its joint width. */
const CURB_SEGMENT = 1.5
const CURB_JOINT_HALF_WIDTH = 0.04

/** How far the surface detail resolves. */
const SIDEWALK_DETAIL_NEAR = 18
const SIDEWALK_DETAIL_FAR = 200

/** The sidewalk profile, mirroring `SidewalkGenerator.defaults` for the block-sized case. */
export type ProceduralCitySidewalkOptions = {
	/** Walking-surface height above the road. */
	curbHeight?: number
	/** Corner radius, so the sidewalk turns each intersection instead of a hard 90°. */
	curbRadius?: number
	/** Top width of the granite kerbstone rimming the block (~5 in). */
	curbWidth?: number
	/** How far the curb stands proud of the walking surface (near-flush). */
	curbLip?: number
}

export const PROCEDURAL_CITY_SIDEWALK_DEFAULTS = {
	curbHeight: 0.15,
	curbRadius: 5,
	curbWidth: 0.13,
	curbLip: 0.01
}

// --- geometry ------------------------------------------------------------

// the block footprint as a rounded-corner rectangle ( centred at the origin ), so the
// sidewalk turns each intersection instead of meeting the kerb at a hard 90°
function roundedRect( width: number, depth: number, radius: number ): THREE.Shape {

	const w = width / 2
	const d = depth / 2
	const r = Math.min( radius, w, d )

	const shape = new THREE.Shape()
	shape.moveTo( - w + r, - d )
	shape.lineTo( w - r, - d )
	shape.quadraticCurveTo( w, - d, w, - d + r )
	shape.lineTo( w, d - r )
	shape.quadraticCurveTo( w, d, w - r, d )
	shape.lineTo( - w + r, d )
	shape.quadraticCurveTo( - w, d, - w, d - r )
	shape.lineTo( - w, - d + r )
	shape.quadraticCurveTo( - w, - d, - w + r, - d )

	return shape

}

// extrude a footprint outline up by `height` ( the extrusion runs +Z; stand it up so height is +Y )
function extrudeUp( shape: THREE.Shape, height: number ): THREE.BufferGeometry {

	const geometry = new THREE.ExtrudeGeometry( shape, { depth: height, bevelEnabled: false, curveSegments: 6 } )
	geometry.rotateX( - Math.PI / 2 )

	return geometry

}

// the walking slab: the inner concrete surface, inset to sit inside the curb and
// overlapping it slightly so the seam is buried. base at y = 0, surface at `height`.
export function createProceduralCitySidewalkSlabGeometry(
	width: number,
	depth: number,
	height: number,
	radius: number,
	curbWidth: number
): THREE.BufferGeometry {

	const innerRadius = Math.max( 0.5, radius - curbWidth )
	return extrudeUp( roundedRect( width - 2 * curbWidth + 0.06, depth - 2 * curbWidth + 0.06, innerRadius ), height )

}

// the curb: a distinct full-height kerbstone band rimming the block ( the outline
// with an inset hole ), standing proud of the slab and dropping to the road
export function createProceduralCitySidewalkCurbGeometry(
	width: number,
	depth: number,
	height: number,
	radius: number,
	curbWidth: number,
	curbLip: number
): THREE.BufferGeometry {

	const innerRadius = Math.max( 0.5, radius - curbWidth )
	const shape = roundedRect( width, depth, radius )
	shape.holes.push( roundedRect( width - 2 * curbWidth, depth - 2 * curbWidth, innerRadius ) )
	return extrudeUp( shape, height + curbLip )

}

// --- material ------------------------------------------------------------

// concrete flags: each poured slab a slightly different tone, fine aggregate
// speckle and expansion joints scored on a grid both ways
export function createProceduralCitySidewalkMaterial(): THREE.MeshStandardMaterial {

	const body = `
	vec3 cityWorld = vCityWorldPosition;
	float cityDetail = smoothstep( ${toGlslFloat( SIDEWALK_DETAIL_FAR )}, ${toGlslFloat( SIDEWALK_DETAIL_NEAR )}, distance( cityWorld, cameraPosition ) );

	float cityPanel = ${toGlslFloat( CONCRETE_PANEL )};
	float cityPanelHash = fract( sin( floor( cityWorld.x / cityPanel ) * 127.1 + floor( cityWorld.z / cityPanel ) * 311.7 ) * 43758.5453 );
	float cityTone = cityValueNoise( cityWorld * 0.5 ) * 0.5 + 0.5;

	float cityGrit = 0.0;
	if ( cityDetail > 0.0001 ) cityGrit = cityValueNoise( cityWorld * 14.0 ) * 0.07 * cityDetail;

	vec3 cityBase = mix( ${toGlslColor( new THREE.Color( SIDEWALK_CONCRETE_DARK ) )}, ${toGlslColor( new THREE.Color( SIDEWALK_CONCRETE_LIGHT ) )}, cityTone ) * ( ( cityPanelHash - 0.5 ) * 0.16 + 1.0 ); // per-flag tone
	vec3 cityConcrete = cityBase + cityGrit;

	float cityJoints = max( cityGridLine( cityWorld.x, cityPanel, ${toGlslFloat( CONCRETE_JOINT_HALF_WIDTH )} ), cityGridLine( cityWorld.z, cityPanel, ${toGlslFloat( CONCRETE_JOINT_HALF_WIDTH )} ) ) * cityDetail;

	vec3 cityColor = cityConcrete * ( 1.0 - cityJoints * 0.45 );
	float cityRoughness = 0.92 - cityPanelHash * 0.05;
	`

	const material = new THREE.MeshStandardMaterial()
	applyCitySurfaceShader( material, { cacheKey: 'procedural-city-sidewalk', body } )

	return material

}

// granite kerbstone: a dense, cool grey stone — darker and smoother than the
// concrete flags — with a fine speckle, segment joints every ~1.5 m and a
// grimier road-facing face
export function createProceduralCityCurbMaterial(): THREE.MeshStandardMaterial {

	const body = `
	vec3 cityWorld = vCityWorldPosition;
	float cityDetail = smoothstep( ${toGlslFloat( SIDEWALK_DETAIL_FAR )}, ${toGlslFloat( SIDEWALK_DETAIL_NEAR )}, distance( cityWorld, cameraPosition ) );

	float cityTone = cityValueNoise( cityWorld * 0.6 ) * 0.5 + 0.5;
	vec3 cityStone = mix( ${toGlslColor( new THREE.Color( SIDEWALK_CURB_DARK ) )}, ${toGlslColor( new THREE.Color( SIDEWALK_CURB_LIGHT ) )}, cityTone );
	if ( cityDetail > 0.0001 ) cityStone += cityValueNoise( cityWorld * 18.0 ) * 0.05 * cityDetail;

	float citySegment = ${toGlslFloat( CURB_SEGMENT )};
	float cityJoints = max( cityGridLine( cityWorld.x, citySegment, ${toGlslFloat( CURB_JOINT_HALF_WIDTH )} ), cityGridLine( cityWorld.z, citySegment, ${toGlslFloat( CURB_JOINT_HALF_WIDTH )} ) ) * cityDetail;
	float cityTop = smoothstep( 0.5, 0.85, vCityWorldNormal.y ); // 1 on the curb top, 0 on its walls

	vec3 cityColor = mix( cityStone * 0.7, cityStone, cityTop ) * ( 1.0 - cityJoints * 0.4 ); // grimier on the road-facing face
	float cityRoughness = 0.7 + cityTone * 0.1; // flamed granite: matte, a touch smoother than the concrete
	`

	const material = new THREE.MeshStandardMaterial()
	applyCitySurfaceShader( material, { cacheKey: 'procedural-city-curb', body } )

	return material

}

// the two materials are layout independent, so one pair lives for the module's
// lifetime — the same lifetime policy the wall material uses
let sidewalkMaterial: THREE.MeshStandardMaterial | null = null
let curbMaterial: THREE.MeshStandardMaterial | null = null

/** Builds the instanced slab + curb pair for `placements` ( one per block ). */
export function buildProceduralCitySidewalkGroup(
	layout: ProceduralCityBlockLayout,
	placements: THREE.Matrix4[],
	options: ProceduralCitySidewalkOptions = {}
): THREE.Group {

	const curbHeight = options.curbHeight ?? PROCEDURAL_CITY_SIDEWALK_DEFAULTS.curbHeight
	const curbRadius = options.curbRadius ?? PROCEDURAL_CITY_SIDEWALK_DEFAULTS.curbRadius
	const curbWidth = options.curbWidth ?? PROCEDURAL_CITY_SIDEWALK_DEFAULTS.curbWidth
	const curbLip = options.curbLip ?? PROCEDURAL_CITY_SIDEWALK_DEFAULTS.curbLip
	const count = Math.max( 1, placements.length )

	sidewalkMaterial ??= createProceduralCitySidewalkMaterial()
	curbMaterial ??= createProceduralCityCurbMaterial()

	const slab = new THREE.InstancedMesh(
		createProceduralCitySidewalkSlabGeometry( layout.blockW, layout.blockD, curbHeight, curbRadius, curbWidth ),
		sidewalkMaterial,
		count
	)
	slab.name = 'SidewalkSlab'

	const curb = new THREE.InstancedMesh(
		createProceduralCitySidewalkCurbGeometry( layout.blockW, layout.blockD, curbHeight, curbRadius, curbWidth, curbLip ),
		curbMaterial,
		count
	)
	curb.name = 'SidewalkCurb'

	for ( const mesh of [ slab, curb ] ) {

		mesh.count = placements.length
		mesh.visible = placements.length > 0
		mesh.castShadow = false
		mesh.receiveShadow = true

		for ( let index = 0; index < placements.length; index ++ ) mesh.setMatrixAt( index, placements[ index ]! )
		mesh.instanceMatrix.needsUpdate = true
		mesh.computeBoundingSphere()

	}

	const group = new THREE.Group()
	group.name = 'Sidewalk'
	group.add( slab, curb )

	return group

}

/** Disposes a {@link buildProceduralCitySidewalkGroup} result ( the materials are shared ). */
export function disposeProceduralCitySidewalkGroup( group: THREE.Group ): void {

	group.traverse( ( object ) => {

		const mesh = object as THREE.Mesh
		mesh.geometry?.dispose()

	} )

	group.clear()

}
