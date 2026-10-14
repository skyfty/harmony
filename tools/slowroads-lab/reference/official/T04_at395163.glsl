
#ifdef USE_FOG

	// Cylindrical
	//float fogDepth = distance(vFogPos, cameraPosition);

	float fogBlend = max(((vFogPos.y - cameraPosition.y) * 2.0) / distance(vFogPos, cameraPosition), 0.0) * vFogBlend;

	//// DESATURATION EFFECT
	gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColorC, vHaze);

	gl_FragColor.rgb = mix( gl_FragColor.rgb, mix(fogColorA, fogColorB, fogBlend), vFogDepth );

#endif

