import { describe, expect, it } from 'vitest'

/**
 * Mirrors withBase() in services.ts. It is duplicated rather than imported
 * because services.ts constructs the corpus client and search engine at module
 * scope, which needs a DOM; the join itself is pure and is what regressed.
 */
function withBase(baseUrl: string, path: string): string {
  const base = baseUrl || '/'
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\//, '')}`
}

describe('base URL joining', () => {
  it('handles a base that already ends in a slash', () => {
    expect(withBase('/ai-arxiv-reader/', 'data/')).toBe('/ai-arxiv-reader/data/')
  })

  it('handles a base missing its trailing slash', () => {
    // The actual production bug: actions/configure-pages emits base_path
    // without a trailing slash, and plain concatenation produced
    // "/ai-arxiv-readerdata/" — a 404 for every index file, on an app that
    // otherwise loaded and looked healthy.
    expect(withBase('/ai-arxiv-reader', 'data/')).toBe('/ai-arxiv-reader/data/')
  })

  it('handles a root deployment', () => {
    expect(withBase('/', 'data/')).toBe('/data/')
  })

  it('handles an empty base', () => {
    expect(withBase('', 'data/')).toBe('/data/')
  })

  it('does not double up when the path is absolute', () => {
    expect(withBase('/ai-arxiv-reader/', '/data/')).toBe('/ai-arxiv-reader/data/')
    expect(withBase('/ai-arxiv-reader', '/data/')).toBe('/ai-arxiv-reader/data/')
  })

  it('never produces a doubled or missing separator', () => {
    for (const base of ['/repo', '/repo/', '/', '', '/a/b', '/a/b/']) {
      const joined = withBase(base, 'data/manifest.json')
      expect(joined).not.toMatch(/[^:]\/\//)
      expect(joined).toMatch(/\/data\/manifest\.json$/)
    }
  })
})
