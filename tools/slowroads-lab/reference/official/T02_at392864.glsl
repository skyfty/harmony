
#ifdef USE_FOG

    vFogPos = (modelMatrix * vec4(position, 1.0)).xyz;
    #ifdef USE_INSTANCING
        vFogPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
    #endif


	//// FOG DEPTH

	// FLAT - can I do this if cheap?
	// float fogDepth = -mvPosition.z;

	// CYLINDRICAL
	// If cylindrical, have to pass in camera position to everything using fog. Do this in a module patch?
	float fogDepth = distance(vFogPos, cameraPosition);

	vHaze = fogDepth / fogFar;// * 0.5;
	// vHaze *= vHaze;
	vHaze *= 1.0 + min(0.0, hazeIntensity);	

	#ifdef FOG_EXP2
		vFogDepth = max(0.0, (fogDepth - fogNear) * (fogFar / (fogFar - fogNear)));
		vFogDepth = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else

		vFogDepth = smoothstep( fogNear, fogFar, fogDepth );
	#endif

	//// NOISE VARIATION
	float fogHeight = vFogPos.y;
	#ifdef FOG_EXP2
	    if(fogDepth < 1000.0) {
			fogHeight += pNoise(vFogPos.xz*2.0, 3) * hazeHeight * (fogDepth / 1000.0);
		} else {
			fogHeight += pNoise(vFogPos.xz*2.0, 3) * hazeHeight;
		}
	#endif

    //// HAZE
    if(hazeHeight > 0.0 && fogHeight < hazeHeight) {

		float haze = (1.0 - (fogHeight / hazeHeight)) * hazeIntensity;

		if(fogDepth < 50.0) {
			float fff = 1.0 - (fogDepth / 50.0);
			haze *= 1.0 - fff*fff;
		}

		if(haze < 0.0) {
			haze = 0.0;
		}

		vFogDepth += haze;

    } else if(hazeHeight < 0.0 && fogHeight > -hazeHeight) {

		float haze = min(1.0, (fogHeight / -hazeHeight) - 1.0) * hazeIntensity;

		if(fogDepth < 50.0) {
			float fff = 1.0 - (fogDepth / 50.0);
			haze *= 1.0 - fff*fff;
		}

		vFogDepth += haze;
    }


	float fogAvg = (fogFar + fogNear) / 2.0;
	vFogBlend = 1.0;
	if(fogAvg < 500.0) {
		if(fogAvg <  50.0) {
			vFogBlend = 0.0;
		} else {
			vFogBlend = (fogAvg-50.0) / 450.0;
		}
	}

	if(hazeHeight < 0.0) {
	    vFogBlend *= (1.0 - hazeIntensity);
	}

	//// LIMIT
	vFogDepth = min(1.0, vFogDepth);

#endif

