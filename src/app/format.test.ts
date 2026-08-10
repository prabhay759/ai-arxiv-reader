import { describe, expect, it } from 'vitest'
import type { PaperSummary } from '@/types'
import { cleanLatex, formatAuthors, readingTimeRemaining, toBibTeX } from './format'

describe('cleanLatex', () => {
  it('unwraps custom macros that leak into abstracts', () => {
    // Real example from arXiv:2607.24513.
    expect(cleanLatex('we propose \\methodname{Physics Transformer}, a model')).toBe(
      'we propose Physics Transformer, a model'
    )
  })

  it('unwraps standard formatting commands', () => {
    expect(cleanLatex('audit it \\emph{causally} in \\textbf{released} systems')).toBe(
      'audit it causally in released systems'
    )
  })

  it('handles nested macros', () => {
    expect(cleanLatex('\\emph{\\textbf{deeply} nested}')).toBe('deeply nested')
  })

  it('keeps the contents of inline math', () => {
    expect(cleanLatex('a rate of $O(n \\log n)$ overall')).toBe('a rate of O(n n) overall')
  })

  it('converts TeX quotes and dashes', () => {
    expect(cleanLatex("their ``latent thoughts''")).toBe('their "latent thoughts"')
    expect(cleanLatex('key--value caches')).toBe('key–value caches')
    expect(cleanLatex('a thought---interrupted')).toBe('a thought—interrupted')
  })

  it('replaces non-breaking spaces', () => {
    expect(cleanLatex('Figure~1 shows')).toBe('Figure 1 shows')
  })

  it('leaves ordinary prose untouched', () => {
    const plain = 'Multi-agent LLM systems relay key-value caches instead of text.'
    expect(cleanLatex(plain)).toBe(plain)
  })

  it('is safe on empty input', () => {
    expect(cleanLatex('')).toBe('')
  })

  it('terminates on pathological brace nesting', () => {
    const nasty = `${'\\a{'.repeat(200)}x${'}'.repeat(200)}`
    expect(() => cleanLatex(nasty)).not.toThrow()
  })
})

describe('formatAuthors', () => {
  it('lists short author lists in full', () => {
    expect(formatAuthors(['Ada Lovelace', 'Alan Turing'])).toBe('Ada Lovelace, Alan Turing')
  })

  it('summarises long author lists', () => {
    expect(formatAuthors(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
  })

  it('handles a missing author list', () => {
    expect(formatAuthors([])).toBe('Unknown author')
  })
})

describe('toBibTeX', () => {
  const paper: PaperSummary = {
    id: '1706.03762',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    categories: ['cs.CL', 'cs.LG'],
    published: '2017-06-12',
  }

  it('produces a citable entry', () => {
    const bib = toBibTeX(paper)
    expect(bib).toContain('@misc{vaswani2017attention,')
    expect(bib).toContain('author = {Ashish Vaswani and Noam Shazeer}')
    expect(bib).toContain('eprint = {1706.03762}')
    expect(bib).toContain('primaryClass = {cs.CL}')
    expect(bib.trim().endsWith('}')).toBe(true)
  })
})

describe('readingTimeRemaining', () => {
  it('counts down as progress increases', () => {
    const early = readingTimeRemaining(0.1, 12)
    const late = readingTimeRemaining(0.9, 12)
    expect(early).not.toBe(late)
    expect(parseFloat(early)).toBeGreaterThan(parseFloat(late))
  })

  it('reports almost nothing left at the end', () => {
    expect(readingTimeRemaining(1, 12)).toMatch(/less than a minute/)
  })
})
