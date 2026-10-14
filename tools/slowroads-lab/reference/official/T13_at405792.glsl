

vec4 wPos = modelMatrix * vec4( position, 1.0 );

vFresnelPos = wPos.xyz;
vFresnelNorm = normalize( vec3( vec4( normal, 0.0) * modelMatrix ) );

height = wPos.y;

// Set UVs from world pos
vUv.x = wPos.x / 10.0;
vUv.y = wPos.z / 10.0;

vUUv.x = vUv.x / 10.0;
vUUv.y = vUv.y / 10.0;

// 0 is perfectly flat, 1 is 90 degrees
steepness = 0.98 - dot(normal, upvec);
steepness = clamp(steepness * 1.4, 0.0, 1.0); // was multiplied by 2 before..?

vWv.x = wPos.x / wuvSize;
vWv.y = wPos.z / wuvSize;

vWWv.x = vWv.x / 8.0;
vWWv.y = vWv.y / 8.0;

//// GET FADES

float fade0 = texture2D(fadeFine, vWv).r;
float fade1 = texture2D(fadeFine, vWWv).r;

// Reduce  vWWv for more utility in the fragment shader
vWWv *= 2.0;

//// HEATHER

vHeather = smoothstep(0.4, 1.0, ((height + fade1 * 350.0) - 60.0) / 500.0);

vHeather *= screen(fade1, fade0);

vHeather = smoothstep(0.3, 0.6, vHeather);


//// GRASSES

float heightVal = min(1.0, max(0.0, (height - (30.0 + fade1 * 40.0))/150.0));

vLightGrass = min(1.0, heightVal * (fade0 + heightVal * 0.5));

// Keep it green close to road?
if(roadProximity > 0.0 && roadProximity < 0.5 + fade0) {

  vHeather *= roadProximity / (0.5 + fade0);

  if(seasonIndex < 3) {
    vLightGrass *= roadProximity / (0.5 + fade0);
  }
}  

vDarkGrass = min(max(0.0,(fade1 - 0.25) * 2.0), 1.0);

vField = fieldCol;

//// ROAD PROX

roadProx = roadProximity;
// Not safe but sets a flag for the frag shader to exit road-relative shading
hasRoadProx = step(0.00001, abs(roadProximity));

// Prevent rocks forming below the road, e.g. at bridges.
float underRoadFactor = 1.0 - step(0.000001, -roadProx);
steepness *= underRoadFactor;
vHeather *= underRoadFactor;

// if(roadProx < 0.0) {
//   steepness = 0.0;
//   vHeather = 0.0;
// }


//// SHADOW

vShadow = min(1.0, treeMask * min(1.0, max(0.0, height / 4.0)));


//// TREE MASK

vTreeMask = vShadow;

if(vTreeMask > 0.1) {
  vTreeMask = max(0.2, vTreeMask);
} else {
  vTreeMask = 0.0;
}

// Road-dependent factors
if(hasRoadProx > 0.5) {

  vTreeMask *= clamp(roadProx / 2.0, 0.0, 1.0);

  float intensity = clamp((16.0 - roadProx) / 6.0, 0.0, 1.0);

  intensity *= 0.8; // Scale it a bit

  transformed += normalize( objectNormal ) * ( (texture2D( displacementMap, vUUv ).x - 0.4) * min(1.0, steepness * 3.0) ) * intensity;

}

//// MV POSITION

vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );

//// OVERLAP SINK

// TODO Use actual distance probably?

//// Curvature
// float ddist = -mvPosition.z;
// float ssink = ddist / 1000.0;
// ssink *= ssink;
// transformed.y -= ssink * 50.0;
// // Recalc mvPosition
//   mvPosition = modelViewMatrix * vec4( transformed, 1.0 );

if(overlap > 0.0) {

    float overlapDist = overlap - vehicleIndex;

    if(overlapDist > 0.0) {

      if(overlapDist < sinkDist) {

          float halfSinkDist = sinkDist * 0.75;

          if(overlapDist < halfSinkDist) {
            transformed.y -= 20.0;
          } else {
            transformed.y -= 20.0 * (sinkDist - overlapDist) / (sinkDist - halfSinkDist);
          }
      }

    } else {

      float fSinkDist = -sinkDist/2.0;

      if(overlapDist > fSinkDist) {

        float halfSinkDist = fSinkDist / 2.0;

        if(overlapDist > halfSinkDist) {
          transformed.y -= 20.0;
        } else {
          transformed.y -= 20.0 * (fSinkDist - overlapDist) / halfSinkDist;
        }

      }

    }

    // Recalc mvPosition
    mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
}

gl_Position = projectionMatrix * mvPosition;

vCamDepth = -mvPosition.z;

// vLightGrass = 0.0;
// vDarkGrass = 0.0;

vShadow *= shadowFactor;


