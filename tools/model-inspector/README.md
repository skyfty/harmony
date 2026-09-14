# Harmony 模型渲染检查工具

加载一个外部模型文件（本地或 URL），在浏览器里渲染出来，用来排查"模型在制作软件里正常、但在
editor / viewer / preview 里渲染异常"的问题：同一个文件会分别走**引擎真实加载管线**和**原生
three.js 加载管线**，可以直接看出差异来自文件本身、引擎的解码与材质规范化，还是光照与渲染设置。

## 启动

在 `tools` 目录执行：

```bash
pnpm run dev:model-inspector
```

默认地址 `http://localhost:8094`（editor 用 8088，viewer 用 8092）。

其它命令：

```bash
pnpm run type-check:model-inspector
pnpm run build:model-inspector
```

## 两条渲染管线

| | 引擎管线 | 原生 three.js |
| --- | --- | --- |
| 解析 | `@schema/loader`（引擎的真实 loader，GLB/FBX） | `GLTFLoader` / `FBXLoader` |
| 解码扩展 | 与线上一致：未挂 DRACO / KTX2 解码器 | DRACO + KTX2 + meshopt 解码器 |
| 后处理 | `prepareImportedObject` 居中落底、保留文件里的材质 `side`、alpha 混合转 cutout | 不做任何规范化 |

引擎管线的每一步都能单独关闭（"居中落底"、"alpha 混合转 cutout"），因此可以逐项验证哪一条规范化
造成了渲染差异。另有「强制 FrontSide」对照开关：线上引擎已不再把导入材质统一改成单面，勾选它可以
复现"背面镂空"的旧结果。默认状态与 `loadObjectFromBuffer()` 的线上路径等价。

`.gltf`（含外部 `.bin` / 贴图）以及使用 DRACO / KTX2 / meshopt 压缩扩展的文件，引擎 loader 无法
解析：工具会在顶部给出明确提示，并在原生解析结果上补做引擎等价的规范化后继续渲染，方便和原生结果
对比。若引擎管线报错，错误信息会同时给出基于文件扩展名的原因推断。

## 对比视图

- 单视图：顶部切换「引擎管线 / 原生 three.js」。
- 并排对比：同一个 `WebGLRenderer`、同一个相机，左右两个视口分别渲染两套管线，旋转缩放完全同步。

## 诊断能力

- 概要/统计：文件大小与格式、包围盒长宽高、几何中心与底部偏移、网格/顶点/三角面/材质/贴图/骨骼/动画数量、draw call、三角面、FPS。
- 节点树：层级、可见性开关、点击框选到该节点、显示该节点包围盒。
- 材质与贴图：材质类型与 `side`/`transparent`/`alphaTest`/`opacity`/`metalness`/`roughness`/`emissive`/`vertexColors`；贴图槽位、尺寸、色彩空间、wrap/filter、UV 通道。
- 显示模式：原始材质 / 线框 / 无光照 / 仅 albedo / 法线 / UV 棋盘 / 顶点色。
- 覆写：`side`、`transparent`、`alphaTest`、`flatShading`、`depthWrite`、`metalness`、`roughness`、`toneMapped`。
- 检测报告：缺法线、缺 UV、有法线贴图但缺法线/UV、非索引几何、退化三角面、三角形绕序与顶点法线相反（背面朝外）、骨骼权重异常、贴图缺失、NPOT 贴图风险、albedo 未标记 sRGB、文件使用双面材质（引擎会保留）等。
- 动画与骨骼：动画列表、播放/暂停/进度/速度、`SkeletonHelper` 骨骼显示。
- 导出：当前视图截图 PNG、检查报告 JSON（下载或复制）、引擎规范化后的 GLB（`GLTFExporter`）。

## 光照与环境

默认值取自引擎常量：环境光 `#ffffff @ 0.75`，主方向光 `#ffffff @ 3`、方位角 45°、仰角 42°，
背景 `#516175`，`outputColorSpace = sRGB`，`shadowMap.type = PCFSoftShadowMap`，**不启用**色调映射
（与线上一致）。可切纯色/引擎渐变/透明棋盘背景、加载本地 `.hdr`/`.exr` 作为环境贴图与 `environment`，
并调整环境强度、曝光与色调映射（None / ACES / AgX / Reinhard / Neutral / Linear）。

## 已知限制

- 主方向光用单光源 + PCFSoft 阴影近似引擎的 CSM（引擎为 2 级级联、阴影贴图 128、带级联淡出），
  大场景的阴影边界可能与线上略有差异。
- 视口为了只看材质与几何差异，会统一给两侧网格开启 `castShadow` / `receiveShadow`。
- 双视图只对比"同一个文件的引擎管线 vs 原生管线"，不支持两个不同文件的 A/B。
- 服务器资源只支持直接粘贴完整下载 URL；跨域受限时请改用本地文件，或把文件放进
  `tools/model-inspector/public/` 后按同源路径访问。
- KTX2 转码得到的贴图无法完整回写到导出的 GLB 中，导出时会提示。
- 仅面向桌面 Chrome / Edge 的 H5 环境，不涉及小程序平台。
