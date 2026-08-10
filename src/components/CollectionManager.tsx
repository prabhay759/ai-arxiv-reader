import { useState } from 'react'
import type { Collection, HighlightColor } from '@/types'
import { createCollection, deleteCollection, renameCollection } from '@/store/library'

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']

export function CollectionManager({
  collections,
  activeId,
  onSelect,
}: {
  collections: Collection[]
  activeId?: string
  onSelect: (id?: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string>()

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Collections</h2>
        <button
          type="button"
          className="text-xs text-muted hover:text-ink"
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? 'Cancel' : '+ New'}
        </button>
      </div>

      {creating && (
        <form
          className="mb-2 flex gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim()) return
            void createCollection(name, COLORS[collections.length % COLORS.length])
            setName('')
            setCreating(false)
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Collection name"
            aria-label="Collection name"
            className="input py-1 text-sm"
          />
          <button type="submit" className="btn btn-primary px-2 text-sm">
            Add
          </button>
        </form>
      )}

      <ul className="space-y-0.5">
        <li>
          <button
            type="button"
            onClick={() => onSelect(undefined)}
            aria-pressed={!activeId}
            className={`w-full rounded-md px-1.5 py-1 text-left text-sm ${
              !activeId ? 'bg-raised font-medium' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            All papers
          </button>
        </li>

        {collections.map((collection) => (
          <li key={collection.id} className="group flex items-center gap-1">
            {editingId === collection.id ? (
              <form
                className="flex-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  const input = (event.target as HTMLFormElement).elements.namedItem(
                    'name'
                  ) as HTMLInputElement
                  void renameCollection(collection.id, input.value)
                  setEditingId(undefined)
                }}
              >
                <input
                  name="name"
                  autoFocus
                  defaultValue={collection.name}
                  onBlur={() => setEditingId(undefined)}
                  aria-label="Rename collection"
                  className="input py-0.5 text-sm"
                />
              </form>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSelect(collection.id)}
                  onDoubleClick={() => setEditingId(collection.id)}
                  aria-pressed={activeId === collection.id}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm ${
                    activeId === collection.id
                      ? 'bg-raised font-medium'
                      : 'text-muted hover:bg-raised hover:text-ink'
                  }`}
                  title="Double-click to rename"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: `rgb(var(--hl-${collection.color}))` }}
                  />
                  <span className="truncate">{collection.name}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete the collection “${collection.name}”? The papers in it are kept.`)) {
                      void deleteCollection(collection.id)
                      if (activeId === collection.id) onSelect(undefined)
                    }
                  }}
                  className="px-1 text-xs text-faint opacity-0 transition-opacity hover:text-accent focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete collection ${collection.name}`}
                >
                  ×
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
