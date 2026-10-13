# Slow Roads Lab

slowroads 风格的程序化地形 / 道路 / 精灵植被试验工程，用来先把视觉效果调对，再把逻辑移植到 editor 的 `proceduralLandscape` 组件。

## 启动

在 `tools` 目录执行：

```bash
pnpm dev:slowroads-lab
```

构建用 `pnpm build:slowroads-lab`，类型检查用 `pnpm type-check:slowroads-lab`。

## 复刻的 slowroads 机制

- **高度场**：种子化 fbm（基/中/细节三层），双线性解析采样；后续移植时只需把采样器换成 GLB 网格采样（`src/lab/heightfield.ts` 的接口保持不变）。
- **道路追踪**：`extendMidline` 探针公式（前/左/右三点得到横向/纵向梯度，转向目标 `bT=(feelAvg-feelAhead)/feelDif`，再由坡度钳制与每步转角变化上限约束），卡死时放宽角度救援，出界或达到长度上限结束（`src/lab/roadTrace.ts`）。
- **地形—道路耦合**：按到折线的距离把地形压平（`roadProx = d - 半宽`），并烘焙进顶点（`src/lab/roadProfile.ts` 与 `src/lab/terrainMesh.ts`）。
- **地表着色**：草地底色、明暗噪声斑、与树木密度同源的树冠色斑、碎石路肩、路面；路面区域忽略坡度（`src/lab/terrainMaterial.ts`）。
- **植被放置**：树按 0–3 级密度场每 10m 单元生成 `ceil(1.4*(等级+rand))` 棵并过滤坡度/高度/距路净空；草只生成在道路走廊 0.2–20m 内并在路缘下沉；灌木沿路成带（`src/lab/placement.ts`）。
- **近/远树分层**：顶点着色器内按到摄像机的距离收缩第二片面片、去风摆并加深，相机移动不触发 CPU 重建（`src/lab/foliage.ts`）。

## 精灵图集

`src/assets/` 中的四张贴图来自 slowroads 素材（均带透明通道，alphaTest 使用）：

| 文件 | 网格 | 变体 | 用途 |
| --- | --- | --- | --- |
| grass.png | 2x2 | 4 | 走廊草（含干草/深色品种） |
| bush.png | 4x2 | 8 | 路侧灌木（含蕨类与小树） |
| broadleaf.png | 2x2 | 3（右下为空） | 阔叶树 |
| conifer.png | 4x2 | 8 | 针叶/乔木树 |

UV 计算按行优先、自左上角计数，并带 1.5 texel 内缩防止图集渗色。

## 控制

- 自由相机：拖拽旋转、WASD 移动、Q/E 升降、Shift 加速；「巡航」按钮切换到沿路行驶视角（14 m/s、2.2m 高）。
- 面板：图层开关（地表混合/道路/树冠色斑/草/灌木/树/风摆）、种子与重新生成、树密度与尺寸、草走廊宽与密度、灌木密度、风强度、道路宽与压平带、近树距离、巡航速度。
- 左下角统计：FPS、draw calls、三角形数、树/草/灌木实例数、道路长度、生成耗时。

## 自检

启动时运行纯函数自检（噪声与道路确定性、道路不出界、树不落在路面且不超坡、草在走廊内），失败会在控制台以 `console.assert` 报错。
