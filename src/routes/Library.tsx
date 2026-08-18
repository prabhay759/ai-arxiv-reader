import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import type { HighlightColor, PaperSummary, ReadStatus } from '@/types'
import { percentLabel } from '@/app/format'
import { EmptyState } from '@/components/EmptyState'
import { PaperCard } from '@/components/PaperCard'
import { CollectionManager } from '@/components/CollectionManager'
import { RevisitQueue } from '@/components/RevisitQueue'
import { db } from '@/store/db'
import { listCollections, listLibrary, setCollections, setTags } from '@/store/library'
import { searchNotes } from '@/store/highlights'

const STATUS_TABS: Array<{ value: ReadStatus | 'all' | 'starred'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'reading', label: 'Reading' },
  { value: 'unread', label: 'Unread' },
  { value: 'finished', label: 'Finished' },
  { value: 'starred', label: 'Starred' },
]

export default function Library() {
  const [statusTab, setStatusTab] = useState<ReadStatus | 'all' | 'starred'>('all')
  const [activeCollection, setActiveCollection] = useState<string>()
  const [activeTag, setActiveTag] = useState<string>()
  const [noteQuery, setNoteQuery] = useState('')

  const entries = useLiveQuery(async () => {
    const rows = await listLibrary()
    const papers = new Map<string, PaperSummary>()
    for (const row of rows) {
      const paper = await db.papers.get(row.paperId)
      if (paper) papers.set(row.paperId, paper)
    }
    const progress = await db.progress.toArray()
    return {
      rows,
      papers,
      progress: new Map(progress.filter((p) => !p.deleted).map((p) => [p.paperId, p])),
    }
  }, [])

  const collections = useLiveQuery(() => listCollections(), [])

  const noteResults = useLiveQuery(async () => {
    if (!noteQuery.trim()) return []
    return searchNotes(noteQuery)
  }, [noteQuery])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of entries?.rows ?? []) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [entries])

  const visible = useMemo(() => {
    if (!entries) return []
    return entries.rows.filter((row) => {
      if (statusTab === 'starred' && !row.starred) return false
      if (statusTab !== 'all' && statusTab !== 'starred' && row.status !== statusTab) return false
      if (activeCollection && !row.collectionIds.includes(activeCollection)) return false
      if (activeTag && !row.tags.includes(activeTag)) return false
      return true
    })
  }, [entries, statusTab, activeCollection, activeTag])

  if (!entries) return null

  if (entries.rows.length === 0) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Library</h1>
        <EmptyState
          title="Your library is empty"
          description="Save a paper from search or while reading and it shows up here, along with your reading progress, highlights and notes. Everything is stored on this device; sign in to sync it across devices."
          action={
            <Link to="/search" className="btn btn-primary">
              Find papers
            </Link>
          }
        />
      </>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <h1 className="sr-only">Library</h1>
      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <CollectionManager
          collections={collections ?? []}
          activeId={activeCollection}
          onSelect={setActiveCollection}
        />

        <RevisitQueue />

        {tags.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Tags</h2>
            <div className="flex flex-wrap gap-1">
              {tags.map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag(activeTag === tag ? undefined : tag)}
                  aria-pressed={activeTag === tag}
                  className={`chip transition-colors ${
                    activeTag === tag ? 'border-accent text-accent' : 'hover:text-ink'
                  }`}
                >
                  {tag}
                  <span className="text-faint">{count}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <label
            htmlFor="note-search"
            className="mb-2 block text-xs font-semibold uppercase tracking-wide text-faint"
          >
            Search notes
          </label>
          <input
            id="note-search"
            type="search"
            value={noteQuery}
            onChange={(event) => setNoteQuery(event.target.value)}
            placeholder="Find in notes and highlights"
            className="input"
          />
          {noteResults && noteResults.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {noteResults.slice(0, 12).map((result, index) => (
                <li key={`${result.paperId}-${index}`}>
                  <Link
                    to={`/paper/${encodeURIComponent(result.paperId)}`}
                    className="block rounded-md px-1.5 py-1 hover:bg-raised"
                  >
                    <span className="line-clamp-1 text-xs font-medium">
                      {result.title ?? result.paperId}
                    </span>
                    <span className="line-clamp-2 text-xs text-faint">{result.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {noteQuery.trim() && noteResults?.length === 0 && (
            <p className="mt-2 text-xs text-faint">No matching notes.</p>
          )}
        </section>
      </aside>

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Reading status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={statusTab === tab.value}
              type="button"
              onClick={() => setStatusTab(tab.value)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                statusTab === tab.value
                  ? 'bg-accent text-accent-ink'
                  : 'bg-raised text-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description="No saved papers match this filter. Try a different status, collection or tag."
          />
        ) : (
          <div className="space-y-3">
            {visible.map((row) => {
              const paper = entries.papers.get(row.paperId)
              if (!paper) return null
              const progress = entries.progress.get(row.paperId)

              return (
                <PaperCard key={row.paperId} paper={paper}>
                  <div className="mt-2 space-y-2">
                    {progress && (
                      <div className="flex items-center gap-2">
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
                    )}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <TagEditor paperId={row.paperId} tags={row.tags} />
                      <CollectionPicker
                        paperId={row.paperId}
                        collections={collections ?? []}
                        selected={row.collectionIds}
                      />
                    </div>
                  </div>
                </PaperCard>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function TagEditor({ paperId, tags }: { paperId: string; tags: string[] }) {
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')

  return (
    <>
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          className="chip hover:text-accent"
          onClick={() => void setTags(paperId, tags.filter((t) => t !== tag))}
          title={`Remove tag ${tag}`}
        >
          {tag} <span aria-hidden="true">×</span>
        </button>
      ))}

      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (value.trim()) void setTags(paperId, [...tags, value])
            setValue('')
            setAdding(false)
          }}
        >
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setAdding(false)}
            placeholder="tag"
            aria-label="New tag"
            className="w-20 rounded-full border border-edge bg-canvas px-2 py-0.5 text-xs"
          />
        </form>
      ) : (
        <button type="button" className="chip text-faint hover:text-ink" onClick={() => setAdding(true)}>
          + tag
        </button>
      )}
    </>
  )
}

function CollectionPicker({
  paperId,
  collections,
  selected,
}: {
  paperId: string
  collections: Array<{ id: string; name: string; color: HighlightColor }>
  selected: string[]
}) {
  if (collections.length === 0) return null

  return (
    <select
      value=""
      onChange={(event) => {
        const id = event.target.value
        if (!id) return
        void setCollections(
          paperId,
          selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]
        )
      }}
      className="rounded-full border border-edge bg-raised px-2 py-0.5 text-xs text-muted"
      aria-label="Add to collection"
    >
      <option value="">+ collection</option>
      {collections.map((collection) => (
        <option key={collection.id} value={collection.id}>
          {selected.includes(collection.id) ? '✓ ' : ''}
          {collection.name}
        </option>
      ))}
    </select>
  )
}
