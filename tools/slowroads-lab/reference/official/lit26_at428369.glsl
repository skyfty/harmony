

    if(vDissolve == 1.0 || texture2D(noiseMap, vMapUv).r < vDissolve) {
        discard;
    }

    float leafEffect = step(diffuseColor.b * 1.5, diffuseColor.g) * vLeafBrightness;

    diffuseColor.rg *= 1.0 - (1.0 - discolouration) * leafEffect;

    totalEmissiveRadiance = vec3(diffuseColor.rg * 8.0, 0.5) * radiance * leafEffect * vRadianceBlend;
    diffuseColor.rgb *= vRadianceBlend;


