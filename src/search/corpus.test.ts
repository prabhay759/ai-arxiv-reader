import { afterEach, describe, expect, it, vi } from 'vitest'
import { CorpusClient, IndexUnavailableError } from './corpus'

const BASE = 'https://example.test/data/'

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

const MANIFEST = {
  schema: 1,
  builtAt: '2026-08-12T15:25:29.700Z',
  docCount: 3,
  docsPerChunk: 512,
  chunkCount: 1,
  prefixLength: 2,
  categories: ['cs.AI'],
  abstractCutoff: '',
  newestPublished: '2026-08-11',
  oldestPublished: '2024-01-01',
  avgFieldLengths: { title: 10, author: 5, category: 2, abstract: 100 },
  shards: [],
  metaShards: [],
  idShards: [],
  stats: { termCount: 1, postingCount: 1 },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('manifest loading reports the real cause', () => {
  it('loads a healthy manifest', async () => {
    stubFetch(() => new Response(JSON.stringify(MANIFEST), { status: 200 }))
    const manifest = await new CorpusClient(BASE).manifest()
    expect(manifest.docCount).toBe(3)
  })

  it('only claims "not built" on a genuine 404', async () => {
    stubFetch(() => new Response('nope', { status: 404 }))
    await expect(new CorpusClient(BASE).manifest()).rejects.toBeInstanceOf(
      IndexUnavailableError
    )
  })

  it('does NOT tell the user to run a build when the server errors', async () => {
    // The bug this guards: every non-OK response used to be reported as
    // "the search index has not been built", sending the reader off to fix
    // something that was not wrong.
    stubFetch(() => new Response('bad gateway', { status: 502 }))

    const error = await new CorpusClient(BASE).manifest().catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(IndexUnavailableError)
    expect((error as Error).message).toMatch(/502/)
    expect((error as Error).message).not.toMatch(/has not been built/i)
  })

  it('retries once with the cache bypassed before giving up', async () => {
    // A stale service-worker or HTTP cache entry can wedge the app while the
    // site itself is healthy, so a failure must be retried unconditionally.
    let call = 0
    const spy = stubFetch(() => {
      call += 1
      return call === 1
        ? new Response('stale', { status: 500 })
        : new Response(JSON.stringify(MANIFEST), { status: 200 })
    })

    const manifest = await new CorpusClient(BASE).manifest()
    expect(manifest.docCount).toBe(3)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0][1]).toMatchObject({ cache: 'no-cache' })
    expect(spy.mock.calls[1][1]).toMatchObject({ cache: 'reload' })
  })

  it('explains an offline failure as offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const error = await new CorpusClient(BASE).manifest().catch((e: Error) => e)
    expect((error as Error).message).toMatch(/offline/i)
  })

  it('lets a later call retry after a failure', async () => {
    // A 404 is definitive, so it short-circuits without the cache-bypass
    // retry — one fetch, not two.
    let call = 0
    stubFetch(() => {
      call += 1
      return call === 1
        ? new Response('nope', { status: 404 })
        : new Response(JSON.stringify(MANIFEST), { status: 200 })
    })

    const client = new CorpusClient(BASE)
    await expect(client.manifest()).rejects.toBeInstanceOf(IndexUnavailableError)
    // The "Try again" button depends on the failed promise not being cached.
    await expect(client.manifest()).resolves.toMatchObject({ docCount: 3 })
  })
})

describe('an unreadable payload is not reported as a missing index', () => {
  it('names what came back instead of blaming the build', async () => {
    // The regression: assertJsonPayload threw IndexUnavailableError, and it
    // runs on shards too — so an unreadable shard claimed the whole index had
    // never been built, sending debugging the wrong way entirely.
    stubFetch(() => new Response('<!doctype html><html>oops</html>', { status: 200 }))

    const error = await new CorpusClient(BASE).manifest().catch((e: Error) => e)
    expect(error).not.toBeInstanceOf(IndexUnavailableError)
    expect((error as Error).message).toMatch(/HTML page/i)
    expect((error as Error).message).toMatch(/manifest\.json/)
  })

  it('reports an empty response as empty', async () => {
    stubFetch(() => new Response('', { status: 200 }))
    const error = await new CorpusClient(BASE).manifest().catch((e: Error) => e)
    expect((error as Error).message).toMatch(/empty response/i)
  })
})

describe('gzip shards decode without DecompressionStream', () => {
  it('falls back to a JS inflate when the browser lacks the API', async () => {
    const { gzipSync } = await import('fflate')
    const payload = gzipSync(new TextEncoder().encode(JSON.stringify({ transformer: [0, 1, 9] })))

    stubFetch((url) =>
      url.includes('manifest')
        ? new Response(JSON.stringify(MANIFEST), { status: 200 })
        : new Response(payload, { status: 200 })
    )

    // Simulate an older browser: Safari only gained DecompressionStream in
    // 16.4, and without a fallback every shard read failed there.
    const original = globalThis.DecompressionStream
    // @ts-expect-error - deliberately removing the API for this test
    delete globalThis.DecompressionStream
    try {
      const shard = await new CorpusClient(BASE).shard('tr')
      expect(shard).toMatchObject({ transformer: [0, 1, 9] })
    } finally {
      globalThis.DecompressionStream = original
    }
  })
})

describe('data files are stamped with the build they belong to', () => {
  function stubShardFetch(manifest: typeof MANIFEST) {
    return stubFetch((url) => {
      if (url.includes('manifest')) {
        return new Response(JSON.stringify(manifest), { status: 200 })
      }
      // docs/ and recent are arrays of summary tuples; the rest are maps.
      const body = /docs\/|recent\./.test(url) ? [] : {}
      return new Response(JSON.stringify(body), { status: 200 })
    })
  }

  it('stamps every shard URL, but never the manifest', async () => {
    const spy = stubShardFetch(MANIFEST)
    const client = new CorpusClient(BASE)

    await client.shard('tr')
    await client.docChunk(0)
    await client.recent()
    await client.findById('2608.13560')
    await client.detail({
      id: '2608.13560',
      title: 't',
      authors: [],
      categories: [],
      published: '2026-08-13',
    })

    const urls = spy.mock.calls.map((call) => String(call[0]))
    // 20260812152529700 — the manifest's builtAt with the punctuation stripped.
    const stamp = '?v=20260812152529700'
    expect(urls.filter((url) => url.includes('manifest.json'))).toEqual([
      `${BASE}manifest.json`,
    ])
    for (const url of urls.filter((url) => !url.includes('manifest.json'))) {
      expect(url).toContain(stamp)
    }
    expect(urls).toContain(`${BASE}index/tr.json.gz${stamp}`)
    expect(urls).toContain(`${BASE}docs/0.json.gz${stamp}`)
    expect(urls).toContain(`${BASE}recent.json.gz${stamp}`)
    expect(urls).toContain(`${BASE}ids/2608.json.gz${stamp}`)
    expect(urls).toContain(`${BASE}meta/202608.json.gz${stamp}`)
  })

  it('asks for different URLs after a rebuild', async () => {
    // Why this matters beyond cache busting: doc ids are assigned newest-first,
    // so one new paper renumbers the entire corpus. A posting list cached from
    // an earlier build, resolved against a later build's doc chunks, returns
    // the wrong papers with no error anywhere. Distinct URLs per build make
    // that mixture impossible.
    const first = stubShardFetch(MANIFEST)
    await new CorpusClient(BASE).shard('tr')
    const before = String(first.mock.calls.at(-1)?.[0])

    const rebuilt = stubShardFetch({ ...MANIFEST, builtAt: '2026-08-16T13:28:14.651Z' })
    await new CorpusClient(BASE).shard('tr')
    const after = String(rebuilt.mock.calls.at(-1)?.[0])

    expect(before).not.toBe(after)
    expect(after).toBe(`${BASE}index/tr.json.gz?v=20260816132814651`)
  })
})

describe('shard loading distinguishes missing from broken', () => {
  it('treats 404 as "no papers use this term"', async () => {
    stubFetch((url) =>
      url.includes('manifest')
        ? new Response(JSON.stringify(MANIFEST), { status: 200 })
        : new Response('nope', { status: 404 })
    )
    await expect(new CorpusClient(BASE).shard('zz')).resolves.toBeNull()
  })

  it('surfaces a server error instead of pretending nothing matched', async () => {
    stubFetch((url) =>
      url.includes('manifest')
        ? new Response(JSON.stringify(MANIFEST), { status: 200 })
        : new Response('boom', { status: 503 })
    )
    await expect(new CorpusClient(BASE).shard('tr')).rejects.toThrow(/503/)
  })
})
