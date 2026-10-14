

    precision highp float;

    varying vec2 vUv;
    varying vec2 vUvBlend;
    varying vec2 vUvOffset;
    varying float vDissolve;
    varying float vAngleBlend;
    varying vec3 vCameraUp;
    varying float vType;
    varying float vRadianceBlend;
    varying float vLeafBrightness;

    varying float discolouration;

    uniform sampler2D noiseMap;
    uniform sampler2D mapB;
    uniform sampler2D normalMapB;
    uniform float radiance;
    uniform bool hasSnow;

