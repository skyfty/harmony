import { V as Vector3, Q as Quaternion, E as Euler } from "./assets/three-D-dRXF5A.js";
function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return value < min ? min : value > max ? max : value;
}
function clamp01(value) {
  return clamp(value, 0, 1);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function hashUint32(seed, x, y) {
  let h = seed >>> 0 ^ Math.imul(x | 0, 668265261);
  h = Math.imul(h ^ (y | 0), 374761393);
  h = Math.imul(h ^ h >>> 15, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}
function hashUnit(seed, x, y) {
  return hashUint32(seed, x, y) / 4294967296;
}
function fade(t) {
  return t * t * (3 - 2 * t);
}
function valueNoise2(seed, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const v00 = hashUnit(seed, xi, yi);
  const v10 = hashUnit(seed, xi + 1, yi);
  const v01 = hashUnit(seed, xi, yi + 1);
  const v11 = hashUnit(seed, xi + 1, yi + 1);
  const u = fade(xf);
  const v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}
function fbm2(seed, x, y, octaves = 3, lacunarity = 2, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  const count = Math.max(1, Math.round(octaves));
  for (let i = 0; i < count; i += 1) {
    sum += amplitude * valueNoise2(seed + i * 7919, x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
function wrapAngle(angle) {
  const twoPi = Math.PI * 2;
  let wrapped = angle % twoPi;
  if (wrapped > Math.PI) {
    wrapped -= twoPi;
  } else if (wrapped < -Math.PI) {
    wrapped += twoPi;
  }
  return wrapped;
}
function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}
const NORMAL_EPSILON = 1.5;
function createHeightfield(options) {
  const seed = options.seed >>> 0;
  const worldSize = options.worldSize;
  const halfSize = worldSize * 0.5;
  const baseAmplitude = options.baseAmplitude ?? 30;
  const detailAmplitude = options.detailAmplitude ?? 10;
  const baseWavelength = options.baseWavelength ?? 520;
  const detailWavelength = options.detailWavelength ?? 170;
  const waterLevel = options.waterLevel ?? -12;
  const detailSeed = (seed ^ 2654435769) >>> 0;
  const midSeed = (seed ^ 668265263) >>> 0;
  const midAmplitude = 8;
  const midWavelength = 260;
  const sampleHeight = (x, z) => {
    const base = (fbm2(seed, x / baseWavelength, z / baseWavelength, 4) - 0.5) * 2;
    const mid = (fbm2(midSeed, x / midWavelength, z / midWavelength, 2) - 0.5) * 2;
    const detail = (fbm2(detailSeed, x / detailWavelength, z / detailWavelength, 2) - 0.5) * 2;
    return base * baseAmplitude + mid * midAmplitude + detail * detailAmplitude;
  };
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  const probeStep = worldSize / 64;
  for (let z = -halfSize; z <= halfSize + 1e-6; z += probeStep) {
    for (let x = -halfSize; x <= halfSize + 1e-6; x += probeStep) {
      const height = sampleHeight(x, z);
      if (height < minHeight) minHeight = height;
      if (height > maxHeight) maxHeight = height;
    }
  }
  return {
    worldSize,
    halfSize,
    waterLevel,
    minHeight,
    maxHeight,
    inBounds(x, z, margin = 0) {
      return x >= -halfSize + margin && x <= halfSize - margin && z >= -halfSize + margin && z <= halfSize - margin;
    },
    sampleHeight,
    sampleNormal(x, z, target) {
      const dx = (sampleHeight(x + NORMAL_EPSILON, z) - sampleHeight(x - NORMAL_EPSILON, z)) / (2 * NORMAL_EPSILON);
      const dz = (sampleHeight(x, z + NORMAL_EPSILON) - sampleHeight(x, z - NORMAL_EPSILON)) / (2 * NORMAL_EPSILON);
      const out = target ?? new Vector3();
      return out.set(-dx, 1, -dz).normalize();
    },
    sampleSlope(x, z) {
      const normal = this.sampleNormal(x, z);
      return Math.max(0, 1 - normal.y);
    }
  };
}
const CELL_SIZE = 32;
function createRoadProfile(nodes, options) {
  const halfWidth = options.halfWidth;
  const shoulderWidth = options.shoulderWidth;
  const flattenBand = options.flattenBand;
  const roadDrop = options.roadDrop ?? 0.05;
  const maxQueryDistance = options.maxQueryDistance ?? 72;
  const cumulative = new Float32Array(nodes.length);
  for (let i = 1; i < nodes.length; i += 1) {
    const previous = nodes[i - 1];
    const current = nodes[i];
    cumulative[i] = cumulative[i - 1] + Math.hypot(current.x - previous.x, current.z - previous.z);
  }
  const length = nodes.length ? cumulative[nodes.length - 1] : 0;
  const segmentCount = Math.max(0, nodes.length - 1);
  const cells = /* @__PURE__ */ new Map();
  const keyFor = (cellX, cellZ) => (cellX + 512) * 1024 + (cellZ + 512);
  for (let i = 0; i < segmentCount; i += 1) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const minX = Math.min(from.x, to.x) - maxQueryDistance;
    const maxX = Math.max(from.x, to.x) + maxQueryDistance;
    const minZ = Math.min(from.z, to.z) - maxQueryDistance;
    const maxZ = Math.max(from.z, to.z) + maxQueryDistance;
    const cellX0 = Math.floor(minX / CELL_SIZE);
    const cellX1 = Math.floor(maxX / CELL_SIZE);
    const cellZ0 = Math.floor(minZ / CELL_SIZE);
    const cellZ1 = Math.floor(maxZ / CELL_SIZE);
    for (let cellX = cellX0; cellX <= cellX1; cellX += 1) {
      for (let cellZ = cellZ0; cellZ <= cellZ1; cellZ += 1) {
        const key = keyFor(cellX, cellZ);
        const list = cells.get(key);
        if (list) {
          list.push(i);
        } else {
          cells.set(key, [i]);
        }
      }
    }
  }
  const closestPoint = (x, z) => {
    const key = keyFor(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE));
    const list = cells.get(key);
    if (!list || !list.length) {
      return null;
    }
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    let bestHeight = 0;
    for (const index of list) {
      const from = nodes[index];
      const to = nodes[index + 1];
      const segX = to.x - from.x;
      const segZ = to.z - from.z;
      const segLengthSq = segX * segX + segZ * segZ;
      if (segLengthSq <= 1e-9) {
        continue;
      }
      const t = clamp(((x - from.x) * segX + (z - from.z) * segZ) / segLengthSq, 0, 1);
      const px = from.x + segX * t;
      const pz = from.z + segZ * t;
      const dx = x - px;
      const dz = z - pz;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestHeight = lerp(from.y, to.y, t);
      }
    }
    if (!Number.isFinite(bestDistanceSq)) {
      return null;
    }
    const distance = Math.sqrt(bestDistanceSq);
    if (distance > maxQueryDistance) {
      return null;
    }
    return { distance, height: bestHeight };
  };
  const sampleAt = (distance) => {
    const clampedDistance = clamp(distance, 0, length);
    let low = 0;
    let high = nodes.length - 1;
    while (low < high - 1) {
      const mid = low + high >> 1;
      if (cumulative[mid] <= clampedDistance) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const from = nodes[low];
    const to = nodes[Math.min(nodes.length - 1, low + 1)];
    const segmentLength = Math.max(1e-6, cumulative[high] - cumulative[low]);
    const t = (clampedDistance - cumulative[low]) / segmentLength;
    return {
      x: lerp(from.x, to.x, t),
      z: lerp(from.z, to.z, t),
      y: lerp(from.y, to.y, t),
      heading: from.heading
    };
  };
  return {
    nodes,
    length,
    halfWidth,
    shoulderWidth,
    flattenBand,
    roadDrop,
    maxQueryDistance,
    sampleAt,
    closestPoint,
    distanceTo(x, z) {
      const closest = closestPoint(x, z);
      return closest ? closest.distance : maxQueryDistance;
    },
    roadProximityAt(x, z) {
      const closest = closestPoint(x, z);
      return (closest ? closest.distance : maxQueryDistance) - halfWidth;
    }
  };
}
function bakeTerrainHeight(field, profile, x, z, baseHeight) {
  const height = baseHeight ?? field.sampleHeight(x, z);
  const closest = profile.closestPoint(x, z);
  if (!closest) {
    return { height, roadProx: profile.maxQueryDistance - profile.halfWidth };
  }
  const inner = profile.halfWidth + profile.shoulderWidth;
  const weight = 1 - smoothstep(inner, inner + profile.flattenBand, closest.distance);
  const roadProx = closest.distance - profile.halfWidth;
  if (weight <= 1e-3) {
    return { height, roadProx };
  }
  return {
    height: lerp(height, closest.height - profile.roadDrop, weight),
    roadProx
  };
}
const NEAR_BROADLEAF_REGIONS = [
  { u0: 0, v0: 0.25, u1: 0.25, v1: 1, aspect: 1.3333, heightScale: 1 },
  { u0: 0.25, v0: 0.25, u1: 0.5, v1: 1, aspect: 1.3333, heightScale: 1 },
  { u0: 0.5, v0: 0.25, u1: 0.75, v1: 1, aspect: 1.3333, heightScale: 1 },
  { u0: 0.75, v0: 0.25, u1: 1, v1: 1, aspect: 1.3333, heightScale: 1 }
];
const NEAR_CONIFER_REGIONS = [
  { u0: 0.38916, v0: 0.08789, u1: 0.49463, v1: 0.97852, aspect: 0.4737, heightScale: 0.929 },
  { u0: 0.46533, v0: 0, u1: 0.57959, v1: 0.92773, aspect: 0.4926, heightScale: 0.967 },
  { u0: 0.59912, v0: 0, u1: 0.75928, v1: 0.95898, aspect: 0.668, heightScale: 1 },
  { u0: 0.77686, v0: 0.10352, u1: 0.98682, v1: 0.92383, aspect: 1.0238, heightScale: 0.855 }
];
const FLOWER_REGIONS = [
  { u0: 879e-5, v0: 0.01562, u1: 0.10254, v1: 0.39062, aspect: 1, heightScale: 0.375 },
  { u0: 0.14648, v0: 0.67188, u1: 0.22266, v1: 0.89453, aspect: 1.3684, heightScale: 0.223 },
  { u0: 0.26074, v0: 0.05078, u1: 0.34277, v1: 0.40234, aspect: 0.9333, heightScale: 0.352 },
  { u0: 0.52734, v0: 0.13281, u1: 0.58887, v1: 0.42578, aspect: 0.84, heightScale: 0.293 },
  { u0: 0.74707, v0: 0, u1: 0.99902, v1: 1, aspect: 1.0078, heightScale: 1 }
];
const TALL_GRASS_REGIONS = [
  { u0: 0.04102, v0: 0, u1: 0.21289, v1: 0.5, aspect: 1.375, heightScale: 0.538 },
  { u0: 0.24805, v0: 0, u1: 0.49805, v1: 0.53125, aspect: 1.8824, heightScale: 0.571 },
  { u0: 0.5, v0: 0, u1: 0.75, v1: 0.92969, aspect: 1.0756, heightScale: 1 },
  { u0: 0.75977, v0: 0, u1: 0.99023, v1: 0.51562, aspect: 1.7879, heightScale: 0.555 }
];
const BARRIER_RAIL_REGIONS = [
  { u0: 0, v0: 0.31641, u1: 1, v1: 0.40234, aspect: 22.2609, heightScale: 1 },
  { u0: 0, v0: 0.14063, u1: 1, v1: 0.22656, aspect: 22.2609, heightScale: 1 }
];
const TREE_FAR_VARIANTS = 64;
const GRASS_VARIANTS = 4;
const BUSH_VARIANTS = 8;
const NEAR_TREE_VARIANTS = {
  0: NEAR_BROADLEAF_REGIONS.length,
  1: NEAR_CONIFER_REGIONS.length
};
const TREE_CELL_SIZE = 10;
const TREE_SLOPE_LIMIT = 0.2;
const TREE_ROAD_CLEARANCE = 2;
const GRASS_STEP_ALONG = 1;
const GRASS_STEP_ACROSS = 1;
const BUSH_STEP_ALONG = 2;
const BUSH_STEP_ACROSS = 0.9;
const MAX_TREES = 12e4;
const MAX_GRASS = 6e4;
const MAX_BUSHES = 2e4;
const MAX_FLOWERS = 12e3;
const MAX_TALL_GRASS = 2e4;
function createTreeDensityField(seed, worldSize) {
  const densitySeed = (seed ^ 1374496523) >>> 0;
  const wavelength = worldSize * 0.28;
  const sampleUnit = (x, z) => {
    const value = fbm2(densitySeed, x / wavelength, z / wavelength, 3, 2.05, 0.52);
    return clamp01(value);
  };
  return {
    sampleUnit,
    classAt(x, z) {
      const value = sampleUnit(x, z);
      if (value >= 0.78) return 3;
      if (value >= 0.64) return 2;
      if (value >= 0.5) return 1;
      return 0;
    }
  };
}
function heightFactor(height, waterLevel) {
  const aboveWater = height - waterLevel;
  if (aboveWater <= 0) {
    return 0;
  }
  return aboveWater >= 2 ? 1 : clamp01(aboveWater / 2);
}
function slopeFactor(slop) {
  if (slop > 0.75) {
    return 0;
  }
  return 1 - clamp01(slop / 0.6) * 0.85;
}
function computePlacements(field, profile, density, settings) {
  return {
    trees: computeTreePlacements(field, profile, density, settings),
    grass: computeCorridorPlacements(field, profile, settings, "grass"),
    bushes: computeCorridorPlacements(field, profile, settings, "bush"),
    flowers: computeLayerPlacements(field, profile, settings, "flower"),
    tallGrass: computeLayerPlacements(field, profile, settings, "tallGrass")
  };
}
function computeTreePlacements(field, profile, density, settings) {
  const seed = settings.seed >>> 0;
  const cells = Math.floor(settings.worldSize / TREE_CELL_SIZE);
  const halfCells = cells / 2;
  const trees = [];
  const clearance = profile.halfWidth + profile.shoulderWidth + TREE_ROAD_CLEARANCE;
  for (let cellZ = 0; cellZ < cells && trees.length < MAX_TREES; cellZ += 1) {
    for (let cellX = 0; cellX < cells && trees.length < MAX_TREES; cellX += 1) {
      const cellKey = (cellX + 2048) * 4096 + (cellZ + 2048);
      const centerX = (cellX - halfCells + 0.5) * TREE_CELL_SIZE;
      const centerZ = (cellZ - halfCells + 0.5) * TREE_CELL_SIZE;
      const densityClass = density.classAt(centerX, centerZ);
      if (densityClass === 0) {
        continue;
      }
      const unitDensity = densityClass / 3;
      const baseCount = Math.ceil(1.4 * (densityClass + hashUnit(seed, cellKey, 101)));
      const count = Math.round(baseCount * settings.treeDensity);
      for (let i = 0; i < count; i += 1) {
        const jitterX = 0.05 + 0.9 * hashUnit(seed, cellKey, i * 8 + 1);
        const jitterZ = 0.05 + 0.9 * hashUnit(seed, cellKey, i * 8 + 2);
        const x = (cellX - halfCells + jitterX) * TREE_CELL_SIZE;
        const z = (cellZ - halfCells + jitterZ) * TREE_CELL_SIZE;
        if (!field.inBounds(x, z, 8)) {
          continue;
        }
        const y = bakeTerrainHeight(field, profile, x, z).height;
        if (y < field.waterLevel + 2) {
          continue;
        }
        if (field.sampleSlope(x, z) > TREE_SLOPE_LIMIT) {
          continue;
        }
        if (profile.distanceTo(x, z) < clearance) {
          continue;
        }
        const baseScale = 1 + 0.15 * (3 * unitDensity - 1);
        const scaleJitter = 1 + (hashUnit(seed, cellKey, i * 8 + 3) - 0.5) * 0.4;
        const species = hashUnit(seed, cellKey, i * 8 + 4) < 0.5 ? 0 : 1;
        const nearVariants = NEAR_TREE_VARIANTS[species];
        trees.push({
          x,
          z,
          y,
          rotation: hashUnit(seed, cellKey, i * 8 + 5) * Math.PI * 2,
          scale: baseScale * scaleJitter * settings.treeSize,
          variantNear: Math.min(nearVariants - 1, Math.floor(hashUnit(seed, cellKey, i * 8 + 6) * nearVariants)),
          variantFar: Math.min(TREE_FAR_VARIANTS - 1, Math.floor(hashUnit(seed, cellKey, i * 8 + 7) * TREE_FAR_VARIANTS)),
          species
        });
      }
    }
  }
  return trees;
}
function computeCorridorPlacements(field, profile, settings, kind) {
  const seed = (settings.seed ^ (kind === "grass" ? 39443 : 17601)) >>> 0;
  const out = [];
  const cap = kind === "grass" ? MAX_GRASS : MAX_BUSHES;
  const maxDistance = kind === "grass" ? settings.grassCorridor : 4;
  const alongStep = kind === "grass" ? GRASS_STEP_ALONG : BUSH_STEP_ALONG;
  const acrossStep = kind === "grass" ? GRASS_STEP_ACROSS : BUSH_STEP_ACROSS;
  const lateralStart = kind === "grass" ? 0.45 : 0.5;
  const lateralEnd = kind === "grass" ? settings.grassCorridor : maxDistance;
  const lateralCount = Math.max(1, Math.ceil((lateralEnd - lateralStart) / acrossStep));
  const alongCount = Math.max(1, Math.ceil(profile.length / alongStep));
  for (let along = 0; along < alongCount && out.length < cap; along += 1) {
    const sample = profile.sampleAt(along * alongStep);
    const dirX = Math.cos(sample.heading);
    const dirZ = Math.sin(sample.heading);
    const perpX = -dirZ;
    const perpZ = dirX;
    for (let lateralIndex = 0; lateralIndex < lateralCount; lateralIndex += 1) {
      const baseLateral = profile.halfWidth + lateralStart + lateralIndex * acrossStep;
      for (const side of [1, -1]) {
        const keyB = (side > 0 ? 1 : 0) * 4096 + lateralIndex;
        const jitterAlong = (hashUnit(seed, along, keyB * 8 + 1) - 0.5) * alongStep;
        const jitterLateral = (hashUnit(seed, along, keyB * 8 + 2) - 0.5) * acrossStep * 0.8;
        const lateral = baseLateral + jitterLateral;
        const x = sample.x + dirX * jitterAlong + perpX * side * lateral;
        const z = sample.z + dirZ * jitterAlong + perpZ * side * lateral;
        if (!field.inBounds(x, z, 4)) {
          continue;
        }
        const distance = profile.distanceTo(x, z);
        if (kind === "grass" && (distance < profile.halfWidth + 0.35 || distance > profile.halfWidth + settings.grassCorridor)) {
          continue;
        }
        if (kind === "bush" && (distance < profile.halfWidth + 0.4 || distance > profile.halfWidth + 4)) {
          continue;
        }
        const y = bakeTerrainHeight(field, profile, x, z).height;
        if (y < field.waterLevel + 0.5) {
          continue;
        }
        const slope = field.sampleSlope(x, z);
        if (slope > 0.75) {
          continue;
        }
        let chance;
        if (kind === "grass") {
          const corridor = settings.grassCorridor;
          const corridorFalloff = 1 - smoothstep(
            profile.halfWidth + corridor * 0.55,
            profile.halfWidth + corridor,
            distance
          );
          chance = corridorFalloff * slopeFactor(slope) * heightFactor(y, field.waterLevel) * settings.grassDensity * 0.75;
        } else {
          const band = smoothstep(profile.halfWidth + 0.4, profile.halfWidth + 1.2, distance) * (1 - smoothstep(profile.halfWidth + 2.5, profile.halfWidth + 4, distance));
          chance = band * slopeFactor(slope) * heightFactor(y, field.waterLevel) * settings.bushDensity * 0.35;
        }
        if (hashUnit(seed, along, keyB * 8 + 3) >= chance) {
          continue;
        }
        let sink = 0;
        if (kind === "grass") {
          const edge = profile.halfWidth + 1.2;
          sink = distance < edge ? edge - distance : distance / 20;
        }
        const variantCount = kind === "grass" ? GRASS_VARIANTS : BUSH_VARIANTS;
        out.push({
          x,
          z,
          y: y - sink,
          rotation: hashUnit(seed, along, keyB * 8 + 4) * Math.PI * 2,
          scale: kind === "grass" ? 0.7 + hashUnit(seed, along, keyB * 8 + 5) * 0.6 : 0.7 + hashUnit(seed, along, keyB * 8 + 5) * 0.7,
          variant: Math.min(variantCount - 1, Math.floor(hashUnit(seed, along, keyB * 8 + 6) * variantCount))
        });
      }
    }
  }
  return out;
}
function computeLayerPlacements(field, profile, settings, kind) {
  const isFlower = kind === "flower";
  const seed = (settings.seed ^ (isFlower ? 19755 : 31313)) >>> 0;
  const alongStep = isFlower ? 1.5 : 1.2;
  const acrossStep = isFlower ? 0.9 : 1.3;
  const lateralStart = isFlower ? 0.5 : 1;
  const lateralEnd = isFlower ? 6 : Math.max(6, Math.min(20, settings.grassCorridor));
  const lateralCount = Math.max(1, Math.ceil((lateralEnd - lateralStart) / acrossStep));
  const alongCount = Math.max(1, Math.ceil(profile.length / alongStep));
  const cap = isFlower ? MAX_FLOWERS : MAX_TALL_GRASS;
  const density = isFlower ? settings.flowerDensity : settings.tallGrassDensity;
  const variantCount = isFlower ? FLOWER_REGIONS.length : TALL_GRASS_REGIONS.length;
  const out = [];
  for (let along = 0; along < alongCount && out.length < cap; along += 1) {
    const sample = profile.sampleAt(along * alongStep);
    const dirX = Math.cos(sample.heading);
    const dirZ = Math.sin(sample.heading);
    const perpX = -dirZ;
    const perpZ = dirX;
    for (let lateralIndex = 0; lateralIndex < lateralCount; lateralIndex += 1) {
      const baseLateral = profile.halfWidth + lateralStart + lateralIndex * acrossStep;
      for (const side of [1, -1]) {
        const keyB = (side > 0 ? 1 : 0) * 4096 + lateralIndex;
        const jitterAlong = (hashUnit(seed, along, keyB * 8 + 1) - 0.5) * alongStep;
        const jitterLateral = (hashUnit(seed, along, keyB * 8 + 2) - 0.5) * acrossStep * 0.8;
        const lateral = baseLateral + jitterLateral;
        const x = sample.x + dirX * jitterAlong + perpX * side * lateral;
        const z = sample.z + dirZ * jitterAlong + perpZ * side * lateral;
        if (!field.inBounds(x, z, 4)) {
          continue;
        }
        const distance = profile.distanceTo(x, z);
        if (distance < profile.halfWidth + lateralStart - 0.2 || distance > profile.halfWidth + lateralEnd + 0.6) {
          continue;
        }
        const y = bakeTerrainHeight(field, profile, x, z).height;
        if (y < field.waterLevel + 0.5) {
          continue;
        }
        const slope = field.sampleSlope(x, z);
        if (slope > 0.7) {
          continue;
        }
        const falloff = isFlower ? 1 - smoothstep(profile.halfWidth + 3, profile.halfWidth + lateralEnd, distance) : 1 - smoothstep(profile.halfWidth + lateralEnd * 0.55, profile.halfWidth + lateralEnd, distance);
        const chance = falloff * slopeFactor(slope) * heightFactor(y, field.waterLevel) * density * (isFlower ? 0.5 : 0.55);
        if (hashUnit(seed, along, keyB * 8 + 3) >= chance) {
          continue;
        }
        out.push({
          x,
          z,
          y: y - 0.12,
          rotation: hashUnit(seed, along, keyB * 8 + 4) * Math.PI * 2,
          scale: isFlower ? 0.8 + hashUnit(seed, along, keyB * 8 + 5) * 0.5 : 0.7 + hashUnit(seed, along, keyB * 8 + 5) * 0.6,
          variant: Math.min(variantCount - 1, Math.floor(hashUnit(seed, along, keyB * 8 + 6) * variantCount))
        });
      }
    }
  }
  return out;
}
const MAX_STEPS = 4096;
function resolveSeedHeadingRad(seed) {
  return hashUnit(seed >>> 0, 17, 29) * Math.PI * 2;
}
function resolveRoadStart(field, preferredX, preferredZ) {
  const centerX = clamp(preferredX, -field.halfSize, field.halfSize);
  const centerZ = clamp(preferredZ, -field.halfSize, field.halfSize);
  for (let ring = 0; ring <= 16; ring += 1) {
    const radius = ring * 8;
    const steps = ring === 0 ? 1 : 12;
    for (let step = 0; step < steps; step += 1) {
      const angle = step / steps * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      if (!field.inBounds(x, z, 8)) {
        continue;
      }
      return { x, z, y: field.sampleHeight(x, z) };
    }
  }
  return null;
}
function traceRoadPath(field, options) {
  const start = resolveRoadStart(field, options.startX, options.startZ);
  if (!start) {
    return { nodes: [], length: 0, complete: false, failureReason: "start-outside-terrain", rescueTurns: 0 };
  }
  let x = start.x;
  let z = start.z;
  let y = start.y;
  let heading = wrapAngle(options.headingRad);
  const nodes = [{ x, z, y, heading }];
  let length = 0;
  let complete = false;
  let failureReason = null;
  let rescueTurns = 0;
  let prevT = 0;
  const probeHeight = (angle, distance) => {
    const px = x + Math.cos(angle) * distance;
    const pz = z + Math.sin(angle) * distance;
    return field.sampleHeight(px, pz);
  };
  const evaluateStep = (candidateHeading) => {
    const nx = x + Math.cos(candidateHeading) * options.stepLength;
    const nz = z + Math.sin(candidateHeading) * options.stepLength;
    const ny = field.sampleHeight(nx, nz);
    return { x: nx, z: nz, y: ny, slope: Math.abs(ny - y) / options.stepLength };
  };
  for (let stepIndex = 0; stepIndex < MAX_STEPS; stepIndex += 1) {
    const straightX = x + Math.cos(heading) * options.stepLength;
    const straightZ = z + Math.sin(heading) * options.stepLength;
    if (!field.inBounds(straightX, straightZ, options.margin)) {
      complete = true;
      failureReason = "reached-terrain-boundary";
      break;
    }
    const feelAhead = probeHeight(heading, options.feelDistance);
    const feelLeft = probeHeight(heading - options.feelAngleRad, options.feelDistance);
    const feelRight = probeHeight(heading + options.feelAngleRad, options.feelDistance);
    const feelDif = (feelRight - feelLeft) / 2;
    const feelAvg = (feelLeft + feelRight) / 2;
    let bT = feelDif !== 0 ? (feelAvg - feelAhead) / feelDif : 0;
    bT = clamp(bT, -1, 1);
    const scale = options.feelDistance * options.slopeLimit;
    const gLeft = (feelLeft - feelAhead) / scale;
    const gRight = (feelRight - feelAhead) / scale;
    const gLat = (feelLeft - feelRight) / scale;
    const gLon = (feelAvg - feelAhead) / scale;
    let maxT = 1;
    let minT = -1;
    if (Math.abs(gLeft) > 1 || Math.abs(gRight) > 1) {
      const gDif = (gLeft - gRight) / 2;
      const gAvg = (gLeft + gRight) / 2;
      const bothUp = gLeft > 1 && gRight > 1;
      const bothDown = gLeft < -1 && gRight < -1;
      const absDif = Math.max(1e-4, Math.abs(gDif));
      if (bothUp || bothDown) {
        if (Math.abs(gLeft) < Math.abs(gRight)) {
          maxT = 1;
          minT = 1;
        } else {
          maxT = -1;
          minT = -1;
        }
      } else {
        if (Math.abs(gLeft) > 1) {
          maxT = gLeft < 0 ? (1 + gAvg) / absDif : (1 - gAvg) / absDif;
        }
        if (Math.abs(gRight) > 1) {
          minT = gRight < 0 ? (1 + gAvg) / absDif : (1 - gAvg) / absDif;
          minT = -minT;
        }
      }
    }
    const gAvgAbs = (Math.abs(gLat) + Math.abs(gLon)) / 2;
    const maxDif = 0.5 + 0.5 * gAvgAbs;
    maxT *= 1.5;
    minT *= 1.5;
    if (maxT > 0) {
      maxT = Math.min(maxT, prevT + maxDif);
    }
    if (minT < 0) {
      minT = Math.max(minT, prevT - maxDif);
    }
    if (minT > maxT) {
      const mid = (minT + maxT) * 0.5;
      minT = mid;
      maxT = mid;
    }
    const t = clamp(bT, minT, maxT);
    let chosenHeading = wrapAngle(heading + t * options.maxTurnRad);
    let step = evaluateStep(chosenHeading);
    let rescued = false;
    if (step.slope > options.slopeLimit) {
      const maxLevels = Math.max(2, Math.floor(Math.PI * 0.5 / options.maxTurnRad));
      search: for (let level = 1; level <= maxLevels; level += 1) {
        for (const sign of [-1, 1]) {
          const candidateHeading = wrapAngle(heading + sign * level * options.maxTurnRad);
          const candidate = evaluateStep(candidateHeading);
          if (candidate.slope <= options.slopeLimit) {
            chosenHeading = candidateHeading;
            step = candidate;
            rescued = true;
            break search;
          }
        }
      }
    }
    if (step.slope > options.slopeLimit) {
      complete = false;
      failureReason = "blocked";
      break;
    }
    heading = chosenHeading;
    x = step.x;
    z = step.z;
    y = step.y;
    prevT = t;
    if (rescued) {
      rescueTurns += 1;
    }
    length += options.stepLength;
    nodes.push({ x, z, y, heading });
    if (options.maxLength != null && length >= options.maxLength) {
      complete = true;
      failureReason = "reached-length-limit";
      break;
    }
  }
  if (nodes.length >= MAX_STEPS) {
    complete = true;
    failureReason = "reached-step-limit";
  }
  if (nodes.length > 2) {
    const original = nodes.map((node) => node.y);
    for (let i = 1; i < nodes.length - 1; i += 1) {
      const smoothed = (original[i - 1] + original[i] * 2 + original[i + 1]) / 4;
      nodes[i].y = clamp(smoothed, original[i] - 0.75, original[i] + 0.75);
    }
  }
  return { nodes, length, complete, failureReason, rescueTurns };
}
const ALONG_STEP = 2;
const DEFAULT_SPACING = 8;
const DEFAULT_DROP = 1.2;
const PROBE_OUT = 12;
const PLACE_INSET = 0.25;
function computeBarrierSegments(field, profile, settings) {
  const seed = settings.seed >>> 0;
  const spacing = settings.spacing ?? DEFAULT_SPACING;
  const dropThreshold = settings.dropThreshold ?? DEFAULT_DROP;
  const probeLateral = profile.halfWidth + profile.shoulderWidth + PROBE_OUT;
  const placeLateral = profile.halfWidth + profile.shoulderWidth - PLACE_INSET;
  const lastPlaced = { 1: -Infinity, "-1": -Infinity };
  const out = [];
  for (let along = 0; along <= profile.length; along += ALONG_STEP) {
    const sample = profile.sampleAt(along);
    const dirX = Math.cos(sample.heading);
    const dirZ = Math.sin(sample.heading);
    const perpX = -dirZ;
    const perpZ = dirX;
    for (const side of [1, -1]) {
      if (along - lastPlaced[side] < spacing) {
        continue;
      }
      const probeX = sample.x + perpX * side * probeLateral;
      const probeZ = sample.z + perpZ * side * probeLateral;
      if (!field.inBounds(probeX, probeZ, 4)) {
        continue;
      }
      const placeX = sample.x + perpX * side * placeLateral;
      const placeZ = sample.z + perpZ * side * placeLateral;
      const placeHeight = bakeTerrainHeight(field, profile, placeX, placeZ).height;
      if (field.sampleHeight(placeX, placeZ) - field.sampleHeight(probeX, probeZ) < dropThreshold) {
        continue;
      }
      const gate = hashUnit(seed, Math.round(along), side > 0 ? 7 : 11);
      if (gate > settings.density) {
        continue;
      }
      out.push({
        x: placeX,
        z: placeZ,
        y: placeHeight - 0.02,
        rotation: -sample.heading,
        scale: 1,
        variant: Math.min(
          BARRIER_RAIL_REGIONS.length - 1,
          Math.floor(hashUnit(seed, Math.round(along), side > 0 ? 13 : 17) * BARRIER_RAIL_REGIONS.length)
        )
      });
      lastPlaced[side] = along;
    }
  }
  return out;
}
function runSelfChecks() {
  const results = [];
  const record = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.assert(ok, `[slowroads-lab self-check] ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const noiseA = fbm2(7, 1.25, 3.5, 3);
  const noiseB = fbm2(7, 1.25, 3.5, 3);
  const noiseC = fbm2(8, 1.25, 3.5, 3);
  record("noise determinism", noiseA === noiseB && noiseA !== noiseC);
  const worldSize = 640;
  const seed = 1234567;
  const field = createHeightfield({ seed, worldSize });
  const traceOptions = {
    startX: 0,
    startZ: 0,
    headingRad: 0.7,
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: degreesToRadians(32),
    slopeLimit: 0.55,
    maxTurnRad: degreesToRadians(4),
    maxLength: 480,
    margin: 24
  };
  const first = traceRoadPath(field, traceOptions);
  const second = traceRoadPath(field, traceOptions);
  record("road determinism", first.nodes.length === second.nodes.length && first.nodes.every((node, index) => node.x === second.nodes[index].x && node.z === second.nodes[index].z));
  record("road within bounds", first.nodes.every((node) => field.inBounds(node.x, node.z, traceOptions.margin - 1e-3)));
  let stepOk = true;
  let turnOk = true;
  for (let i = 1; i < first.nodes.length; i += 1) {
    const previous = first.nodes[i - 1];
    const current = first.nodes[i];
    const distance = Math.hypot(current.x - previous.x, current.z - previous.z);
    if (Math.abs(distance - traceOptions.stepLength) > 1e-3) {
      stepOk = false;
    }
    let delta = Math.abs(current.heading - previous.heading);
    if (delta > Math.PI) {
      delta = Math.PI * 2 - delta;
    }
    if (delta > Math.PI / 2 + 1e-6) {
      turnOk = false;
    }
  }
  record("road step length", stepOk);
  record("road turn bounded", turnOk);
  const profile = createRoadProfile(first.nodes, { halfWidth: 3.5, shoulderWidth: 2.5, flattenBand: 10 });
  const density = createTreeDensityField(seed, worldSize);
  const settings = {
    seed,
    worldSize,
    treeDensity: 1,
    treeSize: 1,
    grassCorridor: 20,
    grassDensity: 1,
    bushDensity: 0.6,
    flowerDensity: 1,
    tallGrassDensity: 1
  };
  const placementsA = computePlacements(field, profile, density, settings);
  const placementsB = computePlacements(field, profile, density, settings);
  record(
    "placement determinism",
    placementsA.trees.length === placementsB.trees.length && placementsA.grass.length === placementsB.grass.length && placementsA.trees.every((tree, index) => tree.x === placementsB.trees[index].x),
    `trees=${placementsA.trees.length} grass=${placementsA.grass.length} bushes=${placementsA.bushes.length} flowers=${placementsA.flowers.length} tallGrass=${placementsA.tallGrass.length}`
  );
  const clearance = profile.halfWidth + profile.shoulderWidth + 2;
  let treeFilterOk = true;
  for (const tree of placementsA.trees.slice(0, 400)) {
    if (profile.distanceTo(tree.x, tree.z) < clearance - 1e-3) {
      treeFilterOk = false;
      break;
    }
    if (field.sampleSlope(tree.x, tree.z) > 0.2 + 1e-3) {
      treeFilterOk = false;
      break;
    }
  }
  record("trees off road and slope", treeFilterOk);
  let grassFilterOk = true;
  for (const grass of placementsA.grass.slice(0, 800)) {
    const distance = profile.distanceTo(grass.x, grass.z);
    if (distance < profile.halfWidth + 0.35 - 0.6 || distance > profile.halfWidth + settings.grassCorridor + 0.6) {
      grassFilterOk = false;
      break;
    }
  }
  record("grass inside corridor", grassFilterOk);
  let treeVariantOk = true;
  for (const tree of placementsA.trees) {
    if (tree.variantNear < 0 || tree.variantNear >= NEAR_TREE_VARIANTS[tree.species]) {
      treeVariantOk = false;
      break;
    }
    if (tree.variantFar < 0 || tree.variantFar >= TREE_FAR_VARIANTS) {
      treeVariantOk = false;
      break;
    }
  }
  record("tree variants in range", treeVariantOk);
  let layerFilterOk = true;
  for (const sprite of [...placementsA.flowers.slice(0, 400), ...placementsA.tallGrass.slice(0, 400)]) {
    const distance = profile.distanceTo(sprite.x, sprite.z);
    if (distance < profile.halfWidth + 0.3 - 0.6 || distance > profile.halfWidth + 20 + 0.6) {
      layerFilterOk = false;
      break;
    }
  }
  record("flowers/tall grass inside corridor", layerFilterOk);
  const barrier = computeBarrierSegments(field, profile, { seed, density: 1 });
  const barrierClearance = profile.halfWidth + profile.shoulderWidth - 0.31;
  record(
    "barrier clear of road",
    barrier.every((segment) => profile.distanceTo(segment.x, segment.z) >= barrierClearance),
    `segments=${barrier.length}`
  );
  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    console.warn(`[slowroads-lab] self-checks failed: ${failed.map((result) => result.name).join(", ")}`);
  } else {
    console.info(`[slowroads-lab] self-checks passed (${results.length})`);
  }
  return results;
}
const verbose = process.argv.includes("--checks");
if (verbose) {
  const results = runSelfChecks();
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
}
for (const seed of [1, 7, 42, 1234, 3067540892, 3527626634]) {
  const field = createHeightfield({ seed, worldSize: 1600 });
  const trace = traceRoadPath(field, {
    startX: 0,
    startZ: 0,
    headingRad: resolveSeedHeadingRad(seed),
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: degreesToRadians(32),
    slopeLimit: 0.55,
    maxTurnRad: degreesToRadians(4),
    maxLength: null,
    margin: 24
  });
  const profile = createRoadProfile(trace.nodes, { halfWidth: 3.5, shoulderWidth: 2.5, flattenBand: 10 });
  const samples = [];
  for (let along = 0; along <= profile.length; along += 2) {
    const sample = profile.sampleAt(along);
    const perpX = -Math.sin(sample.heading);
    const perpZ = Math.cos(sample.heading);
    const drops = {};
    for (const side of [1, -1]) {
      const place = field.sampleHeight(sample.x + perpX * side * 5.75, sample.z + perpZ * side * 5.75);
      for (const out of [4, 6, 8, 12]) {
        const probe = field.sampleHeight(sample.x + perpX * side * (6 + out), sample.z + perpZ * side * (6 + out));
        drops[out] = Math.max(drops[out] ?? -Infinity, place - probe);
      }
    }
    samples.push(drops);
  }
  const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  };
  const parts = [];
  for (const out of [4, 6, 8, 12]) {
    const values = samples.map((drops) => drops[out]);
    parts.push(`+${out}m: p50=${percentile(values, 0.5).toFixed(2)} p80=${percentile(values, 0.8).toFixed(2)} p95=${percentile(values, 0.95).toFixed(2)} max=${Math.max(...values).toFixed(2)}`);
  }
  const segments = computeBarrierSegments(field, profile, { seed, density: 0.65 });
  console.log(`seed ${seed}: road ${Math.round(profile.length)}m segments ${segments.length}`);
  for (const part of parts) {
    console.log(`   drop ${part}`);
  }
}
{
  const seed = 1234;
  const field = createHeightfield({ seed, worldSize: 1600 });
  const trace = traceRoadPath(field, {
    startX: 0,
    startZ: 0,
    headingRad: resolveSeedHeadingRad(seed),
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: degreesToRadians(32),
    slopeLimit: 0.55,
    maxTurnRad: degreesToRadians(4),
    maxLength: null,
    margin: 24
  });
  const profile = createRoadProfile(trace.nodes, { halfWidth: 3.5, shoulderWidth: 2.5, flattenBand: 10 });
  const segments = computeBarrierSegments(field, profile, { seed, density: 1 });
  const localX = new Vector3(1, 0, 0);
  let worst = 1;
  for (const segment of segments.slice(0, 200)) {
    const quaternion = new Quaternion().setFromEuler(new Euler(0, segment.rotation, 0));
    const axis = localX.clone().applyQuaternion(quaternion);
    let bestDistance = Number.POSITIVE_INFINITY;
    let tangent = new Vector3(1, 0, 0);
    for (let i = 1; i < profile.nodes.length; i += 1) {
      const a = profile.nodes[i - 1];
      const b = profile.nodes[i];
      const segX = b.x - a.x;
      const segZ = b.z - a.z;
      const segLengthSq = segX * segX + segZ * segZ;
      const t = Math.max(0, Math.min(1, ((segment.x - a.x) * segX + (segment.z - a.z) * segZ) / segLengthSq));
      const px = a.x + segX * t;
      const pz = a.z + segZ * t;
      const distance = Math.hypot(segment.x - px, segment.z - pz);
      if (distance < bestDistance) {
        bestDistance = distance;
        tangent = new Vector3(segX, 0, segZ).normalize();
      }
    }
    worst = Math.min(worst, Math.abs(tangent.dot(axis)));
  }
  console.log(`barrier orientation: segments=${segments.length} worst |dot(widthAxis, roadTangent)| = ${worst.toFixed(4)} (接近 1 表示对齐)`);
  const sample = segments[0];
  if (sample) {
    console.log(`   sample segment y=${sample.y.toFixed(2)} distance=${profile.distanceTo(sample.x, sample.z).toFixed(2)} (halfWidth+shoulder=${profile.halfWidth + profile.shoulderWidth})`);
  }
}
