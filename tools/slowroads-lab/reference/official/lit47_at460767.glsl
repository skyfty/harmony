
    attribute vec3 groundNormal;
    attribute float shadow;
    attribute float variant;
    // attribute float roadProx;

    uniform float sproutNear;
    uniform float sproutFar;
    uniform float sproutMargin;
    uniform sampler2D noiseMap;
    uniform float shadowFactor;
    // uniform float time;
    uniform vec3 vehiclePos;
    uniform bool flatten;

    varying vec2 vUv;
    varying vec2 vWv;


    varying float vAlphaTest;
    varying float vShadow;
    varying float doDiscard;

    varying float vAO;

    varying vec2 vUvOffset;

    float wuvSize = 512.0;

    float screen(float a, float b) {
        return 1.0 - ((1.0 - a) * (1.0 - b));
    }

