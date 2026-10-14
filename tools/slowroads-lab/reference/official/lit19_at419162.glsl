

    uniform vec3 camPos;
    uniform vec3 body;
    uniform vec3 highlight;

    #ifdef WATER_WAVES
        uniform sampler2D waves;

        varying vec2 vUw;
        varying vec2 vUUw;
        varying vec2 vUUUw;

    #endif

    varying vec4 wPos;

    #ifdef WATER_DEPTH
        varying float vDepth;
        // varying vec3 vShoreness;
    #endif

    vec3 upvec = vec3(0.0,1.0,0.0);


