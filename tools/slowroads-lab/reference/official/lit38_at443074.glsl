

    // Early discard
    if(vDissolve > 0.999) {
        discard;
    }

    vec4 texelColor;

    if(vType < 0.5) {
        texelColor = texture2D( map, vUv + vUvOffset );
    } else {
        // Map B
        texelColor = texture2D( mapB, vUv + vUvOffset );
    }

    // Transform uvs to square to  sample from noise texture

    float blendNoise = 0.0;
    if(vAngleBlend > 0.0) {

        blendNoise = texture2D(noiseMap, vUvBlend).r;

        //// DIRECT APPROACH
        vec2 blendUV = vUv + vUvOffset + vec2(1.0 / 16.0, 0.0);
        if(blendUV.x > 1.0) {
            blendUV.x -= 1.0;
        }
        if(vType < 0.5) {
            texelColor = mix(texelColor, texture2D( map, blendUV ), step(blendNoise, vAngleBlend));
        } else {
            texelColor = mix(texelColor, texture2D( mapB, blendUV ), step(blendNoise, vAngleBlend));
        }

        //// GRADIENT APPROACH
        // Blend to next texture by angle offset?
        // if(blendNoise < vAngleBlend) {

        //     vec2 blendUV = vUv + vUvOffset + vec2(1.0 / 16.0, 0.0);

        //     if(blendUV.x > 1.0) {
        //         blendUV.x -= 1.0;
        //     }
    
        //     if(vType < 0.5) {
        //         texelColor = textureGrad(map, blendUV, dFdx(blendUV), dFdy(blendUV));
        //     } else {
        //         texelColor = textureGrad(mapB, blendUV, dFdx(blendUV), dFdy(blendUV));
        //     }

        // }

        // Dissolve on approach
        texelColor.a *= step(vDissolve, blendNoise);
    }


    diffuseColor *= texelColor;


