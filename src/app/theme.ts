import type { ThemePreference } from '@/types'

export const THEME_STORAGE_KEY = 'arxiv-reader:theme'

/** Resolve a preference to the concrete theme actually applied to the page. */
export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function readStoredTheme(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    // Private-mode / disabled storage: fall through to the default.
  }
  return 'system'
}

export function applyTheme(pref: ThemePreference): void {
  const resolved = resolveTheme(pref)
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.style.colorScheme = resolved
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

/**
 * Keep a "system" preference live when the OS theme flips mid-session.
 * Returns an unsubscribe function.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
