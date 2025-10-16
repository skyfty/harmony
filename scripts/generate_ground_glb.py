#!/usr/bin/env python3
"""Generate a textured ground plane GLB asset for the Harmony preset library."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TEXTURE_PATH = ROOT / "src" / "preset" / "images" / "textures" / "grass.png"
OUTPUT_PATH = ROOT / "src" / "preset" / "models" / "ground.glb"

PLANE_SIZE_METERS = 400.0  # length and width
TEXTURE_TILE_COUNT = 10.0  # how many times to repeat the texture across each axis


def ensure_paths() -> None:
    if not TEXTURE_PATH.is_file():
        raise FileNotFoundError(f"Grass texture not found: {TEXTURE_PATH}")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)


def build_ground_mesh() -> trimesh.Trimesh:
    half_extent = PLANE_SIZE_METERS / 2.0
    vertices = np.array(
        [
            [-half_extent, 0.0, -half_extent],
            [half_extent, 0.0, -half_extent],
            [half_extent, 0.0, half_extent],
            [-half_extent, 0.0, half_extent],
        ],
        dtype=np.float32,
    )

    faces = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int32)

    uv = np.array(
        [
            [0.0, 0.0],
            [TEXTURE_TILE_COUNT, 0.0],
            [TEXTURE_TILE_COUNT, TEXTURE_TILE_COUNT],
            [0.0, TEXTURE_TILE_COUNT],
        ],
        dtype=np.float32,
    )

    image = Image.open(TEXTURE_PATH).convert("RGBA")
    material = trimesh.visual.texture.SimpleMaterial(
        image=image,
        image_name="grass.png",
    )

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False, validate=False)
    mesh.visual = trimesh.visual.texture.TextureVisuals(
        uv=uv,
        image=image,
        material=material,
    )
    mesh.metadata["title"] = "Harmony Ground Plane"
    mesh.metadata["description"] = (
        f"Textured ground plane ({PLANE_SIZE_METERS}m x {PLANE_SIZE_METERS}m) with tiled grass texture"
    )
    return mesh


def export_glb(mesh: trimesh.Trimesh) -> None:
    scene = trimesh.Scene(mesh)
    scene.export(OUTPUT_PATH, file_type="glb")


if __name__ == "__main__":
    try:
        ensure_paths()
        ground_mesh = build_ground_mesh()
        export_glb(ground_mesh)
        print(f"Ground GLB exported to {OUTPUT_PATH}")
    except Exception as exc:  # pragma: no cover - tooling guard
        print(f"Failed to generate GLB: {exc}", file=sys.stderr)
        raise
