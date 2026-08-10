import { FIELD, dequantizeWeight, fold, idf, shardKey } from '@shared/tokenize.mjs'
import type { PaperSummary, SearchFilters, SortMode } from '@/types'
import { CorpusClient, decodePostings, type IndexShard } from './corpus'
import { parseQuery, type ParsedQuery, type QueryTerm } from './parser'

export interface SearchHit {
  docId: number
  paper: PaperSummary
  score: number
  /** Fields that matched, for the "matched in abstract" affordance. */
  matchedFields: number
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  /** Set when the query reached past the indexed-abstract window. */
  notice?: string
  tookMs: number
}

export interface SearchOptions {
  query: string
  filters: SearchFilters
  offset?: number
  limit?: number
  /** Enables prefix matching on the final term, for search-as-you-type. */
  incremental?: boolean
  signal?: AbortSignal
}

/**
 * Recency boost. arXiv users overwhelmingly want current work, but a strong
 * old paper must still be able to outrank a weak new one — so this is a mild
 * multiplicative nudge (up to +35% for brand new, decaying over ~6 years)
 * rather than a sort key.
 */
function recencyBoost(published: string, newest: string): number {
  const ageYears =
    (Date.parse(`${newest}T00:00:00Z`) - Date.parse(`${published}T00:00:00Z`)) /
    (365.25 * 24 * 3600 * 1000)
  if (!Number.isFinite(ageYears) || ageYears < 0) return 1
  return 1 + 0.35 * Math.exp(-ageYears / 6)
}

export class SearchEngine {
  constructor(private readonly corpus: CorpusClient) {}

  async search(options: SearchOptions): Promise<SearchResult> {
    const started = performance.now()
    const { filters, offset = 0, limit = 25, signal } = options
    const parsed = parseQuery(options.query, { allowPrefix: options.incremental })
    const manifest = await this.corpus.manifest()

    const categoryFilters = [
      ...filters.categories.map((c) => c.toLowerCase()),
      ...parsed.categories,
    ]

    // A bare category/date browse with no search terms: walk doc ids directly
    // rather than through the index, which has nothing to contribute.
    if (parsed.terms.filter((t) => !t.negated).length === 0) {
      return this.browse({ parsed, filters, categoryFilters, offset, limit, started, signal })
    }

    const scores = await this.scoreTerms(parsed, manifest.docCount, signal)
    if (scores.size === 0) {
      return { hits: [], total: 0, tookMs: performance.now() - started, ...this.notice(parsed, manifest.abstractCutoff) }
    }

    // Resolve every candidate to apply filters and sort. Candidate sets are
    // bounded by the rarest query term, so this stays small for real queries;
    // very common single terms are capped to keep the fetch bounded.
    const MAX_CANDIDATES = 4000
    const candidates = [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, MAX_CANDIDATES)

    const resolved = await this.corpus.resolve(
      candidates.map(([docId]) => docId),
      signal
    )

    const hits: SearchHit[] = []
    for (const [docId, entry] of candidates) {
      const paper = resolved.get(docId)
      if (!paper) continue
      if (!passesFilters(paper, filters, categoryFilters)) continue
      if (!passesPhrases(paper, parsed)) continue

      hits.push({
        docId,
        paper,
        score: entry.score * recencyBoost(paper.published, manifest.newestPublished),
        matchedFields: entry.mask,
      })
    }

    sortHits(hits, filters.sort)

    return {
      hits: hits.slice(offset, offset + limit),
      total: hits.length,
      tookMs: performance.now() - started,
      ...this.notice(parsed, manifest.abstractCutoff),
    }
  }

  /**
   * Accumulate per-document scores across query terms.
   * Negated terms remove documents outright; positive terms must all be
   * present (AND), which matches what people expect from a search box.
   */
  private async scoreTerms(
    parsed: ParsedQuery,
    docCount: number,
    signal?: AbortSignal
  ): Promise<Map<number, { score: number; mask: number; matched: number }>> {
    const positives = parsed.terms.filter((t) => !t.negated)
    const negatives = parsed.terms.filter((t) => t.negated)

    const scores = new Map<number, { score: number; mask: number; matched: number }>()

    for (const term of positives) {
      const postings = await this.postingsFor(term, signal)
      if (postings.length === 0) {
        // A required term matched nothing: the AND can never be satisfied.
        return new Map()
      }

      // Terms expanded by prefix matching share one "slot" so that matching
      // several expansions doesn't count as satisfying several terms.
      const seenThisTerm = new Set<number>()
      for (const { postings: list, docFreq } of postings) {
        const weight = idf(docFreq, docCount)
        for (const posting of decodePostings(list)) {
          if (term.fields && (posting.mask & term.fields) === 0) continue

          const existing = scores.get(posting.docId)
          const contribution = weight * dequantizeWeight(posting.weight)
          if (existing) {
            existing.score += contribution
            existing.mask |= posting.mask
            if (!seenThisTerm.has(posting.docId)) existing.matched += 1
          } else {
            scores.set(posting.docId, {
              score: contribution,
              mask: posting.mask,
              matched: 1,
            })
          }
          seenThisTerm.add(posting.docId)
        }
      }
    }

    // Enforce AND: drop anything that didn't match every positive term.
    const required = positives.length
    for (const [docId, entry] of scores) {
      if (entry.matched < required) scores.delete(docId)
    }

    for (const term of negatives) {
      for (const { postings: list } of await this.postingsFor(term, signal)) {
        for (const posting of decodePostings(list)) scores.delete(posting.docId)
      }
    }

    return scores
  }

  /**
   * Postings for one query term. A prefix term expands to every term in its
   * shard sharing the prefix, capped so a one-letter prefix can't pull in a
   * whole shard's worth of postings.
   */
  private async postingsFor(
    term: QueryTerm,
    signal?: AbortSignal
  ): Promise<Array<{ postings: number[]; docFreq: number }>> {
    const manifest = await this.corpus.manifest()
    const key = shardKey(term.term, manifest.prefixLength)
    const shard = await this.corpus.shard(key, signal)
    if (!shard) return []

    if (!term.prefix) {
      const postings = shard[term.term]
      return postings ? [{ postings, docFreq: postings.length / 3 }] : []
    }

    const MAX_EXPANSIONS = 24
    const matches: Array<{ postings: number[]; docFreq: number }> = []
    const exact = shard[term.term]
    if (exact) matches.push({ postings: exact, docFreq: exact.length / 3 })

    for (const candidate of Object.keys(shard as IndexShard)) {
      if (matches.length >= MAX_EXPANSIONS) break
      if (candidate !== term.term && candidate.startsWith(term.term)) {
        matches.push({ postings: shard[candidate], docFreq: shard[candidate].length / 3 })
      }
    }
    return matches
  }

  /** Term-free browsing: category and date filters over the whole corpus. */
  private async browse({
    parsed,
    filters,
    categoryFilters,
    offset,
    limit,
    started,
    signal,
  }: {
    parsed: ParsedQuery
    filters: SearchFilters
    categoryFilters: string[]
    offset: number
    limit: number
    started: number
    signal?: AbortSignal
  }): Promise<SearchResult> {
    const manifest = await this.corpus.manifest()
    const hits: SearchHit[] = []

    // With no terms to score, relevance has no meaning — fall back to newest,
    // which is also what doc id order already gives us.
    const sort: SortMode = filters.sort === 'relevance' ? 'newest' : filters.sort
    const wantOldest = sort === 'oldest'

    // Doc ids run newest-first, so walking chunks in order (or reversed) emits
    // papers already sorted; we can stop as soon as the page is filled instead
    // of scanning the whole corpus.
    const chunkOrder = Array.from({ length: manifest.chunkCount }, (_, i) =>
      wantOldest ? manifest.chunkCount - 1 - i : i
    )

    for (const chunk of chunkOrder) {
      const rows = await this.corpus.docChunk(chunk, signal)

      for (let i = 0; i < rows.length; i += 1) {
        const rowIndex = wantOldest ? rows.length - 1 - i : i
        const paper = rows[rowIndex]
        if (!passesFilters(paper, filters, categoryFilters)) continue
        hits.push({
          docId: chunk * manifest.docsPerChunk + rowIndex,
          paper,
          score: 0,
          matchedFields: 0,
        })
      }

      // Chunks are already in sort order, so once we have a full page plus the
      // caller's offset there is nothing better further down.
      if (hits.length >= offset + limit) break
    }

    return {
      hits: hits.slice(offset, offset + limit),
      total: hits.length,
      tookMs: performance.now() - started,
      ...this.notice(parsed, manifest.abstractCutoff),
    }
  }

  private notice(parsed: ParsedQuery, cutoff: string): { notice?: string } {
    const searchesAbstracts = parsed.terms.some(
      (t) => !t.negated && (t.fields === 0 || (t.fields & FIELD.ABSTRACT) !== 0)
    )
    if (!searchesAbstracts) return {}
    return {
      notice: `Abstract text is indexed from ${cutoff.slice(0, 7)} onward. Older papers are still searchable by title, author and category.`,
    }
  }
}

function passesFilters(
  paper: PaperSummary,
  filters: SearchFilters,
  categories: string[]
): boolean {
  if (categories.length > 0) {
    const lower = paper.categories.map((c) => c.toLowerCase())
    if (!categories.some((wanted) => lower.includes(wanted))) return false
  }
  if (filters.from && paper.published < filters.from) return false
  if (filters.to && paper.published > filters.to) return false
  return true
}

/**
 * Verify quoted phrases against the title.
 *
 * The index stores no positions, so phrase queries reach here as an AND of
 * their terms. We can confirm a phrase exactly when the text is on hand — the
 * title always is. Abstract phrases stay approximate rather than being
 * silently dropped or forcing a metadata fetch for every candidate.
 */
function passesPhrases(paper: PaperSummary, parsed: ParsedQuery): boolean {
  if (parsed.phrases.length === 0) return true

  const titleFold = fold(paper.title)
  for (const phrase of parsed.phrases) {
    const needle = fold(phrase)
    const titleOnly = parsed.terms.some((t) => t.phrase === phrase && t.fields === FIELD.TITLE)
    if (titleOnly && !titleFold.includes(needle)) return false
  }
  return true
}

function sortHits(hits: SearchHit[], sort: SortMode): void {
  if (sort === 'newest') {
    hits.sort((a, b) => (a.paper.published < b.paper.published ? 1 : a.paper.published > b.paper.published ? -1 : b.score - a.score))
  } else if (sort === 'oldest') {
    hits.sort((a, b) => (a.paper.published > b.paper.published ? 1 : a.paper.published < b.paper.published ? -1 : b.score - a.score))
  } else {
    hits.sort((a, b) => b.score - a.score)
  }
}
