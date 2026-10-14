
#ifdef USE_FOG

	uniform vec3 fogColorA;
    uniform vec3 fogColorB;
	uniform vec3 fogColorC;
	varying float vFogDepth;
    varying vec3 vFogPos;
	varying float vFogBlend;
	varying float vHaze;

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else


	#endif

	uniform float fogNear;
	uniform float fogFar;

    uniform float hazeHeight;
    uniform float hazeIntensity;

#endif

