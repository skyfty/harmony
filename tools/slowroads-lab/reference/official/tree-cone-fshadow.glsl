// slowroads.io 线上包体：近树卡“圆锥假暗化”与远景树假暗化（**未移植到 lab**，原因见文末）。
// 证据：chunks__conifers.26f84295.js:3885-3900（块 M0 = 近树卡锥体路径）、
//       同文件 3892-3898（块 S0 = 注释提到 imposters 的变体）。
// 锥形 vShadow 的顶点来源：同文件 3760-3810（vCenterNormal 圆锥法线）+ 块 cc：
//   baseRadius = 2.5（+1.0 若 larch：0.59 < vMapUv.x，且非 cypress：vMapUv.x > 0.77）
//   shadowRadius = (baseRadius + density) * max(0.1, 1.0 - heightLerp);  heightLerp = position.y / 12
//   vShadow = shadowRadius - centerDist;  vShadow *= 1.0 - max(cypress, larch) * 0.25;
//   if(vMapUv.x < 0.125) vShadow = 0.7 + 0.3 * density;   // 树干列
//   vShadow *= shadowFactor;

// ---- 块 M0（近树卡） ------------------------------------------------------
if(vDissolve == 1.0 || texture2D(noiseMap, vMapUv).r < vDissolve) {
    discard;
}

fShadow = saturate(vShadow);
fShadow = sqrt(fShadow) * 0.65;

if(vMapUv.x > 0.125) {
  diffuseColor.g *= discolouration;
}

diffuseColor.rgb *= 1.0 - fShadow;

// ---- 块 S0（另一变体） ----------------------------------------------------
float fShadow = saturate(vShadow);
// Imposters look better if made fake dark for some reason? Custom values here to force it darker
fShadow = sqrt(fShadow);
diffuseColor.rgb *= 1.0 - fShadow;

// ---- 为什么 lab 不移植 ----------------------------------------------------
// 1) 该 fShadow 依赖锥面径向位置（centerDist、position.y / 12 米高），lab 的近树卡是十字面片
//    精灵（uv 即图集单元格），几何上没有对应量；强行套用只会得到恒 0 或错误压暗。
// 2) M0 里还耦合了 S0 之类的另一族路径与 `vShadow` bearing 的 cone normal，属于官方
//    “近树卡 = 圆锥网格”这一结构差异，lab 用密度图近似 per-instance shadow（README 已知差异）。
// 3) S0 需要的 `vShadow` 不在远景树 imposter 顶点声明（vUv/vUvOffset/vDissolve/vAngleBlend/
//    vCameraUp/vType/vRadianceBlend/vLeafBrightness/discolouration）里，其真实消费者未定位到
//    lab 对应的远景树层，故本轮不实现（标注为待查）。
