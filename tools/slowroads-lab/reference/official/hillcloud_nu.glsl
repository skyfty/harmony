
    wPos = modelMatrix * vec4( position, 1.0 );

    // Distance (height) from camera to virtual plane
    // Big hmm here, these values may intersect with road on rare occasions, could min them
    float h0 = shelfHeight0 - camPos.y;

    // Distance from camera to image plane
    float h1 = shelfHeight1 - camPos.y;

    vUv = uv;

    // First shelf...
    vUUv.x = wPos.x + time;
    vUUv.y = wPos.z + time;
    vUUv /= skyScale0 * altitude;

    float scale1 = skyScale1 * altitude;
    float lowerScale = scale1 * h1 / h0;
    float motionScale = (h1 - h0) / h0;

    // Second shelf
    vUUUv.x = ((wPos.x + camPos.x * motionScale ) / lowerScale) + time / scale1;
    vUUUv.y = ((wPos.z + camPos.z * motionScale ) / lowerScale) + time / scale1;


    // Offset copy of second shelf used for shading?
    vUUUUv.x = vUUUv.x + 0.001;
    vUUUUv.y = vUUUv.y - 0.001;


    //// EXPERIMENT
    // float h2 = ((shelfHeight0 + shelfHeight1) / 2.0) - camPos.y;
    // float scale2 = ((skyScale0 + skyScale1) / 2.0) * altitude;
    // float midScale = scale2 * h2 / h0;
    // float motionScale2 = (h2 - h0) / h0;
    // vUUUUv.x = ((wPos.x + camPos.x * motionScale2 ) / midScale);// + (time) / scale1;
    // vUUUUv.y = ((wPos.z + camPos.z * motionScale2 ) / midScale);// + (time) / scale1;


    // Mid-point experimentation
    // vUUUUv.x = (vUUUv.x + vUUv.x) / 2.0;
    // vUUUUv.y = (vUUUv.y + vUUv.y) / 2.0);


    // Use UVs to  look up  distance from camera...
    float vX = (uv.x - 0.5) * 2.0;
    float vY = (uv.y - 0.5) * 2.0;
    dist = max(0.0, 1.0 - sqrt((vX * vX) + (vY * vY)));

