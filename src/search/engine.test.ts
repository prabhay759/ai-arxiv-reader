import { describe, expect, it } from 'vitest'
import { FIELD, quantizeWeight } from '@shared/tokenize.mjs'
import type { PaperSummary } from '@/types'
import type { CorpusClient, Manifest } from './corpus'
import { SearchEngine } from './engine'

const PAPERS: PaperSummary[] = [
  {
    id: '2401.00001',
    title: 'Scaling Laws for Diffusion Transformers',
    authors: ['Ada Lovelace'],
    categories: ['cs.LG', 'cs.AI'],
    published: '2024-01-05',
  },
  {
    id: '2402.00002',
    title: 'A Study of Contrastive Objectives',
    authors: ['Alan Turing'],
    categories: ['cs.CL'],
    published: '2024-02-10',
  },
]

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schema: 1,
    builtAt: '2026-08-11T00:00:00.000Z',
    docCount: PAPERS.length,
    docsPerChunk: 512,
    chunkCount: 1,
    prefixLength: 2,
    categories: ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.NE', 'stat.ML'],
    abstractCutoff: '2020-08-01',
    oldestPublished: '2024-01-05',
    newestPublished: '2024-02-10',
    avgFieldLengths: { title: 5, author: 2, category: 2, abstract: 100 },
    shards: ['di'],
    metaShards: ['202401'],
    idShards: ['2401'],
    stats: { termCount: 1, postingCount: 1 },
    ...overrides,
  }
}

/**
 * Minimal stand-in for the corpus client. Only the methods search() touches are
 * implemented; everything else would be dead weight in these tests.
 */
function makeCorpus(manifest: Manifest): CorpusClient {
  return {
    manifest: async () => manifest,
    shard: async (key: string) =>
      key === 'di'
        ? { diffusion: [0, FIELD.TITLE | FIELD.ABSTRACT, quantizeWeight(8)] }
        : null,
    resolve: async (docIds: number[]) =>
      new Map(docIds.map((id) => [id, PAPERS[id]]).filter(([, p]) => p) as Array<[number, PaperSummary]>),
    docChunk: async () => PAPERS,
  } as unknown as CorpusClient
}

const FILTERS = { categories: [], sort: 'relevance' as const }

describe('abstract-window notice', () => {
  it('is omitted when every abstract in the corpus is indexed', async () => {
    // cutoff (2020-08) predates the oldest paper (2024-01), so nothing is
    // excluded and warning about a cutoff would describe a limitation that
    // does not exist.
    const engine = new SearchEngine(makeCorpus(makeManifest()))
    const result = await engine.search({ query: 'diffusion', filters: FILTERS })

    expect(result.hits).toHaveLength(1)
    expect(result.notice).toBeUndefined()
  })

  it('is shown when the window really does exclude older abstracts', async () => {
    const engine = new SearchEngine(
      makeCorpus(makeManifest({ abstractCutoff: '2024-02-01' }))
    )
    const result = await engine.search({ query: 'diffusion', filters: FILTERS })

    expect(result.notice).toMatch(/2024-02/)
  })

  it('is omitted for a title-only query even when the window is narrow', async () => {
    const engine = new SearchEngine(
      makeCorpus(makeManifest({ abstractCutoff: '2024-02-01' }))
    )
    const result = await engine.search({ query: 'ti:diffusion', filters: FILTERS })

    expect(result.notice).toBeUndefined()
  })
})

describe('result counts', () => {
  it('reports a known total for an ordinary term search', async () => {
    const engine = new SearchEngine(makeCorpus(makeManifest()))
    const result = await engine.search({ query: 'diffusion', filters: FILTERS })

    expect(result.totalKnown).toBe(true)
    expect(result.total).toBe(1)
    expect(result.hasMore).toBe(false)
  })

  it('marks a browse as an unknown total when it stops early', async () => {
    // Browsing walks doc chunks and stops once the page is full, so the count
    // it has is a scan artefact rather than a total.
    const engine = new SearchEngine(makeCorpus(makeManifest()))
    const result = await engine.search({ query: '', filters: FILTERS, limit: 1 })

    expect(result.hits).toHaveLength(1)
    expect(result.totalKnown).toBe(false)
    expect(result.hasMore).toBe(true)
  })

  it('knows the total when a browse exhausts the corpus', async () => {
    const engine = new SearchEngine(makeCorpus(makeManifest()))
    const result = await engine.search({ query: '', filters: FILTERS, limit: 50 })

    expect(result.totalKnown).toBe(true)
    expect(result.total).toBe(PAPERS.length)
    expect(result.hasMore).toBe(false)
  })
})
