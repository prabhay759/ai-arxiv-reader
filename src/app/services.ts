import { CorpusClient } from '@/search/corpus'
import { SearchEngine } from '@/search/engine'

/**
 * Shared singletons. The corpus client caches shards in memory for the
 * session, so it must be created once rather than per component.
 */
export const DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`

export const corpus = new CorpusClient(DATA_BASE_URL)
export const searchEngine = new SearchEngine(corpus)

/** Public OAuth client id. Absent in guest-only deployments. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
export const SYNC_AVAILABLE = GOOGLE_CLIENT_ID.length > 0

export const ARXIV_ABS = (id: string) => `https://arxiv.org/abs/${id}`
export const ARXIV_PDF = (id: string) => `https://arxiv.org/pdf/${id}`
export const ARXIV_HTML = (id: string) => `https://arxiv.org/html/${id}`
