# 3D Tiles Environment Viewer

固定经纬度观察点的 3D Tiles 环境贴图查看与导出工具。

## 启动

在 `tools` 目录执行：

```bash
pnpm dev:3dtiles-viewer
```

复制 `.env.example` 为 `.env.local`，按数据源填写：

- `VITE_TILES_URL`：通用 `tileset.json` 地址；
- `VITE_CESIUM_ION_TOKEN` + `VITE_CESIUM_ION_ASSET_ID`：Cesium Ion 资产。

应用不会内置 Token。坐标也可以通过 URL 参数复现，例如：

`?lon=139.80&lat=35.6812&ground=40&height=2`

经纬度使用单个输入框，支持十进制度和度分秒格式，例如：

`29°38'38.24"N 91°06'57.03"E`

也可以直接输入十进制度：`29.643956, 91.115842`。点击“定位并加载”后立即使用输入值。

`ground` 是地面海拔，`height` 是相对地面的观察高度；相机实际海拔为两者之和。拖动预览区域只会旋转相机，观察点位置保持不变。导出功能会从六个方向离屏渲染并拼接为等距柱状图 PNG 或 EXR。

## GLB 地形导出

点击「添加当前相机为锚点」后，工具会把当前视野内可见的最高精度瓦片捕获到右侧 GLB 预览。导出前可调整选项：

- **焊接顶点**：把相邻瓦片边界上重合的顶点焊接（默认 ε=0.05m、位置量化 0.01m），并做跨材质边界的面积加权平滑法线，消除瓦片间接缝、裂缝与硬边。
- **去裙边**：剥离量化网格地形常见的近垂直细长裙边三角形（判据：法线近水平且高宽比 > 8，真实悬崖面不受影响）。
- **贴图上限 / 质量**：外置贴图按 2 的幂缩放到指定最大边（默认 2048）并以 JPEG（透明贴图用 PNG）重编码。

两种导出方式：

1. **导出完整 GLB**：贴图内嵌在单个 GLB 里，与旧版行为一致，适合直接预览或小体积场景。
2. **导出几何+贴图包**（zip）：产出
   - `scene.glb` —— 纯几何 GLB（已焊接/平滑/去裙边，合并为「一个网格 + 多材质 primitive」，不含任何贴图字节）；
   - `textures/tex-XXXX.jpg|png` —— 逐张外置贴图；
   - `textures.json` —— 清单（id、文件、分辨率、字节数、KTX2 变体）。

   GLB 的网格节点 extras 里带有 `plTextureBindings`（槽位 + 贴图 id + 相对路径），运行时据此按需加载贴图。贴图按需加载 / proceduralLandscape 跳过的运行时逻辑在 `@harmony/schema` 的 `terrainTextureStream.ts`。

### KTX2 变体（可选）

解压 zip 后运行：

```bash
pnpm --dir tools build
node tools/dist/cli-bin.js process-terrain-textures --manifest <解压目录>/textures.json
```

命令会为每张 JPEG 生成 `*.ktx2` 并回写清单的 `ktx2` 字段（需要 KTX-Software 的 `toktx` 在 PATH 上；缺失或转码失败时静默跳过，JPEG 始终保留为运行时兜底）。

## 微信小程序加载约定

把 zip 解压后整体放到服务器/CDN（贴图目录保持与 `scene.glb` 同级），场景里引用 `scene.glb`。运行时自动：

- proceduralLandscape `baseMapMode='replace'`（默认）：只下载纯几何 GLB，零贴图请求；
- `blend` 模式与普通渲染：按可见性与距离懒加载贴图（KTX2 优先、JPEG 兜底，64MB LRU 预算）；
- 需要在微信公众平台配置贴图所在域名为 `downloadFile` 合法域名。

## DEM + 正射影像导出（编辑器地形流程）

「导出 DEM 包」把当前捕获的合并地形栅格化为高度场，下载 `terrain-dem-<lat>-<lon>.zip`：

- `dem.tif` —— float32 单波段 GeoTIFF 高程（WGS84 椭球高），投影为锚点所在 UTM 带（EPSG 326xx/327xx；导出范围跨越分带时直接报错，请调整锚点）；
- `ortho.tif`（可选）—— 与 DEM 同一网格、同一朝向（行=北→南、列=西→东）的 RGB 正射影像，由合并网格用正交相机俯视渲染；
- `dem.json` —— 侧车清单：锚点（经纬度/地面海拔）、CRS、geotransform、光栅尺寸与间距、高程范围、空洞填充统计与警告。

选项：

- **DEM 分辨率**：默认「自动」，按网格三角形中位边长取整到 0.5/1/2/5m 档；也可手动 1/2/5/10m。网格恒不超过 4096×4096，超限会自动放宽间距并把警告写入侧车；
- **正射影像**：取消勾选则只导出高程；
- 采样空洞（网格未覆盖处）用最近有效值填充，填充率超过 5% 时记录警告。

合并、三角形栅格化、GeoTIFF 编码和 ZIP 打包在 Web Worker 中执行，主界面会显示当前阶段、真实计数、进度和已用时间；点击「取消导出」会终止 Worker 和后续正射渲染，不会产生下载。采样采用三角形扫描转换并保留格点上的最高表面，不再为每个 DEM 格点执行一次 BVH 射线查询。

正射渲染按 `1024×1024` 瓦片切分并使用异步像素回读，相机视锥使用以瓦片中心为原点的局部半宽/半高。修复前的版本曾把绝对 UTM 世界坐标误传给 Three.js 正交相机，导致大瓦片裁切、最后一列瓦片全黑和纹理错位；这类旧 ZIP 内缺失的像素无法修复，需要重新导出并重新上传。导出器还会把 DEM 采样空洞与渲染得到的黑色像素共同作为纹理空洞，用最近有效颜色填充并写入警告。

高程基准为 WGS84 椭球高，与 SRTM/QGIS 使用的大地水准面高存在系统差；该差值记录在侧车的锚点信息中，可在编辑器按需平移校正。

资源库流程：在 admin 资源页上传该 `.zip`。ZIP 只作为服务端导入容器，不会注册或保存；服务端解压后登记 `dem.json`，并将 TIF 保留为同目录私有文件。将 DEM 资源拖入场景后，`ProceduralLandscapeComponent` 使用服务端生成的 runtime grid 创建地形几何：

1. `dem.tif` 在服务端转换为紧凑的高度网格，组件加载后自动取回世界范围和高度；
2. 默认使用“仅程序化”地表，不下载正射纹理；
3. 在 `ProceduralLandscapePanel` 中选择“正射纹理”后，组件从服务器下载 `dem.json` 和其中 `ortho.file` 指向的原始 `ortho.tif`；
4. `ortho.tif` 在 Worker 中校验尺寸、CRS、北向上方向与地理变换，降采样并转换为南向上的地形纹理；
5. 资源包缺少 `ortho.tif` 时，面板禁用“正射纹理”并保留程序化地表；解析失败时同样回退程序化地表并在面板显示错误。

编辑器不再接受 ZIP 文件导入，也不再下载整个 ZIP 作为可拖放资产。
