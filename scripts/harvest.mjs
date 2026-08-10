#!/usr/bin/env node
/**
 * Harvests arXiv metadata for the configured AI categories via OAI-PMH and
 * appends it to a local JSONL corpus.
 *
 * This runs in CI only — the browser never talks to arXiv's API, because
 * export.arxiv.org sends no CORS header. The corpus this produces is what
 * scripts/build-index.mjs turns into the static search index.
 *
 * The corpus file is cached between CI runs, so normal runs are incremental
 * (`from=<last datestamp>`) and take seconds. A cold cache falls back to a full
 * harvest from config.historyStart, which takes roughly half an hour.
 *
 * Usage:
 *   node scripts/harvest.mjs                 # incremental from saved state
 *   node scripts/harvest.mjs --full          # ignore state, re-harvest window
 *   node scripts/harvest.mjs --from 2026-08-01 --sets cs:cs:AI   # dev slice
 *   node scripts/harvest.mjs --max-pages 2   # bounded smoke test
 */

import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS_DIR = path.join(ROOT, '.corpus')
const CORPUS_FILE = path.join(CORPUS_DIR, 'corpus.jsonl')
const STATE_FILE = path.join(CORPUS_DIR, 'state.json')

const OAI_ENDPOINT = 'https://oaipmh.arxiv.org/oai'
/** arXiv asks harvesters to be gentle; this is the delay between pages. */
const PAGE_DELAY_MS = 1500
const MAX_RETRIES = 6

const args = parseArgs(process.argv.slice(2))

main().catch((err) => {
  console.error('\nHarvest failed:', err.message)
  process.exit(1)
})

async function main() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config/corpus.json'), 'utf8'))
  await fs.mkdir(CORPUS_DIR, { recursive: true })

  const sets = args.sets ? args.sets.split(',') : config.categories.map(categoryToSet)
  const state = args.full ? {} : await readJson(STATE_FILE, {})

  console.log(`Harvesting ${sets.length} set(s) from ${OAI_ENDPOINT}`)

  // Load the existing corpus so we can merge by id: a paper cross-listed in
  // several categories arrives once per set, and revised papers arrive again
  // with a newer datestamp. Last write wins.
  const papers = await loadCorpus()
  console.log(`  existing corpus: ${papers.size} papers`)

  let fetched = 0
  const nextState = { ...state }

  for (const set of sets) {
    const from = args.from ?? state[set] ?? config.historyStart
    process.stdout.write(`  ${set.padEnd(14)} from ${from ?? 'beginning'} ... `)

    let count = 0
    let newestDatestamp = from
    try {
      for await (const record of listRecords({ set, from, until: args.until })) {
        papers.set(record.id, record)
        count += 1
        if (!newestDatestamp || record.datestamp > newestDatestamp) {
          newestDatestamp = record.datestamp
        }
      }
    } catch (err) {
      // One bad set shouldn't discard the whole harvest — keep what we have,
      // leave that set's watermark untouched so the next run retries it.
      console.log(`error: ${err.message}`)
      continue
    }

    fetched += count
    // Re-harvest the watermark day next time: OAI datestamps are day-granular,
    // so records added later on the same day would otherwise be missed.
    nextState[set] = newestDatestamp ?? from
    console.log(`${count} records`)
  }

  await writeCorpus(papers)
  await fs.writeFile(STATE_FILE, JSON.stringify(nextState, null, 2))

  console.log(`\nFetched ${fetched} records; corpus now holds ${papers.size} papers.`)
  console.log(`Corpus: ${CORPUS_FILE}`)
}

/** cs.AI -> cs:cs:AI, stat.ML -> stat:stat:ML */
function categoryToSet(category) {
  const [archive, sub] = category.split('.')
  return `${archive}:${archive}:${sub}`
}

/**
 * Yields parsed records for one set, following resumption tokens.
 * @param {{set: string, from?: string, until?: string}} params
 */
async function* listRecords({ set, from, until }) {
  const params = new URLSearchParams({ verb: 'ListRecords', metadataPrefix: 'arXiv', set })
  if (from) params.set('from', from)
  if (until) params.set('until', until)

  let url = `${OAI_ENDPOINT}?${params}`
  let page = 0

  while (url) {
    const xml = await fetchWithRetry(url)
    page += 1

    for (const record of parseRecords(xml)) yield record

    const token = matchTag(xml, 'resumptionToken')
    if (!token || (args.maxPages && page >= args.maxPages)) break

    // A resumption token replaces every other argument except the verb.
    url = `${OAI_ENDPOINT}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`
    await sleep(PAGE_DELAY_MS)
  }
}

/**
 * arXiv answers 503 + Retry-After under load; that is flow control, not an
 * error, so we wait exactly as long as asked and continue.
 */
async function fetchWithRetry(url) {
  let lastError
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ai-arxiv-reader/0.1 (+https://github.com/prabhay759/ai-arxiv-reader)' },
      })

      if (res.status === 503) {
        const wait = Number(res.headers.get('retry-after') ?? 20)
        await sleep((Number.isFinite(wait) ? wait : 20) * 1000)
        continue
      }
      // A resumption token that expired mid-harvest is unrecoverable; the next
      // run picks up from the saved watermark instead.
      if (res.status === 400) throw new Error(`OAI rejected request (400): ${url.slice(0, 120)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      return await res.text()
    } catch (err) {
      lastError = err
      if (err.message.startsWith('OAI rejected')) throw err
      await sleep(2 ** attempt * 1000)
    }
  }
  throw lastError ?? new Error('exhausted retries')
}

/**
 * Extracts records from an OAI page.
 *
 * Hand-rolled rather than a full XML parser: the payload is machine-generated
 * and schema-fixed, pages are ~2 MB, and this avoids a dependency in the one
 * place where a dependency would also need auditing. Entity decoding is
 * handled explicitly, which is the only part that actually matters for
 * correctness here.
 */
function* parseRecords(xml) {
  const recordPattern = /<record>([\s\S]*?)<\/record>/g
  let match
  while ((match = recordPattern.exec(xml))) {
    const body = match[1]

    // Deleted records carry no metadata; emit a tombstone so build-index can
    // drop a paper that arXiv withdrew.
    const headerStatus = /<header[^>]*status="deleted"/.test(body)
    const id = matchTag(body, 'id') ?? matchTag(body, 'identifier')?.split(':').pop()
    if (!id) continue

    const datestamp = matchTag(body, 'datestamp') ?? ''
    if (headerStatus) {
      yield { id, datestamp, deleted: true }
      continue
    }

    const categories = (matchTag(body, 'categories') ?? '').split(/\s+/).filter(Boolean)
    const title = collapse(matchTag(body, 'title') ?? '')
    if (!title) continue

    yield {
      id,
      datestamp,
      title,
      authors: parseAuthors(body),
      categories,
      published: matchTag(body, 'created') ?? '',
      updated: matchTag(body, 'updated') ?? undefined,
      abstract: collapse(matchTag(body, 'abstract') ?? ''),
      comment: collapse(matchTag(body, 'comments') ?? '') || undefined,
      doi: matchTag(body, 'doi') ?? undefined,
      journalRef: collapse(matchTag(body, 'journal-ref') ?? '') || undefined,
    }
  }
}

function parseAuthors(body) {
  const block = matchTagRaw(body, 'authors')
  if (!block) return []
  const authors = []
  const pattern = /<author>([\s\S]*?)<\/author>/g
  let match
  while ((match = pattern.exec(block))) {
    const keyname = matchTag(match[1], 'keyname') ?? ''
    const forenames = matchTag(match[1], 'forenames') ?? ''
    const name = `${forenames} ${keyname}`.trim()
    if (name) authors.push(name)
  }
  return authors
}

/** Innermost text of the first <tag>, entity-decoded. */
function matchTag(xml, tag) {
  const raw = matchTagRaw(xml, tag)
  return raw === null ? null : decodeEntities(raw)
}

function matchTagRaw(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? match[1] : null
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Ampersand last, so "&amp;lt;" decodes to "&lt;" and not "<".
    .replace(/&amp;/g, '&')
}

/** LaTeX titles and abstracts arrive with hard line wraps; flatten them. */
function collapse(text) {
  return text.replace(/\s+/g, ' ').trim()
}

async function loadCorpus() {
  const papers = new Map()
  try {
    await fs.access(CORPUS_FILE)
  } catch {
    return papers
  }

  const rl = readline.createInterface({
    input: createReadStream(CORPUS_FILE),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line) continue
    try {
      const paper = JSON.parse(line)
      papers.set(paper.id, paper)
    } catch {
      // Truncated final line from an interrupted run: skip it.
    }
  }
  return papers
}

async function writeCorpus(papers) {
  // Write to a temp file and rename, so an interrupted run can't leave a
  // half-written corpus that the next run would silently treat as complete.
  // The pid keeps two concurrent harvests from racing on the same temp path —
  // without it, whichever renames second fails with ENOENT.
  const tmp = `${CORPUS_FILE}.${process.pid}.tmp`
  const out = createWriteStream(tmp)
  for (const paper of papers.values()) {
    if (paper.deleted) continue
    if (!out.write(`${JSON.stringify(paper)}\n`)) {
      await new Promise((resolve) => out.once('drain', resolve))
    }
  }
  await new Promise((resolve, reject) => {
    out.end(resolve)
    out.on('error', reject)
  })
  await fs.rename(tmp, CORPUS_FILE)
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

function parseArgs(argv) {
  const out = { full: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--full') out.full = true
    else if (arg === '--from') out.from = argv[++i]
    else if (arg === '--until') out.until = argv[++i]
    else if (arg === '--sets') out.sets = argv[++i]
    else if (arg === '--max-pages') out.maxPages = Number(argv[++i])
  }
  return out
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { parseRecords, decodeEntities, categoryToSet }
