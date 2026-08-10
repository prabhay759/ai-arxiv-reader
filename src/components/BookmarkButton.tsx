import { useLiveQuery } from 'dexie-react-hooks'
import type { PaperSummary } from '@/types'
import { db } from '@/store/db'
import { toggleBookmark } from '@/store/library'

export function BookmarkButton({
  paper,
  showLabel = false,
}: {
  paper: PaperSummary
  showLabel?: boolean
}) {
  const entry = useLiveQuery(() => db.library.get(paper.id), [paper.id])
  const saved = Boolean(entry && !entry.deleted)

  return (
    <button
      type="button"
      onClick={() => void toggleBookmark(paper)}
      aria-pressed={saved}
      title={saved ? 'Remove from library' : 'Save to library'}
      className={`btn shrink-0 ${showLabel ? '' : 'px-2'} ${
        saved ? 'text-accent' : 'text-muted'
      }`}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d="M5.5 3.5h9a1 1 0 0 1 1 1v12l-5.5-3.2L4.5 16.5v-12a1 1 0 0 1 1-1Z"
          fill={saved ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {showLabel && <span>{saved ? 'Saved' : 'Save'}</span>}
      <span className="sr-only">{saved ? 'Remove from library' : 'Save to library'}</span>
    </button>
  )
}
