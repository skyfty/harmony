

    float fresnel = 1.0 - max( 0.0, dot( normalize(cameraPosition - vFresnelPos), vFresnelNorm ) );

    float lightFresnel = max(0.0, (fresnel - 0.75)) * 4.0 * (1.0 - blendVal * 0.5);
    lightFresnel *= lightFresnel;
    lightFresnel *= (1.0 - vShadow);
    lightFresnel *= fresnelIntensity;
    
    float darkFresnel = 1.0 - min(1.0, fresnel * 1.3333);
    darkFresnel *= fresnelIntensity;
    darkFresnel = 0.25 + min(0.25, max(0.0, darkFresnel - 0.25) * 0.5);

    diffuseColor.rgb *= 1.0 + lightFresnel - darkFresnel;


