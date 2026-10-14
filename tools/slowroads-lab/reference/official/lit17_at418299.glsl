

    #ifdef WATER_DEPTH

        attribute float depth;
        // attribute vec3 shoreness;

    #endif

    #ifdef WATER_WAVES

        uniform float time;

        varying vec2 vUw;
        varying vec2 vUUw;
        varying vec2 vUUUw;

    #endif

    varying vec4 wPos;

    #ifdef WATER_DEPTH

        varying float vDepth;
        // varying vec3 vShoreness;

    #endif


