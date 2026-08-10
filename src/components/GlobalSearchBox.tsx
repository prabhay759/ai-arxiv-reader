import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listSearchHistory } from '@/store/library'
import { extractArxivId } from '@/search/parser'
import type { SearchHistoryEntry } from '@/types'

/**
 * Header search box. Pasting an arXiv id or URL jumps straight to the paper
 * instead of searching — that path doesn't touch the index at all, so it works
 * for any paper on arXiv, including ones outside the built corpus.
 */
export function GlobalSearchBox() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const [history, setHistory] = useState<SearchHistoryEntry[]>([])
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Keep in sync when the Search route changes the query (back button, chips).
  useEffect(() => {
    setValue(params.get('q') ?? '')
  }, [params])

  useEffect(() => {
    function onFocusSearch() {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('app:focus-search', onFocusSearch)
    return () => window.removeEventListener('app:focus-search', onFocusSearch)
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function openSuggestions() {
    setHistory(await listSearchHistory(6))
    setOpen(true)
  }

  function submit(query: string) {
    const trimmed = query.trim()
    setOpen(false)
    if (!trimmed) return

    const arxivId = extractArxivId(trimmed)
    if (arxivId) {
      navigate(`/paper/${encodeURIComponent(arxivId)}`)
      return
    }
    navigate(`/search?q=${encodeURIComponent(trimmed)}`)
  }

  const detectedId = extractArxivId(value)

  return (
    <div ref={containerRef} className="relative">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          submit(value)
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search arXiv AI papers
        </label>
        <div className="relative">
          <SearchIcon />
          <input
            id="global-search"
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={openSuggestions}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false)
                inputRef.current?.blur()
              }
            }}
            placeholder="Search papers, or paste an arXiv link"
            className="input pl-9"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
          />
        </div>
      </form>

      {open && (detectedId || history.length > 0) && (
        <div
          id={listId}
          className="absolute left-0 right-0 top-full z-40 mt-1 animate-fade-in overflow-hidden rounded-xl border border-edge bg-surface shadow-lg"
        >
          {detectedId && (
            <button
              type="button"
              onClick={() => submit(value)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-raised"
            >
              <span className="chip">arXiv</span>
              <span>
                Open paper <strong>{detectedId}</strong>
              </span>
            </button>
          )}

          {!detectedId &&
            history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setValue(entry.query)
                  submit(entry.query)
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-raised"
              >
                <span className="truncate text-muted">{entry.query}</span>
                <span className="shrink-0 text-xs text-faint">{entry.resultCount} results</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
      fill="none"
    >
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
