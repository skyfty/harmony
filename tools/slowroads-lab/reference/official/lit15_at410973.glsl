

float fade0 = texture2D(fadeFine, vUv).r;
float fade1 = texture2D(fadeFine, vUUv).r;
float fade2 = texture2D(fadeFine, vWv).r;

//// PREP MAP

vec4 texelColor = texture2D( grassMap, vUv );
//// DETAIL TEXTURING

float blendVal  = (1.0 - texture2D( detailFarMap, vWWv ).r);
float blendValB = (1.0 - texture2D( detailFarMap, vWv ).r);
float blendValC = (1.0 - texture2D( detailFarMap, vUUv).r);


blendValB = screen(blendValC, blendValB);
blendValB *= min(1.0, blendVal * 10.0);

// Reduce on winter?
if(seasonIndex == 3) {
  blendValB *= 0.7;
}

// Elevation alteration to large-scale blend
blendVal *= (0.6 + 0.4 * vLightGrass);

// Enhance the distant intensity relative to medium/close range
blendVal *= 2.0;

// Blend from large-scale to medium-scale
float depthLerpFar = saturate(vCamDepth / 800.0);
blendVal = blendVal * depthLerpFar + (1.0 - depthLerpFar) * blendValB;

// Large-scale texture toned down for fields
float fieldFactor = ceil(abs(vField));
// blendVal *= 1.0 - fieldFactor * 0.25;

// Depth for far
blendVal *= saturate(0.4 + 0.6 * (vCamDepth / 300.0));

// Dotty noisy...
blendVal += (1.0 - texture2D( detailNearMap, vUUv ).r ) * (0.7 + vLightGrass * 0.3);

//// GRASS COLOUR MIX

// Blend them into two colours

float variationVal = texture2D(grassVariationMap, vWWv).r - 0.5;
float closeVariation = ((1.0 - texture2D(grassVariationMap, vWv).r) - 0.5);

float grassBlend = (screen(fade1, fade0) + vDarkGrass) / 2.0;

// Square for more effect?
grassBlend = grassBlend * grassBlend;

grassBlend = saturate(grassBlend + variationVal + closeVariation);

float lightGrassFactor = saturate(vLightGrass + variationVal - closeVariation);

// Colour the grass tips versus base
lightGrassFactor = saturate(lightGrassFactor * 2.0 * texelColor.r);

vec3 grassCol = mix(
  mix(grassColA, grassColB, grassBlend),
  mix(peakColA, peakColB, grassBlend),
  lightGrassFactor
);

//// APPLY GRASS COLOUR

texelColor.rgb *= grassCol;

//// FIELDS

if(vField != 0.0) {

  // Rough lines using noise
  // Note that we step on vField for simplicity - should consider a separate varying for field mow dir though
  float fadeField = texture2D(
    fadeFine,
    vec2(
      vWv.x * 2.0 * step(0.001, vField),
      vWv.y * 2.0 * (1.0 - step(0.001, vField))
    )
  ).r;

  texelColor.rgb += vField * fieldDiscolouration * fadeField;

}

//// HEATHER


if(vHeather > 0.0) {

  vec4 heatherCol = texture2D(heatherMap, vUv);

  float depthLerp = 0.25 + 0.75 * min(1.0, vCamDepth / 400.0);
  heatherCol = mix(heatherCol, texture2D( heatherMap, vWv ), depthLerp);
  
  heatherCol = mix(texelColor, heatherCol, min(1.0, vHeather));
  heatherCol.a = heatherCol.r;
  texelColor.a = texelColor.g;
  texelColor = terrainBlend(
      texelColor,
      1.0 - vHeather,
      heatherCol,
      vHeather,
      0.1
  );
  
}
  
// Apply detail texture
texelColor *= 1.0 - blendVal;


//// TREE MASK

vec4 forestCol = texture2D(forestMap, vUv);
forestCol.a = forestCol.r * 2.0 * fade2;

float fTreeMask = min(1.0, vTreeMask);

if(fTreeMask > 0.0) {

  texelColor = terrainBlend(
    texelColor,
    1.0-fTreeMask,
    forestCol,
    fTreeMask,
    0.1 + (1.0 - fTreeMask) * fade0 * 0.9
  );

  texelColor.a = 1.0;
}


//// SAND BLEND

float vHeight = height + min(1.0, height+0.5) * (fade2 * 2.0 + (fade0 + fade2) * 0.5);

if(vHeight < 4.0 && seasonIndex < 3) {

  float dark = 1.0;

  if(vHeight < 0.0) {
    texelColor = texture2D(sandMap, vUv) * 0.75;
  } else {

    if(vHeight < 2.0) {

      // Darken toward water
      dark = min(dark, 1.0 - (2.0 - vHeight) / 4.0);

    } else if(vHeight > 2.5) {

      // Darken into the grass
      dark = 1.0 - (vHeight-2.5) / 2.0;

    }

    // Lerp from grass to thingy
    float lerp = max(0.0, (vHeight - 1.0) / 3.0);

    vec4 sandCol = texture2D(sandMap, vUv);

    texelColor.a = texelColor.r;

    sandCol.a = sandCol.r;

    // Apply shading based on water/grass proximity
    sandCol.rgb *= dark;

    texelColor = terrainBlend(
      texelColor,
      lerp,
      sandCol,
      1.0 - lerp,
      0.05
    );

    // texelColor = mix(texture2D(sandMap, vUv) * dark, texelColor, height / 4.0);

    // texelColor = terrainBlend(
    //   texture2D(sandMap, vUv) * dark,
    //   dark,
    //   texelColor,
    //   texelColor.g,
    //   height / 4.0
    // );
  }
}

//// ROADSIDE GRAVEL

if(seasonIndex < 3 && hasRoadProx > 0.5) {

  if(roadProx < -0.2 && (vCamDepth > 100.0 || seasonIndex == 1)) {

    texelColor.rgb = roadCol;

  } else if(roadProx + fade2 * 0.1 < 0.5 * fade0) {

    float rp = saturate(1.0 - (roadProx + fade2 * 0.1) / (0.5 * fade0));

    // Mix into forest colour if we're under trees
    if(seasonIndex != 1 && vShadow > 0.0) {

      float gravelBrightness = 1.3;
      if(seasonIndex == 2) {
        gravelBrightness = 1.8;
      }

      texelColor = mix(

        mix(
          texture2D(
            gravelMap,
            vUv*2.0
          ),
          forestCol * gravelBrightness,
          min(1.0, vShadow * 2.0)
        ),

        texelColor,

        smoothstep(
          0.0, 
          rp,
          texelColor.g / rp
        )
      );

    } else {

      texelColor = mix(
        texture2D(gravelMap, vUv*2.0) * (0.75 + rp * rp * 0.75),
        texelColor,
        smoothstep(
          0.0, 
          rp,
          texelColor.g / rp
        )
      );      
    }

  }

}

//// STEEPNESS CLIFF

// Note we do a branch here since cliffs take up such a small portion of the space; worthwhile
if(steepness > 0.1) {

  float steepBlend = 1.0 - steepness;
  rockTex = mix(
    texture2D(rockMap, vUv),
    texture2D(rockMap, vUUv),
    saturate((vCamDepth - 20.0) / 130.0) // Blend by proximity
  );
  
  // Gradual distance-based blend
  rockTex.a = texture2D(rockMapBump, vUv).r * texture2D(rockMapBump, vUUv).r;
  
  // Blend according to steepness etc.
  texelColor.a = 0.2 + fade2 * 0.2;
  
  // Lower steep blend is more snow?
  // float steepBlend = 1.0 - steepness; // Reduce steepess factor to reduce rockiness
  // Reduce the depth value to increase sharp transition from snow to rock
  texelColor = terrainBlend(texelColor, steepBlend, rockTex, (1.0 - steepBlend), 0.08);
  texelColor.a = 1.0;
}

//// PREVENT GLITTERING PIXELS

texelColor.r = saturate(texelColor.r);
texelColor.g = saturate(texelColor.g);
texelColor.b = saturate(texelColor.b);

//// PREP EMISSIVE?

// NOTE this must match the grass sprites. Ideally share a chunk?

totalEmissiveRadiance = texelColor.rgb * radiance;

//// FINAL COMPOSITION

diffuseColor *= texelColor;

// DEBUG COLOURS
// diffuseColor = vec4(vHeather, vCurvature, 0.0, 1.0);
// diffuseColor.rgb = vNormal.rgb;
// diffuseColor = vec4(vec3(vLightGrass), 1.0);

// Clamp to reduce glittering pixels? Needs a better fix though... this is a last resort



