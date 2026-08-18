import { dequantizeWeight, idf, shardKey, tokenize } from '@shared/tokenize.mjs'
import type { PaperDetail, PaperSummary } from '@/types'
import { CorpusClient, decodePostings } from './corpus'

/**
 * "More like this" — papers close to the one being read.
 *
 * Discovery was written off during planning as needing a backend and a
 * citation graph. It does not: the term↔document index is already in the
 * browser, so a related-papers query is just this paper's own distinctive
 * terms run back through it. No model, no external API, and it works offline
 * once the shards are cached.
 *
 * The selection rules below are Lucene's MoreLikeThis defaults, adapted, and
 * they are not decoration. A first version ranked purely by rarity and
 * returned papers matching `fre`, `ncy` and `usion` — fragments that exist in
 * the vocabulary a few dozen times each. Rarest-first reliably finds typos,
 * because a typo is by definition the rarest thing in a corpus.
 */

/** Below this length a token is an artefact more often than a word. */
const MIN_TERM_LENGTH = 4

/**
 * Seen in fewer papers than this share of the corpus, a term is a typo or a
 * one-off identifier rather than a topic.
 *
 * Relative, not absolute. A fixed floor of 50 was tuned against the 441,740-
 * paper production index and silently returned nothing at all on the 1,338-
 * paper development corpus, where 50 papers is 3.7% — above the 3% ceiling
 * below, so the two bounds crossed and the filter admitted nothing. Any
 * threshold on a corpus-relative quantity has to scale with the corpus.
 */
const MIN_DOC_FREQ_RATIO = 0.0001

/** ...but never below this, so a typo cannot qualify in a small corpus. */
const MIN_DOC_FREQ_FLOOR = 5

/** Seen in more than this share of the corpus, a term discriminates nothing. */
const MAX_DOC_FREQ_RATIO = 0.03

/** Terms carried into the query. More costs shard fetches for little gain. */
const MAX_QUERY_TERMS = 20

/** Candidates scored before ranking, to bound the work on common terms. */
const MAX_CANDIDATES = 4000

export interface RelatedPaper {
  docId: number
  paper: PaperSummary
  score: number
}

interface SelectedTerm {
  term: string
  weight: number
}

/**
 * Pick the terms that characterise this paper.
 *
 * Exported for testing: the floors are the whole substance of this file, and
 * the typo case is worth pinning down.
 */
export function selectTerms(
  text: string,
  docFreq: (term: string) => number | undefined,
  docCount: number
): SelectedTerm[] {
  const frequencies = new Map<string, number>()
  for (const term of tokenize(text)) {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
  }

  const minDocFreq = Math.max(MIN_DOC_FREQ_FLOOR, Math.round(docCount * MIN_DOC_FREQ_RATIO))
  const maxDocFreq = docCount * MAX_DOC_FREQ_RATIO

  const selected: SelectedTerm[] = []
  for (const [term, termFreq] of frequencies) {
    if (term.length < MIN_TERM_LENGTH) continue

    const df = docFreq(term)
    if (df === undefined || df < minDocFreq || df > maxDocFreq) continue

    // Sub-linear in term frequency, linear in rarity: a word used five times
    // in one abstract matters, but not five times as much.
    selected.push({ term, weight: (1 + Math.log(termFreq)) * idf(df, docCount) })
  }

  selected.sort((a, b) => b.weight - a.weight)
  return selected.slice(0, MAX_QUERY_TERMS)
}

/**
 * Papers most similar to `paper`, best first.
 *
 * Returns an empty list rather than throwing when the paper has no indexed
 * abstract — an older paper, or one outside the built corpus. This backs a
 * secondary panel; it must never be the reason a reader cannot read.
 */
export async function findRelated(
  corpus: CorpusClient,
  paper: PaperDetail,
  limit = 6,
  signal?: AbortSignal
): Promise<RelatedPaper[]> {
  const manifest = await corpus.manifest()
  const text = `${paper.title} ${paper.abstract ?? ''}`.trim()
  if (!text) return []

  // Two passes over the candidate terms: one to load the shards they live in,
  // one to select using the document frequencies those shards provide.
  const candidates = new Set(
    tokenize(text).filter((term) => term.length >= MIN_TERM_LENGTH)
  )
  const shards = new Map<string, Awaited<ReturnType<CorpusClient['shard']>>>()
  await Promise.all(
    [...new Set([...candidates].map((term) => shardKey(term, manifest.prefixLength)))].map(
      async (key) => {
        shards.set(key, await corpus.shard(key, signal))
      }
    )
  )

  const postingsFor = (term: string) =>
    shards.get(shardKey(term, manifest.prefixLength))?.[term]

  const terms = selectTerms(
    text,
    (term) => {
      const postings = postingsFor(term)
      return postings ? postings.length / 3 : undefined
    },
    manifest.docCount
  )
  if (terms.length === 0) return []

  const seedDocId = await corpus.docIdOf(paper.id, signal)

  const scores = new Map<number, number>()
  for (const { term, weight } of terms) {
    const postings = postingsFor(term)
    if (!postings) continue

    for (const posting of decodePostings(postings)) {
      if (posting.docId === seedDocId) continue
      const existing = scores.get(posting.docId)
      if (existing === undefined && scores.size >= MAX_CANDIDATES) continue
      scores.set(posting.docId, (existing ?? 0) + weight * dequantizeWeight(posting.weight))
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)

  const resolved = await corpus.resolve(
    ranked.map(([docId]) => docId),
    signal
  )

  return ranked
    .map(([docId, score]) => {
      const summary = resolved.get(docId)
      return summary ? { docId, paper: summary, score } : undefined
    })
    .filter((row): row is RelatedPaper => row !== undefined)
}
