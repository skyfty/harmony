# Viewer 小程序真机地形诊断清单

对应场景包：`D:\Downloads\New Project (1).zip`  
诊断副本：

- `D:\Downloads\diag-low-full.zip`：只把 `quality` 改为 `low`。
- `D:\Downloads\diag-tex-only.zip`：低质量，关闭森林/草/灌木/道路/水面/墙体，关闭近树 3D，隐藏角色，只保留地形和地表纹理。
- `D:\Downloads\diag-minimal.zip`：在 `diag-tex-only` 基础上关闭 `surface.textures`，用于测非景观层基线。
- `D:\Downloads\diag-medium-density-05.zip`：质量 `medium`、`forest.density=0.5`，保留全部图层和近树半径 90，用于验证近树 3D 与降低森林密度后的性能。
- `D:\Downloads\diag-medium-density-022.zip`：质量 `medium`、`forest.density=0.22`，目标是把全图森林拉回约 9–10 万，同时保留近树 3D。
- `D:\Downloads\diag-low-density-06.zip`：质量 `low`、`forest.density=0.6`，保留全部图层和近树 3D，用于降低森林过密并提升效率。
- `D:\Downloads\diag-low-coverage-06.zip`：质量 `low`、`forest.coverage=0.6`、`forest.density=0.6`，用于真正降低全图森林覆盖并保留近树 3D。

原包和原场景不变。

注意：`diag-minimal` 仍然会加载整季 37 张纹理，因为季节素材加载不受 `surface.textures` 控制；它只用于测渲染/实例开销，不代表“最小网络请求”场景。

## 已确认的包内容

- DEM：`1422 × 1308`、30m，约 `42.6 × 39.2km`。
- `dem-grid.bin`：`https://v.touchmagic.cn/uploads/terrain-packs/terrain-B_rWlXZn4zpuGru_/runtime/dem-grid.bin`，4,402,595 字节。
- 景观组件：`quality: auto`，viewer 当前解析为 `high`；森林/草/灌木/道路/水面/墙体全部开启。
- spring 季 + 共享贴图共 37 张，压缩总量约 33.7MB。
- 其中 3 张远景树图集为 `4096 × 1024`：
  - `spring_imposters_0_d.2e67db77`
  - `spring_imposters_0_n.1d5afe54`
  - `spring_imposters_1_d.05133c03`

## 代码层已确认的风险点

- `schema/proceduralLandscape/config.ts`：viewer 的 `auto` 固定为 `high`；high 档全图森林预算 130 万。
- `schema/proceduralLandscape/runtime.ts`：景观运行时通过无参数的 `getSharedSlowroadsAssetStore()` 创建共享素材库。
- `schema/slowroads/assets/assetStore.ts`：共享素材库首次创建时默认 `maxTextureSize: 8192`；viewer 稍后才把真实 `maxTextureSize` 传进来，所以可能一直使用 full 档。
- `schema/slowroads/assets/assetStore.ts`：`configureSlowroadsTextureSourceResolver` 目前没有调用点；小程序端会走 `URL.createObjectURL` 的 polyfill，再转成 base64 data URL，而 H5 使用真实 object URL。
- `schema/slowroads/assets/assetStore.ts`：`textureSet()` 使用 `Promise.all`；任意一张纹理一直不 resolve，整季素材都不会 `applySeasonToMaterials()`。

## 本次已完成的兼容修复

- 移除了 `schema/slowroads/assets/assetStore.ts` 里模块初始化阶段的 `new URL(...)`。
- 改为纯字符串拼接的 `resolveAssetUrl()`，同时覆盖 `configureSlowroadsAssetBaseUrl()` 和 `fileUrl()`。
- 原因：微信小程序子包可能在 three-platform adapter 安装 URL polyfill 之前就执行该模块，`new URL(...)` 会让整个 scenery 子包加载失败。
- `pnpm --dir schema type-check` 已通过，viewer 已重新构建到 `viewer/dist/build/mp-weixin`。
- 构建后校验通过；scenery 子包当前为 3.34MB，构建脚本提示超过 2MB 上传限制，真机预览/上传方式需要确认是否允许该体积。

## 诊断日志

旧的 `[PL-DIAG*]` 周期探针已移除。当前只保留按阶段输出的一次性日志：

- `[SceneryLandscape] core textures ready ...`：地表核心纹理完成，场景已可进入。
- `[SceneryLandscape] season textures complete ...`：可选植被/道路/墙体/水面图集补齐。
- `[SceneryLandscape] core texture preload timed out ...`：核心图集超过入场预算，继续在后台加载。
- `[SceneryLandscape] ... checks failed` / `treebin parse failed`：只在实际失败时输出。

## 首轮真机日志结论

设备：Android 12 / LIO-AN00m / 7468MB / benchmark 26；`maxTextureSize=16383`、`maxTextures=16`、`maxAnisotropy=16`、WebGL2。

- 38 张纹理全部加载成功，`seasonAssetsReady=true`，下载完成后 `pendingDownloads=0`，说明纹理管线本身没有失败。
- 素材库使用 `full` 档，常驻约 `214MB`；所有树木/地表贴图的 `aniso=1`，而设备支持 16。共享素材库在拿到 renderer 能力之前就按默认 `maxAnisotropy:1` 初始化，导致树木贴图在斜视角下发糊。
- `diag-low-full` 在 10–30 秒进入 memory guard `critical/extreme`，renderer pixelRatio 从 2 降到 1，树木/地表进一步变糊；FPS 从首段 22.9 回升到 20 秒的 51.6，随后约 42–48。
- 全图森林约 97,069 棵，但 `nearTreeInstances=0`、`treeInstances=0`，当前可见树主要是远景树卡；`nearDistance=190`、`nearTreeRadius=90` 没有产生近树 3D 实例，可能是相机位于无近树区域，也可能是近树 3D 模型未就绪，需要新日志中的 `nearCardInstances / nearTreeReady / camera` 判断。
- `diag-tex-only` 仍然有 97,069 棵全图森林：DEM 密度场此前没有应用 `forest.coverage`，`forest.density` 也没有参与 world forest 预算，所以它不是真正“无森林”对照。
- 两个场景都出现 `DEM 地形碰撞等待超时（30s）`。物理桥接在渲染循环启动前等待 DEM 碰撞网格，但 DEM 构建只在组件 update 中推进，形成等待空转；这会显著拖慢首屏。

已针对上述确定性问题修改：

- 共享素材库新增 `configure()`，在场景构建前按 renderer 能力更新并重新应用 anisotropy；真机应看到 `aniso` 变为 8，而不是 1。
- DEM 密度场应用 `forest.coverage`，world forest 预算乘以 `forest.density`；`coverage=0` 时全图森林应降为 0。
- 物理桥接等待期间只推进 `proceduralLandscape` 组件的 update，让 DEM 网格能在 30 秒超时前完成。
- 当轮新增的周期探针现已移除；后续只保留纹理阶段完成和真实失败日志。

下一轮请重新构建真机包，重点看：

- 树木图集的实际 `aniso` 是否与设备能力匹配；
- 内存保护是否仍在启动阶段进入 critical；
- 近树层是否已经建立；
- 相机是否位于森林空洞，导致近树为 0；
- 初始化是否还出现 30 秒碰撞等待。

## 纹理内存优化（保留全部图层）

微信小程序现在使用 `preferredVariant: '2048'`：

- 现有 `@2048` 文件只覆盖远景 imposter 图集，因此远景树卡从 `4096×1024` 降到 `2048×512`；
- 近树图集（`2048×512`）和 1024 地表贴图保持原尺寸；
- editor/H5 仍使用 full 档。

加载集合还会按实际内容裁剪：

- 7m 宽路只加载 wide 路面和划线贴图，不再加载 `road_single_base/overlay`；
- 墙体纹理只在 `wallSegmentCount > 0` 时补载；
- `sea_waves` 只在水线实际可见时补载；
- `forest.coverage=0` 或 `density=0` 时跳过树/远景图集；
- 草、灌木关闭时跳过对应图集。

预期常驻：完整场景从约 214MB 降到约 129–135MB；`diag-tex-only` 由于森林关闭，预计降到约 50–60MB。

### 第二轮真机结果

- `diag-tex-only`：12 张纹理、40.2MB、`variant=2048`、`aniso=8`、无 memory guard，FPS 稳定在 56.8–61.6；DEM 构建 1.0s，30 秒碰撞等待消失。
- `diag-low-full`：31 张纹理、128.97MB、`variant=2048`、远景 imposter 为 2048×512、`aniso=8`、memory guard 正常，pixelRatio 保持 2。
- 纹理优化达到目标；单车道、墙体和不可见水面纹理均未加载。
- `diag-low-full` 在 2× 渲染下 FPS 仅约 16–27，且有随时间下降趋势；draw calls 31–36、三角形约 47.5 万、全图森林 97,069 棵，近树 3D 仍为 0、近树卡仅 9–13。当前瓶颈已从纹理内存转为远景森林的填充率/绘制负载。
- 因此微信端“存在森林”的场景现在额外限制为 pixelRatio 1.5；无森林的 `diag-tex-only` 仍保持 2。

### 第三轮：low 档启用近树 3D

- low 档现在使用最多 60m 的近树 3D 半径，而不是完全关闭。相机进入树林后日志出现 `nearTreeReady=true`、`nearTreeInstances=3–4`，近树 `.treebin` 模型正常显示。
- `nearTreeInstances` 在稀疏区域为 0 是正常的，取决于相机 60m 内是否有树；`nearCardInstances` 仍覆盖更远的近树卡。
- 本轮 low + 近树 3D 在 pixelRatio 1 下 FPS 约 36–52，全图森林仍为 97,069；memory guard 在启动阶段仍会进入 critical 并压到 1×。
- 道路实际没有生成（`roadLength=0`），此前 8 张宽路贴图仍常驻。现已改为道路产生有效路径后才加载，预计纹理常驻从 128.97MB 降到约 86MB，给内存保护留出余量。

### 第四轮：推荐的平衡设置

`coverage=0.6`、`density=0.6`、`quality=low`：

- 全图森林 33,817（此前 97,069），构建 1.49s；
- 23 张纹理、86.09MB；道路/墙体/水面按需加载生效；
- memory guard 正常，pixelRatio 1.5，FPS 稳定约 55–61；
- 近树 3D 管理器 `nearTreeReady=true`，当前相机 60m 内无树，因此 `nearTreeInstances=0`；`nearCardInstances` 21–29，说明中距离植被仍在；
- 近树 3D 会在相机进入 60m 内有树的区域时出现。

这组参数适合作为当前场景的默认平衡档：森林明显疏朗、内存压力消失、FPS 有余量。

### 第五轮：自适应森林参数

`quality="auto"` 的 viewer 与 preview 都使用 `high` 画质；自动森林目标继续按设备与场景面积选择：

- LIO-AN00m（benchmark 26、7.5GB）判为 mid；42.6×39.2km 场景目标 coverage/density 约 0.70；
- 设备档基础值：low 0.55、mid 0.75、high 0.90；大于 500km² 减 0.05，大于 2000km² 减 0.10，小于 50km² 加 0.05；
- 目标 FPS 40；世界森林构建和素材完成后等待 5 秒，再测 5 秒平均 FPS；
- FPS <35 或 memory guard critical：目标降低 0.06；FPS >48 且树量低于目标 90%：目标提高 0.06；
- 每个场景最多重建一次；显式 `low/medium/high` 仍为手动覆盖，不运行自适应；
- editor 视口不自动调整，保持作者质量。
- viewer 的自动档位与编辑器对齐为 `high`，FPS/内存校准只调整覆盖率和密度，不再把画质档压回 `low`；显式 `low` 仍完全保持低档策略。

### 第六轮：近路树带与草灌图集修正

- 灌木测量按图集上下两行分别聚类，只保留底部落地行；夏季图集上方的倒挂枝不再和下方便灌木合并成一张 UV。
- 常规草层排除 3 号棕色草球，只使用 0–2 号草格。
- 近树 `.treebin` 解析时以模型最低 Y 为地面零点归一化，修复模型下沉/埋入地形的问题。
- 世界森林走廊最内侧 3 条横向带使用 3m 沿路采样和更高落树概率，仍遵守道路净空、坡度、水线、树线和道路可达性约束。
- 近路补树改为按固定道路节点一次性生成并建立空间索引，不再跟随相机位置或朝向移动；近树卡原地复用实例缓冲，行驶时不会整批销毁重建。
- 近路补树会并入完整世界森林索引，因此同时参与近树卡与远景树卡的连续 LOD；道路草灌走廊扩展到近树距离，不再在 80m 后留下裸带。
- 针叶近树 alpha 裁切按 H5 mipmap 覆盖率降到 0.2；`.4` 会让近处细枝森林几乎整体被裁掉。

验证包：`D:\Downloads\diag-auto.zip`（`quality=auto`）。日志中的 `adaptive` 字段会显示 `deviceTier / sceneAreaKm2 / targetCoverage / effectiveCoverage / targetTreeCount / measuredFps / calibrationState / calibrationAttempts`。

## 真机观察记录

进入场景后点击 FPS 文本切换到 `full`，分别记录：

| 时间 | FPS | ms | calls | tris | textures | programs | tex MB | geo MB | cache MB | 植被可见 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10s |  |  |  |  |  |  |  |  |  |  |
| 60s |  |  |  |  |  |  |  |  |  |  |
| 180s |  |  |  |  |  |  |  |  |  |  |

判断“是否还在加载”：如果 `tris` 持续上涨，世界仍在生成；如果 `tris` 和 `tex` 已稳定但画面仍空，才是加载完成但未生效。

## Network 记录

在“真机调试”的 Network 面板筛选 `slowroads`、`asset-bundle.json`、`.png`、`dem-grid`、`.glb`。

| 项目 | 预期 | 实测 |
| --- | --- | --- |
| `asset-bundle.json` | 200，约 56KB |  |
| slowroads PNG 数量 | 37 |  |
| slowroads PNG 总字节 | 约 33.7MB |  |
| `dem-grid.bin` | 200，4,402,595 字节 |  |
| 失败请求 | 无 |  |
| 控制台 shader/context 错误 | 无 |  |

## 探针 1：WebGL 能力

在真机调试控制台执行：

```js
wx.createSelectorQuery().selectAll('canvas').fields({ node: true, size: true }).exec((list) => {
  list.forEach((item, index) => {
    if (!item.node) return
    const gl = item.node.getContext('webgl') || item.node.getContext('webgl2')
    if (!gl) return
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    console.log(index, {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    })
  })
})
```

记录：

- `MAX_TEXTURE_SIZE`：
- `MAX_TEXTURE_IMAGE_UNITS`：
- GPU：
- `wx.getSystemInfoSync().benchmarkLevel`：

如果 `MAX_TEXTURE_SIZE < 4096` 且 `textures≈0`，优先怀疑全尺寸远景树图集。

## 探针 2：本地路径 vs base64

```js
const url = 'https://v.touchmagic.cn/uploads/slowroads/grass.15f2422c.png'
wx.downloadFile({
  url,
  success(res) {
    console.log('download', res.statusCode, res.tempFilePath)

    const local = wx.createImage()
    local.onload = () => console.log('local ok', local.width, local.height)
    local.onerror = (e) => console.log('local error', e)
    local.src = res.tempFilePath

    wx.getFileSystemManager().readFile({
      filePath: res.tempFilePath,
      encoding: 'base64',
      success(r) {
        const data = wx.createImage()
        data.onload = () => console.log('data ok', data.width, data.height)
        data.onerror = (e) => console.log('data error', e)
        data.src = 'data:image/png;base64,' + r.data
      },
      fail: (e) => console.log('read fail', e),
    })
  },
  fail: (e) => console.log('download fail', e),
})
```

记录：

- 下载状态：
- 本地临时路径：成功 / 失败 / 无回调
- base64 data URL：成功 / 失败 / 无回调

如果本地路径成功而 base64 失败，说明小程序的 Blob → data URL 路径是根因。

## 诊断副本运行结果

每次清缓存，等待 2–3 分钟。

`diag-low-full` 仍会下载整季纹理；如果纹理仍缺失，不代表降档无效，需要结合 `textures`、`tex MB` 和 Network 判断。

| 场景 | FPS | tris | textures | tex MB | 地形纹理 | 树/草 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 原包 |  |  |  |  |  |  |  |
| `diag-low-full` |  |  |  |  |  |  |  |
| `diag-tex-only` |  |  |  |  |  |  |  |
| `diag-minimal` |  |  |  |  |  |  |  |

## 判定

| 观察 | 结论 |
| --- | --- |
| 37 个 PNG 全部 200，`textures≈0`，本地路径成功、base64 失败 | 小程序纹理解码路径 |
| `MAX_TEXTURE_SIZE < 4096`，4096 图集失败 | 全尺寸纹理档超出设备上限 |
| PNG 全部 200，单图正常但并发挂起 | 37 张并发加载/内存峰值 |
| `textures>0`，`tris` 高但无植被 | 图集、alphaTest 或着色器 |
| 纹理/植被可见但 FPS 低 | high 档森林预算 |
| `diag-minimal` 仍低 | 非景观层瓶颈 |

## 第七轮：远景树绿框与路基纯白（2026-10-20）

两个问题是独立回归：

- **远景树绿框**：微信端优先加载 `@2048` 变体。旧的降采样产物丢失了 PNG
  透明通道，透明树卡背景变成实色绿色矩形。原图 4096×1024 带 alpha，旧
  变体为无 `tRNS` 的 8 位索引图；重新生成后 14 张变体均为 32 位 RGBA。
- **路基纯白**：`quality: auto` 在实机触发森林自适应校准后会直接重建世界。
  旧路径新建的 DEM 路基使用默认白色 Lambert 材质，但没有重新执行季节地表
  注入。现在 `buildWorld()` 完成时统一注入，DEM 高分辨率网格生成后再补一次。

资源流水线现在会检查源 PNG 的 alpha/`tRNS`，若 2048 变体丢失透明信息会直接
失败。资产 URL 也会附加 manifest 内容哈希，避免 CDN 继续命中旧图集。

本次修复的 14 张变体、`catalog.json` 与 `asset-bundle.json` 已打包到
`tools/slowroads-lab/slowroads-imposter-2048-alpha-fix.zip`。上传时应将其中
同名文件放到服务端 `uploads/slowroads/`，并同步替换 manifest 后刷新 CDN。

旧的高频 `[PL-DIAG-SURFACE]` 日志已移除。需要继续排查世界重建时，优先查看
`[SceneryLandscape]` 阶段日志和场景面板里保留的 warnings。

## 第八轮：预载超时与“先差后好”（2026-10-20）

截图里的“景观纹理预载超时”不是下载最终失败，而是 30 秒入场预算到期；原任务
没有被取消，仍会在后台继续。随后地形初始化又使用独立的 30 秒预算，并等待
`seasonAssetsReady && !seasonLoadInFlight`，所以整季 37 张图集（压缩约 33.7MB）
未完成时会再报一次 `textures-loading` 超时。

画面“先差后好”的直接原因是 `applySeasonToMaterials()` 只在整季 `textureSet()`
完成后执行。加载期间地表和植被仍使用无贴图/占位材质，完成后才一次性上材质。

现在改为：

- 入场预载只等待 11 张地表核心纹理（约 3.6MB），不再等待植被、道路、墙体和
  水面图集；
- 季节纹理逐张到达即绑定，核心批次完成后即可进入场景并显示正确地表；
- 其余图集在后台继续加载，补齐后再次提交；
- `seasonAssetsReady` 表示“首屏所需核心素材已就绪”，不再包含可选图集；
- 微信端优先把 `uni.downloadFile` 的临时路径直接交给图片解码，失败才回退到
  ArrayBuffer/Blob 路径，避免整张 PNG 多次复制和 base64 化。

真机验收时只看两条新日志：`core textures ready` 应在入场前出现，
`season textures complete` 可以晚于入场出现。
