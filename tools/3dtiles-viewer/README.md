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
