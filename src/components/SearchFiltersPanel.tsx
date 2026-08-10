import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { PRIMARY_CATEGORIES, categoryName } from '@/app/format'
import { db } from '@/store/db'
import { deleteSavedSearch } from '@/store/library'
import type { SearchFilters, SortMode } from '@/types'

const SORTS: Array<{ value: SortMode; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

export function SearchFiltersPanel({
  filters,
  onChange,
  onSave,
}: {
  filters: SearchFilters
  onChange: (filters: SearchFilters) => void
  onSave?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const saved = useLiveQuery(async () => {
    const rows = await db.savedSearches.toArray()
    return rows.filter((row) => !row.deleted).sort((a, b) => b.createdAt - a.createdAt)
  }, [])

  function toggleCategory(category: string) {
    const next = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category]
    onChange({ ...filters, categories: next })
  }

  const activeCount =
    filters.categories.length + (filters.from ? 1 : 0) + (filters.to ? 1 : 0)

  return (
    <aside className="lg:sticky lg:top-20 lg:self-start">
      <button
        type="button"
        className="btn w-full justify-between lg:hidden"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span>Filters{activeCount > 0 && ` (${activeCount})`}</span>
        <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>

      <div className={`${expanded ? 'block' : 'hidden'} mt-3 space-y-5 lg:mt-0 lg:block`}>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Sort
          </legend>
          <div className="flex flex-wrap gap-1">
            {SORTS.map((sort) => (
              <button
                key={sort.value}
                type="button"
                onClick={() => onChange({ ...filters, sort: sort.value })}
                aria-pressed={filters.sort === sort.value}
                className={`rounded-lg px-2.5 py-1 text-sm transition-colors ${
                  filters.sort === sort.value
                    ? 'bg-accent text-accent-ink'
                    : 'bg-raised text-muted hover:text-ink'
                }`}
              >
                {sort.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Category
          </legend>
          <div className="space-y-1">
            {PRIMARY_CATEGORIES.map((category) => (
              <label
                key={category}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-raised"
              >
                <input
                  type="checkbox"
                  checked={filters.categories.includes(category)}
                  onChange={() => toggleCategory(category)}
                  className="accent-[rgb(var(--c-accent))]"
                />
                <span className="font-mono text-xs">{category}</span>
                <span className="truncate text-xs text-faint" title={categoryName(category)}>
                  {categoryName(category)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Published
          </legend>
          <div className="space-y-2">
            <label className="block text-xs text-muted">
              From
              <input
                type="date"
                value={filters.from ?? ''}
                onChange={(event) =>
                  onChange({ ...filters, from: event.target.value || undefined })
                }
                className="input mt-0.5"
              />
            </label>
            <label className="block text-xs text-muted">
              To
              <input
                type="date"
                value={filters.to ?? ''}
                onChange={(event) => onChange({ ...filters, to: event.target.value || undefined })}
                className="input mt-0.5"
              />
            </label>
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          {activeCount > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => onChange({ categories: [], sort: filters.sort })}
            >
              Clear filters
            </button>
          )}
          {onSave && (
            <button type="button" className="btn" onClick={onSave}>
              Save search
            </button>
          )}
        </div>

        {saved && saved.length > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
              Saved searches
            </h2>
            <ul className="space-y-1">
              {saved.map((entry) => {
                const params = new URLSearchParams()
                if (entry.query) params.set('q', entry.query)
                entry.filters.categories.forEach((c) => params.append('cat', c))
                if (entry.filters.sort !== 'relevance') params.set('sort', entry.filters.sort)
                if (entry.filters.from) params.set('from', entry.filters.from)
                if (entry.filters.to) params.set('to', entry.filters.to)

                return (
                  <li key={entry.id} className="flex items-center gap-1">
                    <Link
                      to={`/search?${params}`}
                      className="min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-sm text-muted hover:bg-raised hover:text-ink"
                    >
                      {entry.name}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void deleteSavedSearch(entry.id)}
                      className="btn btn-ghost px-1.5 py-0.5 text-xs"
                      aria-label={`Delete saved search ${entry.name}`}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </aside>
  )
}
