# 地形转换性能：编译地面构建优化（2026-10）

本文档记录 DEM → 3D 场景转换（`PlanningDialog → 转换到 3D 场景`）中
「编译地面」阶段的性能优化与实测数据。

## 背景与瓶颈

以一个 34×39km 的 DEM（`terrain-dem-29.64396-91.11584.zip`，地面工作网格
cellSize≈76.3m）为例，优化前一次转换约 16 分钟：

- 渲染瓦片：134,113 个（100m/瓦片）≈ 8.5 分钟；
- 碰撞瓦片：134,113 个（100m/瓦片）≈ 7.5 分钟。

代码层面确认的编排开销（几何计算本身很轻，每块瓦片仅数十个顶点）：

- `DEFAULT_COMPILED_GROUND_WORKER_BATCH_SIZE = 1`：每块瓦片一次 Worker 消息往返；
- `yieldEveryTiles = 2`：约 6.7 万次 `setTimeout(0)`；
- 进度事件按瓦片上报：每个瓦片一次 Pinia/UI 状态更新。

## 本期改动

1. **碰撞瓦片全局停用**（`BuildCompiledGroundAsyncOptions.includeCollisionTiles`，
   默认 `false`，保留显式开启用于排查）。运行时由
   `syncGroundCollisionRuntimeHost` 在 `collisionTiles` 为空时自动切换到
   无限块动态碰撞（`infiniteGroundChunkColliderRuntime`），编辑器与运行时
   Viewer 通用。
2. **修复编排瓶颈**：Worker 批大小 1 → 256；`yieldEveryTiles` 2 → 256；
   进度事件按 ~150ms 节流（phase 结束仍精确上报）。
3. **自适应渲染瓦片粒度**：`resolveAdaptiveRenderChunksPerTile` 取
   C ∈ {1,2,4,8}（100/200/400/800m），使全场景瓦片数 ≤ 10000，并以
   `tileSize ≤ 256 × cellSize` 限制单瓦片顶点数；`buildKey` 追加
   `renderChunks:<C>`。`SCENE_COMPILED_GROUND_PROFILE_VERSION` 2 → 3，
   旧编译缓存一次性失效。

## 实测（2026-10-16，同一 DEM 包，本机编辑器内）

| 场景 | 渲染瓦片 | 端到端耗时 |
| --- | --- | --- |
| 旧实现（100m 瓦片 + 碰撞瓦片） | 134,113 ×2 | ≈16 min（渲染 ≈8.5 min、碰撞 ≈7.5 min） |
| 新实现，冷缓存（首次转换） | 400m × 8,428 | ≈27 s |
| 新实现，热缓存（重复转换） | —（命中缓存） | 2.7–7.4 s |

该 DEM 覆盖范围 34,280 × 39,080 m、cellSize 76.33m、chunk 100m：
自适应解析结果 C=4（400m/瓦片，共 8,428 块），符合 ≤10000 的预算。

## 调参入口

- `DEFAULT_COMPILED_GROUND_WORKER_BATCH_SIZE`（默认 256）
- `yieldEveryTiles`（调用侧默认 256）
- `MAX_COMPILED_GROUND_RENDER_TILES`（默认 10000）
- `MAX_COMPILED_GROUND_TILE_SAMPLES_PER_AXIS`（默认 256）
- `includeCollisionTiles`（默认 false；仅诊断时临时打开）

## 说明

- 旧的 100m/含碰撞瓦片缓存因 profile 版本升级自动失效，首次转换会完整重建，
  之后的重复转换直接命中缓存。
- 依赖编译瓦片碰撞体的消费者不存在：`groundCollisionRuntimeHost` 与
  SceneryViewer 在空碰撞清单下都会启用动态碰撞；单元测试
  `compiledGroundBuild.test.ts` 锁定了该行为。

## DEM 地形“渲染成平面”的根因修复（同日）

导入 DEM 并转换后地形全部显示为平面（且与真实地形不符）。根因有两处：

1. **平面快路径误判**：`canTreatGroundChunkAsFlatPlane`（`schema/groundMesh.ts`）
   只检查“局部编辑瓦片 / 烘焙地表贴图”，不含这两者的 chunk 一律按
   `baseHeight`（0）渲染成平面。DEM 转换的高度存放在**规划高度场**（大范围
   导出时不会生成局部编辑瓦片），于是整个地形走了平面快路径。
   修复：与 `planningMetadata.demSource.worldBounds` 相交的 chunk 一律按真实
   高度网格构建（`groundChunkIntersectsPlanningDemCoverage`），快路径仅保留
   给 DEM 覆盖范围之外的平坦区域。回归测试：`groundChunkFlatness.test.ts`。
2. **块间距与网格跨度不一致**：工作网格 `cellSize` 若不整除
   `chunkSizeMeters`（例如 76.33m 对 100m），`computeChunkSpec` 取整后
   chunk 网格只覆盖 `round(chunk/cell)*cell` 米，与 100m 的流式间距不匹配，
   出现缝隙/错位。修复：`resolveGroundWorkingCellSizeForBounds` 将
   `cellSize` 量化为 `chunkSizeMeters / N`（保证 `chunkSize = N * cellSize`），
   `buildKey` 追加 `chunk:`/`cell:` 防止旧缓存误用。回归测试：
   `planningGroundCellSize.test.ts`。

工作网格预算改为 `2048 x 2048` 顶点（约 64 MiB 高度侧车，等同 2km@1m 的既有
规模）：34×39km 的 DEM 得到 20m 网格（5 格/块，无缝），2km 场景保持 1m。
重新转换会按范围重新推导网格（不再保留更粗的历史值，≤1m 的显式设置保留）。

上述修复后同一场景重转换的实测：编译阶段重建并持久化 **8,428 个渲染瓦片
约 8 秒**、无碰撞阶段、无控制台错误（覆盖层可见 “Building terrain render
tiles 8428/8428” 与 “Persisting 8428 compiled files”）。
