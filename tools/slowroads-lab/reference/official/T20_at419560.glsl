

    #ifdef WATER_DEPTH
        // Abandon water rendering if it's well under ground
        if(vDepth > 10.0) {
            discard;
        }

        float vDepthFactor;
    #endif

    vec3 camNorm = normalize(vec3(
        camPos.x - wPos.x,
        camPos.y - wPos.y,
        camPos.z - wPos.z
    ));

    float seaDot = dot(camNorm, upvec);

    #if defined(WATER_WAVES) || defined(WATER_DEPTH)

        // Add lightness
        float wave1 = texture2D(waves, vUw).r + 0.1;
        float wave2 = texture2D(waves, vUUw).r + 0.1;

        // Add darkness?
        float wave4 = (texture2D(waves, vUUUw).r + 0.1);
        float wave5 = (texture2D(waves, vUUw - vUw).r + 0.1);

        //// WAVE RIPPLES

        float darkReflect = 0.0;

        #ifdef WATER_DEPTH

            // Disable specular highlights close to shore

            // if(vDepth > -2.0) {
            //     if(vDepth > -1.0) {
            //         darkReflect = 1.0;
            //     } else {
            //         darkReflect = (2.0 + vDepth);
            //     }
            // }

        #endif

        // Extra dark ripples by sea edge
        seaDot += wave4 * wave5 * (0.5 + darkReflect / 4.0);
        // No ripples by sea edge
        seaDot -= wave1 * wave2 * (1.0 - darkReflect);

        //// EDGE HIGHLIGHT

        #ifdef WATER_DEPTH

            // Make it darker closer to the shore for some reason
            // if(vDepth > -5.0) {
            //     vDepthFactor = min(5.0, (5.0 + vDepth)) * 0.1 * (1.0 - wave2);
            //     seaDot += vDepthFactor;
            // }

        #endif

        //// CLAMP SEADOT

        seaDot = min(max(0.0, seaDot), 1.0);

        //// BLEND SKY WITH DARK BY SEADOT

        float seaDotMix = 1.0 - seaDot;
        diffuseColor.rgb = mix(diffuseColor.rgb, body, seaDotMix * seaDotMix);

        //// DARKEN DEPTHS

        #ifdef WATER_DEPTH

        if(vDepth < 0.0) {
            diffuseColor *= 1.0 - min(1.0, vDepth / -15.0) * 0.3;
        }

        #endif

        //// HIGHLIGHTS ON SHALLOW ANGLES

        float sunDotMix = 0.0;

        #ifdef WATER_DEPTH

            // Undo the depth factor so it doesn't mess up the highlights
            if(vDepth > -5.0) {

                seaDot *= 0.7 + 0.3 * (vDepth / -5.0); //0.01;//1.0 - seaDot;//-= 0.1;//(vDepth / -5.0);// * 0.2;

                // seaDot *= max(0.0, (vDepth / -5.0)  * 0.25);
                // seaDot -= vDepthFactor * (1.0 + (max(0.0, (5.0 + vDepth)) / 40.0));
            }



            //// TESTING REFLECTIONS
            /*

            float shoreness = dot(vShoreness, camNorm);// - max(0.0, length(vShoreness) - 1.0);

            if(shoreness < 0.0) {
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.15, 0.03), min(0.95, -shoreness * 50.0));
                seaDot += -shoreness;
            }

            */
            ////


        #endif

        if(seaDot < 0.125) {
            sunDotMix = 1.0 - seaDot * 8.0;
        }

        // Mocking up the transition to dark reflection at the horizon
        // if(sunDotMix > 0.8) {
        //     diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.11, 0.1), sunDotMix * sunDotMix);
        // } else {
        // }
        diffuseColor.rgb = mix(diffuseColor.rgb, highlight, sunDotMix * sunDotMix);


    #else
        float seaDotMix = 1.0 - seaDot;
        diffuseColor.rgb = mix(diffuseColor.rgb, body, seaDotMix * seaDotMix);
    #endif

    //// FINALISE

    // Transparency stuff

    #if defined(WATER_DEPTH)

    // if(vDepth < -20.0) {
    //     diffuseColor.a = 0.8;
    // } else {
    //     diffuseColor.a = 0.5 + (vDepth / -20.0) * 0.3;
    // }

    #endif


