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
