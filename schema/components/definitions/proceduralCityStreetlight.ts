/**
 * A NYC cobra-head streetlight: a tall tapered mast standing at the curb with a
 * curved arm reaching out over the roadway to a drop luminaire.
 *
 * A WebGL port of `StreetlightGenerator.js` from three's r180 city generators
 * ( MIT License, https://github.com/mrdoob/three.js ). The geometry is the same
 * CPU construction the upstream generator bakes; its TSL material — one shader
 * branching on the baked `partId` between dark metal and a pale lamp lens — is
 * written here as GLSL over a stock `MeshStandardMaterial`.
 *
 * The canonical model stands on `y = 0`, centred in X / Z, with the arm reaching
 * toward `+Z`, so a placement whose local `+Z` faces the road throws the lamp
 * over it.
 */

import { BoxGeometry, Color, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { applyCitySurfaceShader, toGlslColor } from './proceduralCityGlsl'
import { part } from './proceduralCityPartGeometry'

/** The material-zone codes baked per vertex into the merged model. */
export const STREETLIGHT_PART = { METAL: 0, LENS: 1 }

export const STREETLIGHT_DEFAULTS = {
	height: 9, // mast height ( NYC arterial standard ~9 m )
	reach: 2.4, // how far the arm reaches out over the road
	radius: 0.1 // mast radius at the top
}

const METAL_COLOR = 0x40433d // dark olive-grey
const LENS_COLOR = 0xfff0cc // warm lit lens
const LENS_EMISSIVE = 0xffe2a6

// upstream drives the lens at ~60x for an HDR/bloom pipeline; no tone mapping runs
// here, so it is clamped to just past white instead of clipping the whole luminaire
const LENS_EMISSIVE_INTENSITY = 1.2

export type ProceduralCityStreetlightOptions = {
	/** Mast height. */
	height?: number
	/** How far the arm reaches out over the road. */
	reach?: number
	/** Mast radius at the top. */
	radius?: number
}

// a capsule-less strut: a cylinder spanning two points, oriented from +Y
function strut( a: Vector3, b: Vector3, radius: number, segments = 6 ): BufferGeometry {

	const dir = new Vector3().subVectors( b, a )
	const length = dir.length()
	const geometry = new CylinderGeometry( radius, radius, length, segments )
	geometry.applyQuaternion( new Quaternion().setFromUnitVectors( new Vector3( 0, 1, 0 ), dir.normalize() ) )
	geometry.translate( ( a.x + b.x ) / 2, ( a.y + b.y ) / 2, ( a.z + b.z ) / 2 )

	return geometry

}

export function createProceduralCityStreetlightGeometry( options: ProceduralCityStreetlightOptions = {} ): BufferGeometry {

	const height = options.height ?? STREETLIGHT_DEFAULTS.height
	const reach = options.reach ?? STREETLIGHT_DEFAULTS.reach
	const radius = options.radius ?? STREETLIGHT_DEFAULTS.radius
	const h = height

	const base = new CylinderGeometry( 0.18, 0.22, 0.6, 8 ).translate( 0, 0.3, 0 )
	const pole = new CylinderGeometry( radius, radius * 1.7, h, 8 ).translate( 0, h / 2, 0 )

	// the arm rises off the mast then sweeps out over the road to the luminaire
	const armBase = new Vector3( 0, h - 0.4, 0 )
	const armKnee = new Vector3( 0, h + 0.5, reach * 0.35 )
	const armEnd = new Vector3( 0, h + 0.2, reach )
	const arm = mergeGeometries( [ strut( armBase, armKnee, 0.07 ), strut( armKnee, armEnd, 0.06 ) ] )

	// a tapering cobra-head luminaire at the arm end, with a pale lens underneath
	const head = new BoxGeometry( 0.26, 0.16, 0.7 ).translate( armEnd.x, armEnd.y - 0.05, armEnd.z + 0.2 )
	const lens = new BoxGeometry( 0.2, 0.05, 0.5 ).translate( armEnd.x, armEnd.y - 0.14, armEnd.z + 0.2 )

	return mergeGeometries( [ part( base, STREETLIGHT_PART.METAL ), part( pole, STREETLIGHT_PART.METAL ), part( arm, STREETLIGHT_PART.METAL ), part( head, STREETLIGHT_PART.METAL ), part( lens, STREETLIGHT_PART.LENS ) ] )

}

export function createProceduralCityStreetlightMaterial(): MeshStandardMaterial {

	const body = `
	float isLens = step( abs( vPartId - ${STREETLIGHT_PART.LENS}.0 ), 0.5 );

	vec3 cityColor = mix( ${toGlslColor( new Color( METAL_COLOR ) )}, ${toGlslColor( new Color( LENS_COLOR ) )}, isLens );
	float cityRoughness = mix( 0.5, 0.3, isLens );
	`

	const material = new MeshStandardMaterial()
	applyCitySurfaceShader( material, {
		cacheKey: 'procedural-city-streetlight',
		vertexProlog: [ 'attribute float partId;', 'varying float vPartId;' ].join( '\n' ),
		vertexBody: 'vPartId = partId;',
		fragmentProlog: 'varying float vPartId;',
		body,
		metalnessBody: 'float cityMetalness = mix( 0.7, 0.0, isLens );',
		emissiveBody: `vec3 cityEmissive = ${toGlslColor( new Color( LENS_EMISSIVE ) )} * ${LENS_EMISSIVE_INTENSITY.toFixed( 3 )} * isLens;`
	} )

	return material

}

let streetlightMaterial: MeshStandardMaterial | null = null

/**
 * Builds the instanced streetlight mesh for `placements`. The geometry belongs to
 * the returned mesh ( the caller disposes it ); the material is shared and lives
 * for the module's lifetime, the same policy the sidewalk materials use.
 */
export function buildProceduralCityStreetlightGroup( placements: Matrix4[], options: ProceduralCityStreetlightOptions = {} ): InstancedMesh {

	streetlightMaterial ??= createProceduralCityStreetlightMaterial()

	const mesh = new InstancedMesh( createProceduralCityStreetlightGeometry( options ), streetlightMaterial, Math.max( 1, placements.length ) )
	mesh.name = 'Streetlights'
	mesh.count = placements.length
	mesh.visible = placements.length > 0
	// upstream leaves the furniture out of the shadow pass
	mesh.castShadow = false
	mesh.receiveShadow = false

	for ( let index = 0; index < placements.length; index += 1 ) mesh.setMatrixAt( index, placements[ index ]! )
	mesh.instanceMatrix.needsUpdate = true
	mesh.computeBoundingSphere()

	return mesh

}
