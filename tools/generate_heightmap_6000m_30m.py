from __future__ import annotations

import math
import pathlib
import struct
import zlib

WIDTH = 201
HEIGHT = 201
OUT_PATH = pathlib.Path(r"e:/harmony/editor/public/test-assets/heightmap-6000m-30m.png")


def chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def terrain_value(x: int, y: int) -> int:
    fx = x / (WIDTH - 1)
    fy = y / (HEIGHT - 1)

    # Large-scale relief with explicit below/above baseline variation.
    ridge_a = math.exp(-(((fx - 0.22) ** 2 + (fy - 0.30) ** 2) / 0.008))
    ridge_b = math.exp(-(((fx - 0.74) ** 2 + (fy - 0.68) ** 2) / 0.010))
    basin_a = math.exp(-(((fx - 0.48) ** 2 + (fy - 0.52) ** 2) / 0.030))
    basin_b = math.exp(-(((fx - 0.16) ** 2 + (fy - 0.76) ** 2) / 0.018))
    shelf = math.exp(-(((fx - 0.50) ** 2 + (fy - 0.14) ** 2) / 0.040))
    wave_x = math.sin(fx * math.pi * 6.0) * 18.0
    wave_y = math.cos(fy * math.pi * 5.0) * 14.0
    diagonal = math.sin((fx + fy) * math.pi * 8.0) * math.cos((fx - fy) * math.pi * 3.5) * 11.0
    local_noise = math.sin(fx * math.pi * 19.0 + fy * math.pi * 13.0) * 6.0

    # Center around a neutral baseline so the resulting terrain has
    # meaningful positive and negative relief if imported with a symmetric range.
    value = (
        128
        + 92 * ridge_a
        + 118 * ridge_b
        - 90 * basin_a
        - 62 * basin_b
        + 24 * shelf
        + wave_x
        + wave_y
        + diagonal
        + local_noise
    )
    return max(0, min(255, int(round(value))))


def build_png() -> bytes:
    raw = bytearray()
    for y in range(HEIGHT):
        raw.append(0)
        for x in range(WIDTH):
            raw.append(terrain_value(x, y))

    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 0, 0, 0, 0)))
    png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
    png.extend(chunk(b"IEND", b""))
    return bytes(png)


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    png_bytes = build_png()
    OUT_PATH.write_bytes(png_bytes)
    data = OUT_PATH.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", data[16:24])
    assert (width, height) == (WIDTH, HEIGHT)

    grayscale_values = [terrain_value(x, y) for y in range(HEIGHT) for x in range(WIDTH)]
    print(f"wrote {OUT_PATH} ({width}x{height})")
    print(f"grayscale range: {min(grayscale_values)}..{max(grayscale_values)}")


if __name__ == "__main__":
    main()
