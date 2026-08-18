import { useCallback, useState } from 'react'

/**
 * Per-device view preferences.
 *
 * Deliberately localStorage rather than the synced settings document: whether
 * a panel is folded away depends on the screen you are looking at, so pushing
 * it between devices would be a misfeature, not a feature. It also keeps the
 * sync schema out of it.
 */
const PREFIX = 'arxiv-reader:ui:'

/** Exported for tests: the fallback paths are the part that can crash a render. */
export function read(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(PREFIX + key)
    return stored === null ? fallback : stored === '1'
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return fallback
  }
}

export function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, value ? '1' : '0')
  } catch {
    // A preference that cannot be stored is not worth failing a render over.
  }
}

/**
 * Collapsed state for a panel, remembered across visits.
 *
 * Remembering is the whole point: a panel that springs back open on every
 * page load has not really been collapsed, it has been dismissed for a
 * moment.
 */
export function useCollapsed(key: string, initial = false): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => read(key, initial))

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      write(key, !previous)
      return !previous
    })
  }, [key])

  return [collapsed, toggle]
}
