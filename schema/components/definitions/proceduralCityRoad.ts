/**
 * The road surface: wet asphalt with lane lines and continental crosswalks,
 * aligned to a block layout.
 *
 * This is a WebGL port of `createRoadMaterial( layout )` from three's r180
 * `CityGenerator` ( MIT License, https://github.com/mrdoob/three.js ). The
 * upstream version is a TSL node material — WebGPU only — so the same maths is
 * written here as GLSL and injected into a stock `MeshStandardMaterial`, which
 * keeps three's lighting and shadows. Colors, thresholds, periods and the
 * distance-based detail fades are copied from upstream; the height-field normal
 * ( the sub-centimetre aggregate grain ) is the one term left out.
 */

import * as THREE from 'three'
import type { ProceduralCityBlockLayout } from './proceduralCityBlock'
import { applyCitySurfaceShader, toGlslColor, toGlslFloat } from './proceduralCityGlsl'

// wet asphalt: a warm-grey base in patchwork pours
const ROAD_BASE_DARK = 0x24262b
const ROAD_BASE_LIGHT = 0x3b3f46
const ROAD_PAINT_COLOR = 0xd0ccc0

// how far the aggregate / wear / paint detail resolves
const ROAD_DETAIL_NEAR = 25
const ROAD_DETAIL_FAR = 240
const ROAD_MICRO_NEAR = 4
const ROAD_MICRO_FAR = 22

// the crosswalk band along each block edge, and the bar period and width
const CROSSWALK_NEAR_EDGE = 5
const CROSSWALK_BAR_PERIOD = 1.2
const CROSSWALK_BAR_HALF_WIDTH = 0.38

// lane paint, and the dash period down each street
const LANE_CENTRE_HALF_WIDTH = 0.12
const LANE_DIVIDER_HALF_WIDTH = 0.1
const LANE_DASH_PERIOD = 7

/**
 * Builds the road material for a layout. The layout dimensions are baked into
 * the shader source, so the returned material is layout specific and the caller
 * owns it ( dispose it, and do not share it across layouts ).
 */
export function createProceduralCityRoadMaterial( layout: ProceduralCityBlockLayout ): THREE.MeshStandardMaterial {

	const periodX = layout.blockW + layout.street
	const periodZ = layout.blockD + layout.street

	const body = `
	vec3 cityWorld = vCityWorldPosition;
	float cityDistance = distance( cityWorld, cameraPosition );
	float cityDetail = smoothstep( ${toGlslFloat( ROAD_DETAIL_FAR )}, ${toGlslFloat( ROAD_DETAIL_NEAR )}, cityDistance );
	float cityMicroFade = smoothstep( ${toGlslFloat( ROAD_MICRO_FAR )}, ${toGlslFloat( ROAD_MICRO_NEAR )}, cityDistance );

	float cityBlotch = cityFbm3( cityWorld * 0.2 ) * 0.5 + 0.5;

	// close-range detail only resolves near the camera, so its noise is sampled
	// ( inside the branch ) only where the fade is non-zero, and skipped across the
	// far majority of the road
	float cityGrit = 0.0;
	float cityStain = 0.0;
	float cityWorn = 1.0;
	float cityMicro = 0.0;

	if ( cityDetail > 0.0001 ) {
		cityGrit = ( cityValueNoise( cityWorld * 7.0 ) + cityValueNoise( cityWorld * 23.0 ) ) * 0.5;
		cityStain = smoothstep( 0.5, 0.85, cityFbm3( cityWorld * 0.45 ) * 0.5 + 0.5 );
		cityWorn = smoothstep( 0.25, 0.7, cityFbm3( cityWorld * 0.7 ) * 0.5 + 0.5 ) * 0.55 + 0.35;
	}

	if ( cityMicroFade > 0.0001 ) {
		// upstream feeds this into the height-field normal; kept only so the paint
		// and asphalt terms below read the same as the reference
		cityMicro = cityValueNoise( cityWorld * 45.0 ) * 0.6 + cityValueNoise( cityWorld * 80.0 ) * 0.4;
	}

	vec3 cityBase = mix( ${toGlslColor( new THREE.Color( ROAD_BASE_DARK ) )}, ${toGlslColor( new THREE.Color( ROAD_BASE_LIGHT ) )}, cityBlotch );
	vec3 cityGritty = cityBase * ( cityGrit * 0.22 * cityDetail + 1.0 );
	vec3 cityAsphalt = mix( cityGritty, cityGritty * 0.5, cityStain * 0.5 * cityDetail );

	float cityWet = smoothstep( 0.6, 0.85, cityFbm2( cityWorld * 0.14 ) * 0.5 + 0.5 );

	// markings, aligned to the block / street grid. cityFx, cityFz are the position
	// within one block + street period; the street is the [ blockW, period ) part
	float cityPeriodX = ${toGlslFloat( periodX )};
	float cityPeriodZ = ${toGlslFloat( periodZ )};
	float cityFx = mod( cityWorld.x + ${toGlslFloat( layout.cityW / 2 )}, cityPeriodX );
	float cityFz = mod( cityWorld.z + ${toGlslFloat( layout.cityD / 2 )}, cityPeriodZ );
	float cityInStreetX = step( ${toGlslFloat( layout.blockW )}, cityFx );
	float cityInStreetZ = step( ${toGlslFloat( layout.blockD )}, cityFz );
	float citySu = cityFx - ${toGlslFloat( layout.blockW )};
	float citySv = cityFz - ${toGlslFloat( layout.blockD )};

	// lane markings down each street ( not through intersections ): a solid centre
	// line splitting the two directions, with a dashed divider in each half, so
	// every street carries four lanes
	float cityDashV = step( fract( cityWorld.z / ${toGlslFloat( LANE_DASH_PERIOD )} ), 0.5 );
	float cityDashH = step( fract( cityWorld.x / ${toGlslFloat( LANE_DASH_PERIOD )} ), 0.5 );

	float cityCentreV = cityLine( citySu - ${toGlslFloat( layout.street / 2 )}, ${toGlslFloat( LANE_CENTRE_HALF_WIDTH )} );
	float cityDividerV = max( cityLine( citySu - ${toGlslFloat( layout.street / 4 )}, ${toGlslFloat( LANE_DIVIDER_HALF_WIDTH )} ), cityLine( citySu - ${toGlslFloat( layout.street * 3 / 4 )}, ${toGlslFloat( LANE_DIVIDER_HALF_WIDTH )} ) ) * cityDashV;
	float cityLaneV = max( cityCentreV, cityDividerV ) * cityInStreetX * ( 1.0 - cityInStreetZ );

	float cityCentreH = cityLine( citySv - ${toGlslFloat( layout.street / 2 )}, ${toGlslFloat( LANE_CENTRE_HALF_WIDTH )} );
	float cityDividerH = max( cityLine( citySv - ${toGlslFloat( layout.street / 4 )}, ${toGlslFloat( LANE_DIVIDER_HALF_WIDTH )} ), cityLine( citySv - ${toGlslFloat( layout.street * 3 / 4 )}, ${toGlslFloat( LANE_DIVIDER_HALF_WIDTH )} ) ) * cityDashH;
	float cityLaneH = max( cityCentreH, cityDividerH ) * cityInStreetZ * ( 1.0 - cityInStreetX );

	// continental crosswalk bars ( long in the travel direction ) in each street
	// arm, near the block edges it meets
	float cityNearZ = max( step( cityFz, ${toGlslFloat( CROSSWALK_NEAR_EDGE )} ), step( ${toGlslFloat( layout.blockD - CROSSWALK_NEAR_EDGE )}, cityFz ) );
	float cityNearX = max( step( cityFx, ${toGlslFloat( CROSSWALK_NEAR_EDGE )} ), step( ${toGlslFloat( layout.blockW - CROSSWALK_NEAR_EDGE )}, cityFx ) );
	float cityCrossV = cityGridLine( citySu, ${toGlslFloat( CROSSWALK_BAR_PERIOD )}, ${toGlslFloat( CROSSWALK_BAR_HALF_WIDTH )} ) * cityInStreetX * ( 1.0 - cityInStreetZ ) * cityNearZ;
	float cityCrossH = cityGridLine( citySv, ${toGlslFloat( CROSSWALK_BAR_PERIOD )}, ${toGlslFloat( CROSSWALK_BAR_HALF_WIDTH )} ) * cityInStreetZ * ( 1.0 - cityInStreetX ) * cityNearX;

	float cityPaint = max( max( cityLaneV, cityLaneH ), max( cityCrossV, cityCrossH ) ) * cityDetail * cityWorn;

	vec3 citySurface = mix( cityAsphalt, cityAsphalt * 0.6, cityWet );
	vec3 cityColor = mix( citySurface, ${toGlslColor( new THREE.Color( ROAD_PAINT_COLOR ) )}, cityPaint ); // worn white paint
	float cityRoughness = mix( 0.95 - cityPaint * 0.2, 0.32, cityWet );
	`

	const material = new THREE.MeshStandardMaterial()
	applyCitySurfaceShader( material, { cacheKey: `procedural-city-road:${periodX}x${periodZ}:${layout.cityW}x${layout.cityD}`, body } )
	material.userData.proceduralCityOwned = true

	return material

}

/**
 * A flat ground plane carrying {@link createProceduralCityRoadMaterial}, sized to
 * the city grid and centred on it. Sized to the grid exactly: the layout puts
 * every street *between* blocks, so the plane covers them all and the pattern
 * stops at the city's edge instead of tiling into the surrounding terrain.
 */
export function createProceduralCityRoadMesh( layout: ProceduralCityBlockLayout ): THREE.Mesh {

	const material = createProceduralCityRoadMaterial( layout )
	const geometry = new THREE.PlaneGeometry( layout.cityW, layout.cityD )
	geometry.rotateX( - Math.PI / 2 )

	const mesh = new THREE.Mesh( geometry, material )
	mesh.name = 'CityRoad'
	mesh.receiveShadow = true
	mesh.userData.proceduralCityOwned = true

	return mesh

}
