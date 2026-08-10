import { create } from 'zustand'
import type { GoogleUser, ReaderSettings, ThemePreference } from '@/types'
import { DEFAULT_READER_SETTINGS } from '@/types'
import { readSettings, writeSettings } from '@/store/db'
import { applyTheme, readStoredTheme } from './theme'

export type SyncState =
  | { status: 'disabled' }
  | { status: 'signed-out' }
  | { status: 'syncing'; user: GoogleUser }
  | { status: 'idle'; user: GoogleUser; lastSyncAt: number }
  | { status: 'error'; user?: GoogleUser; message: string }

interface AppState {
  theme: ThemePreference
  reader: ReaderSettings
  sync: SyncState
  /** Set once settings have been read from IndexedDB. */
  hydrated: boolean

  hydrate: () => Promise<void>
  setTheme: (theme: ThemePreference) => void
  setReader: (changes: Partial<ReaderSettings>) => void
  setSync: (sync: SyncState) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Theme comes from localStorage synchronously (the inline script in
  // index.html already applied it) so there is no flash before hydration.
  theme: typeof window === 'undefined' ? 'system' : readStoredTheme(),
  reader: DEFAULT_READER_SETTINGS,
  sync: { status: 'signed-out' },
  hydrated: false,

  async hydrate() {
    const settings = await readSettings()
    set({ theme: settings.theme, reader: settings.reader, hydrated: true })
    applyTheme(settings.theme)
  },

  setTheme(theme) {
    set({ theme })
    applyTheme(theme)
    void writeSettings({ theme, reader: get().reader, updatedAt: Date.now() })
  },

  setReader(changes) {
    const reader = { ...get().reader, ...changes }
    set({ reader })
    void writeSettings({ theme: get().theme, reader, updatedAt: Date.now() })
  },

  setSync(sync) {
    set({ sync })
  },
}))

/** Push reader typography into CSS variables so the reader restyles live. */
export function applyReaderSettings(reader: ReaderSettings): void {
  const root = document.documentElement
  root.style.setProperty('--reader-font-size', `${reader.fontSize}px`)
  root.style.setProperty('--reader-line-height', String(reader.lineHeight))
  root.style.setProperty('--reader-measure', `${reader.measure}ch`)
  root.style.setProperty(
    '--reader-family',
    reader.family === 'serif'
      ? 'Charter, Georgia, Cambria, "Times New Roman", serif'
      : 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
  )
}
