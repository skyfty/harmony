import * as THREE from 'three'
import { SKYSCRAPER_PART } from './proceduralCitySkyscraper'

/**
 * The bridge between the r180 skyscraper generator's per-vertex `partId` zones
 * and the engine's WebGL city materials, which read a `color` vertex attribute.
 *
 * The colours approximate the per-zone branches of the TSL material upstream
 * removed with the WebGPU build ( see `createSkyscraperMaterial` ), and are
 * deliberately flat: the geometry carries the detail, the palette only separates
 * the masonry, glazing, frames, trim and shopfronts.
 */

export type SkyscraperPartColorMode = 'project' | 'debug'

const GLASS_COLOR = 0x1b2026
const SHOP_GLASS_COLOR = 0x2a3238
const AC_COLOR = 0x8a8578
const STORE_FRAME_COLOR = 0x24201c

/** The awning canvases upstream picks from, hashed per street cell. */
const AWNING_COLORS = [ 0x6a2f2f, 0x244a32, 0x22384f, 0x5a5e58, 0x201f22 ]

/** One flat, unambiguous colour per zone, for eyeballing the part tagging. */
const DEBUG_COLORS = [
	0xd8c7c7, // WALL
	0xf2b134, // PIER
	0x4fa3d1, // FRAME
	0x9b59b6, // ORNAMENT
	0x141b22, // GLASS
	0x8a8578, // AC
	0x2a3238, // SHOPGLASS
	0x24201c, // STORE
	0xc0392b // AWNING
]

const STORE_FRAME = new THREE.Color( STORE_FRAME_COLOR )
const WHITE = new THREE.Color( 0xffffff )
const scratch = new THREE.Color()
const awningScratch = new THREE.Color()

// the same coarse street-cell hash the upstream material uses to pick an awning
function hashCell( x: number, z: number ): number {

	let h = Math.imul( x + 65536, 73856093 ) ^ Math.imul( z + 65536, 19349663 )
	h = Math.imul( h ^ ( h >>> 15 ), 2246822507 )
	h = ( h ^ ( h >>> 13 ) ) >>> 0
	return h / 4294967296

}

function resolvePartColor(
	partId: number,
	buildingBase: THREE.Color,
	position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
	index: number,
	mode: SkyscraperPartColorMode
): THREE.Color {

	if ( mode === 'debug' ) {

		const debugColor = DEBUG_COLORS[ partId ]
		return scratch.setHex( debugColor === undefined ? 0xff00ff : debugColor )

	}

	switch ( partId ) {

		case SKYSCRAPER_PART.PIER:
			return scratch.copy( buildingBase ).multiplyScalar( 1.12 )

		case SKYSCRAPER_PART.FRAME:
			return scratch.copy( buildingBase ).multiplyScalar( 0.55 )

		case SKYSCRAPER_PART.ORNAMENT:
			return scratch.copy( buildingBase ).lerp( WHITE, 0.22 )

		case SKYSCRAPER_PART.GLASS:
			return scratch.setHex( GLASS_COLOR )

		case SKYSCRAPER_PART.AC:
			return scratch.setHex( AC_COLOR )

		case SKYSCRAPER_PART.SHOPGLASS:
			return scratch.setHex( SHOP_GLASS_COLOR )

		case SKYSCRAPER_PART.STORE:
			return scratch.copy( buildingBase ).multiplyScalar( 0.3 ).lerp( STORE_FRAME, 0.5 )

		case SKYSCRAPER_PART.AWNING: {

			// the upstream material keys the awning canvas off a coarse world cell
			const cellX = Math.floor( position.getX( index ) * 0.2 )
			const cellZ = Math.floor( position.getZ( index ) * 0.2 )
			const pick = awningScratch.setHex( AWNING_COLORS[ Math.min( AWNING_COLORS.length - 1, Math.floor( hashCell( cellX, cellZ ) * 5 ) ) ]! )
			return scratch.copy( pick )

		}

		default:
			return scratch.copy( buildingBase )

	}

}

/**
 * Bakes a per-vertex `color` attribute from the geometry's `partId` attribute, so
 * a vertex-colored wall material renders every zone without a shader.
 */
export function applySkyscraperPartColors(
	geometry: THREE.BufferGeometry,
	buildingBase: THREE.Color,
	mode: SkyscraperPartColorMode = 'project'
): void {

	const partId = geometry.getAttribute( 'partId' )
	const position = geometry.getAttribute( 'position' )
	const colors = new Float32Array( partId.count * 3 )

	for ( let index = 0; index < partId.count; index += 1 ) {

		const color = resolvePartColor( partId.getX( index ), buildingBase, position, index, mode )
		colors[ index * 3 ] = Math.min( 1, color.r )
		colors[ index * 3 + 1 ] = Math.min( 1, color.g )
		colors[ index * 3 + 2 ] = Math.min( 1, color.b )

	}

	geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) )

}
