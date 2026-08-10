import { FIELD, tokenize } from '@shared/tokenize.mjs'

/**
 * Query language:
 *   transformer attention        all terms required (AND)
 *   ti:diffusion                 restrict a term to the title
 *   au:"yann lecun"              author phrase
 *   abs:contrastive              abstract only
 *   cat:cs.LG                    category filter
 *   "attention is all you need"  phrase — AND of terms, verified against text
 *   -survey                      exclude papers containing the term
 *
 * Unknown prefixes are treated as literal text ("http:" searches for "http"),
 * because silently dropping them would make a query quietly mean something
 * other than what the user typed.
 */

export interface QueryTerm {
  term: string
  /** Bitmask of fields this term may match; 0 means "any field". */
  fields: number
  negated: boolean
  /** Terms from a quoted phrase carry its text for post-verification. */
  phrase?: string
  /** Last bare term of a query is prefix-matched for search-as-you-type. */
  prefix?: boolean
}

export interface ParsedQuery {
  terms: QueryTerm[]
  /** cat: filters, normalized to lowercase (e.g. "cs.lg"). */
  categories: string[]
  /** Quoted phrases, for verifying and for snippet highlighting. */
  phrases: string[]
  /** True when the query has nothing searchable. */
  empty: boolean
  raw: string
}

const FIELD_PREFIXES: Record<string, number> = {
  ti: FIELD.TITLE,
  title: FIELD.TITLE,
  au: FIELD.AUTHOR,
  author: FIELD.AUTHOR,
  abs: FIELD.ABSTRACT,
  abstract: FIELD.ABSTRACT,
  all: 0,
}

interface RawToken {
  text: string
  quoted: boolean
  negated: boolean
  prefix?: string
}

/**
 * Splits on whitespace but keeps quoted runs together, and captures a leading
 * `-` or `field:` marker. Written as a scanner rather than a regex because
 * `au:"de Freitas"` needs the prefix and the quote handled together.
 */
function scan(input: string): RawToken[] {
  const tokens: RawToken[] = []
  let i = 0

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i += 1
    if (i >= input.length) break

    let negated = false
    if (input[i] === '-' && i + 1 < input.length && !/\s/.test(input[i + 1])) {
      negated = true
      i += 1
    }

    let prefix: string | undefined
    const prefixMatch = /^([a-z]+):/i.exec(input.slice(i))
    if (prefixMatch && prefixMatch[1].toLowerCase() in FIELD_PREFIXES) {
      prefix = prefixMatch[1].toLowerCase()
      i += prefixMatch[0].length
    } else if (prefixMatch && prefixMatch[1].toLowerCase() === 'cat') {
      prefix = 'cat'
      i += prefixMatch[0].length
    }

    if (input[i] === '"') {
      i += 1
      const end = input.indexOf('"', i)
      const text = end === -1 ? input.slice(i) : input.slice(i, end)
      i = end === -1 ? input.length : end + 1
      tokens.push({ text, quoted: true, negated, prefix })
    } else {
      let end = i
      while (end < input.length && !/\s/.test(input[end])) end += 1
      tokens.push({ text: input.slice(i, end), quoted: false, negated, prefix })
      i = end
    }
  }

  return tokens
}

export function parseQuery(raw: string, options: { allowPrefix?: boolean } = {}): ParsedQuery {
  const tokens = scan(raw)
  const terms: QueryTerm[] = []
  const categories: string[] = []
  const phrases: string[] = []

  tokens.forEach((token, tokenIndex) => {
    if (!token.text) return

    if (token.prefix === 'cat') {
      const category = token.text.toLowerCase()
      if (category) categories.push(category)
      return
    }

    const fields = token.prefix ? FIELD_PREFIXES[token.prefix] : 0
    const parts = tokenize(token.text)
    if (parts.length === 0) return

    if (token.quoted && parts.length > 1 && !token.negated) phrases.push(token.text)

    // Only the final bare word of the query is prefix-matched, and only while
    // typing — otherwise "learn" would balloon into every "learning" posting
    // on a deliberate, completed query.
    const isLastToken = tokenIndex === tokens.length - 1
    const allowPrefix =
      options.allowPrefix === true && isLastToken && !token.quoted && !token.negated

    parts.forEach((term, partIndex) => {
      terms.push({
        term,
        fields,
        negated: token.negated,
        phrase: token.quoted && parts.length > 1 ? token.text : undefined,
        prefix: allowPrefix && partIndex === parts.length - 1 ? true : undefined,
      })
    })
  })

  const positive = terms.filter((t) => !t.negated)
  return {
    terms,
    categories,
    phrases,
    empty: positive.length === 0 && categories.length === 0,
    raw,
  }
}

/** Detects a pasted arXiv id or URL so the app can skip search entirely. */
export function extractArxivId(input: string): string | null {
  const trimmed = input.trim()

  // Modern (2608.07460, optional version) and legacy (math.GT/0309136) ids.
  const patterns = [
    /arxiv\.org\/(?:abs|pdf|html)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i,
    /^(\d{4}\.\d{4,5})(v\d+)?$/,
    /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/i,
    /^arxiv:\s*(\d{4}\.\d{4,5})(v\d+)?$/i,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(trimmed)
    if (match) return match[1]
  }
  return null
}
