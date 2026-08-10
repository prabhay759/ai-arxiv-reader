import type { PaperDetail } from '@/types'
import { ARXIV_HTML, corpus } from '@/app/services'
import { cachePaper, cachedPaper } from '@/store/db'

/**
 * Resolve a paper's metadata by arXiv id.
 *
 * The built index only covers the configured AI categories within the
 * configured history window, but the app must still open *any* arXiv paper —
 * a pasted link to a 2017 classic, or something from a category we don't
 * index. So this walks a fallback chain, cheapest and most complete first:
 *
 *   1. the static index          (offline-capable, full metadata)
 *   2. the local cache           (a paper opened before, works offline)
 *   3. arXiv's HTML page         (CORS-open; title/authors/abstract)
 *   4. a bare record             (id only — the PDF reader still works)
 *
 * Step 3 is why pasting any arXiv link works even though we can't reach
 * arXiv's metadata API from the browser (it sends no CORS header).
 */
export async function resolvePaper(id: string, signal?: AbortSignal): Promise<PaperDetail> {
  if (!id) throw new Error('No paper id given.')

  try {
    const summary = await corpus.findById(id, signal)
    if (summary) {
      const detail = await corpus.detail(summary, signal)
      void cachePaper(summary)
      return detail
    }
  } catch {
    // Index unreachable (offline, or not built yet): keep going down the chain.
  }

  const cached = await cachedPaper(id)

  try {
    const scraped = await scrapeArxivHtml(id, signal)
    if (scraped) {
      void cachePaper(scraped)
      return scraped
    }
  } catch {
    // Offline or no HTML version; fall through.
  }

  if (cached) return { ...cached, abstract: '' }

  return {
    id,
    title: `arXiv:${id}`,
    authors: [],
    categories: [],
    published: '',
    abstract: '',
  }
}

/**
 * Pull metadata out of arXiv's LaTeXML HTML page. Only used for papers outside
 * the built index, so the cost is paid rarely.
 */
async function scrapeArxivHtml(
  id: string,
  signal?: AbortSignal
): Promise<PaperDetail | null> {
  const response = await fetch(ARXIV_HTML(id), { signal })
  if (!response.ok) return null

  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html')
  if (!parsed.querySelector('.ltx_page_main')) return null

  const title = clean(parsed.querySelector('.ltx_title_document')?.textContent)
  if (!title) return null

  const authors = [...parsed.querySelectorAll('.ltx_personname')]
    .flatMap(extractAuthorNames)
    .filter((name) => name.length > 1 && name.length < 80)

  return {
    id,
    title,
    authors: [...new Set(authors)],
    categories: [],
    published: '',
    abstract: clean(parsed.querySelector('.ltx_abstract p')?.textContent),
  }
}

/**
 * Pull clean names out of a LaTeXML author block.
 *
 * The markup is messier than it looks. A single `.ltx_personname` often holds
 * *every* author, separated by "&" (LaTeX's \and), and within each author the
 * name, affiliation and email are separated by `<br>`. Footnote markers are
 * interleaved as nested nodes. Raw textContent therefore yields
 * "Ashish Vaswani Google Brain avaswani@google.com &Noam Shazeer1..." — so we
 * split on "&", then keep only the first line of each block.
 */
function extractAuthorNames(node: Element): string[] {
  const clone = node.cloneNode(true) as Element
  clone
    .querySelectorAll('.ltx_note, .ltx_note_outer, .ltx_note_mark, .ltx_note_content')
    .forEach((extra) => extra.remove())

  // Breaks carry the name/affiliation/email structure; make them visible to
  // textContent so each author's first line can be isolated.
  clone.querySelectorAll('br, .ltx_break').forEach((brk) => brk.replaceWith('\n'))

  return (clone.textContent ?? '')
    .split('&')
    .flatMap((block) => {
      const firstLine = block.split('\n').find((line) => line.trim().length > 0) ?? ''
      // A comma-separated list occasionally appears on one line instead.
      return firstLine.split(/,\s*|\s+and\s+/)
    })
    .map((part) =>
      clean(part)
        .replace(/\S+@\S+/g, '')
        .replace(/\d*footnotemark.*$/i, '')
        .replace(/[\d*†‡§¶]+$/, '')
        .trim()
    )
    .filter(Boolean)
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}
