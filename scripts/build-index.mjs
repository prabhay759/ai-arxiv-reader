#!/usr/bin/env node
/**
 * Turns the harvested corpus into the static search index the browser reads.
 *
 * Output layout (all under public/data/, all gzipped):
 *   manifest.json          - counts, shard lists, build metadata (NOT gzipped)
 *   docs/<n>.json.gz       - display records, `docsPerChunk` per chunk
 *   index/<shard>.json.gz  - inverted index, sharded by term prefix
 *   meta/<yymm>.json.gz    - abstracts + extras, keyed by arXiv id
 *   recent.json.gz         - newest papers, for the home feed
 *
 * Two design choices worth knowing:
 *
 * 1. BM25's term-frequency component is computed HERE and baked into each
 *    posting as one quantized byte. The browser only multiplies by IDF, so it
 *    never needs a per-document length table — that table would have been a
 *    ~1 MB download before the first search could run.
 *
 * 2. Doc ids are assigned newest-first. Date-sorted result pages then read
 *    from very few chunks, and "newest" browsing costs one fetch.
 *
 * Memory: postings are built in batches of term-shards, streaming the corpus
 * once per batch, so peak memory stays flat regardless of corpus size.
 *
 * Usage: node scripts/build-index.mjs [--batches N] [--out public/data]
 */

import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

import {
  FIELD,
  FIELD_WEIGHT,
  ABSTRACT_STOPWORDS,
  tokenize,
  shardKey,
  bm25Tf,
  quantizeWeight,
} from '../shared/tokenize.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS_FILE = path.join(ROOT, '.corpus/corpus.jsonl')

const args = parseArgs(process.argv.slice(2))
const OUT_DIR = path.resolve(ROOT, args.out ?? 'public/data')

main().catch((err) => {
  console.error('\nIndex build failed:', err.stack ?? err.message)
  process.exit(1)
})

async function main() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config/corpus.json'), 'utf8'))
  const wanted = new Set(config.categories)
  const prefixLength = config.tokenShardPrefixLength ?? 2
  const docsPerChunk = config.docsPerChunk ?? 512

  console.log('Pass 1/3: scanning corpus')
  const scan = await scanCorpus(wanted)
  if (scan.docs.length === 0) {
    throw new Error(`No papers matched ${[...wanted].join(', ')}. Run scripts/harvest.mjs first.`)
  }

  // Newest first, with the id as tiebreaker so builds are deterministic.
  scan.docs.sort((a, b) =>
    a.published === b.published ? (a.id < b.id ? 1 : -1) : a.published < b.published ? 1 : -1
  )

  const docIdById = new Map()
  scan.docs.forEach((doc, index) => docIdById.set(doc.id, index))

  const docCount = scan.docs.length
  const avg = {
    [FIELD.TITLE]: scan.totalLengths.title / docCount || 1,
    [FIELD.AUTHOR]: scan.totalLengths.author / docCount || 1,
    [FIELD.CATEGORY]: scan.totalLengths.category / docCount || 1,
    [FIELD.ABSTRACT]: scan.totalLengths.abstract / Math.max(1, scan.abstractDocs) || 1,
  }

  // Abstracts are the bulk of the index; only the recent window gets them
  // indexed for full-text search. Older papers stay searchable by title,
  // author and category, and their abstract still loads when opened.
  const abstractCutoff = monthsBefore(scan.newestPublished, config.abstractWindowMonths ?? 24)
  console.log(
    `  ${docCount} papers, ${scan.newestPublished} back to ${scan.oldestPublished}\n` +
      `  abstracts indexed from ${abstractCutoff}`
  )

  await fs.rm(OUT_DIR, { recursive: true, force: true })
  await fs.mkdir(path.join(OUT_DIR, 'docs'), { recursive: true })
  await fs.mkdir(path.join(OUT_DIR, 'index'), { recursive: true })
  await fs.mkdir(path.join(OUT_DIR, 'meta'), { recursive: true })
  await fs.mkdir(path.join(OUT_DIR, 'ids'), { recursive: true })

  console.log('Pass 2/3: writing display chunks and metadata shards')
  const { chunkCount, metaShards, metaBytes, docBytes, idShards } = await writeDocsAndMeta(
    scan.docs,
    docsPerChunk,
    config.recentFeedSize ?? 200
  )

  console.log('Pass 3/3: building inverted index')
  const batches = args.batches ?? Math.max(1, Math.ceil(docCount / 120_000))
  const { shards, indexBytes, termCount, postingCount } = await buildInvertedIndex({
    wanted,
    docIdById,
    prefixLength,
    batches,
    avg,
    abstractCutoff,
  })

  const manifest = {
    schema: 1,
    builtAt: new Date().toISOString(),
    docCount,
    docsPerChunk,
    chunkCount,
    prefixLength,
    categories: config.categories,
    abstractCutoff,
    newestPublished: scan.newestPublished,
    oldestPublished: scan.oldestPublished,
    avgFieldLengths: {
      title: round(avg[FIELD.TITLE]),
      author: round(avg[FIELD.AUTHOR]),
      category: round(avg[FIELD.CATEGORY]),
      abstract: round(avg[FIELD.ABSTRACT]),
    },
    shards: shards.sort(),
    metaShards: metaShards.sort(),
    idShards: idShards.sort(),
    stats: { termCount, postingCount },
  }
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest))

  const total = docBytes + indexBytes + metaBytes
  console.log(
    `\nBuilt index for ${docCount} papers\n` +
      `  terms      ${termCount.toLocaleString()} (${postingCount.toLocaleString()} postings)\n` +
      `  docs       ${mb(docBytes)} in ${chunkCount} chunks\n` +
      `  index      ${mb(indexBytes)} in ${shards.length} shards\n` +
      `  metadata   ${mb(metaBytes)} in ${metaShards.length} shards\n` +
      `  total      ${mb(total)}  ->  ${OUT_DIR}`
  )
}

/** Pass 1: collect display records and corpus-wide statistics. */
async function scanCorpus(wanted) {
  const docs = []
  const totalLengths = { title: 0, author: 0, category: 0, abstract: 0 }
  let abstractDocs = 0
  let newestPublished = ''
  let oldestPublished = '9999-99-99'

  for await (const paper of streamCorpus()) {
    if (!paper.categories?.some((c) => wanted.has(c))) continue

    docs.push({
      id: paper.id,
      title: paper.title,
      authors: paper.authors ?? [],
      categories: paper.categories,
      published: paper.published,
      updated: paper.updated,
      abstract: paper.abstract ?? '',
      comment: paper.comment,
      doi: paper.doi,
      journalRef: paper.journalRef,
    })

    totalLengths.title += tokenize(paper.title).length
    totalLengths.author += tokenize((paper.authors ?? []).join(' ')).length
    totalLengths.category += paper.categories.length
    if (paper.abstract) {
      totalLengths.abstract += tokenize(paper.abstract, { stopwords: ABSTRACT_STOPWORDS }).length
      abstractDocs += 1
    }
    if (paper.published > newestPublished) newestPublished = paper.published
    if (paper.published < oldestPublished) oldestPublished = paper.published
  }

  return { docs, totalLengths, abstractDocs, newestPublished, oldestPublished }
}

/**
 * Pass 2: display chunks (small, fetched for the visible result page) and
 * metadata shards (large, fetched only when a paper is opened).
 */
async function writeDocsAndMeta(docs, docsPerChunk, recentFeedSize) {
  let docBytes = 0
  let chunkCount = 0

  for (let start = 0; start < docs.length; start += docsPerChunk) {
    const chunk = docs.slice(start, start + docsPerChunk).map(toSummaryTuple)
    docBytes += await writeGzip(path.join(OUT_DIR, 'docs', `${chunkCount}.json.gz`), chunk)
    chunkCount += 1
  }

  // Group abstracts by publication month. Papers cluster by month, so opening
  // a paper usually warms the shard for its neighbours too.
  const byMonth = new Map()
  for (const doc of docs) {
    const month = doc.published.slice(0, 7).replace('-', '')
    if (!byMonth.has(month)) byMonth.set(month, {})
    byMonth.get(month)[doc.id] = {
      a: doc.abstract,
      ...(doc.comment ? { c: doc.comment } : {}),
      ...(doc.doi ? { d: doc.doi } : {}),
      ...(doc.journalRef ? { j: doc.journalRef } : {}),
    }
  }

  let metaBytes = 0
  for (const [month, entries] of byMonth) {
    metaBytes += await writeGzip(path.join(OUT_DIR, 'meta', `${month}.json.gz`), entries)
  }

  // arXiv id -> doc id, so opening /paper/2608.07460 is a single small fetch
  // instead of a scan. Sharded by the id's own prefix (the yymm for modern
  // ids, the archive name for legacy ones), which the client derives locally.
  const byIdShard = new Map()
  docs.forEach((doc, docId) => {
    const key = idShardKey(doc.id)
    if (!byIdShard.has(key)) byIdShard.set(key, {})
    byIdShard.get(key)[doc.id] = docId
  })
  for (const [key, entries] of byIdShard) {
    await writeGzip(path.join(OUT_DIR, 'ids', `${key}.json.gz`), entries)
  }

  await writeGzip(
    path.join(OUT_DIR, 'recent.json.gz'),
    docs.slice(0, recentFeedSize).map(toSummaryTuple)
  )

  return {
    chunkCount,
    metaShards: [...byMonth.keys()],
    idShards: [...byIdShard.keys()],
    metaBytes,
    docBytes,
  }
}

/**
 * Shard key for an arXiv id. Must match idShardKey() in src/search/corpus.ts.
 * Modern ids ("2608.07460") shard by yymm; legacy ids ("math.GT/0309136")
 * shard by archive name.
 */
function idShardKey(id) {
  const modern = /^(\d{4})\./.exec(id)
  if (modern) return modern[1]
  return id.split(/[./]/)[0].toLowerCase().replace(/[^a-z0-9]/g, '_') || 'other'
}

/** Positional tuple rather than an object: ~40% smaller before compression. */
function toSummaryTuple(doc) {
  return [
    doc.id,
    doc.title,
    doc.authors,
    doc.categories,
    doc.published,
    doc.updated && doc.updated !== doc.published ? doc.updated : 0,
  ]
}

/**
 * Pass 3: build postings, one batch of term-shards at a time.
 *
 * Each batch re-streams the corpus but only retains terms belonging to that
 * batch's shards, which keeps peak memory proportional to 1/batches of the
 * full index instead of the whole thing.
 */
async function buildInvertedIndex({
  wanted,
  docIdById,
  prefixLength,
  batches,
  avg,
  abstractCutoff,
}) {
  const shards = []
  let indexBytes = 0
  let termCount = 0
  let postingCount = 0

  for (let batch = 0; batch < batches; batch += 1) {
    // term -> { docId -> { mask, weight } }, restricted to this batch.
    const postings = new Map()

    for await (const paper of streamCorpus()) {
      if (!paper.categories?.some((c) => wanted.has(c))) continue
      const docId = docIdById.get(paper.id)
      if (docId === undefined) continue

      const fields = [
        [FIELD.TITLE, tokenize(paper.title), avg[FIELD.TITLE]],
        [FIELD.AUTHOR, tokenize((paper.authors ?? []).join(' ')), avg[FIELD.AUTHOR]],
        [FIELD.CATEGORY, paper.categories.map((c) => c.toLowerCase()), avg[FIELD.CATEGORY]],
      ]
      if (paper.abstract && paper.published >= abstractCutoff) {
        fields.push([
          FIELD.ABSTRACT,
          tokenize(paper.abstract, { stopwords: ABSTRACT_STOPWORDS }),
          avg[FIELD.ABSTRACT],
        ])
      }

      for (const [field, terms, avgLength] of fields) {
        if (terms.length === 0) continue
        const counts = new Map()
        for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1)

        for (const [term, tf] of counts) {
          const key = shardKey(term, prefixLength)
          if (hashToBatch(key, batches) !== batch) continue

          let byDoc = postings.get(term)
          if (!byDoc) postings.set(term, (byDoc = new Map()))

          const contribution = FIELD_WEIGHT[field] * bm25Tf(tf, terms.length, avgLength)
          const existing = byDoc.get(docId)
          if (existing) {
            existing.mask |= field
            existing.weight += contribution
          } else {
            byDoc.set(docId, { mask: field, weight: contribution })
          }
        }
      }
    }

    // Group terms into their shard files and emit.
    const byShard = new Map()
    for (const [term, byDoc] of postings) {
      const key = shardKey(term, prefixLength)
      if (!byShard.has(key)) byShard.set(key, {})

      // Delta-encoded triplets: [docIdDelta, fieldMask, quantizedWeight].
      const docIds = [...byDoc.keys()].sort((a, b) => a - b)
      const flat = new Array(docIds.length * 3)
      let previous = 0
      for (let i = 0; i < docIds.length; i += 1) {
        const docId = docIds[i]
        const entry = byDoc.get(docId)
        flat[i * 3] = docId - previous
        flat[i * 3 + 1] = entry.mask
        flat[i * 3 + 2] = quantizeWeight(entry.weight)
        previous = docId
      }
      byShard.get(key)[term] = flat
      termCount += 1
      postingCount += docIds.length
    }

    for (const [key, terms] of byShard) {
      indexBytes += await writeGzip(path.join(OUT_DIR, 'index', `${key}.json.gz`), terms)
      shards.push(key)
    }

    process.stdout.write(
      `  batch ${batch + 1}/${batches}: ${byShard.size} shards, ${postings.size} terms\n`
    )
  }

  return { shards, indexBytes, termCount, postingCount }
}

/** Stable assignment of a shard to a build batch. */
function hashToBatch(key, batches) {
  if (batches === 1) return 0
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return hash % batches
}

async function* streamCorpus() {
  const rl = readline.createInterface({
    input: createReadStream(CORPUS_FILE),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    if (!line) continue
    try {
      yield JSON.parse(line)
    } catch {
      // Skip a torn line rather than failing the whole build.
    }
  }
}

async function writeGzip(file, value) {
  const buffer = zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9 })
  await fs.writeFile(file, buffer)
  return buffer.byteLength
}

/** "2026-08-10" minus N months -> "2024-08-01" */
function monthsBefore(isoDate, months) {
  const date = new Date(`${isoDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() - months)
  return `${date.toISOString().slice(0, 8)}01`
}

const round = (n) => Math.round(n * 100) / 100
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--batches') out.batches = Number(argv[++i])
    else if (argv[i] === '--out') out.out = argv[++i]
  }
  return out
}
