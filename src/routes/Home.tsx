import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import type { PaperSummary } from '@/types'
import { corpus } from '@/app/services'
import { PRIMARY_CATEGORIES, categoryName, percentLabel } from '@/app/format'
import { EmptyState, ErrorNote, Spinner } from '@/components/EmptyState'
import { PaperCard } from '@/components/PaperCard'
import { continueReading } from '@/store/library'
import { db } from '@/store/db'

export default function Home() {
  const [recent, setRecent] = useState<PaperSummary[]>()
  const [error, setError] = useState<string>()

  // Re-reads whenever progress changes, so finishing a paper drops it from
  // the shelf immediately.
  const resuming = useLiveQuery(async () => {
    await db.progress.count()
    return continueReading(8)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    corpus
      .recent(controller.signal)
      .then(setRecent)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="space-y-10">
      {/* The section headings carry the visual hierarchy, but the page still
          needs a single top-level heading for screen readers. Rendered inside
          the first section so it doesn't pick up the stack's spacing. */}
      {resuming && resuming.length > 0 && (
        <section aria-labelledby="continue-heading">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="continue-heading" className="text-lg font-semibold">
              Continue reading
            </h2>
            <Link to="/library" className="text-sm text-muted hover:text-ink">
              All saved →
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {resuming.map(({ progress, paper }) => (
              <Link
                key={paper.id}
                to={`/paper/${encodeURIComponent(paper.id)}`}
                className="card group p-3 transition-shadow hover:shadow-sm"
              >
                <p className="line-clamp-2 text-sm font-medium group-hover:text-accent">
                  {paper.title}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full bg-accent"
                      style={{ width: percentLabel(progress.anchor.percent) }}
                    />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-faint">
                    {percentLabel(progress.anchor.percent)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="browse-heading">
        <h1 className="sr-only">arXiv AI Reader</h1>
        <h2 id="browse-heading" className="mb-3 text-lg font-semibold">
          Browse by category
        </h2>
        <div className="flex flex-wrap gap-2">
          {PRIMARY_CATEGORIES.map((category) => (
            <Link
              key={category}
              to={`/search?cat=${encodeURIComponent(category)}&sort=newest`}
              className="btn text-sm"
              title={categoryName(category)}
            >
              <span className="font-mono text-xs">{category}</span>
              <span className="hidden text-muted sm:inline">{categoryName(category)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="recent-heading" className="text-lg font-semibold">
            Latest AI papers
          </h2>
          <Link to="/search?sort=newest" className="text-sm text-muted hover:text-ink">
            See all →
          </Link>
        </div>

        {error && <ErrorNote message={error} />}

        {!error && !recent && <Spinner label="Loading latest papers" />}

        {recent && recent.length === 0 && (
          <EmptyState
            title="No papers yet"
            description="The index has been built but contains no papers. Check config/corpus.json."
          />
        )}

        {recent && recent.length > 0 && (
          <div className="space-y-3">
            {recent.slice(0, 20).map((paper) => (
              <PaperCard key={paper.id} paper={paper} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
