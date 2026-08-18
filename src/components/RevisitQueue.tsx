import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { cleanLatex } from '@/app/format'
import { db } from '@/store/db'
import { clearRevisit, listRevisits } from '@/store/readingUnits'

/**
 * Sections you marked fuzzy or lost, across every paper.
 *
 * This is what the rating is *for*. Without somewhere the flags accumulate and
 * lead back to the text, rating a section is data entry with no payoff — and a
 * prompt with no payoff is one people stop answering honestly.
 */
export function RevisitQueue() {
  const items = useLiveQuery(async () => {
    const units = await listRevisits(12)
    const papers = new Map(
      (await db.papers.bulkGet([...new Set(units.map((unit) => unit.paperId))]))
        .filter(Boolean)
        .map((paper) => [paper!.id, paper!])
    )
    return units.map((unit) => ({ unit, title: papers.get(unit.paperId)?.title }))
  }, [])

  if (!items || items.length === 0) return null

  return (
    <section aria-labelledby="revisit-heading">
      <h2
        id="revisit-heading"
        className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint"
      >
        Revisit
      </h2>

      <ul className="space-y-1">
        {items.map(({ unit, title }) => (
          <li key={unit.id} className="group flex items-start gap-1">
            <Link
              to={`/paper/${unit.paperId}?unit=${encodeURIComponent(unit.unitKey)}`}
              className="min-w-0 flex-1 rounded px-1.5 py-1 text-sm hover:bg-raised"
            >
              <span className="block truncate">{unit.label}</span>
              <span className="block truncate text-xs text-faint">
                {title ? cleanLatex(title) : unit.paperId}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => void clearRevisit(unit.id)}
              title="Clear this flag"
              aria-label={`Clear revisit flag on ${unit.label}`}
              className="mt-1 rounded px-1 text-xs text-faint opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
