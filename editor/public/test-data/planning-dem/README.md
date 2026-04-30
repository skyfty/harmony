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
