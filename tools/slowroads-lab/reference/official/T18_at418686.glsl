

    wPos = modelMatrix * vec4( position, 1.0 );

    #ifdef WATER_WAVES

    // 50 and 200 for normal map

        vUw.x = (time + wPos.x) / 200.0;
        vUw.y = (time + wPos.z) / 200.0;

        vUUw.x = (wPos.x - time) / 800.0;
        vUUw.y = (wPos.z - time) / 800.0;

        vUUUw.x = (wPos.x - time) / 300.0;
        vUUUw.y = (wPos.z - time) / 300.0;

    #endif

    #ifdef WATER_DEPTH
        vDepth = depth;
        // vShoreness = shoreness;
    #endif


