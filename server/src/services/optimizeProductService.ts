import { OptimizeProductModel } from '@/models/OptimizeProduct'
import { OPTIMIZE_PRODUCT_SEEDS } from '@/data/optimizeProducts'
import type { OptimizeProductUsageConfig } from '@/types/models'

let indexesEnsured = false

async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) {
    return
  }
  try {
    await OptimizeProductModel.syncIndexes()
  } catch (error) {
    console.warn('Failed to sync optimize product indexes, continuing without dropping stale indexes.', error)
  }
  indexesEnsured = true
}

export async function ensureOptimizeProductsSeeded(): Promise<void> {
  await ensureIndexes()
  await Promise.all(
    OPTIMIZE_PRODUCT_SEEDS.map((seed, index) =>
      OptimizeProductModel.updateOne(
        { slug: seed.slug },
        {
          $set: {
            name: seed.name,
            category: seed.category,
            price: seed.price,
            imageUrl: seed.imageUrl,
            description: seed.description,
            tags: seed.tags ?? [],
            usageConfig: (seed.usageConfig ?? undefined) as OptimizeProductUsageConfig | undefined,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true },
      ).catch((error) => {
        console.error(`Failed to seed optimize product #${index} (${seed.slug}):`, error)
        return undefined
      }),
    ),
  )
}
