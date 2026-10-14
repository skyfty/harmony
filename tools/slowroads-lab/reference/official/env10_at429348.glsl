

    uniform float time;
    uniform sampler2D noiseMap;
    uniform vec3 offset;
    uniform float boxWidth;
    uniform float boxHeight;
    uniform float minDist;
    uniform float speed;

    uniform bool headlightOn;
    uniform vec3 headlightPos;
    uniform vec3 headlightDir;

    varying float vBrightness;
    varying float skip;

    float SPEED = 1.0;


