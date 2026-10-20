import { describe, expect, it } from 'vitest'
import { downloadAssetTempFilePath } from '@schema/assetDownload'
import {
  collectLandscapeSharedTextureRefs,
  collectSeasonTextureRefs,
  resolveSeasonTextureRefsByIds,
  SHARED_TEXTURES,
} from '@schema/slowroads/core/seasonCatalog'
import {
  resolveSlowroadsLogicalId,
  resolveSlowroadsTextureCandidateIds,
  resolveSlowroadsVersionedAssetUrl,
  SlowroadsAssetStore,
} from '@schema/slowroads/assets/assetStore'

const ids = (refs: ReadonlyArray<{ id: string }>): string[] => refs.map((ref) => ref.id)

describe('season texture refs', () => {
  it('keeps the full default set for asset validation', () => {
    const all = ids(collectSeasonTextureRefs('spring'))
    expect(all).toContain('road_single_base_spring.2a1a3159')
    expect(all).toContain('road_base.40d53c3c')
    expect(all).toContain('spring_trees_0.aee94219')
    expect(all).toContain('spring_imposters_0_d.2e67db77')
    expect(all).toContain('spring_wall_drystone.6c714f68')
    expect(all).toContain('grass.15f2422c')
  })

  it('loads only the selected road style', () => {
    const wide = ids(collectSeasonTextureRefs('spring', {
      roadSingle: false,
      roadWide: true,
    }))
    expect(wide).toContain('road_base.40d53c3c')
    expect(wide).toContain('road_paint_dashed.246907ab')
    expect(wide).not.toContain('road_single_base_spring.2a1a3159')
    expect(wide).not.toContain('road_single_overlay_spring.a23e0db5')

    const single = ids(collectSeasonTextureRefs('spring', {
      roadSingle: true,
      roadWide: false,
    }))
    expect(single).toContain('road_single_base_spring.2a1a3159')
    expect(single).not.toContain('road_base.40d53c3c')
  })

  it('skips disabled surface/forest/grass/bush/wall groups without losing foliage detail maps', () => {
    const surfaceOff = ids(collectSeasonTextureRefs('spring', {
      surface: false,
      forest: true,
      grass: false,
      bushes: false,
      walls: false,
      roadSingle: false,
      roadWide: false,
    }))
    expect(surfaceOff).toContain('ground_detail_far.a63b212a')
    expect(surfaceOff).toContain('spring_trees_0.aee94219')
    expect(surfaceOff).not.toContain('grass.15f2422c')
    expect(surfaceOff).not.toContain('spring_bushes.2db1f4bc')
    expect(surfaceOff).not.toContain('spring_wall_drystone.6c714f68')

    const forestOff = ids(collectSeasonTextureRefs('spring', {
      forest: false,
      grass: true,
      bushes: true,
      walls: false,
      roadSingle: false,
      roadWide: false,
    }))
    expect(forestOff).not.toContain('spring_trees_0.aee94219')
    expect(forestOff).not.toContain('spring_imposters_0_d.2e67db77')
    expect(forestOff).toContain('summer_grasses.7ddf683f')
    expect(forestOff).toContain('spring_bushes.2db1f4bc')
  })

  it('selects shared maps by feature and only loads sea waves when visible water is requested', () => {
    const dry = ids(collectLandscapeSharedTextureRefs({
      surface: false,
      forest: true,
      grass: false,
      bushes: false,
      water: false,
    }))
    expect(dry).toContain(SHARED_TEXTURES.noise.id)
    expect(dry).toContain(SHARED_TEXTURES.grassVariation.id)
    expect(dry).not.toContain(SHARED_TEXTURES.rockBump.id)
    expect(dry).not.toContain(SHARED_TEXTURES.bushNoise.id)
    expect(dry).not.toContain(SHARED_TEXTURES.seaWaves.id)

    const wet = ids(collectLandscapeSharedTextureRefs({
      surface: true,
      forest: true,
      grass: true,
      bushes: true,
      water: true,
    }))
    expect(wet).toContain(SHARED_TEXTURES.rockBump.id)
    expect(wet).toContain(SHARED_TEXTURES.bushNoise.id)
    expect(wet).toContain(SHARED_TEXTURES.seaWaves.id)
  })

  it('resolves serialized IDs, deduplicates them and reports unknown entries', () => {
    const resolved = resolveSeasonTextureRefsByIds([
      ' grass.15f2422c ',
      'grass.15f2422c',
      'missing.texture',
      '',
    ])
    expect(resolved.refs.map((ref) => ref.id)).toEqual(['grass.15f2422c'])
    expect(resolved.refs[0]?.kind).toBe('albedo')
    expect(resolved.unknownIds).toEqual(['missing.texture'])
  })
})

describe('mini-program texture download source', () => {
  it('keeps the native temporary file path without reading it back into JS memory', async () => {
    let readFileCalled = false
    const globalObject = globalThis as typeof globalThis & {
      uni?: unknown
      wx?: unknown
    }
    const previousUni = globalObject.uni
    const previousWx = globalObject.wx
    globalObject.uni = {
      getSystemInfoSync: () => ({ uniPlatform: 'mp-weixin' }),
      getFileSystemManager: () => ({
        readFile: () => {
          readFileCalled = true
        },
      }),
      downloadFile: (options: {
        success: (payload: { statusCode: number; tempFilePath: string }) => void
      }) => {
        queueMicrotask(() => {
          options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/texture.png' })
        })
        return {
          abort: () => {},
          onProgressUpdate: () => {},
        }
      },
    }
    globalObject.wx = { getFileSystemManager: () => ({ readFile: () => {} }) }

    try {
      const source = await downloadAssetTempFilePath(
        'https://v.touchmagic.cn/uploads/slowroads/grass.15f2422c.png',
        new AbortController(),
        () => {},
      )
      expect(source).toBe('wxfile://tmp/texture.png')
      expect(readFileCalled).toBe(false)
    } finally {
      globalObject.uni = previousUni
      globalObject.wx = previousWx
    }
  })
})

describe('slowroads texture variant', () => {
  it('uses @2048 for mini programs even when the GPU texture limit is large', () => {
    const store = new SlowroadsAssetStore({
      maxTextureSize: 16383,
      preferredVariant: '2048',
    })
    expect(store.variant).toBe('2048')
    expect(resolveSlowroadsLogicalId(store.variant, 'spring_imposters_0_d.2e67db77'))
      .toBe('spring_imposters_0_d.2e67db77@2048')

    store.configure({ preferredVariant: 'full' })
    expect(store.variant).toBe('full')
    expect(resolveSlowroadsLogicalId(store.variant, 'spring_imposters_0_d.2e67db77'))
      .toBe('spring_imposters_0_d.2e67db77')
    store.dispose()
  })

  it('falls back to the available alternate variant', () => {
    const available = new Set([
      'autumn_imposters_0_d.4c4b38fd@2048',
      'autumn_imposters_0_n.d10ccd46',
    ])
    const hasFile = (id: string): boolean => available.has(id)

    expect(
      resolveSlowroadsTextureCandidateIds(
        'autumn_imposters_0_d.4c4b38fd',
        'autumn_imposters_0_d.4c4b38fd',
        hasFile,
      ),
    ).toEqual(['autumn_imposters_0_d.4c4b38fd@2048'])

    expect(
      resolveSlowroadsTextureCandidateIds(
        'autumn_imposters_0_n.d10ccd46',
        'autumn_imposters_0_n.d10ccd46',
        hasFile,
      ),
    ).toEqual(['autumn_imposters_0_n.d10ccd46'])
  })

  it('tries the full variant second when the preferred 2048 file is unavailable', () => {
    const available = new Set(['autumn_imposters_0_n.d10ccd46'])

    expect(
      resolveSlowroadsTextureCandidateIds(
        'autumn_imposters_0_n.d10ccd46',
        'autumn_imposters_0_n.d10ccd46@2048',
        (id) => available.has(id),
      ),
    ).toEqual(['autumn_imposters_0_n.d10ccd46'])
  })

  it('versions stable asset paths with the manifest content hash', () => {
    expect(resolveSlowroadsVersionedAssetUrl(
      'https://v.touchmagic.cn/uploads/slowroads/summer_imposters_0_d.6a3261f4@2048.png',
      'sha256-2e67db77abcdef12',
    )).toBe(
      'https://v.touchmagic.cn/uploads/slowroads/summer_imposters_0_d.6a3261f4@2048.png'
      + '?v=sha256-2e67db77abcdef12',
    )
    expect(resolveSlowroadsVersionedAssetUrl('https://example.test/a.png?x=1', 'hash'))
      .toBe('https://example.test/a.png?x=1&v=hash')
    expect(resolveSlowroadsVersionedAssetUrl('https://example.test/a.png', ''))
      .toBe('https://example.test/a.png')
  })
})
