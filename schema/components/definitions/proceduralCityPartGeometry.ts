/**
 * Tags a geometry with the per-vertex material zone the city's instanced
 * furniture materials branch on — the vendored equivalent of `part()` in three's
 * `examples/jsm/generators/city/CityGeneratorUtils.js` ( MIT License,
 * https://github.com/mrdoob/three.js ), minus its TSL import.
 */

import { BufferAttribute } from 'three'
import type { BufferGeometry } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Returns the geometry indexed ( three's merger only accepts all-indexed or
 * all-non-indexed inputs ) with a constant `partId` attribute written to every
 * vertex, so one material can shade each zone of a merged model.
 */
export function part( geometry: BufferGeometry, id: number ): BufferGeometry {

	const tagged = geometry.index ? geometry : mergeVertices( geometry )
	tagged.setAttribute( 'partId', new BufferAttribute( new Float32Array( tagged.getAttribute( 'position' ).count ).fill( id ), 1 ) )

	return tagged

}
