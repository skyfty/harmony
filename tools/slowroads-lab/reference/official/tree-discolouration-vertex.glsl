// slowroads.io 线上包体：树卡变色（discolouration）**顶点分块**。
// 来源：%TEMP%/sr（线上包体解包）产物，行号用 rg -n <文件> 可复核。
//   - chunks__DevMidlineGenerator.7013ef99.js:1403        块 un（近树卡 / 远景树共用公式）
//   - chunks__DevMidlineGenerator.7013ef99.js:1917-1950   远景树 imposter 顶点把 un 接在 `vType = type;` 之后（块 Pu）
//   - chunks__conifers.26f84295.js:3720-3728              近树（树卡 / 近树网格）公式 + 柏树列兜底（块 Jg）
//   - nodes__3.da2ad8c8.js:865 / 1361                     同一公式的两份副本
//
// 关键语义：`effects.treeDiscolouration`（春 1.5 / 夏 .9 / 秋 1.2 / 冬 .2）是**噪声幅度**，
// 不是通道乘数。乘数恒在 1 附近：冬 0.2 → 0.9..1.1、春 1.5 → 0.25..1.75、夏 0.9 → 0.55..1.45、
// 秋 1.2 → 0.4..1.6。把因子直接当乘数时冬季 r/g 只剩 20%，只剩蓝通道 ⇒ 雪地树冠发紫
// （2026-10 lab 修复的根因）。
//
// wPos 取实例世界原点（`modelMatrix * instanceMatrix * vec4(0,0,0,1)`）；噪声 uv = 世界 xz / 256，
// 噪声贴图即树卡 dissolve 用的那一张（官方 Ui，lab = noise_fine.592be1a0，Repeat + srgb-linear）。

// ---- 近树卡 / 远景树共用（块 un，DevMidline 1403） ---------------------------
discolouration = 1.0 + (texture2D(noiseMap, vec2(wPos.x/256.0,wPos.z/256.0)).r - 0.5) * discolourationFactor;

// ---- 近树（树卡 / 近树网格）额外兜底（块 Jg，conifers 3723-3727） ------------
// SPECIAL HANDLING FOR CYPRESS TO AVOID IT BEING TOO DARK
if(vMapUv.x > 0.76) {
  discolouration = (discolouration / 2.0) + 0.5;
}

// ---- 远景树 imposter 顶点：un 直接接在 `vType = type;` 之后（块 Pu） ---------
// 注意：imposter 路径**没有**柏树兜底（其图集 x 是 16 个朝向列，不是树种列）。
vUv = uv;
vUvBlend = vec2(uv.x * 21.32, uv.y * 4.0);
vType = type;
discolouration = 1.0 + (texture2D(noiseMap, vec2(wPos.x/256.0,wPos.z/256.0)).r - 0.5) * discolourationFactor;
