import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import type { PaperSummary } from '@/types'
import { corpus } from '@/app/services'
import { categoryName, percentLabel } from '@/app/format'
import { useCorpusCategories } from '@/app/useManifest'
import { EmptyState, ErrorNote, Spinner } from '@/components/EmptyState'
import { PaperCard } from '@/components/PaperCard'
import { useCollapsed } from '@/app/uiPrefs'
import { clearProgress, continueReading } from '@/store/library'
import { db } from '@/store/db'

export default function Home() {
  const [recent, setRecent] = useState<PaperSummary[]>()
  const [error, setError] = useState<string>()
  const categories = useCorpusCategories()
  const [collapsed, toggleCollapsed] = useCollapsed('continue-reading')

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
          <div className="mb-3 flex items-baseline justify-between gap-3">
            {/* A button inside the heading, rather than beside it: the whole
                thing is the disclosure control, and screen readers still get
                a real heading to navigate by. */}
            <h2 id="continue-heading" className="text-lg font-semibold">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-controls="continue-panel"
                className="flex items-center gap-1.5 transition-colors hover:text-accent"
              >
                <Chevron open={!collapsed} />
                Continue reading
                <span className="text-sm font-normal tabular-nums text-faint">
                  {resuming.length}
                </span>
              </button>
            </h2>
            <Link to="/library" className="text-sm text-muted hover:text-ink">
              All saved →
            </Link>
          </div>

          {/* The wrapper carries `hidden` and no display utility of its own.
              Tailwind's `[hidden]{display:none}` and `.grid` have equal
              specificity, so putting both on one element leaves it visible. */}
          <div id="continue-panel" hidden={collapsed}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {resuming.map(({ progress, paper }) => (
                <li
                  key={paper.id}
                  className="card group relative p-3 transition-shadow hover:shadow-sm"
                >
                  {/* Stretched link: the card is one big target, but the
                      remove button stays a separate control rather than being
                      nested inside an anchor. */}
                  <Link
                    to={`/paper/${encodeURIComponent(paper.id)}`}
                    className="after:absolute after:inset-0 after:content-['']"
                  >
                    <p className="line-clamp-2 pr-6 text-sm font-medium group-hover:text-accent">
                      {paper.title}
                    </p>
                  </Link>

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

                  <button
                    type="button"
                    onClick={() => void clearProgress(paper.id)}
                    aria-label={`Remove ${paper.title} from Continue reading`}
                    title="Remove from Continue reading. Forgets your place; the paper, your highlights and your notes all stay."
                    className="absolute right-1.5 top-1.5 z-10 rounded p-1 leading-none text-faint opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="browse-heading">
        <h1 className="sr-only">arXiv AI Reader</h1>
        <h2 id="browse-heading" className="mb-3 text-lg font-semibold">
          Browse by category
        </h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
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

        {error && <ErrorNote message={error} offerOfflineReset />}

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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 text-faint transition-transform ${open ? '' : '-rotate-90'}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}
