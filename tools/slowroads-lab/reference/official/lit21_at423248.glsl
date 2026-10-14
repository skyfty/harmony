

    attribute float density;

    uniform sampler2D noiseMap;
    uniform float dissolveFar;
    uniform float dissolveNear;
    uniform float dissolveInterval;
    uniform float shadowFactor;
    uniform float discolourationFactor;
    uniform float alphaTest;
    // uniform float time;

    varying float discolouration;
    varying float vShadow;
    varying float vDissolve;
    varying vec3 vCenterNormal;
    varying vec3 vCameraUp;
    varying float vAlphaTest;
    varying float vRadianceBlend;
    varying float vLeafBrightness;

    float distanceSq(vec3 a, vec3 b) {
        return (b.x - a.x)*(b.x - a.x) + (b.y - a.y)*(b.y - a.y) + (b.z - a.z)*(b.z - a.z);
    }

    // vec2 getRotatePivot2d(vec2 uv, float rotation, vec2 pivot) {
    //     return vec2(
    //         cos(rotation) * (uv.x - pivot.x) + sin(rotation) * (uv.y - pivot.y) + pivot.x,
    //         cos(rotation) * (uv.y - pivot.y) - sin(rotation) * (uv.x - pivot.x) + pivot.y
    //     );
    // }


