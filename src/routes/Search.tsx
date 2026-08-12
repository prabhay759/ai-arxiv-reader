import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { corpus, searchEngine } from '@/app/services'
import { EmptyState, ErrorNote, Spinner } from '@/components/EmptyState'
import { PaperCard } from '@/components/PaperCard'
import { SearchFiltersPanel } from '@/components/SearchFiltersPanel'
import { parseQuery } from '@/search/parser'
import type { SearchHit } from '@/search/engine'
import { recordSearch, saveSearch } from '@/store/library'
import type { SearchFilters, SortMode } from '@/types'

const PAGE_SIZE = 25

/** Filters live in the URL so every search is a shareable, back-button-able link. */
function filtersFromParams(params: URLSearchParams): SearchFilters {
  const categories = params.getAll('cat')
  const sort = (params.get('sort') as SortMode) ?? 'relevance'
  return {
    categories,
    sort: ['relevance', 'newest', 'oldest'].includes(sort) ? sort : 'relevance',
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  }
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const filters = useMemo(() => filtersFromParams(params), [params])

  const [hits, setHits] = useState<SearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [totalKnown, setTotalKnown] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [tookMs, setTookMs] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [focusIndex, setFocusIndex] = useState(-1)
  const [snippets, setSnippets] = useState<Record<string, string>>({})

  const resultRefs = useRef<Array<HTMLDivElement | null>>([])
  const highlightTerms = useMemo(
    () => parseQuery(query).terms.filter((t) => !t.negated).map((t) => t.term),
    [query]
  )

  const runSearch = useCallback(
    async (offset: number, signal: AbortSignal) => {
      const result = await searchEngine.search({
        query,
        filters,
        offset,
        limit: PAGE_SIZE,
        signal,
      })
      return result
    },
    [query, filters]
  )

  // Initial + re-run on query/filter change.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    setFocusIndex(-1)

    runSearch(0, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setHits(result.hits)
        setTotal(result.total)
        setTotalKnown(result.totalKnown)
        setHasMore(result.hasMore)
        setNotice(result.notice)
        setTookMs(result.tookMs)
        if (query.trim()) void recordSearch(query, result.total)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [runSearch, query])

  // Abstract snippets are fetched lazily for the visible page only — they live
  // in monthly metadata shards, so pulling them for every candidate would
  // defeat the point of the two-tier index.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    Promise.all(
      hits.slice(0, PAGE_SIZE).map(async (hit) => {
        try {
          const detail = await corpus.detail(hit.paper, controller.signal)
          return [hit.paper.id, buildSnippet(detail.abstract, highlightTerms)] as const
        } catch {
          return [hit.paper.id, ''] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      setSnippets(Object.fromEntries(entries.filter(([, snippet]) => snippet)))
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [hits, highlightTerms])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    const controller = new AbortController()
    try {
      const result = await runSearch(hits.length, controller.signal)
      setHits((current) => [...current, ...result.hits])
      setTotal(result.total)
      setTotalKnown(result.totalKnown)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [hits.length, hasMore, loading, runSearch])

  // j/k result navigation, scoped to this route.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof HTMLElement) {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
          return
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        setFocusIndex((current) => {
          const next = event.key === 'j' ? current + 1 : current - 1
          const clamped = Math.max(0, Math.min(hits.length - 1, next))
          resultRefs.current[clamped]?.scrollIntoView({ block: 'nearest' })
          return clamped
        })
      } else if (event.key === 'Enter' && focusIndex >= 0) {
        const link = resultRefs.current[focusIndex]?.querySelector('a')
        link?.click()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hits.length, focusIndex])

  function updateFilters(next: SearchFilters) {
    const updated = new URLSearchParams()
    if (query) updated.set('q', query)
    next.categories.forEach((category) => updated.append('cat', category))
    if (next.sort !== 'relevance') updated.set('sort', next.sort)
    if (next.from) updated.set('from', next.from)
    if (next.to) updated.set('to', next.to)
    setParams(updated)
  }

  const hasQuery = query.trim().length > 0 || filters.categories.length > 0

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <SearchFiltersPanel
        filters={filters}
        onChange={updateFilters}
        onSave={
          hasQuery
            ? () => void saveSearch(query || filters.categories.join(', '), query, filters)
            : undefined
        }
      />

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold">
            {!hasQuery ? (
              'Browse papers'
            ) : totalKnown ? (
              <>
                {total.toLocaleString()} result{total === 1 ? '' : 's'}
                {query && <span className="text-muted"> for “{query}”</span>}
              </>
            ) : (
              <>
                {/* The search stopped early, so the exact count isn't known —
                    say what is true rather than print the partial number. */}
                Top results
                {query && <span className="text-muted"> for “{query}”</span>}
              </>
            )}
          </h1>
          {tookMs > 0 && hasQuery && (
            <span className="text-xs text-faint">{Math.round(tookMs)} ms</span>
          )}
        </div>

        {notice && hasQuery && (
          <p className="mb-4 rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-muted">
            {notice}
          </p>
        )}

        {error && (
          <ErrorNote message={error} onRetry={() => setParams(params)} offerOfflineReset />
        )}

        {!error && hits.length === 0 && !loading && (
          <EmptyState
            title={hasQuery ? 'No papers matched' : 'Start searching'}
            description={
              hasQuery
                ? 'Try fewer words, or drop a filter. You can also search by field — ti:diffusion, au:"Yann LeCun", cat:cs.LG — or paste an arXiv link to open a paper directly.'
                : 'Search by title, author or abstract text. Try “retrieval augmented generation”, au:"Yoshua Bengio", or paste an arXiv link.'
            }
          />
        )}

        <div className="space-y-3">
          {hits.map((hit, index) => (
            <PaperCard
              key={hit.paper.id}
              ref={(node) => {
                resultRefs.current[index] = node
              }}
              paper={hit.paper}
              highlightTerms={highlightTerms}
              snippet={snippets[hit.paper.id]}
              focused={index === focusIndex}
            />
          ))}
        </div>

        {loading && <Spinner label="Searching" />}

        {!loading && hits.length > 0 && hasMore && (
          <div className="mt-4 flex justify-center">
            <button type="button" className="btn" onClick={() => void loadMore()}>
              {totalKnown
                ? `Load more (${(total - hits.length).toLocaleString()} remaining)`
                : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Pick the region of the abstract around the first matched term, so the
 * snippet shows why the paper matched instead of just its opening sentence.
 */
function buildSnippet(abstract: string, terms: string[], length = 260): string {
  if (!abstract) return ''
  if (terms.length === 0) return abstract.slice(0, length)

  const lower = abstract.toLowerCase()
  let best = -1
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase())
    if (found !== -1 && (best === -1 || found < best)) best = found
  }
  if (best === -1) return abstract.slice(0, length)

  const start = Math.max(0, best - 60)
  const snippet = abstract.slice(start, start + length)
  return `${start > 0 ? '…' : ''}${snippet}${start + length < abstract.length ? '…' : ''}`
}
