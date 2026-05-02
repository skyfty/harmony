from __future__ import annotations

import math
import pathlib
import struct
import zlib

WIDTH = 501
HEIGHT = 501
OUT_PATH = pathlib.Path(r"e:/harmony/editor/public/test-data/planning-dem/heightmap-10000m-10000m-20m.png")


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

    ridge_nw = math.exp(-(((fx - 0.18) ** 2 + (fy - 0.22) ** 2) / 0.0045))
    ridge_ne = math.exp(-(((fx - 0.78) ** 2 + (fy - 0.25) ** 2) / 0.0060))
    ridge_sw = math.exp(-(((fx - 0.24) ** 2 + (fy - 0.76) ** 2) / 0.0065))
    ridge_se = math.exp(-(((fx - 0.80) ** 2 + (fy - 0.78) ** 2) / 0.0048))
    basin_center = math.exp(-(((fx - 0.50) ** 2 + (fy - 0.52) ** 2) / 0.030))
    saddle = math.exp(-(((fx - 0.52) ** 2 + (fy - 0.45) ** 2) / 0.090))
    shelf = math.exp(-(((fx - 0.48) ** 2 + (fy - 0.14) ** 2) / 0.040))

    wave_x = math.sin(fx * math.pi * 7.0) * 16.0
    wave_y = math.cos(fy * math.pi * 6.0) * 13.0
    diagonal = math.sin((fx + fy) * math.pi * 9.0) * math.cos((fx - fy) * math.pi * 5.0) * 10.0
    long_wave = math.sin((fx * 0.7 + fy * 1.1) * math.pi * 4.0) * 8.0
    micro = math.sin(fx * math.pi * 23.0 + fy * math.pi * 17.0) * 4.0

    value = (
        128
        + 104 * ridge_nw
        + 92 * ridge_ne
        + 98 * ridge_sw
        + 110 * ridge_se
        - 86 * basin_center
        + 30 * saddle
        + 22 * shelf
        + wave_x
        + wave_y
        + diagonal
        + long_wave
        + micro
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
