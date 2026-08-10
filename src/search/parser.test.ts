import { describe, expect, it } from 'vitest'
import { FIELD } from '@shared/tokenize.mjs'
import { extractArxivId, parseQuery } from './parser'

describe('parseQuery', () => {
  it('treats bare words as required terms', () => {
    const parsed = parseQuery('retrieval augmented generation')
    expect(parsed.terms.map((t) => t.term)).toEqual(['retrieval', 'augmented', 'generation'])
    expect(parsed.terms.every((t) => !t.negated && t.fields === 0)).toBe(true)
    expect(parsed.empty).toBe(false)
  })

  it('restricts field-prefixed terms', () => {
    const parsed = parseQuery('ti:diffusion abs:sampling')
    expect(parsed.terms).toEqual([
      expect.objectContaining({ term: 'diffusion', fields: FIELD.TITLE }),
      expect.objectContaining({ term: 'sampling', fields: FIELD.ABSTRACT }),
    ])
  })

  it('keeps quoted author names together as one phrase', () => {
    const parsed = parseQuery('au:"Yann LeCun"')
    expect(parsed.terms.map((t) => t.term)).toEqual(['yann', 'lecun'])
    expect(parsed.terms.every((t) => t.fields === FIELD.AUTHOR)).toBe(true)
    expect(parsed.phrases).toEqual(['Yann LeCun'])
  })

  it('extracts category filters rather than treating them as terms', () => {
    const parsed = parseQuery('transformer cat:cs.LG')
    expect(parsed.categories).toEqual(['cs.lg'])
    expect(parsed.terms.map((t) => t.term)).toEqual(['transformer'])
  })

  it('marks negated terms', () => {
    const parsed = parseQuery('transformer -survey')
    expect(parsed.terms).toContainEqual(expect.objectContaining({ term: 'survey', negated: true }))
    expect(parsed.terms).toContainEqual(
      expect.objectContaining({ term: 'transformer', negated: false })
    )
  })

  it('is empty only when nothing searchable remains', () => {
    expect(parseQuery('').empty).toBe(true)
    expect(parseQuery('   ').empty).toBe(true)
    expect(parseQuery('cat:cs.AI').empty).toBe(false)
    expect(parseQuery('-survey').empty).toBe(true)
  })

  it('treats an unknown prefix as literal text instead of dropping it', () => {
    // Dropping it would make the query silently mean something else.
    const parsed = parseQuery('http://example.com')
    expect(parsed.terms.map((t) => t.term)).toContain('http')
    expect(parsed.empty).toBe(false)
  })

  it('prefix-matches only the last bare term, and only while typing', () => {
    const typing = parseQuery('deep learn', { allowPrefix: true })
    expect(typing.terms.map((t) => [t.term, t.prefix ?? false])).toEqual([
      ['deep', false],
      ['learn', true],
    ])

    const submitted = parseQuery('deep learn')
    expect(submitted.terms.every((t) => !t.prefix)).toBe(true)
  })

  it('does not prefix-match a quoted or negated final token', () => {
    expect(parseQuery('deep "learning"', { allowPrefix: true }).terms.some((t) => t.prefix)).toBe(
      false
    )
    expect(parseQuery('deep -learn', { allowPrefix: true }).terms.some((t) => t.prefix)).toBe(false)
  })

  it('expands hyphenated compounds so all spellings match', () => {
    const parsed = parseQuery('fine-tuning')
    expect(parsed.terms.map((t) => t.term)).toEqual(['finetuning', 'fine', 'tuning'])
  })
})

describe('extractArxivId', () => {
  it('recognises bare modern ids with and without a version', () => {
    expect(extractArxivId('2608.07460')).toBe('2608.07460')
    expect(extractArxivId('2608.07460v2')).toBe('2608.07460')
    expect(extractArxivId('  1706.03762  ')).toBe('1706.03762')
  })

  it('recognises abs, pdf and html URLs', () => {
    expect(extractArxivId('https://arxiv.org/abs/1706.03762')).toBe('1706.03762')
    expect(extractArxivId('https://arxiv.org/pdf/1706.03762v7')).toBe('1706.03762')
    expect(extractArxivId('https://arxiv.org/html/2608.07460v1')).toBe('2608.07460')
  })

  it('recognises legacy archive ids', () => {
    expect(extractArxivId('math.GT/0309136')).toBe('math.GT/0309136')
    expect(extractArxivId('https://arxiv.org/abs/cs.AI/0101001')).toBe('cs.AI/0101001')
  })

  it('returns null for ordinary search text', () => {
    expect(extractArxivId('attention is all you need')).toBeNull()
    expect(extractArxivId('transformer')).toBeNull()
    expect(extractArxivId('')).toBeNull()
  })
})
