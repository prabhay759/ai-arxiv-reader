import { CorpusClient } from '@/search/corpus'
import { SearchEngine } from '@/search/engine'

/**
 * Shared singletons. The corpus client caches shards in memory for the
 * session, so it must be created once rather than per component.
 */
export const DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`

export const corpus = new CorpusClient(DATA_BASE_URL)
export const searchEngine = new SearchEngine(corpus)

/**
 * OAuth client id for Google sign-in.
 *
 * Committed deliberately. A browser OAuth client id is a public identifier,
 * not a secret — it is visible in the JavaScript bundle and in every request
 * the app makes, and Google's security model expects that. What protects the
 * client is the Authorised JavaScript origins list, not obscurity.
 *
 * (The client *secret* issued alongside it is a real credential. This app
 * never uses one: the token flow is a public-client flow, so there is nothing
 * here to keep secret.)
 *
 * Set the VITE_GOOGLE_CLIENT_ID repository variable to override this — useful
 * for a fork, or for pointing a local build at a different client.
 */
const DEFAULT_GOOGLE_CLIENT_ID =
  '791645468718-cijs0ac750gmi2ct2qn39glc6a8uuljg.apps.googleusercontent.com'

export const GOOGLE_CLIENT_ID = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || DEFAULT_GOOGLE_CLIENT_ID
).trim()
export const SYNC_AVAILABLE = GOOGLE_CLIENT_ID.length > 0

export const ARXIV_ABS = (id: string) => `https://arxiv.org/abs/${id}`
export const ARXIV_PDF = (id: string) => `https://arxiv.org/pdf/${id}`
export const ARXIV_HTML = (id: string) => `https://arxiv.org/html/${id}`
