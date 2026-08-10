import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { PaperSummary, ReaderMode, ReadStatus } from '@/types'
import { ARXIV_PDF } from '@/app/services'
import { copyToClipboard, toBibTeX } from '@/app/format'
import { db } from '@/store/db'
import { setReadStatus, setStarred } from '@/store/library'
import { ReaderSettingsMenu } from './ReaderSettingsMenu'

const STATUSES: Array<{ value: ReadStatus; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'finished', label: 'Finished' },
]

export function PaperToolbar({
  paper,
  mode,
  onModeChange,
}: {
  paper: PaperSummary
  mode: ReaderMode
  onModeChange: (mode: ReaderMode) => void
  progressPercent: number
}) {
  const [copied, setCopied] = useState<string>()
  const entry = useLiveQuery(() => db.library.get(paper.id), [paper.id])
  const inLibrary = Boolean(entry && !entry.deleted)

  async function copy(label: string, text: string) {
    const ok = await copyToClipboard(text)
    setCopied(ok ? label : 'Copy failed')
    window.setTimeout(() => setCopied(undefined), 1800)
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-edge" role="group" aria-label="Reading mode">
        {(['html', 'pdf'] as ReaderMode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            aria-pressed={mode === value}
            className={`px-3 py-1.5 text-sm transition-colors ${
              mode === value ? 'bg-accent text-accent-ink' : 'bg-surface text-muted hover:bg-raised'
            }`}
          >
            {value === 'html' ? 'Reader' : 'PDF'}
          </button>
        ))}
      </div>

      {inLibrary && (
        <>
          <label className="sr-only" htmlFor="read-status">
            Reading status
          </label>
          <select
            id="read-status"
            value={entry?.status ?? 'unread'}
            onChange={(event) => void setReadStatus(paper.id, event.target.value as ReadStatus)}
            className="rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm"
          >
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`btn px-2 ${entry?.starred ? 'text-accent' : 'text-muted'}`}
            onClick={() => void setStarred(paper.id, !entry?.starred)}
            aria-pressed={entry?.starred ?? false}
            title={entry?.starred ? 'Unstar' : 'Star'}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path
                d="m10 2.5 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L2.2 8.2l5.4-.8L10 2.5Z"
                fill={entry?.starred ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <span className="sr-only">{entry?.starred ? 'Unstar paper' : 'Star paper'}</span>
          </button>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {copied && (
          <span role="status" className="text-xs text-muted">
            {copied}
          </span>
        )}

        <button type="button" className="btn text-sm" onClick={() => void copy('BibTeX copied', toBibTeX(paper))}>
          BibTeX
        </button>
        <button
          type="button"
          className="btn text-sm"
          onClick={() => void copy('Link copied', window.location.href)}
        >
          Share
        </button>
        <a className="btn text-sm" href={ARXIV_PDF(paper.id)} download target="_blank" rel="noreferrer">
          PDF
        </a>
        <ReaderSettingsMenu mode={mode} />
      </div>
    </div>
  )
}
