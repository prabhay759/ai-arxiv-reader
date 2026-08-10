import { describe, expect, it } from 'vitest'
import {
  FIELD,
  bm25Tf,
  dequantizeWeight,
  idf,
  quantizeWeight,
  shardKey,
  tokenize,
} from '@shared/tokenize.mjs'
import { decodePostings, idShardKey } from './corpus'

describe('decodePostings', () => {
  it('reverses the delta encoding written by the index builder', () => {
    // [docIdDelta, fieldMask, weight] triplets for doc ids 3, 8, 100.
    const postings = [3, FIELD.TITLE, 200, 5, FIELD.ABSTRACT, 40, 92, FIELD.TITLE | FIELD.ABSTRACT, 255]
    expect([...decodePostings(postings)]).toEqual([
      { docId: 3, mask: FIELD.TITLE, weight: 200 },
      { docId: 8, mask: FIELD.ABSTRACT, weight: 40 },
      { docId: 100, mask: FIELD.TITLE | FIELD.ABSTRACT, weight: 255 },
    ])
  })

  it('handles an empty postings list', () => {
    expect([...decodePostings([])]).toEqual([])
  })

  it('round-trips a long ascending run', () => {
    const docIds = [0, 1, 7, 500, 501, 99_999]
    const flat: number[] = []
    let previous = 0
    for (const docId of docIds) {
      flat.push(docId - previous, FIELD.TITLE, 128)
      previous = docId
    }
    expect([...decodePostings(flat)].map((p) => p.docId)).toEqual(docIds)
  })
})

describe('weight quantization', () => {
  it('survives the round trip within one quantization step', () => {
    for (const weight of [0.1, 1, 3.5, 8, 15, 23.9]) {
      expect(Math.abs(dequantizeWeight(quantizeWeight(weight)) - weight)).toBeLessThan(0.1)
    }
  })

  it('always fits in one byte', () => {
    for (const weight of [0, 0.001, 1, 100, 10_000]) {
      const quantized = quantizeWeight(weight)
      expect(quantized).toBeGreaterThanOrEqual(1)
      expect(quantized).toBeLessThanOrEqual(255)
      expect(Number.isInteger(quantized)).toBe(true)
    }
  })

  it('never quantizes a real match down to zero', () => {
    // A zero weight would make a genuine hit score nothing at all.
    expect(quantizeWeight(0.0001)).toBeGreaterThan(0)
  })
})

describe('bm25 scoring pieces', () => {
  it('increases with term frequency but with diminishing returns', () => {
    const one = bm25Tf(1, 100, 100)
    const two = bm25Tf(2, 100, 100)
    const ten = bm25Tf(10, 100, 100)
    expect(two).toBeGreaterThan(one)
    expect(ten).toBeGreaterThan(two)
    expect(ten - two).toBeLessThan(two - one + 1)
  })

  it('favours a match in a short field over the same match in a long one', () => {
    expect(bm25Tf(1, 10, 100)).toBeGreaterThan(bm25Tf(1, 400, 100))
  })

  it('gives rare terms more weight than common ones', () => {
    expect(idf(5, 100_000)).toBeGreaterThan(idf(50_000, 100_000))
  })

  it('never returns a negative idf, even for a term in every document', () => {
    expect(idf(100_000, 100_000)).toBeGreaterThan(0)
  })
})

describe('shard keys stay in sync between builder and client', () => {
  it('derives a term shard from the first characters', () => {
    expect(shardKey('transformer', 2)).toBe('tr')
    expect(shardKey('a', 2)).toBe('a')
  })

  it('keeps shard filenames safe', () => {
    expect(shardKey('c++', 2)).toBe('c_')
    expect(shardKey('f#', 2)).toBe('f_')
  })

  it('shards modern arXiv ids by year-month', () => {
    expect(idShardKey('2608.07460')).toBe('2608')
    expect(idShardKey('1706.03762')).toBe('1706')
  })

  it('shards legacy ids by archive', () => {
    expect(idShardKey('math.GT/0309136')).toBe('math')
    expect(idShardKey('cs.AI/0101001')).toBe('cs')
  })
})

describe('tokenizer invariants the index depends on', () => {
  it('is deterministic', () => {
    const text = 'Attention Is All You Need: a fine-tuning study'
    expect(tokenize(text)).toEqual(tokenize(text))
  })

  it('folds case and diacritics so queries match author names', () => {
    expect(tokenize('Schölkopf')).toEqual(tokenize('SCHOLKOPF'))
  })

  it('drops bare numbers but keeps years', () => {
    expect(tokenize('12345')).toEqual([])
    expect(tokenize('2017')).toEqual(['2017'])
  })
})
