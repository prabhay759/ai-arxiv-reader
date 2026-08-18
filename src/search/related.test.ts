import { describe, expect, it } from 'vitest'
import { selectTerms } from './related'

const DOC_COUNT = 441_740

/** Document frequencies, defaulting to "common enough to be a real word". */
function frequencies(overrides: Record<string, number>) {
  return (term: string) => overrides[term]
}

describe('choosing the terms that characterise a paper', () => {
  it('keeps distinctive terms and drops corpus-wide ones', () => {
    const df = frequencies({
      sheaf: 300,
      admm: 900,
      learning: 193_148, // 44% of the corpus — discriminates nothing
      coordination: 4_000,
    })
    const terms = selectTerms(
      'Learning Multi-Agent Coordination via Sheaf-ADMM',
      df,
      DOC_COUNT
    ).map((t) => t.term)

    expect(terms).toContain('sheaf')
    expect(terms).toContain('admm')
    expect(terms).toContain('coordination')
    expect(terms).not.toContain('learning')
  })

  it('rejects typos and fragments, which are the rarest things in a corpus', () => {
    // The bug this encodes: ranking purely by rarity returned papers matching
    // `fre`, `ncy` and `usion` — fragments that exist a few dozen times each.
    // Rarest-first is a typo detector, not a relevance signal.
    const df = frequencies({ fre: 33, ncy: 3, usion: 32, frequency: 11_036 })
    const terms = selectTerms('fre ncy usion frequency', df, DOC_COUNT).map((t) => t.term)

    expect(terms).toEqual(['frequency'])
  })

  it('drops terms too short to be words', () => {
    const df = frequencies({ gan: 5_000, gans: 5_000 })
    const terms = selectTerms('gan gans', df, DOC_COUNT).map((t) => t.term)

    expect(terms).not.toContain('gan')
    expect(terms).toContain('gans')
  })

  it('ignores terms that are not in the index at all', () => {
    expect(selectTerms('supercalifragilistic', () => undefined, DOC_COUNT)).toEqual([])
  })

  it('ranks rarer terms above commoner ones', () => {
    const df = frequencies({ sheaf: 300, transformer: 12_000 })
    const terms = selectTerms('sheaf transformer', df, DOC_COUNT).map((t) => t.term)
    expect(terms).toEqual(['sheaf', 'transformer'])
  })

  it('rewards repetition, but sub-linearly', () => {
    const df = frequencies({ diffusion: 6_000, sheaf: 6_000 })
    const [first] = selectTerms('diffusion diffusion diffusion sheaf', df, DOC_COUNT)
    const scores = Object.fromEntries(
      selectTerms('diffusion diffusion diffusion sheaf', df, DOC_COUNT).map((t) => [
        t.term,
        t.weight,
      ])
    )

    expect(first.term).toBe('diffusion')
    // Three mentions, not three times the weight.
    expect(scores.diffusion).toBeLessThan(scores.sheaf * 3)
    expect(scores.diffusion).toBeGreaterThan(scores.sheaf)
  })

  it('caps how many terms a query carries', () => {
    const words = Array.from({ length: 60 }, (_, i) => `termnumber${i}`)
    const df = frequencies(Object.fromEntries(words.map((w) => [w, 500])))
    expect(selectTerms(words.join(' '), df, DOC_COUNT).length).toBeLessThanOrEqual(20)
  })

  it('scales its thresholds to the corpus it is given', () => {
    // The bug this encodes: the floor was a fixed 50 documents, tuned on a
    // 441,740-paper index. On a 1,338-paper one that is 3.7% — above the 3%
    // ceiling — so the bounds crossed and nothing was ever selected. The
    // feature worked in production and returned silence everywhere else.
    const small = 1_338
    const df = frequencies({ sheaf: 8, transformer: 20, learning: 600 })
    const terms = selectTerms('sheaf transformer learning', df, small).map((t) => t.term)

    expect(terms).toContain('sheaf')
    expect(terms).toContain('transformer')
    expect(terms).not.toContain('learning') // 45% of a small corpus
  })

  it('still rejects one-off terms in a small corpus', () => {
    const df = frequencies({ typo: 1, sheaf: 8 })
    expect(selectTerms('typo sheaf', df, 1_338).map((t) => t.term)).toEqual(['sheaf'])
  })

  it('returns nothing for an empty paper rather than throwing', () => {
    expect(selectTerms('', () => 500, DOC_COUNT)).toEqual([])
  })
})
