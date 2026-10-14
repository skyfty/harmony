

#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );

	#endif


    // fogBlend to be 1 when looking up, 0 at horizon
    float fogBlend = max(horizonOpacity, min((vStarHeight - horizonOffset)/horizonScale, 1.0));

	gl_FragColor.rgb = mix(fogColorA, gl_FragColor.rgb, fogBlend );

#endif


