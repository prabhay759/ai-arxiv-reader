import type { Highlight, HighlightAnchor } from '@/types'

const HIGHLIGHT_CLASS = 'reader-highlight'

/**
 * Draw stored highlights onto rendered paper text.
 *
 * Uses the CSS Custom Highlight API where available, which paints ranges
 * without touching the DOM at all — important here because the paper markup
 * contains MathML, and wrapping <span>s through a formula would corrupt its
 * rendering. Browsers without it fall back to wrapping, which is limited to
 * ranges that stay inside a single text node so math is never split.
 */
export function paintHighlights(
  container: HTMLElement,
  highlights: Highlight[],
  locate: (container: HTMLElement, anchor: HighlightAnchor) => Range | null,
  onSelect: (id: string) => void
): void {
  clearHighlights(container)
  if (highlights.length === 0) return

  const supportsHighlightApi =
    typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'

  const byColor = new Map<string, Range[]>()

  for (const highlight of highlights) {
    const range = locate(container, highlight.anchor)
    if (!range) continue

    if (supportsHighlightApi) {
      const ranges = byColor.get(highlight.color) ?? []
      ranges.push(range)
      byColor.set(highlight.color, ranges)
    } else {
      wrapRange(range, highlight, onSelect)
    }
  }

  if (supportsHighlightApi) {
    for (const [color, ranges] of byColor) {
      CSS.highlights.set(`${HIGHLIGHT_CLASS}-${color}`, new Highlight(...ranges))
    }
  }
}

export function clearHighlights(container: HTMLElement): void {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
    for (const key of [...CSS.highlights.keys()]) {
      if (key.startsWith(HIGHLIGHT_CLASS)) CSS.highlights.delete(key)
    }
  }

  container.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
    const parent = node.parentNode
    if (!parent) return
    while (node.firstChild) parent.insertBefore(node.firstChild, node)
    parent.removeChild(node)
    parent.normalize()
  })
}

/**
 * DOM fallback. Only wraps ranges contained in one text node — a range
 * spanning elements would need splitting that can break MathML, and a missing
 * highlight is far better than a mangled equation.
 */
function wrapRange(range: Range, highlight: Highlight, onSelect: (id: string) => void): void {
  if (range.startContainer !== range.endContainer) return
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return

  try {
    const mark = document.createElement('mark')
    mark.className = `${HIGHLIGHT_CLASS} ${HIGHLIGHT_CLASS}--${highlight.color}`
    mark.dataset.highlightId = highlight.id
    mark.addEventListener('click', () => onSelect(highlight.id))
    range.surroundContents(mark)
  } catch {
    // surroundContents throws on partially-selected non-text nodes; skip.
  }
}
