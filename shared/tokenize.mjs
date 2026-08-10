/**
 * Tokenizer shared by the CI index builder (Node) and the browser search
 * engine. These MUST stay identical: if they drift, queries tokenize into
 * terms the index doesn't contain and search silently returns nothing. That is
 * the entire reason this lives in one .mjs file imported by both sides rather
 * than being written twice.
 */

/** Field ids, used as bit positions in the postings field mask. */
export const FIELD = {
  TITLE: 1,
  AUTHOR: 2,
  CATEGORY: 4,
  ABSTRACT: 8,
}

/** Relative contribution of each field to a document's score. */
export const FIELD_WEIGHT = {
  [FIELD.TITLE]: 3.2,
  [FIELD.AUTHOR]: 2.4,
  [FIELD.CATEGORY]: 1.6,
  [FIELD.ABSTRACT]: 1.0,
}

/**
 * Stopwords are stripped from abstracts only. Titles keep everything, because
 * a title is short enough that "attention is all you need" should match as
 * written — dropping "is/all/you" there would lose a real signal.
 */
export const ABSTRACT_STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'then', 'there',
  'these', 'they', 'this', 'to', 'was', 'we', 'were', 'when', 'which', 'while',
  'with', 'our', 'us', 'you', 'your',
])

const DIACRITICS = /[̀-ͯ]/g
// The hyphen is deliberately NOT a separator: it must survive this split so
// expandHyphens() below can emit the joined form too. Without that, a search
// for "finetuning" would miss every paper written "fine-tuning".
const SEPARATORS = /[^a-z0-9+#-]+/

/**
 * Fold a string to comparable form: lowercase, strip diacritics so "Schölkopf"
 * matches "Scholkopf", and normalize unicode dashes/quotes that LaTeX emits.
 * @param {string} text
 * @returns {string}
 */
export function fold(text) {
  return text
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
}

/**
 * Split folded text into index terms.
 *
 * Hyphenated compounds are emitted both joined and split ("fine-tuning" ->
 * "finetuning", "fine", "tuning") so all three spellings a user might type
 * find the paper. Tokens keep "+" and "#" so "c++" and "f#" survive.
 *
 * @param {string} text
 * @param {{ stopwords?: Set<string> }} [options]
 * @returns {string[]} terms, in order, duplicates retained (callers count them)
 */
export function tokenize(text, options = {}) {
  const stopwords = options.stopwords
  const out = []
  for (const raw of fold(text).split(SEPARATORS)) {
    if (!raw) continue
    for (const term of expandHyphens(raw)) {
      if (term.length < 2 || term.length > 32) continue
      if (stopwords && stopwords.has(term)) continue
      // Pure numbers are noise unless they look like a year or a model size.
      if (/^\d+$/.test(term) && !(term.length === 4 && term >= '1900')) continue
      out.push(term)
    }
  }
  return out
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function expandHyphens(raw) {
  if (!raw.includes('-')) return [raw]
  const parts = raw.split('-').filter(Boolean)
  if (parts.length < 2) return [raw.replace(/-/g, '')]
  return [parts.join(''), ...parts]
}

/**
 * Shard key for a term. Terms shorter than the prefix length get their own
 * short-key shard so nothing is unreachable.
 * @param {string} term
 * @param {number} prefixLength
 * @returns {string}
 */
export function shardKey(term, prefixLength) {
  const key = term.slice(0, prefixLength)
  // Keep shard filenames filesystem- and URL-safe.
  return key.replace(/[^a-z0-9]/g, '_')
}

/**
 * BM25 term-frequency component. Computed at BUILD time and baked into the
 * postings, so the browser never needs a per-document length table — it only
 * multiplies by IDF at query time.
 *
 * @param {number} tf raw term frequency in the field
 * @param {number} fieldLength length of the field in terms
 * @param {number} avgFieldLength corpus average for that field
 * @param {number} [k1]
 * @param {number} [b]
 * @returns {number}
 */
export function bm25Tf(tf, fieldLength, avgFieldLength, k1 = 1.2, b = 0.65) {
  if (tf <= 0) return 0
  const norm = 1 - b + (b * fieldLength) / (avgFieldLength || 1)
  return (tf * (k1 + 1)) / (tf + k1 * norm)
}

/**
 * Inverse document frequency (BM25 probabilistic form, floored so that very
 * common terms contribute a little rather than going negative).
 * @param {number} docFreq
 * @param {number} docCount
 * @returns {number}
 */
export function idf(docFreq, docCount) {
  return Math.max(0.05, Math.log(1 + (docCount - docFreq + 0.5) / (docFreq + 0.5)))
}

/** Weights are stored as one byte per posting; this is the scale factor. */
export const WEIGHT_SCALE = 255
/** Largest un-quantized weight we expect; anything above clamps to the max. */
export const WEIGHT_CEILING = 24

/**
 * @param {number} weight
 * @returns {number} integer 0..255
 */
export function quantizeWeight(weight) {
  const clamped = Math.min(weight, WEIGHT_CEILING)
  return Math.max(1, Math.round((clamped / WEIGHT_CEILING) * WEIGHT_SCALE))
}

/**
 * @param {number} quantized
 * @returns {number}
 */
export function dequantizeWeight(quantized) {
  return (quantized / WEIGHT_SCALE) * WEIGHT_CEILING
}
