
    vec2 vNormalMapUvOffset = vUv + vUvOffset;

    #ifdef USE_NORMALMAP_OBJECTSPACE

        if(blendNoise <= vAngleBlend) {
            vNormalMapUvOffset.x += 1.0/16.0;
            if(vNormalMapUvOffset.x > 1.0) {
                vNormalMapUvOffset.x -= 1.0;
            }
        }

        // vNormalMapUvOffset.x = min(max(vNormalMapUvOffset.x, 0.0), 1.0);

        // normal = texture2D( normalMap, vNormalMapUvOffset ).xyz * 2.0 - 1.0; // overrides both flatShading and attribute normals

        if(vType < 0.5) {
            normal = textureGrad(normalMap, vNormalMapUvOffset, dFdx(vNormalMapUv), dFdy(vNormalMapUv)).xyz * 2.0 - 1.0;
        } else {
            normal = textureGrad(normalMapB, vNormalMapUvOffset, dFdx(vNormalMapUv), dFdy(vNormalMapUv)).xyz * 2.0 - 1.0;
        }

        #ifdef DOUBLE_SIDED
            normal = normal * faceDirection;
        #endif

        normal = normalize( normal );

        diffuseColor.rgb = vec3(normal.x);

    #elif defined( USE_NORMALMAP_TANGENTSPACE )

        if(blendNoise <= vAngleBlend) {
            vNormalMapUvOffset.x += 1.0/16.0;
            if(vNormalMapUvOffset.x > 1.0) {
                vNormalMapUvOffset.x -= 1.0;
            }
        }


        vec3 mapN;
        if(vType < 0.5) {
            mapN = textureGrad(normalMap, vNormalMapUvOffset, dFdx(vNormalMapUv), dFdy(vNormalMapUv)).xyz * 2.0 - 1.0;
        } else {
            mapN = textureGrad(normalMapB, vNormalMapUvOffset, dFdx(vNormalMapUv), dFdy(vNormalMapUv)).xyz * 2.0 - 1.0;
        }

        mapN.xy *= normalScale;

        normal = normalize( tbn * mapN );

    #elif defined( USE_BUMPMAP )

        normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );

    #endif

    // SNOW
    if(vType < 0.5 && hasSnow) {
        float dotUp = dot(normal, vCameraUp );
        // Note that we use different parameters to the regular trees
        if(dotUp > 0.0) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), min(1.0, dotUp * 8.0));
        }
    }

