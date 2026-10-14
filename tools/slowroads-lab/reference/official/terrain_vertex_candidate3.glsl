

attribute float roadProximity;
attribute float treeMask;
attribute float overlap;
attribute float fieldCol;

varying float height;
varying float steepness;
varying float roadProx;
varying float hasRoadProx;
varying float vTreeMask;
varying vec2 vUv;
varying vec2 vUUv;
varying vec2 vWv;
varying vec2 vWWv;
varying float vLightGrass;
varying float vDarkGrass;
varying float vField;
varying float vHeather;
varying float vShadow;
varying float vCamDepth;

float wuvSize = 500.0;

uniform sampler2D displacementMap;
uniform sampler2D fadeFine;
uniform float sinkDist;
uniform float vehicleIndex;
uniform float shadowFactor;
uniform int seasonIndex;

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

float screen(float a, float b) {
  return 1.0 - ((1.0 - a) * (1.0 - b));
}

float distSquared( vec3 A, vec3 B ) {
    vec3 C = A - B;
    return dot( C, C );
}

vec3 upvec = vec3(0.0,1.0,0.0);


