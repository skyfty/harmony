
    uniform vec3 highlight;
    uniform vec3 lowlight;
    uniform float mode;

    varying vec2 vUv;
    varying vec2 vUUv;
    varying vec2 vUUUv;
    varying vec2 vUUUUv;
    varying float dist;

    highp float random(vec2 coords) {
        return (fract(sin(dot(coords.xy, vec2(12.9898,78.233))) * 43758.5453) * 0.2) - 0.1;
    }

    float remap(float value, float min1, float max1, float min2, float max2) {
        return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
    }

