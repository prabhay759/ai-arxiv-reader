import { useEffect, useRef, useState, type RefObject } from 'react'
import type { HighlightColor } from '@/types'

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']

/**
 * Floating menu shown over a text selection inside the reader.
 * Also handles the `h` shortcut, so highlighting works without the mouse.
 */
export function HighlightMenu({
  containerRef,
  onHighlight,
}: {
  containerRef: RefObject<HTMLElement | null>
  onHighlight: (color: HighlightColor) => void
}) {
  const [position, setPosition] = useState<{ x: number; y: number }>()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function updateFromSelection() {
      const selection = window.getSelection()
      const container = containerRef.current

      if (!selection || selection.isCollapsed || !container) {
        setPosition(undefined)
        return
      }
      const range = selection.getRangeAt(0)
      if (!container.contains(range.commonAncestorContainer)) {
        setPosition(undefined)
        return
      }

      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setPosition(undefined)
        return
      }
      setPosition({ x: rect.left + rect.width / 2, y: rect.top })
    }

    // selectionchange fires continuously while dragging; settling on pointerup
    // and keyup keeps the menu from flickering mid-drag.
    document.addEventListener('pointerup', updateFromSelection)
    document.addEventListener('keyup', updateFromSelection)
    return () => {
      document.removeEventListener('pointerup', updateFromSelection)
      document.removeEventListener('keyup', updateFromSelection)
    }
  }, [containerRef])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return
      }
      if (event.key !== 'h') return

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return
      event.preventDefault()
      onHighlight('yellow')
      setPosition(undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onHighlight])

  if (!position) return null

  return (
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Highlight selection"
      className="fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-full border border-edge bg-surface p-1 shadow-lg"
      style={{ left: position.x, top: position.y - 8 }}
      // Keep the selection alive: a mousedown inside the menu would clear it.
      onMouseDown={(event) => event.preventDefault()}
    >
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          title={`Highlight ${color}`}
          onClick={() => {
            onHighlight(color)
            setPosition(undefined)
          }}
          className="h-6 w-6 rounded-full border border-edge transition-transform hover:scale-110"
          style={{ background: `rgb(var(--hl-${color}))` }}
        >
          <span className="sr-only">Highlight {color}</span>
        </button>
      ))}
    </div>
  )
}
