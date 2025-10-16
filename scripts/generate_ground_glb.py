#!/usr/bin/env python3
"""Generate a textured ground plane GLB asset for the Harmony preset library using pygltflib."""

from __future__ import annotations

import base64
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from pygltflib import (
    GLTF2,
    Accessor,
    Asset,
    Buffer,
    BufferView,
    Image as GLTFImage,
    Material,
    Mesh,
    Node,
    Primitive,
    PbrMetallicRoughness,
    Sampler,
    Scene,
    Texture,
    TextureInfo,
)

ROOT = Path(__file__).resolve().parents[1]
TEXTURE_PATH = ROOT / "src" / "preset" / "images" / "textures" / "grass.png"
OUTPUT_PATH = ROOT / "src" / "preset" / "models" / "ground.glb"

PLANE_SIZE_METERS = 400.0  # length and width
TEXTURE_TILE_COUNT = 10.0  # how many times to repeat the texture across each axis


def ensure_paths() -> None:
    if not TEXTURE_PATH.is_file():
        raise FileNotFoundError(f"Grass texture not found: {TEXTURE_PATH}")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)


def create_ground_glb() -> None:
    """Create a ground plane GLB with embedded grass texture."""
    
    # Define vertices for a plane (400m x 400m)
    half_extent = PLANE_SIZE_METERS / 2.0
    vertices = np.array([
        [-half_extent, 0.0, -half_extent],
        [half_extent, 0.0, -half_extent],
        [half_extent, 0.0, half_extent],
        [-half_extent, 0.0, half_extent],
    ], dtype=np.float32)
    
    # Define normals (all pointing up)
    normals = np.array([
        [0.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
    ], dtype=np.float32)
    
    # Define UV coordinates with tiling
    # Note: Using correct winding order for proper texture mapping
    uvs = np.array([
        [0.0, TEXTURE_TILE_COUNT],
        [TEXTURE_TILE_COUNT, TEXTURE_TILE_COUNT],
        [TEXTURE_TILE_COUNT, 0.0],
        [0.0, 0.0],
    ], dtype=np.float32)
    
    # Define indices (two triangles, counter-clockwise winding)
    indices = np.array([0, 1, 2, 0, 2, 3], dtype=np.uint16)
    
    # Load and convert texture to PNG bytes
    image = Image.open(TEXTURE_PATH).convert("RGBA")
    from io import BytesIO
    img_buffer = BytesIO()
    image.save(img_buffer, format="PNG")
    texture_bytes = img_buffer.getvalue()
    
    # Create binary data buffer
    vertices_bytes = vertices.tobytes()
    normals_bytes = normals.tobytes()
    uvs_bytes = uvs.tobytes()
    indices_bytes = indices.tobytes()
    
    # Combine all binary data
    binary_data = vertices_bytes + normals_bytes + uvs_bytes + indices_bytes + texture_bytes
    
    # Calculate offsets
    vertices_offset = 0
    normals_offset = len(vertices_bytes)
    uvs_offset = normals_offset + len(normals_bytes)
    indices_offset = uvs_offset + len(uvs_bytes)
    texture_offset = indices_offset + len(indices_bytes)
    
    # Create GLTF object
    gltf = GLTF2()
    
    # Asset metadata
    gltf.asset = Asset(version="2.0", generator="Harmony Ground Generator")
    
    # Buffer
    gltf.buffers = [Buffer(byteLength=len(binary_data))]
    
    # Buffer Views
    gltf.bufferViews = [
        BufferView(buffer=0, byteOffset=vertices_offset, byteLength=len(vertices_bytes), target=34962),  # ARRAY_BUFFER
        BufferView(buffer=0, byteOffset=normals_offset, byteLength=len(normals_bytes), target=34962),
        BufferView(buffer=0, byteOffset=uvs_offset, byteLength=len(uvs_bytes), target=34962),
        BufferView(buffer=0, byteOffset=indices_offset, byteLength=len(indices_bytes), target=34963),  # ELEMENT_ARRAY_BUFFER
        BufferView(buffer=0, byteOffset=texture_offset, byteLength=len(texture_bytes)),  # Image data
    ]
    
    # Accessors
    gltf.accessors = [
        # Vertices
        Accessor(
            bufferView=0,
            byteOffset=0,
            componentType=5126,  # FLOAT
            count=len(vertices),
            type="VEC3",
            min=vertices.min(axis=0).tolist(),
            max=vertices.max(axis=0).tolist(),
        ),
        # Normals
        Accessor(
            bufferView=1,
            byteOffset=0,
            componentType=5126,  # FLOAT
            count=len(normals),
            type="VEC3",
        ),
        # UVs
        Accessor(
            bufferView=2,
            byteOffset=0,
            componentType=5126,  # FLOAT
            count=len(uvs),
            type="VEC2",
        ),
        # Indices
        Accessor(
            bufferView=3,
            byteOffset=0,
            componentType=5123,  # UNSIGNED_SHORT
            count=len(indices),
            type="SCALAR",
        ),
    ]
    
    # Image
    gltf.images = [GLTFImage(bufferView=4, mimeType="image/png")]
    
    # Sampler with wrapping mode for tiling
    gltf.samplers = [Sampler(
        magFilter=9729,  # LINEAR
        minFilter=9987,  # LINEAR_MIPMAP_LINEAR
        wrapS=10497,     # REPEAT
        wrapT=10497,     # REPEAT
    )]
    
    # Texture
    gltf.textures = [Texture(sampler=0, source=0)]
    
    # Material with texture
    gltf.materials = [Material(
        name="GrassMaterial",
        pbrMetallicRoughness=PbrMetallicRoughness(
            baseColorTexture=TextureInfo(index=0, texCoord=0),
            baseColorFactor=[1.0, 1.0, 1.0, 1.0],  # White to show texture as-is
            metallicFactor=0.0,
            roughnessFactor=1.0,
        ),
        doubleSided=True,  # Make it visible from both sides
        alphaMode="OPAQUE",
    )]
    
    # Mesh
    gltf.meshes = [Mesh(
        name="GroundPlane",
        primitives=[Primitive(
            attributes={"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
            indices=3,
            material=0,
        )]
    )]
    
    # Node
    gltf.nodes = [Node(mesh=0)]
    
    # Scene
    gltf.scenes = [Scene(nodes=[0])]
    gltf.scene = 0
    
    # Set binary data
    gltf.set_binary_blob(binary_data)
    
    # Save to file
    gltf.save(str(OUTPUT_PATH))


if __name__ == "__main__":
    try:
        ensure_paths()
        create_ground_glb()
        print(f"Ground GLB exported to {OUTPUT_PATH}")
    except Exception as exc:  # pragma: no cover - tooling guard
        print(f"Failed to generate GLB: {exc}", file=sys.stderr)
        raise
