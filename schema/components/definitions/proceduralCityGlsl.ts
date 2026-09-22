/**
 * The shared GLSL layer for the city's ground surfaces.
 *
 * three's r180 city generators shade their roads, sidewalks and interiors with
 * TSL node graphs, which only the WebGPU renderer can compile. These helpers are
 * the WebGL equivalent: the same world-space, hash-driven look written as plain
 * GLSL and injected into a stock `MeshStandardMaterial` through
 * `onBeforeCompile`, so the surfaces still light like the rest of the scene.
 *
 * Scope note: the upstream materials also perturb the shading normal from a
 * world-space height field ( `bumpNormal` in `CityGeneratorUtils.js` ). That term
 * is a sub-centimetre grain and is intentionally not ported here.
 */

import type * as THREE from 'three'

/**
 * Value noise, integer-hash helpers and the antialiased line/grid masks the city
 * surfaces are built from — the GLSL counterparts of `mx_noise_float`,
 * `mx_fractal_noise_float`, `fwidth`-sized `smoothstep` and friends.
 *
 * `cityValueNoise` returns roughly -1..1 and the fractals are amplitude
 * normalized, matching the MaterialX nodes upstream feeds `* 0.5 + 0.5`.
 */
export const CITY_GLSL_HELPERS = `
varying vec3 vCityWorldPosition;
varying vec3 vCityWorldNormal;

float cityHash13( vec3 p ) {
	return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
}

float cityValueNoise( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	vec3 u = f * f * ( 3.0 - 2.0 * f );
	float n000 = cityHash13( i );
	float n100 = cityHash13( i + vec3( 1.0, 0.0, 0.0 ) );
	float n010 = cityHash13( i + vec3( 0.0, 1.0, 0.0 ) );
	float n110 = cityHash13( i + vec3( 1.0, 1.0, 0.0 ) );
	float n001 = cityHash13( i + vec3( 0.0, 0.0, 1.0 ) );
	float n101 = cityHash13( i + vec3( 1.0, 0.0, 1.0 ) );
	float n011 = cityHash13( i + vec3( 0.0, 1.0, 1.0 ) );
	float n111 = cityHash13( i + vec3( 1.0, 1.0, 1.0 ) );
	float low = mix( mix( n000, n100, u.x ), mix( n010, n110, u.x ), u.y );
	float high = mix( mix( n001, n101, u.x ), mix( n011, n111, u.x ), u.y );
	return mix( low, high, u.z ) * 2.0 - 1.0;
}

// two and three octave fractals ( amplitude halving, frequency doubling ),
// normalized the way MaterialX's fractal noise is
float cityFbm2( vec3 p ) {
	return ( cityValueNoise( p ) + cityValueNoise( p * 2.0 ) * 0.5 ) / 1.5;
}

float cityFbm3( vec3 p ) {
	return ( cityValueNoise( p ) + cityValueNoise( p * 2.0 ) * 0.5 + cityValueNoise( p * 4.0 ) * 0.25 ) / 1.75;
}

// antialiased filled band, edge sized to the pixel footprint so thin road paint
// stays crisp and does not shimmer
float cityLine( float coord, float halfWidth ) {
	float aa = max( fwidth( coord ), 0.0001 );
	return smoothstep( halfWidth + aa, halfWidth - aa, abs( coord ) );
}

// the same, repeated at every multiple of period ( stripes, scored joints )
float cityGridLine( float coord, float period, float halfWidth ) {
	float g = coord / period;
	float d = 0.5 - abs( fract( g ) - 0.5 );
	float aa = max( fwidth( g ), 0.0001 );
	float hw = halfWidth / period;
	return smoothstep( hw + aa, hw - aa, d );
}
`

export type CitySurfaceShaderOptions = {
	/**
	 * The program cache key. three keys compiled programs on this string alone, so
	 * any material that bakes layout values into its source must return a key that
	 * covers those values.
	 */
	cacheKey: string
	/**
	 * GLSL statements evaluated in the fragment shader. They must assign
	 * `vec3 cityColor` and `float cityRoughness`, and may read
	 * `vCityWorldPosition` / `vCityWorldNormal` and the {@link CITY_GLSL_HELPERS}.
	 */
	body: string
	/** Top-level vertex-shader declarations ( attributes, extra varyings ). */
	vertexProlog?: string
	/** Vertex-shader statements appended to `<begin_vertex>`. */
	vertexBody?: string
	/** Top-level fragment-shader declarations, after {@link CITY_GLSL_HELPERS}. */
	fragmentProlog?: string
	/** When given, must assign `float cityMetalness`. */
	metalnessBody?: string
	/** When given, must assign `vec3 cityEmissive`. */
	emissiveBody?: string
}

/**
 * Dresses a stock `MeshStandardMaterial` with a world-space procedural surface:
 * the material keeps three's lighting, shadows and tone mapping, and only its
 * albedo and roughness are replaced by the supplied GLSL.
 */
export function applyCitySurfaceShader( material: THREE.MeshStandardMaterial, options: CitySurfaceShaderOptions ): void {

	material.onBeforeCompile = ( shader ) => {

		const metalnessReplacement = options.metalnessBody === undefined
			? '#include <metalnessmap_fragment>'
			: [ '#include <metalnessmap_fragment>', options.metalnessBody, 'metalnessFactor = cityMetalness;' ].join( '\n' )
		const emissiveReplacement = options.emissiveBody === undefined
			? '#include <emissivemap_fragment>'
			: [ '#include <emissivemap_fragment>', options.emissiveBody, 'totalEmissiveRadiance = cityEmissive;' ].join( '\n' )

		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				[
					'#include <common>',
					'varying vec3 vCityWorldPosition;',
					'varying vec3 vCityWorldNormal;',
					options.vertexProlog ?? ''
				].join( '\n' )
			)
			.replace(
				'#include <begin_vertex>',
				[
					'#include <begin_vertex>',
					'vec3 cityObjectNormal = objectNormal;',
					'#ifdef USE_INSTANCING',
					'  vec4 cityLocalPosition = instanceMatrix * vec4( transformed, 1.0 );',
					'  mat3 cityInstanceBasis = mat3( instanceMatrix );',
					'  cityObjectNormal /= vec3( dot( cityInstanceBasis[0], cityInstanceBasis[0] ), dot( cityInstanceBasis[1], cityInstanceBasis[1] ), dot( cityInstanceBasis[2], cityInstanceBasis[2] ) );',
					'  cityObjectNormal = cityInstanceBasis * cityObjectNormal;',
					'#else',
					'  vec4 cityLocalPosition = vec4( transformed, 1.0 );',
					'#endif',
					'vCityWorldPosition = ( modelMatrix * cityLocalPosition ).xyz;',
					'vCityWorldNormal = normalize( mat3( modelMatrix ) * cityObjectNormal );',
					options.vertexBody ?? ''
				].join( '\n' )
			)

		shader.fragmentShader = shader.fragmentShader
			.replace( '#include <common>', `#include <common>\n${CITY_GLSL_HELPERS}\n${options.fragmentProlog ?? ''}` )
			.replace(
				'#include <color_fragment>',
				[
					'#include <color_fragment>',
					options.body,
					'diffuseColor.rgb = cityColor;'
				].join( '\n' )
			)
			.replace(
				'#include <roughnessmap_fragment>',
				[
					'#include <roughnessmap_fragment>',
					'roughnessFactor = cityRoughness;'
				].join( '\n' )
			)
			.replace( '#include <metalnessmap_fragment>', metalnessReplacement )
			.replace( '#include <emissivemap_fragment>', emissiveReplacement )

	}

	material.customProgramCacheKey = () => options.cacheKey

}

/** Formats a three color as the linear-space `vec3(...)` literal GLSL wants. */
export function toGlslColor( color: THREE.Color ): string {

	return `vec3( ${color.r.toFixed( 6 )}, ${color.g.toFixed( 6 )}, ${color.b.toFixed( 6 )} )`

}

/** Formats a number as a GLSL float literal. */
export function toGlslFloat( value: number ): string {

	return Number.isInteger( value ) ? `${value}.0` : value.toFixed( 6 )

}
