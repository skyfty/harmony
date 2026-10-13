# Slow Roads Lab

slowroads.io 风格的程序化地形 / 道路 / 精灵植被验证工程：按官方线上包体反编译出的逻辑，
接入四季素材与 8 个 OBJ 近树模型，先把视觉效果与数据流调对，再迁移到 editor 的
`proceduralLandscape` 组件（preview / SceneryViewer / 微信小程序）。

## 启动

```bash
# 1. 素材流水线（首次或素材更新后；仓库不存大图）
pnpm --dir tools assets:slowroads-lab          # 从 D:\Downloads\新建文件夹 生成 assets-src/ + 资产包
pnpm --dir tools regions:slowroads-lab         # 实测四季精灵区域 -> src/core/spriteRegionsData.ts

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
- `scripts/serve-asset-bundle.mjs`：本地静态服务，模拟服务器按需下载（fetch→blob→纹理）。

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

调色板（shader uniform）：春 #4F9140/#94AC53、夏 #699159/#AFAD64、秋 #4A7D4D/#BEAF79、
冬 #FFFFFF/#DBDDE1（grassColA/B）；peakColA/B、fieldDiscolouration、roadCol 见
`src/core/seasonParams.ts`。冬季另有 hasSnow（阔叶树积雪）与 frozenWater（水面冻结）。
lab 世界的海拔只有 ±40m，地表着色把「水面以上高度」按 ×4 折算回官方 0..300m 尺度。

## 性能与小程序约束（实测）

- 世界 1600m/1024 段，春季默认视角：draw calls 10–18，三角形 ~2.4M，FPS 100（本机）；
  世界生成 ~0.6s，季节切换（缓存命中）40–400ms，均为材质/图集更新，不重建地形。
- 常驻纹理：完整模式 ~123MB 解码显存，兼容模式（@2048）~75MB；单季压缩下载量
  19–29MB（季节切换按需加载，LRU 保留当前季 + 共享集）。
- 兼容模式 = 纹理按 `MAX_TEXTURE_SIZE` 回退 `@2048` 变体 + 地形材质缩减到 9 个采样器，
  用于对齐微信小程序（主包 ≤2MB、分包 ≤4MB、纹理单元/显存受限）的降级路径；
  下载链路在「服务器下载」模式下以 fetch→blob→纹理复现（小程序侧为
  `wx.request` + assetDownload worker，协议一致）。

## 控制

- 季节：春/夏/秋/冬四按钮（首次切换加载该季素材，带进度遮罩）。
- 自由相机：拖拽旋转、WASD 移动、Q/E 升降、Shift 加速；「巡航」沿路行驶（14 m/s）。
- 图层：地表混合/贴图、道路（贴图带+地形路面带）、树冠色斑、草、灌木花草、
  树卡/远景树、近树 3D 网格、水面、护栏、风摆；滑杆覆盖树/草/灌木/高草/花草密度、
  道路宽与压平带、近树卡距离、近树 3D 半径、风强度等。
- 左下角统计：FPS/draw calls/三角形、各层实例数、道路长度与生成耗时、切季耗时、
  纹理常驻估算与当季下载量（服务器模式另计已下载总量）。

## 自检与验收

- 启动时运行纯函数自检（噪声/道路确定性、放置过滤、护栏间距）+ 季节目录校验
  （四季贴图槽位齐全、区域表格位语义、调色板与特效参数、模型文件齐备）。
- 验收截图（同种子同机位）：春（绿野+路缘苔痕/花丛）、夏（深绿、路面无 overlay）、
  秋（黄褐+落叶 overlay）、冬（雪地/雪路/积雪树/冻水）；另含 3D 近树分级过渡与
  兼容模式对照。截图与日志在会话记录中，服务器模式与本地模式画面一致。

## 已知差异与后续

- 未接入：宽路 `road_base`+划线 paint 体系、农田割纹（field）、时间/天气/云、
  Driftmas 专用冬季针叶贴图；`snow_spray.png` 已入库备用（车轮雪雾）。
- 冬季木护栏未在素材内，四季沿用春季 `spring_wall_barrier_wood`（单文件随仓库提交，
  materialize 会把它作为 supplement 复制进 `assets-src/`）。
- editor/preview/SceneryViewer 的正式接入与小程序真机验证为下一步；本工程交付
  lab 验证 + 资产包（`assets-src/asset-bundle.json`）+ 上述映射文档。
