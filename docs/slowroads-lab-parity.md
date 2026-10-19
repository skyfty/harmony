# Slow Roads 渲染对齐记录（lab → editor / preview / SceneryViewer）

> 基准实现：`tools/slowroads-lab`（README 记录了第一~六批「对齐官方」修复与验收数据）。
> 迁移目标：`schema/slowroads/{core,render}`、`schema/proceduralLandscape/*`，以及三个视口
> （`editor/src/components/editor/SceneViewport.vue`、`editor/src/views/ScenePreviewView.vue`、
> `scenery/components/SceneryViewer.vue`）。本轮为**完全重构**：不保留旧 props / 旧场景
> 数据 / 旧代码路径（旧字段在归一化时直接丢弃，缺失字段补新默认值）。

## 一致性定义

- **必须一致**：地表贴图/材质、植被（草丛/灌木花草/高草）、树木（近树卡 / 近树 3D 网格 /
  远景树 imposter）、光照、雾（三色 + 天空 2000 尺度）、天空、云层、星空、降雪、水面、护栏、风摆。
- **允许残差**：地形形状与高程（编辑器地形来自导入 GLB；lab 是程序化 1600m 世界）；
  编辑器视口 `EffectComposer`（FXAA + 选中描边）造成的抗锯齿差异；地形尺度带来的雾距放大
  （见「雾尺度自适应」）。
- **不保留兼容**：`fogEnabled/setSlowroadsFogEnabled`、`srFogEnabled`、`SLOWROADS_SUN_*`、
  `grass.windEnabled`、相机锚定远景树环（`farTreeInstances`）全部删除；旧 `barrier` 组
  （下坡落差近似）废弃后仅做**读入映射**（`enabled` → `walls.{fence,barrier,seaWall}`，
  `density` → `walls.drystone.density`，`spacing` / `dropThreshold` 丢弃）。

## 已落地的对齐项（对应 lab 批次 / 模块）

| lab 批次/模块 | 迁移端落点 |
| --- | --- |
| 第一批（光照接线、色彩空间、alphaTest、树卡公式） | `seasonCatalog`（grass / 冬季 grass+detailNear / coniferA = srgb、clouds = srgb-linear）、`seasonParams`（grass/bush/imposterAlphaTest，冬 .2/.3/.5）、`instancing`（逐层/季裁切、去随机 tint 与灌木 dapple） |
| 第二批（地表/草丛掠射边缘光、近路位移、道路 fresnel） | `surfaceMaterial`（`uPlFresnelIntensity` + light/dark fresnel、`rock_bump` 顶点位移、`canopy` 门控）、`instancing`（官方 Zu 草丛边缘光、每实例 `aPlGroundNormal`）、`roadBand`（路面 fresnel ef chunk） |
| 第三批（LOD、树密度、近树卡距离） | `runtime`（近树卡 dissolve 区间由 `forest.nearDistance` 推出、近树 3D 半径 `forest.nearTreeRadius`、树高 5..12m）、`instancing`（近树卡动态 alpha、远景树朝相机广告牌 16 朝向列 + 角度混列） |
| 第四批（雾色输出色空间） | `fogInjection`（`resolveFogUniformColorSpace` / `writeFogUniformColors`）+ `environmentRuntime`（注入 `renderer`、dirty 时换算一次）；编辑器经 OutputPass 时改用**显示空间等价注入**（见「天空/雾显示空间对齐」一节） |
| 天空/雾显示空间对齐（本轮修复） | `fogInjection`（`setSlowroadsFogDisplaySpaceMode` + 显示空间片元体/尾体 + `srDisplayExposure`）、`environmentRuntime`（天空密度取场景密度、SR 背景色）、`sky`（覆盖角几何）、`clouds`/`stars`/`waterPlane`/四个景观材质注入选项 |
| 第五批（天空/云层/星空 2000 尺度） | `core/environment`（`ENVIRONMENT_SKY_DISTANCE`、`resolveSkyFogParams`、`resolveFogDepthBlend`）、`fogInjection`（`slowroadsSkyFogUniforms` + `applySkyFogParams`）、`sky`（平面 z = -(2000-0.1)）、`clouds`/`stars` 绑天空组 |
| 第六批（树卡变色幅度→乘数、近树积雪 Cu） | `instancing`（顶点按 `noise(world.xz/256)` 换算乘数 + 柏树列兜底、片元消费 varying）、`treeMeshes`（阔叶积雪 `dot(normal, vCameraUp)`、`vLeafBrightness` 10m 高度压暗） |
| `lab/water.ts` | `proceduralLandscape/waterPlane.ts`（sea_waves 双滚波纹 + 菲涅尔天空色 + 太阳高光 + 冬季冻结；尺寸随地形包围盒、水线 = 地形最低点 + `water.levelOffset`，网格挂场景根保持世界水平） |
| 第七批（宽路 + 划线 + 路侧墙体，2026-10） | `roadStyle.ts`（官方路型表/墙体常量，lab 同源拷贝）、`roadMarkings.ts`（划线权重，lab 同源拷贝）、`roadTrace.ts`（节点新增 `index/lateral/longitudinal/turn/headingDelta` + 完成后的探针标注）、`walls.ts`（官方 Barrier/Fence/SeaWall 判定 + 干砌石墙地块等价规则）、`wallLayer.ts`（石墙/护栏/海墙网格 + 木栏精灵）、`roadBand.ts`（宽路贴图 + 划线属性与混色）、`config.walls` 组（旧 `barrier` 组读入映射）、`runtime.buildWalls()/roadBandTexturesFor()`、`stats.wallSegmentCount` |
| `core/placement.ts` 花草/高草层 | `chunkPlan.planRoadBucket` 的 `emitOuterLayer`（花草 → 灌木层、高草 → 草层；横向带、falloff、heightFactor 与 lab 逐行一致） |
| 第八批（植被避让道路：精确距离索引，2026-10） | `roadProximity.ts`（lab `core/roadProfile.ts` 段空间哈希移植：`buildRoadProximityIndex` / `RoadDistanceSource` / `verifyRoadProximityIndex`）、`runtime.ts`（建路时构建索引，作为放置过滤唯一距离源：分块树 / 远景林 / 相机草 / 走廊草灌木；光栅场仅剩着色器 uniform 与墙体探针）、`chunkPlan.ts` / `farForest.ts` 的 deps `roadField` 改型 `RoadDistanceSource`、`stats.memoryBytes` 计入索引内存 |
| `core/selfCheck.ts` | `schema/slowroads/render/selfCheck.ts`（环境预设 / 雾色空间 / 雾 uniform / 季节表 / 树卡变色着色器断言 / uniform 覆盖审计）+ `proceduralLandscape/shaderAudit.ts`（注入材质记录最终 shader 源码与 uniform 键，供审计） |
| 相机锚定远景树环（lab 无此机制） | **删除**：远景树回到分块内的 imposter 层（官方 2000 尺度雾 + 场景雾距覆盖）。`stats` 增加 `barrierInstances / waterEnabled / viewDistanceScale` |

## 关键接口

- `createSlowroadsEnvironmentRuntime({ scene, camera, renderer, assetStore, applyLighting?, deferredToneMapping? })`：
  `renderer` 必填（雾色输出色空间）；`deferredToneMapping: true` 供编辑器（EffectComposer +
  OutputPass）使用；删除 `fogEnabled` / `setFogEnabled`（三色雾常开）。
- `fogInjection`：新增 `slowroadsSkyFogUniforms` / `bindSlowroadsSkyFogUniforms` /
  `applySkyFogParams` / `resolveFogUniformColorSpace` / `writeFogUniformColors` /
  `precompensateFogColorsForDeferredToneMapping`；删除 `srFogEnabled`。
- `environmentRuntime` 新增通道：`getSlowroadsWaterEnvironment()`（水面快照）、
  `setSlowroadsSceneViewDistanceScale()`（雾/视距尺度倍率）。
- `core/environment`：新增 `ENVIRONMENT_SKY_DISTANCE`、`resolveSkyFogParams`、
  `resolveFogDepthBlend`、`SLOWROADS_SKY_COLOR(=0xc9dcee)`；删除 `SLOWROADS_SUN_*`
  （三端 CSM 太阳统一 `syncSun((0,1000,0))`）。
- `ProceduralLandscapeComponentProps` 新结构（默认值取 lab `DEFAULT_LAB_SETTINGS`）：
  `surface{enabled, textures, blendStrength, uvScale, baseMapMode, baseMapBlend, viewDistanceScale}`、
  `forest{..., nearDistance:190, nearTreeRadius:90, minScale:5, maxScale:12}`、
  `grass{enabled, corridorWidth:20, density, sinkNearRoad, flowerDensity, tallGrassDensity}`（删 `windEnabled`）、
  `bushes{enabled, density:.6}`、`canopy{enabled}`、`water{enabled, levelOffset}`、
  `barrier{enabled, density:.65, spacing:8, dropThreshold:1.2}`、`wind{enabled, strength:1}`。
  `clampProceduralLandscapeProps` 全量归一化（缺省补默认、越界夹紧，旧字段直接丢弃）。
- `ProceduralLandscapeRuntimeStats`：新增 `barrierInstances / waterEnabled / viewDistanceScale`，
  删除 `farTreeInstances`。
- `proceduralLandscape/roadProximity.ts`：新增 `RoadDistanceSource`
  （`range / distanceAt(x,z) / heightAt(x,z): number|null`）、
  `buildRoadProximityIndex(nodes, { maxDistance })`（精确点-线段距离，32m 段空间哈希，
  超限返回上限；节点 <2 或全退化返回 null）、`verifyRoadProximityIndex`（与暴力距离抽样
  比对，运行时启动自检与单测共用）。`LandscapeChunkDeps.roadField` /
  `FarForestPlanDeps.roadField` 类型改为 `RoadDistanceSource | null`（属性名不变）；
  `RoadFieldData`（光栅）现在 extends `RoadDistanceSource`。

## 启动自检（console + 面板 warnings）

- `runSlowroadsEnvironmentChecks`：32 套预设齐全；星空只在夜晴且恰好 4 套；降雪只在冬季且
  恰好 5 套；`sky = 2 × view`；参考预设（春·晨·晴）天空 `vFogBlend = 1`、场景 `= 0.7778`；
  「天空/场景 vFogBlend 之差恰好落在场景 fogAvg < 500 的预设上」。
- `runSlowroadsFogColorSpaceChecks`：两条管线都断言 `fogColorA` 是输出色空间（sRGB 显示）
  分量（春·晨·晴 ≈ (0.8941, 0.5882, 0.6784) 且 ≠ 线性分量）；编辑器延后色调映射时额外
  断言**端到端显示空间等价**——尾体反变换 + OutputPass 的 `sRGB∘Cineon` 在
  `blend ∈ {0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2}` 上逐点还原显示空间混色（≤1/255，
  含 > 1 外推段；关掉显示空间注入会当场失败）。
- `runSlowroadsFogUniformChecks`：下发后场景组/天空组与预设一致（天空 = 官方 n1 尺度、
  far = 2 × 场景 far、三色同源、天空平面 z = -(2000-0.1)）；天空平面几何倍率保持官方
  87.7° 覆盖角；**天空组密度 = 场景组密度**（`vFogDepth` 饱和，`vHaze` 巨值不外推泄漏）。
- `runSlowroadsSeasonChecks`：四季贴图槽位齐全、色彩空间表 vs 官方装载表、同文件多槽位
  色彩空间一致、逐季 alphaTest 表（冬 .2/.3/.5）、精灵区域表语义、树卡变色乘数区间
  （1 ± factor/2，冬季 0.9..1.1）。
- `runTreeDiscolourationShaderChecks` + `runMaterialUniformCoverageChecks`：材质编译后按
  注入源码断言（因子只出现在顶点噪声公式一次、片元消费 varying）+ uniform 覆盖审计。
- `road-proximity-index-mismatch`（运行时，每次世界重建后一次）：道路距离索引与暴力
  点-线段距离在抽样点（每段中点 + 侧向 7/23/51m）上逐点比对，不一致写入面板 warnings。

## 迁移端新增的自适应（编辑器真实地形所需）

- **雾尺度自适应**（`config.resolveSurfaceViewDistanceScale` + props `surface.viewDistanceScale`）：
  官方雾尺度按 1000m 世界调参；编辑器地形可达数十公里，自动档与 lab DEM 对齐为
  `clamp(max(sizeX,sizeZ)/3000, 1, 16) × 1000`（≤3km 地形恒为 1×），
  环境运行时据此重推场景组 / 天空组（2 × 视距）/ 云层 / 天空平面距离。
- **植被避让道路 = 精确点-线段距离索引**（`roadProximity.ts`，lab `core/roadProfile.ts` 移植）：
  原实现把「避让公路」的判定交给覆盖整个地形 AABB、固定 1024 格的光栅距离场
  （`roadField.distanceAt` 取最近格）。40km 级地形格边长 ≈ 42m，远大于 8.5m 路宽与
  树木净空（半宽 + 路肩 + `forest.roadClearance` ≈ 10.8m）：路中心线上 >50% 的抽样点
  被误报「离路足够远」，树木 / 草丛因此长到沥青上（用户实测：顶视图可见灌木与草丛
  压在路面）。放置过滤（`planTreeChunk` / `planCameraGrassChunk` / `planRoadBucket` /
  远景林扫描）改走段哈希精确距离（32m 单元、查询上限 = `influence`，超限按上限返回，
  语义与光栅一致）；光栅贴图保留给地表着色器的道路混合与地形压平（纯视觉近似，
  40km 地形不可能与路面同精度），墙体 `surfaceHeightAt` 继续跟随光栅以与可见压平一致。
  顺带：per-instance `roadProx`（草丛调色板贴近道路的明暗）随之为精确值。回归测试：
  `roadProximity.test.ts` + `proceduralLandscape.test.ts` 的 40km「large-terrain
  regression」（含记录光栅场误报率的防回退断言）。
- **地表高度带归一化**（`config.resolveSurfaceHeightScale`）：官方地表公式按「水面以上
  0..300m」调参；起伏 ≤60m 时系数为 4（与 lab 相同），更大按 `min(4, 300/起伏)` 压缩并夹
  在 [0.25, 4]，避免 heather / light grass 高度项整片饱和。仅 `height` 项参与缩放。
- **天空/雾显示空间对齐**（编辑器专属，取代旧「反 Cineon 预补偿」）：
  - 根因①（色彩域）：场景 pass 渲染到 render target 时 three 关闭色调映射，Cineon + sRGB
    编码延后到 OutputPass；官方/lab 的雾混色发生在**显示空间**（`tonemapping → colorspace
    → fog`），只对齐 `blend = 0 / 1` 两个端点不够——天空平面 A/B 系数是 `2·sinθ`，仰角 > 30°
    即 > 1（外推），线性域再过 Cineon 把 R/G 压到 0（春·昼·晴天顶偏成异常深蓝、冬·昼·阴发黑）；
    中段（blend ≈ 0.5）也会偏亮（秋·晡·晴实测 +56/255）。
  - 根因②（雾密度）：lab 侧 three 的 `refreshFogUniforms` 会把**场景**密度覆盖进天空组，天空
    平面（2 × 场景 far）因此 `vFogDepth = 1 - exp(-20)` 在 fp32 饱和为 1；schema 侧原用天空
    尺度密度（0.9933）→ 顶点 `vHaze`（平面 ±5e4，插值到屏幕中部 ≈ 250）的巨值外推按
    `(1 - vFogDepth)` 泄漏，天空被压暗压蓝（用户实测：关云层后天空中部一块深蓝）。
  - 修复：`setSlowroadsFogDisplaySpaceMode(true)` 后片元体改为「基色 → 显示空间
    `sRGB(Cineon(x · exposure))`（水面等无 tonemapping 的材质只做 sRGB）→ 与官方逐字相同的
    混色公式（含 > 1 外推）→ 尾体 `srFogDisplayToTargetLinear()` 换回线性域」，uniform 与 lab
    一样下发 sRGB 显示分量；尾体排在追加片元体（云层/星空混合）之后；天空组密度取场景密度；
    天空平面几何按覆盖距离等比放大；SR 环境下 `scene.background` 用官方 `#c9dcee`。
  - 验证：32 组预设 × blend ∈ [0, 2] 的数值对照全部 ≤1/255（`slowroadsLabSync.test.ts`）；
    浏览器 A/B：春·白天·晴关云层后天空由异常深蓝变为与 lab 一致的浅→中蓝渐变。
- **自建物件保护**：地表注入跳过「自身或任一祖先带 artifact 标记」的网格（近树 3D、护栏、
  水面等不会被地表材质接管）。
- **水面世界空间**：水面平面挂场景根（世界水平）；宿主节点的旋转不会让它倾斜。

## 验收数据（本轮实测）

- **editor 视口（http://localhost:8088/#/editor，本地 dev server，春季·白天·晴）**：
  启动自检全绿：`environment checks passed (8)`、`fog-color checks passed (5)`、
  `fog-uniform checks passed (8)`（`sky vFogBlend=1.0000 scene vFogBlend=1.0000,
  skyFar=2000.0 sceneFar=1000.0`）、`season checks passed (9)`、
  `uniform checks passed`（材质审计 8 个：地表 / 道路带 / 草 / 灌木 / 近树卡 / 远景树 /
  护栏 / 近树 3D×2）、`tree-discolouration checks passed`；无 WebGL 着色器编译错误。
  面板统计：护栏 2754 段（32.8km 道路）、水面开、雾尺度倍率 7.54×（29km 地形自动）、
  近树 3D / 树卡 / 草实例随流式补齐；顶视截图可见道路带 + 两侧植被 + 护栏。
- **天空显示空间对齐（本轮实测，春季·白天·晴 / 云层关）**：编辑器视口顶视（blend = 0）为
  预设 `fogColorA #C3DBEE` 浅蓝；抬头至高仰角为与 lab 同款的浅→中蓝渐变（对照 lab 55°
  视角 `#3a80d8` 级），不再出现 `#0000BC` 级异常深蓝；冬·昼·阴不再整片发黑。数值对照：
  32 组预设 × `blend ∈ {0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2}` 全部 ≤1/255。
- **冬季回归**：切到冬季后视口采样洋红像素占比 0%（`r-g>25 且 b-g>25 且 min(r,b)>70`），
  与 lab 的第六批修复一致（不再发紫）。
- **植被避让道路（2026-10，真实场景离线复算）**：用用户场景的地形 pack GLB（39.2km ×
  42.6km、网格 1882×2048 / 格 20.83m）与面板实测参数（路宽 8.5、路肩 2.5、距路净空 2、
  走廊 20、7 路径点 → 追踪出 872m 道路 / 110 节点、光栅格边长 41.68m）分别跑旧过滤
  （1024 光栅场）与新过滤（精确索引）：
  分块树 34 棵落在沥青上 / 67 棵进入净空（最近 0.05m）→ 新过滤 0 / 0（最近 8.76m）；
  相机草 202 处落在沥青（最近 0.02m）→ 0（最近 4.58m）；
  走廊草/灌木 39 处落在沥青 → 0，且缘带数量回升（草 10210 → 14623、灌木 557 → 1610：
  旧光栅的假阴性曾把合格路缘点误杀成缺口）；远景林 1/3 → 0/0。
  编辑器视口顶视复查：沥青表面不再出现树木/灌木/草丛，仅保留 lab 同款的贴边草丛。
- **preview（ScenePreviewView）**：运行时自检全绿（`fog-color checks passed (5)` 走直出
  画布分支）、无着色器/JS 错误；**独立标签页**打开时场景同步未完成（`Syncing scene data...`，
  Renderer stats 显示 8 draw calls / 0 chunks），未复现景观内容——需从编辑器发起的实时
  Preview 会话复验（本轮未覆盖）。
- **SceneryViewer**：`scenery` type-check 通过（小程序真机不在本轮范围）。
- **静态检查**：`schema` type-check 通过；editor `vitest run` 全部通过（17 文件 / 99 用例，
  含新增 `slowroadsDisplaySpaceFog.test.ts` 6 例、`slowroadsLabSync.test.ts` 18 例与
  `surfaceInjectionCompile.test.ts` 4 例）；editor `vue-tsc` 仅余与本任务无关的预存在告警
  （CityGeneratorPanel / sceneSyncUploadQueue / ScenePreviewView 未使用变量、
  `surfaceInjectionCompile.test.ts` 的材质转型）。

## 已知残差与后续

## 第九批（树木连续 LOD、全图森林、DEM 路基压平，2026-10）

- `proceduralLandscape/treeLod.ts`：三端共用水平 XZ LOD 距离，近树 3D →
  近树卡 → 远景卡的 dither 区间互补；近树 3D 更新距离 4m，滑杆变化只更新
  uniform/实例集合。
- `proceduralLandscape/worldForest.ts`：世界锚定全图森林取代相机远景环；
  high/medium/low 分别使用 40m/64m/96m 格与 650k/450k/150k 上限；走廊树与
  全图树合并为同一远景变换集合。editor 实测 651k 棵、顶视约 100 FPS。
- `demRoadbed.ts` + `demTerrain.ts`：DEM 粗网格在生成前按路基设计面挖填，
  shader 仅裁切粗地形；高分辨率路基为双面季节材质，带 raw height/normal
  属性，外缘接回原始 DEM。编辑器当前场景审计粗地形遮挡 0/17680。

### 本轮修复（用户实测反馈：秋·早晨低机位整片变红；夜晚看不到星空）

- **haze 插值 far 反号 → 天空整片红**：`resolveHazeForCamera` 的官方公式在「正 hazeHeight +
  相机低于雾层基准面（cameraY < 0）」时 `e = (1 - cameraY/hazeHeight)² > 1`，
  `far = base.far·(1 - e·min(0.9, hazeIntensity))` 变成负数；片元 `max(0.001, fogFar - fogNear)`
  随即把 `vFogDepth` 压成 0，天空平面顶点 `vHaze`（±5e4 平面插值到屏幕中部 ≈ 数百）的巨值外推
  不再被 A/B 混色遮住 → 秋/春·早晨（hazeIntensity 最大 0.5）最先触发，整片纯红
  （像素探针实测 `255,0,0`，同步读到 `skyZone far = -91 / -250`）。现与负 hazeHeight 分支
  一致把 `e` 夹到 1（lab 的 `fogPatch.updateHazeForCamera` 同步修改），并新增
  `runSlowroadsHazeInterpolationChecks`（32 预设 × 场景/天空尺度 × 9 档机位高度断言
  `far > 0` 且 `far > near`）+ 单测回归（含"官方未夹紧公式在 camY<0 时 far<0"的反证）。
- **夜晚星空**：星空实现本身正常——只有「夜晚 + 晴」有星星（官方预设表；夜晚 + 阴按官方就是
  没有），且 `星空` 开关默认开启；官方 `STAR_SIZE = 0.01`（约 1 物理像素）。
  之前"看不到"的主因是上一条**雾密度泄漏**把夜空洗成偏亮的蓝、星点被淹没；密度对齐后夜空
  回到官方深色（探针 `0,0,66~71`），星点恢复可见（四季夜晚均可复现，与 lab 观感一致；
  编辑器经 FXAA，星点比直出的 lab 略柔，属既有抗锯齿残差）。
- **星点尺寸改为按视口高度换算（用户实测反馈：星空看不清/太小）**：官方 `size = 0.01` 是
  **世界尺寸**，three 按 `gl_PointSize = size · pixelRatio · (drawingBufferHeight / 2) / depth`
  换算 —— 4K 上约 1 物理像素，但 dpr=1、高度 800 上下的编辑器视口只有 ~0.4 物理像素，再经
  FXAA 被抹平。现改为 `stars.resolveStarSize(viewportHeightPx, pixelRatio, targetPixels)`：
  - 目标屏幕直径默认 **1.0** 物理像素（= 官方注释里"约 1 物理像素"的原始意图；
    preview / viewer / lab 走这一档）；
  - 编辑器视口开 FXAA 时用 **1.6** 物理像素补偿（`starSizeTargetPixels`，性能模式关 FXAA 时
    自动回落到 1.0），运行期由 `slowroadsEnvironment.setStarSizeTargetPixels()` 跟随开关更新；
    （调参迭代：0.4 看不清 → 3.2 太大 → 2.2 仍偏大 → 1.6，用户实测口径）
  - 同时把点精灵按 `gl_PointCoord` **裁成圆点**（`if (length(gl_PointCoord - 0.5) > 0.5) discard;`）：
    官方方形点在 size<1px 时看不出来，放大到 1~2 物理像素后方形边角会显脏（用户实测
    "太大、非常不自然"），schema 与 lab 同步；
  - lab `main.ts` 同步调用同一换算函数，两侧观感一致；单测断言各视口/dpr 下解出的屏幕直径、
    自定义目标值、退化视口夹紧、圆点裁切注入与 `setSize` 生效。

### 本轮修复（用户实测反馈：天空颜色与 lab 差别很大、关云层后天空中部一块深蓝）

详见上文「迁移端新增的自适应 → 天空/雾显示空间对齐」。要点：

- **色彩域**：旧「反 Cineon 预补偿」只对齐端点，中段偏亮、`blend > 1` 外推段塌成异常深蓝
  （且 three r186 的 Cineon 还带 `pow(·, 2.2)`，旧模型连端点也未真正还原），现改为显示空间
  等价注入 + 尾体反变换，混色与官方/lab 逐字相同。
- **雾密度**：天空组密度改为场景密度，天空 `vFogDepth` 饱和为 1，顶点 `vHaze` 巨值不再泄漏。
- **覆盖角**：天空平面几何随天空尺度等比放大（87.7° 覆盖角不缩水），SR 环境激活时
  `scene.background` 用官方 `#c9dcee`（不再是编辑器默认 `0x516175`）。
- **残差**：显示空间等价把混色搬到 `sRGB∘Cineon` 的逆变换上，比官方多一次往返；半浮点
  render target 的往返误差 ≤1/255（自检已断言），FXAA / OutlinePass 仍在线性域工作。

### 本轮修复（用户实测反馈：近景 OBJ 树木发白/纹理糊）

- **近树 3D 网格 radiance 取半**：官方树类材质 `oe.radiance = lights.radiance / 2`
  （lab 记在 `material.userData.radianceScale`，环境控制器下发 `radiance × scale`）。
  迁移端 `treeMeshes.setLighting` 曾用全量 radiance，叶辉光公式
  `vec3(color.rg × 8, 0.5) × radiance` 被放大一倍 → 阔叶烤成白黄、贴图细节被冲掉
  （用户报告「近景 obj 模型树木纹理乱了」）。现改为 `state.radiance * 0.5`，与 lab 一致。
- **近树卡/远景树切分层级距离同步**：`foliageUniforms.nearDistance` 此前从未下发（恒为
  默认值），面板改「近树卡距离」时着色器的 near/far 分层不跟随。现在
  `applyDynamicSurfaceUniforms` 按 `forest.nearDistance ?? 档位默认` 下发，与分块
  构建时的 near/far 划分保持同源。
- **自建物件的材质保护（用户实测反馈：近树"被地形贴图渲染"）**：地表注入收集宿主网格时
  只检查网格**自身**的 artifact 标记，而近树 3D 网格只标了容器
  （`treeMeshManager.container`）→ 世界重建时这些 InstancedMesh 被当成 GLB 地形网格，
  材质被替换成注入后的季节地表材质（表现为树被地形纹理渲染）。现改为
  `isProceduralLandscapeArtifact()`：网格自身**或任一祖先**带标记即跳过
  （`collectProceduralLandscapeSurfaceMeshes()` 导出，便于单测回归）；植被批次 /
  护栏 / 道路带等自身带标记的对象行为不变。
- **双面叶卡不做背面法线翻转（用户实测反馈：朝向相机的植被总有黑色区域）**：
  three 对 `DoubleSide` 材质默认把背面 `normal` 取反（`faceDirection`），十字叶卡的
  背面因此 `dot(N, sun) < 0` → direct = 0（自发光又被 `direct × (1 + emissive)`
  吃掉）→ 从任何角度看都有一片朝相机的黑面。lab 的植被着色器直接
  `ndl = dot(groundNormal, uSunDir)`，两面同光。修复：
  - `instancing`：替换 `#include <normal_fragment_begin>`，着色法线统一取
    `normalize(mat3(viewMatrix) * vPlGroundNormal)`（树卡/护栏为 (0,1,0)），与 lab 同款；
  - `treeMeshes`（近树 3D 叶卡）：替换为 `vec3 normal = normalize(vNormal);`（同样不翻转）。
- **天空/云层几何受相机远裁剪面约束（用户实测反馈：场景边缘一圈灰色）**：
  雾尺度自适应把天空平面推到 `2000 × 倍率`（29km 地形自动档 = 15080m），而编辑器
  视口相机 `far` 远小于它（默认 5000，实际随取景变化）→ 天空平面与云平面被整体裁掉，
  地平线处只剩渲染器背景色（灰带）。修复：
  - `environmentRuntime`：天空平面距离取 `min(官方 n1, cameraFar × 0.95)`；同时下发
    `skyDepthCorrection = 官方距离 / 实际距离`，并把相机 `far` 交给云层；
  - `fogInjection`：新增天空专用顶点雾体 `FOG_VERTEX_SKY`——把顶点按
    `skyDepthCorrection` 换算回官方距离处的等效位置，`vFogDepth`/`vHaze`/haze 层插值
    与官方逐项一致；A/B 混色只依赖视线仰角（`2·sinθ`，与平面距离无关）因此不受影响；
    未裁剪时 correction = 1（与 lab 逐字一致）；
    ⚠️ 该 uniform 的 GLSL 名必须与 `slowroadsSkyFogUniforms` 的键完全一致
    （曾用 `uSkyDepthCorrection` 前缀导致 three 按名匹配不到、整块天空退化为纯白平面）；
  - `clouds`：新增 `setCameraFar()`，云穹尺寸夹到 `far × 1.9`，避免远缘被裁出硬边
    （云纹理按世界坐标平铺，与平面尺寸无关）；
  - 自检新增「天空平面挂在解析后的距离」「深度换算还原官方 n1 距离」两条（占位 6 项）。
  - 覆盖角（本轮补）：几何尺寸不再固定 ±5e4/±5e5，而是按 `官方 n1 / 2000` 等比放大
    （`sky.resolveSkyPlaneScale`），保证任何视距倍率下都维持官方 87.7° 覆盖角；否则
    大倍率场景只能覆盖到更小的视场角，晴朗无云时天顶会露出背景色。自检新增
    「天空平面几何保持官方覆盖角」一条；SR 环境激活时背景色改用官方 `#c9dcee`
    （`environmentRuntime` 接管并在 dispose 还原），残余的 2.3° 天顶锥角因此与 lab 同色。

- **编辑视口远裁剪面跟随场景雾距（用户实测反馈：编辑器看不到远山）**：
  编辑视口的 `far` 原本只按本地取景半径计算，默认约 1.7km；42.7km DEM 的雾远端
  约 14.2km，远山因此被直接裁掉（Preview 页已有同样的修复，编辑视口缺失）。
  现在 `SceneViewport` 保留本地取景的 `far` 作为下限，并在每帧把
  `max(本地 far, fogFar × 1.25)` 写回相机；雾区内的地形先于裁切收满，天空/云层
  继续按新的 `camera.far` 重算。

- **编辑器地形与 lab 世界不同**：形状/高程差异导致取景不同；雾距按地形放大（自动档）后，
  植被流式半径（质量档 `viewDistance`，high = 1200m）之外仅剩地表与远景树的分块边界；
  更远距离的森林观感取决于流式预算。
- **preview 实时会话**：见上；需要从编辑器「Preview」入口建立会话后复验渲染。
- **小程序真机**：SceneryViewer 与 `viewer` / `tour` 共用同一 schema 实现（uni_modules junction），
  真机表现需按小程序验证流程单独取证。
- lab 侧同样未实现的项保持一致：近树卡圆锥假暗化、imposter `S0` 假暗化、农田割纹、
  BridgeWall（与桥系统一起）；夜间车灯项恒 0。
- 编辑器视口 `EffectComposer` 的 FXAA/OutlinePass 与 lab 直出存在抗锯齿差异（逐像素对比
  需关闭 FXAA）。

## 第十批（主森林树种空间分布与相对林线，2026-10）

- **官方主森林不是 75/25 随机**：`getTreesAt()` 先由 `treeMap` 得到 0..3 棵/10m 格，
  再通过 `getTypeAt()` 读取 `typeMap`（`tileSize=3000`、`resolution=11`、`depth=4`、
  `upscale=2`、`scale=1`、`offset=.45`）并按 0.5 取整。等价于约 `3000/11≈273m`
  的阔叶/针叶成片区域。`getTreeType()` 的 25% 随机只用于墙体/农田额外补种。
- **树密度海拔带**：官方 `getTreeDensity()` 在 150m 以下给 0.5..1、150–300m 线性
  衰减、300m 以上为 0。编辑器 DEM 海拔可能整体在 3–5km，不能直接套绝对海拔；
  `treeSpecies.ts` 将最低点映射到 0m、中点映射到 150m、最高点映射到 300m，保留
  官方“低于一半密、向最高点线性消失”的形状。
- **迁移实现**：`buildTreeSpeciesField()` 在每次地形构建时烘焙 512 级确定性 fbm
  树种场（基础特征 273m、4 层倍频、阈值 0.5）；全图森林、道路走廊、分块与远景环
  统一使用同一世界 XZ 采样，近景 3D / 近树卡 / 远景 imposter 对同一棵树给同一物种。
- **地表同步**：`uPlTreeLineMidY/uPlTreeLineTopY` 让树冠阴影与林线一起淡出，避免
  高林线以上“地表仍是林下、空中没有树”。
- **验收**：当前场景 DEM 3565.8–5508.8m 对应林线中点 4537.3m、顶部 5508.8m；
  `ProceduralLandscapeRuntimeStats` 新增阔叶/针叶实例数与针叶占比，诊断日志可直接
  核对近远 LOD 是否一致。
