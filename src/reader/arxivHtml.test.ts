/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchArxivHtml, HtmlUnavailableError } from './arxivHtml'

function paperHtml(body: string): string {
  return `<html><body><div class="ltx_page_main">${body}</div></body></html>`
}

/** A response that reports the URL it was served from, as fetch does. */
function served(html: string, url: string): Response {
  const response = new Response(html, { status: 200 })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function stub(html: string, url = 'https://arxiv.org/html/2506.19125') {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(served(html, url))))
}

afterEach(() => vi.unstubAllGlobals())

describe('figure URLs', () => {
  it('resolves against the document, not a directory named after it', async () => {
    // The bug: the base was built by appending a slash to the paper URL, which
    // treats "/html/2506.19125" as a directory when it is a document. Every
    // figure resolved one level too deep and 404ed — silently, since a missing
    // image reports nothing but console noise.
    stub(paperHtml('<figure><img src="2506.19125v2/overview.png"></figure>'))

    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).toContain('https://arxiv.org/html/2506.19125v2/overview.png')
    expect(html).not.toContain('/html/2506.19125/2506.19125v2/')
  })

  it('follows the served URL when arXiv redirects to a version', async () => {
    stub(
      paperHtml('<img src="x1.png">'),
      'https://arxiv.org/html/2506.19125v2/'
    )
    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).toContain('https://arxiv.org/html/2506.19125v2/x1.png')
  })

  it('leaves already-absolute sources alone', async () => {
    stub(paperHtml('<img src="https://example.com/a.png"><img src="data:image/png;base64,AA">'))
    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).toContain('https://example.com/a.png')
    expect(html).toContain('data:image/png;base64,AA')
  })

  it('drops arXiv’s own site furniture', async () => {
    stub(paperHtml('<img src="/static/browse/logo.png"><img src="fig.png">'))
    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).not.toContain('/static/browse/logo.png')
    expect(html).toContain('fig.png')
  })

  it('defers offscreen figures', async () => {
    stub(paperHtml('<img src="fig.png">'))
    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).toContain('loading="lazy"')
  })
})

describe('links', () => {
  it('marks intra-paper links for the reader to intercept', async () => {
    stub(paperHtml('<a href="#S3.p2">Section 3</a>'))
    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).toContain('data-internal="true"')
    expect(html).toContain('href="#S3.p2"')
  })

  it('resolves relative links the same way as figures', async () => {
    stub(paperHtml('<a href="2506.19125v2/appendix.html">Appendix</a>'))
    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).toContain('https://arxiv.org/html/2506.19125v2/appendix.html')
  })

  it('sends external links to a new tab safely', async () => {
    stub(paperHtml('<a href="https://example.com">out</a>'))
    const { html } = await fetchArxivHtml('2506.19125')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})

describe('papers arXiv has not rendered', () => {
  it('is reported as unavailable, not as a broken page', async () => {
    // arXiv answers with a friendly notice page and HTTP 200, so the status
    // code cannot be trusted — the LaTeXML wrapper is the real signal.
    stub('<html><body><h1>No HTML for this paper</h1></body></html>')
    await expect(fetchArxivHtml('1706.03762')).rejects.toBeInstanceOf(HtmlUnavailableError)
  })
})
