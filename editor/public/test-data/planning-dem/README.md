# Planning DEM test assets

## simple-two-chunk-dem.png

- Dimensions: 201 x 101 pixels
- Intended metric coverage: 200m x 100m
- Chunk coverage: 2 adjacent 100m x 100m chunks
- Suggested import elevation range: 0m to 60m
- Shape:
  - Left chunk is a low gentle slope
  - The center seam at x=100 is a clean shared boundary
  - Right chunk ramps higher with a mild north-south bulge for seam and interpolation testing

This file is meant for quick planning DEM import checks, especially chunk boundary alignment and bilinear interpolation behavior.

## undulating-two-chunk-dem.png

- Dimensions: 201 x 101 pixels
- Intended metric coverage: 200m x 100m
- Chunk coverage: 2 adjacent 100m x 100m chunks
- Suggested import elevation range: 0m to 80m
- Shape:
  - Contains visible rolling hills instead of a mostly linear slope
  - Includes two broad mounds plus a shallow center valley
  - Keeps the center seam at x=100 continuous for chunk stitching checks

Use this file when you want a more obvious terrain relief profile while still testing only two chunks.

## compact-two-chunk-dem.png

- Dimensions: 201 x 101 pixels
- Intended metric coverage: 200m x 100m
- Chunk coverage: 2 adjacent 100m x 100m chunks
- Suggested import elevation range: 0m to 40m
- Shape:
  - Relief is concentrated near the center of the rectangle
  - Edges fall off quickly so the footprint reads as a compact test area
  - The seam at x=100 stays continuous for boundary checks

This is the recommended asset if you want the smallest-looking terrain footprint while still spanning exactly two chunks.

## steep-one-chunk-dem.png

- Dimensions: 101 x 101 pixels
- Intended metric coverage: 100m x 100m
- Chunk coverage: exactly 1 chunk
- Suggested import elevation range: 0m to 100m
- Shape:
  - Strong left-to-right slope across the whole chunk
  - Small ridge and shoulder details to make the slope easier to see
  - No extra horizontal span beyond a single chunk

Use this file when you want a simple single-chunk DEM with a clearly steep gradient.

## heightmap-560m-300m-20m.png

- Dimensions: 29 x 16 pixels
- Intended planning scale: 20m per pixel
- Intended metric coverage: 560m x 300m in PlanningDialog's import math
- Shape:
  - Large rolling relief with two broad mountain masses and one central saddle
  - A visible north-south valley keeps the terrain carving test obvious across multiple chunks
  - Strong enough contrast for chunk stitching and sculpting checks after PNG import

This is the closest integer-pixel 20m grid version for the requested 550m x 300m test area.

## heightmap-400m-500m-20m.png

- Dimensions: 21 x 26 pixels
- Intended planning scale: 20m per pixel
- Intended metric coverage: 400m x 500m in PlanningDialog's import math
- Chunk coverage: 4 columns x 5 rows of 100m x 100m chunks
- Shape:
  - Strong multi-peak relief with a central valley to exercise chunk carving across a larger footprint
  - Designed to visibly cross both horizontal and vertical chunk boundaries
  - Uses full grayscale height variation for a more obvious imported terrain silhouette

Use this file when you want the smallest 20m grid that still spans 4 by 5 chunks.

## heightmap-400m-500m-20m-steep.png

- Dimensions: 21 x 26 pixels
- Intended planning scale: 20m per pixel
- Intended metric coverage: 400m x 500m in PlanningDialog's import math
- Chunk coverage: 4 columns x 5 rows of 100m x 100m chunks
- Shape:
  - Same footprint as the non-steep version, but with sharper ridges and deeper valley cuts
  - Higher contrast makes slope transitions and chunk carving more visible
  - Useful when you want the imported terrain to read as more aggressive and cliff-like

Use this file when you want a harder test case than heightmap-400m-500m-20m.png.

## heightmap-10000m-10000m-20m.png

- Dimensions: 501 x 501 pixels
- Intended planning scale: 20m per pixel
- Intended metric coverage: 10000m x 10000m in PlanningDialog's import math
- Chunk coverage: 100 columns x 100 rows of 100m x 100m chunks
- Shape:
  - Very large-scale relief with multiple broad ridges and a central basin
  - Strong enough contrast to stress chunk generation, sculpting, and conversion throughput
  - Designed to make any mismatch between grayscale height and imported terrain immediately visible

Use this file when you want to test large-area conversion performance and chunk coverage correctness.

## 判定标准

- Chunk 占用正确的标准：导入后 ground worldBounds 应该是 `[-5000, 5000] x [-5000, 5000]`，按 100m chunk 切分后应覆盖 `100 x 100` 个 chunk。
- 地形起伏一致的标准：导入后的地形高低关系应该与 PNG 的亮暗分布一致，亮的区域更高、暗的区域更低，且中心谷地/边缘山脊的位置不能明显偏移。
- 额外检查建议：沿着中线和对角线各截一条剖面，确认山脊、谷地和平台的顺序与 PNG 里的明暗结构一致。
