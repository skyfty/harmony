/**
 * Where the street furniture stands: the kerbside walk of every block, from
 * `CityGenerator.buildFurniture()` in three's r180 city generators ( MIT License,
 * https://github.com/mrdoob/three.js ).
 *
 * Only the streetlights and the cars are handed back — those are the two
 * generators ported to WebGL so far. The rest of the walk ( trees, hydrants,
 * benches, pedestrians, signals, litter baskets ) still runs, and its placements
 * are returned untouched under `unported`, because the walk shares one PRNG
 * stream: skipping a draw would move every car and streetlight on the street
 * after it.
 */

import { Matrix4, Quaternion, Vector3 } from 'three'
import type { ProceduralCityBlockLayout } from './proceduralCityBlock'
import { CAR_COLORS, type ProceduralCityCarPlacement } from './proceduralCityCar'

type BlockEdge = {
	x0: number
	z0: number
	dx: number
	dz: number
	nx: number
	nz: number
	length: number
}

/** The placements the walk produces, grouped by generator. */
export type ProceduralCityStreetFurniturePlan = {
	streetlights: Matrix4[]
	cars: ProceduralCityCarPlacement[]
	/** Placements for the generators that are not ported yet ( see the module note ). */
	unported: {
		signals: Matrix4[]
		cans: Matrix4[]
		benches: Matrix4[]
		hydrants: Matrix4[]
		trees: Matrix4[]
		people: Matrix4[]
	}
}

export type ProceduralCityStreetFurnitureOptions = {
	/** The sidewalk surface the furniture stands on. */
	sidewalkTop?: number
}

// the four curb edges of a block: each carries a start corner, a unit direction
// along the edge, the outward normal ( toward the road ) and a length
function blockEdges( x: number, z: number, w: number, d: number ): BlockEdge[] {

	return [
		{ x0: x, z0: z, dx: 1, dz: 0, nx: 0, nz: - 1, length: w },
		{ x0: x, z0: z + d, dx: 1, dz: 0, nx: 0, nz: 1, length: w },
		{ x0: x, z0: z, dx: 0, dz: 1, nx: - 1, nz: 0, length: d },
		{ x0: x + w, z0: z, dx: 0, dz: 1, nx: 1, nz: 0, length: d }
	]

}

const _f = new Vector3()
const _r = new Vector3()
const _up = new Vector3( 0, 1, 0 )

// a placement matrix at ( x, y, z ) whose local +Z faces ( faceX, faceZ ) in the
// XZ plane, so a canonical model authored facing +Z turns to face that way
function place( x: number, y: number, z: number, faceX: number, faceZ: number ): Matrix4 {

	_f.set( faceX, 0, faceZ ).normalize()
	_r.crossVectors( _up, _f ).normalize()
	return new Matrix4().makeBasis( _r, _up, _f ).setPosition( x, y, z )

}

const _q = new Quaternion()
const _pos = new Vector3()
const _sca = new Vector3()

// a placement with a free yaw and a uniform scale, so repeated instances ( trees,
// pedestrians ) read as individuals rather than copies
function placeYawScale( x: number, y: number, z: number, yaw: number, scale: number ): Matrix4 {

	_q.setFromAxisAngle( _up, yaw )
	return new Matrix4().compose( _pos.set( x, y, z ), _q, _sca.set( scale, scale, scale ) )

}

/** Walks every block's curb edges and returns the street furniture placements. */
export function planProceduralCityStreetFurniture(
	layout: ProceduralCityBlockLayout,
	random: () => number,
	options: ProceduralCityStreetFurnitureOptions = {}
): ProceduralCityStreetFurniturePlan {

	const L = layout
	const top = options.sidewalkTop ?? 0
	const sw = L.sidewalkWidth

	const streetlights: Matrix4[] = []
	const cars: ProceduralCityCarPlacement[] = []
	const signals: Matrix4[] = []
	const cans: Matrix4[] = []
	const benches: Matrix4[] = []
	const hydrants: Matrix4[] = []
	const trees: Matrix4[] = []
	const people: Matrix4[] = []

	// the kerbside mix of a New York street: yellow cabs over an almost entirely
	// grayscale fleet, with a dark navy, a burgundy or a bronze only here and there
	const carColor = (): number => {

		const r = random()
		for ( const [ threshold, color ] of CAR_COLORS ) if ( r < threshold ) return color
		return CAR_COLORS[ CAR_COLORS.length - 1 ]![ 1 ]

	}

	for ( let bx = 0; bx < L.blocksX; bx ++ ) {

		for ( let bz = 0; bz < L.blocksZ; bz ++ ) {

			const blockX = - L.cityW / 2 + bx * ( L.blockW + L.street )
			const blockZ = - L.cityD / 2 + bz * ( L.blockD + L.street )
			const edges = blockEdges( blockX, blockZ, L.blockW, L.blockD )

			for ( const e of edges ) {

				const len = e.length

				// cars on opposite kerbs of a street face opposite ways ( with the
				// traffic on their side ), keyed off which way the kerb faces
				const fdir = Math.sign( e.nx + e.nz ) || 1

				// a point on the sidewalk, `lateral` metres in from the curb
				const onWalk = ( t: number, lateral: number ): Matrix4 => place( e.x0 + e.dx * t - e.nx * lateral, top, e.z0 + e.dz * t - e.nz * lateral, e.nx, e.nz )

				// streetlights spaced along the curb, facing the road so the arm reaches over it
				const lc = Math.max( 1, Math.round( len / 30 ) )
				for ( let i = 0; i < lc; i ++ ) streetlights.push( onWalk( len * ( i + 0.5 ) / lc, 0.8 ) )

				// street trees in curbside pits, offset from the lights, clear of the corners
				const tc = Math.max( 1, Math.round( len / 16 ) )
				for ( let i = 0; i < tc; i ++ ) {

					const t = len * ( i + 0.5 ) / tc + 5
					if ( t > 7 && t < len - 7 && random() < 0.85 ) {

						// random yaw and height so no two street trees read as copies
						trees.push( placeYawScale( e.x0 + e.dx * t - e.nx * 1.5, top, e.z0 + e.dz * t - e.nz * 1.5, random() * Math.PI * 2, 0.8 + random() * 0.5 ) )

					}

				}

				// a single hydrant on the kerb, its no-parking zone honoured below
				const hydT = len * ( 0.25 + random() * 0.5 )
				hydrants.push( onWalk( hydT, 0.7 ) )

				// a bench facing the street on some edges
				if ( random() < 0.4 ) benches.push( onWalk( len * ( 0.3 + random() * 0.4 ), 1.7 ) )

				// pedestrians scattered across the walking strip, facing any way
				const pc = Math.max( 2, Math.round( len / 9 ) )
				for ( let i = 0; i < pc; i ++ ) {

					if ( random() < 0.7 ) {

						const t = len * ( i + random() ) / pc
						const lateral = 0.9 + random() * ( sw - 2 )
						people.push( placeYawScale( e.x0 + e.dx * t - e.nx * lateral, top, e.z0 + e.dz * t - e.nz * lateral, random() * Math.PI * 2, 0.92 + random() * 0.16 ) )

					}

				}

				// parked cars in the kerb lane, nose-to-tail with gaps, clear of the
				// corners ( daylighting ) and the hydrant
				for ( let t = 9; t < len - 9; t += 5.8 ) {

					if ( Math.abs( t - hydT ) > 3 && random() < 0.72 ) {

						cars.push( { matrix: place( e.x0 + e.dx * t + e.nx * 1.5, 0, e.z0 + e.dz * t + e.nz * 1.5, e.dx * fdir, e.dz * fdir ), color: carColor() } )

					}

				}

				// the occasional vehicle out in a travel lane
				for ( let t = 14; t < len - 14; t += 13 ) {

					if ( random() < 0.4 ) cars.push( { matrix: place( e.x0 + e.dx * t + e.nx * 5.5, 0, e.z0 + e.dz * t + e.nz * 5.5, e.dx * fdir, e.dz * fdir ), color: carColor() } )

				}

			}

			// at two opposite corners: a mast-arm signal reaching over the crossing,
			// and a litter basket on every corner just along the kerb
			const corners: [ number, number ][] = [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 1, 1 ] ]
			for ( const [ cx, cz ] of corners ) {

				const x = blockX + cx * L.blockW, z = blockZ + cz * L.blockD
				const ix = cx ? - 1 : 1, iz = cz ? - 1 : 1 // inward, toward the block centre

				if ( cx === cz ) signals.push( place( x + ix * 1.4, top, z + iz * 1.4, - ix, - iz ) )
				cans.push( place( x + ix * 2.2, top, z + iz * 2.2, ix, iz ) )

			}

		}

	}

	return { streetlights, cars, unported: { signals, cans, benches, hydrants, trees, people } }

}
