import assert from 'node:assert/strict'
import test from 'node:test'
import { ProductModel } from '../src/models/Product'

function createProduct(name: string, slug: string) {
  return new ProductModel({
    name,
    slug,
    price: 0,
  })
}

test('products without a controllable asset omit the optional unique field', () => {
  const first = createProduct('First skin', 'skin-first')
  const second = createProduct('Second skin', 'skin-second')

  assert.equal(first.get('controllableAssetId'), undefined)
  assert.equal(second.get('controllableAssetId'), undefined)
})

test('controllable asset links remain unique when present', () => {
  const index = ProductModel.schema
    .indexes()
    .find(([fields]) => fields.controllableAssetId === 1)

  assert.ok(index)
  assert.equal(index[1].unique, true)
  assert.equal(index[1].sparse, true)
})
