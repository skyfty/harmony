#!/usr/bin/env python
"""
Measure packed sprite-atlas regions for the slowroads seasonal sprite sets.

The lab (and later the editor) needs tight per-sprite rectangles because the
slowroads atlases pack several sprites per file:

  - bushes / grasses: 4 equal columns (1024x256 / 512x128);
  - near tree cards (trees_0): 4 equal columns, bottom 128 px = bark strip;
  - near conifer cards (trees_1_m + _a mask): packed layout with top-down
    canopy discs, hanging branches and 2 side-view trees; only the side-view
    trees (trunk touching the bottom edge) are usable at ground level.

Output: src/core/spriteRegionsData.ts (committed, generated).

Usage: py -3.10 scripts/measure-sprites.py [--assets <dir>] [--out <file>]
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
from collections import deque

from PIL import Image

SEASONS = ("spring", "summer", "autumn", "winter")
LAB_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ASSETS = os.path.join(LAB_ROOT, "assets-src")
DEFAULT_OUT = os.path.join(LAB_ROOT, "src", "core", "spriteRegionsData.ts")

DOWNSCALE = 2
ALPHA_THRESHOLD = 24
MIN_COMPONENT_AREA = 5  # downsampled pixels
PAD_PX = 3

# Slowroads reuses one grass-sprite atlas across two seasons.
GRASS_FILE_SEASONS = {
    "spring": "summer",
    "summer": "summer",
    "autumn": "summer",
    "winter": "winter",
}

# Clusters smaller than this many real pixels are noise (anti-aliased line
# fragments that survive the downscale) and are dropped.
MIN_CLUSTER_AREA = 350


def load_mask(path: str) -> Image.Image:
    image = Image.open(path)
    if path.endswith("_a.png"):
        # Tree-card alpha masks are exported as grayscale RGB (white = opaque).
        return image.convert("L")
    if image.mode in ("RGBA", "LA", "P"):
        return image.convert("RGBA").split()[3]
    if image.mode == "L":
        return image
    return image.convert("L")


def components(mask: Image.Image, invert: bool = False):
    """4-neighbour connected components over a binary downsampled mask."""
    width, height = mask.size
    small = mask.resize((max(1, width // DOWNSCALE), max(1, height // DOWNSCALE)), Image.BOX)
    pixels = small.load()
    w, h = small.size
    visited = bytearray(w * h)
    comps = []
    for y0 in range(h):
        for x0 in range(w):
            index = y0 * w + x0
            if visited[index]:
                continue
            value = pixels[x0, y0]
            solid = value <= ALPHA_THRESHOLD if invert else value > ALPHA_THRESHOLD
            if not solid:
                visited[index] = 1
                continue
            queue = deque([(x0, y0)])
            visited[index] = 1
            min_x = max_x = x0
            min_y = max_y = y0
            area = 0
            while queue:
                x, y = queue.popleft()
                area += 1
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    neighbour = ny * w + nx
                    if visited[neighbour]:
                        continue
                    nvalue = pixels[nx, ny]
                    nsolid = nvalue <= ALPHA_THRESHOLD if invert else nvalue > ALPHA_THRESHOLD
                    if not nsolid:
                        visited[neighbour] = 1
                        continue
                    visited[neighbour] = 1
                    queue.append((nx, ny))
            if area >= MIN_COMPONENT_AREA:
                comps.append(
                    {
                        "x0": min_x * DOWNSCALE,
                        "y0": min_y * DOWNSCALE,
                        "x1": min((max_x + 1) * DOWNSCALE, width),
                        "y1": min((max_y + 1) * DOWNSCALE, height),
                        "area": area * DOWNSCALE * DOWNSCALE,
                    }
                )
    return comps


def clamp_box(box, width, height):
    x0 = max(0, box["x0"] - PAD_PX)
    y0 = max(0, box["y0"] - PAD_PX)
    x1 = min(width, box["x1"] + PAD_PX)
    y1 = min(height, box["y1"] + PAD_PX)
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}


def to_region(box, width, height, content_height, atlas_content_height):
    return {
        "u0": round(box["x0"] / width, 5),
        "v0": round(1 - box["y1"] / height, 5),
        "u1": round(box["x1"] / width, 5),
        "v1": round(1 - box["y0"] / height, 5),
        "aspect": round((box["x1"] - box["x0"]) / max(1, box["y1"] - box["y0"]), 4),
        "heightScale": round(content_height / atlas_content_height, 4),
    }


def find_file(assets_dir: str, pattern: str):
    matches = sorted(glob.glob(os.path.join(assets_dir, pattern)))
    return matches[0] if matches else None


def cluster_components(comps, gap=24):
    """Group components into horizontally adjacent clusters (left to right)."""
    ordered = sorted(comps, key=lambda c: c["x0"])
    clusters = []
    current = []
    reach = None
    for comp in ordered:
        if reach is None or comp["x0"] - reach <= gap:
            current.append(comp)
            reach = max(reach if reach is not None else comp["x1"], comp["x1"])
        else:
            clusters.append(current)
            current = [comp]
            reach = comp["x1"]
    if current:
        clusters.append(current)
    return clusters


def cluster_box(cluster):
    return {
        "x0": min(c["x0"] for c in cluster),
        "y0": min(c["y0"] for c in cluster),
        "x1": max(c["x1"] for c in cluster),
        "y1": max(c["y1"] for c in cluster),
        "area": sum(c["area"] for c in cluster),
    }


def measure_columns(
    assets_dir: str,
    pattern: str,
    columns: int = 4,
    season_files=None,
    vertical_rows: int = 1,
    ground_row_only: bool = False,
):
    """Sprite entries per equal atlas cell (the slowroads variant slot).

    The cell index is the shader-facing variant id (winter crops cells 0/1 and
    halves 2/3, etc.). Inside a cell, thin sprite fragments are joined into
    clusters by a horizontal gap rule; noise clusters below MIN_CLUSTER_AREA are
    dropped and every surviving cluster becomes one tight sprite entry
    `{ cell, region }`. Cells whose sprites sit on top of each other (for
    example the spring flower clump plus its seedling) therefore emit separate
    entries instead of one merged card.
    """
    result = {}
    for season in SEASONS:
        file_season = season_files.get(season, season) if season_files else season
        path = find_file(assets_dir, f"{file_season}_{pattern}.*.png")
        if path is None:
            print(f"  ! missing {file_season}_{pattern}", file=sys.stderr)
            continue
        mask = load_mask(path)
        width, height = mask.size
        comps = components(mask)
        column_width = width / columns
        entries = []
        dropped = 0
        row_height = height / max(1, vertical_rows)
        for column in range(columns):
            cx0 = column * column_width
            cx1 = (column + 1) * column_width
            inside = [c for c in comps if cx0 <= (c["x0"] + c["x1"]) / 2 < cx1]
            for row in range(vertical_rows):
                row_inside = [
                    c
                    for c in inside
                    if row * row_height <= (c["y0"] + c["y1"]) / 2 < (row + 1) * row_height
                ]
                for cluster in cluster_components(row_inside):
                    box = cluster_box(cluster)
                    if box["area"] < MIN_CLUSTER_AREA:
                        dropped += 1
                        continue
                    # Ground vegetation only uses the atlas' lower sprite row.
                    # Hanging branches/canopy discs in the upper row are separate
                    # atlas content, not variants of the same plant.
                    if ground_row_only and row != vertical_rows - 1:
                        dropped += 1
                        continue
                    entries.append({"cell": column, "box": box})
        all_boxes = [entry["box"] for entry in entries]
        atlas_content_height = max((b["y1"] - b["y0"]) for b in all_boxes) if all_boxes else 1
        out_entries = []
        for entry in sorted(entries, key=lambda item: (item["cell"], item["box"]["x0"], item["box"]["y0"])):
            box = entry["box"]
            clamped = clamp_box(box, width, height)
            out_entries.append(
                {"cell": entry["cell"], "region": to_region(clamped, width, height, box["y1"] - box["y0"], atlas_content_height)}
            )
        result[season] = {"file": os.path.basename(path), "size": [width, height], "entries": out_entries}
        filled_columns = len(set(entry["cell"] for entry in out_entries))
        suffix = f", dropped {dropped} noise cluster(s)" if dropped else ""
        print(
            f"  {season}: {os.path.basename(path)} {width}x{height} -> "
            f"{len(out_entries)} sprites in {filled_columns}/{columns} cells{suffix}"
        )
    return result


def measure_conifer_cards(assets_dir: str):
    """Pick the side-view trees (trunk at the bottom edge) from trees_1 masks."""
    result = {}
    for season in SEASONS:
        path = find_file(assets_dir, f"{season}_trees_1_a.*.png")
        if path is None:
            print(f"  ! missing {season}_trees_1_a", file=sys.stderr)
            continue
        mask = load_mask(path)
        width, height = mask.size
        comps = components(mask)
        candidates = []
        for c in comps:
            w = c["x1"] - c["x0"]
            h = c["y1"] - c["y0"]
            # The trees_1 sheet opens with a full-height bark strip column
            # (x 0..256) that also touches the bottom edge; it is not a tree.
            if c["y0"] <= 4 and c["y1"] >= height - 4:
                continue
            if h < height * 0.45:
                continue
            if c["y1"] < height - 16:  # trunk must reach the bottom edge
                continue
            if w / max(1, h) > 1.1:  # top-down canopy discs are wide
                continue
            if w < 24:
                continue
            candidates.append(c)
        # Two tallest, left-to-right.
        candidates.sort(key=lambda c: c["y1"] - c["y0"], reverse=True)
        picked = sorted(candidates[:2], key=lambda c: c["x0"])
        content_heights = [c["y1"] - c["y0"] for c in picked]
        atlas_content_height = max(content_heights) if content_heights else 1
        regions = []
        for c in picked:
            clamped = clamp_box(c, width, height)
            regions.append(to_region(clamped, width, height, c["y1"] - c["y0"], atlas_content_height))
        result[season] = {
            "file": os.path.basename(path),
            "size": [width, height],
            "regions": regions,
            "diagnostics": [
                {"x0": c["x0"], "y0": c["y0"], "x1": c["x1"], "y1": c["y1"], "area": c["area"]} for c in picked
            ],
        }
        labels = ", ".join("x{}..{}".format(c["x0"], c["x1"]) for c in picked)
        print(f"  {season}: {os.path.basename(path)} -> {len(regions)} side-view trees ({labels})")
    return result


def measure_broadleaf_checks(assets_dir: str):
    """Verify the trees_0 four-column layout and record the per-column content bbox."""
    result = {}
    for season in SEASONS:
        path = find_file(assets_dir, f"{season}_trees_0.*.png")
        if path is None or "_n." in os.path.basename(path):
            print(f"  ! missing {season}_trees_0", file=sys.stderr)
            continue
        mask = load_mask(path)
        width, height = mask.size
        comps = components(mask)
        column_width = width / 4
        boxes = []
        for column in range(4):
            cx0 = column * column_width
            cx1 = (column + 1) * column_width
            inside = [c for c in comps if (c["x0"] + c["x1"]) / 2 >= cx0 and (c["x0"] + c["x1"]) / 2 < cx1]
            if inside:
                boxes.append(
                    {
                        "x0": min(c["x0"] for c in inside),
                        "y0": min(c["y0"] for c in inside),
                        "x1": max(c["x1"] for c in inside),
                        "y1": max(c["y1"] for c in inside),
                    }
                )
            else:
                boxes.append(None)
        result[season] = {"file": os.path.basename(path), "size": [width, height], "columnBboxes": boxes}
        tops = ", ".join(f"y0={b['y0']}" if b else "empty" for b in boxes)
        print(f"  {season}: {os.path.basename(path)} column tops: {tops}")
    return result


def format_region(region, indent):
    if region is None:
        return f"{indent}null,"
    return (
        f"{indent}{{ u0: {region['u0']}, v0: {region['v0']}, u1: {region['u1']}, v1: {region['v1']}, "
        f"aspect: {region['aspect']}, heightScale: {region['heightScale']} }},"
    )


def write_typescript(out_path: str, bushes, grass, conifer, broadleaf):
    lines = []
    lines.append("// GENERATED by scripts/measure-sprites.py — do not edit by hand.")
    lines.append("// Re-run: py -3.10 scripts/measure-sprites.py")
    lines.append("")
    lines.append("/** Shader-space sprite rectangle (UV origin bottom-left, flipY applied). */")
    lines.append("export interface GeneratedSpriteRegion {")
    lines.append("  readonly u0: number")
    lines.append("  readonly v0: number")
    lines.append("  readonly u1: number")
    lines.append("  readonly v1: number")
    lines.append("  readonly aspect: number")
    lines.append("  readonly heightScale: number")
    lines.append("}")
    lines.append("")
    lines.append("/** One sprite packed inside a slowroads variant cell (cell 0..3). */")
    lines.append("export interface GeneratedSpriteEntry {")
    lines.append("  readonly cell: number")
    lines.append("  readonly region: GeneratedSpriteRegion")
    lines.append("}")
    lines.append("")
    lines.append("export interface GeneratedSpriteSet {")
    lines.append("  readonly file: string")
    lines.append("  readonly size: readonly [number, number]")
    lines.append("  readonly entries: ReadonlyArray<GeneratedSpriteEntry>")
    lines.append("}")
    lines.append("")

    def emit_table(name, table, with_diag=False):
        lines.append(f"export const {name} = {{")
        for season in SEASONS:
            entry = table.get(season)
            if entry is None:
                lines.append(f"  {season}: null,")
                continue
            lines.append(f"  {season}: {{")
            lines.append(f"    file: '{entry['file']}',")
            lines.append(f"    size: [{entry['size'][0]}, {entry['size'][1]}] as const,")
            if "entries" in entry:
                lines.append("    entries: [")
                for sprite in entry["entries"]:
                    region = sprite["region"]
                    lines.append(
                        f"      {{ cell: {sprite['cell']}, region: "
                        f"{{ u0: {region['u0']}, v0: {region['v0']}, u1: {region['u1']}, v1: {region['v1']}, "
                        f"aspect: {region['aspect']}, heightScale: {region['heightScale']} }} }},"
                    )
                lines.append("    ],")
            else:
                lines.append("    regions: [")
                for region in entry["regions"]:
                    lines.append(format_region(region, "      "))
                lines.append("    ],")
            if with_diag and "diagnostics" in entry:
                lines.append("    diagnostics: [")
                for diag in entry["diagnostics"]:
                    lines.append(
                        f"      {{ x0: {diag['x0']}, y0: {diag['y0']}, x1: {diag['x1']}, y1: {diag['y1']} }},"
                    )
                lines.append("    ],")
            lines.append("  },")
        lines.append("} as const")
        lines.append("")

    emit_table("GENERATED_BUSH_REGIONS", bushes)
    emit_table("GENERATED_GRASS_SPRITE_REGIONS", grass)
    emit_table("GENERATED_CONIFER_CARD_REGIONS", conifer, with_diag=True)

    # trees_0 is a clean 4-column layout verified per season; the record keeps
    # the per-column content bbox for regression checks only.
    lines.append("export const GENERATED_BROADLEAF_CHECK = {")
    for season in SEASONS:
        entry = broadleaf.get(season)
        if entry is None:
            lines.append(f"  {season}: null,")
            continue
        lines.append(f"  {season}: {{")
        lines.append(f"    file: '{entry['file']}',")
        lines.append(f"    size: [{entry['size'][0]}, {entry['size'][1]}] as const,")
        lines.append("    columnBboxes: [")
        for box in entry["columnBboxes"]:
            if box is None:
                lines.append("      null,")
            else:
                lines.append(
                    f"      {{ x0: {box['x0']}, y0: {box['y0']}, x1: {box['x1']}, y1: {box['y1']} }},"
                )
        lines.append("    ],")
        lines.append("  },")
    lines.append("} as const")
    lines.append("")
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", default=DEFAULT_ASSETS)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--debug", action="store_true", help="print raw components for trees_1 masks and winter bushes")
    args = parser.parse_args()

    if not os.path.isdir(args.assets):
        print(f"assets directory not found: {args.assets}\nRun materialize-assets.mjs first.", file=sys.stderr)
        sys.exit(1)

    if args.debug:
        for pattern in ("*_trees_1_a.*.png", "winter_bushes.*.png", "winter_grasses.*.png"):
            for path in sorted(glob.glob(os.path.join(args.assets, pattern))):
                mask = load_mask(path)
                width, height = mask.size
                comps = components(mask)
                print(f"== {os.path.basename(path)} {width}x{height} comps={len(comps)}")
                for c in sorted(comps, key=lambda item: item["x0"]):
                    cw = c["x1"] - c["x0"]
                    ch = c["y1"] - c["y0"]
                    print(
                        f"   x{c['x0']:>4}..{c['x1']:<4} y{c['y0']:>3}..{c['y1']:<3} "
                        f"w={cw:>4} h={ch:>3} area={c['area']}"
                    )
        sys.exit(0)

    print("measuring bushes ...")
    bushes = measure_columns(
        args.assets,
        "bushes",
        vertical_rows=2,
        ground_row_only=True,
    )
    print("measuring grass sprites ...")
    grass = measure_columns(args.assets, "grasses", season_files=GRASS_FILE_SEASONS)
    print("measuring conifer cards ...")
    conifer = measure_conifer_cards(args.assets)
    print("checking broadleaf cards ...")
    broadleaf = measure_broadleaf_checks(args.assets)

    write_typescript(args.out, bushes, grass, conifer, broadleaf)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
