from __future__ import annotations

import math
import pathlib

import numpy as np
import tifffile

WIDTH = 101
HEIGHT = 101
OUT_PATH = pathlib.Path(r"e:/harmony/tools/dem-lab/test-fixtures/undulating-100m-dem.tif")


def terrain_height(x: int, y: int) -> float:
    fx = x / (WIDTH - 1)
    fy = y / (HEIGHT - 1)

    hill_a = math.exp(-(((fx - 0.24) ** 2 + (fy - 0.26) ** 2) / 0.010))
    hill_b = math.exp(-(((fx - 0.72) ** 2 + (fy - 0.30) ** 2) / 0.014))
    hill_c = math.exp(-(((fx - 0.57) ** 2 + (fy - 0.74) ** 2) / 0.018))
    basin_a = math.exp(-(((fx - 0.50) ** 2 + (fy - 0.52) ** 2) / 0.060))
    basin_b = math.exp(-(((fx - 0.16) ** 2 + (fy - 0.78) ** 2) / 0.020))
    ridge = math.sin((fx + fy) * math.pi * 7.0) * math.cos((fx - fy) * math.pi * 4.0)
    wave_x = math.sin(fx * math.pi * 5.5) * 12.0
    wave_y = math.cos(fy * math.pi * 4.5) * 9.0
    detail = math.sin(fx * math.pi * 18.0 + fy * math.pi * 13.0) * 4.5

    return (
        135.0
        + 88.0 * hill_a
        + 72.0 * hill_b
        + 96.0 * hill_c
        - 58.0 * basin_a
        - 34.0 * basin_b
        + 18.0 * ridge
        + wave_x
        + wave_y
        + detail
    )


def build_raster() -> np.ndarray:
    raster = np.empty((HEIGHT, WIDTH), dtype=np.float32)
    for y in range(HEIGHT):
        for x in range(WIDTH):
            raster[y, x] = terrain_height(x, y)
    return raster


def main() -> None:
    raster = build_raster()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tifffile.imwrite(
        OUT_PATH,
        raster,
        photometric="minisblack",
        metadata=None,
        extratags=[
            (33550, "d", 3, (1.0, 1.0, 0.0), False),
            (33922, "d", 6, (0.0, 0.0, 0.0, 0.0, 0.0, 0.0), False),
            (34735, "H", 8, (1, 1, 0, 2, 1024, 0, 1, 1), False),
        ],
    )

    with tifffile.TiffFile(OUT_PATH) as tif:
        page = tif.pages[0]
        values = page.asarray()
        print(f"wrote {OUT_PATH} ({page.imagewidth}x{page.imagelength})")
        print(f"dtype: {values.dtype}, range: {float(np.nanmin(values)):.3f}..{float(np.nanmax(values)):.3f}")


if __name__ == "__main__":
    main()