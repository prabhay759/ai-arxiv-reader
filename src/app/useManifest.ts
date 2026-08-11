import { useEffect, useState } from 'react'
import { corpus } from './services'
import { PRIMARY_CATEGORIES } from './format'
import type { Manifest } from '@/search/corpus'

/**
 * Read the deployed index's manifest.
 *
 * Returns undefined while loading, and null when no index is deployed (the
 * caller decides what to show). Errors are swallowed on purpose: this backs
 * secondary UI like the category filter list and the freshness panel, and the
 * routes that actually need the index already surface their own errors.
 */
export function useManifest(): Manifest | null | undefined {
  const [manifest, setManifest] = useState<Manifest | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    corpus
      .manifest()
      .then((value) => {
        if (!cancelled) setManifest(value)
      })
      .catch(() => {
        if (!cancelled) setManifest(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return manifest
}

/**
 * Categories the deployed index actually contains.
 *
 * Sourced from the manifest rather than a second hardcoded list, so narrowing
 * config/corpus.json can never leave the filter panel offering categories that
 * return nothing. Falls back to the built-in list before the manifest loads.
 */
export function useCorpusCategories(): string[] {
  const manifest = useManifest()
  return manifest?.categories?.length ? manifest.categories : PRIMARY_CATEGORIES
}
