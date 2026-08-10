import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import type { PaperSummary } from '@/types'
import { cleanLatex, formatAuthors, formatDate } from '@/app/format'
import { BookmarkButton } from './BookmarkButton'

interface PaperCardProps {
  paper: PaperSummary
  /** Terms to visually emphasise in the title and snippet. */
  highlightTerms?: string[]
  snippet?: string
  focused?: boolean
  /** Rendered under the title, e.g. reading progress in the library. */
  children?: React.ReactNode
}

export const PaperCard = forwardRef<HTMLDivElement, PaperCardProps>(function PaperCard(
  { paper, highlightTerms = [], snippet, focused = false, children },
  ref
) {
  return (
    <div
      ref={ref}
      className={`card p-4 transition-shadow ${
        focused ? 'ring-2 ring-accent' : 'hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug">
          <Link
            to={`/paper/${encodeURIComponent(paper.id)}`}
            className="hover:text-accent hover:underline"
          >
            <Emphasise text={cleanLatex(paper.title)} terms={highlightTerms} />
          </Link>
        </h3>
        <BookmarkButton paper={paper} />
      </div>

      <p className="mt-1.5 text-sm text-muted">{formatAuthors(paper.authors)}</p>

      {snippet && (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">
          <Emphasise text={cleanLatex(snippet)} terms={highlightTerms} />
        </p>
      )}

      {children}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {paper.categories.slice(0, 4).map((category) => (
          <span key={category} className="chip">
            {category}
          </span>
        ))}
        <span className="ml-auto text-xs text-faint">
          {formatDate(paper.published)}
          {paper.updated && (
            <span title={`Revised ${formatDate(paper.updated)}`}> · revised</span>
          )}
        </span>
      </div>
    </div>
  )
})

/**
 * Wraps matched terms in <mark>. Splits on a built regex rather than doing
 * innerHTML, so paper titles containing markup-like text stay inert.
 */
export function Emphasise({ text, terms }: { text: string; terms: string[] }) {
  const unique = [...new Set(terms.filter((term) => term.length > 1))]
  if (unique.length === 0) return <>{text}</>

  const pattern = new RegExp(`(${unique.map(escapeRegExp).join('|')})`, 'gi')
  const parts = text.split(pattern)

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="rounded bg-accent/20 px-0.5 text-inherit"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
