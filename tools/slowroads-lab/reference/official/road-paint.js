// slowroads.io shipped bundle excerpt: road material shader chunk (`$i` object with
// pars_vert / vert / pars_frag / frag) — paint decals, overlay and bridge alpha.
// Source: %TEMP%/sr/js/chunks__DevMidlineGenerator.7013ef99.js @481400-482900.
// Note: paint textures are sampled with the *un-stretched* uv (vMapUv) while the base
// map/overlay use vRoadUv = (u, v / textureStretch).
//
       uniform bool hasOverlay;

        uniform bool hasPaint;

        uniform sampler2D dashedMap;
        // uniform sampler2D dashedLongMap;
        uniform sampler2D solidMap;
        uniform sampler2D solidLeftMap;
        uniform sampler2D solidRightMap;
        uniform sampler2D mergeLeftMap;
        uniform sampler2D mergeRightMap;

        varying float vBridge;
        varying float vSolid;
        varying float vSolidLeft;
        varying float vSolidRight;
        varying float vMergeLeft;
        varying float vMergeRight;
        varying float vOverlayFactor;

        varying vec2 vRoadUv;
    `,frag:`
        #ifdef USE_MAP

            //// BASE            

            vec4 texelColor = texture2D( map, vRoadUv );

            // Bridge has solid alpha
            texelColor.a = max(vBridge, texelColor.a);

            // TODO do we even want radiance here? seems strange for the road specifically
            // Especially if it's done on paint lines
            totalEmissiveRadiance = texelColor.rgb * radiance;

            //// PAINT

            if(hasPaint) {

                vec4 paintCol = texture( dashedMap, vMapUv, -0.3 );

                float wSolid = smoothstep(0.49, 0.51, vSolid);

                float wSolidLeft = smoothstep(0.49, 0.51, vSolidLeft);
                float wSolidRight = smoothstep(0.49, 0.51, vSolidRight);
            
                float wMergeLeft = smoothstep(0.49, 0.51, vMergeLeft)  * (1.0 - ceil(max(wSolidLeft, wSolidRight
