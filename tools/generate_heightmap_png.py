from __future__ import annotations

import math
import pathlib
import struct
import zlib

WIDTH = 101
HEIGHT = 101
OUT_PATH = pathlib.Path(r"e:/harmony/editor/public/test-assets/heightmap-100m.png")


def chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def build_pixel_value(x: int, y: int) -> int:
    fx = x / (WIDTH - 1)
    fy = y / (HEIGHT - 1)

    hill1 = math.exp(-(((fx - 0.28) ** 2 + (fy - 0.28) ** 2) / 0.012))
    hill2 = math.exp(-(((fx - 0.72) ** 2 + (fy - 0.26) ** 2) / 0.020))
    hill3 = math.exp(-(((fx - 0.53) ** 2 + (fy - 0.73) ** 2) / 0.018))
    basin = math.exp(-(((fx - 0.50) ** 2 + (fy - 0.50) ** 2) / 0.130))
    wave = 0.5 * math.sin(fx * math.pi * 5.0 + fy * math.pi * 2.5) + 0.5 * math.cos(fx * math.pi * 3.0 - fy * math.pi * 4.0)
    ridge = math.sin((fx + fy) * math.pi * 7.0) * math.cos((fx - fy) * math.pi * 4.0)

    value = 116 + 58 * hill1 + 82 * hill2 + 66 * hill3 - 26 * basin + 14 * wave + 10 * ridge
    return max(0, min(255, int(round(value))))


def build_png() -> bytes:
    raw = bytearray()
    for y in range(HEIGHT):
        raw.append(0)
        for x in range(WIDTH):
            raw.append(build_pixel_value(x, y))

    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 0, 0, 0, 0)))
    png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
    png.extend(chunk(b"IEND", b""))
    return bytes(png)


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_bytes(build_png())
    data = OUT_PATH.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", data[16:24])
    assert (width, height) == (WIDTH, HEIGHT)
    print(f"wrote {OUT_PATH} ({width}x{height})")


if __name__ == "__main__":
    main()
