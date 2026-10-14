

    precision highp float;

    uniform sampler2D noiseMap;
    uniform float shadowFactor;

    attribute float variant;
    attribute float type;
    attribute float orientation;
    attribute float dissolve;

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

    uniform float dissolveFar;
    uniform float dissolveNear;
    uniform float dissolveInterval;
    uniform float discolourationFactor;

    vec2 getRotatePivot2d(vec2 uv, float rotation, vec2 pivot) {
        return vec2(
            cos(rotation) * (uv.x - pivot.x) + sin(rotation) * (uv.y - pivot.y) + pivot.x,
            cos(rotation) * (uv.y - pivot.y) - sin(rotation) * (uv.x - pivot.x) + pivot.y
        );
    }

