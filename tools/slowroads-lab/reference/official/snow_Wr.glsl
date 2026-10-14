
// divide x/z by turbulence factor/scale factor
// divide time by wind speed factr

vec4 wPos = modelMatrix * vec4( position, 1.0 );

vec2 wuv = vec2(
  transformed.x/50. + time/200.,
  transformed.z/50. + time/200.
);


float noise = texture2D(noiseMap, wuv).r;

// fall speed
transformed.y = mod(mod(transformed.y - offset.y, boxWidth) - time * speed, boxHeight);
transformed.x = mod(transformed.x - offset.x, boxWidth);
transformed.z = mod(transformed.z - offset.z, boxWidth);

transformed.x += noise * 2.;
transformed.z += cos(noise);

//// PROJECT VERTEX

vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_INSTANCING

  mvPosition = instanceMatrix * mvPosition;

#endif

mvPosition = modelViewMatrix * mvPosition;

gl_Position = projectionMatrix * mvPosition;

//// EXCLUSION BY CAM DIST

skip = 0.0;
if(-mvPosition.z < minDist) {
  skip = 1.0;
}

//// BRIGHTNESS

vBrightness = 0.0;

if(headlightOn) {
    wPos = modelMatrix * vec4( transformed, 1.0 );

    vec3 carDir = headlightPos - wPos.xyz;

    // Distance to catseyes,
    float carDist = length(carDir);

    if(carDist < 100.0) {
      // View distance of 150m
      float distBrightnessFactor = 1.0 - (carDist - 25.0) / 75.0;

      // Check
      carDir.y *= 2.75;
      float coneBrightnessFactor = dot(headlightDir, normalize(carDir));
      coneBrightnessFactor = (coneBrightnessFactor - 0.8) / 0.2;


      // NOTE: Could set the road colour here to save on transparency rendering
      vBrightness = distBrightnessFactor * coneBrightnessFactor * 0.7;
    }
}

vBrightness = max(0., vBrightness);


