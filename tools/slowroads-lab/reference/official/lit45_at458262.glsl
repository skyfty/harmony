

    // Need to alter vLightGrass
    vec4 texelColor = texture2D( map, vUv + vUvOffset );// * (1.0 - vLightGrass * 0.25);

    // Make opaque for debug
    // texelColor.a = 1.0;

    // Limit darkness by distance?
    // texelColor.rgb = vec3(max(texelColor.r, darkness));

    if(doColor > 0.5) {

        // Shared with ground.glsl - TODO share a chunk instead?

        float fade0 = texture2D(noiseMap, vGv).r;
        float fade1 = texture2D(noiseMap, vGGv).r;        

        float variationVal = texture2D(grassVariationMap, vWWv).r - 0.5;
        float closeVariation = ((1.0 - texture2D(grassVariationMap, vWv).r) - 0.5);

        float grassBlend = (screen(fade0, fade1) + vDarkGrass) / 2.0;
        grassBlend = grassBlend * grassBlend;

        grassBlend = saturate(grassBlend + variationVal + closeVariation);

        float lightGrassFactor = saturate(vLightGrass + variationVal - closeVariation);

        lightGrassFactor = saturate(lightGrassFactor * 2.0 * texelColor.r);

        vec3 grassCol = mix(
            mix(grassColA, grassColB, grassBlend),
            mix(peakColA, peakColB, grassBlend),
            lightGrassFactor
        );

        // Detail noise
        float detailNoise = 1.0 - (1.0 - texture2D( detailFarMap, vWv ).r) * 0.7;

        texelColor.rgb *= grassCol * detailNoise;

    } else {
        if(texelColor.a < 0.98) {
            // Lazy fix for heather white pixels
            discard;
        }

        // Dappled brightness
        texelColor.rgb *= 1.0 + (texture2D(noiseMap, vGv).r - 0.6);        
    }



    diffuseColor *= texelColor;


    //// PREP EMISSIVE?

    // NOTE this must match the ground. Ideally share a chunk?
    totalEmissiveRadiance = texelColor.rgb * radiance;



