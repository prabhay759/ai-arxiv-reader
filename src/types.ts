/** Shared domain types. Mirrored by the CI index builder in scripts/. */

/** Bare arXiv id without version suffix, e.g. "2608.07460". */
export type PaperId = string

/** Compact display record — what the search index resolves hits to. */
export interface PaperSummary {
  id: PaperId
  title: string
  authors: string[]
  categories: string[]
  /** Original submission date, ISO yyyy-mm-dd. */
  published: string
  /** Latest version date, ISO yyyy-mm-dd. Absent when identical to published. */
  updated?: string
}

/** Full record, including the abstract. Fetched lazily from a monthly shard. */
export interface PaperDetail extends PaperSummary {
  abstract: string
  comment?: string
  doi?: string
  journalRef?: string
}

export type ReaderMode = 'html' | 'pdf'

/**
 * A resumable position inside a paper.
 *
 * HTML anchors reference LaTeXML's stable element ids (e.g. "S3.p2"), so the
 * position survives font-size, window-width and zoom changes that would
 * invalidate a raw pixel offset. `percent` is the fallback when the anchor
 * element can't be found (arXiv occasionally re-renders a paper's HTML).
 */
export interface ReadingAnchor {
  mode: ReaderMode
  /** HTML mode: id of the nearest block element at the top of the viewport. */
  elementId?: string
  /** HTML mode: character offset into that element's text. */
  charOffset?: number
  /** PDF mode: 1-based page number. */
  page?: number
  /** PDF mode: fraction (0-1) scrolled through that page, zoom-independent. */
  pageOffset?: number
  /** Fraction (0-1) through the whole document. Always set; fallback + UI. */
  percent: number
}

export interface ReadingProgress {
  paperId: PaperId
  anchor: ReadingAnchor
  /** Total pages (pdf) or sections (html), for "x of y" display. */
  total?: number
  updatedAt: number
  deleted?: boolean
}

export type ReadStatus = 'unread' | 'reading' | 'finished'

export interface LibraryEntry {
  paperId: PaperId
  status: ReadStatus
  starred: boolean
  collectionIds: string[]
  tags: string[]
  addedAt: number
  updatedAt: number
  deleted?: boolean
}

export interface Collection {
  id: string
  name: string
  /** Index into the highlight palette; also used for the collection dot. */
  color: HighlightColor
  order: number
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

/**
 * Text anchoring for highlights uses a quote-based strategy (exact text plus
 * surrounding context) rather than raw offsets, so a highlight survives arXiv
 * re-rendering a paper. `elementId`/`page` narrow the search window first.
 */
export interface HighlightAnchor {
  mode: ReaderMode
  elementId?: string
  page?: number
  exact: string
  prefix: string
  suffix: string
}

export interface Highlight {
  id: string
  paperId: PaperId
  color: HighlightColor
  anchor: HighlightAnchor
  /** Optional note attached to this specific highlight. */
  note?: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export interface Note {
  /** One free-form note per paper; highlight notes live on the highlight. */
  paperId: PaperId
  body: string
  updatedAt: number
  deleted?: boolean
}

export interface SavedSearch {
  id: string
  name: string
  query: string
  filters: SearchFilters
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

export interface SearchHistoryEntry {
  id: string
  query: string
  at: number
  resultCount: number
}

export type SortMode = 'relevance' | 'newest' | 'oldest'

export interface SearchFilters {
  categories: string[]
  /** ISO yyyy-mm-dd, inclusive. */
  from?: string
  to?: string
  sort: SortMode
}

export const EMPTY_FILTERS: SearchFilters = { categories: [], sort: 'relevance' }

export type ThemePreference = 'light' | 'dark' | 'system'

export interface ReaderSettings {
  fontSize: number
  lineHeight: number
  measure: number
  family: 'serif' | 'sans'
  /** Preferred mode; the reader still falls back when HTML is unavailable. */
  preferredMode: ReaderMode
  pdfInvertInDark: boolean
}

export interface AppSettings {
  theme: ThemePreference
  reader: ReaderSettings
  updatedAt: number
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.7,
  measure: 68,
  family: 'serif',
  preferredMode: 'html',
  pdfInvertInDark: true,
}

/** Shape of the JSON document synced to the user's Drive appDataFolder. */
export interface SyncDocument {
  schema: 1
  updatedAt: number
  progress: ReadingProgress[]
  library: LibraryEntry[]
  collections: Collection[]
  highlights: Highlight[]
  notes: Note[]
  savedSearches: SavedSearch[]
  settings?: AppSettings
}

export interface GoogleUser {
  email: string
  name: string
  picture?: string
}
