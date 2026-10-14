

    uniform sampler2D noiseMap;
    uniform sampler2D grassVariationMap;
    uniform sampler2D detailFarMap;

    varying vec2 vUv;

    varying vec2 vGv;
    varying vec2 vGGv;
    varying vec2 vWv;
    varying vec2 vWWv;

    varying float doDiscard;
    varying float doColor;
    varying float vShadow;
    varying float vRoadProx;

    varying float vLightGrass;
    varying float vDarkGrass;

    varying vec2 vUvOffset;

    uniform vec3 grassColA;
    uniform vec3 grassColB;
    uniform vec3 peakColA;
    uniform vec3 peakColB;
    
    varying float cameraDist;

    uniform float radiance;

    float screen(float a, float b) {
        return 1.0 - ((1.0 - a) * (1.0 - b));
    }



