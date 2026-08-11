import type { PaperSummary } from '@/types'

const CATEGORY_NAMES: Record<string, string> = {
  'cs.AI': 'Artificial Intelligence',
  'cs.LG': 'Machine Learning',
  'cs.CL': 'Computation and Language',
  'cs.CV': 'Computer Vision',
  'cs.NE': 'Neural and Evolutionary Computing',
  'cs.RO': 'Robotics',
  'cs.IR': 'Information Retrieval',
  'cs.MA': 'Multiagent Systems',
  'stat.ML': 'Machine Learning (Statistics)',
  'cs.CR': 'Cryptography and Security',
  'cs.HC': 'Human-Computer Interaction',
  'cs.SE': 'Software Engineering',
  'cs.DC': 'Distributed Computing',
  'cs.SD': 'Sound',
  'eess.IV': 'Image and Video Processing',
  'eess.AS': 'Audio and Speech Processing',
}

export function categoryName(code: string): string {
  return CATEGORY_NAMES[code] ?? code
}

/**
 * Make a LaTeX-flavoured abstract readable as plain text.
 *
 * arXiv abstracts are author-submitted LaTeX, so they routinely contain
 * `\emph{...}`, custom macros like `\methodname{...}`, inline math, TeX quotes
 * and tildes. Rendering them raw looks broken. This unwraps the common
 * constructs and leaves anything it doesn't recognise alone — the goal is a
 * cleaner read, not a TeX engine.
 */
export function cleanLatex(text: string): string {
  if (!text) return ''
  let out = text

  // Unwrap \command{content} repeatedly so nested macros collapse too.
  // Bounded iteration: a pathological input must not spin here.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(/\\[a-zA-Z@]+\s*\{([^{}]*)\}/g, '$1')
    if (next === out) break
    out = next
  }

  return out
    // Math delimiters: keep the contents, drop the $ and \( \) markers.
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/\\[()[\]]/g, '')
    // Bare commands with no argument (\alpha, \\, \noindent).
    .replace(/\\[a-zA-Z@]+/g, '')
    .replace(/\\\\/g, ' ')
    // TeX quoting and dashes.
    .replace(/``|''/g, '"')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    // Non-breaking space and leftover grouping braces.
    .replace(/~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fallback category list, used only until the manifest loads. The deployed
 * index is the real source of truth — see useCorpusCategories().
 */
export const PRIMARY_CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV', 'cs.NE', 'stat.ML']

export function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function relativeDate(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(Math.round(seconds), 'second')
}

/** "Vaswani et al." for long lists, full list when short. */
export function formatAuthors(authors: string[], max = 3): string {
  if (authors.length === 0) return 'Unknown author'
  if (authors.length <= max) return authors.join(', ')
  return `${authors.slice(0, max).join(', ')} and ${authors.length - max} more`
}

export function percentLabel(fraction: number): string {
  return `${Math.min(100, Math.max(0, Math.round(fraction * 100)))}%`
}

/**
 * Rough reading-time estimate. Papers average ~600 words per page and people
 * read technical prose at ~180 wpm; this is a hint, not a promise.
 */
export function readingTimeRemaining(percent: number, totalPages?: number): string {
  const pages = totalPages && totalPages > 0 ? totalPages : 12
  const minutesTotal = (pages * 600) / 180
  const remaining = Math.max(0, minutesTotal * (1 - percent))
  if (remaining < 1) return 'less than a minute left'
  if (remaining < 60) return `${Math.round(remaining)} min left`
  return `${Math.round((remaining / 60) * 10) / 10} h left`
}

/** BibTeX entry for a paper, using arXiv's own citation conventions. */
export function toBibTeX(paper: PaperSummary): string {
  const firstAuthor = (paper.authors[0] ?? 'unknown').split(' ').pop()?.toLowerCase() ?? 'unknown'
  const year = paper.published.slice(0, 4)
  const firstTitleWord =
    paper.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .find((word) => word.length > 3) ?? 'paper'

  return [
    `@misc{${firstAuthor}${year}${firstTitleWord},`,
    `  title  = {${paper.title}},`,
    `  author = {${paper.authors.join(' and ')}},`,
    `  year   = {${year}},`,
    `  eprint = {${paper.id}},`,
    `  archivePrefix = {arXiv},`,
    `  primaryClass = {${paper.categories[0] ?? 'cs.AI'}},`,
    `  url    = {https://arxiv.org/abs/${paper.id}}`,
    '}',
  ].join('\n')
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API needs a secure context and permission; fall back to the
    // legacy path so copy still works on http:// dev servers.
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}
