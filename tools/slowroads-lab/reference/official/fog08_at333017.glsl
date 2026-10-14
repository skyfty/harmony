

// Apply fog according to angle but only far fog?
diffuseColor.rgb = vec3(
    min(1.0, fogColorB.r + vGlow),
    min(1.0, fogColorB.g + vGlow),
    min(1.0, fogColorB.b + vGlow)
);


