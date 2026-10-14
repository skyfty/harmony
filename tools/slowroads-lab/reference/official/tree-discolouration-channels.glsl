// slowroads.io 线上包体：discolouration 乘数在各树层的**通道规则**（乘数本身见
// tree-discolouration-vertex.glsl，恒在 1 附近）。
// 证据（行号可用 rg -n 复核）：
//   - 近树卡 / 近树网格（阔叶）：chunks__DevMidlineGenerator.7013ef99.js:1539-1547（块 Lu）
//   - 近树卡 / 近树网格（针叶）：chunks__conifers.26f84295.js:3877（块 Qg，带树干列保护）、
//     同文件 3883（块 x0，无保护）、nodes__3.da2ad8c8.js:958/964（同一对块）
//   - 远景树（阔叶 / 针叶）：chunks__DevMidlineGenerator.7013ef99.js:1567-1578（块 Tu；
//     针叶分支是模块导入块 ih，未解析到定义）；nodes__3.da2ad8c8.js:1527-1536 的同一块（yc）
//     给出针叶分支 = dc（`diffuseColor.g *= discolouration;`），与 conifers 的 x0 一致。
//   - 近树卡（阔叶，另一支）：nodes__3.da2ad8c8.js:1499-1509（块 _c，条件 g > b*1.5）
//
// lab 落点：lab/foliage.ts（近树卡 + 远景树）、lab/treeMeshes.ts（近树 3D 网格）。

// ---- 块 Lu：近树卡 / 近树网格（阔叶） --------------------------------------
if(vDissolve == 1.0 || texture2D(noiseMap, vMapUv).r < vDissolve) {
    discard;
}

float leafEffect = step(diffuseColor.b * 1.5, diffuseColor.g) * vLeafBrightness;

diffuseColor.rg *= 1.0 - (1.0 - discolouration) * leafEffect;

totalEmissiveRadiance = vec3(diffuseColor.rg * 8.0, 0.5) * radiance * leafEffect * vRadianceBlend;
diffuseColor.rgb *= vRadianceBlend;

// ---- 块 Qg / x0：近树（针叶） ---------------------------------------------
// Qg：带树干列保护（近树卡锥体路径；lab 的近树卡单元格与 OBJ uv 恒 > 0.125，等价于不启用）
if(vMapUv.x > 0.125) {
  diffuseColor.g *= discolouration;
}

// x0：无保护（lab 近树 3D 网格针叶采用该式）
diffuseColor.g *= discolouration;

// ---- 块 Tu / yc：远景树 imposter ------------------------------------------
if(vType < 0.5) {
    // We have a leaf
    diffuseColor.rg *= discolouration;
    totalEmissiveRadiance = vec3(diffuseColor.rg * 8.0, 0.5) * radiance * vRadianceBlend * vLeafBrightness;
    diffuseColor.rgb *= vRadianceBlend;
} else {
    // 针叶：nodes__3 同块处为 dc
    diffuseColor.g *= discolouration;
}

// ---- 块 _c：近树卡（阔叶）另一支 ------------------------------------------
if(diffuseColor.g > diffuseColor.b * 1.5) {
    // We have a leaf? Not very reliable.. might need a leafmap eventually
    diffuseColor.rg *= discolouration;
    totalEmissiveRadiance = vec3(diffuseColor.rg * 8.0, 0.5) * radiance;
}

// ---- 块 Cu：近树（阔叶）积雪（lab treeMeshes.ts 已按此逐行对齐） ------------
// Use the normal to blend with snow colours
// ONLY DO THIS ON SNOW VIBES
if(hasSnow) {
    float dotUp = dot(normal, vCameraUp );
    if(dotUp > 0.1) {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(min(1.0, 0.5 + dotUp)), min(1.0, (dotUp - 0.1) * 8.0));
    }
}
