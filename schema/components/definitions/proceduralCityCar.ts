/**
 * A low-poly car fleet: lofted bodies, circular wheel arches, curved windscreens
 * and recessed alloy wheels, mixed deterministically between a sedan, an SUV and a
 * roof-signed taxi so a parked row reads as different vehicles rather than one mould.
 *
 * A WebGL port of `CarGenerator.js` from three's r180 city generators ( MIT
 * License, https://github.com/mrdoob/three.js ). The geometry is the upstream CPU
 * construction ( the same `LoftGeometry` sections, panels, wheels and trim ); its
 * TSL material — per-instance paint plus a baked `partId`, panel UVs and
 * canonical-space masks — is written here as GLSL over a stock
 * `MeshStandardMaterial`.
 *
 * The canonical model stands with its wheels on `y = 0`, centred in X / Z, facing
 * `+Z`, so a placement whose local `+Z` faces the road parks it nose-out.
 */

import {
	BoxGeometry,
	BufferGeometry,
	CircleGeometry,
	Color,
	Float32BufferAttribute,
	Group,
	InstancedBufferAttribute,
	InstancedMesh,
	LatheGeometry,
	Matrix4,
	MeshStandardMaterial,
	Vector2,
	Vector3
} from 'three'
import { LoftGeometry } from 'three/examples/jsm/geometries/LoftGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { applyCitySurfaceShader, toGlslColor, toGlslFloat } from './proceduralCityGlsl'
import { part } from './proceduralCityPartGeometry'

/** The material-zone codes baked per vertex into a merged car model. */
export const CAR_PART = { BODY: 0, WINDOW: 1, TYRE: 2, ALLOY: 3, TRIM: 4, MIRROR: 5, SIGN: 6, FRONT: 7, REAR: 8 }

/** The paint colour that gets the roof-signed taxi shell. */
export const CAR_TAXI_COLOR = 0xf5c518

/** One car's placement and paint. */
export type ProceduralCityCarPlacement = {
	matrix: Matrix4
	color: number
}

export type ProceduralCityCarBodyType = 'sedan' | 'suv' | 'taxi'

// body sections are [ z, half-width, shoulder height, deck height ]; the cabin has
// separate base and roof corners, so changing its shape also moves its panes
type CarBodySection = [ number, number, number, number ]
type CarPoint = [ number, number, number ]

type CarBodySpec = {
	body: CarBodySection[]
	front: { base: CarPoint; roof: CarPoint }
	rear: { base: CarPoint; roof: CarPoint }
	wheelRadius: number
	wheelZ: number
	wheelX: number
	pillars: number[]
	lamps: number[]
	sign: boolean
	rails: boolean
}

const SEDAN_SPEC: CarBodySpec = {
		body: [
			[ 2.25, 0.79, 0.67, 0.79 ],
			[ 2.11, 0.89, 0.78, 0.91 ],
			[ 1.38, 0.94, 0.87, 1.00 ],
			[ 0.75, 0.92, 0.89, 1.025 ],
			[ - 0.45, 0.92, 0.91, 1.04 ],
			[ - 1.38, 0.94, 0.88, 1.06 ],
			[ - 2.10, 0.89, 0.77, 0.97 ],
			[ - 2.25, 0.81, 0.70, 0.85 ]
		],
		front: { base: [ 0.82, 0.99, 0.78 ], roof: [ 0.69, 1.45, 0.12 ] },
		rear: { base: [ 0.83, 1.02, - 1.15 ], roof: [ 0.71, 1.47, - 0.72 ] },
		wheelRadius: 0.35, wheelZ: 1.38, wheelX: 0.83,
		pillars: [ - 0.30 ], lamps: [ 0.71, 0.76 ],
		sign: false, rails: false
	}

const SUV_SPEC: CarBodySpec = {
		body: [
			[ 2.30, 0.84, 0.84, 0.99 ],
			[ 2.15, 0.94, 0.94, 1.10 ],
			[ 1.40, 0.98, 1.02, 1.17 ],
			[ 0.76, 0.96, 1.04, 1.19 ],
			[ - 0.45, 0.96, 1.05, 1.20 ],
			[ - 1.40, 0.98, 1.03, 1.21 ],
			[ - 2.16, 0.94, 0.94, 1.16 ],
			[ - 2.30, 0.84, 0.86, 1.03 ]
		],
		front: { base: [ 0.86, 1.15, 0.78 ], roof: [ 0.76, 1.73, 0.18 ] },
		rear: { base: [ 0.87, 1.15, - 2.12 ], roof: [ 0.77, 1.75, - 1.66 ] },
		wheelRadius: 0.39, wheelZ: 1.40, wheelX: 0.87,
		pillars: [ - 0.30, - 1.16 ], lamps: [ 0.91, 0.94 ],
		sign: false, rails: true
	}

const BODY_SPECS: Record< ProceduralCityCarBodyType, CarBodySpec > = {

	sedan: SEDAN_SPEC,
	suv: SUV_SPEC,
	taxi: { ...SEDAN_SPEC, sign: true }

}

// --- geometry ------------------------------------------------------------

function buildBody( spec: CarBodySpec ): BufferGeometry {

	const profile = spec.body
	const radius = spec.wheelRadius + 0.055
	const stations = new Set< number >( profile.map( ( section ) => section[ 0 ] ) )

	// Sample the arches around the axle, then interpolate the body profile at
	// those stations. Wheel size and placement no longer need hand-shaped cuts.
	for ( const axle of [ - spec.wheelZ, spec.wheelZ ] ) {

		for ( let i = 0; i <= 6; i ++ ) stations.add( axle + radius * Math.cos( i / 6 * Math.PI ) )

	}

	const sections = Array.from( stations ).sort( ( a, b ) => b - a ).map( ( z ) => {

		let index = 0
		while ( index < profile.length - 2 && z < profile[ index + 1 ]![ 0 ] ) index ++

		const a = profile[ index ]!, b = profile[ index + 1 ]!
		const t = ( z - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] )
		const w = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t
		const shoulder = a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t
		const deck = a[ 3 ] + ( b[ 3 ] - a[ 3 ] ) * t
		const distance = Math.abs( Math.abs( z ) - spec.wheelZ )
		const sill = distance <= radius ? spec.wheelRadius + Math.sqrt( Math.max( 0, radius * radius - distance * distance ) ) : 0.28

		const right = [
			new Vector3( w * 0.82, sill, z ),
			new Vector3( w * 0.97, sill + ( shoulder - sill ) * 0.12, z ),
			new Vector3( w, shoulder, z ),
			new Vector3( w * 0.91, deck - 0.025, z ),
			new Vector3( w * 0.52, deck, z )
		]

		return [ ...right, ...right.slice().reverse().map( ( point ) => new Vector3( - point.x, point.y, point.z ) ) ].reverse()

	} )

	const geometry = part( new LoftGeometry( sections, { capStart: true, capEnd: true } ), CAR_PART.BODY )
	const normals = geometry.getAttribute( 'normal' )
	const ids = geometry.getAttribute( 'partId' )

	for ( let i = 0; i < normals.count; i ++ ) {

		if ( normals.getZ( i ) > 0.9999 ) ids.setX( i, CAR_PART.FRONT )
		if ( normals.getZ( i ) < - 0.9999 ) ids.setX( i, CAR_PART.REAR )

	}

	return geometry

}

// Independent panel vertices preserve the crease at each pillar and roof edge.
// Their UVs also give the material an exact outline for the window seals.
function panel( corners: Vector3[], id: number, curved = false ): BufferGeometry {

	const geometry = new BufferGeometry()
	const columns = curved ? 4 : 1, rows = curved ? 2 : 1
	const positions: number[] = [], uvs: number[] = [], indices: number[] = []
	const normal = corners[ 1 ]!.clone().sub( corners[ 0 ]! ).cross( corners[ 3 ]!.clone().sub( corners[ 0 ]! ) ).normalize()

	for ( let y = 0; y <= rows; y ++ ) {

		const v = y / rows

		for ( let x = 0; x <= columns; x ++ ) {

			const u = x / columns
			const p = corners[ 0 ]!.clone().lerp( corners[ 1 ]!, u ).lerp( corners[ 3 ]!.clone().lerp( corners[ 2 ]!, u ), v )

			if ( curved ) {

				const arch = 4 * u * ( 1 - u )
				p.y += arch * v * 0.035
				p.addScaledVector( normal, arch * 4 * v * ( 1 - v ) * 0.025 )

			}

			p.toArray( positions, positions.length )
			uvs.push( u, v )

			if ( x < columns && y < rows ) {

				const a = y * ( columns + 1 ) + x, b = a + 1, d = a + columns + 1, c = d + 1
				indices.push( a, b, d, b, c, d )

			}

		}

	}

	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) )
	geometry.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) )
	geometry.setIndex( indices )
	geometry.computeVertexNormals()

	return part( geometry, id )

}

export function createProceduralCityCarGeometry( type: ProceduralCityCarBodyType ): BufferGeometry {

	const spec = BODY_SPECS[ type ]
	const parts = [ buildBody( spec ) ]
	const corner = ( point: CarPoint, side: number ): Vector3 => new Vector3( point[ 0 ] * side, point[ 1 ], point[ 2 ] )
	const fl = corner( spec.front.base, - 1 ), fr = corner( spec.front.base, 1 )
	const rl = corner( spec.rear.base, - 1 ), rr = corner( spec.rear.base, 1 )
	const tfl = corner( spec.front.roof, - 1 ), tfr = corner( spec.front.roof, 1 )
	const trl = corner( spec.rear.roof, - 1 ), trr = corner( spec.rear.roof, 1 )

	parts.push(
		panel( [ fl, fr, tfr, tfl ], CAR_PART.WINDOW, true ),
		panel( [ rr, rl, trl, trr ], CAR_PART.WINDOW, true ),
		panel( [ fr, rr, trr, tfr ], CAR_PART.WINDOW ),
		panel( [ rl, fl, tfl, trl ], CAR_PART.WINDOW )
	)

	const roof = [ spec.front.roof, spec.rear.roof ].map( ( [ width, y, z ] ) => Array.from( { length: 5 }, ( _, i ) => {

		const u = i / 4
		return new Vector3( ( u * 2 - 1 ) * width, y + 4 * u * ( 1 - u ) * 0.035, z )

	} ) )
	parts.push( part( new LoftGeometry( roof, { closed: false } ), CAR_PART.BODY ) )

	const r = spec.wheelRadius
	const rim = r * 0.64
	const width = r * 0.68
	const wheelProfile = [
		new Vector2( r * 0.93, - width * 0.44 ),
		new Vector2( r, - width * 0.12 ),
		new Vector2( r * 0.98, width * 0.27 ),
		new Vector2( rim + 0.014, width * 0.44 )
	]

	for ( const side of [ - 1, 1 ] ) {

		for ( const z of [ - spec.wheelZ, spec.wheelZ ] ) {

			const x = side * spec.wheelX
			const tyre = new LatheGeometry( wheelProfile, 24 ).rotateZ( - side * Math.PI / 2 ).translate( x, r, z )
			const lip = new LatheGeometry( [ new Vector2( rim + 0.014, width * 0.44 ), new Vector2( rim, width * 0.29 ) ], 24 ).rotateZ( - side * Math.PI / 2 ).translate( x, r, z )
			const hub = new CircleGeometry( rim, 24 )
			hub.getAttribute( 'position' ).setZ( 0, - 0.015 )
			hub.computeVertexNormals()
			hub.rotateY( side * Math.PI / 2 ).translate( x + side * width * 0.29, r, z )
			const well = new CircleGeometry( r + 0.06, 8, 0, Math.PI ).rotateY( side * Math.PI / 2 ).translate( x - side * ( width * 0.5 + 0.02 ), r, z )

			parts.push( part( tyre, CAR_PART.TYRE ), part( lip, CAR_PART.ALLOY ), part( hub, CAR_PART.ALLOY ), part( well, CAR_PART.TRIM ) )

		}

		const mirror = new BoxGeometry( 0.16, 0.1, 0.2 ).rotateY( side * 0.2 ).translate( side * ( spec.body[ 2 ]![ 1 ] + 0.06 ), spec.front.base[ 1 ] + 0.05, spec.front.base[ 2 ] - 0.16 )
		parts.push( part( mirror, CAR_PART.MIRROR ) )

		if ( spec.rails ) {

			const sections = [ 0.06, 0.13, 0.87, 0.94 ].map( ( t, i ) => {

				const z = tfr.z + ( trr.z - tfr.z ) * t
				const roofWidth = tfr.x + ( trr.x - tfr.x ) * t
				const y = tfr.y + ( trr.y - tfr.y ) * t + ( 1 - ( 0.63 / roofWidth ) ** 2 ) * 0.035 + ( i === 0 || i === 3 ? 0.005 : 0.05 )
				const x = side * 0.63
				return [ new Vector3( x - 0.022, y - 0.018, z ), new Vector3( x + 0.022, y - 0.018, z ), new Vector3( x + 0.022, y + 0.018, z ), new Vector3( x - 0.022, y + 0.018, z ) ].reverse()

			} )
			parts.push( part( new LoftGeometry( sections, { capStart: true, capEnd: true } ), CAR_PART.TRIM ) )

		}

	}

	if ( spec.sign ) {

		const roofY = ( tfr.y + trr.y ) / 2 + 0.04
		const section = ( w: number, d: number, y: number ): Vector3[] => [ new Vector3( w, y, d ), new Vector3( - w, y, d ), new Vector3( - w, y, - d ), new Vector3( w, y, - d ) ]
		const sign = new LoftGeometry( [ section( 0.16, 0.065, roofY + 0.1 ), section( 0.20, 0.095, roofY ) ], { capStart: true, capEnd: true } ).translate( 0, 0, - 0.2 )
		parts.push( part( sign, CAR_PART.SIGN ) )

	}

	return mergeGeometries( parts )

}

// --- material ------------------------------------------------------------

export function createProceduralCityCarMaterial( type: ProceduralCityCarBodyType ): MeshStandardMaterial {

	const spec = BODY_SPECS[ type ]
	const axle = spec.wheelZ
	const radius = spec.wheelRadius
	const belt = spec.front.base[ 1 ]
	const doorEnd = spec.rails ? spec.pillars[ 1 ]! - 0.08 : spec.rear.base[ 2 ] + 0.1
	const pillarA = spec.pillars[ 0 ]!
	const pillarB = spec.pillars[ 1 ] ?? 9
	const lampFront = spec.lamps[ 0 ]!
	const lampRear = spec.lamps[ 1 ]!
	const seams: [ number, number, number ] = [ spec.front.base[ 2 ] - 0.04, pillarA, doorEnd ]
	const handles: [ number, number ] = [ pillarA + 0.17, doorEnd + 0.17 ]
	const body = CAR_PART

	const fragmentProlog = `
	varying vec3 vCarPaint;
	varying vec3 vCarLocalPosition;
	varying vec3 vCarLocalNormal;
	varying vec2 vCarPanelUV;
	varying float vPartId;

	// rounded-rect signed distance, sized to the pixel footprint so the pane
	// outlines and their rubber seals stay crisp
	float carRoundedRect( vec2 point, vec2 halfSize, float radius ) {
		vec2 q = abs( point ) - halfSize + radius;
		float distance = length( max( q, vec2( 0.0 ) ) ) + min( max( q.x, q.y ), 0.0 ) - radius;
		float edge = max( fwidth( distance ), 0.001 );
		return smoothstep( edge, - edge, distance );
	}
	`

	const colorBody = `
	vec3 paint = vCarPaint;
	vec3 p = vCarLocalPosition;
	vec3 nrm = vCarLocalNormal;
	float part = vPartId;

	float isWindow = step( abs( part - ${toGlslFloat( body.WINDOW )} ), 0.5 );
	float isTyre = step( abs( part - ${toGlslFloat( body.TYRE )} ), 0.5 );
	float isAlloy = step( abs( part - ${toGlslFloat( body.ALLOY )} ), 0.5 );
	float isTrim = step( abs( part - ${toGlslFloat( body.TRIM )} ), 0.5 );
	float isMirror = step( abs( part - ${toGlslFloat( body.MIRROR )} ), 0.5 );
	float isSign = step( abs( part - ${toGlslFloat( body.SIGN )} ), 0.5 );
	float isFront = step( abs( part - ${toGlslFloat( body.FRONT )} ), 0.5 );
	float isRear = step( abs( part - ${toGlslFloat( body.REAR )} ), 0.5 );
	float isEnd = max( isFront, isRear );

	float side = step( 0.5, abs( nrm.x ) );

	// rounded panes and their rubber seals follow the panel UVs; only the side
	// panes receive pillars, leaving both windscreens uninterrupted
	vec2 paneUV = vCarPanelUV - 0.5;
	float glass = carRoundedRect( paneUV, vec2( 0.455, 0.405 ), 0.035 );
	float seal = carRoundedRect( paneUV, vec2( 0.47, 0.43 ), 0.045 );
	float pillarDistance = abs( p.z - ${toGlslFloat( pillarA )} );
	glass *= mix( 1.0, smoothstep( 0.043, 0.053, pillarDistance ), side );
	seal *= mix( 1.0, smoothstep( 0.026, 0.035, pillarDistance ), side );
	pillarDistance = abs( p.z - ${toGlslFloat( pillarB )} );
	glass *= mix( 1.0, smoothstep( 0.043, 0.053, pillarDistance ), side );
	seal *= mix( 1.0, smoothstep( 0.026, 0.035, pillarDistance ), side );

	vec3 windowColor = mix( mix( paint, ${toGlslColor( new Color( 0x13191c ) )}, seal ), ${toGlslColor( new Color( 0x1d2b35 ) )}, glass );
	float mirrorGlass = isMirror * step( nrm.z, - 0.5 );
	float glazing = mix( mirrorGlass, glass, isWindow );

	vec2 wheel = vec2( abs( p.z ) - ${toGlslFloat( axle )}, p.y - ${toGlslFloat( radius )} );
	float wheelDistance = length( wheel );
	float flank = smoothstep( 0.65, 0.85, abs( p.x ) );
	float archShade = smoothstep( ${toGlslFloat( radius + 0.025 )}, ${toGlslFloat( radius + 0.095 )}, wheelDistance );
	float shading = mix( 1.0, archShade * 0.28 + 0.72, flank ) * ( smoothstep( 0.25, 0.65, p.y ) * 0.3 + 0.7 );

	float seam = max( max(
		smoothstep( 0.012, 0.004, abs( p.z - ${toGlslFloat( seams[ 0 ] )} ) ),
		smoothstep( 0.012, 0.004, abs( p.z - ${toGlslFloat( seams[ 1 ] )} ) ) ),
		smoothstep( 0.012, 0.004, abs( p.z - ${toGlslFloat( seams[ 2 ] )} ) ) );
	seam = max( seam, carRoundedRect( vec2( p.z - ${toGlslFloat( handles[ 0 ] )}, p.y - ${toGlslFloat( belt - 0.10 )} ), vec2( 0.06, 0.011 ), 0.006 ) );
	seam = max( seam, carRoundedRect( vec2( p.z - ${toGlslFloat( handles[ 1 ] )}, p.y - ${toGlslFloat( belt - 0.10 )} ), vec2( 0.06, 0.011 ), 0.006 ) );
	seam *= flank * smoothstep( 0.36, 0.43, p.y ) * smoothstep( ${toGlslFloat( belt )}, ${toGlslFloat( belt - 0.025 )}, p.y );
	vec3 bodyColor = paint * shading * ( 1.0 - seam * 0.5 );

	// lamps, grille, number plates and bumper inlets are inset into the fascia; the
	// front and rear caps supply their silhouettes without floating boxes
	float lampY = mix( ${toGlslFloat( lampRear )}, ${toGlslFloat( lampFront )}, isFront );
	float light = carRoundedRect( vec2( abs( p.x ) - 0.61, p.y - lampY ), vec2( 0.19, 0.055 ), 0.018 ) * isEnd;
	float grille = carRoundedRect( vec2( p.x, p.y - ${toGlslFloat( lampFront - 0.025 )} ), vec2( 0.30, 0.075 ), 0.025 ) * isFront;
	float intake = carRoundedRect( vec2( p.x, p.y - ( lampY - 0.29 ) ), vec2( 0.66, 0.045 ), 0.03 ) * isEnd;
	float plateY = mix( ${toGlslFloat( lampRear - 0.17 )}, ${toGlslFloat( lampFront - 0.20 )}, isFront );
	float plate = carRoundedRect( vec2( p.x, p.y - plateY ), vec2( 0.155, 0.055 ), 0.008 ) * isEnd;
	float slats = mix( 0.65, 1.0, step( 0.5, fract( p.y * 65.0 ) ) );
	bodyColor = mix( bodyColor, ${toGlslColor( new Color( 0x161a1c ) )} * slats, max( grille, intake ) );
	bodyColor = mix( bodyColor, ${toGlslColor( new Color( 0xd8d9d3 ) )}, plate );
	bodyColor = mix( bodyColor, mix( ${toGlslColor( new Color( 0x7b1015 ) )}, ${toGlslColor( new Color( 0xd1e4eb ) )}, isFront ), light );

	float spokeAngle = atan( wheel.y, wheel.x ) * 0.7957747; // 5 spokes / 2pi
	float spokes = smoothstep( 0.62, 0.42, abs( fract( spokeAngle ) - 0.5 ) * 2.0 );
	float rim = smoothstep( ${toGlslFloat( radius * 0.53 )}, ${toGlslFloat( radius * 0.59 )}, wheelDistance );
	float hub = smoothstep( 0.06, 0.035, wheelDistance );
	vec3 alloy = mix( ${toGlslColor( new Color( 0x171b20 ) )}, ${toGlslColor( new Color( 0xafb6ba ) )}, max( max( spokes, rim ), hub ) );
	vec3 tyre = ${toGlslColor( new Color( 0x18191b ) )} * ( smoothstep( ${toGlslFloat( radius * 0.85 )}, ${toGlslFloat( radius * 0.94 )}, wheelDistance ) * 0.2 + 0.8 );

	vec3 cityColor = bodyColor;
	cityColor = mix( cityColor, ${toGlslColor( new Color( 0x70808a ) )}, mirrorGlass );
	cityColor = mix( cityColor, windowColor, isWindow );
	cityColor = mix( cityColor, ${toGlslColor( new Color( 0xffd66a ) )}, isSign );
	cityColor = mix( cityColor, ${toGlslColor( new Color( 0x202326 ) )}, isTrim );
	cityColor = mix( cityColor, alloy, isAlloy );
	cityColor = mix( cityColor, tyre, isTyre );

	float cityRoughness = mix( mix( 0.32, 0.055, glazing ), 0.85, max( isTyre, isTrim ) );
	`

	const metalnessBody = `
	float cityMetalness = mix( 0.25, 0.85, glazing );
	cityMetalness = mix( cityMetalness, 0.0, max( max( isTyre, isTrim ), isSign ) );
	cityMetalness = mix( cityMetalness, 0.8, isAlloy );
	`

	const emissiveBody = `
	vec3 cityEmissive = mix( ${toGlslColor( new Color( 0xf00008 ) )} * 1.5, ${toGlslColor( new Color( 0xd9efff ) )} * 4.0, isFront ) * light;
	cityEmissive += ${toGlslColor( new Color( 0xffd77b ) )} * 2.0 * isSign;
	`

	const material = new MeshStandardMaterial()
	applyCitySurfaceShader( material, {
		cacheKey: `procedural-city-car:${type}`,
		vertexProlog: [
			'attribute vec3 paintColor;',
			'attribute float partId;',
			'varying vec3 vCarPaint;',
			'varying vec3 vCarLocalPosition;',
			'varying vec3 vCarLocalNormal;',
			'varying vec2 vCarPanelUV;',
			'varying float vPartId;'
		].join( '\n' ),
		vertexBody: [
			'vCarPaint = paintColor;',
			'vCarLocalPosition = transformed;',
			'vCarLocalNormal = objectNormal;',
			'vCarPanelUV = uv;',
			'vPartId = partId;'
		].join( '\n' ),
		fragmentProlog,
		body: colorBody,
		metalnessBody,
		emissiveBody
	} )

	return material

}

// the fleet's paint mix: yellow cabs over an almost entirely grayscale fleet
const CAR_COLORS: [ number, number ][] = [
	[ 0.22, 0xf5c518 ], // yellow cab
	[ 0.42, 0x111216 ], // black ( livery sedans and SUVs )
	[ 0.59, 0xe9e8e3 ], // white
	[ 0.72, 0xb2b5b8 ], // silver
	[ 0.84, 0x3e4247 ], // graphite
	[ 0.90, 0x74787c ], // mid grey
	[ 0.95, 0x1c2a3f ], // dark navy
	[ 0.98, 0x571f1f ], // burgundy
	[ 1.01, 0x5c4834 ] // bronze
]

export { CAR_COLORS }

const carMaterials = new Map< ProceduralCityCarBodyType, MeshStandardMaterial >()

/**
 * Builds the instanced fleet, bucketed by body type so each shell is one draw.
 * Geometries belong to the returned group ( the caller disposes it ); the per-type
 * materials are shared and live for the module's lifetime.
 */
export function buildProceduralCityCarGroup( cars: ProceduralCityCarPlacement[] ): Group {

	const group = new Group()
	group.name = 'Cars'

	// bucket the fleet by body type; the taxi colour always gets the signed sedan,
	// the rest split deterministically between sedan and SUV
	const buckets = new Map< ProceduralCityCarBodyType, ProceduralCityCarPlacement[] >()

	for ( let i = 0; i < cars.length; i ++ ) {

		const car = cars[ i ]!
		const type: ProceduralCityCarBodyType = car.color === CAR_TAXI_COLOR
			? 'taxi'
			: ( ( ( i * 2654435761 ) >>> 0 ) % 100 < 42 ? 'suv' : 'sedan' )

		const bucket = buckets.get( type )
		if ( bucket === undefined ) buckets.set( type, [ car ] )
		else bucket.push( car )

	}

	const paint = new Color()

	for ( const [ type, instances ] of buckets ) {

		let material = carMaterials.get( type )
		if ( material === undefined ) {

			material = createProceduralCityCarMaterial( type )
			carMaterials.set( type, material )

		}

		const geometry = createProceduralCityCarGeometry( type )
		const paintColors = new InstancedBufferAttribute( new Float32Array( instances.length * 3 ), 3 )
		geometry.setAttribute( 'paintColor', paintColors )

		for ( let i = 0; i < instances.length; i ++ ) {

			paint.set( instances[ i ]!.color ).toArray( paintColors.array, i * 3 )

		}

		paintColors.needsUpdate = true

		const mesh = new InstancedMesh( geometry, material, instances.length )
		mesh.name = `Car_${type}`
		mesh.castShadow = true
		mesh.receiveShadow = true

		for ( let i = 0; i < instances.length; i ++ ) mesh.setMatrixAt( i, instances[ i ]!.matrix )
		mesh.instanceMatrix.needsUpdate = true
		mesh.computeBoundingSphere()

		group.add( mesh )

	}

	return group

}
