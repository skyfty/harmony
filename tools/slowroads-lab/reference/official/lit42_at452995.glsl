

    vUv = uv;

    vec4 wPos = modelMatrix * instanceMatrix * vec4(1.0);
    vec4 iPos = modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);

    vFresnelPos = wPos.xyz;
    vFresnelPos.y -= 1.0; // Subtract the sprite midpoint to get the ground position?

    vFresnelNorm = groundNormal;

    // Grass colouration UVs
    vGv.x = iPos.x / 10.0;
    vGv.y = iPos.z / 10.0;

    vGGv.x = vGv.x / 16.0;
    vGGv.y = vGv.y / 16.0;

    vWv.x = iPos.x / wuvSize;
    vWv.y = iPos.z / wuvSize;

    vWWv.x = vWv.x / 8.0;
    vWWv.y = vWv.y / 8.0;

    //// GET FADES

    float fade0 = texture2D(noiseMap, vWv).r;
    float fade1 = texture2D(noiseMap, vWWv).r;

    // REduce vWWv to match ground shader
    vWWv *= 2.0;

    // objectNormal = groundNormal;
    vNormal = normalMatrix * groundNormal; // mat3(inverse(transpose(modelMatrix * instanceMatrix)));

    vRoadProx = roadProx;

    vShadow = min(1.0, shadow * min(1.0, max(0.0, wPos.y / 4.0)));

    // Get uvLookup  from variant
    /* Indexed into the texture as such:

        2 | 3
        - + -
        0 | 1

    */

    //// VARIANT SELECTION


    float v = texture2D(noiseMap, vGGv).r;

    float variant = 1.0;

    // CHECK HEATHER - has to match the ground function
    // Might want to find something cheaper to do here?
    float heather = smoothstep(0.4, 1.0, ((iPos.y + fade1 * 350.0) - 60.0) / 500.0);
    heather *= screen(fade1, fade0);
    // heather = smoothstep(0.3, 0.6, heather);
    if(vShadow < 0.1 && heather > 0.38 + v / 6.0 ) {
        variant = 3.0;

        if(roadProx > 1.0) {
            transformed.y -= v * 0.2;
        } else {
            transformed.y -= v * 0.2 * roadProx;
        }
    }


    if(vRoadProx < v * 2.0 + 0.2) {
        // Little grass
        variant = 0.0;
    } else if(variant < 3.0 && ( iPos.y > 100.0 && v + fade0 > 1.75 - (iPos.y - 50.0) / 250.0 ) || vShadow > v * 2.0 ) {

       // big grass

        variant = 2.0;
    } else if(variant == 3.0) {
        transformed.xyz *= 0.5 + fade0 * 1.5;
    }



    doDiscard = 0.0;
    doColor = 0.0;
    if(variant < 3.0) {
        doColor = 1.0;

        // SET UP GRASS COLOURATION PARAMS


        float heightVal = min(1.0, max(0.0, (iPos.y - (30.0 + fade1 * 40.0))/150.0));

        vLightGrass = min(1.0, heightVal * (fade0 + heightVal * 0.5));

        vDarkGrass =  min( max( 0.0, (fade1 - 0.25) * 2.0), 1.0);

        if(vRoadProx < 0.5 + fade1) {
            vLightGrass *= max(0.5, vRoadProx / (0.5 + fade1));
        }
    }

    vUvOffset.x = variant * 0.25;
    vUvOffset.y = 0.0;

    // Need to replace projectVertex here so we can get mvPosition




    // Limit darkness by thingy
    // darkness = min(0.5, -tPos.z / sproutNear);

    //// MODIFY MV POSITION

    float dist = (iPos.x - cameraPosition.x)*(iPos.x - cameraPosition.x) + (iPos.z - cameraPosition.z)*(iPos.z - cameraPosition.z);

    cameraDist = dist;

    // Sink with distance
    transformed.y -= saturate((dist - sproutNear) / (sproutFar - sproutNear)) * 0.5;

    // And with proximity to the car?
    if(flatten) {
        float vehDist = (iPos.x - vehiclePos.x)*(iPos.x - vehiclePos.x) + (iPos.z - vehiclePos.z)*(iPos.z - vehiclePos.z);
        float vehFlatten = 1.0 - saturate((vehiclePos.y - 0.5) - iPos.y);
        // transformed.y -= (1.0 - saturate(vehDist / 2.0)) * vehFlatten * 0.5;
        transformed.y *= 1.0 - (1.0 - saturate(vehDist / 2.0)) * vehFlatten;
    }

    // Scale to 0 if no longer visible to save fragments?
    transformed *= 1.0 - step(sproutFar, dist);

    // Crop depending on variant and season

    if(seasonIndex < 3) {

        // First two variants and last variant halved
        float cropY = 1.0 - 0.5 * step(0.5, abs(variant - 2.0));
        transformed.y *= cropY;
        vUv.y *= cropY;

    } else {

        // Winter, first two options are crushed to 0

        float vStep = step(1.5, variant);
        transformed.xz *= vStep;
        transformed.y *= vStep * 0.5;
        vUv.y *= vStep * 0.5;

    }
    
    // if(variant < 2.0) {
    //     transformed.y *= 0.5;
    //     vUv.y *= 0.5;
    // }

    #include <project_vertex>


    // ANIMATION TESTING
    // float tt = time * 0.05;
    // vec2 blowUV = vec2(vGGv.x + tt, vGGv.y + tt);
    // if(uv.y > 0.5) {
    //     float blow = texture2D(noiseMap, blowUV).r;
    //     transformed.x += blow * 0.2;//sin(blow) * 0.2;
    //     transformed.z += blow * 0.2;//cos(blow) * 0.2;
    // }

    vShadow *= shadowFactor;


