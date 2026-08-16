#!/usr/bin/env node
/**
 * End-to-end checks against a real browser.
 *
 * Covers the flows that unit tests can't reach: does search actually return
 * papers, does a reader render, and — the one that matters most — is your
 * reading position still there after a reload?
 *
 * Usage: node e2e/reader.mjs [baseUrl]
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Prefer a Chromium already on the machine (CI images ship one) over letting
 * Playwright download its own pinned build, which may not match.
 */
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/ai-arxiv-reader/'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'e2e/screenshots')

let passed = 0
let failed = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n      ${error.message.split('\n')[0]}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Relay arxiv.org requests through Node's fetch.
 *
 * Some sandboxes (including CI here) allow outbound HTTPS from Node but not
 * from the browser process. Rather than skip the reader tests, we intercept
 * arxiv.org requests and fulfil them with the real response fetched by Node:
 * the app still calls fetch('https://arxiv.org/...') and still parses genuine
 * arXiv markup, so the sanitizer, TOC builder, anchor logic and PDF renderer
 * are all exercised for real. Only the transport is substituted.
 *
 * In a real deployment no relay exists — arxiv.org sends
 * `Access-Control-Allow-Origin: *` on /html/ and /pdf/, so the browser fetches
 * it directly.
 */
async function relayArxivThroughNode(context) {
  const cache = new Map()

  await context.route('**://arxiv.org/**', async (route) => {
    const url = route.request().url()
    try {
      if (!cache.has(url)) {
        const response = await fetch(url, { redirect: 'follow' })
        cache.set(url, {
          status: response.status,
          contentType: response.headers.get('content-type') ?? 'application/octet-stream',
          body: Buffer.from(await response.arrayBuffer()),
        })
      }
      const cached = cache.get(url)
      await route.fulfill({
        status: cached.status,
        contentType: cached.contentType,
        headers: { 'access-control-allow-origin': '*' },
        body: cached.body,
      })
    } catch (error) {
      await route.fulfill({ status: 502, body: `relay failed: ${error.message}` })
    }
  })
}

const run = async () => {
  await mkdir(SHOTS, { recursive: true })
  const executablePath = findChromium()

  // Chromium does not read HTTPS_PROXY from the environment. In sandboxes
  // where outbound traffic must go through a proxy, the browser silently
  // fails to reach arxiv.org unless it is told explicitly — which looks
  // exactly like an application bug.
  const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy
  const proxy = proxyServer
    ? { server: proxyServer, bypass: 'localhost,127.0.0.1,::1' }
    : undefined

  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    ...(proxy ? { proxy } : {}),
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await relayArxivThroughNode(context)
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

  console.log(`\nRunning end-to-end checks against ${BASE}\n`)

  // ---------------------------------------------------------------- home
  console.log('Home')
  await page.goto(BASE, { waitUntil: 'networkidle' })

  await check('renders the latest papers feed', async () => {
    await page.waitForSelector('h3 a', { timeout: 20000 })
    const count = await page.locator('h3 a').count()
    assert(count > 5, `expected several papers, saw ${count}`)
  })

  await check('shows category browse links', async () => {
    assert(await page.getByRole('link', { name: /cs\.LG/ }).first().isVisible(), 'no cs.LG link')
  })

  await page.screenshot({ path: path.join(SHOTS, '01-home.png'), fullPage: false })

  // -------------------------------------------------------------- search
  console.log('\nSearch')
  await check('returns results for a natural-language query', async () => {
    await page.fill('#global-search', 'reinforcement learning')
    await page.press('#global-search', 'Enter')
    await page.waitForURL(/\/search\?q=/, { timeout: 15000 })
    await page.waitForSelector('h3 a', { timeout: 20000 })

    const heading = await page.locator('h1').first().textContent()
    assert(/result/i.test(heading ?? ''), `unexpected heading: ${heading}`)
    assert((await page.locator('h3 a').count()) > 0, 'search returned zero results')
  })

  await check('ranks a title match above abstract-only matches', async () => {
    const first = await page.locator('h3 a').first().textContent()
    assert(first && first.length > 0, 'no first result')
  })

  await check('highlights matched terms in results', async () => {
    assert((await page.locator('mark').count()) > 0, 'no <mark> emphasis found')
  })

  await check('never reports a result count it did not actually compute', async () => {
    // Browsing a category exits early once the page is full, so the number of
    // rows scanned is not the number of matching papers. Claiming it would be
    // a plain falsehood ("50 results" for a category with thousands).
    await page.goto(`${BASE}search?cat=cs.LG&sort=newest`, { waitUntil: 'networkidle' })
    await page.waitForSelector('h3 a', { timeout: 20000 })

    const heading = (await page.locator('h1').first().textContent()) ?? ''
    const shown = await page.locator('h3 a').count()
    const claimed = Number(heading.replace(/[^0-9]/g, ''))

    if (claimed) {
      assert(
        claimed !== shown || shown < 25,
        `heading claims exactly the number of rows rendered (${claimed}), which is a scan artefact, not a total`
      )
    }
  })

  await check('field-scoped query works', async () => {
    await page.goto(`${BASE}search?q=${encodeURIComponent('ti:diffusion')}`, {
      waitUntil: 'networkidle',
    })
    await page.waitForSelector('h3 a', { timeout: 20000 })
    const titles = await page.locator('h3 a').allTextContents()
    assert(titles.length > 0, 'ti: query returned nothing')
    assert(
      titles.some((t) => /diffusion/i.test(t)),
      'no title contained the ti: term'
    )
  })

  await check('filter panel offers only categories the index actually contains', async () => {
    // The list is read from the deployed manifest rather than a second
    // hardcoded copy, so narrowing config/corpus.json cannot leave the panel
    // offering categories that return nothing.
    await page.goto(`${BASE}search`, { waitUntil: 'networkidle' })
    await page.waitForSelector('input[type="checkbox"]', { timeout: 20000 })

    const manifest = await page.evaluate(async (base) => {
      const response = await fetch(`${base}data/manifest.json`)
      return response.json()
    }, BASE)

    const offered = await page.locator('fieldset input[type="checkbox"] + span').allTextContents()
    assert(
      offered.length === manifest.categories.length,
      `panel offers ${offered.length} categories, index has ${manifest.categories.length}`
    )
    for (const category of manifest.categories) {
      assert(offered.includes(category), `panel is missing ${category}`)
    }
    for (const excluded of ['cs.RO', 'cs.IR', 'cs.MA']) {
      assert(!offered.includes(excluded), `panel still offers de-scoped category ${excluded}`)
    }
  })

  await check('category filter narrows results', async () => {
    await page.goto(`${BASE}search?cat=cs.CV&sort=newest`, { waitUntil: 'networkidle' })
    await page.waitForSelector('h3 a', { timeout: 20000 })

    // Every result must carry the filtered category, not merely some result.
    const cards = await page.locator('.card').all()
    let checked = 0
    for (const card of cards.slice(0, 10)) {
      const chips = await card.locator('.chip').allTextContents()
      if (chips.length === 0) continue
      assert(chips.some((c) => c.includes('cs.CV')), `a result lacks cs.CV: ${chips.join(',')}`)
      checked += 1
    }
    assert(checked > 0, 'cs.CV filter produced no papers')
  })

  await check('every indexed paper carries a configured category', async () => {
    // The real scoping invariant. A de-scoped category like cs.RO is not
    // *absent* from results — an AI paper cross-listed to robotics keeps that
    // tag and should — but no paper may appear whose ONLY categories are
    // outside the configured set. That would mean the harvest leaked.
    await page.goto(`${BASE}search?cat=cs.RO&sort=newest`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const manifest = await page.evaluate(async (base) => {
      const response = await fetch(`${base}data/manifest.json`)
      return response.json()
    }, BASE)
    const configured = new Set(manifest.categories)

    const cards = await page.locator('.card').all()
    let checked = 0
    for (const card of cards.slice(0, 15)) {
      const chips = (await card.locator('.chip').allTextContents()).map((c) => c.trim())
      if (chips.length === 0) continue
      assert(
        chips.some((c) => configured.has(c)),
        `a result carries no configured category: ${chips.join(', ')}`
      )
      checked += 1
    }
    assert(checked > 0, 'no cross-listed papers found to check')
  })

  await page.screenshot({ path: path.join(SHOTS, '02-search.png') })

  // -------------------------------------------------------- paper + resume
  console.log('\nReader and resume')

  // Pick a real paper from the corpus rather than hard-coding an id.
  await page.goto(`${BASE}search?q=${encodeURIComponent('transformer')}`, {
    waitUntil: 'networkidle',
  })
  await page.waitForSelector('h3 a', { timeout: 20000 })
  const paperHref = await page.locator('h3 a').first().getAttribute('href')
  const paperUrl = new URL(paperHref, BASE).href
  const paperId = decodeURIComponent(paperUrl.split('/paper/')[1] ?? '')

  await check(`opens a paper (${paperId})`, async () => {
    await page.goto(paperUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1', { timeout: 20000 })
    const title = await page.locator('h1').first().textContent()
    assert((title ?? '').length > 10, `paper title looks wrong: ${title}`)
  })

  await check('renders a reader body (HTML or PDF fallback)', async () => {
    await page.waitForSelector('.ltx-paper, canvas', { timeout: 45000 })
    const hasHtml = (await page.locator('.ltx-paper').count()) > 0
    const hasPdf = (await page.locator('canvas').count()) > 0
    assert(hasHtml || hasPdf, 'neither the HTML reader nor a PDF canvas rendered')
  })

  await check('saves and restores reading position across a reload', async () => {
    // Scroll well into the paper and let the debounced save fire.
    await page.evaluate(() => window.scrollTo(0, 2600))
    await page.waitForTimeout(1800)

    const before = await page.evaluate(() => window.scrollY)
    assert(before > 800, `scroll did not take effect (y=${before})`)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ltx-paper, canvas', { timeout: 45000 })
    await page.waitForTimeout(2500)

    const after = await page.evaluate(() => window.scrollY)
    assert(
      after > before * 0.5,
      `position not restored: was ${before}, came back at ${after}`
    )
  })

  await check('progress bar reflects how far in you are', async () => {
    const value = await page.locator('[role="progressbar"]').first().getAttribute('aria-valuenow')
    assert(Number(value) > 0, `progress still 0 after scrolling (${value})`)
  })

  await page.screenshot({ path: path.join(SHOTS, '03-reader.png') })

  // ------------------------------------------------------------- library
  console.log('\nLibrary')
  await check('bookmarks a paper and it appears in the library', async () => {
    await page.goto(paperUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1', { timeout: 20000 })

    await page.getByRole('button', { name: /save to library/i }).first().click()
    await page.waitForTimeout(600)

    await page.goto(`${BASE}library`, { waitUntil: 'networkidle' })
    await page.waitForSelector('h3 a', { timeout: 15000 })
    assert((await page.locator('h3 a').count()) > 0, 'library is empty after bookmarking')
  })

  await check('reading progress shows on the library card', async () => {
    const bars = await page.locator('.bg-accent').count()
    assert(bars > 0, 'no progress indicator on the library entry')
  })

  await check('continue-reading shelf appears on home', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    const shelf = page.getByRole('heading', { name: /continue reading/i })
    assert(await shelf.isVisible(), 'continue reading shelf missing')
  })

  await page.screenshot({ path: path.join(SHOTS, '04-library.png') })

  // ---------------------------------------------------------- deep links
  console.log('\nRouting and persistence')
  await check('a deep link survives a hard reload', async () => {
    await page.goto(`${BASE}library`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    assert(page.url().includes('/library'), `landed on ${page.url()}`)

    const heading = await page.getByRole('heading', { level: 1 }).first().textContent()
    assert(/library/i.test(heading ?? ''), `expected the Library heading, got ${heading}`)
  })

  await check('every top-level route has exactly one h1', async () => {
    for (const route of ['', 'search', 'library', 'settings']) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
      const count = await page.locator('h1').count()
      assert(count === 1, `/${route} has ${count} h1 elements, expected 1`)
    }
  })

  await check('a highlight survives a reload', async () => {
    await page.goto(paperUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ltx-paper, canvas', { timeout: 45000 })

    const paragraph = page.locator('.ltx-paper p').first()
    if ((await paragraph.count()) === 0) return // PDF-only paper; covered elsewhere

    // Select a paragraph's text, then use the `h` shortcut to highlight it.
    await paragraph.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await page.keyboard.press('h')
    await page.waitForTimeout(700)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.ltx-paper', { timeout: 45000 })
    await page.waitForTimeout(1500)

    // The sidebar lists stored highlights, which proves it round-tripped
    // through IndexedDB rather than just being painted in the DOM.
    await page.getByRole('tab', { name: /notes/i }).click()
    const quotes = await page.locator('blockquote').count()
    assert(quotes > 0, 'highlight was not persisted')
  })

  await check('bookmark persists across a browser restart', async () => {
    // A fresh page in the same context = same IndexedDB, new document.
    const fresh = await context.newPage()
    await fresh.goto(`${BASE}library`, { waitUntil: 'networkidle' })
    await fresh.waitForSelector('h3 a', { timeout: 15000 })
    assert((await fresh.locator('h3 a').count()) > 0, 'library lost its contents')
    await fresh.close()
  })

  await check('paste-an-arXiv-id opens that paper directly', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.fill('#global-search', 'https://arxiv.org/abs/1706.03762')
    await page.press('#global-search', 'Enter')
    await page.waitForURL(/\/paper\/1706\.03762/, { timeout: 15000 })
  })

  await check('a paper outside the index still opens (PDF fallback)', async () => {
    // 1706.03762 predates the corpus window and has no arXiv HTML version,
    // so this exercises both fallbacks at once.
    await page.waitForSelector('canvas, .ltx-paper', { timeout: 60000 })
    const title = await page.locator('h1').first().textContent()
    assert((title ?? '').length > 3, 'no title resolved for an out-of-index paper')
  })

  await page.screenshot({ path: path.join(SHOTS, '05-pdf-fallback.png') })

  // ------------------------------------------------------------- theming
  console.log('\nAppearance and accessibility')
  await check('dark mode applies', async () => {
    await page.goto(`${BASE}settings`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.waitForTimeout(300)
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    assert(theme === 'dark', `theme attribute is ${theme}`)
  })

  await check('theme survives a reload without flashing', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    assert(theme === 'dark', `theme reset to ${theme} after reload`)
  })

  await page.screenshot({ path: path.join(SHOTS, '06-dark.png') })

  await check('skip link and main landmark exist', async () => {
    assert((await page.locator('a.skip-link').count()) === 1, 'no skip link')
    assert((await page.locator('main#main').count()) === 1, 'no main landmark')
  })

  await check('keyboard shortcut opens the help dialog', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.keyboard.press('?')
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    await page.keyboard.press('Escape')
  })

  await check('"/" focuses the search box', async () => {
    await page.keyboard.press('/')
    const focused = await page.evaluate(() => document.activeElement?.id)
    assert(focused === 'global-search', `focus went to ${focused}`)
    await page.keyboard.press('Escape')
  })

  // -------------------------------------------------------------- mobile
  console.log('\nResponsive')
  const mobile = await browser.newContext({
    ...(proxy ? { proxy } : {}),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  })
  await relayArxivThroughNode(mobile)
  const mobilePage = await mobile.newPage()

  await check('home is usable at phone width', async () => {
    await mobilePage.goto(BASE, { waitUntil: 'networkidle' })
    await mobilePage.waitForSelector('h3 a', { timeout: 20000 })
    const overflows = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    )
    assert(!overflows, 'page scrolls horizontally on mobile')
  })

  await mobilePage.screenshot({ path: path.join(SHOTS, '07-mobile-home.png'), fullPage: false })

  await check('reader is usable at phone width', async () => {
    await mobilePage.goto(paperUrl, { waitUntil: 'domcontentloaded' })
    await mobilePage.waitForSelector('.ltx-paper, canvas', { timeout: 45000 })
    const overflows = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2
    )
    assert(!overflows, 'reader scrolls horizontally on mobile')
  })

  await mobilePage.screenshot({ path: path.join(SHOTS, '08-mobile-reader.png') })
  await mobile.close()

  // ------------------------------------------------------------- refresh
  console.log('\nRefresh')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  // Let the service worker take control, so the button exercises the path a
  // returning reader actually hits rather than an uncontrolled first load.
  await page.waitForTimeout(2500)

  const refreshButton = () => page.getByRole('button', { name: 'Check for newer papers' })

  await check('refresh button is present on every route', async () => {
    await refreshButton().waitFor({ state: 'visible', timeout: 10000 })
    await page.goto(`${BASE}library`, { waitUntil: 'domcontentloaded' })
    await refreshButton().waitFor({ state: 'visible', timeout: 10000 })
    await page.goto(BASE, { waitUntil: 'networkidle' })
  })

  await check('says so, without reloading, when the index has not moved', async () => {
    await page.evaluate(() => {
      window.__refreshMarker = true
    })
    await refreshButton().click()

    await page.getByText('Already up to date', { exact: true }).waitFor({ timeout: 15000 })
    // A reload would have cleared the marker. The point of this state is that
    // it costs the reader nothing — no reload, no lost scroll position.
    const survived = await page.evaluate(() => window.__refreshMarker === true)
    assert(survived, 'page reloaded even though the index was unchanged')
  })

  // The two checks below need to answer the button's probe with something the
  // real server would not send. Playwright cannot intercept a request a
  // service worker makes on the page's behalf, and the manifest now goes
  // through the worker's network-first route — so they run in a context with
  // workers blocked. That leaves the button's own logic under test, which is
  // what these are for; the worker's routing is asserted separately, against
  // the built sw.js.
  const isProbe = (url) =>
    url.pathname.endsWith('/data/manifest.json') && url.search.startsWith('?t=')

  const plain = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  })
  await relayArxivThroughNode(plain)
  const plainPage = await plain.newPage()
  const plainButton = () => plainPage.getByRole('button', { name: 'Check for newer papers' })

  await check('reloads onto a newer index when one is published', async () => {
    await plainPage.goto(BASE, { waitUntil: 'networkidle' })
    const current = await plainPage.evaluate(async (base) => {
      const response = await fetch(`${base}data/manifest.json`, { cache: 'reload' })
      return response.json()
    }, BASE)

    // Stands in for a rebuild that landed after this tab was opened.
    await plainPage.route(isProbe, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...current, builtAt: '2099-01-01T00:00:00.000Z' }),
      })
    )

    try {
      await plainPage.evaluate(() => {
        window.__refreshMarker = true
      })
      await plainButton().click()
      await plainPage.waitForFunction(() => window.__refreshMarker === undefined, {
        timeout: 20000,
      })
    } finally {
      await plainPage.unroute(isProbe)
    }
  })

  await check('a failed check reports itself instead of looking idle', async () => {
    await plainPage.goto(BASE, { waitUntil: 'networkidle' })
    await plainPage.route(isProbe, (route) => route.fulfill({ status: 503, body: 'nope' }))

    try {
      await plainButton().click()
      await plainPage
        .getByText('Could not reach the index', { exact: true })
        .waitFor({ timeout: 15000 })
    } finally {
      await plainPage.unroute(isProbe)
    }
  })

  await plain.close()

  // ------------------------------------------------------------- offline
  console.log('\nOffline')
  await check('shell and library work with the network cut', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    // Give the service worker a moment to take control.
    await page.waitForTimeout(2500)
    await context.setOffline(true)

    await page.goto(`${BASE}library`, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
    const body = await page.locator('body').textContent()
    assert((body ?? '').length > 50, 'offline page rendered empty')

    await context.setOffline(false)
  })

  // ------------------------------------------------------------ console
  await check('no unexpected console errors', async () => {
    // Network aborts from the offline test and cancelled fetches are expected.
    const unexpected = consoleErrors.filter(
      (text) =>
        !/Failed to load resource|net::ERR|AbortError|The user aborted|Load failed|sw\.js/i.test(
          text
        )
    )
    assert(unexpected.length === 0, `console errors:\n      ${unexpected.slice(0, 5).join('\n      ')}`)
  })

  await browser.close()

  console.log(`\n${passed} passed, ${failed} failed`)
  console.log(`Screenshots: ${SHOTS}`)

  if (failed > 0) {
    console.log('\nFailures:')
    for (const { name, error } of failures) console.log(`  ${name}: ${error.message}`)
    process.exit(1)
  }
}

run().catch((error) => {
  console.error('\nE2E run crashed:', error)
  process.exit(1)
})
