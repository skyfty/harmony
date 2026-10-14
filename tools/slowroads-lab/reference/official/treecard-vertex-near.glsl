// slowroads.io 线上包体：近树卡 (xr() 共享材质) 顶点着色器尾部片段。
// 来源：%TEMP%/sr（线上包体解包）中的 treecard 顶点 chunk（长度 1909），
// 会话提取副本 sr-treecard2-vertex.txt @ 2026-10-14。
// 关键行：vLeafBrightness = 1 - densityFactor * saturate((10.0 - position.y) / 3.0)
// （densityFactor = per-instance density 属性 × shadowFactor；见 lit21_at423248.glsl 的属性声明）

// Need to get mvPosition here
#include <project_vertex>


if(-mvPosition.z < dissolveNear) {
    vDissolve = 0.0;
} else {

    if(-mvPosition.z > dissolveFar) {
        vDissolve = 1.0;
    } else {
        vDissolve = (-mvPosition.z - dissolveNear) / dissolveInterval;
    }
}

// Dynamic alpha test... just testing for now? can't decide if it's worthwhile
vAlphaTest = alphaTest;
if(dissolveFar > 200.0) {
    if(-mvPosition.z < dissolveFar) {
        // Second term is 0 at dissolveFar, 0.5 at half way to dissolve...
        vAlphaTest = max(0.3, alphaTest * (1.0 + mvPosition.z / (dissolveFar + dissolveInterval)));
    }
} else {
    if(-mvPosition.z < 200.00) {
        // Second term is 0 at dissolveFar, 0.5 at half way to dissolve...
        vAlphaTest = max(0.3, alphaTest * (1.0 + mvPosition.z / (300.0)));
    }
}

vRadianceBlend = 1.0 - saturate((-mvPosition.z - 50.0) / 200.0) * 0.33;

vLeafBrightness = 1.0 - densityFactor * saturate((10.0 - position.y) / 3.0);

vShadow *= shadowFactor;
