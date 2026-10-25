# Slow Roads Lab

slowroads.io 风格的程序化地形 / 道路 / 精灵植被验证工程：按官方线上包体反编译出的逻辑，
接入四季素材与 8 个 OBJ 近树模型，先把视觉效果与数据流调对，再迁移到 editor 的
`proceduralLandscape` 组件（preview / SceneryViewer / 微信小程序）。

## 启动

```bash
# 1. 素材流水线（首次或素材更新后；仓库不存大图）
pnpm --dir tools assets:slowroads-lab          # 从 D:\Downloads\新建文件夹 生成 assets-src/ + 资产包
pnpm --dir tools regions:slowroads-lab         # 实测四季精灵区域 -> src/core/spriteRegionsData.ts
node scripts/extract-environment-presets.mjs   # 从解包产物提取 32 套环境预设（天气/时间）

# 2. 开发
pnpm dev:slowroads-lab                         # http://localhost:8096
pnpm build:slowroads-lab
pnpm type-check:slowroads-lab
```

「素材来源=服务器下载」模式用于提前验证小程序按需下载链路：

```bash
pnpm --dir tools assets:serve-slowroads-lab    # http://localhost:8097 提供 assets-src/
```

注意：`assets:slowroads-lab` 会重写 `assets-src/`，请先停掉正在运行的 dev server
（vite 在热路径上读这些文件，边跑边覆盖会让文件句柄 EBUSY 并把进程带崩）。

## 素材流水线（仓库不存素材）

- `scripts/materialize-assets.mjs`：从 `D:\Downloads\新建文件夹` 生成 gitignored 的
  `assets-src/`（lab 运行目录，同时就是上传包内容）：
  - 原始 PNG/OBJ 原样复制（含文件名里的内容哈希）；旧版 4 张重复图集（草/灌木/阔叶/针叶）排除；
  - 长边 >2048 的贴图生成 `@2048` 降采样变体（小程序/老机型用）；
  - 8 个 OBJ 转紧凑二进制 `*.treebin`（Float32 pos/normal/uv + Uint16 index），
    运行时不必解析 OBJ 文本，也省掉小程序分包里的 OBJLoader；
  - 产出 `asset-bundle.json`（符合 `schema/asset-api.ts` 的 `AssetBundleManifest`，
    logicalId=去扩展名文件名，hash=服务端同款 fnv1a-64-compat，role=dependency），
    经 admin 资产包上传后返回 logicalId→assetId 映射；
  - `catalog.json`（实测尺寸/字节/哈希/变体，提交于 `src/core/assets-catalog.json`）。
- `scripts/measure-sprites.py`（py -3.10 + PIL）：按 alpha 连通域实测灌木/草丛/针叶
  树卡的精灵区域（含格位与相对高度），输出生成的 `src/core/spriteRegionsData.ts`。
  图集第 4 格若为云杉枝装饰卡（slowroads 灌木变体选择只用 0..2 格），运行时不会被选中。
- `scripts/extract-environment-presets.mjs`：从 slowroads 解包产物（DevMidlineGenerator
  分块）提取 4 季 × 4 时间段 × 2 天气 = 32 套官方环境预设（光照/三色雾/水面/云层/
  星空/降雪），输出 `src/core/environmentPresets.generated.ts`，并断言数据不变量
  （星空只在夜晴 ×4、降雪只在冬季 ×5）。
- `scripts/serve-asset-bundle.mjs`：本地静态服务，模拟服务器按需下载（fetch→blob→纹理）。
- 素材 supplement：云贴图 `clouds_01.700a3fdb.png`（天气系统用）与木护栏若不在用户的
  下载目录里，会从 `src/assets/slowroads/` 去重补入；当前下载目录已包含这两项。
  2026-10 起用户素材目录补齐了宽路与墙体（`road_base` / `road_overlay_spring` /
  `road_paint_*` / `wall_barrier` / `spring_wall_drystone` / `wall_concrete`），
  随后又补齐了秋季 overlay、冬季宽路与冬季墙体（`road_overlay_autumn` / `winter_road` /
  `winter_wall_*`）。当前资产包共 140 个资产条目：110 张源 PNG、14 张 `@2048` 兼容图、
  8 个 OBJ 与 8 个 treebin；源目录中的 21 张 `*_metool` 衍生图也按原样保留。仍缺的只有
  夏/秋共用的 `wall_drystone` 与 `wall_barrier_wood`（回退 spring 贴图，见「已知差异」）；
  官方虽加载但 shipped 着色器里被注释掉的 `road_paint_dashed_long` 不需要，`bridge`
  （桥面）随桥系统一起未接入，作为备用素材入库。

## 架构分层（迁移关键）

- `src/core/`：平台无关核心，可直接平移进 `schema/proceduralLandscape/`。
  - `seasonCatalog.ts`：四季 → 贴图槽位映射（logicalId、kind、色彩空间）与 8 个树模型表；
  - `seasonParams.ts`：官方调色板/特效参数（grassColA/B、peakColA/B、roadCol、
    shadowFactor、treeDiscolouration、hasSnow、frozenWater，`seasonIndex` 春0/夏1/秋2/冬3）；
  - `spriteRegions.ts` + `spriteRegionsData.ts`：精灵区域表（实测，含空位与格位语义）；
  - `heightfield / roadTrace / roadProfile / placement / barrier / noise / selfCheck`：
    程序化生成与自检，命名与语义对齐 schema 同名模块（heightfield 采样器是移植替换点）。
- `src/lab/`：three 渲染外壳（不迁移，但其着色器逻辑是移植蓝本）。
  - `terrainMaterial.ts`：官方地表片元栈（草色调色板 → heather → 细节 → 林下 →
    沙带 → 路肩碎石 → 陡坡岩石），`TERRAIN_REDUCED` 兼容模式降到 9 个采样器；
  - `roadMesh.ts`：road_single 贴图带（u 横跨路宽、v=里程/(2×路宽)，textureStretch=2），
    春/秋 overlay（苔痕/落叶）强度=saturate(树影×shadowFactor×3)，alphaTest 0.75；
  - `foliage.ts`：草丛按官方公式乘当季调色板（含冬季 0/1 格裁剪、0/1/3 格半高规则）、
    灌木自带颜色+斑驳、树卡/imposters 的 leafEffect 变色与冬季阔叶积雪；
  - `treeMeshes.ts`：近树 3D 网格层（仿 NearTreeManager，2 物种×4 变体、按相机分块流式、
    与树卡/imposters 组成三级 LOD）；
  - `assetSource.ts`：`local`（glob）/`server`（fetch→blob）双模式资产装载 + 纹理缓存/剪枝。
- 迁移映射：`seasonCatalog → props.season + seasons 资产集`；`terrainMaterial → surfaceMaterial`；
  `roadMesh → runtime 道路网格`；`treeMeshes → instancing 近树网格层`；资产解析沿用
  `getProceduralLandscapeAssetResolver()` + 下载 worker 池。

## 季节逻辑（官方表）

| 槽位 | 春 | 夏 | 秋 | 冬 |
| --- | --- | --- | --- | --- |
| 草地/近细节 | grass | grass | grass | winter_grass |
| 林下 | forest_spring | forest_01 | forest_autumn | forest_winter |
| heather | summer_heather_05 | summer_heather_05 | autumn_heather | winter_heather |
| 碎石 | gravel_02 | gravel | gravel | winter_gravel |
| 岩石 | spring_rock | summer_rock | summer_rock | winter_rock |
| 沙带 | sand | sand | sand | winter_gravel |
| 远细节 | ground_detail_far | 同左 | 同左 | ground_detail_far_winter |
| 近树 阔叶/针叶 | spring_trees_0(_n) / _1_m(_a) | summer_* | autumn_* | winter_* |
| 远景树 A/B | spring_imposters_0_d(_n)+_1_d | summer_* | autumn_*_0_d(_n)+_1_d(_n) | winter_*_0_d(_n)+_1_d |
| 远景针叶法线 | 四季共用 autumn_imposters_1_n | | | |
| 灌木/花草 | spring_bushes | summer_bushes | autumn_bushes | winter_bushes |
| 草丛精灵 | summer_grasses | summer_grasses | summer_grasses | winter_grasses |
| 公路 | base_spring+overlay_spring | road_single_base | road_single_base+overlay_autumn | winter_road_single |

> 公路槽位自 2026-10 起按官方双路型拆分：`road.single`（上表，路宽 < 2.25m）与
> `road.wide`（`road_base` + 6 张划线，路宽 ≥ 2.25m，冬季官方无划线）。墙体槽位
> `walls.{barrier,fence,seaWall,drystone}`：官方 `wall_barrier` 属 Barrier、
> `spring_wall_barrier_wood` 属 Fence、`wall_concrete` 属 SeaWall、
> `spring_wall_drystone` 属 Drystone（四季回退表见「已知差异」）。

调色板（shader uniform）：春 #4F9140/#94AC53、夏 #699159/#AFAD64、秋 #4A7D4D/#BEAF79、
冬 #FFFFFF/#DBDDE1（grassColA/B）；peakColA/B、fieldDiscolouration、roadCol 见
`src/core/seasonParams.ts`。冬季另有 hasSnow（阔叶树积雪）与 frozenWater（水面冻结）。
lab 世界的海拔只有 ±40m，地表着色把「水面以上高度」按 ×4 折算回官方 0..300m 尺度。

## 天气与时间（官方环境预设）

环境状态 = **季节 × 时间（早/日/暮/夜）× 天气（晴/阴）**，32 套官方预设驱动：

- **光照**：与官方 `updateSky()` 一致的三件套 —— `DirectionalLight`（预设 sun 色/强度，
  竖直向下）、`AmbientLight`（预设 ambient 色/强度）、`HemisphereLight`（sky = 预设
  sun 色、ground = 黑、强度 = 预设 ambient 强度）；材质按官方 Lambert + `radiance`
  自发光合成（`direct×(1+emissive)+indirect`），渲染器用官方 Cineon 色调映射（曝光 1）。
  详见 `reference/official/OFFICIAL-RENDERING.md`（官方包体反推基准）。
- **三色高度雾**：直接替换 three 的 `ShaderChunk.fog_*`（`src/lab/fogPatch.ts`），
  圆柱雾距、噪声雾顶、正负 haze 层、A/B 视线混色 + C 色去饱和；每帧按相机高度
  复现官方 haze 插值。雾尺度和官方一样分两档（第五批）：
  地形/植被/道路/水面/降雪用 `ENVIRONMENT_VIEW_DISTANCE`(1000)，天空/云层/星空用官方
  `n1 = tileSize × 2`(`ENVIRONMENT_SKY_DISTANCE` = 2000)；两者都是「雾距 = 尺度 × 预设比例、
  密度 = √5/fogFar」。
- **天空**：挂在相机上的巨型平面 + 上述雾（与官方同款"雾化天空"），renderOrder -10。
  平面挂在官方 `n1`(2000) 距离、绑天空组雾 uniform，因此 A/B 渐变与官方一致。
- **云层**：双 shelf 视差 + 时间滚动 + highlight/lowlight + 官方 4 种混合模式；
  云平面跟随相机、固定世界高度 300m。
- **星空**：夜晴专属（官方 4000 点、seeded 分布 ×2 组按 density 显隐；`glow`
  属性 + `min(1, fogColorB+vGlow)` 上色，按 horizon* 参数用 horizonOpacity/
  Offset/Scale 向 fogColorA 淡出）。两个官方移植要点（踩坑记录）：
  1) 材质必须 `fog: true`：patch 注入的 color_fragment 读取 `fogColorB`，若材质
     关雾（USE_FOG 未定义）会整体编译失败、夜晴时星空完全不渲染；
  2) `Group.renderOrder` 会作为 children 的 `groupOrder`（three 的第一排序键）——
     官方在星空容器上设 -2（其天空在更低 groupOrder 的容器内）；lab 的天空是独立
     mesh（groupOrder 0），因此容器 renderOrder 归 0，让星星按 -5 排在天空(-10)/
     云(-9) 之后绘制，否则会被不透明天空整片覆盖。
  lab 的星星 size 用 `0.01 × 4`（官方 0.01 在 2× 截图中不可见），迁移端可恢复。
- **降雪**：冬季阴天专属（相机前向盒内点云，mod 下落 + 噪声风偏；lab 无车灯，
  车灯亮度项恒为 0）。
- **水面**：官方 base/body/highlight/underwater 色与 fresnelFactor（体色给深色项、
  highlight 给高光、fresnelFactor 缩放菲涅尔；base 项未使用，见差异说明）。

切换时间/天气即时生效（纯 uniform/材质层更新，不重载季节贴图、不重建世界）；
季节切换保留当前时间/天气。诊断开关：天空/云层/星空/降雪。

## 迁移接口设计（EnvironmentPanel → proceduralLandscape，后续落地）

目标形态（三端已接线；环境设置已收敛为「只保留 Slow Roads 预设」）：

1. `schema/core` 的 `EnvironmentSettings` 增加 `season: SeasonId`、
   `timeOfDay: 'morning'|'day'|'evening'|'night'`、`weather: 'clear'|'overcast'`
   （含默认值与归一化，进 `environmentSettingsUtils`）；`editor/src/types/environment.ts`
   改为 re-export（单一来源）。
2. `EnvironmentPanel.vue` 新增「Slow Roads 环境」区：季节/时间/天气三个选择器，
   直接写上述字段（不做派生值回写）；Background / 独立阳光参数 / 方向旋转等旧环境设置
   已整体移除，旧场景里的这些字段在归一化时直接丢弃（不做兼容）。
3. 下发通道：`schema/components/Component.ts` 的 `ComponentFrameState` 增加
   `environment?: { season, timeOfDay, weather } | null`；editor `SceneViewport`、
   `ScenePreviewView`、`SceneryViewer` 三端在现有 `setFrameState({cameraWorldPosition})`
   处一并注入。
4. `proceduralLandscape` runtime 通过帧状态读取环境；`src/core/environment*.ts`
   （类型 + 32 套预设）原样平移到 schema，作为共享预设表；太阳方向固定为 lab 常量
   `(0.42,0.72,0.28)≈方位 56.3°/高度 55°`（`SLOWROADS_SUN_*`），时间/天气只改颜色与强度，
   阴影只有一个总开关（质量参数用 `DEFAULT_SCENE_CSM_CONFIG`）。
5. 渲染接入：`lab/fogPatch|sky|clouds|stars|snow` 的机制随 proceduralLandscape
   迁移进 editor/preview/SceneryViewer 视口；天空是唯一背景（常显），三色雾在所有端
   始终生效（编辑器不再有"仅选中 Environment 节点才预览雾"的分支）。

## 性能与小程序约束（实测）

- 世界 1600m/1024 段，春季默认视角：draw calls 10–18，三角形 ~2.4M，FPS 100（本机）；
  世界生成 ~0.6s，季节切换（缓存命中）40–400ms，均为材质/图集更新，不重建地形。
- 环境系统新增开销：天空/云层/星空/降雪共 ≤4 个 draw call（晴天 +2，夜晴 +1 星，
  冬阴 +1 雪），云贴图 +293KB；时间/天气切换为纯 uniform/材质层更新（实测即时）。
  星空 4000 点、降雪 5476/48841 点两档（密度 0.5/1 切换几何）。
- 常驻纹理：完整模式 ~123MB 解码显存，兼容模式（@2048）~75MB；单季压缩下载量
  19–29MB（季节切换按需加载，LRU 保留当前季 + 共享集）。
- 兼容模式 = 纹理按 `MAX_TEXTURE_SIZE` 回退 `@2048` 变体 + 地形材质缩减到 9 个采样器，
  用于对齐微信小程序（主包 ≤2MB、分包 ≤4MB、纹理单元/显存受限）的降级路径；
  下载链路在「服务器下载」模式下以 fetch→blob→纹理复现（小程序侧为
  `wx.request` + assetDownload worker，协议一致）。

## 控制

- 季节：春/夏/秋/冬四按钮（首次切换加载该季素材，带进度遮罩）。
- 时间·天气：早晨/白天/傍晚/夜晚 + 晴/阴六按钮，即时生效；诊断开关见运行环境区。
- 自由相机：拖拽旋转、WASD 移动、Q/E 升降、Shift 加速；「巡航」沿路行驶（14 m/s）。
- 图层：地表混合/贴图、道路（贴图带+地形路面带）、树冠色斑、草、灌木花草、
  树卡/远景树、近树 3D 网格、水面、护栏、风摆；滑杆覆盖树/草/灌木/高草/花草密度、
  道路宽与压平带、近树卡距离、近树 3D 半径、风强度等。
- 左下角统计：FPS/draw calls/三角形、各层实例数、道路长度与生成耗时、切季耗时、
  纹理常驻估算与当季下载量（服务器模式另计已下载总量）。

## 自检与验收

- 启动时运行纯函数自检（噪声/道路确定性、放置过滤、护栏间距）+ 季节目录校验
  （四季贴图槽位齐全、区域表格位语义、调色板与特效参数、模型文件齐备、贴图色彩
  空间表 vs 官方装载表、同文件多槽位色彩空间一致、逐季 alphaTest 表）+ 环境校验
  （32 套预设、星空/降雪不变量）+ **景观材质 uniform 覆盖校验**（扫描地形/道路/
  水面/植被/近树所有 `slowroads-*` ShaderMaterial，着色器里声明的 uniform 必须在
  JS uniform 表里；这项专防「地面过暗」那类静默归零故障，见下节）+ **雾色色彩空间
  校验**（`fogColorA/B/C` 必须是渲染输出色空间分量，见第四批）。
- 验收截图（同种子 456268425、同机位、白天晴，`docs/`）：`season-spring.png`
  （绿野+路缘苔痕/花丛）、`season-summer.png`、`season-autumn.png`（黄褐+落叶
  overlay）、`season-winter.png`（雪地/雪路/积雪树/冻水）；官方同 code
  （`#A2-3fbae343@0`，STYLE 菜单逐季）参考图在 `docs/official/season-*-day-clear.png`。
  官方早/晚对照（同一在路机位、STYLE 逐项切换）在
  `docs/official/season-{spring,summer,autumn}-{morning,evening}-clear.png`。
  另含 3D 近树分级过渡与兼容模式对照。服务器模式与本地模式画面一致。
  （2026-10 第三批修复后，全部验收图已按同一固定机位重拍，见下节验收数据。）
- 天气/时间验收截图（`docs/`，种子 456268425 同机位）：`env-spring-day-clear`
  （标定回归，对 `season-spring.png` 观感一致、云层为新增）、`env-spring-morning-clear`、
  `env-spring-evening-clear`、`env-spring-night-clear`（星空）、`env-spring-day-overcast`、
  `env-winter-day-overcast`（降雪）、`env-winter-night-overcast`、`env-winter-night-clear`
  （冬季星空）、`env-compat-2048`（兼容模式，常驻 76MB）、`env-server-mode`
  （服务器下载 25MB 已下载，云层照常加载）。`env-compat-2048` 自第三批起改用
  标准路景机位（原为树间视角）。
  （2026-10 第四批（雾色色彩空间）后，`env-*.png` / `season-*.png` / `preview.png`
  已按同一固定机位全部重拍；`env-server-mode.png` 的素材 URL 显示为 8098 —— 本次
  会话里 8097 被重复启动的 dev server 占用，素材服务另起在 8098，下载链路一致。）

## 渲染对齐官方（地表 + 植被 × 四季，2026-10 修复）

对照对象：slowroads.io 线上包体（`%TEMP%/sr`：U(url, aniso, wrap, colorSpace)
装载表、`xr()` 近树材质、lit12/lit15/lit26/lit45 等着色器片段）与线上同 code 截图
（`docs/official/season-*-day-clear.png`，code `A2-3fbae343@0`）。已修复的确定性缺陷
（均有官方调用点证据）：

1. **地面过暗（主因）**：`terrainMaterial.ts` 用了 `LANDSCAPE_LIGHT_GLSL` 的官方光照
   uniform，但 JS uniform 表里没建 `uAmbientColor/uHemiColor/uRadiance/uShadowFactor`，
   运行时全为 0；环境控制器又因此把地形当"旧材质"，只下发 `sunColor × 0.21`。
   净结果：地形无环境光/半球光/自发光，实测草地 RGB≈(46,74,26)，官方≈(148,148,74)。
   修复：地形与 foliage/road/treeMeshes 同构（`bindLandscapeLightingUniforms`），
   走官方 `direct×(1+emissive)+indirect`；太阳方向恢复竖直向下 `(0,1,0)`。
2. **草纤维贴图色彩空间**：官方 `U(maps.grass, 4, void 0, void 0)` = Repeat + srgb，
   lab 原标 linear → 改正；冬季 `grass`/`detailNear` 是同一文件，均标 srgb（对应官方
   纹理缓存单实例、"先加载者生效"）。
3. **针叶近景贴图**：官方 `trees[1]` 的 `_m` 与 `_a` 都是 RepeatWrapping（OBJ 的 V 会
   绕回到 ~4.9），`_a` 走默认 srgb；lab 原为 clamp + linear → 已改正。
4. **树卡/远景树公式**：leafEffect 现为 `step(b*1.5, g) * vLeafBrightness`；补上
   `diffuse *= vRadianceBlend`；删除自创的 `farTintScale` 与每实例随机 `vTint`；
   裁切阈值改为官方逐层/季值（草丛 .5/冬 .2、灌木 .2/冬 .3、近树卡阔叶 .5/针叶 .4、
   远景树 .6/冬 .5），灌木另加随视深 0.5→0.2 的 alpha。
5. **近树 3D 网格**：针叶 alpha 图采样绿通道、alphaTest .4、Repeat + srgb；阔叶法线
   改为官方 ObjectSpace 法线图（`normal = normalize(basis * mapN)`）。修复前实测近树
   脚下会贴出"树形暗色图案"（图层开关定位到近树 3D 层），修复后消失。
6. **灌木/草丛**：灌木去掉 dapple 噪声与随机 tint，自发光改为官方 `texel × radiance ×
   vAO`（`vAO = clamp(position.y, 0, .5) * 2`）。
7. **云贴图**：官方为 srgb-linear，lab 原传 srgb → 改正。

验收数据（同机位前景草地区域均值，sRGB）：修复前 lab (46,74,26) → 修复后地面-only
(113,145,62)、含草丛 (109,153,55)，官方同条件 (146,146,74)；明度/色相进入同一区间。
剩余差异来自两边世界地形高程与调色板分布不同（官方取景在高地 peak 色区，lab 取景在
河谷 grass 色区；公式与参数一致）。

## 渲染对齐官方（第二批：边缘光 / LOD / 水面 / 星空）

在第一批（光照接线、色彩空间、alphaTest）之上，把此前记为「未实现的官方高级特性」
一并补齐（同样按官方 chunk 逐行移植）：

1. **地表掠射边缘光**（官方 `mu` chunk）：`fresnelFactor` 随预设下发（
   `uFresnelIntensity`），接近水平视线时提亮、背光侧 darkFresnel 压暗；`blendVal`
   与 `vShadow`（树影）参与衰减。
2. **近路地形位移**：路肩 16m 内按官方 `displacement_vertex` 沿法线加 `rock_bump`
   微起伏（强度 0.8、uv = 世界坐标/100，`#ifndef TERRAIN_REDUCED` 保护兼容模式）。
3. **草丛边缘光**（官方 `Zu`）：草尖在掠射角提亮（`clamp(uv.y*3,.7,.9)`、
   `min(1, cameraDistSq/100)`、`(1-vShadow)`、`max(doColor,.5)`）+ darkFresnel；
   草丛/灌木改用**每实例 groundNormal**（lab 从高度场采样）受光；per-instance shadow
   用 lab 的树密度图近似官方世界生成器的 `shadow` 属性。
4. **树卡三级 LOD 按官方 dissolve 交接**：`近树卡距离`（默认 190 = 官方 view
   distance medium 的 `lod1Horizon(19)×10`）推导 `interval=0.3*far` —— 近树卡
   [133,190] 淡出、远景树 [110,167] 淡入；近树卡新增官方动态 alphaTest 与模型高度
   `vLeafBrightness`，用 noise 抠洞 dissolve。
5. **远景树改官方 imposter**：朝相机广告牌 + 16 朝向图集列（按视角选列）+ 相邻列
   角度混列（400m 内）+ 距离放大 30%/下沉 4m + 近处隐藏的 dissolve；
   阔叶/针叶各自的叶色规则（阔叶 `rg*=disc` 且带叶辉光，针叶仅 `g*=disc`）。
6. **修复树卡被压扁**：官方半高变体裁剪只作用于草丛层，此前 lab 把该规则套在
   树卡/远景树/护栏上（3/4 变体被压成半高）——现已按层隔离。
7. **水面**：改用官方 `base/body/highlight` 三色 + `seaDot` 混色模型，`fresnelFactor`
   缩放高光；冬季冰面保留 lab 的冻结外观。
8. **路面边缘光**：官方 `ef` chunk（与地表同款、无 blendVal/uv 偏置）。
9. **星空**：恢复到官方 `size=0.01`（dpr=1 下与线上同观感；星空容器 renderOrder
   归 0 是为 lab 独立天空 mesh 的场景结构所需，不改变观感）。
10. **防回归**：`uFresnelIntensity` 缺失就是被新的 uniform 覆盖检查当场抓出来的
    （18 个景观材质全部校验），随后补进 foliage/road/treeMeshes 的 uniform 表。

## 渲染对齐官方（第三批：近景树层密度压暗，2026-10）

**症状**：早晨/傍晚（暗时段）lab 近景树层（近树卡 + 近树 3D 网格）比官方亮 1.6–2.6 倍，
暗时段反差放大即「发白」；白天因整体明亮不明显。

1. **根因**：官方近树卡与近树网格**共用同一材质**（`xr()`），顶点计算
   `vLeafBrightness = 1 - densityFactor × saturate((10 - 模型高度m)/3)`（摘录：
   `reference/official/treecard-vertex-near.glsl`，属性声明见 `lit21_at423248.glsl`），密林下半部
   最多压到 ×0.2；该值同时进入 `leafEffect`（变色 + 叶辉光，lit26）与 `diffuse *= vRadianceBlend`。
   lab 近树卡此前误用远景树变体（常数 0.25、只压 uv.y 底缘），近树 3D 网格则是纯
   Lambert、完全没有这些项。
2. **近树卡**（`foliage.ts`）：`uDynamicAlpha` 分支改用逐实例密度（复用顶点已采样的密度图值
   `clamp(densityMap(xz)×1.15, 0, 1)`，等价官方 per-instance `density` 属性）× shadowFactor ×
   `saturate((10 - position.y×aSize.y×实例矩阵Y)/3)`；该值经 leafEffect 同时作用于变色与
   叶辉光。远景树/广告牌保留官方 0.25/uv.y 变体，两套公式互不串用。
3. **近树 3D 网格**（`treeMeshes.ts`）：补齐官方共享材质着色项 —— 顶点采样同一密度图
   （新增 `uDensityMap/uWorldSize/uWorldHalf`）、米高 = `position.y × |实例矩阵 Y|`（模型归一化
   到 8m×scale）；片元 `leafEffect = step(b×1.5, g) × vLeafBrightness`，阔叶
   `rg *= 1-(1-disc)×leafEffect` 且带叶辉光 `vec3(rg×8,0.5)×radiance×leafEffect×vRadianceBlend`、
   针叶 `g *= disc`；补 `diffuse *= vRadianceBlend`（视深 50→250m 最多 −33%）；材质
   `userData.radianceScale = 0.5`（官方 `lights.radiance/2`）；雾的 include 顺序统一为
   tonemapping → colorspace → fog。
4. **接线**（`main.ts`）：近树网格材质传入与 foliage 相同的密度纹理与世界尺寸（世界重建时
   刷新）；无新增 UI 开关。

**验收数据**（种子 456268425、重置视角、同机位；亮度 = 0.2126R+0.7152G+0.0722B；
树带 = 树冠主体区域，地面 = 同图草地，均排除道路/UI 面板）：

取样区域（1688×1270 图内像素框）：lab 树带 = x[0,430]y[450,700] + x[950,1240]y[480,700]，
草地 = x[60,400]y[980,1120] + x[900,1230]y[1000,1200]；官方同 code 树带 =
x[1000,1550]y[330,440]，草地 = x[80,520]y[500,900]。

| 条件 | lab 修复前 | lab 修复后 | 官方同 code（同口径） |
| --- | --- | --- | --- |
| 春·晨·晴（主验收） | 1.97 | 1.39 | 1.29 |
| 春·昏·晴（主验收） | 3.46 | 2.01 | 2.28 |
| 夏·晨·晴 | — | 1.45 | 1.13 |
| 秋·晨·晴（有 haze） | — | 1.51 | 1.22 |
| 秋·昏·晴（无 haze 对照） | — | 1.38 | 1.03 |
| 春·昼·晴（回归） | 1.12 | 1.09 | — |
| 春·夜·晴（回归） | 3.60 | 2.52 | — |

- 树带均值（sRGB，同口径）：春晨 lab 修复前 (162,98,112) → 修复后 (128,66,70)，
  官方同机位 (106,80,68)；春昏 (126,75,48) → (83,42,19)，官方 (42,41,29)。近树层不再
  发白；残余差异主要来自 lab 雾/haze 色与取景构图（官方取景含车与更密树线）。
- 回归：白天树层不更亮、不压死（比值 1.12→1.09）；夜景与官方同样受密度压暗影响
  （近树由白亮转为深色），观感一致、无压死。
- 官方对照（线上 slowroads.io 同 code `#A2-3fbae343@0`，同一在路机位、逐项切 STYLE）：
  `docs/official/season-{spring,summer,autumn}-{morning,evening}-clear.png`。
- `docs/` 验收集（`season-*.png`、`env-*.png`、`preview.png`）已按同一固定机位重拍；
  与修复前对比：近树层明显变暗（树带/地面比值 2.0/3.5 → 1.4/2.0），地面与远景不变。

## 渲染对齐官方（第四批：雾色色彩空间，2026-10）

**症状**：春季早晨 / 傍晚（粉 / 橙预设）天空比官方**偏暗、偏红**（白天因整体明亮不明显）。
同机位天空顶部取样（sRGB）：春晨 lab (135,99,157) vs 官方 (182,155,192)；春昏
lab (69,35,26) vs 官方 (151,103,82)。

**根因**：slowroads 的 fog chunk 被 three 排在 `tonemapping_fragment → colorspace_fragment
→ fog_fragment` 之后，混色发生在**显示空间**，所以官方改过的 three 构建在
`refreshFogUniforms` 里用输出色空间推入雾色：

```js
// 官方 three 构建（chunks__conifers.26f84295.js，摘录见 reference/official/bundle-excerpts.js）
function Bs(i){ return i.getRenderTarget() === null ? i.outputColorSpace : ColorManagement.workingColorSpace }
f.colorA.getRGB(m.fogColorA.value, Bs(i));  // colorB / colorC 同理
```

lab 原来直接 `fogColorA.value.copy(<工作色空间 Color>)`，等于把**线性分量当 sRGB 用** →
雾与天空整体偏暗、偏饱和；饱和度高的预设（春晨 `#E496AD`、春昏 `#E49567`）就表现为「太红」。
逐通道反解春晨天空的 A/B 混合系数时，线性模型 R/G/B 解出同一个 t（0.44–0.52），
sRGB 模型三通道互相矛盾，坐实了色彩空间判断。

1. **修复**（`lab/fogPatch.ts` / `lab/environmentController.ts`）：新增
   `resolveFogUniformColorSpace(renderer)`（官方 `Bs(i)` 等价物）与
   `writeFogUniformColors(source, target, colorSpace)`（官方 `refreshFogUniforms` 等价物）；
   环境控制器保留工作色空间的 `fogColors`（对应官方 `fog.colorA/B/C`），另存一组
   `fogUniformColors`，在状态变更的 dirty 分支里换算一次，再下发到共享 uniform
   （天空 / 云 / 星空）与 `applyFogToScene` 覆盖的所有材质（地形 / 道路 / 植被 / 近树 /
   水面），语义写进 `applyFogToMaterial` 注释。
2. **防回归自检**（`main.ts`）：`checkFogUniformColorSpace()` 在每次世界构建后断言
   参考预设春/晨/晴 `fogColorA ≈ (0.8941, 0.5882, 0.6784)`（= `#E496AD` 的输出色空间
   分量）且 ≠ 线性分量 `(0.7758, 0.3050, 0.4179)`，并校验当前预设的 `fogColorA/B/C`
   实际下发值；把换算目标色空间改回线性时该断言立即失败（本次已实测）。
   证据归档：`reference/official/bundle-excerpts.js`、`reference/official/OFFICIAL-RENDERING.md`。

**验收数据**（种子 456268425、同机位 1688×1270、天空顶部取样带 y=10..30；复现修复前
状态的方式：临时把换算目标色空间改回 `LinearSRGBColorSpace` 再同机位截图）：

| 条件（天空顶部，sRGB） | lab 修复前 | lab 修复后 | 官方同 code |
| --- | --- | --- | --- |
| 春·晨·晴 | (135,99,157) | (176,148,187) | (182,155,192) |
| 春·昏·晴 | (69,35,26) | (149,86,64) | (151,103,82) |
| 春·昼·晴 | (105,149,219) | (147,191,238) | (194,219,239) |
| 春·夜·晴 | (7,5,9) | (22,34,52) | — |
| 春·昼·阴 | (151,151,151) | (190,190,190) | — |

- 春晨 / 春昏与官方的每通道差从 (47,56,35) / (82,68,56) 降到 (6,7,5) / (2,17,18)
  （春昏残余来自云层与取景差异）。
- 春昼残余 (37,22,-1) 主要来自云层尺度差（见「已知差异与后续」），不再是雾色问题；
  春夜 / 春昼阴按官方预设模型 (22,34,52) / (190,190,190) 对得上，修复前明显过暗。
- 作用域 A/B（同一图内取样带均值，修复前 → 修复后，春·昼·晴）：天空顶部 +42/+42/+19、
  天空中部 +48/+46/+21、天空下部 +53/+44/+22，而远景地形 +2/+1/−3、近景草地 +1/+1/0、
  近路面 +1/0/+1 —— 变化只落在雾 / 天空像素；近景仅受 `vHaze` 去饱和项（≈2%）影响。
- 回归：昼 / 夜 / 阴三档方向一致（更亮、更少饱和），无过曝；启动自检（含新增雾色色彩
  空间项）与 uniform 覆盖审计全绿；`pnpm --dir tools type-check:slowroads-lab` /
  `build:slowroads-lab` 通过。
- 重拍：`docs/env-*.png`（10 张）、`docs/season-*.png`（四季）、`preview.png` 全部按同一
  固定机位重拍；`docs/official/*` 参考图未动。

## 渲染对齐官方（第五批：天空/云层雾尺度，2026-10）

**症状**：春季早晨（以及春季傍晚等暗时段）lab 天空比官方「更糊」——下部过饱和发粉/发橙、
上部缺蓝，云层结构弱。对照官方同 code 同时间：春·晨·晴 官方天空是「地平线粉 → 上部薰衣草
蓝」的渐变，lab 则是覆盖到画面顶部的均匀粉。

**根因**：lab 把 `ENVIRONMENT_VIEW_DISTANCE`(1000) 同时当作雾尺度（fogNear/fogFar、天空平面
距离、云层覆盖权重），而官方 `updateSky()` 用的是 `n1 = graphicsPreset.tileSize * 2`(2000)
（`reference/official/bundle-excerpts.js:156`）。由于 `vFogBlend` 由 `(fogNear + fogFar)/2`
推出：`preset.fog.near < 0` 的 8 套预设（春·晨·晴 / 春·晨·阴 / 春·夜·阴 / 夏·晨·阴 /
夏·昏·阴 / 冬·昼·阴 / 冬·昏·晴 / 冬·夜·阴）在 1000 尺度下 `fogAvg = 400 < 500` → 0.778
（经相机 haze 插值约 0.72），官方 800 → 1.0；天空 A/B 每仰角少混 0.116，云层覆盖权重
`min(1, fogBlend)` 同时被压到 ~72%。

**修复**：把「天空 + 云层 + 星空」的雾参数改用官方 `n1 = 2000` 尺度，与地形/植被的 1000 尺度
拆成两组共享 uniform（`fogPatch.ts` 的 `slowroadsFogUniforms` / `slowroadsSkyFogUniforms`）；
天空平面挂到 `z = -(2000 - 0.1)`；`environmentController` 每帧对两套参数各跑一次官方 haze 插值。
地形 / 植被 / 道路 / 水面 / 降雪保持 1000 尺度（1600m 世界边缘遮挡与性能不变），云层几何
（云高 300 / 平面 3600）不变（对 (云高, 视距) 是尺度不变量）。

1. `core/environment.ts`：新增 `ENVIRONMENT_SKY_DISTANCE`（= 2 × `ENVIRONMENT_VIEW_DISTANCE`）、
   `resolveSkyFogParams()`、`resolveFogDepthBlend()`（官方 `vFogBlend` 纯函数）。
2. `lab/fogPatch.ts`：新增天空组共享 uniform + `bindSlowroadsSkyFogUniforms()` /
   `applySkyFogParams()`；天空/云/星材质改绑天空组。注意 three 的 `refreshFogUniforms` 对
   `FogExp2` 只写 `fogDensity`，会把场景密度写进天空组 —— 对天空无影响（天空平面位于天空尺度
   fogFar，`vFogDepth` 已饱和），因此**不要**为了让密度一致去改 `scene.fog.density`。
3. 自检：`core/selfCheck.ts` 增加天空尺度断言（`sky = 2 × view`、参考预设天空 vFogBlend = 1 /
   场景 = 0.7778、32 套预设「天空 blend ≥ 场景 blend」且「二者不等恰好落在场景 fogAvg < 500
   的预设上」）；`main.ts` 新增运行时 `checkSkyFogScale()`（天空组 uniform = 天空尺度参数的
   haze 插值结果、天空 far = 2 × 场景 far、天空平面 z、两组雾色一致），挂在 world 重建末尾。

**验收数据**（种子 456268425、同固定机位、1688×1270）：

- 硬性断言（启动日志）：`sky fog scale: sky vFogBlend=1.0000 scene vFogBlend=0.7778
  (spring/morning/clear, skyFar=2000.0, sceneFar=1000.0)`；`environment checks passed (8)`、
  uniform 覆盖审计全绿。
- 平面证据（关掉「云层」开关，隔离天空平面）：春·晨·晴 天空剖面对上模型
  `mix(colA, colB, 2·sinθ·vFogBlend)` —— 9° 实测 (193,164,201)，天空尺度模型 (203,160,194)，
  场景尺度模型 (209,158,189)；12° 实测 (186,167,209) vs (195,164,201) vs (202,161,195)。
  实测落在天空尺度一侧（偏蓝于模型，来自取样行对应的真实仰角更高），修复前后一致证明天空组
  参数确实进了 shader。
- 对照官方参考图（`docs/official/season-spring-morning-clear.png`，按各自地平线同仰角取样）：
  春·晨·晴 逐通道差 修复前 (+8,−6,−6)@12° → 修复后 (+11,−1,−3)@12°（B/G 收敛、R 未收敛）；
  0.4–11° 整带均值：修复前 (210,152,180) → 修复后 (210,152,179)，官方 (205,154,184)。
  春·昏·晴（该档天空 vFogBlend 本就是 1.0，改动只落在云层绑定）：修复前/后与官方参考图
  `docs/official/season-spring-evening-clear.png` 的差分别在 ±3（1.5–9°）与 ±8（12°）以内，
  修复前后逐段变化 ≤4 —— 即傍晚天空平面本就与官方一致，本批不改变也不劣化它。
- **结论（如实记录）**：天空平面与云层覆盖权重已按官方尺度下发（可证），但本机位下「带云层」
  的整幅天空观感几乎不变 —— 平面变蓝（+0.116 混合）与云层覆盖变强（×1.39，晨云为粉/灰）
  正好互相抵消。修复后与官方参考图残余的 +5R/−5B（整带）主要来自参考图取景差异（官方图
  相机俯仰与地平线判定不同、FOV 未知）与云层图案随世界坐标的相位差（两侧世界不同），
  不是雾尺度问题。

**重拍**：`docs/env-*.png`（10 张）、`docs/season-*.png`（4 张）、`preview.png` 按同一固定
机位（种子 456268425、重置视角）重拍；`docs/official/*` 参考图未动。`env-server-mode.png`
用 `node scripts/serve-asset-bundle.mjs --port 8098`（本机 8097 被 dev server 占用）复现按需
下载链路，面板里 URL 文案被截断，统计行显示「已下载 30.4MB」。

## 渲染对齐官方（第六批：树卡变色语义，2026-10）

**症状**：冬季（雪地）里针叶树冠呈**洋红/紫色**，与官方同 code 同季节明显不一致
（`docs/season-winter.png` 的提交态即可复现）；春/秋/夏只是亮度略偏（不明显）。

**根因**：官方 `effects.treeDiscolouration`（春 1.5 / 夏 .9 / 秋 1.2 / **冬 .2**）是变色**噪声的
幅度**，不是通道乘数。官方顶点分块（`chunks__DevMidlineGenerator.7013ef99.js:1403`、
`chunks__conifers.26f84295.js:3723`、`nodes__3.da2ad8c8.js:865/1361`）先把它换算成 ≈1 的乘数：

```glsl
discolouration = 1.0 + (texture2D(noiseMap, wPos.xz / 256.0).r - 0.5) * discolourationFactor;
if(vMapUv.x > 0.76) discolouration = discolouration * 0.5 + 0.5;   // 柏树列兜底（仅近树）
```

lab 此前把因子本身当乘数（`foliage.ts:487/490/497`、`treeMeshes.ts:148/151`）：冬季
`g *= 0.2`（针叶）/ `rg *= 0.2`（阔叶/近树卡），绿通道被压掉 80% 只剩蓝通道 ⇒ 洋红。
图集实测吻合：冬季针叶近树图集 `winter_trees_1_m` 均值 (74,87,71) → ×0.2 得 (74,17,71)；
远景树图集 `winter_imposters_1_d` (79,81,78) → (79,16,78)。夏季 0.9 仅轻微压暗、春秋 >1 偏亮，
所以只有冬季暴露成"紫色"。三层树（近树卡 / 近树 3D 网格 / 远景树）都受影响——官方 imposter
同样用 `rg *= disc` / `g *= disc`（块 `Tu`），不是不用。

**修复**（`src/lab/foliage.ts`、`src/lab/treeMeshes.ts`、`src/core/seasonParams.ts` 注释、
`src/main.ts` 接线）：

1. uniform 更名 `uTreeDiscolouration` → `uTreeDiscolourationFactor`（值仍是预设因子），新增
   varying `vTreeDiscolouration`：在顶点按官方公式用 `noise(world.xz / 256)` 换算成乘数，
   近树层（`uDynamicAlpha` / 近树网格）再套柏树列 `*0.5+0.5`，imposter 不套（官方 imposter 无此项）。
   噪声贴图与树卡 dissolve 共用同一张（官方 `Ui` = `noise_fine.592be1a0`）。
2. 片元改消费 varying：imposter 阔叶 `rg *= disc` + 叶辉光、imposter 针叶 `g *= disc`、
   近树卡/近树网格阔叶 `rg *= 1-(1-disc)*leafEffect`、近树网格针叶 `g *= disc`。
3. 顺带对齐（同一批官方分块）：近树 3D 网格阔叶的**积雪公式**改为官方 `Cu`
   （`dotUp = dot(normal, vCameraUp)`，`dotUp > 0.1` 才混 `vec3(min(1, 0.5+dotUp))`，
   系数 `min(1, (dotUp-0.1)*8)`），替换此前 lab 自创的 `clamp(up*1.4)*0.8`；顶点补世界空间相机
   上方向 `vCameraUp`（等价官方 `normalMatrix * vec3(0,1,0)`，lab 网格法线是世界空间）。
4. 防回归自检：`core/selfCheck.ts` 新增纯函数 `resolveTreeDiscolouration(noise, factor)`
   （含柏树兜底）+ 季节检查断言「乘数区间 = 1 ± factor/2」「冬季乘数落在 0.9..1.1」，
   以及着色器源码断言 `runTreeDiscolourationShaderChecks`：因子只允许出现在顶点噪声公式里
   一次，片元必须消费 `vTreeDiscolouration`（把"拿因子直接乘通道"这个缺陷钉死）。

**验收数据**（种子 456268425、重置视角、1688×1270、同机位；洋红像素 = `r-g>25 且 b-g>25 且
min(r,b)>70`；树带 = 画面两侧针叶树带）：

| 指标 | 修复前 | 修复后 | 官方参考图 |
| --- | --- | --- | --- |
| 冬季·昼·晴 洋红像素占比 | 4.55% | **0%** | 0%（`docs/official/season-winter-day-clear.png`） |
| 冬季·昼·晴 树带右侧均值 | (179,162,189) g<r,b | (179,188,190) g≥r,b | — |
| 冬季·昼·晴 树带左侧均值 | (162,150,167) g<r,b | (162,167,167) g≥r,b | — |
| 冬季·昼·晴 雪地均值（作用域对照） | (141,144,145) | (141,144,145) | — |

- 作用域：仅树层变化，雪地/道路/天空逐通道不变；启动自检
  `season checks passed (10)`（新增 2 条）、`tree discolouration checks passed (1, tree materials=15)`、
  `uniform checks passed (1, materials=18)` 全绿；`type-check` / `build` 通过。
- 数值扫描（`resolveTreeDiscolouration` 的纯函数镜像，噪声 0..1 步进 1000，含柏树兜底）：

  | 季节 | factor | 乘数区间 | 柏树列区间 | 旧缺陷（因子当乘数） |
  | --- | --- | --- | --- | --- |
  | 春 | 1.5 | 0.250..1.750 | 0.625..1.375 | 1.5（恒偏亮） |
  | 夏 | 0.9 | 0.550..1.450 | 0.775..1.225 | 0.9（恒偏暗） |
  | 秋 | 1.2 | 0.400..1.600 | 0.700..1.300 | 1.2（恒偏亮） |
  | 冬 | 0.2 | **0.900..1.100** | 0.950..1.050 | **0.2（绿通道砍到 20% → 洋红）** |

- 其它季节抽查（同机位、树带/地面亮度比）：春·昼·晴 1.209 → 1.073、秋·昼·晴 1.128 → 1.068
  （此前对阔叶/针叶一律 ×1.5 / ×1.2，偏亮；现在按官方噪声乘数落在 1 附近），
  冬季 1.20（雪地树带）；无"发白/压死"回归。跨图绝对值仍受取景/地形差异限制
  （官方参考图相机在山坡草地、lab 在河谷，README 前几批已记录）。
- 逐层抽查（冬季·昼·晴，同机位，洋红像素占比）：只留近树 3D 网格（关「树卡/远景树」）
  0%、只留树卡/远景树（关「近树 3D 网格」）0% —— 两层都已修复，不是被另一层遮住。

**重拍**：`docs/env-*.png`（10 张，含 `env-compat-2048`，`env-server-mode` 用
`node scripts/serve-asset-bundle.mjs --port 8098` 复现，统计行显示「已下载 30.4MB」）、
`docs/season-*.png`（4 张）、`preview.png` 全部按同一固定机位（种子 456268425、重置视角）
重拍；`docs/official/*` 参考图未动。修复前后同机位对照留在
`.tmp-winter-before.png`（洋红树冠）与 `.tmp-winter-after.png`（修复后）。

**证据归档**：`reference/official/tree-discolouration-vertex.glsl`（幅度 → 乘数公式 + 柏树兜底）、
`tree-discolouration-channels.glsl`（逐层通道规则 + 近树积雪 `Cu`）、
`tree-cone-fshadow.glsl`（未移植的圆锥假暗化，含原因）、`OFFICIAL-RENDERING.md` 新增语义小节。

## 已知差异与后续

- **宽路 + 划线（第七批）**：官方按 `roadWidth < 2.25m` 在 `roadSingle` 与宽路
  （`road_base` + 6 张划线）之间切换；lab 已按同一阈值自动选择，并移植官方划线权重算法
  （`core/roadMarkings.ts`：窗口内的转角/侧向梯度/山脊差三项加权、实线渐变回填、
  merge 过渡贴图）。两处已知残差：
  1. lab 默认路宽 7m（官方四种路型是 1.8 / 3.2 / 4.0m），划线贴图按整幅路宽铺满，
     因此线宽与沥青颗粒尺度约为官方 NORMAL（3.2m）的 2.2 倍；面板的「官方路型」
     下拉可直接切到 1.8 / 3.2 / 4.0m 复现官方观感。
  2. 官方划线权重在**细节点**（2m）累加、**粗节点**（10m）判定；lab 追踪步长 8m，
     窗口按节点数同口径（`markingsMargin`），`da` 已折算到 10m。
- **路侧墙体（第七批）**：官方 `WallController` 五类墙里，lab 移植了沿路生成的
  **Drystone / Barrier / Fence / SeaWall**（BridgeWall 与桥系统一起，未移植）：
  - 尺寸/UV/抖动/下沉全部取官方常量（石墙 1.1m 高 × 顶 0.32 / 底 0.38 / 下沉 0.2、
    `"wall"` 噪声 ±0.2m 位置 / ±0.1m 高度、每 5m 一个贴图循环）；
    两个已踩过的坑（都已修）：
    ① **墙体贴图必须 Repeat 寻址**——石墙/护栏/海墙的 u 沿墙推进（石墙每 5m、
    护栏每 1.67m），用 ClampToEdge 会把 u>1 拉成条纹（“材质花了”）；木栏是图集区域，
    仍用 Clamp。② 官方 `f0("wall", …)` 是**相干噪声**，抖动要在 10m 粗节点上取值、
    2m 细节点之间插值；逐点白噪声会让墙顶与墙身呈锯齿状。
  - 官方**护栏与木栏共用同一生成器**：`detail > 1` 时按节点序数交替出 Barrier / Fence，
    因此路边会同时出现木栏与混凝土护栏（lab `LAB_DETAIL = 3`）；
  - 官方梯度门限按 **lab 起伏尺度 ÷4** 折算（同地表高度带 ×4 的口径，`LAB_RELIEF_SCALE`）：
    官方宽路档 2.0 → lab 0.5，否则 lab 地形永远达不到官方阈值，护栏/海墙会完全不出现；
  - **干砌石墙的放置来源是等价的**：官方来自农田地块边界，lab 用官方 field 门限
    （20m 网格 + 海拔 15..220m × 4 折算 + 坡度 ≤0.7 + 概率 0.5）生成地块掩膜，
    紧贴公路的地块边界在 `roadWidth + 2m` 处成墙，段长规则用官方 30 / 3 / 4 节点；
  - 官方节点字段 `h`（路面抬升量）在 Hills 恒为 0，lab 按 0 处理（`h < 0.6` / `h < -1`
    两个门限因此恒真/恒假，与官方 shipped 行为一致）；
  - 季节贴图：春/秋/冬的宽路 overlay 与墙体贴图已按官方表接入（冬季四张 `winter_wall_*`
    与 `winter_road`、秋季 `road_overlay_autumn` 均已入库）；仍缺的只有夏/秋共用槽位
    （官方 `wall_drystone` / `wall_barrier_wood` 不在素材目录）→ 回退 `spring_wall_drystone`
    与 `spring_wall_barrier_wood`。
- **近树卡圆锥假暗化未移植**（第六批顺带核对）：官方近树卡是**圆锥网格**，其 `fShadow =
  sqrt(saturate(vShadow)) * 0.65; rgb *= 1 - fShadow`（块 `M0`）依赖锥面径向位置
  （`centerDist`、`position.y / 12` 米高、larch/cypress 半径修正）；lab 近树卡是十字面片精灵，
  几何上没有对应量，强行套用只会恒 0 或错误压暗，故维持「密度图近似 per-instance shadow」。
  原文见 `reference/official/tree-cone-fshadow.glsl`。
- **针叶树干列保护 `if(vMapUv.x > 0.125) g *= discolouration`** 只出现在官方 cone-card 路径
  （块 `Qg` / `M0`）；lab 近树卡单元格（u ≈ 0.465..0.759）与近树网格 OBJ uv 恒大于 0.125，
  该保护等价于不启用，因此未加代码（结论已记录，若将来改图集布局需一并启用）。
- **远景树 `S0` 假暗化待查**：`chunks__conifers` 的 `S0`（注释称 imposters 变体，
  `rgb *= 1 - sqrt(saturate(vShadow))`）需要 `vShadow` varying，而官方远景树顶点
  （`_u`/`Pu`/`Nu`）并未声明它——真实消费者未定位到 lab 对应的远景树层，本轮不实现。
- 依赖官方世界生成器的属性，lab 用等价近似：per-instance `shadow`/`density`（树影）
  用树密度图采样近似（含第三批的近树 `vLeafBrightness`）；树卡 dissolve 的 per-instance
  随机量用实例位置哈希近似；近树 3D 网格半径（90m）仍是 lab 默认值（官方是分块流式加载的
  隐含半径）。lab 树高约 6–12m（基准 8m × 实例缩放），小于官方 ~10–12m —— 官方 10m 高度
  阈值下 lab 的压暗包络略强，按公式一致性保留（数值仍落入官方区间）。
- 未接入：宽路 `road_base`+划线 paint 体系（官方非 NORMAL 路型）、农田割纹（field，
  官方 per-vertex `fieldCol` 来自其世界生成器）、Driftmas 专用冬季针叶贴图；
  `snow_spray.png` 已入库备用（车轮雪雾）。树冠 `radiance` 的夜间车灯项为 0
  （lab 无载具/车灯）；夜间保持官方低亮度。
- 星空容器 renderOrder 归 0（官方 -2，依赖其场景天空的 groupOrder 层级；lab 天空为
  独立 mesh）。这是场景结构差异，观感与官方一致；星点 size 已回到官方 0.01。
- 冬季木护栏使用 `winter_wall_barrier_wood.058b9fbc`；春/夏/秋沿用
  `spring_wall_barrier_wood.29edf0af`。硬护栏槽位 `barrier` 使用
  `wall_barrier.63193046`。
- 兼容模式（`TERRAIN_REDUCED`）不做近路位移（低端机顶点纹理单元不可靠），植被层仍
  采样密度图；其余渲染路径与完整模式一致。
- **环境尺度**：lab 把官方 graphics preset 的 `tileSize`(1000) 当作视距，而官方 Hills 实际用
  `n1 = tileSize * 2`(2000) 作为 fogNear/fogFar、天空平面 `sky.position.z = -n1 + 0.1`
  与云平面尺度（`P2 = max(n1*2, cloudAltitude*12)`），云高取该档的 `cloudAltitude`(500)
  （lab 云层几何仍为云高 300 / 云平面 3600）。**第五批已把天空 / 云层 / 星空的雾参数改用官方
  `n1`(2000) 尺度**（见上文第五批），因为 `vFogBlend` 由 `(fogNear+fogFar)/2` 推出，春晨这类
  `near < 0` 的预设此前 lab 得 0.778、官方为 1.0，天空 A/B 混色与云层覆盖权重
  `min(1,fogBlend)` 都被压低。
  **地形 / 植被 / 道路 / 水面 / 降雪仍是 1000 尺度**：lab 世界只有 1600m，直接套官方尺度会让
  晚间 1200m 内完全无雾、露出世界边缘。因此地平线附近的远景雾浓度仍比官方高（同一距离约
  2× 雾量），要整套对齐需把世界扩到约 4000m 或给地形加分层次 LOD，另开一批。
  云穹的投影与纹理平铺对 (云高, 视距) 是尺度不变量（半宽 = max(2×视距, 12×云高)、纹理单元 =
  `skyScale × 云高`，两者同比例），所以云高 300 与官方的 500 在屏幕上等价，不存在
  「云纹理尺度 1.67× 差」（原文该说法有误，已更正）。唯一残差来自相机高度：lab 相机（~13–45m）
  远高于官方（~2m），云纹理在天空中的采样相对位置仍有约 6–11% 差异。
- **迁移端已同步（2026-10，完全重构）**：editor / preview / SceneryViewer 消费的
  `schema/slowroads/*` 与 `schema/proceduralLandscape/*` 已按本 README 的第一~六批全部对齐
  （雾色输出色空间、天空/云层/星空 2000 尺度、树卡变色幅度→乘数、近树积雪 Cu、草丛掠射
  边缘光、逐层/季 alphaTest、每实例 groundNormal、imposter billboard 等），并按本工程口径
  补齐水面 / 木护栏 / 花草高草层 / 树冠色斑 / 风摆与启动自检；旧 props 与旧代码路径
  （`fogEnabled`、`srFogEnabled`、`SLOWROADS_SUN_*`、`grass.windEnabled`、远景树环）已删除。
  迁移端与 lab 的接口差异（编辑器地形来自导入 GLB、世界尺度/高程不同、雾尺度自适应、
  高度带归一化、编辑器反 Cineon 雾色预补偿）见 `docs/slowroads-lab-parity.md`。
- editor/preview/SceneryViewer 的正式接入与小程序真机验证为下一步；本工程交付
  lab 验证 + 资产包（`assets-src/asset-bundle.json`）+ 上述映射文档。
