

    vec4 wPos = modelMatrix * vec4(position, 1.0);

    vec3 carDir = headlightPos - wPos.xyz;

    // Distance to catseyes,
    float carDist = length(carDir);

    if(carDist < 150.0) {
        // View distance of 150m
        float distBrightnessFactor = 1.0 - (carDist - 75.0) / 75.0;

        // Check if car is aiming at the light close enough
        float angleBrightnessFactor = max(0.0, dot(normal, headlightDir));

        // Check
        float coneBrightnessFactor = dot(headlightDir, normalize(carDir));
        coneBrightnessFactor = (coneBrightnessFactor - 0.8) / 0.2;

        // NOTE: Could set the road colour here to save on transparency rendering
        vBrightness = distBrightnessFactor * angleBrightnessFactor * coneBrightnessFactor;
    } else {
        vBrightness = 0.0;
    }


