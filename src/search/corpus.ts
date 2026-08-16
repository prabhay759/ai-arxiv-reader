import type { PaperDetail, PaperSummary } from '@/types'

/** Postings are flat triplets: [docIdDelta, fieldMask, quantizedWeight]. */
export type PostingList = number[]
export type IndexShard = Record<string, PostingList>

export interface Manifest {
  schema: 1
  builtAt: string
  docCount: number
  docsPerChunk: number
  chunkCount: number
  prefixLength: number
  categories: string[]
  abstractCutoff: string
  newestPublished: string
  oldestPublished: string
  avgFieldLengths: { title: number; author: number; category: number; abstract: number }
  shards: string[]
  metaShards: string[]
  idShards: string[]
  stats: { termCount: number; postingCount: number }
}

/**
 * Shard key for an arXiv id. MUST match idShardKey() in
 * scripts/build-index.mjs or paper lookups silently 404.
 */
export function idShardKey(id: string): string {
  const modern = /^(\d{4})\./.exec(id)
  if (modern) return modern[1]
  return id.split(/[./]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '_') || 'other'
}

/** Positional tuple written by scripts/build-index.mjs. */
type SummaryTuple = [
  id: string,
  title: string,
  authors: string[],
  categories: string[],
  published: string,
  updated: string | 0,
]

const GZIP_MAGIC = [0x1f, 0x8b]

/**
 * Fetch a `.json.gz` shard.
 *
 * GitHub Pages serves `.gz` files as opaque bytes without a `Content-Encoding`
 * header, so the browser does NOT transparently decompress them — we do it
 * here with DecompressionStream. But some hosts (and dev servers) *do* set
 * that header, in which case fetch already decompressed the body. Sniffing the
 * gzip magic bytes handles both without needing to know which host we're on.
 */
/**
 * Decompress a gzipped shard.
 *
 * DecompressionStream is the cheap path and is used where available (Chrome
 * 80+, Firefox 113+, Safari 16.4+). Older browsers fall back to a JS inflate
 * so the app still works rather than reporting a corrupt index — the failure
 * mode this replaces was indistinguishable, to the reader, from the corpus
 * being missing.
 */
async function gunzip(buffer: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      return await new Response(
        new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
      ).text()
    } catch {
      // Fall through to the JS implementation rather than failing outright.
    }
  }

  const { gunzipSync } = await import('fflate')
  return new TextDecoder().decode(gunzipSync(new Uint8Array(buffer)))
}

async function fetchShard<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })

  // Only 404 means the shard genuinely doesn't exist — no paper uses that
  // term, or that month has no papers. Callers turn that into an empty
  // result. Any other status is a transport or hosting failure, and must not
  // be reported to the reader as "nothing matched": a 503 presented as zero
  // results is a silent lie about the corpus.
  if (response.status === 404) throw new ShardMissingError(url, 404)
  if (!response.ok) {
    throw new Error(`Could not load part of the search index (HTTP ${response.status}).`)
  }

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isGzipped = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]

  let text: string
  try {
    text = isGzipped ? await gunzip(buffer) : new TextDecoder().decode(buffer)
  } catch (error) {
    throw new CorpusPayloadError(
      url,
      `could not be decompressed (${error instanceof Error ? error.message : 'unknown error'})`
    )
  }

  assertJsonPayload(text, url)
  return JSON.parse(text) as T
}

/**
 * A missing data file doesn't 404 here: the SPA fallback (404.html on Pages,
 * the dev server's history fallback locally) answers with index.html and a
 * 200. Parsing that as JSON produces `Unexpected token '<'`, which tells the
 * user nothing. Detect it and say what is actually wrong.
 */
function assertJsonPayload(text: string, url: string): void {
  const start = text.trimStart()[0]
  if (start === '{' || start === '[') return

  // Deliberately NOT IndexUnavailableError. This function runs on every shard
  // too, so reusing the "index has not been built" error here meant an
  // unreadable *shard* was reported as a missing *index* — which sent
  // debugging in entirely the wrong direction.
  throw new CorpusPayloadError(
    url,
    `returned ${describePayload(text)} where JSON was expected`
  )
}

function describePayload(text: string): string {
  const head = text.trimStart().slice(0, 40)
  if (/^<!doctype html|^<html/i.test(head)) return 'an HTML page'
  if (head.length === 0) return 'an empty response'
  return `unexpected content ("${head.replace(/\s+/g, ' ')}…")`
}

/** The file was reachable but its contents were not usable. */
export class CorpusPayloadError extends Error {
  constructor(
    readonly url: string,
    detail: string
  ) {
    super(`${url} ${detail}.`)
    this.name = 'CorpusPayloadError'
  }
}

export class IndexUnavailableError extends Error {
  constructor(readonly url: string) {
    // Name the URL that 404ed. Without it this reads as a blanket "the app is
    // broken", and there is no way for anyone — user or maintainer — to tell
    // a genuinely missing index from a stale cache pointing at the wrong path.
    super(
      `The search index could not be found at ${url} (404). ` +
        'If the site was just deployed this can be a stale cached copy — clearing offline ' +
        'data below usually fixes it. Otherwise the index has not been built for this deployment.'
    )
    this.name = 'IndexUnavailableError'
  }
}

export class ShardMissingError extends Error {
  constructor(
    readonly url: string,
    readonly status: number
  ) {
    super(`Shard unavailable (${status}): ${url}`)
    this.name = 'ShardMissingError'
  }
}

/**
 * Loads and caches the static corpus.
 *
 * Everything is cached in memory for the session; the service worker caches it
 * across sessions, which is what makes search work offline. Concurrent
 * requests for the same shard share one fetch, so a multi-term query issued
 * twice in quick succession doesn't double-fetch.
 */
export class CorpusClient {
  private manifestPromise?: Promise<Manifest>
  private readonly shards = new Map<string, Promise<IndexShard | null>>()
  private readonly docChunks = new Map<number, Promise<PaperSummary[]>>()
  private readonly metaShards = new Map<string, Promise<Record<string, MetaEntry> | null>>()
  private readonly idShards = new Map<string, Promise<Record<string, number> | null>>()

  constructor(private readonly baseUrl: string) {}

  /**
   * URL for a data file, stamped with the build it belongs to.
   *
   * Doc ids are assigned newest-first at build time, so a single new paper
   * shifts every id in the corpus. That makes shards from two different builds
   * mutually unreadable: a posting list from Tuesday's index resolved against
   * Wednesday's doc chunks returns the wrong papers entirely — silently, with
   * no error anywhere. Since the paths themselves are stable, the only thing
   * separating one build's files from another's is this stamp.
   *
   * It doubles as cache busting. The service worker caches `/data/` files
   * first-from-cache for 30 days, which is right for a file that never changes
   * and wrong for one that changes every six hours; versioning the URL means a
   * new build is simply a cache miss instead of something that has to expire.
   */
  private async versioned(path: string): Promise<string> {
    const { builtAt } = await this.manifest()
    return `${this.baseUrl}${path}?v=${builtAt.replace(/\D/g, '')}`
  }

  manifest(): Promise<Manifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.loadManifest()
      // A failed manifest must not be cached forever; let the next call retry.
      this.manifestPromise.catch(() => {
        this.manifestPromise = undefined
      })
    }
    return this.manifestPromise
  }

  /**
   * Fetch the manifest, reporting *why* it failed rather than assuming.
   *
   * The manifest lives at a stable URL whose contents change with every
   * deploy, so a stale copy — in the HTTP cache or held by a service worker
   * from an earlier build — can wedge the app while the site itself is
   * perfectly healthy. It is therefore fetched revalidated, and retried once
   * with the cache fully bypassed before giving up.
   */
  private async loadManifest(): Promise<Manifest> {
    const url = `${this.baseUrl}manifest.json`

    for (const cache of ['no-cache', 'reload'] as RequestCache[]) {
      let response: Response
      try {
        response = await fetch(url, { cache })
      } catch {
        if (cache === 'reload') {
          throw new Error(
            navigator.onLine === false
              ? "You appear to be offline, and this index hasn't been cached on this device yet."
              : 'Could not reach the search index. Check your connection and try again.'
          )
        }
        continue
      }

      if (response.ok) {
        const text = await response.text()
        assertJsonPayload(text, url)
        return JSON.parse(text) as Manifest
      }

      // 404 is the one status that actually means "no index deployed here".
      // Everything else is a transport or hosting problem, and saying
      // "run the build" would send the reader off fixing the wrong thing.
      if (response.status === 404) throw new IndexUnavailableError(url)
      if (cache === 'reload') {
        throw new Error(
          `The search index could not be loaded (HTTP ${response.status}). ` +
            'This is usually temporary — try again in a moment.'
        )
      }
    }

    throw new IndexUnavailableError(url)
  }

  /** Returns null when the shard doesn't exist — i.e. no paper has that term. */
  async shard(key: string, signal?: AbortSignal): Promise<IndexShard | null> {
    let pending = this.shards.get(key)
    if (!pending) {
      pending = this.versioned(`index/${key}.json.gz`)
        .then((url) => fetchShard<IndexShard>(url, signal))
        .catch((error) => {
          if (error instanceof ShardMissingError) return null
          this.shards.delete(key)
          throw error
        })
      this.shards.set(key, pending)
    }
    return pending
  }

  async docChunk(chunk: number, signal?: AbortSignal): Promise<PaperSummary[]> {
    let pending = this.docChunks.get(chunk)
    if (!pending) {
      pending = this.versioned(`docs/${chunk}.json.gz`)
        .then((url) => fetchShard<SummaryTuple[]>(url, signal))
        .then((rows) => rows.map(toSummary))
      pending.catch(() => this.docChunks.delete(chunk))
      this.docChunks.set(chunk, pending)
    }
    return pending
  }

  /**
   * Resolve doc ids to display records, fetching only the chunks involved.
   * Ids are grouped so a page of results costs one fetch per distinct chunk.
   */
  async resolve(docIds: number[], signal?: AbortSignal): Promise<Map<number, PaperSummary>> {
    const manifest = await this.manifest()
    const byChunk = new Map<number, number[]>()
    for (const docId of docIds) {
      const chunk = Math.floor(docId / manifest.docsPerChunk)
      const bucket = byChunk.get(chunk)
      if (bucket) bucket.push(docId)
      else byChunk.set(chunk, [docId])
    }

    const resolved = new Map<number, PaperSummary>()
    await Promise.all(
      [...byChunk.entries()].map(async ([chunk, ids]) => {
        const rows = await this.docChunk(chunk, signal)
        for (const docId of ids) {
          const row = rows[docId - chunk * manifest.docsPerChunk]
          if (row) resolved.set(docId, row)
        }
      })
    )
    return resolved
  }

  /** Abstract and extras for a paper, or null if outside the built corpus. */
  async detail(summary: PaperSummary, signal?: AbortSignal): Promise<PaperDetail> {
    const month = summary.published.slice(0, 7).replace('-', '')
    let pending = this.metaShards.get(month)
    if (!pending) {
      pending = this.versioned(`meta/${month}.json.gz`)
        .then((url) => fetchShard<Record<string, MetaEntry>>(url, signal))
        .catch((error) => {
          if (error instanceof ShardMissingError) return null
          this.metaShards.delete(month)
          throw error
        })
      this.metaShards.set(month, pending)
    }

    const entry = (await pending)?.[summary.id]
    return {
      ...summary,
      abstract: entry?.a ?? '',
      comment: entry?.c,
      doi: entry?.d,
      journalRef: entry?.j,
    }
  }

  /**
   * Find a paper by its arXiv id. Returns null when the paper isn't in the
   * built corpus — an older paper, or one outside the configured categories.
   * Callers fall back to deriving metadata from arXiv directly, so any paper
   * on arXiv still opens.
   */
  async findById(id: string, signal?: AbortSignal): Promise<PaperSummary | null> {
    const bare = id.replace(/v\d+$/, '')
    const key = idShardKey(bare)

    let pending = this.idShards.get(key)
    if (!pending) {
      pending = this.versioned(`ids/${key}.json.gz`)
        .then((url) => fetchShard<Record<string, number>>(url, signal))
        .catch((error) => {
          if (error instanceof ShardMissingError) return null
          this.idShards.delete(key)
          throw error
        })
      this.idShards.set(key, pending)
    }

    const docId = (await pending)?.[bare]
    if (docId === undefined) return null

    const resolved = await this.resolve([docId], signal)
    return resolved.get(docId) ?? null
  }

  async recent(signal?: AbortSignal): Promise<PaperSummary[]> {
    const rows = await fetchShard<SummaryTuple[]>(
      await this.versioned('recent.json.gz'),
      signal
    )
    return rows.map(toSummary)
  }
}

interface MetaEntry {
  a: string
  c?: string
  d?: string
  j?: string
}

function toSummary(tuple: SummaryTuple): PaperSummary {
  const [id, title, authors, categories, published, updated] = tuple
  return {
    id,
    title,
    authors,
    categories,
    published,
    updated: updated === 0 ? undefined : updated,
  }
}

/** Decode a delta-encoded postings list into absolute doc ids. */
export function* decodePostings(
  postings: PostingList
): Generator<{ docId: number; mask: number; weight: number }> {
  let docId = 0
  for (let i = 0; i < postings.length; i += 3) {
    docId += postings[i]
    yield { docId, mask: postings[i + 1], weight: postings[i + 2] }
  }
}
