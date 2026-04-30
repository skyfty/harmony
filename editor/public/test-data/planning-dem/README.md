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
