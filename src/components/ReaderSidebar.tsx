import { useEffect, useState } from 'react'
import type { Highlight, PaperSummary, ReaderMode } from '@/types'
import { deleteHighlight, getNote, saveNote, updateHighlight } from '@/store/highlights'

type Tab = 'contents' | 'notes'

export function ReaderSidebar({
  paper,
  mode,
  toc,
  outline,
  highlights,
  progressLabel,
}: {
  paper: PaperSummary
  mode: ReaderMode
  toc: Array<{ id: string; label: string; level: number }>
  outline: Array<{ label: string; page: number }>
  highlights: Highlight[]
  progressLabel: string
}) {
  const [tab, setTab] = useState<Tab>('contents')
  const [note, setNote] = useState('')
  const [savedAt, setSavedAt] = useState<number>()

  useEffect(() => {
    let cancelled = false
    void getNote(paper.id).then((existing) => {
      if (!cancelled) setNote(existing?.body ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [paper.id])

  // Debounced autosave; notes should never need an explicit save button.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveNote(paper.id, note).then(() => setSavedAt(Date.now()))
    }, 700)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note])

  const contents = mode === 'html' ? toc : outline

  function scrollToSection(sectionId: string) {
    const element = document.querySelector<HTMLElement>(`[id="${CSS.escape(sectionId)}"]`)
    if (!element) return
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 96, behavior: 'smooth' })
  }

  function scrollToPage(page: number) {
    const element = document.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (!element) return
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 96, behavior: 'smooth' })
  }

  return (
    <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
      <p className="mb-3 text-xs text-faint">{progressLabel}</p>

      <div className="mb-3 flex gap-1" role="tablist" aria-label="Reader panels">
        {(['contents', 'notes'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            type="button"
            onClick={() => setTab(value)}
            className={`flex-1 rounded-lg px-2 py-1 text-sm capitalize transition-colors ${
              tab === value ? 'bg-raised font-medium text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {value}
            {value === 'notes' && highlights.length > 0 && (
              <span className="ml-1 text-xs text-faint">{highlights.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'contents' && (
        <nav aria-label="Table of contents">
          {contents.length === 0 ? (
            <p className="text-xs text-faint">
              {mode === 'html'
                ? 'No sections detected in this paper.'
                : 'This PDF has no embedded outline.'}
            </p>
          ) : (
            <ul className="space-y-0.5 text-sm">
              {mode === 'html'
                ? toc.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(entry.id)}
                        className={`block w-full truncate rounded px-1.5 py-1 text-left text-muted hover:bg-raised hover:text-ink ${
                          entry.level === 2 ? 'pl-4 text-xs' : ''
                        }`}
                        title={entry.label}
                      >
                        {entry.label}
                      </button>
                    </li>
                  ))
                : outline.map((entry, index) => (
                    <li key={`${entry.page}-${index}`}>
                      <button
                        type="button"
                        onClick={() => scrollToPage(entry.page)}
                        className="flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-muted hover:bg-raised hover:text-ink"
                      >
                        <span className="truncate" title={entry.label}>
                          {entry.label}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-faint">{entry.page}</span>
                      </button>
                    </li>
                  ))}
            </ul>
          )}
        </nav>
      )}

      {tab === 'notes' && (
        <div className="space-y-4">
          <div>
            <label htmlFor="paper-note" className="mb-1 block text-xs font-medium text-muted">
              Notes on this paper
            </label>
            <textarea
              id="paper-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={6}
              placeholder="Your notes…"
              className="input resize-y font-sans"
            />
            {savedAt && (
              <p className="mt-1 text-right text-xs text-faint" role="status">
                Saved
              </p>
            )}
          </div>

          {highlights.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
                Highlights
              </h3>
              <ul className="space-y-2">
                {highlights.map((highlight) => (
                  <li key={highlight.id} className="rounded-lg border border-edge bg-surface p-2">
                    <blockquote
                      className="border-l-2 pl-2 text-xs leading-relaxed text-muted"
                      style={{ borderColor: `rgb(var(--hl-${highlight.color}))` }}
                    >
                      {highlight.anchor.exact.slice(0, 220)}
                      {highlight.anchor.exact.length > 220 && '…'}
                    </blockquote>

                    <textarea
                      value={highlight.note ?? ''}
                      onChange={(event) =>
                        void updateHighlight(highlight.id, { note: event.target.value })
                      }
                      rows={1}
                      placeholder="Add a note…"
                      className="mt-1.5 w-full resize-y rounded border border-edge bg-canvas px-1.5 py-1 text-xs"
                      aria-label="Note on highlight"
                    />

                    <div className="mt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void deleteHighlight(highlight.id)}
                        className="text-xs text-faint hover:text-accent"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  )
}
