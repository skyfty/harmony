# Planning DEM QGIS 16-bit 高度图导出规范

本文档定义了 Harmony 规划 DEM 导入所使用的 QGIS 固定导出流程。美工和地图处理人员请严格按本文档操作，不要自行变更编码方式、位深、尺寸计算规则或导出格式。

## 适用规则

Harmony 当前对图片 DEM 的默认导入规则如下：

- 文件格式：`PNG`
- 颜色模型：单通道灰度图
- 位深：`16-bit`
- Alpha：不允许
- 编码公式：`encodedValue = elevationMeters + 32768`
- 零高程：像素值 `32768`
- 垂直比例：`1 个编码单位 = 1 米`
- 有效高程范围：`-32768m` 到 `+32767m`

只要违反以上任一条规则，Harmony 导入时就应该直接报错，不做自动修复。

## 固定尺寸规则

Harmony 对图片高度图的覆盖范围解释，使用的是“栅格段数”，不是单纯按像素数量硬套。

尺寸计算公式如下：

- `pixelWidth = worldWidthMeters / metersPerPixel + 1`
- `pixelHeight = worldHeightMeters / metersPerPixel + 1`

示例：如果要导出一个 `1000m x 1000m`、分辨率为 `1m/px` 的测试区域，则导出尺寸必须是：

- 世界尺寸：`1000m x 1000m`
- 分辨率：`1m/px`
- 输出尺寸：`1001 x 1001`

## 已提供测试文件

当前已生成一份可直接用于测试的标准文件：

- `editor/public/test-data/planning-dem-test-1000m-strict-qgis-16bit.png`
- `editor/public/test-data/planning-dem-test-1000m-strict-qgis-16bit.json`

这份测试图已经符合 strict 规则，覆盖范围正好是 `1000m x 1000m`，分辨率是 `1m/px`。

## QGIS 固定操作流程

以下步骤请逐项执行，不要跳步。

### 1. 准备原始 DEM

1. 在 QGIS 中打开原始 DEM。
2. 确认该图层使用的是“以米为单位的投影坐标系”，不能直接使用经纬度坐标系。
3. 如果源数据不是米制投影坐标系，先做重投影。
4. 将 DEM 裁剪到最终需要导入 Harmony 的目标区域。

这一阶段的目标结果是：

- 水平单位必须是米。
- 高程值本身必须已经是“米”。

### 2. 确定最终输出分辨率

在导出前先决定最终的 `meters-per-pixel`。

建议规则：

- 小型测试图：`1m/px`
- 大型规划图：只有当源 DEM 本身分辨率较粗，或必须控制文件体积时，才使用更大的米每像素值。

随后用 Harmony 的尺寸公式计算导出尺寸：

- `pixelCount = worldSpanMeters / metersPerPixel + 1`

示例：

- 如果区域是 `1000m x 1000m`，目标分辨率是 `1m/px`，则必须导出为 `1001 x 1001` 像素。

### 3. 编码前检查高程范围

在编码为 16-bit PNG 之前，必须先确认最终 DEM 的高程值落在以下范围内：

- 最小允许值：`-32768m`
- 最大允许值：`+32767m`

如果原始 DEM 超出这个范围，不允许直接导出。

正确处理方式：

- 停止导出。
- 联系技术人员确认是否需要裁剪区域、偏移高程，或改走其他格式。

### 4. 重采样到最终栅格

在 QGIS 中将栅格重采样到上一步确定的最终尺寸。

目标结果：

- 单波段栅格
- 宽高严格符合 Harmony 的尺寸规则
- 水平分辨率严格等于选定的 `meters-per-pixel`

### 5. 在 Raster Calculator 中编码为 UInt16

打开 QGIS 的 Raster Calculator，生成用于导出的编码栅格。

请使用下面这条固定公式：

```text
round("YOUR_DEM_LAYER@1") + 32768
```

要求如下：

- 将 `YOUR_DEM_LAYER` 替换成 QGIS 中实际的图层波段名称。
- 输出数据类型必须是 `UInt16`。
- 不允许输出为浮点型。
- 不允许做按最小值/最大值归一化。
- 不允许做拉伸、映射到 0 到 65535。
- 不允许套用颜色带、色阶渲染或可视化灰度方案。

这一步的作用，是把“真实高程米值”转换成 Harmony strict 规则要求的编码值。

编码示例：

- `-20m` 会变成 `32748`
- `0m` 会变成 `32768`
- `135m` 会变成 `32903`

### 6. 将编码后的栅格导出为 PNG

把上一步得到的 UInt16 栅格导出为 PNG。

导出时必须满足以下设置：

- 文件类型：`PNG`
- 位深：`16-bit`
- 单波段灰度图
- 不带 Alpha 通道
- 不带调色板 / Indexed Color
- 不转成 RGB
- 不把渲染样式烘焙进输出结果

特别注意：

- 必须导出“栅格数据本身”，不能导出地图窗口截图。
- 如果 QGIS 的导出选项试图套用当前显示颜色，必须停止并改用真正的栅格数据导出方式。

### 7. 交付前最终检查

在把 PNG 交给 Harmony 使用者之前，必须逐项确认：

- 文件后缀是 `.png`
- 图像是单通道灰度图
- PNG 位深是 `16-bit`
- 图像尺寸符合 `worldSpan / metersPerPixel + 1`
- 栅格不含透明通道
- 编码公式确实是 `高程 + 32768`
- 已经记录本次导出的 `meters-per-pixel`

## Harmony 导入设置

在 Harmony 中导入 strict PNG 时：

- Heightmap mode：`Strict QGIS 16-bit`
- Meters per pixel：必须与 QGIS 导出时设置的分辨率完全一致

对于当前已提供的测试图：

- Heightmap mode：`Strict QGIS 16-bit`
- Meters per pixel：`1`
- 覆盖范围：`1000m x 1000m`
- 图像尺寸：`1001 x 1001`

## 常见错误

以下做法都不允许：

- 不要导出为 8-bit PNG。
- 不要导出为 RGB PNG。
- 不要导出带透明通道的 PNG。
- 不要按最小值/最大值先做归一化再导出。
- 不要把 DEM 渲染成“看起来像灰度图”的可视化图片再导出。
- 不要把 `1000m x 1000m`、`1m/px` 的区域裁成 `1000 x 1000` 像素。
- 不要直接使用经纬度坐标系数据进行导出。

## 给美工的快速检查清单

每次导出前后都按下面的清单核对：

1. DEM 已经是米制投影坐标系。
2. 最终区域尺寸已经确认。
3. `meters-per-pixel` 已经确认。
4. 输出像素尺寸已经按 `范围 / 分辨率 + 1` 计算。
5. 高程范围落在 `-32768m` 到 `+32767m` 之内。
6. Raster Calculator 公式使用的是 `round(dem) + 32768`。
7. 输出数据类型是 `UInt16`。
8. 最终导出的是不带 Alpha 的 `16-bit` 灰度 PNG。
9. Harmony 导入时填写的 `meters-per-pixel` 与导出分辨率一致。
