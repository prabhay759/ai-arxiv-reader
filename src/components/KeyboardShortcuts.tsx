import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: '/', description: 'Focus the search box' },
  { keys: 'j / k', description: 'Next / previous result' },
  { keys: 'Enter', description: 'Open the focused result' },
  { keys: 'b', description: 'Bookmark the focused or open paper' },
  { keys: 'h', description: 'Highlight the current selection' },
  { keys: 'm', description: 'Switch between HTML and PDF view' },
  { keys: 'g h', description: 'Go home' },
  { keys: 'g l', description: 'Go to library' },
  { keys: '?', description: 'Show this help' },
]

/** True when focus is somewhere that should receive raw keystrokes. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Global keyboard shortcuts. Route-local keys (j/k on results, h in a reader)
 * are handled by those views; this covers app-wide navigation only, so the two
 * layers never fight over the same key.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate()

  useEffect(() => {
    let pendingG = false
    let pendingGTimer: number | undefined

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      if (pendingG) {
        pendingG = false
        window.clearTimeout(pendingGTimer)
        if (event.key === 'h') {
          event.preventDefault()
          navigate('/')
          return
        }
        if (event.key === 'l') {
          event.preventDefault()
          navigate('/library')
          return
        }
      }

      switch (event.key) {
        case '/':
          event.preventDefault()
          window.dispatchEvent(new CustomEvent('app:focus-search'))
          break
        case '?':
          event.preventDefault()
          window.dispatchEvent(new CustomEvent('app:toggle-shortcuts'))
          break
        case 'g':
          pendingG = true
          pendingGTimer = window.setTimeout(() => {
            pendingG = false
          }, 900)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(pendingGTimer)
    }
  }, [navigate])
}

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function toggle() {
      setOpen((value) => !value)
    }
    window.addEventListener('app:toggle-shortcuts', toggle)
    return () => window.removeEventListener('app:toggle-shortcuts', toggle)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md animate-slide-up rounded-xl border border-edge bg-surface p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <dl className="divide-y divide-edge">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-sm text-muted">{shortcut.description}</dt>
              <dd>
                <kbd className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-xs">
                  {shortcut.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
