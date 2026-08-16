import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { applyReaderSettings, useAppStore } from '@/app/store'
import { applyTheme, watchSystemTheme } from '@/app/theme'
import { GlobalSearchBox } from './GlobalSearchBox'
import { KeyboardShortcuts, useGlobalShortcuts } from './KeyboardShortcuts'
import { RefreshButton } from './RefreshButton'
import { SyncIndicator } from './SyncIndicator'
import { UpdatePrompt } from './UpdatePrompt'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/search', label: 'Search', end: false },
  { to: '/library', label: 'Library', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export function AppLayout() {
  const hydrate = useAppStore((s) => s.hydrate)
  const theme = useAppStore((s) => s.theme)
  const reader = useAppStore((s) => s.reader)
  const location = useLocation()

  useGlobalShortcuts()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    applyReaderSettings(reader)
  }, [reader])

  // Keep a "system" preference honest when the OS theme changes mid-session.
  useEffect(() => {
    if (theme !== 'system') return
    return watchSystemTheme(() => applyTheme('system'))
  }, [theme])

  // The reader manages its own scroll restoration; every other route should
  // start at the top on navigation.
  const isReader = location.pathname.startsWith('/paper/')
  useEffect(() => {
    if (!isReader) window.scrollTo(0, 0)
  }, [location.pathname, isReader])

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-edge bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          <NavLink
            to="/"
            className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <LogoMark />
            <span className="hidden sm:inline">arXiv AI Reader</span>
          </NavLink>

          <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
            <GlobalSearchBox />
          </div>

          <nav aria-label="Main" className="flex items-center gap-0.5">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-raised font-medium text-ink'
                      : 'text-muted hover:bg-raised hover:text-ink'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <SyncIndicator />
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 focus:outline-none">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-faint">
        <p>
          Paper metadata and full text from{' '}
          <a className="underline hover:text-ink" href="https://arxiv.org">
            arXiv.org
          </a>
          , used under arXiv&rsquo;s terms. This reader is not affiliated with arXiv.
        </p>
      </footer>

      <KeyboardShortcuts />
      <RefreshButton />
      <UpdatePrompt />
    </div>
  )
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" aria-hidden="true" fill="none">
      <path
        d="M5 4.5A1.5 1.5 0 0 1 6.5 3H16l3.5 3.5V19a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M15.5 3v4h4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 12h7M8.5 15.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
