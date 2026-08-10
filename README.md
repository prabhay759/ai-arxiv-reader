# arXiv AI Reader

A browser-based reader for AI papers from arXiv. Search across the literature,
read papers in a proper reading view, and pick up exactly where you left off —
on any device, with no installation.

**There is no backend.** The whole thing is a static site on GitHub Pages: no
server, no database, no hosting bill. Two pieces of engineering make that
possible, and they're worth understanding before you change anything.

---

## How it works

### Search runs on a prebuilt static index

arXiv's search API (`export.arxiv.org/api/query`) sends **no CORS header**, so a
browser physically cannot call it. Instead, a scheduled GitHub Action harvests
paper metadata through arXiv's OAI-PMH bulk interface and compiles it into a
sharded inverted index of plain gzipped JSON. The browser downloads only the
shards containing your query's terms — a few KB — then ranks locally.

The consequence: search is fast, works offline, and costs nothing to run. The
trade-off: results are as fresh as the last CI run (every 6 hours), not
real-time. Opening a paper by ID or URL is always live.

BM25's term-frequency component is computed at **build** time and baked into
each posting as one quantized byte, so the browser never downloads a
per-document length table before it can rank anything.

### Reading loads straight from arXiv

Unlike the search API, arXiv's `/html/` and `/pdf/` endpoints **do** send
`Access-Control-Allow-Origin: *`, so paper bodies are fetched directly by the
browser with no proxy.

Reading is HTML-first. arXiv's LaTeXML HTML reflows for mobile, renders maths
via native MathML (no JS library), and gives every section and paragraph a
stable id — which is what anchors reading positions and highlights. Papers
without an HTML version (generally pre-2024) fall back to a `pdf.js` viewer
with a real text layer, so selection, find and screen readers all work.

### Sync writes to your own Google Drive

Signing in with Google stores one JSON document in your Drive's hidden
`appDataFolder`. It's invisible in the Drive UI, unshareable, and readable only
by this app for your account. No server holds your data, and revoking access in
your Google account removes it.

Local state (IndexedDB) is always the source of truth; sync reconciles the two
copies last-write-wins per record, with tombstones so a deletion on one device
isn't resurrected by another.

### Guest mode is the default

With zero configuration, everything works: search, reading, resume, library,
collections, tags, highlights, notes and offline. Signing in adds cross-device
sync and merges your existing local data into the account on first use.

---

## Features

**Search**
- Full-text search over titles, authors, categories and abstracts
- Query language: `ti:diffusion`, `au:"Yann LeCun"`, `abs:contrastive`,
  `cat:cs.LG`, `"exact phrase"`, `-exclude`
- Filters by category and date range; sort by relevance, newest or oldest
- Search history and saved searches
- Paste any arXiv ID or URL to jump straight to that paper

**Reading**
- Reflowable reader with adjustable text size, line height, line width and typeface
- PDF viewer with zoom, page navigation, outline and text selection
- Auto-generated table of contents
- Reading progress with percentage and estimated time remaining
- Resume position that survives font changes, rotation and window resizing

**Library**
- Bookmarks, read status, starring, collections and tags
- Multi-colour highlights with per-highlight notes
- Free-form notes per paper, searchable across your whole library
- "Continue reading" shelf
- JSON and BibTeX export, JSON import

**App**
- Works offline; installable to a phone home screen
- Light, dark and system themes
- Keyboard shortcuts (`?` lists them)
- Every search and paper is a shareable deep link

---

## Deploy it

### 1. Enable GitHub Pages

Repository **Settings → Pages → Source: GitHub Actions**.

Then run the **Build index and deploy to Pages** workflow (Actions tab →
*Run workflow*). The first run does a full harvest and takes roughly 30–45
minutes; later runs are incremental and finish in a couple of minutes.

Your site appears at `https://<user>.github.io/<repo>/`.

### 2. Enable Google sign-in (optional)

The app is fully usable without this. To turn on cross-device sync:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Google Drive API**.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the
   app name and your email, and add the scope
   `https://www.googleapis.com/auth/drive.appdata`.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Add your Pages origin (e.g. `https://<user>.github.io`) to
   **Authorised JavaScript origins**. No redirect URI is needed — the app uses
   the token flow.
4. Copy the client ID into the repository variable
   **Settings → Secrets and variables → Actions → Variables →
   `VITE_GOOGLE_CLIENT_ID`**, then re-run the deploy workflow.

The client ID is a public identifier, not a secret — it ships in the JavaScript
bundle by design, which is why it's a *variable* rather than a secret.

> **Expect an "unverified app" warning on first sign-in.** `drive.appdata` is a
> sensitive scope, so until you submit the app for Google verification, users
> see an interstitial and must click *Advanced → Go to <app>*. This is a Google
> review process, not a bug. Guest mode is unaffected.

### 3. Tune the corpus (optional)

`config/corpus.json` controls what gets indexed:

| Key | Meaning |
| --- | --- |
| `categories` | arXiv categories to harvest |
| `historyStart` | How far back to harvest. Earlier = bigger site, longer first build |
| `abstractWindowMonths` | How far back abstracts are indexed for full-text search. Abstracts dominate the size budget |
| `docsPerChunk` | Papers per display chunk. Smaller = less fetched per result page |

Papers older than `abstractWindowMonths` remain searchable by title, author and
category, and their abstract still loads when opened.

**Sizing** (measured, 63,570 papers → 56 MB): expect roughly **250–300 MB** for
a 2018-onward corpus of ~350k papers. GitHub Pages' documented soft limits are
1 GB per site and 100 GB/month of bandwidth, so keep an eye on `historyStart` if
you widen the categories a lot.

---

## Develop

```bash
npm install

# Build a small local corpus first — the app needs an index to search.
node scripts/harvest.mjs --from 2026-07-01 --sets cs:cs:AI
npm run build:index

npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and build to `dist/` |
| `npm test` | Unit tests |
| `npm run harvest` | Incremental OAI-PMH harvest into `.corpus/` |
| `npm run build:index` | Compile `.corpus/` into `public/data/` |
| `node e2e/reader.mjs` | Browser tests against a running preview |

`.corpus/` and `public/data/` are generated and gitignored — CI rebuilds them
and ships them as a Pages artifact, so refreshing the index never bloats git
history.

### Layout

```
scripts/harvest.mjs      OAI-PMH harvester (CI only)
scripts/build-index.mjs  Compiles the corpus into static shards
shared/tokenize.mjs      Tokenizer shared by the indexer AND the browser
src/search/              Query parser, shard fetching, BM25 ranking
src/reader/              HTML + PDF readers, resume anchors, highlighting
src/store/               IndexedDB (Dexie) — the source of truth
src/sync/                Google auth, Drive appDataFolder, merge logic
```

> `shared/tokenize.mjs` is imported by both the Node indexer and the browser on
> purpose. If the two ever tokenize differently, queries produce terms the index
> doesn't contain and search silently returns nothing — so it lives in exactly
> one file.

### Testing

Unit tests cover the parts where bugs hide quietly: the query parser, BM25 and
postings round-trips, the LaTeX cleaner, and sync merges including conflicting
timestamps and tombstones.

`e2e/reader.mjs` drives a real browser through search, opening a paper, scrolling,
reloading and asserting the position came back, bookmarking, highlighting,
offline use and mobile layout, saving screenshots to `e2e/screenshots/`.

In sandboxes where the browser has no direct outbound network (CI here), the E2E
script relays `arxiv.org` requests through Node so the real code path still runs
against genuine arXiv markup.

---

## Credits and terms

Paper metadata and full text come from [arXiv.org](https://arxiv.org) via its
OAI-PMH interface, used under arXiv's
[terms of use](https://info.arxiv.org/help/api/tou.html). This project is not
affiliated with or endorsed by arXiv. Individual papers remain under whatever
licence their authors chose.

There is no tracking, no analytics and no third-party requests beyond arXiv
and — only if you enable sign-in — Google.
