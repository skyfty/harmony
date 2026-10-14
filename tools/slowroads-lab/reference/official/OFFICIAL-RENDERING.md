# slowroads.io 官方渲染基准（反推归档）

来源：官方线上包体解包产物（`%TEMP%/sr`，chunk 名带内容哈希；摘录见同目录
`bundle-excerpts.js` 与 `*.glsl`）。本目录是 lab / schema 对齐官方观感的规范。

## 渲染器

- `WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false,
  logarithmicDepthBuffer: false })`；`setClearColor(0x444444)`；
  `shadowMap.enabled = true`（PCF）；`useLegacyLights = false`（物理光照）；
- **`toneMapping = CineonToneMapping`**、`toneMappingExposure = 1`、`outputColorSpace = SRGB`。

## 雾色 uniform 的输出色空间（重要基准）

官方三位色雾 chunk（`sr_fog_ou.glsl`）被 three 排在
`tonemapping_fragment → colorspace_fragment → fog_fragment` 之后，即混色发生在
**显示空间**。因此官方改过的 three 构建在 `refreshFogUniforms` 里用
`f.colorA.getRGB(m.fogColorA.value, Bs(i))` 推入雾色，
`Bs(i) = renderer.getRenderTarget() === null ? renderer.outputColorSpace : ColorManagement.workingColorSpace`
（渲染到画布时 = sRGB，即预设 hex 的原始分量）。若误推工作色空间（线性）分量，
雾与天空会整体偏暗、偏饱和——粉/橙预设（春晨 `#E496AD`、春昏 `#E49567`）表现为"太红"。
lab 侧对应实现：`lab/fogPatch.ts` 的 `resolveFogUniformColorSpace()` /
`writeFogUniformColors()`（`environmentController` 每次状态变更换算一次后下发）。

## 灯光（`updateSky()`，三盏常驻）

| 灯 | 颜色 | 强度 | 说明 |
| --- | --- | --- | --- |
| `DirectionalLight` sun | `preset.lights.sun.col` | `preset.lights.sun.intensity` | `position = vehicle.position + (0,10,0)`、`target = vehicle` → **方向竖直向下 (0,-1,0)**；`castShadow`，`shadow.radius = 5`，相机 `near 0.5 / far 50`、`±shadowMapSize` |
| `AmbientLight` | `preset.lights.ambient.col` | `preset.lights.ambient.intensity` | |
| `HemisphereLight` | sky = `preset.lights.sun.col`；ground = `0x000000` | `preset.lights.ambient.intensity` | |

无 CSM：阴影是跟随载具的单张局部 shadow map。

## 材质（Lambert 家族，无镜面）

- 地形/道路/草/灌木/树卡/近树网格 = `MeshLambertMaterial`（+官方自定义 chunk），
  随材质替换 `lights_lambert_pars_fragment`（`RE_Direct_Lambert`、`RE_Direct_Lambert_Spot`
  带 +0.25 包裹）与 `lights_fragment_begin`（或 `lights_fragment_begin_shadow`）。
- 合成补丁（全部景观材质）：

  ```js
  fragmentShader.replace(
    'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
    'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directDiffuse * totalEmissiveRadiance;',
  )
  ```

  即 `outgoing = direct × (1 + emissive) + indirect`（emissive 放大了直射项）。
- 环境光树影调制（地形/道路使用 `lights_fragment_begin_shadow`）：
  `irradiance *= 1.75 - min(1.0, max(0.75, vShadow));`
  （`vShadow = treeMask × clamp(height/4, 0, 1) × shadowFactor`，在顶点着色器计算。）

## 自发光（radiance）逐层取值

| 层 | `totalEmissiveRadiance` | radiance 取值 |
| --- | --- | --- |
| 地表 | `texelColor.rgb * radiance` | `preset.lights.radiance`（春/白天/晴 = 2） |
| 草精灵 | `texelColor.rgb * radiance`（注释：must match the ground） | 同地表 |
| 灌木 | `texelColor.rgb * radiance * vAO` | 同地表 |
| 道路 | `texelColor.rgb * radiance` | 与地表共享同一 uniform 对象 |
| 树卡 / 远景树 | `vec3(diffuseColor.rg * 8.0, 0.5) * radiance * vRadianceBlend * vLeafBrightness * leafEffect` | `preset.lights.radiance / 2` |
| 近树网格 | 走 `reflectedLight.directSpecular * totalEmissiveRadiance`（Lambert 无镜面 ⇒ 白天无自发光；夜间车灯高光即"树冠 radiance"） | `preset.lights.radiance / 2` |

## 树卡变色 `treeDiscolouration` 的语义（2026-10 修正）

`preset.effects.treeDiscolouration`（春 1.5 / 夏 .9 / 秋 1.2 / 冬 .2）是**噪声变色项的幅度**，
不是通道乘数。官方顶点先把它换算成 ≈1 的乘数（块 `un` / `Jg`）：

```glsl
discolouration = 1.0 + (texture2D(noiseMap, wPos.xz / 256.0).r - 0.5) * discolourationFactor;
if(vMapUv.x > 0.76) discolouration = discolouration * 0.5 + 0.5;   // 柏树列兜底（仅近树）
```

乘数区间：冬 0.2 → 0.9..1.1、春 1.5 → 0.25..1.75、夏 0.9 → 0.55..1.45、秋 1.2 → 0.4..1.6；
imposter 顶点同样计算该值但**没有**柏树兜底。随后按层施加：

| 层 | 通道规则 | 出处 |
| --- | --- | --- |
| 近树卡 / 近树网格（阔叶） | `leafEffect = step(b*1.5, g) * vLeafBrightness`；`rg *= 1 - (1 - disc) * leafEffect` | `lit26`（块 `Lu`） |
| 近树卡 / 近树网格（针叶） | `g *= disc`（锥体路径另有 `vMapUv.x > 0.125` 树干列保护） | 块 `Qg` / `x0` |
| 远景树（阔叶） | `rg *= disc` + 叶辉光 | 块 `Tu` |
| 远景树（针叶） | `g *= disc` | 块 `Tu` 针叶分支 / `x0` |

把因子直接当乘数时，冬季（0.2）r/g 只剩 20%，只剩蓝通道 ⇒ 雪地树冠发紫（lab 2026-10 修复）。
分块原文归档：`tree-discolouration-vertex.glsl`、`tree-discolouration-channels.glsl`；
未移植的圆锥假暗化（`M0` / `S0`）见 `tree-cone-fshadow.glsl`。

- `vRadianceBlend = 1 - saturate((viewDepth - 50)/200) * 0.33`；
  `vLeafBrightness = 1 - 0.25 * shadowFactor * saturate((0.25 - uv.y)/0.08)`（远景树变体）；
  **近树变体**（近树卡与近树网格共享，`xr()` 材质）：`vLeafBrightness = 1 - densityFactor *
  saturate((10 - 模型高度m)/3)`，`densityFactor = per-instance density 属性 × shadowFactor`
  （顶点摘录 `treecard-vertex-near.glsl`，属性声明 `lit21_at423248.glsl`）。

## 官方每季参数（消费点）

- `preset.lights.radiance` → 地表/草/灌木/道路自发光；`preset.lights.fresnelFactor` → 水面；
  `preset.lights.sun/ambient` → 三灯；
- `season effects.shadowFactor` → `vShadow` 系数（春 0.8 / 夏 0.9 / 秋 0.8 / 冬 0.75）；
- `effects.treeDiscolouration`、`effects.hasSnow` → 树卡变色/积雪；
- 地形掩码（官方顶点着色器，逐行一致）：
  `vHeather = smoothstep(0.4, 1.0, ((height + fade1*350) - 60)/500) * screen(fade1, fade0)`、
  `heightVal = clamp((height - (30 + fade1*40))/150)`、`vLightGrass = min(1, heightVal*(fade0 + heightVal*0.5))`、
  `vDarkGrass = min(max((fade1 - 0.25)*2, 0), 1)`、`vShadow = min(1, treeMask * clamp(height/4,0,1)) * shadowFactor`。

## lab / schema 落地位置

- lab：`src/lab/landscapeLighting.ts`（共享 uniform + GLSL）、`environmentController.ts`（三灯下发）、
  `terrainMaterial.ts` / `foliage.ts` / `roadMesh.ts` / `treeMeshes.ts`（合成与自发光）；
- schema：`slowroads/render/environmentRuntime.ts`（三灯状态）、`proceduralLandscape/surfaceMaterial.ts`
  （Lambert + heather 官方公式 + radiance 合成 + 环境光树影调制）、`instancing.ts`（草/灌木/树卡自发光）、
  `roadBand.ts`（Lambert + radiance）、`treeMeshes.ts`（纯 Lambert）。
