import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PaperDetail } from '@/types'
import { corpus } from '@/app/services'
import { cleanLatex, formatAuthors, formatDate } from '@/app/format'
import { findRelated, type RelatedPaper } from '@/search/related'

/**
 * Papers close to this one, computed from the search index in the browser.
 *
 * Deliberately lazy. A related-papers query pulls index shards the reader may
 * not otherwise need — measured at roughly seven shards and a few megabytes on
 * a cold cache — so nothing is fetched until this scrolls into view. Someone
 * who reads a paper and leaves pays nothing for a panel they never saw.
 */
export function RelatedPapers({ paper }: { paper: PaperDetail }) {
  const [related, setRelated] = useState<RelatedPaper[]>()
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(false)
  const anchor = useRef<HTMLElement>(null)

  useEffect(() => {
    setRelated(undefined)
    setFailed(false)
    setVisible(false)
  }, [paper.id])

  useEffect(() => {
    const node = anchor.current
    if (!node || visible) return

    // No IntersectionObserver (very old Safari) just means eager instead of
    // lazy — a slower first load, not a broken panel.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '600px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible, paper.id])

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()

    findRelated(corpus, paper, 6, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setRelated(rows)
      })
      .catch(() => {
        // Secondary panel: a failure here must not disturb the reader.
        if (!controller.signal.aborted) setFailed(true)
      })

    return () => controller.abort()
  }, [visible, paper])

  // Nothing to say is better than an empty box: papers outside the built
  // corpus have no abstract indexed and so no neighbours to offer.
  if (failed || (related && related.length === 0)) return null

  return (
    <section ref={anchor} aria-labelledby="related-heading" className="mt-10">
      <h2 id="related-heading" className="mb-3 text-lg font-semibold">
        Related papers
      </h2>

      {!related ? (
        <div className="space-y-2" aria-busy="true" aria-label="Finding related papers">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-lg bg-raised" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {related.map(({ paper: row }) => (
            <li key={row.id}>
              <Link
                to={`/paper/${encodeURIComponent(row.id)}`}
                className="card group block p-3 transition-shadow hover:shadow-sm"
              >
                <p className="text-sm font-medium group-hover:text-accent">
                  {cleanLatex(row.title)}
                </p>
                <p className="mt-1 truncate text-xs text-muted">
                  {formatAuthors(row.authors, 3)}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
                  {row.categories.slice(0, 3).map((category) => (
                    <span key={category} className="chip">
                      {category}
                    </span>
                  ))}
                  <span>{formatDate(row.published)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
